"""Directed reachability and blast-radius metrics on ``manifest.graph``."""
from __future__ import annotations

import networkx as nx


def stas(bags: list[set], weights: dict) -> float:
    """Plain STAS: sum of bag sizes (weight identically 1)."""
    return float(sum(len(b) for b in bags))


def stas_prime(bags: list[set], weights: dict) -> float:
    """Weighted STAS': sum over bags of the weights of their vertices."""
    return float(sum(weights[v] for b in bags for v in b))


def entry_checkpoint(manifest) -> set:
    """The S0 checkpoint: the set of entry agents."""
    return set(manifest.entry)


def blast_radius(manifest, checkpoint_nodes: set, include_self: bool = False) -> float:
    """Blast radius rho of a checkpoint: weight of the residual reachable set.

    The residual set is the union of ``nx.descendants`` over the checkpoint
    nodes, excluding the checkpoint nodes themselves. With ``include_self=True``
    the checkpoint nodes' own weight is added. Convention: use
    ``include_self=True`` for the entry checkpoint S0 (so rho(S0) is the whole
    reachable closure, 11.0 in the worked example) and ``False`` for separators.
    """
    cp = set(checkpoint_nodes)
    reach: set = set()
    for v in cp:
        reach |= nx.descendants(manifest.graph, v)
    reach -= cp
    if include_self:
        reach |= cp
    return float(sum(manifest.weight(v) for v in reach))
