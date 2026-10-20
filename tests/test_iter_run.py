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


def test_defended_blocks_at_entry_stub():
    evs = list(iter_run(defended=True, backend_name="stub"))
    votes = [e for e in evs if e["type"] == "guard_vote"]
    assert any(e["blocked"] for e in votes)
    # a block happens at an entry node, and the orchestrator stays clean
    blocked_nodes = {e["node"] for e in votes if e["blocked"]}
    assert blocked_nodes & {"recon", "scan_web", "scan_net"}
    assert evs[-1]["orch_pwned"] is False
    assert evs[-1]["blocked_at"]
