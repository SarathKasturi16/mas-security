"""Local browser GUI for the exploit-then-defend demo.

    python -m demo.server            # serves http://127.0.0.1:8000

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
import webbrowser
from pathlib import Path

from flask import Flask, Response, request, send_from_directory

from demo.run_demo import iter_run

STATIC_DIR = Path(__file__).parent / "static"

app = Flask(__name__, static_folder=None)


@app.get("/")
def index() -> Response:
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/static/<path:name>")
def static_files(name: str) -> Response:
    return send_from_directory(STATIC_DIR, name)


@app.get("/api/run")
def api_run() -> Response:
    """SSE stream of the demo pipeline for the requested mode/backend."""
    mode = request.args.get("mode", "undefended")
    backend = request.args.get("backend", "stub")
    clean = request.args.get("clean", "0") in ("1", "true", "yes")
    defended = mode == "defended"

    def stream():
        try:
            for ev in iter_run(defended=defended, backend_name=backend, clean=clean):
                yield f"data: {json.dumps(ev)}\n\n"
        except Exception as e:  # noqa: BLE001 - report to the client, don't 500 mid-stream
            err = {"type": "fatal", "message": f"{type(e).__name__}: {e}"}
            yield f"data: {json.dumps(err)}\n\n"
        yield "event: done\ndata: {}\n\n"

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true", help="don't auto-open the browser")
    a = ap.parse_args()
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
