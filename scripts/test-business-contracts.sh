#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend=${1:-"$root/../ZenImportBackend"}
python3 "$root/scripts/check-business-contracts.py" "$backend"
image="zenimport-business-$$"
cleanup() { docker image rm "$image-ts" "$image-python" >/dev/null 2>&1 || true; }
trap cleanup EXIT
mkdir -p "$root/test-results/local-mode/L2"
docker build --target unit-tests -t "$image-ts" "$root"
docker build --target tests -t "$image-python" "$backend"
docker run --rm --network none --read-only --tmpfs /tmp "$image-ts" \
  node scripts/run-business-contracts.mjs > "$root/test-results/local-mode/L2/typescript.json"
docker run --rm --network none --read-only --tmpfs /tmp --env PYTHONPATH=/app/tests:/app \
  "$image-python" python -m contracts.suite > "$root/test-results/local-mode/L2/python.json"
python3 - "$root/test-results/local-mode/L2" <<'PY'
import json
from pathlib import Path
import sys
root = Path(sys.argv[1])
left, right = [json.loads((root/name).read_text()) for name in ['typescript.json', 'python.json']]
assert left == right, 'Python/TypeScript behavioral drift'
print(f"PASS: {len(left['scenarios'])} scenarios, {left['arithmetic_count']} arithmetic and {left['unicode_count']} Unicode vectors; identical results, no network")
PY
