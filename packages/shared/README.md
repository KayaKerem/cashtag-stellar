# @cliprail/shared

Web ve servislerin ortak kullandığı, bağımlılıksız TypeScript mantığı. Formüller kontrattaki (`contracts/cliprail/src/epoch.rs`, `lib.rs`) ile birebir aynıdır; tutarlar ve zamanlar `bigint`.

| Dosya | İçerik |
|---|---|
| `types.ts` | Kontrat tipleri (INTERFACES v2 §2.1, §5), `CliprailApi`, binding çıktısını düzelten `normalize*` yardımcıları (`{ tag: "Active" }` → `"Active"`) |
| `timeline.ts` | `contentEnd`, `proofEnd`, …, `currentEpoch`, `phaseOf`, `can*` kontrolleri, `timelineRows` (Türkçe etiketli) |
| `payout.ts` | `epochBudget`, `rateEstimate`, `estimateEpoch`, `payFor`, `heldOf`, `estimateClipPay`, `holdbackShare` |
| `errors.ts` | 1–35 kontrat hataları + humanity hataları → Türkçe mesaj; `parseContractError`, `userMessage` |
| `format.ts` | `formatUsdc`, `parseUsdc`, `shortAddress`, stellar.expert testnet linkleri |
| `video.ts` | `parseVideoLink(platform, girdi)` → `{ ok, id }` / `{ ok: false, error }` |

Pencereler yarı açıktır: kanıt `[content_end, proof_end)`, itiraz `[proof_end, challenge_end)`, cevap `< dispute_end`, hakem `[dispute_end, settle_at)`, settle `≥ settle_at`, claim `< refund_at`.

## apps/web'den kullanım

`apps/web/package.json`:

```json
{ "dependencies": { "@cliprail/shared": "workspace:*" } }
```

Paket derlenmez, doğrudan `src/index.ts` export edilir. Bu yüzden `next.config.ts` içinde transpile edilmesi gerekir:

```ts
const nextConfig = { transpilePackages: ["@cliprail/shared"] };
export default nextConfig;
```

```ts
import { phaseOf, formatUsdc, userMessage, parseVideoLink, normalizeClipView } from "@cliprail/shared";

const now = BigInt(Math.floor(Date.now() / 1000));
phaseOf(campaign.params, 0, now);          // "proof"
formatUsdc(48_000_000n);                   // "4.80"
```

## Test

```sh
pnpm --filter @cliprail/shared test
pnpm --filter @cliprail/shared typecheck
```
