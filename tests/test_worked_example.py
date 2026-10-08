"""HEADLINE TEST: slides 12/13 worked example end to end.

Geometry note: on a pure chain min-fill gives 4 two-node bags
({A1,A2},{A2,A3},{A3,A4},{A4,A5}) with separators {A2},{A3},{A4}, not the
slide's 3 bags. The slide decomposition {A1,A2},{A2,A3,A4},{A4,A5} is a valid
path decomposition too (asserted below), so the checkpoint node-sets are built
from ITS separators via the real ``separators()``. rho and the allocations come
from the real metrics/allocate functions.
"""
import pytest

from engine.allocate import risk_prioritized, uniform
from engine.linearize import decompose, is_valid_path_decomposition, separators
from engine.metrics import blast_radius, entry_checkpoint

SLIDE_BAGS = [{"A1", "A2"}, {"A2", "A3", "A4"}, {"A4", "A5"}]


def test_headline(manifest):
    assert is_valid_path_decomposition(manifest.undirected(), SLIDE_BAGS)
    assert is_valid_path_decomposition(manifest.undirected(), decompose(manifest)["bags"])

    seps = separators(SLIDE_BAGS)
    assert seps == [{"A2"}, {"A4"}]
    cps = [entry_checkpoint(manifest)] + seps
    rhos = [blast_radius(manifest, cp, include_self=(i == 0)) for i, cp in enumerate(cps)]
    assert rhos == pytest.approx([11.0, 7.5, 1.0])

    risk = risk_prioritized(rhos, manifest.budget)
    assert [round(x, 2) for x in risk] == [5.64, 3.85, 0.51]
    assert sum(risk) == pytest.approx(10.0)
    assert [round(x, 2) for x in uniform(rhos, manifest.budget)] == [3.33] * 3
