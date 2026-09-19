# verifier

ClipRail doğrulama servisi: zkFetch (Reclaim zkTLS) ile YouTube / demo izlenme kanıtı üretir, kanıtı `ProofJson`'a çevirir, relayer anahtarıyla `submit_proof` ve `humanity.register` gönderir, demo platform uç noktasını sunar ve keeper olarak dönemleri ilerletir. HTTP API: `docs/INTERFACES.md` §4.

## Çalıştırma

```bash
pnpm install
cp services/verifier/.env.example services/verifier/.env   # değerleri doldur
pnpm --filter verifier dev      # http://localhost:8787 (tsx watch)
pnpm --filter verifier test     # vitest (gerçek zkFetch çağırmaz)
```

- `.env` boş olsa da servis açılır. `/health`, `/demo/*` çalışır. `/proof` ve `/proof/submit` Reclaim kimlik bilgisi yoksa `503 {error:"reclaim credentials missing"}` döner (`ATTESTOR_MODE=simulated` hariç, aşağıya bak).
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

## Simüle attestor (`ATTESTOR_MODE=simulated`)

Reclaim kimlik bilgisi olmadan tüm web akışını testnet'te çalıştırmak içindir. Yalnız test attestor'una güvenen e2e instance ile kullanılır, ana deploy'a karşı kullanılmaz.

- `/proof` ve kapanış kanıtları zkFetch çağırmaz. Servis hedef URL'yi kendisi okur:
  - `demo`: süreç içi demo deposundan (HTTP yok).
  - `youtube`: YouTube API'sinden (`YT_API_KEY` yoksa 503).
- `providers.json`'daki aynı `responseMatches` regex'leri uygulanır. `parameters`/`context`, zkFetch'in göndereceğinin aynısı olarak kurulur ve attestor-core gibi imzalanır (`src/simulated.ts`; `scripts/e2e/proofgen.ts` aynı kodu kullanır).
- Anahtarlar: `SIM_ATTESTOR_SECRET` / `SIM_OWNER_SECRET`, boşsa e2e varsayılanları (attestor `0x3522…4da9`, owner `0xc76d…e6e3`).
- Simüle kanıtlar ayrı cache'te tutulur (`<DATA_DIR>/cache-simulated/`; örnek dosyada `DATA_DIR=.data/simulated`).
- `/health` → `attestorMode` (`reclaim` | `simulated`) ve `attestor` adresi. Web bununla "Simulated attestor" rozeti gösterebilir.

```bash
cp services/verifier/.env.simulated.example services/verifier/.env.simulated   # DEMO_PUBLIC_BASE'i doldur
pnpm --filter e2e set-demo-host -- https://verifier.example.com   # e2e demo url_prefix = <base>/demo/videos/
ENV_FILE=.env.simulated pnpm --filter verifier start
```

`ENV_FILE`, `.env` yerine okunacak dosyayı seçer (servis klasörüne göre). `CLIPRAIL_ID` / `HUMANITY_ID` açıkça verilirse `deploy.env`'deki ana deploy değerlerini ezer.

## Anon Aadhaar ZK kanıtı (`POST /humanity/aadhaar/prove`) — TEST modu

> **Demo UIDAI TEST anahtarı ve TEST verisi kullanır.** QR, UIDAI'nin resmi test QR'ının anon-aadhaar TEST anahtarıyla (`fixtures/aadhaar/testPrivateKey.pem`) o anki zamana göre yeniden imzalanmış hâlidir. Kanıttaki `pubkeyHash` TEST anahtarının hash'idir (`15134874…5873`); humanity kontratı demo için bu hash ile yapılandırılır. **Production'da kanıt kullanıcının tarayıcısında, kendi gerçek Aadhaar QR'ından üretilir; sunucu kimlik verisini hiç görmez.** Bu uç nokta yalnız demo içindir.

- İstek: `POST /humanity/aadhaar/prove {campaignId, wallet, identity?}` (`WRITE_TOKEN` doluysa `Authorization: Bearer <token>`).
  - `wallet`: `G...` hesap adresi (kontrat adresi 400).
  - `identity`: demo kimlik adı (`alice`, `bob`, `carol`…; `[A-Za-z0-9_-]{1,64}`). Fotoğraf baytları `sha256("cliprail-demo-photo:<identity>:<n>")` akışından türetilir: aynı kimlik → aynı nullifier, farklı kimlik → farklı nullifier. Verilmezse cüzdana özel kimlik (`wallet-<G...>`) kullanılır, yani her cüzdan ayrı bir "insan" olur. Sybil denemesi için iki cüzdanla aynı `identity` gönder.
- Yanıt: `{proof:{a,b,c}, nullifier, timestamp, ageAbove18, gender, pinCode, state, mode:"test", identity, publicSignals, cached}`.
  - `a`/`c` 64 bayt, `b` 128 bayt hex (Soroban BN254: G1 = be(x)‖be(y); G2 = x.c1‖x.c0‖y.c1‖y.c0).
  - Sayılar ondalık string (U256). Yalnız `ageAbove18` açılır; `gender`/`pinCode`/`state` 0'dır.
  - `publicSignals` kontrat sırası: `[pubkeyHash, nullifier, timestamp, ageAbove18, gender, pinCode, state, nullifierSeed, signalHash]`.
- Kural (kontratla aynı):
  - `nullifierSeed = keccak256(utf8("cliprail:" + ondalık(campaignId))) >> 3`
  - `signalHash = keccak256(cüzdanın ham 32 baytlık ed25519 anahtarı) >> 3`
  - `timestamp` QR imza zamanıdır (saat hassasiyetinde, UTC unix). Kontrat `now − timestamp ≤ max_age` kontrol eder.
- Kanıt üretimi: ~25–30 sn, ~3.7 GB RAM. Aynı anda yalnız 1 iş çalışır, diğerleri kuyrukta bekler. Sonuç `(campaignId, wallet, identity)` başına 10 dk cache'lenir; aynı anda gelen aynı istekler tek işi paylaşır. İstek zaman aşımı 120 sn (`504 timeout`). Her yeni kanıt dönmeden önce `vkey.json` ile yerelde doğrulanır.
- `AADHAAR_ARTIFACTS_DIR` boşsa ya da `aadhaar-verifier.wasm` / `circuit_final.zkey` yoksa `503 {code:"aadhaar_unavailable"}`. Artifact'ler anon-aadhaar v2.0.0 sürümüdür (wasm ~10 MB, zkey ~612 MB); repoya girmez. Yerelde `services/verifier/.data/aadhaar-artifacts/` altında durur (gitignored; `.env.simulated`'da `AADHAAR_ARTIFACTS_DIR=.data/aadhaar-artifacts`). Docker'da bu klasörü volume olarak bağla.
- Zincire gönderim istemci tarafındadır: `@cliprail/client` `registerHumanZk` bu uç noktayı çağırır, ardından `humanity.register_zk`'yı bağlı cüzdanla imzalar.
- Fixture'lar (`fixtures/aadhaar/`, kampanya 1): `alice_clipper1_c1`, `bob_clipper2_c1` (farklı kimlik), `alice_clipper2_c1_sybil` (alice'in nullifier'ı, başka cüzdan → reddedilmeli). Her klasörde `proof_soroban.json`, `proof_snarkjs.json`, `meta.json`. Fixture zaman damgaları üretim anına aittir; `max_age` geçtiyse yeniden üretilmeleri gerekir. Yeniden üretmek için: `AADHAAR_ARTIFACTS_DIR=.data/aadhaar-artifacts pnpm --filter verifier aadhaar:fixtures` (nullifier'lar aynı kalır, kanıt ve zaman damgası değişir).
- Testler: `pnpm --filter verifier test` sahte prover kullanır. Gerçek kanıt: `AADHAAR_REAL=1 AADHAAR_ARTIFACTS_DIR=<klasör> pnpm --filter verifier test aadhaar`.

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
