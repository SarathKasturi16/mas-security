"""Local browser GUI for the exploit-then-defend demo.

    python -m demo.server            # serves http://127.0.0.1:8770

Streams demo/run_demo.iter_run over Server-Sent Events to a single-page app so a
review panel can watch every agent's full reply arrive live, see the attack
cascade (undefended) vs. containment (defended), colour-coded.

Security posture: locally it binds to 127.0.0.1 and answers only loopback Hosts;
hosted (deploy/vercel) it answers only its own Vercel domains. The LLM API key stays
server-side and is never sent to the browser; only agent text is streamed. Live
(paid) runs: one at a time per instance, capped guards, hand-offs and tokens, and a
MAS_ALLOW_LIVE kill switch (off by default when hosted).
"""
from __future__ import annotations

import argparse
import functools
import json
import logging
import os
import re
import threading
import time
import webbrowser
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_from_directory

from demo.agents import ROLE_PROMPTS, build_role_prompt, make_backend
from demo.run_demo import iter_run
from demo.target_mock import CANARY, PRESETS, get_preset
from engine.manifest import load_manifest
from engine.pipeline import ALLOCS, build_plan

STATIC_DIR = Path(__file__).parent / "static"
MANIFEST_DIR = Path(__file__).resolve().parent.parent / "manifests"
DEFAULT_MANIFEST = "pentest7_poc"
DEFAULT_PORT = 8770
BUDGET_MIN, BUDGET_MAX = 3, 15
LIVE_DEADLINE_S = 100.0       # whole-run time limit for live LLM runs
GUARD_MODELS = ("heuristic", "sim")
BACKENDS = ("stub", "groq")
MODES = ("undefended", "defended")
MAX_PAYLOAD_CHARS = 2000      # custom Attack-lab payload text (after stripping)
MAX_BODY_BYTES = 16 * 1024    # POST /api/run body cap
GOAL_TOKEN_RE = re.compile(r"[\x21-\x7e]{8,48}")   # printable ASCII, no spaces
# Control chars except \n and \t, plus C1, bidi overrides and zero-width chars (log spoofing).
_CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")
# Live runs only accept a token shaped like the stock one, so the token cannot
# smuggle free-form instructions into the paid model calls.
LIVE_TOKEN_RE = re.compile(r"\[\[[A-Za-z0-9:_-]{4,40}\]\]")

log = logging.getLogger(__name__)

# Only answer requests addressed to this server by its loopback name (blocks DNS
# rebinding); filled in by configure_hosts() / main().
ALLOWED_HOSTS: set[str] = set()
# One paid (non-stub) run at a time per instance; the slot expires so a run killed by
# the platform (without closing the response) can't wedge the instance forever.
_LIVE_LOCK = threading.Lock()
_live_since = 0.0
LIVE_SLOT_TTL = LIVE_DEADLINE_S + 30


def _take_live_slot() -> bool:
    global _live_since
    with _LIVE_LOCK:
        now = time.monotonic()
        if _live_since and now - _live_since < LIVE_SLOT_TTL:
            return False
        _live_since = now
        return True


def _free_live_slot() -> None:
    global _live_since
    with _LIVE_LOCK:
        _live_since = 0.0


def _live_allowed() -> bool:
    """Kill switch: hosted deployments need MAS_ALLOW_LIVE=1 to make real LLM calls."""
    default = "0" if os.environ.get("VERCEL") else "1"
    return os.environ.get("MAS_ALLOW_LIVE", default) == "1"


def configure_hosts(port: int) -> None:
    ALLOWED_HOSTS.clear()
    ALLOWED_HOSTS.update({f"127.0.0.1:{port}", f"localhost:{port}"})


def configure_public_hosts() -> None:
    """Hosted deployment (Vercel): answer the platform's own domains plus any listed
    in MAS_ALLOWED_HOSTS (comma-separated), instead of the loopback names."""
    names = [os.environ.get(k, "") for k in
             ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL")]
    names += os.environ.get("MAS_ALLOWED_HOSTS", "").split(",")
    ALLOWED_HOSTS.clear()
    ALLOWED_HOSTS.update(n.strip() for n in names if n.strip())


configure_hosts(DEFAULT_PORT)

# Whitelist built once from a directory listing; user input is only ever looked
# up in this dict, never joined into a filesystem path.
MANIFEST_PATHS: dict[str, Path] = {p.stem: p for p in sorted(MANIFEST_DIR.glob("*.json"))}


class BadParam(ValueError):
    """Invalid query parameter -> HTTP 400."""


def _bad(msg: str) -> Response:
    resp = jsonify({"error": msg})
    resp.status_code = 400
    return resp


def _choice(src, name: str, allowed, default: str) -> str:
    """Read ``name`` from ``src`` (query args or JSON dict) and check it is allowed."""
    val = src.get(name, default)
    if not isinstance(val, str) or val not in allowed:
        raise BadParam(f"invalid {name} {val!r}; allowed: {sorted(allowed)}")
    return val


def _int_param(src, name: str, lo: int, hi: int, default: int | None) -> int | None:
    raw = src.get(name)
    if raw is None or raw == "":
        return default
    if isinstance(raw, (bool, float)):        # JSON true/false/3.9 are not integers
        raise BadParam(f"{name} must be an integer")
    try:
        val = int(raw)
    except (TypeError, ValueError):
        raise BadParam(f"{name} must be an integer") from None
    if not lo <= val <= hi:
        raise BadParam(f"{name} must be between {lo} and {hi}")
    return val


def _clean_payload(raw) -> str:
    """Validate a custom payload: str, control chars stripped, non-empty, bounded."""
    if not isinstance(raw, str):
        raise BadParam("payload must be a string")
    text = _CTRL_RE.sub("", raw).strip()
    if not text:
        raise BadParam("payload must not be empty")
    if len(text) > MAX_PAYLOAD_CHARS:
        raise BadParam(f"payload must be at most {MAX_PAYLOAD_CHARS} characters")
    return text


@functools.lru_cache(maxsize=1)
def _normal_traffic() -> str:
    """Text agents produce or read on a clean run (any team); a goal token found in it
    would mark honest output as compromised."""
    stub = "[x] processed upstream hand-off; forwarding findings. [ContextWipe] Untrusted hand-off"
    parts = [get_preset("clean"), stub, *ROLE_PROMPTS.values()]
    for path in MANIFEST_PATHS.values():
        m = load_manifest(path)
        for v in m.nodes:
            label = m.graph.nodes[v].get("label", v)
            parts += [f"[{v}]", label, build_role_prompt(label, entry=True, critical=False),
                      build_role_prompt(label, entry=False, critical=True)]
    return "\n".join(parts).lower()


def _goal_token(raw) -> str:
    if (not isinstance(raw, str) or not GOAL_TOKEN_RE.fullmatch(raw)
            or raw.isalnum() or raw.lower() in _normal_traffic()):
        raise BadParam("goal_token must be a distinctive token: 8-48 printable ASCII "
                       "characters with a symbol, not found in normal agent output "
                       "(e.g. [[MY-TOKEN-1]])")
    return raw

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES   # hard cap; Flask answers 413 beyond it


@app.before_request
def _local_only():
    """Reject DNS-rebinding (wrong Host) and cross-site calls to the API."""
    if request.host not in ALLOWED_HOSTS:
        log.warning("rejected Host %r", request.host)
        abort(403)
    if request.path.startswith("/api/"):
        site = request.headers.get("Sec-Fetch-Site")
        if site and site not in ("same-origin", "none"):
            abort(403)
        origin = request.headers.get("Origin")
        if origin and origin not in {f"{sch}://{h}" for h in ALLOWED_HOSTS for sch in ("http", "https")}:
            abort(403)


@app.after_request
def _headers(resp: Response) -> Response:
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
    )
    return resp


@app.get("/")
def index() -> Response:
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/static/<path:name>")
def static_files(name: str) -> Response:
    return send_from_directory(STATIC_DIR, name)


@app.get("/api/manifests")
def api_manifests() -> Response:
    out = []
    for stem, path in MANIFEST_PATHS.items():
        m = load_manifest(path)
        out.append({"id": stem, "title": m.description or m.name, "nodes": len(m.nodes)})
    return jsonify(out)


@app.get("/api/plan")
def api_plan() -> Response:
    """The full pipeline plan (decomposition, allocation, guards, simulation) as JSON."""
    try:
        stem = _choice(request.args, "manifest", MANIFEST_PATHS, DEFAULT_MANIFEST)
        alloc = _choice(request.args, "alloc", ALLOCS, "risk")
        budget = _int_param(request.args, "budget", BUDGET_MIN, BUDGET_MAX, None)
        return jsonify(build_plan(MANIFEST_PATHS[stem], budget=budget, alloc=alloc))
    except (BadParam, ValueError) as e:
        return _bad(str(e))


@app.get("/api/targets")
def api_targets() -> Response:
    """The mock-target presets for the Attack lab, in display order, with their text."""
    return jsonify([
        {"id": pid, "label": label, "text": get_preset(pid), "injected": pid != "clean"}
        for pid, (label, _file) in PRESETS.items()
    ])


@app.route("/api/run", methods=["GET", "POST"])
def api_run() -> Response:
    """SSE stream of the demo pipeline for the requested mode/backend.

    GET takes query params (``manifest`` picks the team, default pentest7_poc; budget
    3..15 for every backend); POST takes the same fields as a JSON object plus the
    Attack-lab extras ``preset``, ``payload`` (custom text, overrides preset) and
    ``goal_token`` (custom canary).
    """
    if request.method == "POST":
        if (request.content_length or 0) > MAX_BODY_BYTES:
            resp = jsonify({"error": f"request body too large (max {MAX_BODY_BYTES} bytes)"})
            resp.status_code = 413
            return resp
        try:
            src = request.get_json(silent=True)
        except RecursionError:                # absurdly nested JSON
            src = None
        if not isinstance(src, dict):
            return _bad("body must be a JSON object")
    else:
        src = request.args
    clean = str(src.get("clean", "0")).lower() in ("1", "true", "yes")
    payload_text: str | None = None
    preset: str | None = None
    canary = CANARY
    try:
        mode = _choice(src, "mode", MODES, "undefended")
        backend = _choice(src, "backend", BACKENDS, "stub")
        if backend != "stub" and request.method != "POST":
            raise BadParam("live LLM runs must be started with POST")
        manifest = _choice(src, "manifest", MANIFEST_PATHS, DEFAULT_MANIFEST)
        alloc = _choice(src, "alloc", ALLOCS, "risk")
        guard_model = _choice(src, "guard_model", GUARD_MODELS, "heuristic")
        budget = _int_param(src, "budget", BUDGET_MIN, BUDGET_MAX, None)
        seed = _int_param(src, "seed", 0, 10**6, 0)
        if request.method == "POST":
            if src.get("payload") is not None:
                payload_text = _clean_payload(src["payload"])
            else:
                preset = src.get("preset", "clean" if clean else "nmap_banner")
                if not isinstance(preset, str) or preset not in PRESETS:
                    raise BadParam(f"invalid preset {preset!r}; allowed: {list(PRESETS)}")
            canary = _goal_token(src.get("goal_token", CANARY))
        # Validate budget vs. checkpoint count before streaming starts.
        build_plan(MANIFEST_PATHS[manifest], budget=budget, alloc=alloc, with_sim=False)
    except (BadParam, ValueError) as e:
        return _bad(str(e))

    live = backend != "stub"
    if live and not LIVE_TOKEN_RE.fullmatch(canary):
        return _bad("live runs need a goal token shaped like [[MY-TOKEN-1]] "
                    "(letters, digits, : _ - inside double brackets)")
    if live and payload_text is not None:
        # Free text on our key would make this a public LLM proxy; presets only.
        resp = jsonify({"error": "custom payloads run on the offline stub; Groq runs only the built-in targets"})
        resp.status_code = 403
        return resp
    if live and not _live_allowed():
        resp = jsonify({"error": "live LLM runs are switched off on this deployment"})
        resp.status_code = 403
        return resp
    # Pre-flight: build the backend once so a missing API key is a clean 503 here,
    # not a mid-stream failure. Done before taking the live slot.
    try:
        make_backend(backend, canary=canary)
    except RuntimeError as e:   # message names the env var only, never a key value
        resp = jsonify({"error": str(e)})
        resp.status_code = 503
        return resp
    if live and not _take_live_slot():
        resp = jsonify({"error": "a live LLM run is already in progress"})
        resp.status_code = 429
        return resp

    def stream():
        try:
            for ev in iter_run(
                defended=mode == "defended", backend_name=backend, clean=clean,
                manifest_path=MANIFEST_PATHS[manifest],
                alloc=alloc, budget=budget, guard_model=guard_model, seed=seed,
                deadline_s=LIVE_DEADLINE_S if live else None,
                payload_text=payload_text, preset=preset, canary=canary,
            ):
                yield f"data: {json.dumps(ev)}\n\n"
        except Exception as e:  # noqa: BLE001 - report to the client, don't 500 mid-stream
            log.exception("run failed")
            err = {"type": "fatal", "message": f"run failed ({type(e).__name__}); see server console"}
            yield f"data: {json.dumps(err)}\n\n"
        yield "event: done\ndata: {}\n\n"

    resp = Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
    if live:
        resp.call_on_close(_free_live_slot)
    return resp


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--no-browser", action="store_true", help="don't auto-open the browser")
    a = ap.parse_args()
    configure_hosts(a.port)
    url = f"http://127.0.0.1:{a.port}"
    print(f"\n  Demo GUI: {url}\n  (Ctrl+C to stop)\n")
    if not a.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    # host=127.0.0.1 only; threaded so the SSE stream doesn't block other requests.
    app.run(host="127.0.0.1", port=a.port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
