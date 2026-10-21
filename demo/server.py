"""Local browser GUI for the exploit-then-defend demo.

    python -m demo.server            # serves http://127.0.0.1:8770

Streams demo/run_demo.iter_run over Server-Sent Events to a single-page app so a
review panel can watch every agent's full reply arrive live, see the attack
cascade (undefended) vs. containment (defended), colour-coded.

Security posture: binds to 127.0.0.1 only (never exposed on the network); the LLM
API key stays server-side and is never sent to the browser; only agent text is
streamed. A read-only presentation tool, no auth by design.
"""
from __future__ import annotations

import argparse
import json
import logging
import threading
import webbrowser
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_from_directory

from demo.run_demo import iter_run
from engine.manifest import load_manifest
from engine.pipeline import ALLOCS, build_plan

STATIC_DIR = Path(__file__).parent / "static"
MANIFEST_DIR = Path(__file__).resolve().parent.parent / "manifests"
DEFAULT_MANIFEST = "pentest7_poc"
DEFAULT_PORT = 8770
BUDGET_MIN, BUDGET_MAX = 3, 30
LIVE_BUDGET_MAX = 10          # caps paid LLM calls per run (guards x guarded agents)
GUARD_MODELS = ("heuristic", "sim")
BACKENDS = ("stub", "groq")
MODES = ("undefended", "defended")

log = logging.getLogger(__name__)

# Only answer requests addressed to this server by its loopback name (blocks DNS
# rebinding); filled in by configure_hosts() / main().
ALLOWED_HOSTS: set[str] = set()
# One paid (non-stub) run at a time so a double click or a stray page can't burn the quota.
_LIVE_RUN = threading.BoundedSemaphore(1)


def configure_hosts(port: int) -> None:
    ALLOWED_HOSTS.clear()
    ALLOWED_HOSTS.update({f"127.0.0.1:{port}", f"localhost:{port}"})


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


def _choice(name: str, allowed, default: str) -> str:
    val = request.args.get(name, default)
    if val not in allowed:
        raise BadParam(f"invalid {name} {val!r}; allowed: {sorted(allowed)}")
    return val


def _int_param(name: str, lo: int, hi: int, default: int | None) -> int | None:
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        val = int(raw)
    except ValueError:
        raise BadParam(f"{name} must be an integer") from None
    if not lo <= val <= hi:
        raise BadParam(f"{name} must be between {lo} and {hi}")
    return val

app = Flask(__name__, static_folder=None)


@app.before_request
def _local_only():
    """Reject DNS-rebinding (wrong Host) and cross-site calls to the API."""
    if request.host not in ALLOWED_HOSTS:
        abort(403)
    if request.path.startswith("/api/"):
        site = request.headers.get("Sec-Fetch-Site")
        if site and site not in ("same-origin", "none"):
            abort(403)
        origin = request.headers.get("Origin")
        if origin and origin not in {f"http://{h}" for h in ALLOWED_HOSTS}:
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
        stem = _choice("manifest", MANIFEST_PATHS, DEFAULT_MANIFEST)
        alloc = _choice("alloc", ALLOCS, "risk")
        budget = _int_param("budget", BUDGET_MIN, BUDGET_MAX, None)
        return jsonify(build_plan(MANIFEST_PATHS[stem], budget=budget, alloc=alloc))
    except (BadParam, ValueError) as e:
        return _bad(str(e))


@app.get("/api/run")
def api_run() -> Response:
    """SSE stream of the demo pipeline for the requested mode/backend."""
    clean = request.args.get("clean", "0") in ("1", "true", "yes")
    try:
        mode = _choice("mode", MODES, "undefended")
        backend = _choice("backend", BACKENDS, "stub")
        alloc = _choice("alloc", ALLOCS, "risk")
        guard_model = _choice("guard_model", GUARD_MODELS, "heuristic")
        hi = BUDGET_MAX if backend == "stub" else LIVE_BUDGET_MAX
        budget = _int_param("budget", BUDGET_MIN, hi, None)
        seed = _int_param("seed", 0, 10**6, 0)
        # Validate budget vs. checkpoint count before streaming starts.
        build_plan(MANIFEST_PATHS[DEFAULT_MANIFEST], budget=budget, alloc=alloc, with_sim=False)
    except (BadParam, ValueError) as e:
        return _bad(str(e))

    live = backend != "stub"
    if live and not _LIVE_RUN.acquire(blocking=False):
        resp = jsonify({"error": "a live LLM run is already in progress"})
        resp.status_code = 429
        return resp

    def stream():
        try:
            for ev in iter_run(
                defended=mode == "defended", backend_name=backend, clean=clean,
                manifest_path=MANIFEST_PATHS[DEFAULT_MANIFEST],
                alloc=alloc, budget=budget, guard_model=guard_model, seed=seed,
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
        resp.call_on_close(_LIVE_RUN.release)
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
