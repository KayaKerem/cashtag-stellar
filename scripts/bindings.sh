#!/usr/bin/env bash
# K15: deploy edilmiş kontratlardan TypeScript bindings üretir (packages/cliprail-client, packages/humanity-client).
# ID'ler env'den ya da scripts/.accounts/deploy.env'den okunur.
set -euo pipefail

NET=testnet
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_ENV="$ROOT/scripts/.accounts/deploy.env"
log() { printf '\033[1;34m[bindings]\033[0m %s\n' "$*"; }
envfile_get() { [ -f "$2" ] && grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- || true; }

: "${CLIPRAIL_ID:=$(envfile_get CLIPRAIL_ID "$DEPLOY_ENV")}"
: "${HUMANITY_ID:=$(envfile_get HUMANITY_ID "$DEPLOY_ENV")}"
[ -n "$CLIPRAIL_ID" ] && [ -n "$HUMANITY_ID" ] || { echo "CLIPRAIL_ID/HUMANITY_ID yok (önce scripts/deploy.sh)" >&2; exit 1; }

gen() { # contract-id output-dir
  log "$2 ← $1"
  stellar contract bindings typescript --network "$NET" --contract-id "$1" --output-dir "$ROOT/$2" --overwrite
}
gen "$CLIPRAIL_ID" packages/cliprail-client
gen "$HUMANITY_ID" packages/humanity-client

log "pnpm install + build"
(cd "$ROOT" && pnpm install)
for d in packages/cliprail-client packages/humanity-client; do
  (cd "$ROOT/$d" && pnpm run build)
done
log "Tamam: packages/cliprail-client, packages/humanity-client"
