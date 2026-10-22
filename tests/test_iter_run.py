"""The demo event stream (iter_run) powers both the CLI and the GUI."""
from demo.run_demo import iter_run


def test_undefended_cascade_stub():
    evs = list(iter_run(defended=False, backend_name="stub"))
    assert evs[0]["type"] == "run_start"
    assert evs[-1]["type"] == "run_end"
    # topology is carried for the GUI graph
    topo = evs[0]["topology"]
    assert {n["id"] for n in topo["nodes"]} == {
        "recon", "scan_web", "scan_net", "analysis", "exploit", "orchestrator", "reporter"
    }
    assert len(topo["edges"]) == 7
    # undefended: the orchestrator ends compromised
    assert evs[-1]["orch_pwned"] is True
    compromised = {e["node"] for e in evs if e["type"] == "agent_output" and e["compromised"]}
    assert "orchestrator" in compromised


ENTRY = {"recon", "scan_web", "scan_net"}


def test_defended_blocks_at_entry_stub():
    evs = list(iter_run(defended=True, backend_name="stub"))
    votes = {e["node"]: e for e in evs if e["type"] == "guard_vote"}
    outs = {e["node"]: e for e in evs if e["type"] == "agent_output"}
    for n in ENTRY:  # ingress guard blocks the raw poisoned page before the agent runs
        assert votes[n]["blocked"] is True and votes[n]["direction"] == "incoming"
        assert outs[n]["compromised"] is False and outs[n]["wiped"] is True
    assert all(v["direction"] == "incoming" for v in votes.values())
    assert not any(e["compromised"] for e in outs.values())
    assert outs["orchestrator"]["compromised"] is False
    assert evs[-1]["orch_pwned"] is False and evs[-1]["rep_pwned"] is False
    assert set(evs[-1]["blocked_at"]) == ENTRY


def test_defended_event_order_and_wiped_input():
    evs = list(iter_run(defended=True, backend_name="stub"))
    poisoned = evs[0]["payload_text"]
    for n in ENTRY:
        idx = [i for i, e in enumerate(evs) if e.get("node") == n]
        assert [evs[i]["type"] for i in idx] == ["agent_start", "guard_vote", "agent_output"]
        assert evs[idx[0]]["input"] == poisoned          # start shows the ORIGINAL input
        assert "[[PWNED" not in evs[idx[2]]["output"]


def test_defended_clean_payload_no_blocks():
    evs = list(iter_run(defended=True, backend_name="stub", clean=True))
    assert not any(e["blocked"] for e in evs if e["type"] == "guard_vote")
    outs = [e for e in evs if e["type"] == "agent_output"]
    assert not any(e["compromised"] or e["wiped"] for e in outs)
    assert evs[-1]["blocked_at"] == [] and evs[-1]["orch_pwned"] is False


def test_guard_backend_error_is_not_a_detection(monkeypatch):
    """A guard that cannot run fails closed but must never count as 'attack stopped'."""
    import demo.run_demo as rd

    class Broken:
        name, provider, model = "broken", "broken", "m"

        def complete(self, *a, **kw):
            raise TimeoutError("run time limit reached")

    monkeypatch.setattr(rd, "make_backend", lambda name=None: Broken())
    evs = list(rd.iter_run(defended=True, backend_name="broken", clean=True))
    votes = [e for e in evs if e["type"] == "guard_vote"]
    assert votes and all(v["guard_error"] and v["blocked"] for v in votes)
    assert evs[-1]["type"] == "run_end" and evs[-1]["blocked_at"] == []
    wiped = [e for e in evs if e["type"] == "agent_output" and e["wiped"]]
    assert wiped and all(e["agent_input"].startswith("[ContextWipe]") for e in wiped)
