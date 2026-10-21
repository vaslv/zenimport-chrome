#!/bin/sh
# Explicit offline participant exchange; isolated IDB profiles and SQLite only.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend=${1:-"$root/../ZenImportBackend"}
case "${INTEROP_BROWSER:-chromium145}" in
 chromium145) target=local-runtime-tests; platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}') ;;
 chrome140) target=local-chrome140; platform=linux/amd64 ;;
 *) printf '%s\n' 'Expected INTEROP_BROWSER=chromium145 or chrome140' >&2; exit 2 ;;
esac
work=$(mktemp -d /tmp/zenimport-authority-interop.XXXXXXXX)
image="zenimport-authority-interop-$$"
cleanup(){ rm -rf "$work"; docker image rm "$image-browser" "$image-python" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker build --platform "$platform" --target "$target" -t "$image-browser" "$root"
docker build --platform "$platform" --target tests -t "$image-python" "$backend"
python_phase(){
 docker run --rm --init --platform "$platform" --user "$(id -u):$(id -g)" --network none --memory=3g --read-only --tmpfs /tmp \
  --mount "type=bind,source=$work,target=/interop" "$image-python" python scripts/portable_authority_interop.py "$1" /interop
}
browser_phase(){
 docker run --rm --init --platform "$platform" --network none --memory=3g --ipc=private --shm-size=512m --read-only --tmpfs /tmp \
  -e "AUTHORITY_PHASE=$1" --mount "type=bind,source=$work,target=/interop" "$image-browser" \
  xvfb-run -a python -m pytest -q -p no:cacheprovider tests/local/test_authority_interop.py
}
python_phase prepare
browser_phase initialize
python_phase exchange
browser_phase exchange
python_phase handoff
browser_phase activate
python_phase verify
