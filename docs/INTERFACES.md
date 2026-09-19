# ClipRail — Arayüz Sözleşmesi (INTERFACES)

> Web (Sena) ile kontrat ve servis (Kerem) arasındaki **dondurulmuş** sözleşme budur. Değişiklik gerekirse önce bu dosya güncellenir, sonra iki taraf haberdar edilir.
> Sürüm: v1 (19 Eylül 2026). Testnet kontrat ID'leri deploy sonrası §6'ya yazılır.

## 1. Genel kurallar

- **Ağ:** Stellar **testnet**. RPC `https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`.
- **Tutarlar:** `i128`, 7 ondalık (1 USDC = `10_000_000`). UI'da gösterirken 10^7'ye böl.
- **Zaman:** `u64` Unix saniye (ledger zamanı).
- **İzlenme:** `u64`.
- **Kimlikler:** `campaign_id: u64` ve `clip_id: u64` otomatik artar, 1'den başlar. `epoch: u32` 0'dan başlar.
- **Platform:** `Symbol`. Değerler: `"youtube"`, `"demo"`.
- **Kod biçimi:** `"CR-XXXXXX"`. X ∈ `[0-9A-Z]` (base36), toplam 9 karakter.

## 2. `cliprail` kontratı

### 2.1 Tipler

```rust
pub struct CampaignParams {
    pub token: Address,
    pub budget: i128,
    pub rate_max_per_1k: i128,
    pub cap_views_clip: u64,
    pub cap_views_human: u64,
    pub min_views: u64,
    pub start: u64,
    pub epoch_len: u64,
    pub epochs: u32,
    pub proof_window: u64,
    pub dispute_window: u64,
    pub arbiter_window: u64,
    pub retention_delay: u64,
    pub claim_grace: u64,
    pub holdback_bps: u32,          // 0..=10000
    pub bond: i128,
    pub arbiter: Address,
    pub platforms: Vec<Symbol>,
    pub require_humanity: bool,
    pub title: String,              // UI için, ≤ 64 bayt
    pub brief_url: String,          // kaynak video / brief linki, ≤ 200 bayt
}

pub struct Campaign {
    pub id: u64,
    pub brand: Address,
    pub params: CampaignParams,
    pub balance: i128,              // kampanyanın kontrattaki kalan bakiyesi
    pub settled_epochs: u32,        // kaç dönem settle edildi
    pub refunded: bool,
    pub participants: u32,
    pub clips: u32,
}

pub struct Participant {
    pub address: Address,
    pub code: String,               // "CR-XXXXXX"
    pub joined_at: u64,
}

pub struct Clip {
    pub id: u64,
    pub campaign_id: u64,
    pub owner: Address,
    pub platform: Symbol,
    pub video_id: String,
    pub baseline: u64,              // açılış kanıtındaki izlenme
    pub hwm: u64,                   // şimdiye kadarki en yüksek kanıtlanmış izlenme
    pub registered_at: u64,
    pub first_epoch: u32,           // kayıt anındaki dönem (start öncesi ise 0)
}

pub enum ClipEpochStatus { Active, Challenged, Responded, Excluded }

pub struct ClipEpoch {
    pub baseline: u64,              // bu dönemin başlangıç değeri (ilk gönderimde sabitlenir)
    pub views: u64,                 // son kabul edilen kapanış değeri
    pub weight: u64,                // w_clip
    pub status: ClipEpochStatus,
    pub claimed: bool,
    pub alive: bool,                // holdback canlılık kanıtı geldi mi
    pub holdback_claimed: bool,
}

pub struct ParticipantEpoch { pub raw: u64, pub weight: u64 }   // raw_p, w_p

pub struct EpochState {
    pub total_weight: u64,          // W_e
    pub open_disputes: u32,
    pub settled: bool,
    pub budget: i128,               // settle sonrası dolu
    pub rate: i128,                 // r_eff (1000 izlenme başına), settle sonrası
    pub spent: i128,
    pub held_total: i128,
    pub held_survived: i128,
}

pub enum Phase { NotStarted, Content, Proof, Challenge, Response, Arbiter, Settled }

pub struct PhaseInfo {                // UI zaman çizelgesi için
    pub current_epoch: u32,           // şu an içerik dönemi; son dönemden sonra = epochs
    pub phase_of_last_closed: Phase,  // en son biten dönemin aşaması
    pub content_end: u64, pub proof_end: u64, pub challenge_end: u64,
    pub dispute_end: u64, pub settle_at: u64,
    pub alive_start: u64, pub alive_end: u64, pub refund_at: u64,
}

pub struct Quote { pub pay: i128, pub immediate: i128, pub held: i128, pub holdback_payout: i128 }

pub enum DisputeStatus { Open, Responded, ChallengerWon, ClipperWon }

pub struct Dispute {
    pub id: u64,
    pub campaign_id: u64, pub clip_id: u64, pub epoch: u32,
    pub challenger: Address,
    pub evidence: String,            // kanıt linki veya hash, ≤ 200 bayt
    pub status: DisputeStatus,
    pub opened_at: u64,
}

pub struct ReclaimProof {             // verifier servisi üretir; web ScVal'e çevirip iletir
    pub parameters: Bytes,            // JCS kanonik JSON (bayt bayt aynen)
    pub context: Bytes,               // JCS kanonik JSON
    pub owner: Bytes,                 // "0x…" küçük harf ASCII
    pub timestamp_s: u64,
    pub epoch: u32,                   // Reclaim epoch (bizim dönemimizle karıştırma)
    pub signature: BytesN<64>,        // r‖s
    pub recovery_id: u32,             // 0 veya 1
}
```

### 2.2 Fonksiyonlar

| Fonksiyon | Yetki (auth) | Ne zaman | Açıklama |
|---|---|---|---|
| `init(admin: Address, humanity: Address)` | — | bir kez | |
| `set_attestors(attestors: Vec<BytesN<20>>)` | admin | her zaman | |
| `set_owners(owners: Vec<Bytes>)` | admin | her zaman | izinli zkFetch APP_ID'leri |
| `set_platform(platform: Symbol, url_prefix: Bytes, url_suffix: Bytes, required: Vec<Bytes>)` | admin | her zaman | `required` = parameters içinde bulunması zorunlu alt diziler (regex'ler) |
| `create_campaign(brand: Address, params: CampaignParams) -> u64` | brand | her zaman | parametreleri doğrular; `budget` brand'den kontrata transfer edilir |
| `join(campaign_id: u64, participant: Address) -> String` | participant | `now < content_end(last)` | koda döner; humanity kontrolü yapılır |
| `register_clip(campaign_id: u64, participant: Address, platform: Symbol, video_id: String, proof: ReclaimProof) -> u64` | participant | `now < content_end(last)` | açılış kanıtı |
| `submit_proof(campaign_id: u64, clip_id: u64, epoch: u32, proof: ReclaimProof)` | yok | `[content_end(e), proof_end(e)]` | kapanış kanıtı; aynı zamanda e−1 için canlılık kanıtı |
| `prove_alive(campaign_id: u64, clip_id: u64, proof: ReclaimProof)` | yok | `[alive_start, alive_end]` | son dönemin holdback'i için |
| `challenge(campaign_id: u64, clip_id: u64, epoch: u32, challenger: Address, evidence: String) -> u64` | challenger | `[proof_end(e), challenge_end(e))` | teminat transfer edilir |
| `respond(dispute_id: u64)` | klip sahibi | `< dispute_end(e)` | teminat transfer edilir |
| `resolve(dispute_id: u64, clipper_wins: bool)` | arbiter | `[dispute_end, settle_at)`, sadece Responded durumda | |
| `finalize_dispute(dispute_id: u64)` | yok | §7 kuralları | |
| `settle_epoch(campaign_id: u64, epoch: u32)` | yok | `≥ settle_at(e)`, `open_disputes == 0`, önceki dönem settle edilmiş | |
| `claim(campaign_id: u64, clip_id: u64, epoch: u32) -> i128` | yok (ödeme sahibine gider) | settle sonrası, `< refund_at` | immediate kısmı öder |
| `claim_holdback(campaign_id: u64, clip_id: u64, epoch: u32) -> i128` | yok | canlılık penceresi bittikten sonra, `< refund_at` | |
| `refund(campaign_id: u64) -> i128` | yok (ödeme markaya gider) | `≥ refund_at` | |

**Okuma fonksiyonları (simülasyonla çağrılır, ücretsiz):**

| Fonksiyon | Dönüş |
|---|---|
| `get_campaign(id)` | `Campaign` |
| `get_phase(id)` | `PhaseInfo` |
| `get_epoch(id, e)` | `EpochState` |
| `get_participant(id, addr)` | `Option<Participant>` |
| `get_clip(clip_id)` | `Clip` |
| `get_clip_epoch(clip_id, e)` | `Option<ClipEpoch>` |
| `get_participant_epoch(id, addr, e)` | `ParticipantEpoch` |
| `list_clips(id, from: u32, limit: u32)` | `Vec<Clip>` (kampanya içindeki sıra) |
| `list_participant_clips(id, addr)` | `Vec<u64>` |
| `get_dispute(dispute_id)` | `Dispute` |
| `list_disputes(id)` | `Vec<u64>` |
| `quote(id, clip_id, e)` | `Quote` (settle öncesi tahmini: o anki `W` ile) |
| `campaign_count()` | `u64` |

### 2.3 Hatalar (`#[contracterror]`, kod numaraları sabit)

```
1  AlreadyInitialized      2  NotInitialized        3  InvalidParams
4  CampaignNotFound        5  NotJoined             6  AlreadyJoined
7  NotHuman                8  WrongPhase            9  PlatformNotAllowed
10 VideoAlreadyRegistered  11 ClipNotFound          12 BadSignature
13 UnknownAttestor         14 UnknownOwner          15 UrlMismatch
16 MatchMismatch           17 CodeNotFound          18 ViewsParseError
19 ProofReused             20 ProofExpired          21 EpochNotReady
22 EpochOutOfRange         23 AlreadySettled        24 OpenDisputes
25 AlreadyClaimed          26 NothingToClaim        27 AlreadyDisputed
28 DisputeNotFound         29 NotArbiter            30 NotClipOwner
31 Excluded                32 RefundNotReady        33 AlreadyRefunded
34 PrevEpochNotSettled
```

### 2.4 Event'ler (topic ilk eleman Symbol)

| Topic | Data |
|---|---|
| `("campaign", id)` | `(brand, budget, epochs)` |
| `("joined", id)` | `(participant, code)` |
| `("clip", id)` | `(clip_id, owner, platform, video_id, baseline)` |
| `("proof", id)` | `(clip_id, epoch, views, weight)` |
| `("alive", id)` | `(clip_id, epoch)` |
| `("settled", id)` | `(epoch, rate, spent, total_weight)` |
| `("claimed", id)` | `(clip_id, epoch, to, amount)` |
| `("hbclaim", id)` | `(clip_id, epoch, to, amount)` |
| `("challenge", id)` | `(dispute_id, clip_id, epoch, challenger)` |
| `("respond", id)` | `(dispute_id)` |
| `("resolved", id)` | `(dispute_id, clipper_wins)` |
| `("refund", id)` | `(brand, amount)` |

## 3. `humanity` kontratı

| Fonksiyon | Yetki | Açıklama |
|---|---|---|
| `init(admin: Address, relayer: Address)` | — | |
| `set_relayer(relayer)` | admin | |
| `register(campaign_id: u64, nullifier: BytesN<32>, wallet: Address)` | relayer | aynı nullifier ya da aynı cüzdan aynı kampanyada ikinci kez kaydedilemez |
| `is_verified(campaign_id: u64, wallet: Address) -> bool` | — | `cliprail.join` bunu çağırır |
| `nullifier_of(campaign_id: u64, wallet: Address) -> Option<BytesN<32>>` | — | |

Hatalar: `1 AlreadyInitialized, 2 NullifierUsed, 3 WalletRegistered`. Event: `("human", campaign_id) → (wallet, nullifier)`.

## 4. Verifier servisi HTTP API

Taban adres: `NEXT_PUBLIC_VERIFIER_URL` (lokalde `http://localhost:8787`). JSON gövde; hata biçimi `{ "error": string, "code"?: string }`.

| Metot ve yol | Gövde | Cevap | Not |
|---|---|---|---|
| `GET /health` | — | `{ ok: true, network, cliprailId, humanityId }` | |
| `POST /proof` | `{ platform: "youtube"\|"demo", videoId: string }` | `{ proof: ProofJson, extracted: { views: string, desc: string }, cached: boolean }` | açılış kanıtı için; web, `register_clip` işlemini clipper'a imzalatır |
| `POST /proof/submit` | `{ campaignId, clipId, epoch, kind: "close"\|"alive" }` | `{ txHash: string, views: string }` | servis kanıtı üretir, işlemi kendisi gönderir ve ücreti öder |
| `POST /demo/videos/:id/bump` | `{ views?: number, delta?: number, desc?: string }` | `{ id, views, desc }` | yalnız demo; demo platformundaki sayıyı değiştirir |
| `GET /demo/videos/:id` | — | `{ items: [{ id, snippet: { description }, statistics: { viewCount } }] }` | YouTube cevabıyla aynı biçim, zkFetch bunu çeker |
| `POST /self/verify` | Self SDK callback gövdesi | `{ status: "success"\|"error", result: boolean }` | Self'in beklediği biçim |
| `POST /humanity/demo-register` | `{ campaignId, wallet }` | `{ txHash }` | Self yedeği; `DEMO_MODE=1` iken açık |

```ts
type ProofJson = {
  parameters: string;   // hex (0x'siz) — Bytes
  context: string;      // hex
  owner: string;        // hex (ASCII "0x..." baytları)
  timestampS: number;
  epoch: number;
  signature: string;    // 128 hex karakter
  recoveryId: number;
};
```

## 5. Web veri katmanı (mock ↔ gerçek)

Sena, mock ile başlar ve aynı arayüzü sonra gerçek implementasyonla değiştirir. Dosya: `apps/web/src/lib/api/types.ts`.

```ts
export interface CliprailApi {
  // okuma
  listCampaigns(): Promise<CampaignView[]>;
  getCampaign(id: bigint): Promise<CampaignView>;
  getPhase(id: bigint): Promise<PhaseInfo>;
  getEpoch(id: bigint, e: number): Promise<EpochState>;
  listClips(id: bigint): Promise<ClipView[]>;              // clip + her dönem için ClipEpoch
  getParticipant(id: bigint, addr: string): Promise<Participant | null>;
  isHuman(id: bigint, addr: string): Promise<boolean>;
  listDisputes(id: bigint): Promise<Dispute[]>;
  quote(id: bigint, clipId: bigint, e: number): Promise<Quote>;
  // yazma (cüzdan imzası) → tx hash döner
  createCampaign(p: CampaignParamsInput): Promise<{ id: bigint; txHash: string }>;
  join(id: bigint): Promise<{ code: string; txHash: string }>;
  registerClip(id: bigint, platform: "youtube" | "demo", videoId: string): Promise<{ clipId: bigint; txHash: string }>; // içeride POST /proof
  submitClose(id: bigint, clipId: bigint, e: number): Promise<{ txHash: string }>;   // POST /proof/submit kind=close
  proveAlive(id: bigint, clipId: bigint): Promise<{ txHash: string }>;               // kind=alive
  challenge(id: bigint, clipId: bigint, e: number, evidence: string): Promise<{ disputeId: bigint; txHash: string }>;
  respond(disputeId: bigint): Promise<{ txHash: string }>;
  resolve(disputeId: bigint, clipperWins: boolean): Promise<{ txHash: string }>;
  finalizeDispute(disputeId: bigint): Promise<{ txHash: string }>;
  settleEpoch(id: bigint, e: number): Promise<{ txHash: string }>;
  claim(id: bigint, clipId: bigint, e: number): Promise<{ amount: bigint; txHash: string }>;
  claimHoldback(id: bigint, clipId: bigint, e: number): Promise<{ amount: bigint; txHash: string }>;
  refund(id: bigint): Promise<{ amount: bigint; txHash: string }>;
}
```

`CampaignView = Campaign & { tokenSymbol: string }`. `ClipView = Clip & { epochs: (ClipEpoch | null)[] }`. Diğer tipler §2.1'deki Rust tiplerinin TS karşılığı (`u64`/`i128` → `bigint`).

**Explorer linkleri:** `https://stellar.expert/explorer/testnet/tx/<hash>`, `…/contract/<id>`, `…/account/<G…>`.

## 6. Deploy bilgileri (deploy sonrası doldurulur)

```
CLIPRAIL_ID=
HUMANITY_ID=
USDC_SAC=            # test USDC (kendi issuer'ımız) SAC adresi
USDC_ISSUER=
ADMIN / RELAYER / ARBITER / BRAND / CLIPPER1 / CLIPPER2 public key'leri:
RECLAIM_ATTESTOR=0x244897572368eadf65bfbc5aec98d8e5443a9072   # spike'ta teyit edilecek
RECLAIM_APP_ID=
```
