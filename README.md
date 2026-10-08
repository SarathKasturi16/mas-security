# mas-security — Trust-Aware Topological Linearization

Training-free, proactive defense for LLM-based multi-agent systems against
lateral injection propagation. BTP · IIIT Kottayam. Full brief: `../btp summary/PROJECT-BRIEF.md`.

The defense restructures the agent interaction graph into a path decomposition,
places audit checkpoints at the separators (cut-sets), allocates a fixed audit
budget risk-first across them, and hardens each checkpoint with a Byzantine-robust
guard ensemble. No model training, no GPU.

## Setup
```bash
uv venv --python 3.11
uv pip install -r requirements.txt
uv run pytest -q
```

## Layout
- `engine/` — graph model, elimination ordering (Min-Fill/METIS), path decomposition
  + separators, blast-radius metrics, budget-matched allocator, closed-form guard ensemble.
- `manifests/` — capability manifests (one per MAS). See `SCHEMA.md`.
- `experiments/run_smoke.py` — `uv run python -m experiments.run_smoke`: every manifest
  × {none, uniform, risk}. Shows checkpoints cut infection and uniform==risk spend.
- `demo/` — **live exploit-then-defend demo** on a 7-agent pentest MAS:
  ```bash
  uv run python -m demo.run_demo --undefended   # injection cascades to orchestrator
  uv run python -m demo.run_demo --defended      # guard ensemble blocks it, orchestrator clean
  ```
  Backend via `MAS_BACKEND` / `--backend`: `stub` (offline, default) or a real
  free-tier LLM (`groq|openrouter|gemini`) — copy `demo/.env.example` to `demo/.env`.

## Status (Phase 1)
Components 1 & 2 core complete and tested; live demo works on the stub backend.
Full statistical experiments (CIs) and the MAPTA/xOffense manifests are next.
