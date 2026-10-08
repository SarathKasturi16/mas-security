# Manifest provenance

What is cited from a source paper vs. what we modelled. Examiners ask "where did
this topology come from?" — this is the answer. Each edge's `source` field in the
JSON says the same per-edge.

## worked_example_5agent.json
Illustrative 5-agent chain from the Review-1 slides (presentation-script-qa.tex,
slides 12/13). Not a real system — it fixes the allocation arithmetic
(rho 11/7.5/1, risk 5.64/3.85/0.51 at B=10). Note: the slides draw a coarse
3-checkpoint decomposition; the engine's Min-Fill on the chain yields 4
checkpoints (4.78/3.26/1.52/0.43). Both are valid; see tests/test_worked_example.py.

## pentest7_poc.json
Ported from research/prototype/sim_poc.py (the Review-1 live PoC). Roles and
edges are ours; weights come from the capability formula, not sim_poc's
hand-assigned numbers.

## mapta.json — MAPTA (arXiv:2508.20816 v1)
"Multi-Agent Penetration Testing AI for the Web", David & Gervais (UCL), 2025.

| Element | Cited | Modelled by us |
|---|---|---|
| Coordinator Agent (attack-path reasoning, tool orchestration, report synthesis; tools incl. `sandbox_agent`, `run_command`, `run_python`, email, Slack) | ✅ paper | caps shell/tool_exec/spawn/egress derived from its tool list |
| Sandbox Agent(s) 1..N (`run_command`, `run_python`; curl the target; share one per-job Docker container) | ✅ paper | we instantiate **2** sandbox agents to model the 1..N fan-out |
| Validation Agent (verifies PoC by concrete execution against the target) | ✅ paper | caps shell/tool_exec |
| Coordinator ⇄ Sandbox delegation; Sandbox outputs return to Coordinator; Coordinator → Validation | ✅ paper | exact return-channel edges are the paper's described flow, not a figure |
| `entry` = sandbox + validation (ingest attacker-controlled target responses) | ✅ paper (they curl/execute against target) | choice to mark all three as entry |
| `critical` = coordinator | — | our metric target (the hub) |

## xoffense.json — xOffense (arXiv:2509.13021 v1, Section 4.1)
"An Autonomous Multi-Agent Framework for Penetration Testing with Domain-Adapted LLMs".

| Element | Cited | Modelled by us |
|---|---|---|
| Five core components: Task Orchestrator, Knowledge Repository, Command Synthesizer, Action Executor, Information Aggregator | ✅ paper §4.1 | — |
| Action Executor runs commands on a Kali shell, ingests raw tool output | ✅ paper | caps shell/tool_exec/egress; `entry` |
| Information Aggregator consolidates a completed phase's outputs into directives for the next phase (the attacker-origin phase hand-off) | ✅ paper | our headline checkpoint site |
| Task Orchestrator builds the Task Coordination Graph, re-plans | ✅ paper | caps spawn; `critical` |
| Edges (CS→AE, AE→TO, AE→KR, AE→IA, KR→TO, IA→TO, TO→CS) | ✅ paper §4.1 data flow | — |

**Do NOT quote** the "8,000-character" Information Aggregator figure (brief §13:
removed — unverified). The qualitative claim (it is the phase hand-off carrying
attacker-origin text) is supported.

Weights in every manifest come from our capability formula (SCHEMA.md), not the
papers' own numbers.
