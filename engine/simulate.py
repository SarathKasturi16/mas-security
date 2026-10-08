"""Monte-Carlo independent-cascade simulation of injection propagation."""
from __future__ import annotations

import numpy as np


def p_block(q: float, p0: float = 0.3) -> float:
    """Per-crossing block probability ``1 - (1 - p0)**q``.

    Modelling assumption: audit strength ``q`` at a checkpoint converts to
    ``q`` independent unit audits each catching with base rate ``p0`` (swept later).
    """
    return 1.0 - (1.0 - p0) ** q


def uniform_blocks(
    separators: list[set], entry: set, q_list: list[float], p0: float = 0.3
) -> dict[str, float]:
    """Map checkpoint nodes to ``p_block(q)``.

    ``q_list`` is ordered ``[q(S0=entry), q(S1), ...]`` (length
    ``len(separators) + 1``). Every node of a multi-node checkpoint gets that
    checkpoint's block probability; a node in several checkpoints keeps the max.
    """
    cps = [set(entry)] + [set(s) for s in separators]
    if len(q_list) != len(cps):
        raise ValueError("q_list must have one entry for S0 plus one per separator")
    blocks: dict[str, float] = {}
    for cp, q in zip(cps, q_list):
        pb = p_block(q, p0)
        for v in cp:
            blocks[v] = max(blocks.get(v, 0.0), pb)
    return blocks


def simulate(
    manifest,
    checkpoint_block: dict[str, float],
    n_trials: int = 2000,
    p_spread: float = 0.7,
    seed: int = 0,
) -> dict:
    """Independent-cascade Monte-Carlo on the directed graph.

    Each trial picks a uniform random entry agent. The injection reaches it
    through its checkpoint if guarded (a Bernoulli block ends the trial with
    nothing infected). Then each infected u tries each out-edge to a clean v
    with prob ``p_spread``; a guarded v blocks with ``checkpoint_block[v]``
    (the path stops, ContextWipe). Runs to a fixed point. Deterministic per seed.
    """
    rng = np.random.default_rng(seed)
    g = manifest.graph
    nodes = list(g.nodes)
    idx = {v: i for i, v in enumerate(nodes)}
    n = len(nodes)
    edges = [(idx[u], idx[v]) for u, v in g.edges]
    m = len(edges)
    out: list[list[tuple[int, int]]] = [[] for _ in range(n)]
    for e, (u, v) in enumerate(edges):
        out[u].append((e, v))

    w = np.array([manifest.weight(v) for v in nodes], dtype=float)
    total_w = float(w.sum())
    block = np.array([checkpoint_block.get(v, 0.0) for v in nodes], dtype=float)
    shell = np.array([("shell" in g.nodes[v].get("caps", [])) for v in nodes])
    orch = np.array(
        [
            ("rchestr" in str(g.nodes[v].get("label", ""))) or v == "orchestrator"
            for v in nodes
        ]
    )
    entry = [idx[v] for v in manifest.entry]
    if not entry:
        raise ValueError("manifest has no entry agents")

    # Vectorised RNG draws for all trials up front.
    entry_pick = rng.integers(0, len(entry), size=n_trials)
    inject_u = rng.random(n_trials)
    spread_u = rng.random((n_trials, m))
    block_u = rng.random((n_trials, m))

    iw_sum = 0.0
    exploit = orch_hit = 0
    count_sum = 0
    for t in range(n_trials):
        s = entry[entry_pick[t]]
        infected = np.zeros(n, dtype=bool)
        if inject_u[t] >= block[s]:
            infected[s] = True
            stack = [s]
            while stack:
                u = stack.pop()
                for e, v in out[u]:
                    if infected[v] or spread_u[t, e] >= p_spread:
                        continue
                    if block_u[t, e] < block[v]:
                        continue
                    infected[v] = True
                    stack.append(v)
        iw_sum += float(w[infected].sum()) / total_w
        count_sum += int(infected.sum())
        exploit += bool(shell[infected].any())
        orch_hit += bool(orch[infected].any())

    return {
        "I_w": iw_sum / n_trials,
        "p_exploit": exploit / n_trials,
        "p_orch": orch_hit / n_trials,
        "mean_infected": count_sum / n_trials,
    }
