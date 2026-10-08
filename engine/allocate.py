"""Split a fixed audit budget B across checkpoints (both allocators spend exactly B)."""
from __future__ import annotations


def uniform(rhos: list[float], B: float) -> list[float]:
    """Equal split of ``B`` across ``len(rhos)`` checkpoints."""
    n = len(rhos)
    if n == 0:
        raise ValueError("no checkpoints to allocate to")
    q = [B / n] * n
    assert abs(sum(q) - B) < 1e-9
    return q


def risk_prioritized(
    rhos: list[float], B: float, q_max: float = float("inf")
) -> list[float]:
    """Allocate ``q_i`` proportional to ``rho_i``, capped at ``q_max`` (water-filling).

    Over-cap checkpoints are pinned at ``q_max`` and the leftover budget is
    re-split among the uncapped ones by ``rho`` until none exceeds the cap.
    Raises ``ValueError`` if infeasible (``B > q_max * n``).
    """
    n = len(rhos)
    if n == 0:
        raise ValueError("no checkpoints to allocate to")
    if any(r < 0 for r in rhos):
        raise ValueError("blast radii (rhos) must be non-negative")
    if B > q_max * n + 1e-12:
        raise ValueError(f"infeasible: B={B} exceeds q_max*n={q_max * n}")
    q = [0.0] * n
    active = list(range(n))
    remaining = float(B)
    while active:
        total = sum(rhos[i] for i in active)
        if total > 0:
            prop = {i: remaining * rhos[i] / total for i in active}
        else:
            prop = {i: remaining / len(active) for i in active}
        over = [i for i in active if prop[i] > q_max]
        if not over:
            for i in active:
                q[i] = prop[i]
            break
        for i in over:
            q[i] = q_max
            remaining -= q_max
        active = [i for i in active if i not in over]
    assert abs(sum(q) - B) < 1e-9, (sum(q), B)
    return q
