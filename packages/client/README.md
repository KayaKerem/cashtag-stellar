# @cliprail/client

UI-independent implementation of the `CliprailApi` interface (docs/INTERFACES.md §5). The web app only writes the interface.

- `createApi("mock", opts?)`: an in-memory fake API. It starts with 2 campaigns, 3 participants, clips and one open challenge. The clock runs in real time (speed it up with `speed`), and writes return a fake `txHash` after ~800 ms. Phase rules and payout math are the same as in `@cliprail/shared`. `MockApi` also exposes `now()` and `advance(seconds)`.
- `createApi("chain", opts)`: testnet. Reads run through simulation (no wallet needed). Writes are signed with the user's wallet. On transient errors (footprint, ExceededLimit, tx_bad_seq, TRY_AGAIN_LATER) the call is re-simulated, at most twice.
- Every error arrives as `CliprailError { code, source, message }`. `message` is English and can be shown as is. `code` is the contract error number (§2.3) or a tag such as `"wallet_rejected"`, `"network"` or `"unauthorized"`.
- `registerClip` first fetches a proof from the verifier (`POST /proof`, takes 5–30 s), then has the `register_clip` transaction signed. `registerHuman` and `submitClose` also go through the verifier.
- `registerHumanZk(id, {identity?})` → `{txHash, nullifier}`: fetches an Anon Aadhaar proof from the verifier (`POST /humanity/aadhaar/prove`, ~30 s, longer when queued), then has `humanity.register_zk` signed by the connected wallet. **TEST mode:** the proof is generated with the UIDAI TEST key/data for the demo identity named `identity` (when omitted, an identity derived from the wallet). In production the proof is generated in the browser from the user's own QR code. Until the bindings are regenerated, the call is made with raw `ScVal` arguments (`src/humanity-zk.ts`). Mock: waits ~3 s and succeeds; reusing the same `identity` from another wallet raises `NullifierUsed`.
- Humanity error codes 4–8 (`NotConfigured`, `InvalidProof`, `StaleProof`, `InputNotInField`, `NotAnAccount`) have not been confirmed against the contract yet.

## Next.js

`next.config.ts`:

```ts
const nextConfig = { transpilePackages: ["@cliprail/shared", "@cliprail/client"] };
export default nextConfig;
```

`apps/web/package.json` dependencies: `"@cliprail/client": "workspace:*"`, `"@cliprail/shared": "workspace:*"`.

```ts
"use client";
import { createApi, isCliprailError } from "@cliprail/client";
import { StellarWalletsKit, WalletNetwork, allowAllModules, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit";

const kit = new StellarWalletsKit({ network: WalletNetwork.TESTNET, selectedWalletId: FREIGHTER_ID, modules: allowAllModules() });

// Signer adapter (for Freighter: @stellar/freighter-api getAddress / signTransaction have the same shape)
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

// Usage
try {
  const { code, txHash } = await api.join(1n);
} catch (e) {
  if (isCliprailError(e)) toast.error(e.message);
}
```

Ids are `bigint` and epochs are `number`. Amounts arrive as i128 (`bigint`, 7 decimals); format them with the `format` helpers in `@cliprail/shared`. Explorer link: `https://stellar.expert/explorer/testnet/tx/<txHash>`.

## Anchor (SEP-1 / SEP-10 / SEP-24): TRY deposits and withdrawals

`src/anchor.ts` works with any SEP-24 anchor. The defaults are `testanchor.stellar.org` and `SRT`. Once the event's TRY anchor is known, only the home domain and the asset code change.

```ts
import { discoverAnchor, sep10Auth, ensureTrustline, anchorAsset, startInteractive, waitForTransaction, completeWithdrawPayment } from "@cliprail/client";

const anchor = await discoverAnchor("testanchor.stellar.org");         // stellar.toml + /info
const jwt = await sep10Auth({ anchor, account, signer });               // the challenge is verified, the wallet signs
const asset = anchorAsset(anchor, "SRT");                               // issuer from CURRENCIES
await ensureTrustline(asset, account, signer);                          // changeTrust when needed
const { id, url } = await startInteractive({ anchor, jwt, kind: "deposit", assetCode: "SRT", account, amount: "100", lang: "en" });
window.open(url, "anchor", "width=500,height=800");                     // KYC / bank details in the anchor window
const tx = await waitForTransaction({ anchor, jwt, id, onUpdate: (t) => setStatus(t.statusLabel) });

// Withdrawal: kind "withdraw"; once the status is pending_user_transfer_start, the payment is signed from the wallet.
const w = await waitForTransaction({ anchor, jwt, id: wid, until: ["pending_user_transfer_start"] });
if (w.needsUserPayment) await completeWithdrawPayment({ tx: w, asset, account, signer });
```

- Errors are `CliprailError { source: "anchor", code: "anchor_*" }`; the English messages live in `@cliprail/shared` (`ANCHOR_ERROR_MESSAGES`, `SEP24_STATUS_LABELS`).
- The contract-side counterpart of an anchor asset is its SAC: `asset.contractId(networkPassphrase)`. If the SAC is not on the network yet, run `stellar contract asset deploy --asset CODE:ISSUER --network testnet` once.
- End-to-end test: `pnpm --filter e2e anchor-smoke` (fills in the testanchor form over HTTP).

## Environment variables

| Variable | Value (testnet, INTERFACES §6) |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_CLIPRAIL_ID` | `CCICEPQCY25RNF5SAJ3FPUXPXEIRQ3GOUMSVZGVCHRJ6L6Q3FHJL3TST` |
| `NEXT_PUBLIC_HUMANITY_ID` | `CAUU4KCBSL3L5CCLU2S5GNZ354S4X3DP6Z5ZSWMSDDCNNNE3AJSCGKMQ` |
| `NEXT_PUBLIC_USDC_SAC` | `CCRCO347GR4FVCZACMTXZWE4EKTICARZXRRTS4R4HZZYK7R7E65UX45E` |
| `NEXT_PUBLIC_VERIFIER_URL` | local `http://localhost:8787`, later the Hetzner HTTPS address |
| `NEXT_PUBLIC_WRITE_TOKEN` | the verifier's `WRITE_TOKEN` value |

`NEXT_PUBLIC_WRITE_TOKEN` is embedded in the browser bundle, so anyone can read it. It is for the demo only and must not be treated as a real secret.

## Commands

```sh
pnpm --filter @cliprail/client test        # unit tests (mock, proof conversion, error mapping, retries)
pnpm --filter @cliprail/client typecheck
pnpm --filter @cliprail/client smoke       # read-only calls against the E2E contract (scripts/.accounts/e2e.env)
```

The `smoke` script uses the `SMOKE_SECRET` environment variable. When it is not set, it reads the key with `stellar keys show brand` and never prints it.
