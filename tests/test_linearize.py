import networkx as nx
import pytest

from engine.linearize import (decompose, is_valid_path_decomposition,
                              path_decomposition, separators, triangulate)
from engine.ordering import min_fill_order


def test_fixture(manifest):
    G = manifest.undirected()
    d = decompose(manifest)
    assert is_valid_path_decomposition(G, d["bags"])
    assert len(d["separators"]) == len(d["bags"]) - 1
    assert nx.is_chordal(triangulate(G, d["order"]))


def test_random_graphs():
    checked = 0
    for i in range(200):
        n = 4 + i % 12
        G = nx.gnp_random_graph(n, 0.3, seed=i)
        if G.number_of_nodes() == 0:
            continue
        comp = max(nx.connected_components(G), key=len)
        H = G.subgraph(comp).copy()
        if H.number_of_nodes() == 0:
            continue
        order = min_fill_order(H)
        bags = path_decomposition(H, order)
        assert is_valid_path_decomposition(H, bags), i
        assert nx.is_chordal(triangulate(H, order)), i
        assert len(separators(bags)) == max(len(bags) - 1, 0)
        checked += 1
    assert checked > 100


def test_validator_rejects_bad():
    G = nx.path_graph(3)
    assert not is_valid_path_decomposition(G, [{0, 1}])  # vertex 2 missing
    assert not is_valid_path_decomposition(G, [{0}, {1}, {2}])  # edges uncovered
    assert not is_valid_path_decomposition(G, [{0, 1}, {1, 2}, {0, 2}])  # not contiguous


def test_no_duplicate_separators_pentest7():
    """Regression: path_decomposition must not emit redundant adjacent-subset bags
    nor should the deduped checkpoint list repeat a node set (code-review #1)."""
    from engine.manifest import load_manifest
    m = load_manifest("manifests/pentest7_poc.json")
    d = decompose(m)
    # raw bags: none is a subset of an adjacent bag
    bags = d["bags"]
    for i in range(len(bags) - 1):
        assert not (bags[i] <= bags[i + 1]) and not (bags[i + 1] <= bags[i])
    # deduped checkpoints are pairwise-distinct node sets
    keys = [frozenset(s) for s in d["checkpoints"]]
    assert len(keys) == len(set(keys))
