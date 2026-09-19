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

## Kötüye kullanım koruması

- `WRITE_TOKEN` doluysa `/proof/submit`, `/demo/videos/:id/bump` ve `/humanity/demo-register` için `Authorization: Bearer <token>` gerekir.
- `/proof`:
  - IP başına dakikada 5 istek (`X-Forwarded-For` ilk hop).
  - En fazla 2 eşzamanlı zkFetch.
  - Aynı video için süren istekler birleştirilir.
  - 120 sn'den yeni cache'li kanıt yeniden kullanılır.
- Demo sınırları: `views ≤ 1e9`, `|delta| ≤ 1e8`, `desc ≤ 1000` karakter, en fazla 200 video.
- `CORS_ORIGIN`: `*` ya da virgülle ayrılmış origin listesi.

## Kapanış kanıtı (`/proof/submit` ve keeper)

- zkFetch'ten önce zincir üstünde ön kontrol yapılır. Kontrol, kontratın `submit_proof` şartlarının aynısıdır:
  - pencere `[content_end, proof_end)` ve yeni kanıt için ≥ 30 sn pay
  - `e ≥ first_epoch`
  - klip-dönemi `Active`
  - `e−1` settle edilmiş ya da settle edilebilir
  - Hata kodları kontrat kodlarıyla aynıdır (`contract_<n>`).
- `(clip, epoch)` başına ortak kayıt tutulur (HTTP ve keeper aynı kaydı kullanır).
  - Başarılı sonuç tekrar döner.
  - Geçici hatada kanıt saklanır ve yalnız işlem yeniden gönderilir.
  - `ProofExpired` ya da `ProofReused` gelirse kanıt yeniden alınır.
  - Kalıcı hatalar (Excluded, AlreadyDisputed, CodeNotFound, UrlMismatch…) yapışkandır.
  - Kayıt başına en fazla 2 zkFetch yapılır.
- Keeper sırası: süresi dolan itirazlar → settle → kapanış kanıtları. Zaten kanıtı olan (`views > 0`) klip-dönemleri atlanır.
- Kanıt `RECLAIM_ATTESTORS` dışındaki bir attestor'dan gelirse reddedilir. Adres loglanır ve ham kanıt `.data/rejected/` altına yazılır.

## Kanıtlar, cache, replay

- Her (platform, video) için yalnız son kanıt ham hâliyle `.data/cache/<platform>-<videoId>.json` olarak saklanır.
- `POST /proof?cached=1` yaşına bakmadan cache'i döner. Kontrat aynı kanıtı ikinci kez kabul etmez (`ProofReused`).
- `PROOF_FIXTURE_DIR=<klasör>` replay modudur: zkFetch hiç çağrılmaz, kanıt bu klasördeki `<platform>-<videoId>[-<ts>].json` dosyasından okunur.
- Dönüşüm (`src/proof.ts`) `docs/reclaim-notes.md`'ye uyar.
  - `parameters` imzalandığı gibi aynen gider. `context` JCS ile yeniden kanonikleştirilir.
  - `owner` küçük harfe çevrilir, `signature` = r‖s, `recoveryId = v − 27`.
  - Açık (public) header gönderilmez, çünkü `parameters`'a girerdi.
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
