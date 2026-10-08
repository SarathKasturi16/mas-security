import pytest

from engine.metrics import blast_radius, entry_checkpoint, stas, stas_prime

BAGS = [{"A1", "A2"}, {"A2", "A3", "A4"}, {"A4", "A5"}]


def test_rho(manifest):
    assert blast_radius(manifest, entry_checkpoint(manifest), include_self=True) == pytest.approx(11.0)
    assert blast_radius(manifest, {"A2"}) == pytest.approx(7.5)
    assert blast_radius(manifest, {"A4"}) == pytest.approx(1.0)
    assert blast_radius(manifest, {"A1"}) == pytest.approx(10.0)


def test_stas(manifest):
    assert stas_prime(BAGS, manifest.weights) == pytest.approx(16.0)
    assert stas(BAGS, manifest.weights) == 7.0
