# @cliprail/shared

Dependency-free TypeScript logic shared by the web app and the services. The formulas match the contract (`contracts/cliprail/src/epoch.rs`, `lib.rs`) exactly; amounts and timestamps are `bigint`.

| File | Contents |
|---|---|
| `types.ts` | Contract types (INTERFACES v2 §2.1, §5), `CliprailApi`, the `normalize*` helpers that clean up the bindings output (`{ tag: "Active" }` → `"Active"`) |
| `timeline.ts` | `contentEnd`, `proofEnd`, …, `currentEpoch`, `phaseOf`, the `can*` guards, `timelineRows` (with English labels) |
| `payout.ts` | `epochBudget`, `rateEstimate`, `estimateEpoch`, `payFor`, `heldOf`, `estimateClipPay`, `holdbackShare` |
| `errors.ts` | Contract errors 1–38 + humanity errors → English message; `parseContractError`, `userMessage` |
| `anchor.ts` | Anchor (SEP-1/6/10/12/24/38) error messages, status labels, ramp step labels, `formatTry`, `formatTryRate` |
| `format.ts` | `formatUsdc`, `parseUsdc`, `shortAddress`, stellar.expert testnet links |
| `video.ts` | `parseVideoLink(platform, input)` → `{ ok, id }` / `{ ok: false, error }` |

The windows are half-open: proof `[content_end, proof_end)`, challenge `[proof_end, challenge_end)`, response `< dispute_end`, arbiter `[dispute_end, settle_at)`, settle `≥ settle_at`, claim `< refund_at`.

## Using it from apps/web

`apps/web/package.json`:

```json
{ "dependencies": { "@cliprail/shared": "workspace:*" } }
```

The package is not built; `src/index.ts` is exported directly, so it has to be transpiled in `next.config.ts`:

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

## Tests

```sh
pnpm --filter @cliprail/shared test
pnpm --filter @cliprail/shared typecheck
```
