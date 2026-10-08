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

    _prune_adjacent_subsets(bags)

    # Repair contiguity: extend each vertex over its first..last occurrence range.
    first: dict = {}
    last: dict = {}
    for i, bag in enumerate(bags):
        for v in bag:
            first.setdefault(v, i)
            last[v] = i
    for v in first:
        for i in range(first[v], last[v] + 1):
            bags[i].add(v)

    # The repair can re-introduce adjacent subsets (and duplicate bags), which
    # would inflate the checkpoint count and create duplicate separators. Prune
    # again to a non-redundant path decomposition. Removing a bag that is a
    # subset of its neighbour preserves coverage and contiguity.
    _prune_adjacent_subsets(bags)
    return bags


def _prune_adjacent_subsets(bags: list[set]) -> None:
    """Drop any bag that is a subset of an adjacent bag, in place, to fixpoint."""
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


def dedup_separators(seps: list[set]) -> list[set]:
    """Collapse separators that are the same vertex set to distinct checkpoints.

    Two cuts at different path positions can have an identical node set — the
    same agents. Auditing that set once suffices, so for budget allocation the
    checkpoint unit is the distinct separator node set (first occurrence kept).
    """
    out: list[set] = []
    seen: set[frozenset] = set()
    for s in seps:
        key = frozenset(s)
        if key not in seen:
            seen.add(key)
            out.append(set(s))
    return out


def decompose(manifest) -> dict:
    """Min-fill path decomposition of a manifest: order, bags, separators.

    ``separators`` is the raw per-adjacent-pair list (may repeat a node set);
    ``checkpoints`` is the de-duplicated list used as the allocation unit.
    """
    G = manifest.undirected()
    order = min_fill_order(G)
    bags = path_decomposition(G, order)
    seps = separators(bags)
    return {"order": order, "bags": bags, "separators": seps,
            "checkpoints": dedup_separators(seps)}
