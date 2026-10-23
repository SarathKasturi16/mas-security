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
import time
from collections.abc import Iterator
from pathlib import Path

import networkx as nx

from demo.agents import (
    GROQ_GUARD_MODELS, ROLE_PROMPTS, Agent, build_role_prompt, classify_error,
    GuardCallCap, make_backend, make_guard_backend,
)
from demo.guards_live import GuardEnsemble
from demo.target_mock import CANARY, get_preset, get_target_output, is_compromised
from engine.manifest import Manifest, load_manifest
from engine.pipeline import build_plan

log = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_DIR = REPO_ROOT / "manifests"
MANIFEST = MANIFEST_DIR / "pentest7_poc.json"  # cwd-independent
# Bounds LLM inputs along the graph. Each agent reply is capped at 400 tokens (~1.6k chars),
# so 6000 fits three upstream replies whole; a lower cap cut the last one off mid-text.
MAX_HANDOFF_CHARS = 6000
# A checkpoint's guards run at each of its agents, so guard calls can exceed B;
# this bounds the paid guard calls one run can make (beyond it guards fail closed).
MAX_LIVE_GUARD_CALLS = 36   # >= the most any team needs at B=15 (33)


def run_order(m: Manifest) -> tuple[list[str], list[tuple[str, str]]]:
    """Order in which to run every agent once, plus the edges that are not run.

    Entry agents read the target, so edges *into* them are dropped; any DFS back-edge
    left (walking from the entries) is dropped too, and what remains is topologically
    sorted. Returns ``(order, feedback_edges)``; feedback edges are drawn but never
    feed an agent's input (loops run in one pass). A DAG with no edge into an entry
    agent is returned unchanged.
    """
    g = m.graph
    feedback = [(u, v) for u, v in g.edges if v in m.entry]
    h = g.copy()
    h.remove_edges_from(feedback)
    state: dict[str, int] = {}          # absent = new, 1 = on the DFS stack, 2 = done
    for root in [*m.entry, *h.nodes]:
        if root in state:
            continue
        state[root] = 1
        stack = [(root, iter(list(h.successors(root))))]
        while stack:
            u, it = stack[-1]
            for w in it:
                if state.get(w) == 1:               # back-edge: closes a cycle
                    feedback.append((u, w))
                elif w not in state:
                    state[w] = 1
                    stack.append((w, iter(list(h.successors(w)))))
                    break
            else:
                state[u] = 2
                stack.pop()
    h.remove_edges_from(feedback)
    return list(nx.topological_sort(h)), feedback


def _role_instr(m: Manifest, node: str, has_preds: bool) -> str | None:
    """Prompt for a node without a hand-written one (None = Agent uses ROLE_PROMPTS)."""
    if node in ROLE_PROMPTS:
        return None
    return build_role_prompt(
        m.graph.nodes[node].get("label", node),
        entry=node in m.entry or not has_preds, critical=node in m.critical,
    )


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
    guard_backend: str = "auto",
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

    Every agent runs once, in :func:`run_order`; feedback edges are reported in
    ``run_start`` but never feed an input. ``guard_backend`` (``auto|gemini|groq|
    heuristic``) picks where live guards run, separate from the agent backend, and
    guards are called a few at a time, stopping after the first BLOCK (those never
    called vote ``None``). ``deadline_s`` is a whole-run limit: anything not yet run
    when it passes is reported as skipped (``error_kind="timeout"``).
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
    deadline_at = time.monotonic() + deadline_s if deadline_s is not None else None
    if deadline_at is not None and hasattr(backend, "deadline"):
        backend.deadline = deadline_at         # whole-run cap for live LLMs
    g_backend, guard_models = make_guard_backend(guard_backend, backend)
    if g_backend is not None and getattr(g_backend, "name", "") != "stub":
        g_backend = GuardCallCap(g_backend, MAX_LIVE_GUARD_CALLS)
    if deadline_at is not None and hasattr(g_backend, "deadline"):
        g_backend.deadline = deadline_at
    if g_backend is None:
        guard_label = "heuristic"
    else:
        guard_label = getattr(g_backend, "name", "?") if len(guard_models) <= 1 else f"{g_backend.provider}:{len(guard_models)} models"
    rng = random.Random(seed)
    order, feedback = run_order(m)
    skipped_edges = set(feedback)
    run_preds = {n: [p for p in m.graph.predecessors(n) if (p, n) not in skipped_edges] for n in m.nodes}

    yield {
        "type": "run_start",
        "mode": "defended" if defended else "undefended",
        "backend": getattr(backend, "name", "?"),
        "payload": payload_kind,                # "clean" | "poisoned" | "custom"
        "payload_text": target_text,            # the actual target content read at entry
        "preset": preset_id,                    # PRESETS id, or "custom"
        "canary": canary,
        "order": order,
        "feedback_edges": [{"from": u, "to": v} for u, v in feedback],
        "critical": list(m.critical),
        "guard_backend": guard_label,
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
        preds = run_preds[node]
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
                k=k, backend=g_backend, models=guard_models, rule="any",
                guard_model=guard_model, p0=plan["p0"], rng=rng, canary=canary,
                deadline=deadline_at,
            )
            guard_error, error_kind = False, None
            try:
                if deadline_at is not None and time.monotonic() > deadline_at:
                    raise TimeoutError("run time limit reached")
                block, votes = guards.blocks(upstream)
            except Exception as e:  # noqa: BLE001 - a broken guard must not wave traffic through
                # Fail closed (input is still wiped) but report it as an error, not as
                # a detection: it must never count towards "attack stopped". Votes are
                # None (no usable verdict), never BLOCK.
                block, votes, guard_error = True, [None] * k, True
                error_kind = classify_error(e)
                log.warning("guards at %s failed: %r", node, e)
            if guard_model == "sim":
                used = ["sim"] * k
            elif g_backend is not None:
                used = guards.models_for(k)
            else:
                used = ["stub" if getattr(backend, "name", "") == "stub" else "heuristic"] * k
            yield {
                "type": "guard_vote",
                "node": node,
                "direction": "incoming",
                "votes": votes,            # True = BLOCK, False = PASS, None = not called
                "models": used,
                "blocked": block,
                "checkpoint": node_cps[node],
                "k": k,
                "rule": "any",
                "guard_error": guard_error,
                "error_kind": error_kind,
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
        error_kind = None
        if deadline_at is not None and time.monotonic() > deadline_at:
            out, error, error_kind = f"[{node}] skipped: run time limit", True, "timeout"
        else:
            try:
                out = Agent(node, backend, _role_instr(m, node, bool(preds))).run(agent_input)
                error = False
            except Exception as e:  # noqa: BLE001 - surface to the UI, keep going
                # Only the status code reaches the browser; provider details stay in the server log.
                status = getattr(getattr(e, "response", None), "status_code", None)
                out = f"[{node}] backend error" + (f" (HTTP {status})" if status else f" ({type(e).__name__})")
                log.warning("agent %s backend error: %r", node, e)
                error, error_kind = True, classify_error(e)

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
            "error_kind": error_kind,       # null | rate_limit | timeout | auth | other
            "upstream": preds,
        }

    compromised = [n for n in order if is_compromised(outputs[n], canary)]
    critical_pwned = any(c in compromised for c in m.critical)
    yield {
        "type": "run_end",
        "compromised": compromised,
        "critical": list(m.critical),
        "critical_pwned": critical_pwned,
        "orch_pwned": critical_pwned,       # kept for older consumers
        "rep_pwned": "reporter" in compromised,
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
            print(f"\n  critical agent(s) {ev['critical']} compromised: {ev['critical_pwned']} | "
                  f"all compromised: {ev['compromised']}")
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
