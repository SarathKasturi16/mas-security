"""Elimination orderings over the undirected skeleton of an agent graph.

All orderings are deterministic (ties broken by lowest vertex id) and written
from scratch so the ordering itself is visible (``nx.treewidth_min_fill_in``
hides it).

DEVIATION NOTE: ``metis_linear_order`` uses ``pymetis`` recursive bisection.
If pymetis raises for any reason it falls back to
``networkx.algorithms.community.kernighan_lin_bisection``; that fallback is a
flagged deviation from the METIS baseline (see ``METIS_FALLBACK_USED``).
"""
from __future__ import annotations

import itertools
import random

import networkx as nx

# Set to True the first time metis_linear_order has to use the KL fallback.
METIS_FALLBACK_USED: bool = False


def _sorted(nodes) -> list:
    """Deterministically sort vertices (natural order, falling back to ``str``)."""
    nodes = list(nodes)
    try:
        return sorted(nodes)
    except TypeError:
        return sorted(nodes, key=str)


def _fill_count(H: nx.Graph, v) -> int:
    """Number of fill edges created by eliminating ``v`` from ``H``."""
    nbrs = list(H.neighbors(v))
    return sum(1 for a, b in itertools.combinations(nbrs, 2) if not H.has_edge(a, b))


def _greedy_order(G: nx.Graph, score) -> list:
    """Generic greedy elimination: repeatedly eliminate the min-``score`` vertex."""
    H = nx.Graph(G)
    order: list = []
    while H.number_of_nodes():
        # Sorted candidates + strict ``<`` => lowest id wins ties.
        best, best_s = None, None
        for v in _sorted(H.nodes):
            s = score(H, v)
            if best_s is None or s < best_s:
                best, best_s = v, s
        nbrs = list(H.neighbors(best))
        H.add_edges_from(itertools.combinations(nbrs, 2))
        H.remove_node(best)
        order.append(best)
    return order


def min_fill_order(G: nx.Graph) -> list:
    """Greedy min-fill elimination order (first eliminated first)."""
    return _greedy_order(G, _fill_count)


def min_degree_order(G: nx.Graph) -> list:
    """Greedy min-degree elimination order (first eliminated first)."""
    return _greedy_order(G, lambda H, v: H.degree(v))


def random_order(G: nx.Graph, seed: int = 0) -> list:
    """Seeded random permutation of the nodes of ``G``."""
    nodes = _sorted(G.nodes)
    random.Random(seed).shuffle(nodes)
    return nodes


def _bisect(G: nx.Graph, nodes: list) -> tuple[list, list]:
    """Split ``nodes`` in two with pymetis, falling back to Kernighan-Lin."""
    global METIS_FALLBACK_USED
    try:
        import pymetis

        idx = {v: i for i, v in enumerate(nodes)}
        adjacency = [
            sorted(idx[u] for u in G.neighbors(v) if u in idx) for v in nodes
        ]
        _, parts = pymetis.part_graph(2, adjacency=adjacency)
        a = [v for v, p in zip(nodes, parts) if p == 0]
        b = [v for v, p in zip(nodes, parts) if p != 0]
        if not a or not b:
            raise RuntimeError("degenerate metis partition")
        return a, b
    except Exception:
        METIS_FALLBACK_USED = True
        sub = G.subgraph(nodes)
        a, b = nx.algorithms.community.kernighan_lin_bisection(sub, seed=0)
        return _sorted(a), _sorted(b)


def metis_linear_order(G: nx.Graph) -> list:
    """Linear ordering by recursive METIS bisection (KL fallback on failure)."""

    def rec(nodes: list) -> list:
        if len(nodes) <= 2:
            return _sorted(nodes)
        a, b = _bisect(G, nodes)
        return rec(_sorted(a)) + rec(_sorted(b))

    return rec(_sorted(G.nodes))
