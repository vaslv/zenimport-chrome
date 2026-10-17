#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend=${1:-"$root/../ZenImportBackend"}
test -f "$backend/backend/app.py"
if [ "$#" -gt 0 ]; then shift; fi
mkdir -p "$root/test-results"
name="zenimport-chrome-integration-$$"
cleanup() { docker image rm "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker build -f "$root/Dockerfile.integration" --target integration --build-context "backend=$backend" -t "$name" "$root"
docker run --rm --network none --ipc=private --shm-size=512m --mount "type=bind,source=$root/test-results,target=/results" "$name" python -m pytest -q -p no:cacheprovider tests/browser "$@"
