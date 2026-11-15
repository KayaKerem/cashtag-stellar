# Cashtag testnet runbook

How to run one full campaign lifecycle on the hosted testnet stack and how to operate that stack. Everything here is **Stellar testnet only**: test tokens, team accounts, no real funds and no real users. Fiat cash-out is out of scope.

- [1. What runs where](#1-what-runs-where)
- [2. Prerequisites](#2-prerequisites)
- [3. Health check](#3-health-check)
- [4. Rehearsal: one full campaign lifecycle](#4-rehearsal-one-full-campaign-lifecycle)
- [5. Rehearsal record](#5-rehearsal-record)
- [6. Operating the hosted stack](#6-operating-the-hosted-stack)
- [7. Troubleshooting](#7-troubleshooting)

## 1. What runs where

| Component | Where | Notes |
|---|---|---|
| `cliprail` contract | testnet [`CCLJFRBNBL23DMVCQNFGK6UKKYIPXPCLXQLT74WWQXLOZDICA7HMWA3W`](https://stellar.expert/explorer/testnet/contract/CCLJFRBNBL23DMVCQNFGK6UKKYIPXPCLXQLT74WWQXLOZDICA7HMWA3W) | escrow, epochs, disputes, in-contract Reclaim verification |
| `humanity` contract | testnet [`CAVHXWQN6CEQSEZTTDX4HIGATZCYXAUNOGF4ONAXYP4IF2LVX2WUFBHW`](https://stellar.expert/explorer/testnet/contract/CAVHXWQN6CEQSEZTTDX4HIGATZCYXAUNOGF4ONAXYP4IF2LVX2WUFBHW) | one human per campaign (Anon Aadhaar Groth16, TEST key) |
| Verifier, keeper, Anon Aadhaar prover | `https://91.99.152.134.sslip.io` (Hetzner, Docker Compose + Caddy, automatic TLS) | fetches Reclaim proofs, submits closing proofs, finalizes disputes, settles epochs |
| Dashboard | https://cashtag-stellar-web.vercel.app | server-side proxy `/api/verifier` holds the write token |
| zkTLS attestor | live Reclaim (`0x244897572368eadf65bfbc5aec98d8e5443a9072`) | the only allow-listed attestor on this deployment |

The keeper runs inside the verifier and ticks every 5 s. For every open campaign it:

1. finalizes disputes whose window has passed,
2. settles epochs once `settle_at(e)` is reached,
3. fetches and submits a closing proof for every active clip while the epoch's proof window is open.

Nobody has to be online for a campaign to move forward.

## 2. Prerequisites

- Node 24, pnpm, `stellar-cli` v28 and this repo (`pnpm install`).
- Funded testnet accounts with test USDC. `bash scripts/setup-accounts.sh` creates `admin`, `relayer`, `arbiter`, `brand`, `clipper1..3` and `usdc-issuer` as stellar CLI identities. It funds them with friendbot, issues test USDC and its SAC, and adds trustlines. It is idempotent, and `scripts/.accounts/` is gitignored.
- The contract IDs in `scripts/.accounts/deploy.env` (written by `scripts/deploy.sh`), or `CLIPRAIL_ID` / `HUMANITY_ID` in the environment.
- The verifier `WRITE_TOKEN` (team only). It protects the demo-video and relayer endpoints. Never put it in a `NEXT_PUBLIC_` variable.

## 3. Health check

```bash
curl -s https://91.99.152.134.sslip.io/health | jq
```

Expected: `"ok": true`, `"network": "testnet"`, `"attestorMode": "reclaim"`, the two contract IDs above, an RPC check that is `ok`, a keeper whose last tick is not stale, and `aadhaar.available: true`. The endpoint returns HTTP 503 when something is wrong.

A GitHub Actions workflow ([`.github/workflows/uptime.yml`](.github/workflows/uptime.yml)) runs the same check every 10 minutes. It fails the run (and notifies the repo owner) when the endpoint is down, unhealthy or not in `reclaim` mode.

The dashboard header shows a green **Testnet** dot when `/health` is ok, **Verifier offline** when it is not, and **Contract mismatch** when the dashboard and the verifier point at different contracts.

## 4. Rehearsal: one full campaign lifecycle

```bash
VERIFIER_URL=https://91.99.152.134.sslip.io \
WRITE_TOKEN=… \
SSH=deploy@91.99.152.134 \
pnpm --filter e2e rehearsal
```

[`scripts/e2e/rehearsal.ts`](scripts/e2e/rehearsal.ts) plays the brand and one clipper through `@cliprail/client`, the same client the dashboard uses. Every proof and every keeper action comes from the hosted stack. `SSH` is optional: with it, the script reads the keeper's tx hashes from the container log for the report. `HUMANITY_MODE=demo` swaps the Aadhaar proof for the relayer demo registration.

Parameters: 2 epochs of 180 s, 10 test USDC budget, rate ceiling 1 test USDC per 1k views, 20% holdback, proof window 100 s, dispute window 20 s, claim grace 180 s. A run takes about 15 minutes and uses 3 Reclaim zkFetch calls: one opening proof and two closing proofs. The free tier allows about 100 per month.

| # | Step | Who | What happens | Expected output |
|---|---|---|---|---|
| 1 | Health check | script | `/health` must be ok, `reclaim` mode, same `cliprail` ID | `ok=true attestorMode=reclaim` |
| 2 | Fund | brand | `create_campaign`: the budget moves into the contract | `campaign N, 10.00 test USDC` |
| 3 | Proof of humanity | clipper | the hosted prover builds an Anon Aadhaar proof (TEST data); `humanity.register_zk` verifies it on-chain | `nullifier …, ~90 s` |
| 4 | Join | clipper | `join` returns the 10-character campaign code | `code XXXXXXXXXX` |
| 5 | Register clip | clipper | the verifier fetches an opening proof from the live Reclaim attestor; `register_clip` verifies it in the contract and stores the baseline | `clip K, baseline 1200 views` |
| 6 | Closing proof, epoch 0 | keeper | the demo video grows to 5,200 views; the keeper submits a live Reclaim proof in the proof window | `5200 views` |
| 7 | Settle epoch 0 | keeper | `settle_epoch` fixes the rate and the holdback | `rate …, spent …, held back …` |
| 8 | Payout, epoch 0 | clipper | `claim`: 80% of the epoch-0 pay | amount in test USDC |
| 9 | Closing proof, epoch 1 | keeper | 8,200 views; a still-live clip keeps its holdback | `8200 views` |
| 10 | Holdback release | clipper | `claim_holdback` for epoch 0 after `proof_end(1)` | the 20% held back |
| 11 | Settle epoch 1 | keeper | `settle_epoch`; the last epoch has no holdback | `rate …, spent …` |
| 12 | Payout, epoch 1 | clipper | `claim` | amount in test USDC |
| 13 | Refund | brand | `refund` after `refund_at` returns the unspent budget | amount in test USDC |
| 14 | Checks | script | paid + refunded = budget, and both wallet deltas match | `conserved; balances match` |

The script writes a Markdown report with every tx link to `scripts/.accounts/rehearsal.md` (`OUT_FILE` overrides the path). It exits non-zero if any check fails.

To exercise a dispute as well, run `pnpm --filter e2e run` on a separate e2e instance. That run challenges a clip, lets the challenge go unanswered, finalizes the dispute and checks every payout against `packages/shared/src/payout.ts`. It signs proofs with the simulated test attestor, so it does not use the hosted deployment.

## 5. Rehearsal record

Run on 2026-11-15 against the hosted stack, campaign 3. The verifier, keeper and prover ran only on the Hetzner server. The machine running the script acted only as the two users' wallets (brand and clipper), the same role the dashboard plays in a browser. The keeper sent every closing proof and settlement on its own.

Run 2026-11-15T20:15:12.276Z. Stellar testnet, test USDC, team accounts. No real funds.

- cliprail [CCLJFRBNBL23DMVCQNFGK6UKKYIPXPCLXQLT74WWQXLOZDICA7HMWA3W](https://stellar.expert/explorer/testnet/contract/CCLJFRBNBL23DMVCQNFGK6UKKYIPXPCLXQLT74WWQXLOZDICA7HMWA3W), humanity [CAVHXWQN6CEQSEZTTDX4HIGATZCYXAUNOGF4ONAXYP4IF2LVX2WUFBHW](https://stellar.expert/explorer/testnet/contract/CAVHXWQN6CEQSEZTTDX4HIGATZCYXAUNOGF4ONAXYP4IF2LVX2WUFBHW)
- hosted verifier https://91.99.152.134.sslip.io (attestor mode `reclaim`), clip `demo/rehearsal-mwi9zr6o`

| # | Step | By | Result | Tx |
|---|---|---|---|---|
| 1 | Fund campaign (create_campaign, budget escrowed) | brand | campaign 3, 10.00 test USDC | [053e4c63…](https://stellar.expert/explorer/testnet/tx/053e4c63df90a3ad428941a1210df1672dc6cc59e9a514dfeeb595626001ea74) |
| 2 | Proof of humanity (Anon Aadhaar, TEST data, proved on the hosted prover) | clipper | nullifier 158850092107…, 93 s | [96b2289f…](https://stellar.expert/explorer/testnet/tx/96b2289fe9b195687b2234447fcf9ca8d0cd4395fca42ce89f7e2e371ab8ddcc) |
| 3 | Join campaign | clipper | code CR-V9IPD650AC | [bc6e177a…](https://stellar.expert/explorer/testnet/tx/bc6e177aa48f470a90f0c6d2ba96bfde1335e985c844cca3557252494b7165a3) |
| 4 | Register clip (opening proof from the live Reclaim attestor) | clipper | clip 2, baseline 1200 views, proof 11 s | [49ec970f…](https://stellar.expert/explorer/testnet/tx/49ec970ff6548e189c6dbfacd2b159f1c5b4dd2e0ae26325b2168ea4d17b9980) |
| 5 | Closing proof epoch 0 (keeper, live Reclaim) | hosted keeper | 5200 views | [516c312e…](https://stellar.expert/explorer/testnet/tx/516c312ef5bc9eaf0be01016e6c97d948cd09541f56c50a4bb743a9f9f2e48fe) |
| 6 | Settle epoch 0 (keeper) | hosted keeper | rate 1.00 test USDC per 1k views, spent 4.00, held back 0.80 | [692a48e2…](https://stellar.expert/explorer/testnet/tx/692a48e23799b524367ab55740c6e4ea625e23e83b724062f88dad41ce480c5a) |
| 7 | Payout epoch 0 (claim) | clipper | 3.20 test USDC | [954c75c3…](https://stellar.expert/explorer/testnet/tx/954c75c33e2466dbb12a43408edc5c3dd6efb7d1ca9db5ad35d7398259bc5180) |
| 8 | Closing proof epoch 1 (keeper, live Reclaim) | hosted keeper | 8200 views | [4598c445…](https://stellar.expert/explorer/testnet/tx/4598c445bdd0a7261d9570f8134e4b28d3f6cccaa7fbf0e5ed4e22b903457d8a) |
| 9 | Holdback release epoch 0 (claim_holdback) | clipper | 0.80 test USDC | [80e01b1f…](https://stellar.expert/explorer/testnet/tx/80e01b1f68c8cda30d01fc2e5b12f07775fdf1f6830a0498fae67caf4e3f0b60) |
| 10 | Settle epoch 1 (keeper) | hosted keeper | rate 1.00 test USDC per 1k views, spent 3.00 | [960bfff9…](https://stellar.expert/explorer/testnet/tx/960bfff96b4868ac38aeb56a42eadea3e1890efa66493f9175f6415198118bdb) |
| 11 | Payout epoch 1 (claim, last epoch, no holdback) | clipper | 3.00 test USDC | [e01771f7…](https://stellar.expert/explorer/testnet/tx/e01771f76430b9b9851c6e6576025166b77974c66c28ca7f209c4ca112eba632) |
| 12 | Refund unspent budget | brand | 3.00 test USDC | [fd35b53e…](https://stellar.expert/explorer/testnet/tx/fd35b53ed1bf6736ab7791d59c3e19e927090e77f22b2bc4d5655a20ade2fc31) |

Paid to the clipper 7.00 + refunded 3.00 = 10.00 of the 10.00 budget (conserved). Wallet deltas match.

Epoch 0 paid (5,200 − 1,200) views × 1 test USDC / 1k = 4.00. 80% (3.20) was paid at once and 20% (0.80) was held back. The holdback was released after the clip was still live with a new proof in epoch 1. Epoch 1 paid (8,200 − 5,200) / 1k = 3.00 with no holdback, since it is the last epoch. The remaining 3.00 of the 10.00 budget went back to the brand.

## 6. Operating the hosted stack

**Server.** Hetzner CAX11 (ARM64, 2 vCPU, 4 GB RAM plus 4 GB swap), Ubuntu.

- SSH accepts keys only. Root login is disabled; you log in as `deploy`.
- ufw allows only 22, 80 and 443. fail2ban and unattended security upgrades are on.
- The stack lives in `/opt/cashtag`, owned by `deploy`. `deploy/.env` sets `PUBLIC_HOST`. `deploy/verifier.env` (mode 600) holds the secrets; see [`deploy/verifier.env.example`](deploy/verifier.env.example).

**Deploy a new version** (from a clean checkout of `main`):

```bash
deploy/deploy.sh deploy@91.99.152.134               # rsync, docker compose build, restart
deploy/deploy.sh deploy@91.99.152.134 --artifacts   # first time only: Anon Aadhaar artifacts (~600 MB)
```

**Logs and restarts:**

```bash
ssh deploy@91.99.152.134
cd /opt/cashtag/deploy
docker compose ps
docker compose logs -f verifier | grep -E '^\[(keeper|aadhaar)\]'
docker compose restart verifier
```

**Redeploying the contracts** (fresh IDs):

1. Run `FORCE_DEPLOY=1 bash scripts/deploy.sh` and then `bash scripts/bindings.sh`.
2. Update the contract IDs in the server's `verifier.env` and in the Vercel env (`NEXT_PUBLIC_CLIPRAIL_ID`, `NEXT_PUBLIC_HUMANITY_ID`), then redeploy both.
3. `/health` and the dashboard badge flag any mismatch.

**Keys on the server.** There are two funded testnet accounts, each in `verifier.env`:

- **Keeper** (`KEEPER_SECRET`, `GAB7WVYUN5VIPEU4GI3DGOB6DNYT4LWBGIA5UFZ4CS5JK54Y2DY7EJLC`) signs `submit_proof`, `settle_epoch` and `finalize_dispute`. Those calls are permissionless, so a leaked keeper key can only spend fees.
- **Relayer** (`RELAYER_SECRET`) signs only `humanity.register`, which can register humans.

Neither key holds campaign funds. The service refuses to start in production when the keeper is on without its own key. The startup log prints both addresses (`relayer=… keeper=…`).

**Key rotation.**

- **Keeper:**
  1. `stellar keys generate keeper2 --network testnet --fund`.
  2. Replace `KEEPER_SECRET` in `verifier.env`.
  3. `docker compose up -d verifier`.

  No contract change is needed.
- **Relayer:**
  1. Fund a new account.
  2. Point the `humanity` contract at it with `set_relayer` (admin key).
  3. Replace `RELAYER_SECRET` and restart.
- **Write token:** change `WRITE_TOKEN` in both `verifier.env` and the Vercel env, then redeploy both.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/health` 503 with `rpc_unreachable` | testnet RPC down, or a `@stellar/stellar-sdk` too old for the current protocol (17.1 cannot decode protocol 30 ledgers) | check `https://soroban-testnet.stellar.org`; keep the SDK at ≥ 17.4 |
| `/proof` fails with `invalid proof (ZK proof …)` | the attestor rejects proofs from an outdated `@reclaimprotocol/attestor-core` | keep attestor-core ≥ 5.1.6 |
| `create_campaign` → `InvalidParams` (3) | a timing rule is broken: `claim_grace >= epoch_len`, `epoch_len >= proof + dispute + arbiter windows`, `start` not in the past, each half of `dispute_window` at least `min_response_window()`, or arbiter = brand | adjust the parameters |
| `create_campaign` → `ArbiterNotAllowed` (40) | the arbiter is not on the curated list | pick one from `arbiters()` |
| A closing proof never arrives | the proof window was shorter than the keeper's 30 s safety margin, the clip was disputed or excluded, or two zkFetch attempts already failed | read `docker compose logs verifier`; use a proof window of at least 60 s |
| Aadhaar prove takes > 2 min or the queue is full | 4 GB RAM; one proof at a time (`AADHAAR_MAX_QUEUE=1`) | wait and retry; a larger server (8 GB) cuts this |
| Dashboard writes return 503 `proxy_unconfigured` | `WRITE_TOKEN` or the verifier URL is missing in Vercel | set them as server-side env and redeploy |
| Dashboard shows **Contract mismatch** | the dashboard and the verifier point at different contracts | align the Vercel env and `verifier.env` |
