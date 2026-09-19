# ClipRail — Mimari ve Plan

> Durum: hackathon sürümü (Stellar testnet). Son teslim: **20 Eylül 2026, ~18:00** (varsayım).
> Bu doküman "ne inşa ediyoruz ve neden böyle" sorusunun tek kaynağıdır. Arayüz imzaları için `INTERFACES.md`, iş planı için `DEVELOPMENT_PLAN.md`.

---

## 1. Tek cümle

Markalar kampanya bütçesini Soroban escrow'una kilitler; **ZK ile tek insan olduğunu kanıtlamış** clipper'lar kampanya içeriğini kendi sosyal hesaplarında paylaşır; paylaşımın izlenme sayısı **zkTLS (Reclaim) ile kanıtlanır**; bütçe **dönem dönem, değişmez kurallarla, oransal** dağıtılır.

## 2. Üç güven katmanı

| Katman | Garanti | Teknoloji |
|---|---|---|
| **Sayı doğru** | Platformun gösterdiği izlenme ve açıklama değiştirilmeden kontrata gelir | Reclaim zkTLS; attestor imzası ve içerik kontrolü **kontrat içinde** |
| **Kişi tek** | Bir insan bir kampanyaya bir kez katılır | Self ZK kimlik → kampanyaya özel nullifier (`humanity` kontratı) |
| **Kurallar değişmez** | Oran, tavan ve süreler sonradan değişmez; keyfi red yok | Soroban escrow + herkese açık kurallar |

**Dürüst sınır:** Sistem izleyicinin gerçek insan olduğunu kanıtlamaz. Bot izlenmeyi şu önlemlerle hafifletiriz: gecikmeli ölçüm (platformun bot temizliği bu sürede işler), tavanlar, `min_views`, teminatlı itiraz ve oransal dağıtım.

## 3. Neden bu tasarım (araştırmadan çıkan kararlar)

1. **Rakipler (Whop, Vyro, Solana'daki Cliply ve Clippio) "doğrulanmış izlenme" diyor ama doğrulamayı gösteremiyor.** Fark escrow'da değil, *kanıtlanabilir doğrulamada*. zkTLS ile izlenme kanıtlayıp ödeme yapan bir ürün bulunamadı.
2. **Bot izlenme ucuz:** YouTube'da 1000 izlenme $0.09–0.60. Oran $1/1k ise, yakalanma ihtimali %67'nin altındaysa bot kârlı. Bu yüzden:
   - "İlk gelen alır" yerine **oransal dağıtım** kullanıyoruz: `r_eff = min(r_max, 1000·B/W)`. Yarışı öldürür, bölünmeye dayanıklıdır.
   - **Tavanlar insan başına** uygulanıyor. Hesap başına tavan kimlik olmadan anlamsız.
   - **Teminatlı itiraz:** dışlanan pay markaya değil **diğer clipper'lara** dağılır. Marka itirazdan para kazanamaz ve topluluğun da bot avlamak için teşviki olur.
3. **Kazıma yok.** Public link kaydedilir, public sayı kanıtlanır. Provider tanımları tek bir config dosyasında durur ve platformdan bağımsızdır.
4. **Uzun ömür:** Dönemler (epoch) ve **tutma payı (holdback)** sayesinde video silinirse pay yanar, yayında kaldıkça sonraki dönemlerde kazandırmaya devam eder.
5. **Reclaim'in Soroban kontratı ince:** sadece imza kontrolü yapıyor. URL, video ve kod kontrollerinin hepsini **kendi kontratımızda** yapıyoruz (araştırmadaki B seçeneği).
   - Güncel testnet verifier'ı `CA3EMXR6…DU5`. `CA4OZVT3…` ise ağda yok.
   - Attestor şu an tek anahtarla çalışıyor (`0x244897572368eadf65bfbc5aec98d8e5443a9072`). Bunu açıkça beyan ediyoruz.

## 4. Aktörler

- **Marka:** kampanyayı kurar ve fonlar, itiraz başlatabilir, sonunda kalan bütçeyi iade alır.
- **Clipper:** tek insan doğrulamasından geçer, katılır, kod alır, paylaşır, linkini kaydeder, kanıt gönderir, claim eder.
- **Hakem (arbiter):** cevaplanmış itirazlara karar verir. Kampanya kurulurken seçilir ve marka olamaz. Hackathon'da ekip adresi.
- **Verifier servisi:** zkFetch ile kanıt üretir, kanıtı taşır ve işlem ücretini öder. **Fonlar üzerinde hiçbir yetkisi yoktur.**
- **Reclaim attestor:** TLS oturumunu imzalar.
- **Self:** kimlik kanıtını üretir.

## 5. Kampanya yaşam döngüsü

```
kurulum ─▶ katılım ─▶ kayıt (açılış kanıtı) ─▶ [ dönem e: içerik ─▶ kanıt ─▶ itiraz ─▶ hakem ─▶ settle ─▶ claim ] × E ─▶ kalıcılık ─▶ iade
```

### 5.1 Zaman çizelgesi (dönem `e`, 0'dan başlar)

```
content_start(e) = start + e·epoch_len
content_end(e)   = start + (e+1)·epoch_len
proof_end(e)     = content_end(e) + proof_window          ← kapanış kanıtları burada
challenge_end(e) = proof_end(e) + dispute_window/2        ← itiraz açma
dispute_end(e)   = proof_end(e) + dispute_window          ← itiraza cevap
settle_at(e)     = dispute_end(e) + arbiter_window        ← hakem kararı; sonra settle
```

**Kısıt:** `epoch_len ≥ proof_window + dispute_window + arbiter_window`. Böylece dönem `e`'nin oranı (`r_eff`), dönem `e+1`'in kanıtları gelmeden önce kesinleşir.

**Kalıcılık (son dönemin holdback'i):**
```
alive_start = content_end(last) + retention_delay     (retention_delay ≥ proof+dispute+arbiter)
alive_end   = alive_start + proof_window
refund_at   = alive_end + claim_grace
```

### 5.2 Adımlar

1. **Kurulum:** `create_campaign`. Marka parametreleri belirler (bkz. §6) ve bütçeyi kontrata transfer eder. Kurallar değişmezdir.
2. **Tek insan:** Clipper Self uygulamasında kanıt üretir; scope `cliprail-<campaignId>`. Verifier doğrular ve `humanity.register(campaign, nullifier, wallet)` çağrısını yapar (Seviye 1). Hackathon yedeği: relayer ile "demo modu" kaydı.
3. **Katılım:** `join`. `require_humanity` açıksa `humanity.is_verified` kontrol edilir. Clipper'a `CR-XXXXXX` biçiminde bir kod verilir (6 karakter, `sha256(campaign_id ‖ participant)` değerinden türetilir).
4. **Kayıt:** `register_clip`. Clipper linki verir; verifier **açılış kanıtı** üretir: açıklamada kod var ve şu anki izlenme şu.
   - Kontrat şunları kontrol eder: imza, URL = platform şablonu + video_id, açıklamada kod, kanıtın taze olması, kanıtın daha önce kullanılmamış olması.
   - **Global kayıt defteri:** `(platform, video_id)` yalnızca bir kez kaydedilebilir.
   - `baseline = views`: sadece bundan sonraki artış sayılır. Önceden viral olmuş bir videoya sonradan kod ekleme saldırısı böylece kapanır.
5. **Kapanış kanıtı** (her dönem, `[content_end, proof_end]` arasında): `submit_proof`. Kanıtı herkes gönderebilir; aynı dönem içinde son gönderim geçerlidir.
   ```
   w_clip   = views ≥ baseline_e ? min(views − baseline_e, cap_views_clip) : 0 ;  w_clip < min_views ⇒ 0
   raw_p    = Σ w_clip   (katılımcının o dönemdeki klipleri)
   w_p      = min(raw_p, cap_views_human)
   W_e      = Σ w_p
   hwm      = max(hwm, views)     → bir sonraki dönemin baseline'ı (düşen, sonra tekrar yükselen izlenme iki kez ödenmez)
   ```
   Aynı kanıt, bir önceki dönemin holdback'i için **canlılık kanıtı** da sayılır.
6. **İtiraz** (teminatlı, bkz. §7): dışlanan klibin ağırlığı `W_e`'den düşülür.
7. **Settle** (`settle_epoch`, `settle_at(e)` sonrası, açık itiraz yoksa, sırayla):
   ```
   budget_e = B/E (+ son dönem ise kalan artık) + carry_e
   r_eff_e  = W_e == 0 ? 0 : min(r_max, 1000·budget_e / W_e)
   spent_e  = r_eff_e · W_e / 1000
   carry_{e+1} = budget_e − spent_e
   ```
8. **Claim** (`claim`, klip-dönem başına, O(1)):
   ```
   pay  = r_eff_e · w_p · w_clip / (raw_p · 1000)
   held = pay · holdback_bps / 10000        immediate = pay − held   → hemen ödenir
   ```
9. **Holdback:**
   - Dönem `e`'nin tutulan payı, klip dönem `e+1` için kapanış kanıtı gönderirse serbest kalır. Son dönem için `prove_alive`, `[alive_start, alive_end]` arasında yapılır.
   - Sağ kalanlar, dönemin tüm tutulan payını oransal paylaşır. Silinen videonun payı böylece sağ kalanlara geçer.
   ```
   held_total_e     = spent_e · holdback_bps / 10000
   held_survived_e  = Σ held_i (canlılık kanıtı gelen klipler)
   holdback_claim_i = held_i · held_total_e / held_survived_e
   ```
10. **İade:** `refund`, `refund_at` sonrası. Kampanyanın kalan bakiyesi markaya döner: harcanmayan bütçe, canlılık kanıtı gelmeyen holdback ve süresi içinde claim edilmemiş paylar.

**Muhasebe değişmezi:** Her kampanyanın ayrı bir bakiye defteri (`balance`) vardır. Her çıkış bu bakiyeden düşülür ve bakiyeyi aşamaz (kuruş yuvarlama hatalarına karşı kırpılır). Teminatlar ayrı defterde tutulur.

## 6. Kampanya parametreleri

| Parametre | Anlam | Demo değeri |
|---|---|---|
| `token` | USDC SAC adresi | test USDC |
| `budget` | Toplam bütçe (7 ondalık) | 500 USDC |
| `rate_max_per_1k` | 1000 izlenme başına tavan oran | 1 USDC |
| `cap_views_clip` | Klip başına dönem tavanı (izlenme) | 50 000 |
| `cap_views_human` | İnsan başına dönem tavanı | 100 000 |
| `min_views` | Klip-dönem eşiği | 100 |
| `start`, `epoch_len`, `epochs` | Zaman çizelgesi | şimdi+60 sn, 300 sn, 2 |
| `proof_window` / `dispute_window` / `arbiter_window` | Pencereler | 90 / 90 / 60 sn |
| `retention_delay`, `claim_grace` | Kalıcılık ve iade | 240 / 300 sn |
| `holdback_bps` | Tutma payı | 2000 (%20) |
| `bond` | İtiraz teminatı | 5 USDC |
| `arbiter` | Hakem adresi | ekip adresi |
| `platforms` | İzinli platformlar | `youtube`, `demo` |
| `require_humanity` | Self zorunlu mu | true |

## 7. Teminatlı itiraz

```
challenge   [proof_end, challenge_end)   herkes; `bond` yatırır; klip-dönem "Challenged"
respond     [.., dispute_end)            yalnız klip sahibi; `bond` yatırır → "Responded"
resolve     [dispute_end, settle_at)     yalnız hakem; kaybedenin teminatı kazanana
finalize    herkes:
            Challenged ve now ≥ dispute_end  → itiraz eden kazanır (teminatı iade, klip dışlanır)
            Responded  ve now ≥ settle_at    → clipper kazanır (iki teminat clipper'a)
```

- Klip-dönem başına en fazla bir itiraz açılabilir.
- Açık itirazlar sonuçlanmadan `settle_epoch` çalışmaz.
- Dışlanan klibin ağırlığı `raw_p`, `w_p` ve `W_e`'den düşülür. Bu pay kimseye özel gitmez; `r_eff` üzerinden diğer katılımcılara yayılır (bütçe sabit, W küçülür).
- **Yol haritası:** kanıtla otomatik çözüm (örneğin "video silindi" iddiası zkTLS ile kanıtlanır), itiraz edene ödül payı, clipper teminatının kazançtan kilitlenmesi.

## 8. Doğrulama katmanı (Reclaim zkTLS)

### 8.1 Provider config (`config/providers.json`)

| Platform | Kanıt kaynağı | URL şablonu | Regex'ler |
|---|---|---|---|
| `youtube` | Verifier, zkFetch ile (API anahtarı gizli header'da) | `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id={id}` | `"viewCount":"(?<views>\d+)"`, `"description":"(?<desc>(?:[^"\\]|\\.)*)"` |
| `demo` | Verifier, zkFetch ile | `https://<public-host>/demo/videos/{id}` | aynı alan adları |

**Neden `demo` platformu var:** Gerçek YouTube sayıları dakikalar içinde değişmez ve API gecikmeli günceller. Canlı demoda izlenme artışını gösterebilmek için bizim kontrol ettiğimiz bir HTTPS JSON uç noktasını **gerçek zkTLS ile** kanıtlıyoruz. Pitch'te bunu açıkça söylüyoruz. YouTube yolu da gerçek bir kanıtla gösteriliyor.

### 8.2 Kontrat içi kontrol (`reclaim-verify` kütüphanesi)

1. `identifier = keccak256("http\n" ‖ parameters ‖ "\n" ‖ context)`
2. `serialized = "0x" ‖ hex(identifier) ‖ "\n" ‖ owner ‖ "\n" ‖ timestampS ‖ "\n" ‖ epoch`
3. `digest = keccak256("\x19Ethereum Signed Message:\n" ‖ len(serialized) ‖ serialized)`
4. `secp256k1_recover(digest, sig, rec_id)` → `keccak(pubkey[1..])[12..]` ∈ `attestors`
5. `owner` ∈ `allowed_owners` (bizim zkFetch APP_ID'miz)
6. `parameters`, `"url":"<prefix><video_id><suffix>"` alt dizisini ve platformun beklenen `responseMatches` regex'lerini içermeli. Aksi halde kanıtlayan kişi başka bir alanı yakalayan bir regex seçebilir.
7. `context.extractedParameters` içinden `"views":"<rakamlar>"` → u64; `"desc":"…"` içinde katılımcının kodu aranır.
8. `identifier` daha önce kullanılmamış olmalı; `timestampS` ilgili pencerede olmalı.

Kesin JSON biçimi (JCS kanonik sıralaması) spike'ta gerçek bir kanıttan çıkarılır ve `docs/reclaim-notes.md` + `fixtures/`'a kaydedilir.

**Maliyet:** yaklaşık 30M talimat (limit 400M).

## 9. Kimlik katmanı (Self)

- **Seviye 1 (hackathon hedefi):** Kanıt Self SDK ile off-chain doğrulanır (testte `mockPassport`, Celo Sepolia). Relayer `humanity.register` çağırır. Güven noktası relayer'dır, bunu beyan ediyoruz.
- **Seviye 2 (stretch veya yol haritası):** `vc_and_disclose` Groth16/BN254 kanıtı Soroban'da doğrulanır, yaklaşık 50M talimat.
  - Kontroller: `scope`, `current_date`, `user_identifier == wallet`.
  - Celo'daki kimlik kökünü bir oracle Stellar'a taşır.
  - Araçlar: `soroban-examples/groth16_verifier`, `soroban-verifier-gen`.
- **Yedek:** `humanity` kontratında relayer'ın manuel kaydı ("demo modu").
- **Sınırlar:**
  - Kimlik kiralanabilir ve canlılık (liveness) kontrolü yok. Sybil maliyeti yaklaşık $2'dan gerçek bir kimliğin fiyatına çıkar.
  - Self'in eski SDK'sı deprecation uyarısı veriyor.

## 10. Bileşenler

```
apps/web                 Next.js — marka paneli, clipper paneli, public kampanya sayfası, hakem sayfası
services/verifier        Node/TS — zkFetch (youtube, demo), kanıt cache'i, relay, demo platform uç noktası, Self doğrulama
contracts/reclaim-verify Rust lib — identifier, EIP-191, secp256k1 recover, bayt tarama
contracts/cliprail       Soroban — kampanyalar, global video kaydı, dönemler, itiraz, claim, holdback, iade
contracts/humanity       Soroban — kampanya başına nullifier kaydı
packages/*-client        Kontratlardan üretilmiş TS bindings
config/providers.json    Platform tanımları
fixtures/                Gerçek kanıt örnekleri (testler için)
```

## 11. Güven noktaları

| Güvenilen taraf | Ne yapabilir | Hafifletme |
|---|---|---|
| Reclaim attestor (tek anahtar) | Sahte sayı imzalayabilir | TEE modu; attestor listesi admin'de (üretimde timelock) |
| Platform | Bot izlenmeyi sayıya katar | Gecikme, tavan, itiraz |
| Self relayer (Seviye 1) | Sahte nullifier yazabilir | Seviye 2'de ZK doğrulaması on-chain |
| Marka | Keyfi itiraz edebilir | Teminat; dışlanan pay markaya dönmez |
| Hakem | Taraflı karar verebilir | Sadece cevaplanmış itirazlarda devreye girer; süre dolarsa clipper kazanır |
| Verifier servisi | Hiçbir şey (sadece kanıt taşır) | Kanıtı herkes gönderebilir |
| Admin | Attestor, owner ve platform config'ini değiştirebilir | Üretimde timelock ve multisig |

## 12. Saldırı ve karşılık tablosu (her satırın bir testi var)

| # | Saldırı | Karşılık |
|---|---|---|
| A1 | Aynı kanıtı tekrar göndermek | `used_identifiers` |
| A2 | Aynı videoyu iki kampanyaya kaydetmek | Global `(platform, video_id)` kaydı |
| A3 | Viral bir videoya sonradan kod eklemek | Açılış kanıtıyla alınan baseline |
| A4 | Başka bir URL veya video için kanıt | URL şablonu kontrolü |
| A5 | Başka bir regex ile kanıt | `responseMatches` kontrolü |
| A6 | Açıklamada kod yok, ya da başkasının kodu var | Kod araması |
| A7 | Eski veya gelecekteki zaman damgası | Pencere kontrolü |
| A8 | Yetkisiz attestor imzası | Adres listesi |
| A9 | Sybil: aynı kişi ikinci cüzdanla katılıyor | `humanity` nullifier'ı |
| A10 | Tavan aşımı, çok klip | Klip tavanı + insan tavanı |
| A11 | Bütçe aşımı | Oransal ödeme + bakiye kırpma |
| A12 | Düşen, sonra tekrar yükselen izlenme | Yüksek su işareti (HWM) |
| A13 | Çift claim | `claimed` bayrağı |
| A14 | İtirazlı klip claim edilmeye çalışılıyor | Settle, açık itiraz varken bloklu |
| A15 | Hakem olmayan birinin kararı | `require_auth(arbiter)` |
| A16 | Erken iade | `refund_at` |
| A17 | Video silindi | Canlılık kanıtı yok, holdback yanar |

## 13. Kapsam dışı (hackathon)

Mainnet, gerçek para, Instagram, X ve TikTok cihaz akışı, Seviye 2 on-chain Groth16 (stretch), SEP-24 nakde çevirme (sadece slayt), passkey cüzdan (stretch), anonim claim, analytics/OAuth, gelişmiş bot tespiti.

## 14. Yol haritası

1. **Kısa vade:**
   - TikTok, X ve Instagram için clipper cihazından Reclaim akışı. Oturum çerezleri ZK ile gizli kalır.
   - Passkey cüzdan ve fee sponsorship.
   - SEP-24 ve MoneyGram ile nakde çevirme.
2. **Orta vade:**
   - Self Seviye 2 (on-chain Groth16) ve kök oracle'ı.
   - Kanıtla otomatik itiraz çözümü.
   - Hibrit ödeme: izlenme + dönüşüm (CPA).
3. **Uzun vade:**
   - B2B "kanıtlanabilir kampanya rayları" SDK'sı.
   - SDP entegrasyonu ("SDP dağıtır, ClipRail neyin ödeneceğini kanıtlar").
   - Anonim claim ve viewing key.
   - Çoklu attestor.
