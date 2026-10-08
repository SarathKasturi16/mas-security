"""Live exploit-then-defend demo on the 7-agent pentest MAS.

    python -m demo.run_demo --undefended     # injection cascades to orchestrator
    python -m demo.run_demo --defended        # guard ensemble blocks it at a checkpoint

Backend via --backend or MAS_BACKEND (stub|groq|openrouter|gemini). The stub
backend runs offline and deterministically. Same payload and topology in both
modes; the only difference is whether checkpoints audit the hand-offs.
"""
from __future__ import annotations

import argparse

import networkx as nx

from demo.agents import Agent, make_backend
from demo.guards_live import GuardEnsemble
from demo.target_mock import CANARY, get_target_output, is_compromised
from engine.linearize import decompose
from engine.manifest import load_manifest
from engine.metrics import entry_checkpoint

MANIFEST = "manifests/pentest7_poc.json"


def run(defended: bool, backend_name: str | None, clean: bool = False) -> dict:
    m = load_manifest(MANIFEST)
    d = decompose(m)
    entry = entry_checkpoint(m)
    # Guarded checkpoint nodes = entry (S0) union all separator nodes.
    guarded = set(entry)
    for s in d["separators"]:
        guarded |= set(s)

    backend = make_backend(backend_name)
    # Use genuinely different models per guard where the provider offers them, so
    # the ensemble is heterogeneous (a blind spot in one is not shared by all).
    guard_models: tuple[str, ...] = ()
    if getattr(backend, "provider", None) == "groq":
        guard_models = ("openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b")
    guards = GuardEnsemble(k=3, backend=backend, models=guard_models)
    order = list(nx.topological_sort(m.graph))

    print(f"=== {'DEFENDED' if defended else 'UNDEFENDED'} run "
          f"(backend={getattr(backend, 'name', '?')}, payload={'clean' if clean else 'poisoned'}) ===")
    print(f"checkpoints (guarded nodes): {sorted(guarded)}\n")

    outputs: dict[str, str] = {}
    blocked_at: list[str] = []
    for node in order:
        preds = list(m.graph.predecessors(node))
        if not preds:                                   # entry agent reads the target
            upstream = get_target_output(clean=clean)
        else:
            upstream = "\n".join(outputs[p] for p in preds)

        out = Agent(node, backend).run(upstream)

        note = ""
        if defended and node in guarded:
            block, votes = guards.blocks(out)
            if block:
                out = (f"[{node}] hand-off BLOCKED at checkpoint; ContextWipe applied. "
                       f"Sanitized summary forwarded (no untrusted directives).")
                blocked_at.append(node)
                note = f"  <-- GUARDS BLOCK (votes={votes}) + ContextWipe"
        outputs[node] = out
        flag = "  [CANARY]" if is_compromised(out) else "  [clean]"
        shown = " ".join(out.split())
        if len(shown) > 200:
            shown = shown[:200] + " ..."
        print(f"  {node:>12}:{flag} {shown}{note}")

    orch_out = outputs.get("orchestrator", "")
    rep_out = outputs.get("reporter", "")
    orch_pwned = is_compromised(orch_out)
    rep_pwned = is_compromised(rep_out)
    print(f"\n  orchestrator compromised: {orch_pwned} | reporter compromised: {rep_pwned}")
    if blocked_at:
        print(f"  blocked at: {blocked_at}")
    print()
    return {"orch_pwned": orch_pwned, "rep_pwned": rep_pwned, "blocked_at": blocked_at}


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
