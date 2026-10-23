#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
workspace=$(mktemp -d)
mkdir -p "$root/test-results/local-mode/L1"
case "${1:-all}" in
  all) targets='local-runtime-tests local-chrome140' ;;
  local-runtime-tests|local-chrome140) targets=$1 ;;
  *) printf '%s\n' 'Expected all, local-runtime-tests or local-chrome140' >&2; exit 2 ;;
esac
for target in $targets; do
  image="zenimport-l1-$target-$$"
  cleanup() { docker image rm "$image" >/dev/null 2>&1 || true; rm -rf "$workspace"; }
  trap cleanup EXIT
  if [ "$target" = local-chrome140 ]; then
    docker build --platform linux/amd64 --target "$target" -t "$image" "$root"
    platform=linux/amd64
  else
    docker build --target "$target" -t "$image" "$root"
    platform=$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')
  fi
  # Collect first so import errors fail the gate and backend-only modules keep
  # their explicit skips. Each collected module gets a fresh memory cgroup and
  # disposable profiles: memory.peak must describe that module, not page cache
  # accumulated by hundreds of earlier browser profiles in the entire suite.
  docker run --rm --init --platform "$platform" --network none --memory=3g "$image" \
    python -m pytest --collect-only -q -p no:cacheprovider tests/local > "$workspace/collection"
  cat "$workspace/collection"
  sed -n 's/^\(tests\/local\/[^: ]*\.py\)::.*$/\1/p' "$workspace/collection" | sort -u > "$workspace/modules"
  [ -s "$workspace/modules" ] || { echo 'No native runtime tests collected' >&2; exit 1; }
  while IFS= read -r suite; do
    printf '\nTesting %s on %s\n' "$suite" "$target"
    docker run --rm --init --platform "$platform" --network none --memory=3g --shm-size=512m \
      --mount "type=bind,source=$root/test-results/local-mode/L1,target=/results" "$image" \
      timeout 3600 xvfb-run -a python -m pytest -q -o faulthandler_timeout=60 -p no:cacheprovider "$suite"
  done < "$workspace/modules"
  cleanup
  trap - EXIT
  workspace=$(mktemp -d)
done
rm -rf "$workspace"
