#!/usr/bin/env bash
# Launch the demo GUI (serves http://127.0.0.1:8770 and opens the browser).
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/python -m demo.server "$@"
