"""Live exploit-then-defend demo on the 7-agent pentest MAS.

    python -m demo.run_demo --undefended     # injection cascades to orchestrator
    python -m demo.run_demo --defended        # ingress guards block it before it enters a node

Backend via --backend or MAS_BACKEND (stub|groq|openrouter|gemini). The stub
backend runs offline and deterministically. Same payload and topology in both
modes; the only difference is whether checkpoints audit the hand-offs
into each guarded node (a blocked input is wiped before the agent sees it).

The pipeline lives in ``iter_run`` as a stream of structured events; both this
CLI and the browser GUI (demo/server.py) consume it, so they never drift.
"""
from __future__ import annotations

import argparse
import logging
import random
from collections.abc import Iterator
from pathlib import Path

import networkx as nx

from demo.agents import Agent, make_backend
from demo.guards_live import GuardEnsemble
from demo.target_mock import CANARY, get_preset, get_target_output, is_compromised
from engine.manifest import load_manifest
from engine.pipeline import build_plan

log = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "manifests" / "pentest7_poc.json"  # cwd-independent

# Distinct models per guard when the provider offers them (heterogeneous vote).
GROQ_GUARD_MODELS = ("openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b")
# Bounds LLM inputs along the graph. Each agent reply is capped at 400 tokens (~1.6k chars),
# so 6000 fits three upstream replies whole; a lower cap cut the last one off mid-text.
MAX_HANDOFF_CHARS = 6000


def iter_run(
    defended: bool,
    backend_name: str | None = None,
    clean: bool = False,
    *,
    manifest_path: str | Path | None = None,
    alloc: str = "risk",
    budget: int | None = None,
    guard_model: str = "heuristic",
    seed: int = 0,
    deadline_s: float | None = None,
    payload_text: str | None = None,
    preset: str | None = None,
    canary: str = CANARY,
) -> Iterator[dict]:
    """Run the pipeline, yielding JSON-safe events as each step happens.

    Events: ``run_start``, ``agent_start``, ``guard_vote`` (defended guarded
    nodes only; ``direction="incoming"``), ``agent_output``, ``run_end``. The GUI and the CLI both consume
    this so the pipeline logic exists in exactly one place.

    The checkpoint plan comes from :func:`engine.pipeline.build_plan` (the same
    decomposition/allocation the Monte-Carlo uses): a node is guarded iff it
    sits in some checkpoint, and its ensemble has ``node_guards[node]`` guards
    (one budget unit = one guard) under the ``"any"`` rule. Guards are *ingress*
    guards: the ensemble audits the node's input before the agent runs, and a
    blocked input is replaced by a sanitized ContextWipe summary.

    The target content the entry agents read is, in priority order: ``payload_text``
    (custom attacker text), the ``preset`` id from ``demo.target_mock.PRESETS``, or
    the default scan (``clean`` selects the uninjected one). ``canary`` is the goal
    token whose presence means an agent obeyed (compromise checks, stub, guards).
    """
    mpath = Path(manifest_path) if manifest_path is not None else MANIFEST
    m = load_manifest(mpath)
    plan = build_plan(m, budget=budget, alloc=alloc, with_sim=False)
    plan["manifest"] = mpath.stem
    node_guards: dict[str, int] = plan["node_guards"]
    guarded = {v for v, k in node_guards.items() if k > 0}
    node_cps = {
        v: [c["id"] for c in plan["checkpoints"] if v in c["nodes"]] for v in m.nodes
    }

    if payload_text is not None:
        target_text, preset_id, payload_kind = payload_text, "custom", "custom"
    elif preset is not None:
        target_text, preset_id = get_preset(preset, canary), preset
        payload_kind = "clean" if preset == "clean" else "poisoned"
    else:
        preset_id = "clean" if clean else "nmap_banner"
        target_text = get_target_output(clean=clean)
        payload_kind = "clean" if clean else "poisoned"

    backend = make_backend(backend_name, canary=canary)
    if deadline_s is not None and hasattr(backend, "deadline"):
        import time
        backend.deadline = time.monotonic() + deadline_s   # whole-run cap for live LLMs
    guard_models: tuple[str, ...] = ()
    if getattr(backend, "provider", None) == "groq":
        guard_models = GROQ_GUARD_MODELS
    rng = random.Random(seed)
    order = list(nx.topological_sort(m.graph))

    yield {
        "type": "run_start",
        "mode": "defended" if defended else "undefended",
        "backend": getattr(backend, "name", "?"),
        "payload": payload_kind,                # "clean" | "poisoned" | "custom"
        "payload_text": target_text,            # the actual target content read at entry
        "preset": preset_id,                    # PRESETS id, or "custom"
        "canary": canary,
        "order": order,
        "guarded": sorted(guarded),
        "plan": plan,
        "alloc": alloc,
        "budget": plan["budget"],
        "guard_model": guard_model,
        "topology": {
            "nodes": [
                {
                    "id": v,
                    "label": m.graph.nodes[v].get("label", v),
                    "caps": m.graph.nodes[v].get("caps", []),
                    "weight": m.weight(v),
                }
                for v in m.nodes
            ],
            "edges": [{"from": u, "to": w} for u, w in m.graph.edges],
            "entry": list(m.entry),
            "critical": list(m.critical),
        },
    }

    outputs: dict[str, str] = {}
    blocked_at: list[str] = []
    for node in order:
        preds = list(m.graph.predecessors(node))
        if not preds:                                   # entry agent reads the target
            upstream = target_text
        else:
            upstream = "\n".join(outputs[p] for p in preds)[:MAX_HANDOFF_CHARS]

        label = m.graph.nodes[node].get("label", node)
        yield {"type": "agent_start", "node": node, "label": label, "input": upstream}

        # Ingress guard: a guarded node's INPUT is audited before the agent runs, in the
        # spirit of engine/simulate.py (which blocks infection *into* a guarded node).
        # Approximation: the demo checks the joined hand-off once per node, whereas the
        # simulation draws one block chance per infected incoming edge.
        wiped = False
        agent_input = upstream
        if defended and node in guarded:
            k = node_guards[node]
            guards = GuardEnsemble(
                k=k, backend=backend, models=guard_models, rule="any",
                guard_model=guard_model, p0=plan["p0"], rng=rng, canary=canary,
            )
            guard_error = False
            try:
                block, votes = guards.blocks(upstream)
            except Exception:  # noqa: BLE001 - a broken guard must not wave traffic through
                # Fail closed (input is still wiped) but report it as an error, not as
                # a detection: it must never count towards "attack stopped".
                block, votes, guard_error = True, [True] * k, True
            if guard_model == "sim":
                used = ["sim"] * k
            elif guard_models:
                used = [guard_models[i % len(guard_models)] for i in range(k)]
            else:
                used = ["stub"] * k
            yield {
                "type": "guard_vote",
                "node": node,
                "direction": "incoming",
                "votes": votes,
                "models": used,
                "blocked": block,
                "checkpoint": node_cps[node],
                "k": k,
                "rule": "any",
                "guard_error": guard_error,
            }
            if block:
                agent_input = (
                    f"[ContextWipe] Untrusted hand-off to {node} was blocked at checkpoint "
                    f"{', '.join(node_cps[node])}; only a sanitized summary is forwarded: "
                    f"upstream reported routine findings."
                )
                if not guard_error:
                    blocked_at.append(node)
                wiped = True

        # A backend error (e.g. Groq 429 after retries) must not abort the run.
        try:
            out = Agent(node, backend).run(agent_input)
            error = False
        except Exception as e:  # noqa: BLE001 - surface to the UI, keep going
            # Only the status code reaches the browser; provider details stay in the server log.
            status = getattr(getattr(e, "response", None), "status_code", None)
            out = f"[{node}] backend error" + (f" (HTTP {status})" if status else f" ({type(e).__name__})")
            log.warning("agent %s backend error: %r", node, e)
            error = True

        outputs[node] = out
        yield {
            "type": "agent_output",
            "node": node,
            "label": label,
            "output": out,
            "compromised": is_compromised(out, canary),
            "wiped": wiped,
            "agent_input": agent_input,
            "error": error,
            "upstream": preds,
        }

    yield {
        "type": "run_end",
        "orch_pwned": is_compromised(outputs.get("orchestrator", ""), canary),
        "rep_pwned": is_compromised(outputs.get("reporter", ""), canary),
        "blocked_at": blocked_at,
    }


def run(defended: bool, backend_name: str | None, clean: bool = False) -> dict:
    """CLI consumer of :func:`iter_run` — prints the stream to the terminal."""
    summary = {"orch_pwned": False, "rep_pwned": False, "blocked_at": []}
    for ev in iter_run(defended, backend_name, clean):
        if ev["type"] == "run_start":
            print(f"=== {ev['mode'].upper()} run (backend={ev['backend']}, "
                  f"payload={ev['payload']}) ===")
            print(f"checkpoints (guarded nodes): {ev['guarded']}\n")
        elif ev["type"] == "guard_vote" and ev["blocked"]:
            pass  # the block is shown on the agent_output line below
        elif ev["type"] == "agent_output":
            flag = "  [CANARY]" if ev["compromised"] else "  [clean]"
            shown = " ".join(ev["output"].split())
            if len(shown) > 200:
                shown = shown[:200] + " ..."
            note = "  <-- BLOCKED + ContextWipe" if ev["wiped"] else ""
            print(f"  {ev['node']:>12}:{flag} {shown}{note}")
        elif ev["type"] == "run_end":
            summary = ev
            print(f"\n  orchestrator compromised: {ev['orch_pwned']} | "
                  f"reporter compromised: {ev['rep_pwned']}")
            if ev["blocked_at"]:
                print(f"  blocked at: {ev['blocked_at']}")
            print()
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--defended", action="store_true")
    g.add_argument("--undefended", action="store_true")
    ap.add_argument("--backend", default=None, help="stub|groq|openrouter|gemini")
    ap.add_argument("--clean", action="store_true", help="serve a clean (uninjected) target")
    a = ap.parse_args()
    run(defended=a.defended, backend_name=a.backend, clean=a.clean)


if __name__ == "__main__":
    main()
