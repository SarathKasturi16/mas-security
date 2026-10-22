#!/usr/bin/env bash
# Stage a clean copy of the demo for Vercel and deploy it.
#   deploy/vercel/stage.sh            # preview deployment
#   deploy/vercel/stage.sh --prod     # production (the permanent URL)
# The Groq key lives in Vercel's encrypted env (GROQ_API_KEY), never in the bundle.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"
rsync -a --delete --exclude .vercel \
  --exclude '__pycache__' --exclude '.handoff' --exclude '.env*' \
  "$REPO/engine" "$REPO/demo" "$REPO/manifests" \
  "$HERE/app.py" "$HERE/vercel.json" "$HERE/requirements.txt" "$HERE/.vercelignore" \
  "$BUILD/"
! find "$BUILD"/{demo,engine,manifests} -name ".env*" | grep -q . || { echo "refusing: .env file staged" >&2; exit 1; }
cd "$BUILD"
[ -d .vercel ] || vercel link --yes --project mas-security-demo
vercel deploy --yes "$@"
