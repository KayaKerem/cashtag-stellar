# verifier

ClipRail doğrulama servisi: zkFetch (Reclaim zkTLS) ile YouTube / demo izlenme kanıtı üretir, kanıtı `ProofJson`'a çevirir, relayer anahtarıyla `submit_proof` ve `humanity.register` gönderir, demo platform uç noktasını sunar ve keeper olarak dönemleri ilerletir. HTTP API: `docs/INTERFACES.md` §4.

## Çalıştırma

```bash
pnpm install
cp services/verifier/.env.example services/verifier/.env   # değerleri doldur
pnpm --filter verifier dev      # http://localhost:8787 (tsx watch)
pnpm --filter verifier test     # vitest (gerçek zkFetch çağırmaz)
```

- `.env` boş olsa da servis açılır. `/health`, `/demo/*` çalışır. `/proof` ve `/proof/submit` Reclaim kimlik bilgisi yoksa `503 {error:"reclaim credentials missing"}` döner.
- `RELAYER_SECRET`, `CLIPRAIL_ID`, `HUMANITY_ID` boşsa `scripts/.accounts/{secrets,deploy}.env` dosyalarından okunur. Bu dosyaları `scripts/setup-accounts.sh` ve `scripts/deploy.sh` üretir, ikisi de gitignored.
- `KEEPER=1`: her 5 sn'de bir tüm kampanyaları tarar.
  - Kanıt penceresinde (`content_end + 6 sn` ile `proof_end − 30 sn` arası) her klip için bir kez kapanış kanıtı gönderir.
  - Süresi dolan itirazlar için `finalize_dispute` çağırır.
  - `settle_at` geçince `settle_epoch` çağırır.
- `DEMO_MODE=1`: `POST /humanity/demo-register` açılır. Nullifier `sha256("demo" ‖ campaignId ‖ wallet)` (UTF-8, campaignId ondalık).

## Kanıtlar, cache, replay

- Her yeni kanıt ham hâliyle `.data/cache/<platform>-<videoId>-<timestampS>.json` olarak saklanır.
- `POST /proof?cached=1` en yeni cache'i döner ve zkFetch kotası harcanmaz. Kontrat aynı kanıtı ikinci kez kabul etmez (`ProofReused`).
- `PROOF_FIXTURE_DIR=<klasör>` replay modudur: zkFetch hiç çağrılmaz, kanıt bu klasördeki `<platform>-<videoId>[-<ts>].json` dosyasından okunur.
- Dönüşüm (`src/proof.ts`) `docs/reclaim-notes.md`'ye uyar.
  - `parameters` imzalandığı gibi aynen gider. `context` JCS ile yeniden kanonikleştirilir.
  - `owner` küçük harfe çevrilir, `signature` = r‖s, `recoveryId = v − 27`.
  - `test/reference-vector.test.ts`, `fixtures/reclaim/reference-vector.json` ile identifier, digest ve imzalayanın tuttuğunu doğrular.
- Demo verisi `.data/demo-state.json` dosyasında tutulur. İlk açılışta `fixtures/demo-state.json` ile tohumlanır.

## Docker

Build context repo köküdür:

```bash
docker build -f services/verifier/Dockerfile -t cliprail-verifier .
docker run -d --name verifier --restart unless-stopped \
  --env-file services/verifier/.env -p 127.0.0.1:8787:8787 -v verifier-data:/data cliprail-verifier
```

Konteynerde `scripts/.accounts` yoktur. `RELAYER_SECRET`, `CLIPRAIL_ID` ve `HUMANITY_ID` değerleri `.env` içinde verilmelidir.

## Hetzner (Linux VM + Docker + Caddy)

1. VM'e Docker kur, repoyu klonla, `.env`'i doldur, yukarıdaki `docker build` / `docker run` komutlarını çalıştır.
2. Bir alan adını (ör. `verifier.example.com`) VM IP'sine yönlendir. TLS için Caddy kullan:

   ```
   # /etc/caddy/Caddyfile
   verifier.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```

   `sudo systemctl reload caddy`. Sertifikayı Caddy otomatik alır.
3. `.env`'de `DEMO_PUBLIC_BASE=https://verifier.example.com` ayarla.
   - Kontrattaki demo `url_prefix` bununla birebir aynı olmalı: `https://verifier.example.com/demo/videos/`.
   - Adres değişirse `SKIP_DEPLOY=1 DEMO_PUBLIC_BASE=… scripts/deploy.sh` ile yalnız `set_platform` çağrılarını tekrarla.
4. Web tarafında `NEXT_PUBLIC_VERIFIER_URL=https://verifier.example.com`. Gerekirse `CORS_ORIGIN` ile web origin'ini kısıtla.
