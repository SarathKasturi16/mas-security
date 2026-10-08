"""Connectivity self-test for a live LLM backend.

    python -m demo.check_backend --backend groq

Drops a trivial prompt on the configured model and prints the reply, so you can
confirm your key in demo/.env works before running the full demo. Exits non-zero
on failure. The stub backend always passes (offline).
"""
from __future__ import annotations

import argparse
import sys

from demo.agents import make_backend


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--backend", default=None, help="stub|groq|openrouter|gemini")
    a = ap.parse_args()
    try:
        backend = make_backend(a.backend)
    except RuntimeError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print(f"backend: {backend.name}")
    try:
        reply = backend.complete(
            "selftest::You are a test. Reply with exactly: OK",
            "ping",
        )
    except Exception as e:  # network / auth / rate-limit
        print(f"FAIL: call raised {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    print(f"reply: {reply[:200]}")
    print("PASS: backend reachable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
