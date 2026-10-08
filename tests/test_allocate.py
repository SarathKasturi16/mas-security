import pytest

from engine.allocate import risk_prioritized, uniform

RHOS = [11.0, 7.5, 1.0]


def test_sums():
    assert abs(sum(uniform(RHOS, 10)) - 10) < 1e-9
    assert abs(sum(risk_prioritized(RHOS, 10)) - 10) < 1e-9


def test_values():
    assert risk_prioritized(RHOS, 10) == pytest.approx([5.641, 3.846, 0.513], abs=1e-2)
    assert uniform(RHOS, 10) == pytest.approx([10 / 3] * 3)


def test_cap():
    q = risk_prioritized(RHOS, 10, q_max=5.0)
    assert abs(sum(q) - 10) < 1e-9
    assert max(q) <= 5.0 + 1e-9
    assert q[0] == pytest.approx(5.0)


def test_cap_cascade_and_infeasible():
    q = risk_prioritized([10, 5, 1, 1], 10, q_max=4.0)
    assert abs(sum(q) - 10) < 1e-9 and max(q) <= 4.0 + 1e-9
    with pytest.raises(ValueError):
        risk_prioritized(RHOS, 20, q_max=5.0)
