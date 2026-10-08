"""Every shipped manifest must load, be connected, and decompose validly."""
import glob
import os

import networkx as nx
import pytest

from engine.linearize import decompose, is_valid_path_decomposition
from engine.manifest import load_manifest

MANIFESTS = sorted(glob.glob(os.path.join("manifests", "*.json")))


@pytest.mark.parametrize("path", MANIFESTS)
def test_manifest_loads_and_decomposes(path):
    m = load_manifest(path)
    G = m.undirected()
    assert nx.is_connected(G), f"{path}: undirected skeleton not connected"
    for v in m.critical:
        assert v in m.graph, f"{path}: critical {v} not an agent"
    for v in m.entry:
        assert v in m.graph, f"{path}: entry {v} not an agent"
    d = decompose(m)
    assert is_valid_path_decomposition(G, d["bags"]), f"{path}: invalid decomposition"
    keys = [frozenset(s) for s in d["checkpoints"]]
    assert len(keys) == len(set(keys)), f"{path}: duplicate checkpoints"
