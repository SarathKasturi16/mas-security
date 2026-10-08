import pytest

from engine.guards import p_block_ensemble


@pytest.mark.parametrize(
    "k,p,f,expected",
    [(5, 0.6, 1, 0.4752), (5, 0.77, 1, 0.7715), (1, 0.6, 1, 0.0),
     (3, 0.6, 0, 0.648), (5, 0.6, 0, 0.6826)],
)
def test_anchors(k, p, f, expected):
    assert p_block_ensemble(k, p, f) == pytest.approx(expected, rel=1e-3, abs=1e-3)
