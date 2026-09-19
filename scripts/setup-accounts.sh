#!/usr/bin/env bash
# K02: testnet hesapları + test USDC (klasik varlık) + SAC.
# Idempotent: tekrar çalıştırmak güvenli; eksik olanı tamamlar.
# Çıktı: scripts/.accounts/accounts.env (gitignored, sadece public bilgiler)
#        scripts/.accounts/secrets.env  (gitignored, RELAYER_SECRET vb.)
set -euo pipefail

NET=testnet
HORIZON=${HORIZON_URL:-https://horizon-testnet.stellar.org}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/scripts/.accounts"
mkdir -p "$OUT_DIR"

ACCOUNTS=(admin relayer arbiter brand clipper1 clipper2 clipper3 usdc-issuer)
TRUSTERS=(brand clipper1 clipper2 clipper3 relayer arbiter)
UNIT=10000000 # 7 ondalık

log() { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }

account_exists() { curl -sf "$HORIZON/accounts/$1" >/dev/null; }

# 1) hesaplar
for name in "${ACCOUNTS[@]}"; do
  if stellar keys address "$name" >/dev/null 2>&1; then
    addr=$(stellar keys address "$name")
    if account_exists "$addr"; then
      log "$name mevcut ($addr)"
    else
      log "$name fonlanıyor ($addr)"
      stellar keys fund "$name" --network "$NET" >/dev/null
    fi
  else
    log "$name oluşturuluyor + fonlanıyor"
    stellar keys generate "$name" --network "$NET" --fund >/dev/null
  fi
done

ISSUER=$(stellar keys address usdc-issuer)
ASSET="USDC:$ISSUER"

# Horizon'daki USDC bakiyesi; trustline yoksa "none"
usdc_balance() {
  curl -sf "$HORIZON/accounts/$1" | jq -r --arg i "$ISSUER" \
    '([.balances[] | select(.asset_code=="USDC" and .asset_issuer==$i) | .balance][0]) // "none"'
}

# 2) trustline'lar
for name in "${TRUSTERS[@]}"; do
  addr=$(stellar keys address "$name")
  if [ "$(usdc_balance "$addr")" = "none" ]; then
    log "$name için USDC trustline ekleniyor"
    stellar tx new change-trust --source-account "$name" --line "$ASSET" --network "$NET" --quiet >/dev/null
  else
    log "$name trustline mevcut"
  fi
done

# 3) mint (hedef bakiyeye tamamla)
mint_to() { # name target_whole_usdc
  local addr bal have want diff
  addr=$(stellar keys address "$1")
  bal=$(usdc_balance "$addr")
  have=$(python3 -c "from decimal import Decimal as D; print(int(D('$bal')*$UNIT))")
  want=$(( $2 * UNIT ))
  if [ "$have" -lt "$want" ]; then
    diff=$(( want - have ))
    log "$1 ← $(( diff / UNIT )) USDC"
    stellar tx new payment --source-account usdc-issuer --destination "$addr" \
      --asset "$ASSET" --amount "$diff" --network "$NET" --quiet >/dev/null
  else
    log "$1 bakiyesi yeterli ($bal USDC)"
  fi
}
mint_to brand 10000
mint_to clipper1 1000
mint_to clipper2 1000
mint_to clipper3 1000
mint_to arbiter 1000

# 4) SAC
SAC=$(stellar contract id asset --asset "$ASSET" --network "$NET")
if out=$(stellar contract asset deploy --asset "$ASSET" --source-account admin --network "$NET" --alias usdc 2>&1); then
  log "SAC deploy edildi"
else
  if echo "$out" | grep -qiE "exist|ExistingValue"; then
    log "SAC zaten deploy edilmiş"
  else
    echo "$out" >&2; exit 1
  fi
fi

# 5) çıktı dosyaları
{
  echo "# Otomatik üretildi: scripts/setup-accounts.sh ($(date -u +%FT%TZ))"
  echo "NETWORK=testnet"
  for name in "${ACCOUNTS[@]}"; do
    var=$(echo "$name" | tr 'a-z-' 'A-Z_')
    echo "${var}=$(stellar keys address "$name")"
  done
  echo "USDC_ASSET=$ASSET"
  echo "USDC_SAC=$SAC"
} > "$OUT_DIR/accounts.env"

umask 077
{
  echo "# GİZLİ — commit etme"
  echo "RELAYER_SECRET=$(stellar keys secret relayer)"
} > "$OUT_DIR/secrets.env"
chmod 600 "$OUT_DIR/secrets.env"

log "Özet:"
cat "$OUT_DIR/accounts.env"
for name in brand clipper1 arbiter relayer; do
  printf '  %-9s USDC=%s\n' "$name" "$(usdc_balance "$(stellar keys address "$name")")"
done
log "Yazıldı: scripts/.accounts/accounts.env, scripts/.accounts/secrets.env"
