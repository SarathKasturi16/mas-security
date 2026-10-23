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

## Terminal script (`./tatl`)
Flags only, no prompts. Prints a plain-text guide to the defence plan (agents and risk scores,
bags, checkpoints, blast radius, budget split, p_block, simulation), then the run log.
```bash
./tatl --list                                          # teams, targets, options
./tatl --team mapta --both --backend stub              # undefended then defended + before/after table
./tatl --team pentest7_poc --defended --backend groq --budget 20 --guards auto
./tatl --team xoffense --undefended --target web_page --no-guide --no-color
```
Flags: `--team {pentest7_poc,worked_example_5agent,mapta,xoffense}`, `--defended | --undefended | --both`
(default both), `--budget 3..15`, `--alloc risk|uniform`, `--target PRESET | --payload-file F`,
`--goal-token T`, `--backend stub|groq`, `--guards auto|gemini|groq|heuristic`, `--no-guide`,
`--list`, `--no-color`. Teams with loops (mapta, xoffense) run in one pass; feedback edges are shown,
not run. Live guards run on Gemini Flash-Lite when `GEMINI_API_KEY` is set (model from
`GEMINI_GUARD_MODEL`, default `gemini-3.5-flash-lite`), else on Groq, so agent and guard rate limits
are separate. The script is `demo/cli.py`; `python -m demo.run_demo` still works.

## Browser GUI
```bash
uv run python -m demo.server [--port 8770] [--no-browser]   # http://127.0.0.1:8770
```
Binds to 127.0.0.1 only. The page streams the live demo and animates the full
pipeline (decomposition, checkpoints, budget allocation, guards, simulation), all
driven by the same `engine/pipeline.py:build_plan` the Monte-Carlo uses.
- `GET /api/manifests` lists available manifests.
- `GET /api/plan?manifest=pentest7_poc&budget=10&alloc=risk|uniform` returns the plan as JSON
  (budget 3..15 and at least the number of checkpoints; one budget unit = one guard).
- `GET /api/run?mode=defended|undefended&backend=stub&manifest=pentest7_poc&alloc=risk&budget=10&guard_model=heuristic|sim&seed=0`
  streams the run as Server-Sent Events. `guard_model=sim` makes each guard catch a
  malicious hand-off with probability p0 (mirrors the simulation); invalid params give 400.

## Status (Phase 1)
Components 1 & 2 core complete and tested; live demo works on the stub backend.
Full statistical experiments (CIs) and the MAPTA/xOffense manifests now run in the demo.

## Hosted demo (Vercel)

Live at **https://mas-security-demo.vercel.app** (project `mas-security-demo`, account `j4ke-b`).

```bash
deploy/vercel/stage.sh --prod     # stage a clean copy (no .env, tests, venv) and deploy
```

Production env vars (set once with `vercel env add`, encrypted on Vercel):
`GROQ_API_KEY` (live runs), `MAS_ALLOW_LIVE=1` (kill switch — remove or set `0` and
redeploy to disable real-LLM runs), `MAS_ALLOWED_HOSTS` (extra domains to answer).
`GEMINI_API_KEY` (guards; falls back to Groq without it), optional `GEMINI_GUARD_MODEL`.
Live runs are capped: budget 3..15, 6,000-char hand-offs, 400 tokens/call, 100 s/run.
