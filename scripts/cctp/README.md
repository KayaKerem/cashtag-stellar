# CCTP — funding a ClipRail campaign with USDC from another chain

A brand does not have to hold USDC on Stellar to run a campaign. These scripts take USDC that lives
on another chain, move it with [Circle CCTP V2](https://developers.circle.com/cctp) — burn there,
Circle attestation, native mint on Stellar — and then escrow it in a ClipRail campaign.

No contract change was needed: `create_campaign` escrows any SAC token, and the bridged asset is the
Circle testnet USDC SAC the app already uses
(`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`).

```
Arc Testnet USDC ──burn──▶ Circle attestation ──mint──▶ Stellar USDC ──escrow──▶ campaign #N
  (domain 26)                     (Iris)                  (domain 27)            (cliprail)
```

Source chains: **Arc Testnet** (Circle's own L1 — 0 bps fee, attestation in seconds, gas paid in
USDC) and **Base Sepolia** as a fallback.

## The rule that protects the funds

A `G…` account can never be a CCTP `mintRecipient`: CCTP address fields are raw 32 bytes with no
type marker, so the protocol always treats the recipient as a contract. Both `mintRecipient` and
`destinationCaller` are therefore set to the **CctpForwarder** contract
(`CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ`), and the real recipient travels inside
`hookData` as its strkey:

| bytes | content |
| ----- | ------- |
| 0–23  | magic — 24 zero bytes for Stellar-inbound transfers |
| 24–27 | `uint32` big-endian hook version (`0`) |
| 28–31 | `uint32` big-endian length of the recipient strkey |
| 32…   | the recipient strkey, UTF-8 |

`CctpForwarder.mint_and_forward(message, attestation)` then mints and pays the recipient in one
atomic invocation. Getting either field wrong strands the USDC permanently, so the layout is pinned
by unit tests (`pnpm --filter cctp test`) and re-checked in-process before every burn.

## Prerequisites

1. **A demo EVM account** — `pnpm --filter cctp keygen` writes the key to
   `scripts/.accounts/cctp.env` (gitignored, mode 600) and prints only the address.
2. **Testnet USDC for that address** — claim it at [faucet.circle.com](https://faucet.circle.com),
   network **Arc Testnet** (reCAPTCHA, ~20 USDC per claim). Arc pays gas in USDC, so that one claim
   covers both the transfer and the fees. For Base Sepolia you also need Sepolia ETH.
3. **A Stellar recipient with a USDC trustline** — the `brand` CLI identity by default. `bridge`
   detects a missing trustline and offers to add it when the keystore holds the recipient's key.
4. **A funded Stellar fee payer for the mint** — the `relayer` identity by default; override with
   `CCTP_STELLAR_SOURCE` (an identity name or a raw secret). Secrets are never printed.
5. **The demo ClipRail instance** — `fund-campaign` targets `E2E_CLIPRAIL_ID` from
   `scripts/.accounts/e2e.env` (created by `pnpm --filter e2e deploy`). The older instance in
   `deploy.env` predates the ZK and Soroswap work and is only a last-resort fallback; pass
   `--cliprail C… --humanity C…` to target something else.

## Commands

```bash
pnpm --filter cctp keygen          # one-off: create the demo EVM account, print its address
pnpm --filter cctp dry-run         # no funds move: RPC, contract specs, fees, encoding, balances
pnpm --filter cctp test            # unit tests for hook data, strkey bytes32, decimals, fees

pnpm --filter cctp bridge -- --amount 1 --chain arc --fast
pnpm --filter cctp fund-campaign -- --budget 1
```

### `bridge`

`approve` → `depositForBurnWithHook` → poll Circle's attestation → `mint_and_forward` on Stellar →
verify the recipient's balance grew. Every transaction hash is printed with an explorer link
(Arcscan / Basescan and stellar.expert).

| flag | meaning |
| ---- | ------- |
| `--amount <usdc>` | amount to bridge, in USDC. Default `1`. |
| `--recipient <G…\|C…>` | Stellar recipient. Default: the `brand` identity. |
| `--chain arc\|base` | source chain. Default `arc`. |
| `--fast` | request Fast finality (1000) instead of Standard (2000). |
| `--yes` | add a missing USDC trustline without asking. |
| `--resume <0x…>` | skip the burn and finish an earlier one (attestation + mint). |

If the Stellar mint fails after a successful burn, nothing is lost: the attestation stays valid, and
the printed `--resume` command completes the transfer.

### `fund-campaign`

Creates a campaign with `@cliprail/client`'s `createCampaign`, signed by the `brand` identity, using
the bridged USDC as the budget. It prints the campaign id, the transaction link, and the escrow
balance change. The budget defaults to whatever the last `bridge` run moved.

| flag | meaning |
| ---- | ------- |
| `--budget <usdc>` | campaign budget. Default: the last bridged amount. |
| `--title <text>` | campaign title. Default names the source chain and CCTP. |
| `--brand <identity>` | signing identity. Default `brand`. |
| `--cliprail <C…>` / `--humanity <C…>` | target another instance instead of the one in `e2e.env`. |

The header line states whether the target is the demo instance, so a run against anything else is
visible before the transaction is signed.

## Decimals

USDC is 6-decimal everywhere except Stellar, which is 7-decimal, and CCTP message amounts are always
6-decimal. `1 USDC` burns as `1000000` and mints as `10000000`. The scripts convert at the boundary
and never go through a float.

## Files

| file | role |
| ---- | ---- |
| `config.ts` | chain/domain/contract registry and explorer links |
| `cctp.ts` | pure encoding (hook data, strkey → bytes32, amounts) and the Iris client |
| `evm.ts` | demo account, viem clients, ERC-20 + TokenMessengerV2 ABIs, funding preflight |
| `stellar.ts` | keystore access, contract invocation, balances, trustlines |
| `keygen.ts` / `bridge.ts` / `fund-campaign.ts` / `dry-run.ts` | entry points |
| `test/cctp.test.ts` | encoding tests — the fund-loss surface |
