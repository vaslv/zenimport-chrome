#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
name="zenimport-chrome-test-$$"
cleanup() { docker image rm "$name-unit" "$name-browser" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker build --target unit-tests -t "$name-unit" "$root"
docker run --rm --network none "$name-unit"
if [ "${1:-}" != '--unit-only' ]; then
 docker build --target browser-tests -t "$name-browser" "$root"
 docker run --rm --network none --ipc=private --shm-size=512m "$name-browser"
fi
