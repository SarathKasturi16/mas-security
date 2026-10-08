# Capability-manifest schema

A manifest is a JSON file describing one multi-agent system as a graph. It is the
single source of truth the engine consumes — "adapt to a new scenario = edit the manifest."

```jsonc
{
  "name": "string, unique id",
  "description": "one line",
  "source": "where the topology came from (paper fig/section, or 'synthetic')",
  "budget": 10.0,                       // total audit budget B (optional; default 10)
  "agents": {
    "A1": { "label": "UserAgent", "caps": [] },
    "A3": { "label": "CodeAgent", "caps": ["shell", "file_write"] }
  },
  "edges": [
    { "from": "A1", "to": "A2", "source": "paper fig 2 | inferred" }
  ],
  "entry": ["A1"]                        // agents that directly ingest attacker-controlled data
}
```

## Capability keys and the weight formula
Allowed caps: `shell, credentials, tool_exec, egress, spawn, file_write`.

    w(v) = 1 + 2·shell + 2·credentials + 1.5·tool_exec + 1.5·egress + 1·spawn + 1·file_write

so w(v) ∈ [1, 10]. The weight is a pure table lookup on operator-declared caps —
never learned, never inferred from runtime behaviour. A compromised agent cannot
change its own weight.

## Rules
- Every edge endpoint must be a declared agent.
- Every entry agent must be a declared agent.
- An edge `from -> to` means `to` ingests `from`'s output (data-flow direction).
- Mark any edge not stated in the source paper with `"source": "inferred"`.
