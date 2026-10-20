#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
docker build --target release-artifacts --output "type=local,dest=$root/dist" "$root"
