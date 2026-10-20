#!/bin/sh
# Format-only, offline Python/TypeScript ZIP acceptance. Financial gates are separate.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend=${1:-"$root/../ZenImportBackend"}
work=$(mktemp -d /tmp/zenimport-portable-interop.XXXXXXXX)
image="zenimport-portable-interop-$$"
cleanup(){ rm -rf "$work"; docker image rm "$image-ts" "$image-python" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker build --target unit-tests -t "$image-ts" "$root"
docker build --target tests -t "$image-python" "$backend"
docker run --rm --user "$(id -u):$(id -g)" --network none --memory=3g --read-only --tmpfs /tmp \
  --mount "type=bind,source=$work,target=/work" "$image-ts" node scripts/portable-format-interop.mjs write /work/typescript.zip
docker run --rm --user "$(id -u):$(id -g)" --network none --memory=3g --read-only --tmpfs /tmp \
  --mount "type=bind,source=$work,target=/work" "$image-python" python scripts/portable_format_interop.py /work
docker run --rm --user "$(id -u):$(id -g)" --network none --memory=3g --read-only --tmpfs /tmp \
  --mount "type=bind,source=$work,target=/work" "$image-ts" node scripts/portable-format-interop.mjs read /work/python.zip
