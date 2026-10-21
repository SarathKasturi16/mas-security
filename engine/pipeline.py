"""One JSON "plan" for a manifest: the exact pipeline the Monte-Carlo uses.

``build_plan`` runs manifest -> min-fill path decomposition -> separators ->
blast radius -> budget allocation (uniform and risk-prioritised) -> whole-guard
counts -> (optionally) the Monte-Carlo simulation, and returns everything as a
JSON-serialisable dict. The live demo and the animated browser explainer both
consume it, so they cannot drift from ``experiments/run_smoke.py``.
"""
from __future__ import annotations

import math
from pathlib import Path

from engine.allocate import risk_prioritized, uniform
from engine.linearize import decompose
from engine.manifest import CAP_WEIGHTS, Manifest, load_manifest
from engine.metrics import blast_radius, downstream_set, entry_checkpoint
from engine.simulate import p_block, simulate, uniform_blocks

# Shared with experiments/run_smoke.py so the GUI's results chart shows exactly the
# report's numbers.
P_SPREAD = 0.7
SEED = 7
N_TRIALS = 4000
ALLOCS = ("risk", "uniform")

_SIM_CACHE: dict[tuple, dict] = {}


def guard_counts(q: list[float], B: int) -> list[int]:
    """Round fractional audit strengths ``q`` to whole guards summing to ``B``.

    One budget unit = one guard. Floor each q, bump any 0 to 1, then fix the
    total: if short, repeatedly give one guard to the checkpoint furthest below
    its share (largest ``q - g``; ties -> lower index) -- measuring the shortfall
    against the current count, so a checkpoint already bumped from 0 to 1 is not
    rewarded again; if over (caused by the bumps), remove one from the
    checkpoint holding the most guards (>1; ties -> lower q, then lower index).
    Deterministic. Raises ``ValueError`` if ``B < len(q)``.
    """
    n = len(q)
    if n == 0:
        raise ValueError("no checkpoints")
    if B < n:
        raise ValueError(f"budget {B} is smaller than the number of checkpoints {n}")
    g = [max(1, int(math.floor(x + 1e-9))) for x in q]
    while sum(g) < B:
        i = max(range(n), key=lambda j: (q[j] - g[j], -j))
        g[i] += 1
    while sum(g) > B:
        cand = [i for i in range(n) if g[i] > 1]
        i = max(cand, key=lambda j: (g[j], -q[j], -j))
        g[i] -= 1
    assert sum(g) == B and all(x >= 1 for x in g)
    return g


def _manifest_key(m: Manifest, budget: int, p0: float, trials: int) -> tuple:
    return (
        m.name, tuple(sorted(m.graph.edges)), tuple(m.entry), tuple(m.critical),
        tuple(sorted(m.weights.items())), budget, p0, trials,
    )


def _sim_all(m: Manifest, cps, rhos, qs: dict, budget: int, p0: float, trials: int) -> dict:
    key = _manifest_key(m, budget, p0, trials)
    if key in _SIM_CACHE:
        return _SIM_CACHE[key]
    seps = cps[1:]
    rows = {
        "none": {},
        "uniform": uniform_blocks(seps, cps[0], qs["uniform"], p0),
        "risk": uniform_blocks(seps, cps[0], qs["risk"], p0),
    }
    out = {}
    for name, blocks in rows.items():
        r = simulate(m, blocks, n_trials=trials, p_spread=P_SPREAD, seed=SEED)
        out[name] = {k: r[k] for k in ("I_w", "p_orch", "p_exploit")}
    _SIM_CACHE[key] = out
    return out


def build_plan(
    manifest_or_path,
    budget: int | None = None,
    alloc: str = "risk",
    p0: float = 0.3,
    sim_trials: int = N_TRIALS,
    with_sim: bool = True,
) -> dict:
    """Build the full JSON-serialisable plan (see module docstring)."""
    if alloc not in ALLOCS:
        raise ValueError(f"alloc must be one of {ALLOCS}, got {alloc!r}")
    if isinstance(manifest_or_path, Manifest):
        m = manifest_or_path
        name = m.name
    else:
        path = Path(manifest_or_path)
        m = load_manifest(path)
        name = path.stem
    B = int(m.budget) if budget is None else int(budget)

    d = decompose(m)
    bags = d["bags"]
    seps_raw = d["separators"]
    seps = d["checkpoints"]
    s0 = entry_checkpoint(m)
    cps = [s0] + [set(s) for s in seps]
    rho = [_rho(m, s0, True)] + [_rho(m, s, False) for s in seps]
    if B < len(cps):
        raise ValueError(f"budget {B} is smaller than the number of checkpoints {len(cps)}")

    q_uni = uniform(rho, B)
    q_risk = risk_prioritized(rho, B)
    q_sel = q_risk if alloc == "risk" else q_uni
    g_uni = guard_counts(q_uni, B)
    g_risk = guard_counts(q_risk, B)
    g_sel = g_risk if alloc == "risk" else g_uni

    boundaries = [-1]
    for s in seps:
        boundaries.append(next(i for i, r in enumerate(seps_raw) if set(r) == set(s)))

    checkpoints = []
    for i, cp in enumerate(cps):
        checkpoints.append({
            "id": f"S{i}",
            "nodes": sorted(cp),
            "boundary": boundaries[i],
            "downstream": sorted(downstream_set(m, cp, include_self=(i == 0))),
            "rho": rho[i],
            "q_uniform": q_uni[i],
            "q_risk": q_risk[i],
            "q": q_sel[i],
            "guards": g_sel[i],
            "guards_uniform": g_uni[i],
            "guards_risk": g_risk[i],
            "p_block": p_block(g_sel[i], p0),
            "p_block_q": p_block(q_sel[i], p0),
        })

    node_spans = {}
    for v in m.nodes:
        idx = [i for i, b in enumerate(bags) if v in b]
        assert idx and idx[-1] - idx[0] + 1 == len(idx), f"non-contiguous span for {v}"
        node_spans[v] = [idx[0], idx[-1]]

    node_guards = {v: 0 for v in m.nodes}
    for c in checkpoints:
        for v in c["nodes"]:
            node_guards[v] = max(node_guards[v], c["guards"])

    nodes = []
    for v in m.nodes:
        caps = list(m.graph.nodes[v].get("caps", []))
        nodes.append({
            "id": v,
            "label": m.graph.nodes[v].get("label", v),
            "caps": caps,
            "cap_breakdown": [{"cap": c, "points": CAP_WEIGHTS[c]} for c in caps],
            "weight": m.weight(v),
            "entry": v in m.entry,
            "critical": v in m.critical,
        })

    plan = {
        "manifest": name,
        "title": m.description or m.name,
        "budget": B,
        "alloc": alloc,
        "p0": p0,
        "nodes": nodes,
        "edges": [{"from": u, "to": v} for u, v in m.graph.edges],
        "elimination_order": list(d["order"]),
        "bags": [sorted(b) for b in bags],
        "node_spans": node_spans,
        "checkpoints": checkpoints,
        "node_guards": node_guards,
    }
    if with_sim:
        plan["sim"] = _sim_all(m, cps, rho, {"uniform": q_uni, "risk": q_risk}, B, p0, sim_trials)
    return plan


def _rho(m: Manifest, cp: set, include_self: bool) -> float:
    return blast_radius(m, cp, include_self=include_self)
