# @cliprail/client

`CliprailApi` arayüzünün (docs/INTERFACES.md §5) UI'dan bağımsız uygulaması. Web tarafı yalnızca arayüz yazar.

- `createApi("mock", opts?)`: bellekte çalışan sahte API. 2 kampanya, 3 katılımcı, klipler ve açık bir itiraz ile başlar. Saat gerçek zamanda ilerler (`speed` ile hızlandırılabilir), yazma işlemleri ~800 ms sonra sahte `txHash` döner. Aşama kuralları ve ödeme hesabı `@cliprail/shared` ile aynıdır. `MockApi` ayrıca `now()` ve `advance(saniye)` sunar.
- `createApi("chain", opts)`: testnet. Okumalar simülasyonla yapılır (cüzdan gerekmez). Yazmalar kullanıcının cüzdanıyla imzalanır. Geçici hatalarda (footprint, ExceededLimit, tx_bad_seq, TRY_AGAIN_LATER) işlem yeniden simüle edilir, en fazla 2 kez.
- Tüm hatalar `CliprailError { code, source, message }` olarak gelir. `message` Türkçedir ve doğrudan gösterilebilir. `code` kontrat hata numarası (§2.3) ya da `"wallet_rejected"`, `"network"`, `"unauthorized"` gibi bir etikettir.
- `registerClip` önce verifier'dan kanıt alır (`POST /proof`, 5–30 sn sürer), sonra `register_clip` işlemini imzalatır. `registerHuman` ve `submitClose` verifier üzerinden gider.
- `registerHumanZk(id, {identity?})` → `{txHash, nullifier}`: verifier'dan Anon Aadhaar kanıtı alır (`POST /humanity/aadhaar/prove`, ~30 sn, kuyruk varsa daha uzun), sonra `humanity.register_zk`'yı bağlı cüzdana imzalatır. **TEST modu:** kanıt UIDAI TEST anahtarı/verisiyle, `identity` adlı demo kimlik için üretilir (verilmezse cüzdana özel kimlik). Production'da kanıt tarayıcıda kullanıcının kendi QR'ından üretilir. Bindings yeniden üretilene kadar çağrı ham `ScVal` argümanlarla yapılır (`src/humanity-zk.ts`). Mock: ~3 sn bekler ve başarılı olur; aynı `identity` başka cüzdanla tekrar kullanılırsa `NullifierUsed`.
- humanity hata kodları 4–8 (`NotConfigured`, `InvalidProof`, `StaleProof`, `InputNotInField`, `NotAnAccount`) kontratla henüz teyit edilmedi.

## Next.js

`next.config.ts`:

```ts
const nextConfig = { transpilePackages: ["@cliprail/shared", "@cliprail/client"] };
export default nextConfig;
```

`apps/web/package.json` bağımlılıkları: `"@cliprail/client": "workspace:*"`, `"@cliprail/shared": "workspace:*"`.

```ts
"use client";
import { createApi, isCliprailError } from "@cliprail/client";
import { StellarWalletsKit, WalletNetwork, allowAllModules, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit";

const kit = new StellarWalletsKit({ network: WalletNetwork.TESTNET, selectedWalletId: FREIGHTER_ID, modules: allowAllModules() });

// Signer adaptörü (Freighter için: @stellar/freighter-api getAddress / signTransaction aynı biçimde)
const signer = {
  getAddress: async () => (await kit.getAddress()).address,
  signTransaction: (xdr: string, o: { networkPassphrase: string; address?: string }) => kit.signTransaction(xdr, o),
};

export const api =
  process.env.NEXT_PUBLIC_API_MODE === "mock"
    ? createApi("mock")
    : createApi("chain", {
        rpcUrl: process.env.NEXT_PUBLIC_RPC_URL!,
        networkPassphrase: "Test SDF Network ; September 2015",
        cliprailId: process.env.NEXT_PUBLIC_CLIPRAIL_ID!,
        humanityId: process.env.NEXT_PUBLIC_HUMANITY_ID!,
        usdcSac: process.env.NEXT_PUBLIC_USDC_SAC!,
        verifierUrl: process.env.NEXT_PUBLIC_VERIFIER_URL!,
        writeToken: process.env.NEXT_PUBLIC_WRITE_TOKEN,
        signer,
      });

// Kullanım
try {
  const { code, txHash } = await api.join(1n);
} catch (e) {
  if (isCliprailError(e)) toast.error(e.message);
}
```

ID'ler `bigint`, dönemler `number` türündedir. Tutarlar i128 (`bigint`, 7 ondalık) olarak gelir; biçimlendirme için `@cliprail/shared` içindeki `format` yardımcılarını kullan. Explorer linki: `https://stellar.expert/explorer/testnet/tx/<txHash>`.

## Anchor (SEP-1 / SEP-10 / SEP-24): TL yatırma ve çekme

`src/anchor.ts` herhangi bir SEP-24 anchor'ıyla çalışır. Varsayılan `testanchor.stellar.org` ve `SRT`. Etkinliğin TRY anchor'ı belli olunca yalnızca home domain ve varlık kodu değişir.

```ts
import { discoverAnchor, sep10Auth, ensureTrustline, anchorAsset, startInteractive, waitForTransaction, completeWithdrawPayment } from "@cliprail/client";

const anchor = await discoverAnchor("testanchor.stellar.org");         // stellar.toml + /info
const jwt = await sep10Auth({ anchor, account, signer });               // challenge doğrulanır, cüzdan imzalar
const asset = anchorAsset(anchor, "SRT");                               // CURRENCIES içinden issuer
await ensureTrustline(asset, account, signer);                          // gerekiyorsa changeTrust
const { id, url } = await startInteractive({ anchor, jwt, kind: "deposit", assetCode: "SRT", account, amount: "100", lang: "tr" });
window.open(url, "anchor", "width=500,height=800");                     // KYC / banka bilgisi anchor penceresinde
const tx = await waitForTransaction({ anchor, jwt, id, onUpdate: (t) => setStatus(t.statusLabel) });

// Çekim: kind "withdraw"; durum pending_user_transfer_start olunca ödeme cüzdandan imzalanır.
const w = await waitForTransaction({ anchor, jwt, id: wid, until: ["pending_user_transfer_start"] });
if (w.needsUserPayment) await completeWithdrawPayment({ tx: w, asset, account, signer });
```

- Hatalar `CliprailError { source: "anchor", code: "anchor_*" }`; Türkçe mesajlar `@cliprail/shared` (`ANCHOR_ERROR_MESSAGES`, `SEP24_STATUS_LABELS`).
- Anchor varlığının kontrat tarafındaki karşılığı SAC'tır: `asset.contractId(networkPassphrase)`. SAC ağda yoksa bir kez `stellar contract asset deploy --asset KOD:ISSUER --network testnet` çalıştırılır.
- Uçtan uca test: `pnpm --filter e2e anchor-smoke` (testanchor formunu HTTP ile doldurur).

## Ortam değişkenleri

| Değişken | Değer (testnet, INTERFACES §6) |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_CLIPRAIL_ID` | `CCICEPQCY25RNF5SAJ3FPUXPXEIRQ3GOUMSVZGVCHRJ6L6Q3FHJL3TST` |
| `NEXT_PUBLIC_HUMANITY_ID` | `CAUU4KCBSL3L5CCLU2S5GNZ354S4X3DP6Z5ZSWMSDDCNNNE3AJSCGKMQ` |
| `NEXT_PUBLIC_USDC_SAC` | `CCRCO347GR4FVCZACMTXZWE4EKTICARZXRRTS4R4HZZYK7R7E65UX45E` |
| `NEXT_PUBLIC_VERIFIER_URL` | lokal `http://localhost:8787`, sonra Hetzner HTTPS adresi |
| `NEXT_PUBLIC_WRITE_TOKEN` | verifier `WRITE_TOKEN` değeri |

`NEXT_PUBLIC_WRITE_TOKEN` tarayıcıya gömülür, yani herkes görebilir. Yalnızca demo içindir ve gerçek bir sır olarak kullanılmamalıdır.

## Komutlar

```sh
pnpm --filter @cliprail/client test        # birim testleri (mock, kanıt dönüşümü, hata eşleme, yeniden deneme)
pnpm --filter @cliprail/client typecheck
pnpm --filter @cliprail/client smoke       # E2E kontratına salt okunur istekler (scripts/.accounts/e2e.env)
```

`smoke` betiği `SMOKE_SECRET` ortam değişkenini kullanır. Tanımlı değilse anahtarı `stellar keys show brand` komutuyla alır ve ekrana yazmaz.
