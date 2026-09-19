# ClipRail — Proje Devir Dokümanı (Handoff)

> **Kime:** Sena ve Kerem (ve projeye sonradan katılacak herkes)
> **Ne zaman:** 19 Eylül 2026 · Teslim: 20 Eylül 2026 akşamı
> **Repo:** https://github.com/KayaKerem/cliprail-stellar · **Görevler:** GitHub Projects → "ClipRail Hackathon"

---

## 1. Bir paragrafta ClipRail

Markalar, içeriklerinin sosyal medyada yayılması için "clipper" denen kişilere izlenme başına para öder. Bugün bu işi yapan platformlar (Whop, Vyro gibi) kuralları istedikleri zaman değiştirebiliyor, izlenmeyi kendi söyledikleri gibi sayıyor ve ödemeyi "tamamen kendi takdirimize göre" yapıyor. ClipRail'de marka bütçeyi Stellar üzerindeki bir akıllı kontrata kilitler. İzlenme sayısı kriptografik kanıtla (zkTLS) kontrata gelir. Her katılımcının gerçek ve tek bir insan olduğu sıfır bilgi kanıtıyla (ZK) doğrulanır. Para, kontratta yazılı değişmez kurallarla ve herkese adil biçimde USDC olarak dağıtılır.

## 2. Basitleştirilmiş anlatım

Bir **kumbara** düşün:

1. Marka kumbaraya 500 USDC koyar. Kumbaranın üstünde kurallar yazılıdır: "1000 izlenme başına en fazla 1 USDC, kişi başı şu kadar tavan, her 5 dakikada bir dağıtım." **Bu kurallar sonradan değiştirilemez.**
2. Clipper önce "ben gerçek ve tek bir insanım" der ve bunu kimliğini göstermeden kanıtlar. Kumbara ona `CR-7K3X9A` gibi bir kod verir.
3. Clipper videoyu paylaşır ve açıklamaya kodu yazar. Linki sisteme girer. Bu anda izlenme sayısının "başlangıç" fotoğrafı çekilir.
4. Her dönemin sonunda izlenme sayısının "bitiş" fotoğrafı çekilir. Bu fotoğrafı **YouTube'un sunucusu imzalamış gibi** düşün: kimse sayıyı değiştiremez (zkTLS).
5. Kısa bir itiraz süresi vardır. Bot izlenme gördüğünü düşünen kişi teminat yatırıp itiraz eder. Clipper cevap vermezse klip dışlanır ve payı **diğer clipper'lara** dağıtılır; markaya geri dönmez.
6. Süre dolunca kumbara parayı herkesin izlenme payına göre böler. Herkes kendi payını çeker.
7. Payın küçük bir kısmı (%20) bekletilir. Video bir sonraki dönemde hâlâ yayındaysa ödenir. Silinmişse o para videosunu tutan diğer clipper'lara gider.
8. Kampanya bitince kalan para markaya döner.

## 3. Ne **yapıyoruz**, ne **yapmıyoruz**

| Yapıyoruz ✅ | Yapmıyoruz ❌ |
|---|---|
| Stellar **testnet** üzerinde çalışan bir demo | Mainnet, gerçek para |
| YouTube + "demo" platformu (kontrollü, gerçek zkTLS kanıtıyla) | TikTok, Instagram, X (yol haritasında) |
| Public link + herkese açık izlenme sayısı | Kazıma botları, kanal analytics'i veya OAuth |
| Kanıtın **kontrat içinde** doğrulanması | "Backend söyledi, inan" modeli |
| Oransal, dönemli dağıtım + holdback + teminatlı itiraz | "İlk gelen alır" yarışı |
| Self ile tek insan kaydı (yedek: demo kaydı) | Tam on-chain kimlik ZK doğrulaması (stretch) |
| Freighter cüzdanı | Passkey, SEP-24 nakde çevirme (stretch veya slayt) |
| "Sayı doğru, kişi tek, kurallar değişmez" | "Bot izlenmeyi tamamen çözdük" iddiası (**çözmüyoruz**, hafifletiyoruz) |

## 4. Neden önemli, neden Stellar?

- **Pazar gerçek:** Whop yalnızca bu işe günde $40k+ ödüyor. MrBeast destekli Vyro var. Kick yayıncıları 1000 izlenme için $30'a kadar ödüyor.
- **Dert gerçek:**
  - Keyfi red, 90 güne varan beklemeler.
  - Ajans kesintileriyle clipper'ın eline geçen %55–70.
  - Bot skandalları: bir marka $1.500 ödedi, izlenmelerin neredeyse hepsi bot çıktı.
  - Hindistan, Filipinler ve Latin Amerika'daki clipper'lar PayPal'a erişemiyor.
- **Rakiplerin hiçbiri doğrulamayı kanıtlayamıyor.** Solana'da benzer escrow projeleri var ama hepsi "sunucumuza güvenin" modelinde.
- **Stellar'ın katkısı:**
  - Yerel USDC ve işlem başı ~$0.00001 ücret, yani minimum ödeme eşiği gerekmiyor.
  - Anchor ağı ve MoneyGram ile clipper'ın ülkesinde nakde çevirme.
  - Protocol 25/26 ile gelen kriptografi fonksiyonları: secp256k1, BN254, Poseidon.
- **Stellar'a katkımız:**
  - Stellar'da ilk gerçek "zkTLS ile doğrulanmış ödeme" örneği.
  - Gelişmekte olan pazarlarda organik USDC akışı.
  - Stellar Disbursement Platform'u (SDP) tamamlayan bir katman: "SDP dağıtır, ClipRail neyin ödeneceğini kanıtlar."

## 5. Mimari tek bakışta

```
 [Marka] ──create_campaign──┐                        ┌──claim── [Clipper]
                            ▼                        │
                   ┌──────────────────────┐          │
                   │  cliprail (Soroban)  │──────────┘
                   │ escrow · dönemler ·  │◀── submit_proof / register_clip
                   │ itiraz · holdback    │        (Reclaim kanıtı)
                   └─────────┬────────────┘
                 is_verified │                ▲
                   ┌─────────▼──────┐         │
                   │ humanity       │   [Verifier servisi]
                   │ (nullifier)    │    ├─ zkFetch → YouTube API / demo uç noktası
                   └────────▲───────┘    ├─ kanıt cache + relay (ücret öder, fona dokunamaz)
                            └────────────┴─ Self doğrulama → humanity.register
```

Ayrıntı: `docs/ARCHITECTURE.md`. Fonksiyon imzaları: `docs/INTERFACES.md`.

## 6. Kim ne yapıyor?

- **Sena (web):** Tüm arayüz.
  - Sayfalar: landing, kampanya oluşturma, public kampanya sayfası, katılım, klip kaydı, clipper paneli, marka paneli, hakem sayfası.
  - Önce mock veriyle çalışır. Kontrat testnet'e çıkınca (M2, ~20 Eyl 11:00) gerçek kontrata bağlanır.
  - Sözleşmesi `docs/INTERFACES.md` §5'teki `CliprailApi` arayüzü.
- **Kerem (+ Claude):**
  - Kontratlar: `cliprail`, `humanity`, `reclaim-verify`.
  - Verifier servisi (zkFetch, relay, demo uç noktası, Self).
  - Testnet deploy, bindings, seed scripti, README.
- **Birlikte:** uçtan uca prova, demo videosu, gönderim.

## 7. Yol haritası (bugün → sonrası)

1. **Hackathon (bu hafta sonu):** yukarıdaki ✅ listesi.
2. **Kısa vade:**
   - TikTok, X ve Instagram için clipper'ın kendi cihazından kanıt üretmesi. Oturum bilgileri ZK ile gizli kalır.
   - Passkey cüzdan: seed phrase yok, XLM gerekmez.
   - SEP-24 ve MoneyGram ile nakde çevirme.
3. **Orta vade:**
   - Kimlik ZK kanıtının tamamen on-chain doğrulanması (Self Seviye 2).
   - Kanıtla otomatik itiraz çözümü ("video silindi" iddiasının kanıtla doğrulanması).
   - İzlenme + dönüşüm (CPA) hibrit ödeme.
4. **Uzun vade:**
   - Ajanslara ve platformlara satılan "kanıtlanabilir kampanya rayları" SDK'sı.
   - SDP entegrasyonu.
   - Anonim claim.
   - Birden fazla attestor.

## 8. Geliştirme planı (özet)

| Kilometre taşı | Saat | Tamamlanınca ne çalışıyor |
|---|---|---|
| M0 Kurulum | 19 Eyl 20:30 | Repo, araçlar, web iskeleti + cüzdan, ilk zkFetch denemesi |
| M1 Çekirdek | 20 Eyl 01:00 | Kontrat çekirdeği testleriyle; web sayfaları mock ile |
| M2 Testnet | 20 Eyl 11:00 | Kontratlar testnet'te; web gerçek kontrata bağlanıyor; verifier servisi çalışıyor |
| M3 Uçtan uca | 20 Eyl 15:00 | Tüm akış testnet'te web üzerinden çalışıyor |
| M4 Teslim | 20 Eyl 17:30 | README, demo videosu, gönderim |

- **Gecikme kuralı:** Bir kilometre taşı 1 saatten fazla gecikirse P1 işler kesilir. Sıra: Self → canlılık kanıtı → hakem → landing cilası.
- **Uyku:** 01:00–07:00 arası. Yorgun kod yazmak, sabah hata ayıklamaktan daha pahalıya gelir.

## 9. Yapılacaklar (özet — ayrıntılar issue'larda)

**Sena:**
- S01 Web iskeleti
- S02 Cüzdan
- S03 Mock API
- S04 Ortak bileşenler
- S05 Kampanya sayfası
- S06 Kampanya formu
- S07 Katılım
- S08 Klip kaydı
- S09 Clipper paneli
- S10 Marka paneli
- S11 Hakem sayfası
- S12 Gerçek kontrata bağlama
- S13 Landing + cila

**Kerem:**
- K01 Monorepo
- K02 Testnet hesapları ve USDC
- K03 Reclaim spike
- K04 Demo platform
- K05 reclaim-verify
- K06–K12 cliprail kontratı
- K13 Saldırı testleri
- K14 humanity
- K15 Deploy ve bindings
- K16 Verifier servisi
- K17 Self
- K18 Demo scripti
- K19 README

**Birlikte:**
- X01 Uçtan uca prova
- X02 Demo videosu
- X03 Gönderim

**Stretch (bitmese de olur):**
- R01 On-chain kimlik ZK
- R02 TikTok/X
- R03 Passkey
- R04 SEP-24

Tüm P0 ve P1 görevleri kapandığında proje biter.

## 10. Nasıl çalışıyoruz?

- **Arayüz sözleşmesi kutsal:** `docs/INTERFACES.md` değişecekse önce diğer kişiye haber verilir.
- **Görev akışı:** Görev GitHub Projects'te "In Progress" sütununa çekilir, bitince "Done"a. Takılırsan issue'ya yorum yaz ve diğer kişiyi etiketle.
- **Branch'ler:** `kerem/<konu>`, `sena/<konu>`. Küçük PR'lar açılır; `main` her zaman çalışır durumda tutulur.
- **Gizli bilgiler:** `.env` dosyaları repoya girmez. Örnekler `.env.example` dosyalarında.
- **Testnet:** Hesap anahtarları `scripts/.accounts` içinde (git'e girmez). Sena'ya gerekli public key'ler `INTERFACES.md` §6'da.

## 11. Sözlük

| Terim | Anlamı |
|---|---|
| **Clipper** | Kampanya içeriğini kendi hesabında paylaşıp izlenme başına kazanan kişi |
| **Escrow** | Paranın kurallar sağlanana kadar kontratta kilitli durması |
| **Soroban** | Stellar'ın akıllı kontrat platformu (Rust ile yazılır) |
| **zkTLS / Reclaim** | Bir web sitesinin gerçekten şu cevabı verdiğini kanıtlayan teknoloji; kanıtı bir "attestor" imzalar |
| **zkFetch** | Reclaim'in "bu URL'yi çek ve kanıtla" kütüphanesi |
| **Nullifier** | ZK kimlik kanıtından çıkan, kişiyi ifşa etmeyen ama aynı kişinin ikinci kez katılmasını engelleyen sayı |
| **Self** | Pasaport veya Aadhaar ile ZK kimlik kanıtı üreten uygulama |
| **Dönem (epoch)** | Ödemelerin dağıtıldığı zaman dilimi |
| **Baseline / HWM** | Başlangıç izlenmesi / şimdiye kadarki en yüksek kanıtlanmış izlenme |
| **Oransal dağıtım** | Bütçenin, herkesin izlenme payına göre bölünmesi (`r_eff = min(r_max, 1000·B/W)`) |
| **Holdback** | Ödemenin, video yayında kalırsa serbest kalan kısmı |
| **Teminatlı itiraz** | İtiraz edenin ve cevap verenin para yatırdığı, kaybedenin teminatını kaybettiği itiraz |
| **SAC** | Stellar Asset Contract: klasik varlığın (USDC) kontratta kullanılan hali |
| **Bindings** | Kontrattan otomatik üretilen TypeScript istemci kodu |

## 12. Pitch'te dürüst olacağımız noktalar

1. zkTLS, platformun **gösterdiği** sayıyı kanıtlar. İzleyicinin gerçek insan olduğunu kanıtlamaz. Bunu gecikme, tavan ve itirazla hafifletiriz.
2. Reclaim şu an tek bir attestor anahtarıyla çalışıyor. Güven "tek bir sunucu" yerine "üçüncü taraf, imzalı ve TEE destekli" bir yapıya geçiyor, "trustless" değil.
3. Self kaydı hackathon'da relayer üzerinden yapılıyor. On-chain ZK doğrulaması hazır bir yol ama yol haritasında.
4. Kimlik kiralanabilir. Sybil maliyeti ~$2'dan gerçek bir kimliğin fiyatına çıkar, sıfırlanmaz.
5. Canlı demoda izlenme artışı için kontrol ettiğimiz "demo" platformunu kullanıyoruz. Kanıt yine gerçek zkTLS kanıtı.
