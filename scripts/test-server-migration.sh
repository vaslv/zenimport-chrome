#!/bin/sh
# Explicit acceptance; network is disabled unless --live is requested.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mode=${1:---fake}
case "$mode" in --fake|--live) ;; *) echo 'Use --fake or --live' >&2; exit 2;; esac
backend=${2:-"$root/../ZenImportBackend"}
test -f "$backend/backend/app.py"
if [ "$mode" = --live ]; then
 : "${ZENIMPORT_LAB_IDENTITY:?Set path to the previously verified lab identity.json}"
 : "${ZENIMPORT_TEST_TOKEN_FILE:?Set path to the SDK test-token env file}"
 test -f "$ZENIMPORT_LAB_IDENTITY"
 test -f "$ZENIMPORT_TEST_TOKEN_FILE"
 # Require a completed stage-2 acceptance alongside the historical identity.
 test -f "$(dirname -- "$ZENIMPORT_LAB_IDENTITY")/stage2-results.json"
fi
umask 077
run=$(python3 -c 'from uuid import uuid4; print(uuid4())')
state="$root/.local/browser-migration/$run"
mkdir -p "$state"
image="zenimport-browser-migration:$run"
cleanup() { docker image rm "$image" >/dev/null 2>&1 || true; }
trap cleanup EXIT
echo "Private acceptance results: $state"
docker build -f "$root/Dockerfile.integration" --target migration-acceptance \
 --build-context "backend=$backend" -t "$image" "$root" >"$state/build.log" 2>&1
set -- docker run --rm --init --ipc=private --shm-size=512m \
 --mount "type=bind,source=$state,target=/state"
if [ "$mode" = --live ]; then
 set -- "$@" --mount "type=bind,source=$ZENIMPORT_LAB_IDENTITY,target=/run/secrets/identity.json,readonly" \
  --mount "type=bind,source=$ZENIMPORT_TEST_TOKEN_FILE,target=/run/secrets/test-token.env,readonly"
else
 set -- "$@" --network none
fi
if "$@" "$image" xvfb-run -a python scripts/browser_migration.py "$mode" >"$state/output.log" 2>&1; then
 # Results contain only counts and boolean assertions, never identities/tokens.
 python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps(d,ensure_ascii=False,indent=2))' "$state/results.json"
else
 echo "Acceptance failed. Inspect private log: $state/output.log; do not blindly retry an interrupted live run." >&2
 exit 1
fi
