import networkx as nx
import pytest

from engine import ordering as o

FUNCS = [o.min_fill_order, o.min_degree_order, o.random_order, o.metis_linear_order]


@pytest.mark.parametrize("fn", FUNCS)
def test_permutation_and_deterministic(manifest, fn):
    G = manifest.undirected()
    a = fn(G)
    assert sorted(a) == sorted(G.nodes)
    assert a == fn(G)


def test_metis_on_larger_graph():
    G = nx.gnp_random_graph(30, 0.2, seed=3)
    assert sorted(o.metis_linear_order(G)) == sorted(G.nodes)
