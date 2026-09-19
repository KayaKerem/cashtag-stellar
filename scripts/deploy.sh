#!/usr/bin/env bash
# K15: humanity + cliprail build/deploy/config (testnet).
# Önkoşul: scripts/setup-accounts.sh çalışmış olmalı (admin, relayer anahtarları).
#
# Env (veya services/verifier/.env içinden okunur):
#   RECLAIM_APP_ID      izinli owner (zkFetch APP_ID, "0x…"); virgülle birden fazla verilebilir
#   DEMO_PUBLIC_BASE    demo platformunun public HTTPS tabanı (ör. https://verifier.example.com)
#   RECLAIM_ATTESTORS   virgülle ayrılmış attestor adresleri (varsayılan Reclaim attestor'u)
#   SKIP_BUILD=1        stellar contract build atla
#   SKIP_DEPLOY=1       deploy etme; scripts/.accounts/deploy.env'deki ID'lerle sadece config çağrılarını tekrarla
#                       (ör. DEMO_PUBLIC_BASE değişince set_platform demo'yu güncellemek için)
# Çıktı: scripts/.accounts/deploy.env (CLIPRAIL_ID, HUMANITY_ID, ...)
set -euo pipefail

NET=testnet
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/scripts/.accounts"
WASM_DIR="$ROOT/contracts/target/wasm32v1-none/release"
VERIFIER_ENV="$ROOT/services/verifier/.env"
mkdir -p "$OUT_DIR"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# KEY=value satırını dosyadan oku (source etmeden; değerlerde ';' ve boşluk olabilir)
envfile_get() { [ -f "$2" ] && grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
: "${RECLAIM_APP_ID:=$(envfile_get RECLAIM_APP_ID "$VERIFIER_ENV")}"
: "${DEMO_PUBLIC_BASE:=$(envfile_get DEMO_PUBLIC_BASE "$VERIFIER_ENV")}"
: "${RECLAIM_ATTESTORS:=0x244897572368eadf65bfbc5aec98d8e5443a9072}"

[ -n "$RECLAIM_APP_ID" ] || die "RECLAIM_APP_ID gerekli (env veya services/verifier/.env)"
[ -n "$DEMO_PUBLIC_BASE" ] || die "DEMO_PUBLIC_BASE gerekli (ör. https://verifier.example.com)"
DEMO_PUBLIC_BASE="${DEMO_PUBLIC_BASE%/}"

stellar keys address admin >/dev/null 2>&1 || die "admin anahtarı yok: önce scripts/setup-accounts.sh"
ADMIN=$(stellar keys address admin)
RELAYER=$(stellar keys address relayer)

hex() { printf '%s' "$1" | xxd -p | tr -d '\n'; }
# JSON dizi: ["hex", ...] — verilen string'lerin UTF-8 hex'i
hex_json_array() { python3 -c 'import json,sys; print(json.dumps([s.encode().hex() for s in sys.argv[1:]]))' "$@"; }

invoke() { # contract fn args...
  local id=$1 fn=$2; shift 2
  log "$fn $*" | cut -c1-200
  stellar contract invoke --id "$id" --source-account admin --network "$NET" -- "$fn" "$@"
}

# ---------- build + deploy ----------
if [ "${SKIP_DEPLOY:-}" = "1" ]; then
  [ -f "$OUT_DIR/deploy.env" ] || die "SKIP_DEPLOY=1 ama deploy.env yok"
  CLIPRAIL_ID=$(envfile_get CLIPRAIL_ID "$OUT_DIR/deploy.env")
  HUMANITY_ID=$(envfile_get HUMANITY_ID "$OUT_DIR/deploy.env")
  log "mevcut ID'ler: cliprail=$CLIPRAIL_ID humanity=$HUMANITY_ID"
else
  if [ "${SKIP_BUILD:-}" != "1" ]; then
    log "stellar contract build"
    (cd "$ROOT/contracts" && stellar contract build)
  fi
  for w in humanity cliprail; do [ -f "$WASM_DIR/$w.wasm" ] || die "$WASM_DIR/$w.wasm yok"; done

  log "humanity deploy"
  # constructor args are passed at deploy (no separate, front-runnable init call)
  HUMANITY_ID=$(stellar contract deploy --wasm "$WASM_DIR/humanity.wasm" --source-account admin --network "$NET" --alias humanity \
    -- --admin "$ADMIN" --relayer "$RELAYER")
  log "humanity=$HUMANITY_ID"

  log "cliprail deploy"
  CLIPRAIL_ID=$(stellar contract deploy --wasm "$WASM_DIR/cliprail.wasm" --source-account admin --network "$NET" --alias cliprail \
    -- --admin "$ADMIN" --humanity "$HUMANITY_ID")
  log "cliprail=$CLIPRAIL_ID"

  # ID'leri config çağrılarından önce yaz: sonraki adım patlarsa SKIP_DEPLOY=1 ile devam edilebilir
  USDC_SAC=$(envfile_get USDC_SAC "$OUT_DIR/accounts.env")
  {
    echo "# Otomatik üretildi: scripts/deploy.sh ($(date -u +%FT%TZ))"
    echo "CLIPRAIL_ID=$CLIPRAIL_ID"
    echo "HUMANITY_ID=$HUMANITY_ID"
    echo "USDC_SAC=$USDC_SAC"
  } > "$OUT_DIR/deploy.env"
fi

# ---------- config ----------
# attestors: Vec<BytesN<20>> (0x'siz hex)
ATTESTORS_JSON=$(python3 -c 'import json,sys; print(json.dumps([a.strip().lower().removeprefix("0x") for a in sys.argv[1].split(",") if a.strip()]))' "$RECLAIM_ATTESTORS")
invoke "$CLIPRAIL_ID" set_attestors --attestors "$ATTESTORS_JSON"

# owners: Vec<Bytes> — küçük harf ASCII "0x…" baytları
OWNERS=()
IFS=',' read -ra _ids <<< "$RECLAIM_APP_ID"
for o in "${_ids[@]}"; do o=$(echo "$o" | tr -d ' ' | tr 'A-F' 'a-f'); [ -n "$o" ] && OWNERS+=("$o"); done
invoke "$CLIPRAIL_ID" set_owners --owners "$(hex_json_array "${OWNERS[@]}")"

# set_platform(platform, url_prefix, url_suffix, required)
# required = canonical parameters içinde aynen geçmesi gereken alt diziler.
# TODO(reclaim-notes): kaynak fixtures/required-substrings.json (docs/reclaim-notes.md §2.2). İlk gerçek
#   zkFetch kanıtında claimData.parameters'ın bu byte'ları içerdiğini doğrula (reclaim-notes §5 soru 1).
REQ_FILE="$ROOT/fixtures/required-substrings.json"
[ -f "$REQ_FILE" ] || die "$REQ_FILE yok"
required_hex() { python3 -c 'import json,sys; print(json.dumps([s.encode().hex() for s in json.load(open(sys.argv[1]))[sys.argv[2]]["required"]]))' "$REQ_FILE" "$1"; }

PROVIDERS="$ROOT/config/providers.json"
for p in youtube demo; do
  prefix=$(jq -r ".$p.urlPrefix" "$PROVIDERS")
  suffix=$(jq -r ".$p.urlSuffix // \"\"" "$PROVIDERS")
  [ "$p" = demo ] && prefix="${prefix/https:\/\/DEMO_HOST/$DEMO_PUBLIC_BASE}"
  log "platform $p: $prefix<id>$suffix"
  invoke "$CLIPRAIL_ID" set_platform --platform "$p" --url_prefix "$(hex "$prefix")" --url_suffix "$(hex "$suffix")" \
    --required "$(required_hex "$p")"
done

log "Tamam. scripts/.accounts/deploy.env:"
cat "$OUT_DIR/deploy.env"
log "Sonraki adım: scripts/bindings.sh ; verifier .env'de CLIPRAIL_ID/HUMANITY_ID (boşsa deploy.env'den okunur)"
