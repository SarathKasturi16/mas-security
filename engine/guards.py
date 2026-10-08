"""Closed-form Byzantine-robust k-of-n majority vote (no simulation)."""
from __future__ import annotations

from math import comb


def p_block_ensemble(k: int, p: float, f: int = 0) -> float:
    """P(majority of ``k`` guards vote BLOCK) with ``f`` Byzantine always-PASS guards.

    The ``k - f`` honest guards block independently with probability ``p``;
    the majority threshold is ``t = k // 2 + 1``. Returns 0.0 if ``k - f < t``.
    """
    t = k // 2 + 1
    h = k - f
    if h < t:
        return 0.0
    return float(sum(comb(h, i) * p**i * (1 - p) ** (h - i) for i in range(t, h + 1)))
