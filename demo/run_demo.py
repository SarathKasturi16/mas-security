"""Live exploit-then-defend demo on the 7-agent pentest MAS.

    python -m demo.run_demo --undefended     # injection cascades to orchestrator
    python -m demo.run_demo --defended        # guard ensemble blocks it at a checkpoint

Backend via --backend or MAS_BACKEND (stub|groq|openrouter|gemini). The stub
backend runs offline and deterministically. Same payload and topology in both
modes; the only difference is whether checkpoints audit the hand-offs.

The pipeline lives in ``iter_run`` as a stream of structured events; both this
CLI and the browser GUI (demo/server.py) consume it, so they never drift.
"""
from __future__ import annotations

import argparse
from collections.abc import Iterator

import networkx as nx

from demo.agents import Agent, make_backend
from demo.guards_live import GuardEnsemble
from demo.target_mock import get_target_output, is_compromised
from engine.linearize import decompose
from engine.manifest import load_manifest
from engine.metrics import entry_checkpoint

MANIFEST = "manifests/pentest7_poc.json"

# Distinct models per guard when the provider offers them (heterogeneous vote).
GROQ_GUARD_MODELS = ("openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b")


def iter_run(
    defended: bool, backend_name: str | None = None, clean: bool = False
) -> Iterator[dict]:
    """Run the pipeline, yielding JSON-safe events as each step happens.

    Events: ``run_start``, ``agent_start``, ``guard_vote`` (defended guarded
    nodes only), ``agent_output``, ``run_end``. The GUI and the CLI both consume
    this so the pipeline logic exists in exactly one place.
    """
    m = load_manifest(MANIFEST)
    d = decompose(m)
    entry = entry_checkpoint(m)
    # Guarded checkpoint nodes = entry (S0) union all separator nodes.
    guarded = set(entry)
    for s in d["separators"]:
        guarded |= set(s)

    backend = make_backend(backend_name)
    guard_models: tuple[str, ...] = ()
    if getattr(backend, "provider", None) == "groq":
        guard_models = GROQ_GUARD_MODELS
    guards = GuardEnsemble(k=3, backend=backend, models=guard_models)
    order = list(nx.topological_sort(m.graph))

    yield {
        "type": "run_start",
        "mode": "defended" if defended else "undefended",
        "backend": getattr(backend, "name", "?"),
        "payload": "clean" if clean else "poisoned",
        "payload_text": get_target_output(clean=clean),  # the actual target content read at entry
        "order": order,
        "guarded": sorted(guarded),
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
            upstream = get_target_output(clean=clean)
        else:
            upstream = "\n".join(outputs[p] for p in preds)

        label = m.graph.nodes[node].get("label", node)
        yield {"type": "agent_start", "node": node, "label": label, "input": upstream}

        # A backend error (e.g. Groq 429 after retries) must not abort the run.
        try:
            out = Agent(node, backend).run(upstream)
            error = False
        except Exception as e:  # noqa: BLE001 - surface to the UI, keep going
            out = f"[{node}] backend error: {type(e).__name__}: {e}"
            error = True

        wiped = False
        if defended and node in guarded and not error:
            block, votes = guards.blocks(out)
            yield {
                "type": "guard_vote",
                "node": node,
                "votes": votes,
                "models": list(guard_models) if guard_models else ["stub"] * guards.k,
                "blocked": block,
            }
            if block:
                out = (f"[{node}] hand-off BLOCKED at checkpoint; ContextWipe applied. "
                       f"Sanitized summary forwarded (no untrusted directives).")
                blocked_at.append(node)
                wiped = True

        outputs[node] = out
        yield {
            "type": "agent_output",
            "node": node,
            "label": label,
            "output": out,
            "compromised": is_compromised(out),
            "wiped": wiped,
            "error": error,
        }

    yield {
        "type": "run_end",
        "orch_pwned": is_compromised(outputs.get("orchestrator", "")),
        "rep_pwned": is_compromised(outputs.get("reporter", "")),
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
