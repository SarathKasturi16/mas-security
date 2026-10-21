"""One-command smoke run: every manifest x {none, uniform, risk} defense.

For each manifest it decomposes the graph, allocates the budget two ways, and
runs the Monte-Carlo cascade. Prints I_w, P(exploit), P(orch) and audit spend so
you can eyeball that (a) checkpoints cut infection and (b) uniform and risk spend
the SAME budget B. This is a sanity harness, not the Review-2 experiment (no CIs).
"""
from __future__ import annotations

from pathlib import Path

from engine.allocate import risk_prioritized, uniform
from engine.linearize import decompose
from engine.manifest import load_manifest
from engine.metrics import blast_radius, entry_checkpoint
from engine.simulate import simulate, uniform_blocks

MANIFEST_DIR = Path(__file__).resolve().parent.parent / "manifests"
MANIFESTS = ["worked_example_5agent", "pentest7_poc"]
# mapta / xoffense added once Teammate A lands those manifests.
for extra in ("mapta", "xoffense"):
    if (MANIFEST_DIR / f"{extra}.json").exists():
        MANIFESTS.append(extra)

from engine.pipeline import N_TRIALS, P_SPREAD, SEED  # noqa: E402 - one source for the GUI too


def checkpoints_and_rhos(m):
    """Return (checkpoint node-sets [S0, S1, ...], rho per checkpoint).

    Uses the de-duplicated ``checkpoints`` (distinct separator node sets) so the
    budget is matched over distinct audit sites, not over repeated ones.
    """
    d = decompose(m)
    s0 = entry_checkpoint(m)
    seps = d["checkpoints"]
    cps = [s0] + [set(s) for s in seps]
    rhos = [blast_radius(m, s0, include_self=True)]
    rhos += [blast_radius(m, s, include_self=False) for s in seps]
    return cps, rhos


def main() -> None:
    print(f"{'manifest':<22}{'defense':<10}{'I_w':>8}{'P(expl)':>9}{'P(orch)':>9}{'spend':>8}")
    print("-" * 66)
    for name in MANIFESTS:
        m = load_manifest(MANIFEST_DIR / f"{name}.json")
        cps, rhos = checkpoints_and_rhos(m)
        B = m.budget
        seps = cps[1:]

        rows = {
            "none": {},
            "uniform": uniform_blocks(seps, cps[0], uniform(rhos, B)),
            "risk": uniform_blocks(seps, cps[0], risk_prioritized(rhos, B)),
        }
        spend = {"none": 0.0, "uniform": sum(uniform(rhos, B)),
                 "risk": sum(risk_prioritized(rhos, B))}
        for defense, blocks in rows.items():
            r = simulate(m, blocks, n_trials=N_TRIALS, p_spread=P_SPREAD, seed=SEED)
            print(f"{name:<22}{defense:<10}{r['I_w']:>8.3f}{r['p_exploit']:>9.3f}"
                  f"{r['p_orch']:>9.3f}{spend[defense]:>8.2f}")
        print()


if __name__ == "__main__":
    main()
