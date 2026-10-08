import pytest

from engine.simulate import p_block, simulate, uniform_blocks


def test_deterministic(manifest):
    blocks = {"A2": 0.5}
    a = simulate(manifest, blocks, n_trials=300, seed=7)
    b = simulate(manifest, blocks, n_trials=300, seed=7)
    assert a == b


def test_no_spread(manifest):
    r = simulate(manifest, {}, n_trials=200, p_spread=0.0)
    assert r["I_w"] == pytest.approx(1.0 / 11.0)
    assert r["mean_infected"] == 1.0
    assert r["p_orch"] == 0.0


def test_full_entry_block(manifest):
    r = simulate(manifest, {"A1": 1.0}, n_trials=200)
    assert r["I_w"] == 0.0 and r["mean_infected"] == 0.0


def test_downstream_block(manifest):
    r = simulate(manifest, {"A2": 1.0}, n_trials=300)
    assert r["mean_infected"] == 1.0
    full = simulate(manifest, {}, n_trials=300, p_spread=1.0)
    assert full["mean_infected"] == 5.0 and full["p_exploit"] == 1.0


def test_helpers():
    assert p_block(0) == 0.0
    assert p_block(1, 0.3) == pytest.approx(0.3)
    b = uniform_blocks([{"A2"}, {"A4"}], {"A1"}, [1, 2, 3], p0=0.5)
    assert b == pytest.approx({"A1": 0.5, "A2": 0.75, "A4": 0.875})
