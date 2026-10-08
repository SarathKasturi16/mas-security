"""Turn an elimination order into a path decomposition and extract separators."""
from __future__ import annotations

import itertools

import networkx as nx

from engine.ordering import min_fill_order


def triangulate(G: nx.Graph, order: list) -> nx.Graph:
    """Chordal supergraph of ``G`` from the elimination game along ``order``."""
    T = nx.Graph(G)
    H = nx.Graph(G)
    for v in order:
        nbrs = list(H.neighbors(v))
        for a, b in itertools.combinations(nbrs, 2):
            if not H.has_edge(a, b):
                H.add_edge(a, b)
                T.add_edge(a, b)
        H.remove_node(v)
    return T


def path_decomposition(G: nx.Graph, order: list) -> list[set]:
    """Ordered bags forming a valid path decomposition of ``G``.

    Candidate bags are the elimination cliques; they are ordered by elimination
    rank, subset-of-adjacent bags are dropped, and the contiguity property is
    repaired by extending each vertex's bag range from first to last occurrence.
    """
    rank = {v: i for i, v in enumerate(order)}
    T = triangulate(G, order)
    bags: list[set] = []
    for v in sorted(order, key=rank.get):
        bags.append({v} | {u for u in T.neighbors(v) if rank[u] > rank[v]})

    changed = True
    while changed and len(bags) > 1:
        changed = False
        for i in range(len(bags) - 1):
            if bags[i] <= bags[i + 1]:
                del bags[i]
                changed = True
                break
            if bags[i + 1] <= bags[i]:
                del bags[i + 1]
                changed = True
                break

    first: dict = {}
    last: dict = {}
    for i, bag in enumerate(bags):
        for v in bag:
            first.setdefault(v, i)
            last[v] = i
    for v in first:
        for i in range(first[v], last[v] + 1):
            bags[i].add(v)
    return bags


def separators(bags: list[set]) -> list[set]:
    """Separators ``S_i = bags[i] & bags[i+1]`` for consecutive bags."""
    return [set(bags[i] & bags[i + 1]) for i in range(len(bags) - 1)]


def is_valid_path_decomposition(G: nx.Graph, bags: list[set]) -> bool:
    """Check vertex coverage, edge coverage and contiguity of ``bags`` for ``G``."""
    covered = set().union(*bags) if bags else set()
    if set(G.nodes) - covered:
        return False
    for u, v in G.edges:
        if not any(u in b and v in b for b in bags):
            return False
    for v in G.nodes:
        idx = [i for i, b in enumerate(bags) if v in b]
        if idx and idx[-1] - idx[0] + 1 != len(idx):
            return False
    return True


def decompose(manifest) -> dict:
    """Min-fill path decomposition of a manifest: order, bags, separators."""
    G = manifest.undirected()
    order = min_fill_order(G)
    bags = path_decomposition(G, order)
    return {"order": order, "bags": bags, "separators": separators(bags)}
