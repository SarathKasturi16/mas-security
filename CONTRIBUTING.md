# Contributing / onboarding

Welcome. This is the BTP "Trust-Aware Topological Linearization" codebase. Read
`README.md` for the one-paragraph what, `../btp summary/PROJECT-BRIEF.md` for the
full project, and `manifests/SCHEMA.md` + `manifests/SOURCES.md` for the data model.

## First-time setup
```bash
git clone https://github.com/J4KE-B/mas-security.git
cd mas-security
uv venv --python 3.11
uv pip install -r requirements.txt
uv run pytest -q           # expect: all passed
uv run python -m experiments.run_smoke
```
If you don't have `uv`: `curl -LsSf https://astral.sh/uv/install.sh | sh`.

## Repo map
- `engine/` — deterministic core (graph, ordering, decomposition, metrics, allocator,
  guard ensemble). **No LLM, no network here.** Pure algorithms + NumPy.
- `manifests/` — one JSON per multi-agent system (the single source of truth).
  Add a new scenario = add a manifest; `run_smoke` auto-detects it.
- `experiments/` — sweep/harness scripts that consume the engine.
- `demo/` — the live LLM exploit-then-defend demo (the only place with network/keys).
- `tests/` — pytest. Every engine change needs a test.

## The live demo (needs a free API key)
```bash
cp demo/.env.example demo/.env        # then fill ONE provider key (Groq is easiest)
# edit demo/.env: MAS_BACKEND=groq  and  GROQ_API_KEY=gsk_...
uv run python -m demo.check_backend --backend groq   # confirm the key works
uv run python -m demo.run_demo --undefended --backend groq
uv run python -m demo.run_demo --defended  --backend groq
```
`demo/.env` is gitignored — **never commit a key.** The demo runs offline on the
default `stub` backend if you have no key.

## Workflow
- Branch per task: `git switch -c feature/<thing>`. Don't push broken `master`.
- Run `uv run pytest -q` before every push. Add tests for new engine behaviour.
- Keep the engine LLM-free; put anything touching models/network under `demo/`.
- Weights are capability-derived (SCHEMA.md), never hand-assigned in code.

## Parallel tracks right now (Phase 1 / toward Review 2)
- **More topologies** — add real pentest-MAS architectures as manifests (cite sources
  in `manifests/SOURCES.md`, mark inferred edges `"source": "inferred"`).
- **Live demo** — get a Groq key in, run the real-LLM exploit/defend, capture the logs.
- **Experiments** — synthetic BA/WS/ER generators + bootstrap-CI runs (next milestone).

## Deferred (Phase 2, don't block on these)
- Checkpoint allocation should key on checkpoint id, not positional lists
  (`experiments/run_smoke.py`, `engine/allocate.py`).
- `blast_radius(include_self=...)` is a caller convention — may become two functions.
- Full Byzantine k-sweep / correlated-blind-spot experiment (Component 3).
