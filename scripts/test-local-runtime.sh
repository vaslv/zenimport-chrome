#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$root/test-results/local-mode/L1"
case "${1:-all}" in
  all) targets='local-runtime-tests local-chrome140' ;;
  local-runtime-tests|local-chrome140) targets=$1 ;;
  *) printf '%s\n' 'Expected all, local-runtime-tests or local-chrome140' >&2; exit 2 ;;
esac
for target in $targets; do
  image="zenimport-l1-$target-$$"
  cleanup() { docker image rm "$image" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  if [ "$target" = local-chrome140 ]; then
    docker build --platform linux/amd64 --target "$target" -t "$image" "$root"
    docker run --rm --init --platform linux/amd64 --network none --memory=3g --shm-size=512m \
      --mount "type=bind,source=$root/test-results/local-mode/L1,target=/results" "$image" \
      timeout 3600 xvfb-run -a python -m pytest -q -o faulthandler_timeout=60 -p no:cacheprovider tests/local
  else
    docker build --target "$target" -t "$image" "$root"
    docker run --rm --init --network none --memory=3g --shm-size=512m \
      --mount "type=bind,source=$root/test-results/local-mode/L1,target=/results" "$image" \
      timeout 3600 xvfb-run -a python -m pytest -q -o faulthandler_timeout=60 -p no:cacheprovider tests/local
  fi
  cleanup
  trap - EXIT
done
