# ClipRail — Geliştirme Planı (Detaylı)

> Ekip: **Kerem** (`@KayaKerem`): kontratlar, verifier servisi, deploy, entegrasyon. **Sena** (`@Senaseser`): web arayüzü.
> Başlangıç: 19 Eylül 2026, 18:30. Teslim: **20 Eylül 2026, 13:00** (kesin). Toplam ~18 saat, uyku dahil. Güvenlik payı: 12:30'da her şey gönderilmiş olmalı.
> Kaynaklar: `ARCHITECTURE.md` (neden ve ne), `INTERFACES.md` (imzalar). Görevler GitHub Projects'te; bu dosyadaki ID'ler issue başlıklarıyla aynı.

---

## 0. Tamamlanma tanımı (Definition of Done)

Proje şu koşulların hepsi sağlandığında biter:

1. `contracts/` altında `cargo test` yeşil. Saldırı tablosundaki A1–A17'nin hepsinin testi var.
2. `cliprail` ve `humanity` testnet'e deploy edilmiş, ID'leri README ve `INTERFACES.md` §6'da yazılı.
3. Verifier servisi gerçek bir zkFetch kanıtı üretiyor. Kanıt **kontrat içinde** doğrulanıyor (en az bir `youtube`, en az bir `demo` kanıtı testnet'te kabul edilmiş).
4. Web üzerinden testnet'te uçtan uca akış çalışıyor:
   1. Kampanya kurulur.
   2. Katılınır: humanity (Self veya demo kaydı) → join → kod.
   3. Klip kaydedilir.
   4. Dönem 1 kapanış kanıtı gönderilir.
   5. İtiraz → cevap → hakem kararı.
   6. Settle → claim.
   7. Dönem 2 kapanış kanıtı → dönem 1 holdback claim.
   8. İade.
5. Her işlem için stellar.expert linki UI'da görünüyor.
6. README (özet, mimari şema, kontrat ID'leri, çalıştırma adımları, demo akışı, güven modeli ve sınırlar) hazır.
7. 3 dakikalık demo videosu çekilmiş, hackathon formu gönderilmiş.

## 1. Takvim ve kilometre taşları

| Kilometre taşı | Zaman | Kerem | Sena |
|---|---|---|---|
| **M0 Kurulum** | 19 Eyl 20:00 | Monorepo, toolchain, testnet hesapları, Reclaim spike başladı | Web iskeleti, cüzdan bağlantısı, mock API |
| **M1 Çekirdek** | 20 Eyl 00:30 | `reclaim-verify` + `cliprail` çekirdeği (join/register/submit/settle/claim) testleriyle; gerçek kanıt fixture'ı alındı | Public kampanya sayfası, marka formu, katılım ve klip kaydı mock ile |
| (uyku) | 00:30–05:30 | | |
| **M2 Testnet** | 20 Eyl 08:30 | İtiraz + holdback (dönemler arası) + refund + humanity (demo kaydı); testnet deploy; bindings; verifier servisi | Clipper ve marka panelleri; bindings ile gerçek kontrata bağlama başladı |
| **M3 Uçtan uca** | 20 Eyl 11:00 | Seed/demo script; hata düzeltme | Gerçek kontratla tüm akış; hakem sayfası; cila |
| **M4 Teslim** | 20 Eyl 12:30 | README, demo videosu, gönderim | Demo videosu, ekran görüntüleri |

**13:00 için yapılan kesintiler:** Self (K17) stretch'e alındı; tek insan kaydı relayer ile (`/humanity/demo-register`) yapılacak. `prove_alive` yok: holdback sadece dönemler arası, son dönemin tutulan payı iadede markaya döner. Demo'da 2 dönem × 4 dakika.

**Kesme kuralı:** Bir kilometre taşı 45 dakikadan fazla gecikirse **P1 işler kesilir**, önce P0 biter. Kesme sırası:
1. Holdback (K10) — `holdback_bps = 0` ile devre dışı kalır, kod yolu bozulmaz
2. Hakem (resolve + S11) — itiraz sadece "cevap yoksa dışla" olarak kalır
3. Landing sayfası cilası (S13)
4. YouTube gerçek kanıtı testnet'te gösterilemezse: sadece `demo` platformu + YouTube kanıtının off-chain doğrulaması slaytta

## 2. Repo yapısı (hedef)

```
cliprail-stellar/
├─ README.md  CLAUDE.md  .gitignore  package.json  pnpm-workspace.yaml
├─ docs/      ARCHITECTURE.md  INTERFACES.md  DEVELOPMENT_PLAN.md  HANDOFF.md  reclaim-notes.md  DEMO.md
├─ config/    providers.json
├─ fixtures/  youtube-open.json  demo-open.json  demo-close.json  (gerçek zkFetch çıktıları)
├─ contracts/
│  ├─ Cargo.toml                 (workspace; soroban-sdk sürümü tek yerde)
│  ├─ reclaim-verify/            (lib, no_std; kontrat değil)
│  ├─ cliprail/                  (src/lib.rs, types.rs, storage.rs, proof.rs, epoch.rs, dispute.rs, test/*.rs)
│  └─ humanity/
├─ services/verifier/            (TS, Hono veya Express; src/zkfetch.ts, src/proof.ts, src/relay.ts, src/demo.ts, src/self.ts)
├─ apps/web/                     (Next.js App Router + TS + Tailwind)
├─ packages/cliprail-client/     (stellar contract bindings typescript çıktısı)
├─ packages/humanity-client/
└─ scripts/                      (setup-accounts.sh, deploy.sh, bindings.sh, seed-demo.ts)
```

**Branch akışı:** `main` her zaman çalışır durumda olmalı. İş dalları `kerem/<konu>` ve `sena/<konu>` biçiminde. Küçük PR'lar açılır, diğer kişi hızlıca göz atıp merge eder. Hackathon'da kendi alanında doğrudan `main`'e push da serbest, **ama `docs/INTERFACES.md` değişikliği mutlaka bildirilir.**

## 3. Teknik kararlar ve sürümler

- **Rust:** stable (≥1.84), hedef `wasm32v1-none`.
  - Makinede varsayılan `cargo` 1.73 olabilir; `rustup default stable` ile güncelle.
  - `stellar-cli` v28: `cargo install --locked stellar-cli` ya da `brew install stellar-cli`.
- **soroban-sdk:** `28.x`. `crypto_hazmat().secp256k1_recover` için `features = ["hazmat"]` gerekebilir; K01'de derleyerek teyit et. Sorun çıkarsa `27.0.6`'ya dön. Protocol 28 testnet'te 27 SDK sorunsuz çalışıyor.
- **Test imzaları:** `k256` dev-dependency ile kendi attestor anahtarımızı üretip `parameters`/`context` imzalarız. Gerçek Reclaim formatı `fixtures/` ile ayrıca test edilir.
- **Node 24, pnpm 9** workspaces.
- **Web:** Next.js 15, TypeScript, Tailwind, `@creit.tech/stellar-wallets-kit` (Freighter), `@stellar/stellar-sdk`.
- **Verifier:** TypeScript, `@reclaimprotocol/zk-fetch`, `@reclaimprotocol/js-sdk` (`transformForOnchain`/`verifyProof`), `@stellar/stellar-sdk`, `@selfxyz/core` (P1).
- **Test USDC:** kendi issuer hesabımızla "USDC" klasik varlığı çıkarılır ve SAC deploy edilir. Sınırsız basabiliriz. Circle faucet'e bağımlı değiliz.
- **Demo platform uç noktası:** verifier'daki `GET /demo/videos/:id` public HTTPS olmalı. Seçenekler: `cloudflared tunnel --url http://localhost:8787` ya da Render veya Railway'e deploy. URL `config/providers.json` ve kontrat `set_platform` ile eşleşmeli.
- **zkFetch kotası:** ücretsiz planda **ayda yaklaşık 100 zkFetch**. İki Reclaim uygulaması aç (Kerem ve Sena hesabı), fixture'ları cache'le. Testlerde gerçek zkFetch **çağırma**.

## 4. Kontrat uygulama rehberi (Kerem)

### 4.1 Storage anahtarları

```rust
enum DataKey {
  Admin, Humanity, Attestors, Owners, Platform(Symbol),         // instance
  CampaignCount, ClipCount, DisputeCount,                      // instance
  Campaign(u64), Epoch(u64, u32),                              // persistent
  Participant(u64, Address), ParticipantClips(u64, Address),
  ParticipantEpoch(u64, Address, u32),
  Clip(u64), CampaignClips(u64) /* Vec<u64> */, ClipEpoch(u64, u32),
  VideoIndex(Symbol, String) /* -> clip_id */, UsedProof(BytesN<32>),
  Dispute(u64), CampaignDisputes(u64), ActiveDispute(u64, u32) /* clip,epoch -> id */,
}
```

- Her yazmada `extend_ttl`. Hackathon için sabit: yaklaşık 30 gün ledger.
- `UsedProof` persistent storage'da tutulur.

### 4.2 Yardımcılar (`epoch.rs`)

- `content_end(p, e)`, `proof_end`, `challenge_end`, `dispute_end`, `settle_at`, `alive_start`, `alive_end`, `refund_at`.
- `current_epoch(p, now)`: içerik dönemi indeksi. `start` öncesi 0, son dönemden sonra `epochs`.
- `validate_params(p)`:
  - `budget > 0`, `rate > 0`, `epochs ≥ 1`
  - `epoch_len ≥ proof + dispute + arbiter`
  - `retention_delay ≥ proof + dispute + arbiter`
  - `holdback_bps ≤ 10000`, `bond ≥ 0`
  - `arbiter ≠ brand`, `platforms` boş değil ve hepsi config'te var
  - `start ≥ now`

### 4.3 `reclaim-verify` kütüphanesi

```rust
pub struct Checked { pub identifier: BytesN<32>, pub views: u64 }
pub fn verify(env, proof: &ReclaimProof, attestors: &Vec<BytesN<20>>, owners: &Vec<Bytes>,
              expected_url: &Bytes, required: &Vec<Bytes>, code: &Bytes) -> Result<Checked, Error>
```

İç adımlar:
1. `identifier = keccak(b"http\n" + parameters + b"\n" + context)`
2. `hex_lower(identifier)`: 64 ASCII karakter.
3. `u64_to_ascii(ts)`, `u32_to_ascii(epoch)`.
4. `serialized = b"0x" + hex + b"\n" + owner + b"\n" + ts + b"\n" + epoch`.
5. `digest = keccak(b"\x19Ethereum Signed Message:\n" + ascii(len(serialized)) + serialized)`.
6. `pk = env.crypto_hazmat().secp256k1_recover(&digest, &sig, rec_id)` → `addr = keccak(pk[1..65])[12..32]` ∈ `attestors`, değilse `UnknownAttestor`.
7. `owner ∈ owners`, değilse `UnknownOwner`.
8. `find(parameters, b"\"url\":\"" + expected_url + b"\"")`, yoksa `UrlMismatch`. Her `required` alt dizisi `parameters` içinde olmalı, yoksa `MatchMismatch`.
9. `views`: `context` içinde `"views":"` ara → rakamları oku → u64. Hata `ViewsParseError`.
10. `desc`: `context` içinde `"desc":"` ara → kaçışsız `"` karakterine kadar olan aralıkta `code` ara. Yoksa `CodeNotFound`.

**Performans kuralı:** `Bytes`'ı **bir kez** `[u8; N]` buffer'a kopyala (`copy_into_slice`; `N = 8192`, daha büyükse hata ver) ve taramayı saf Rust ile yap. Döngü içinde `bytes.get(i)` kullanma, her çağrı bir host çağrısıdır.

**Uyarı:** Kesin anahtar sırası ve kaçışlar (JCS) spike'ta gerçek kanıttan teyit edilir. `url` alanının gerçek adı, `responseMatches` biçimi ve `extractedParameters` konumu `docs/reclaim-notes.md`'ye yazılır. Kod buna göre ayarlanır.

### 4.4 `cliprail` fonksiyon mantığı

**`create_campaign`**
1. `brand.require_auth()` → `validate_params`.
2. `token::Client(params.token).transfer(brand, contract, budget)`.
3. `Campaign{ balance: budget, … }`, `Epoch(id, e)` kayıtlarını `EpochState::default()` ile oluştur.
4. Event yayınla.

**`join`**
1. `participant.require_auth()`, faz kontrolü, `!Participant(id, addr)` ise devam.
2. `require_humanity` açıksa `humanity::Client.is_verified(id, addr)`, değilse `NotHuman`.
3. `code = "CR-" + base36(first 4 bytes of sha256(id_be ‖ addr_xdr))`, 6 karaktere sıfırla doldur.

**`register_clip`**
1. `participant.require_auth()`, katılmış olmalı, faz kontrolü, platform izinli olmalı.
2. `VideoIndex(platform, video_id)` yoksa devam.
3. `expected_url = prefix + video_id + suffix`, `reclaim_verify::verify(..)`.
4. Tazelik: `ts ≤ now + 600` ve `now − ts ≤ 3600`, değilse `ProofExpired`.
5. `UsedProof(identifier)` yoksa devam, ardından yaz.
6. `Clip{ baseline: views, hwm: views, first_epoch: current_epoch }`; `VideoIndex`, `CampaignClips`, `ParticipantClips` güncelle.

**`submit_proof(e)`**
1. `e < epochs`, `e ≥ clip.first_epoch`.
2. `now ∈ [content_end(e), proof_end(e)]` ve `ts ∈ [content_end(e) − 60, now + 600]`.
3. verify + `UsedProof`.
4. `ce = ClipEpoch(clip, e)`. Yoksa: `baseline = clip.hwm` (ilk gönderimde sabitlenir), `status = Active`.
5. `new_w = views ≥ ce.baseline ? min(views − ce.baseline, cap_clip) : 0`; `new_w < min_views` ise 0.
6. Katılımcı toplamı: `pe.raw += new_w − ce.weight`; `old_pw = pe.weight`; `pe.weight = min(pe.raw, cap_human)`; `epoch.total_weight += pe.weight − old_pw`.
7. `ce.views = views`, `ce.weight = new_w`, `clip.hwm = max(clip.hwm, views)`.
8. **Canlılık:** `e ≥ 1` ise ve `ClipEpoch(clip, e−1)` var, `weight > 0`, `!Excluded`, `!alive` ise:
   - `ensure_settled(e−1)` (settle koşulları uygunsa içeride settle eder, değilse atla).
   - Settle edilmişse `alive = true`, `epoch(e−1).held_survived += held_i`.

**`settle_epoch(e)`**
1. `!settled`, `now ≥ settle_at(e)`, `open_disputes == 0`, `e == 0 || epoch(e−1).settled`.
2. `base = budget / epochs`; `e == epochs−1` ise `base += budget % epochs`.
3. `budget_e = base + carry`. `carry` = önceki dönemin `budget − spent` değeri; dönem 0 için 0.
4. `rate = W == 0 ? 0 : min(rate_max, budget_e·1000 / W)`, `spent = rate·W / 1000`, `held_total = spent·bps / 10000`.
5. `campaign.settled_epochs = e + 1`.

**`claim(e)`**
1. Settle edilmiş, `!claimed`, `status ∉ {Excluded, Challenged, Responded}`, `now < refund_at`.
2. `pay = rate·pw·wc / (raw·1000)` (i128, `raw == 0` ise 0).
3. `held = pay·bps / 10000`, `immediate = pay − held`.
4. `amt = min(immediate, balance)` → transfer, `balance −= amt`, `claimed = true`.

**`claim_holdback(e)`**
1. Canlılık penceresi bitmiş olmalı:
   - `e < last` ise `now > proof_end(e+1)`
   - `e == last` ise `now > alive_end`
2. `alive && !holdback_claimed` ise `amt = held_i·held_total / held_survived`, `min(balance)` ile kırp, transfer et.

**`prove_alive`:** `now ∈ [alive_start, alive_end]`, `ts` pencere içinde, verify + `UsedProof`. Son dönem için canlılık işaretlemesi yukarıdakiyle aynı.

**İtiraz:** `ARCHITECTURE.md` §7'deki durum makinesi. Teminat transferleri `token.transfer` ile yapılır; `campaign.balance`'a dokunulmaz.
- `challenge` sırasında `epoch.open_disputes += 1`.
- Sonuçta `open_disputes −= 1`.
- Challenger kazanırsa `exclude(clip, e)`: `pe.raw −= wc` → `pw` yeniden hesaplanır → `W` güncellenir → `status = Excluded`, `weight = 0`.
- Clipper kazanırsa `status = Active`.

**`refund`:** `now ≥ refund_at`, `!refunded` ise `amt = balance` → brand'e transfer, `balance = 0`.

**`quote`:** Settle edilmemişse o anki `W` ve `budget_e` tahmini ile hesaplar (UI'da "tahmini" etiketiyle gösterilir).

### 4.5 Test planı (`contracts/cliprail/src/test/`)

- `setup.rs`: env, token (SAC `register_stellar_asset_contract_v2`), humanity mock ya da gerçek kontrat, k256 attestor anahtarı, `make_proof(url, views, desc, ts)` yardımcısı, `advance(secs)`.
- **Mutlu yol:** 2 katılımcı ve 3 klip, 2 dönem → oransal ödeme hesabı birebir kontrol edilir.
- **Oran tavanı:** W küçükse `rate == rate_max` ve artan bütçe carry olarak sonraki döneme geçer.
- **Aşırı talep:** W büyükse `rate < rate_max`, `Σ claim ≤ budget`.
- **Tavanlar:** klip tavanı, insan tavanı (aynı kişinin 3 klibi), `min_views` eşiği.
- **Holdback:** klip dönem 2'de kanıt göndermezse payı sağ kalana geçer; son dönemde `prove_alive`.
- **İtiraz:** cevapsız itiraz → dışlanma ve W'nin küçülmesi; cevaplı itiraz ve hakem her iki yöne; hakem süresi dolunca clipper kazanır; teminat bakiyeleri.
- **Saldırılar A1–A17:** her biri ayrı test, beklenen hata kodu doğrulanır.
- **Bakiye değişmezi:** her senaryonun sonunda `kontrat bakiyesi == Σ campaign.balance + açık teminatlar`.
- **Bütçe ölçümü:** `env.cost_estimate().budget()` ile `submit_proof` talimat sayısı yazdırılır, README'ye eklenir.
- **Gerçek fixture testi (`reclaim-verify`):** `fixtures/*.json` → gerçek imza doğrulanır (M2'ye kadar).

## 5. Verifier servisi rehberi (Kerem)

- **`src/config.ts`:** env okuma.
  - Değişkenler: `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET`, `YT_API_KEY`, `RELAYER_SECRET`, `RPC_URL`, `NETWORK_PASSPHRASE`, `CLIPRAIL_ID`, `HUMANITY_ID`, `PUBLIC_BASE_URL`, `DEMO_MODE`, `SELF_SCOPE_PREFIX`.
  - `providers.json` yüklenir.
- **`src/zkfetch.ts`:** `ReclaimClient(APP_ID, APP_SECRET)`.
  - `youtube`: `zkFetch(url, {method:'GET'}, {headers:{'x-goog-api-key': KEY}, responseMatches, responseRedactions})`.
  - `demo`: public URL, gizli header yok.
  - Sonra `transformForOnchain`. Çıktı `ProofJson`'a çevrilir: hex, `recoveryId = v − 27`.
- **`src/cache.ts`:** Her kanıt `fixtures/cache/<platform>-<id>-<ts>.json` olarak saklanır. `?cached=1` ile yeniden oynatılabilir; kontrattaki tekrar kullanım korumasına dikkat.
- **`src/relay.ts`:** `submit_proof` ve `prove_alive` işlemlerini relayer anahtarıyla kurar, simüle eder, imzalar ve gönderir. `humanity.register` ile `demo-register` de buradan geçer.
- **`src/demo.ts`:** Bellekte ve bir JSON dosyasında demo videolarını tutar. `GET` cevabı YouTube biçimindedir; `bump` ile sayı değiştirilir.
- **`src/self.ts` (P1):**
  - `SelfBackendVerifier` (mock passport, Celo Sepolia), scope `cliprail-<id>`.
  - `userId` biçimi spike'ta belirlenir: Stellar adresini `userDefinedData`'ya koymak ya da ed25519 pubkey'in hex'ini kullanmak.
  - Doğrulama başarılıysa `humanity.register(id, nullifier32, wallet)`.
- **Test:** `pnpm --filter verifier test`. Birim testler parser ve dönüştürücüleri kapsar. Entegrasyon testi elle, `scripts/`.

## 6. Web rehberi (Sena)

**Sayfalar** (hepsi testnet'te; üst çubukta cüzdan bağlantısı ve ağ rozeti):

| Rota | İçerik | Kullanılan API |
|---|---|---|
| `/` | Landing: tek cümle, 3 katman, "nasıl çalışır" (5 adım), kampanya listesi | `listCampaigns` |
| `/brand/new` | Kampanya formu: gruplandırılmış alanlar, her birinde yardım metni, demo ön ayarı butonu, zaman çizelgesi önizlemesi, doğrulama (§4.2 kuralları) | `createCampaign` |
| `/c/[id]` | Public kampanya sayfası: kurallar kartı ("bunlar değiştirilemez"), canlı faz ve geri sayım, dönem kartları (W, oran, harcanan), klip tablosu, itirazlar, explorer linkleri | `getCampaign`, `getPhase`, `getEpoch`, `listClips`, `listDisputes` |
| `/c/[id]/join` | Adımlar: (1) cüzdan, (2) insan doğrulaması (Self QR veya demo butonu), (3) katıl → **kod büyük ve kopyalanabilir**, "açıklamana ekle" talimatı | `isHuman`, `join` |
| `/c/[id]/register` | Platform seçimi + link girişi. Link → `videoId` ayrıştırılır (youtube: `watch?v=`, `youtu.be/`, `/shorts/`; demo: düz id). "Kanıt üretiliyor" durumu (5–30 sn), sonuç: baseline izlenme | `registerClip` |
| `/me` | Clipper paneli: kampanya × klip × dönem tablosu. Durum rozetleri: bekliyor / kanıt penceresi / itirazlı / settle / claim edilebilir / holdback. Butonlar: kapanış kanıtı, claim, holdback claim, itiraza cevap, canlılık kanıtı | `listClips`, `quote`, `submitClose`, `claim`, `claimHoldback`, `respond`, `proveAlive` |
| `/brand/[id]` | Marka paneli: bütçe (harcanan / kalan / carry), klip listesi, "itiraz et" (evidence metni + teminat uyarısı), "dönemi settle et", "iade al" | `challenge`, `settleEpoch`, `refund`, `finalizeDispute` |
| `/arbiter` | Cevaplanmış itirazlar: klip linki, evidence, iki buton | `resolve` |

**Ortak bileşenler:**
- `WalletButton`
- `NetworkBadge`
- `PhaseTimeline`: dönemleri yatay çubukta gösterir; aktif aşama vurgulu, geri sayım var.
- `Amount`: 7 ondalık ile gösterim.
- `TxLink`
- `CodeBadge`
- `StatusPill`
- `EmptyState`
- `ErrorToast`: kontrat hata kodu → Türkçe mesaj, tablo `INTERFACES.md` §2.3.

**Durum yönetimi:** React Query (TanStack) kullanılır; faz verisi 5 sn'de bir yenilenir.

**Mock → gerçek geçişi:** `src/lib/api/index.ts`, `NEXT_PUBLIC_API_MODE=mock|chain` değerine göre implementasyon seçer.

**Tasarım:** Temiz, güven veren bir fintech görünümü. Hem açık hem koyu tema. Mobil uyumlu; clipper'lar telefondan girecek.

## 7. Görev listesi (GitHub issue'larıyla birebir)

Issue eşlemesi: K01–K19 = #1–#19 · S01–S13 = #20–#32 · X01–X03 = #33–#35 · R01–R04 = #36–#39 — Proje panosu: https://github.com/users/KayaKerem/projects/2

Öncelik: **P0** = teslim için şart, **P1** = hedef, **P2** = stretch (bitmese de proje biter). Tahminler saat cinsinden.

### Kerem

| ID | Görev | Öncelik | Tahmin | Bağımlılık | Kilometre taşı |
|---|---|---|---|---|---|
| K01 | Monorepo iskeleti ve toolchain | P0 | 1 | — | M0 |
| K02 | Testnet hesapları + test USDC + SAC | P0 | 0.5 | K01 | M0 |
| K03 | Reclaim spike: zkFetch YouTube kanıtı + fixture + `reclaim-notes.md` | P0 | 2 | K01 | M0/M1 |
| K04 | Demo platform uç noktası + public tünel + demo kanıtı | P0 | 1 | K03 | M1 |
| K05 | `reclaim-verify` kütüphanesi + testler (k256 + fixture) | P0 | 3 | K03 | M1 |
| K06 | `cliprail`: tipler, storage, admin config, `create_campaign`, `join`, kod üretimi | P0 | 2 | K01 | M1 |
| K07 | `cliprail`: `register_clip` + global video kaydı | P0 | 1.5 | K05, K06 | M1 |
| K08 | `cliprail`: `submit_proof`, dönem ağırlıkları, tavanlar, HWM | P0 | 2 | K07 | M1 |
| K09 | `cliprail`: `settle_epoch` + `claim` + carry + bakiye kırpma | P0 | 1.5 | K08 | M1 |
| K10 | `cliprail`: dönemler arası holdback + `claim_holdback` (`prove_alive` yok) | P1 | 1 | K09 | M2 |
| K11 | `cliprail`: teminatlı itiraz (challenge/respond/resolve/finalize) | P0 | 2 | K09 | M2 |
| K12 | `cliprail`: `refund`, okuma fonksiyonları, `quote`, event'ler | P0 | 1 | K09 | M2 |
| K13 | Saldırı test paketi A1–A17 + bakiye değişmezi + bütçe ölçümü | P0 | 1.5 | K08–K12 | M2 |
| K14 | `humanity` kontratı + `join` cross-call | P0 | 1 | K06 | M2 |
| K15 | Deploy scriptleri + testnet deploy + bindings paketleri + `INTERFACES` §6 | P0 | 1 | K13, K14 | M2 |
| K16 | Verifier servisi: `/proof`, `/proof/submit`, cache, relay, demo uç noktaları | P0 | 3 | K04, K15 | M2 |
| K17 | Self Seviye 1: mock passport → nullifier → `humanity.register` | **P2 (stretch)** | 3 | K14, K16 | Stretch |
| K18 | Seed/demo scripti (hesapları fonla, kampanya kur, zaman çizelgesi) + `DEMO.md` | P0 | 1 | K15, K16 | M3 |
| K19 | README + mimari şema + güven modeli + bütçe ölçümü | P0 | 1 | K15 | M4 |

### Sena

| ID | Görev | Öncelik | Tahmin | Bağımlılık | Kilometre taşı |
|---|---|---|---|---|---|
| S01 | Web iskeleti (Next.js, Tailwind, tema, layout) | P0 | 1 | K01 | M0 |
| S02 | Cüzdan bağlantısı (Stellar Wallets Kit, Freighter, testnet kontrolü) | P0 | 1 | S01 | M0 |
| S03 | API katmanı: tipler + mock implementasyon + örnek veri | P0 | 1.5 | S01 | M0 |
| S04 | Ortak bileşenler (PhaseTimeline, Amount, TxLink, StatusPill, ErrorToast…) | P0 | 2 | S03 | M1 |
| S05 | Public kampanya sayfası `/c/[id]` | P0 | 2 | S04 | M1 |
| S06 | Kampanya oluşturma formu `/brand/new` | P0 | 2 | S04 | M1 |
| S07 | Katılım akışı `/c/[id]/join` (humanity adımı + kod) | P0 | 1.5 | S04 | M1 |
| S08 | Klip kaydı `/c/[id]/register` (link ayrıştırma + kanıt durumu) | P0 | 1.5 | S04 | M1 |
| S09 | Clipper paneli `/me` | P0 | 2.5 | S04 | M2 |
| S10 | Marka paneli `/brand/[id]` (itiraz, settle, iade) | P0 | 2 | S04 | M2 |
| S11 | Hakem sayfası `/arbiter` | P1 | 1 | S04 | M3 |
| S12 | Gerçek kontrata bağlama (bindings + verifier API) | P0 | 3 | K15, K16, S05–S10 | M2/M3 |
| S13 | Landing + "nasıl çalışır" + cila (mobil, boş/yükleme/hata durumları) | P1 | 1.5 | S05 | M3 |

### Ortak

| ID | Görev | Öncelik | Tahmin | Kilometre taşı |
|---|---|---|---|---|
| X01 | Uçtan uca prova (testnet, `DEMO.md` adımları) ve hata listesi | P0 | 1 | M3 |
| X02 | Demo videosu (3 dk) çekimi ve montajı | P0 | 1.5 | M4 |
| X03 | Hackathon gönderimi (form, repo linki, video, açıklama) | P0 | 0.5 | M4 |

### Stretch (P2, proje tamamlanması için şart değil)

| ID | Görev |
|---|---|
| R01 | Self Seviye 2: `vc_and_disclose` Groth16'nın Soroban'da doğrulanması + kök oracle'ı |
| R02 | TikTok veya X için clipper cihazından Reclaim akışı |
| R03 | Passkey cüzdan (smart-account-kit) + fee sponsorship |
| R04 | SEP-24 nakde çevirme demosu (testanchor.stellar.org) |

## 8. Demo senaryosu (3 dakika; ayrıntısı `DEMO.md`'de)

| Zaman | Sahne |
|---|---|
| 0:00 | Problem: Whop şikayetleri, "tamamen kendi takdirimize göre" maddesi, bot vakası, PayPal'ın olmadığı ülkeler |
| 0:25 | Marka 500 USDC kilitler; kurallar public sayfada, kontrat linki explorer'da |
| 0:45 | Clipper insan doğrulaması → katılım → `CR-7K3X9A` kodu → açıklamasında kod olan klibi kaydeder (gerçek YouTube kanıtı) |
| 1:15 | İkinci klip (`demo` platformu) → izlenme artar → kapanış kanıtı → kontrat imzayı doğrular, ağırlık görünür |
| 1:45 | Saldırı demosu: aynı kanıt tekrar gönderilir ve reddedilir; ikinci cüzdanla katılım `NotHuman` ile reddedilir |
| 2:05 | Marka bot klibe itiraz eder, clipper cevap vermez → klip dışlanır → diğer clipper'ın oranı yükselir |
| 2:30 | Settle → claim → USDC cüzdanda; holdback bir sonraki dönemde |
| 2:50 | Kapanış: "Sayı doğru, kişi tek, kurallar değişmez." + yol haritası |

## 9. Riskler ve B planları

| Risk | Belirti | B planı |
|---|---|---|
| Reclaim JCS formatı tutmuyor (imza doğrulanmıyor) | K05'te fixture testi kırmızı | Resmi Reclaim verifier'ına (`CA3EMXR6…`) cross-call yap, digest'i off-chain hesapla. URL ve kod kontrolleri kontratta kalır. Pitch'te beyan et. |
| zkFetch kotası bitti | 429 / hata | İkinci Reclaim uygulaması; cache'lenmiş kanıtlarla yeni kampanya kur (tekrar kullanım kampanyadan bağımsız değil, dikkat: `UsedProof` global) |
| Tünel veya demo uç noktası çöktü | zkFetch hata veriyor | Render'a deploy; son çare olarak `youtube` ile demo, W küçük olur |
| Self çalışmıyor | QR veya doğrulama hatası | `humanity/demo-register` (relayer kaydı), pitch'te "Seviye 1 yolu hazır, demo kaydı" diye beyan |
| Soroban SDK sürüm uyumsuzluğu | derleme hatası | 27.0.6'ya sabitle |
| Zaman | M2 gecikti | §1 kesme kuralı |
