"""engine.pipeline.build_plan / guard_counts, the /api endpoints, and iter_run wiring."""
import json
import random
from pathlib import Path

import pytest

from demo.guards_live import GuardEnsemble
from demo.run_demo import iter_run
from demo.server import app
from engine.linearize import decompose
from engine.manifest import load_manifest
from engine.pipeline import build_plan, guard_counts

MANIFESTS = Path(__file__).resolve().parent.parent / "manifests"
PENTEST = MANIFESTS / "pentest7_poc.json"
ALL = sorted(MANIFESTS.glob("*.json"))


# ---- guard_counts -------------------------------------------------------
def test_guard_counts_examples():
    assert guard_counts([6.049, 1.358, 2.593], 10) == [6, 1, 3]
    assert guard_counts([10 / 3] * 3, 10) == [4, 3, 3]
    # a checkpoint bumped from 0 to 1 must not also win the leftover guard
    assert guard_counts([3.63, 0.81, 1.56], 6) == [4, 1, 1]


def test_guard_counts_monotone_in_rho_all_manifests():
    # risk split: a riskier checkpoint never gets fewer guards than a less risky one
    for path in ALL:
        m = load_manifest(path)
        n = len(build_plan(m, budget=30, with_sim=False)["checkpoints"])
        for B in range(max(3, n), 31):
            cps = build_plan(m, budget=B, alloc="risk", with_sim=False)["checkpoints"]
            for a in cps:
                for b in cps:
                    if a["rho"] > b["rho"]:
                        assert a["guards"] >= b["guards"], (path.stem, B, a["id"], b["id"])


@pytest.mark.parametrize("q,B", [
    ([6.049, 1.358, 2.593], 10), ([0.2, 0.2, 9.6], 10), ([0.1, 0.1, 0.1, 9.7], 10),
    ([5.0, 5.0], 10), ([2.5] * 4, 10), ([1.0], 3),
])
def test_guard_counts_properties(q, B):
    g = guard_counts(q, B)
    assert sum(g) == B and all(x >= 1 for x in g)
    assert g == guard_counts(q, B)  # deterministic


def test_guard_counts_budget_too_small():
    with pytest.raises(ValueError):
        guard_counts([1.0, 1.0, 1.0], 2)


# ---- build_plan ---------------------------------------------------------
def test_pentest7_values():
    p = build_plan(PENTEST, budget=10)
    cps = p["checkpoints"]
    assert [c["id"] for c in cps] == ["S0", "S1", "S2"]
    assert [c["rho"] for c in cps] == pytest.approx([24.5, 5.5, 10.5])
    assert [c["q_risk"] for c in cps] == pytest.approx([6.049, 1.358, 2.593], abs=1e-3)
    assert [c["guards_risk"] for c in cps] == [6, 1, 3]
    assert [c["guards_uniform"] for c in cps] == [4, 3, 3]
    assert [c["guards"] for c in cps] == [6, 1, 3]  # alloc="risk" default
    assert cps[0]["boundary"] == -1
    assert set(p["sim"]) == {"none", "uniform", "risk"}
    assert p["sim"]["risk"]["I_w"] < p["sim"]["none"]["I_w"]
    assert build_plan(PENTEST, alloc="uniform")["checkpoints"][0]["guards"] == 4


@pytest.mark.parametrize("path", ALL, ids=lambda p: p.stem)
def test_all_manifests_build(path):
    p = build_plan(path, sim_trials=200)
    json.dumps(p)
    m = load_manifest(path)
    d = decompose(m)
    assert p["bags"] == [sorted(b) for b in d["bags"]]
    assert [c["nodes"] for c in p["checkpoints"][1:]] == [sorted(s) for s in d["checkpoints"]]
    assert p["checkpoints"][0]["nodes"] == sorted(m.entry)
    assert sum(c["guards"] for c in p["checkpoints"]) == p["budget"]
    # spans: every node covered, contiguous, and consistent with bag membership
    for v in m.nodes:
        a, b = p["node_spans"][v]
        assert [i for i, bag in enumerate(p["bags"]) if v in bag] == list(range(a, b + 1))
    # guarded set == entry U separator nodes
    expected = set(m.entry)
    for s in d["separators"]:
        expected |= set(s)
    assert {v for v, k in p["node_guards"].items() if k > 0} == expected


def test_build_plan_validation():
    with pytest.raises(ValueError):
        build_plan(PENTEST, alloc="nope")
    with pytest.raises(ValueError):
        build_plan(PENTEST, budget=2)


# ---- GuardEnsemble ------------------------------------------------------
def test_guard_ensemble_rules_and_sim():
    mal = "[[PWNED:exfil-creds]]"
    assert GuardEnsemble(k=7, rule="any").blocks(mal)[0] is True
    assert len(GuardEnsemble(k=7).blocks(mal)[1]) == 7
    assert GuardEnsemble(k=5, rule="any").blocks("benign text")[0] is False
    # sim guard never fires on benign text, and fires on malicious at ~p0
    sim = GuardEnsemble(k=1, rule="any", guard_model="sim", p0=0.3, rng=random.Random(1))
    assert not any(sim.blocks("benign")[0] for _ in range(50))
    rate = sum(sim.blocks(mal)[0] for _ in range(2000)) / 2000
    assert 0.25 < rate < 0.35


# ---- iter_run -----------------------------------------------------------
def test_iter_run_defended_risk_votes_match_plan():
    evs = list(iter_run(defended=True, backend_name="stub", alloc="risk"))
    plan = evs[0]["plan"]
    assert "sim" not in plan
    assert evs[0]["alloc"] == "risk" and evs[0]["budget"] == 10
    votes = [e for e in evs if e["type"] == "guard_vote"]
    assert votes
    for e in votes:
        assert e["k"] == plan["node_guards"][e["node"]] == len(e["votes"])
        assert e["rule"] == "any" and e["checkpoint"]
    assert {e["node"] for e in votes} == set(evs[0]["guarded"])
    outs = [e for e in evs if e["type"] == "agent_output"]
    assert all("upstream" in e for e in outs)
    assert next(e for e in outs if e["node"] == "orchestrator")["upstream"] == ["analysis", "exploit"]


def test_iter_run_sim_guard_deterministic_per_seed():
    def blocked(seed):
        evs = iter_run(defended=True, backend_name="stub", guard_model="sim", seed=seed)
        return [e["votes"] for e in evs if e["type"] == "guard_vote"]
    assert blocked(3) == blocked(3)


# ---- server -------------------------------------------------------------
class _LoopbackClient:
    """Test client that addresses the server the way a browser on this machine does."""

    def __init__(self, base_url="http://127.0.0.1:8770"):
        self._c, self._base = app.test_client(), base_url

    def get(self, *a, **kw):
        kw.setdefault("base_url", self._base)
        return self._c.get(*a, **kw)


@pytest.fixture
def client():
    return _LoopbackClient()


def test_api_plan_ok(client):
    r = client.get("/api/plan?manifest=pentest7_poc&budget=10&alloc=uniform")
    assert r.status_code == 200
    j = r.get_json()
    assert j["alloc"] == "uniform" and [c["guards"] for c in j["checkpoints"]] == [4, 3, 3]
    assert "sim" in j
    assert client.get("/api/plan").status_code == 200


@pytest.mark.parametrize("qs", [
    "manifest=../etc/passwd", "manifest=nope", "budget=abc", "budget=2", "budget=999",
    "alloc=bogus", "manifest=worked_example_5agent&budget=3",  # < number of checkpoints
])
def test_api_plan_bad(client, qs):
    r = client.get(f"/api/plan?{qs}")
    assert r.status_code == 400 and "error" in r.get_json()


def test_api_manifests(client):
    j = client.get("/api/manifests").get_json()
    assert {m["id"] for m in j} == {p.stem for p in ALL}
    assert all(m["nodes"] > 0 and m["title"] for m in j)


@pytest.mark.parametrize("qs", ["alloc=bad", "guard_model=x", "budget=1", "seed=-1", "seed=abc",
                                "backend=openrouter", "mode=evil"])
def test_api_run_bad(client, qs):
    assert client.get(f"/api/run?{qs}").status_code == 400


def test_api_run_live_budget_capped(client):
    # paid backends are capped at LIVE_BUDGET_MAX guards; rejected before any LLM call
    assert client.get("/api/run?mode=defended&backend=groq&budget=7").status_code == 400


def test_live_kill_switch_when_hosted(client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("MAS_ALLOW_LIVE", raising=False)
    assert client.get("/api/run?mode=defended&backend=groq&budget=6").status_code == 403
    assert client.get("/api/run?mode=defended&backend=stub").status_code == 200


def test_dns_rebinding_host_rejected():
    assert _LoopbackClient("http://attacker.example:8770").get("/api/plan").status_code == 403


@pytest.mark.parametrize("hdr", [{"Sec-Fetch-Site": "cross-site"}, {"Origin": "http://evil.example"}])
def test_cross_site_api_rejected(client, hdr):
    assert client.get("/api/plan", headers=hdr).status_code == 403


def test_security_headers(client):
    r = client.get("/")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "script-src 'self'" in r.headers["Content-Security-Policy"]


def test_api_run_streams(client):
    r = client.get("/api/run?mode=defended&backend=stub&alloc=uniform&budget=12&seed=5")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert '"type": "run_start"' in body and "event: done" in body
