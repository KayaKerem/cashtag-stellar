# Remediation status

Status of every open item in [THREAT_MODEL.md](THREAT_MODEL.md) section 7. Everything here runs on **Stellar testnet with test tokens; no real funds are involved**. Mainnet stays gated on an independent audit and on closing every item marked "before mainnet". This work is preparation for a possible future SCF Audit Bank application and makes no claim of eligibility.

Status values:

- **Fixed**: the threat as described no longer applies to the code.
- **Mitigated**: the main path is closed, and a stated residual remains.
- **Open**: not done yet.
- **Accepted (testnet)**: intentional for the testnet rehearsal and blocking for mainnet.

Contract changes take effect on testnet with the W3 redeploy. Until then the deployed contracts still run the previous code.

| ID | Sev | Status | What changed | Residual / next step |
| --- | --- | --- | --- | --- |
| TM-1 | High | Mitigated | **Config frozen per campaign.** Attestors, owners and each platform's URL and `responseMatches` are copied into the campaign at creation (`cliprail/src/proof.rs:snapshot`, `DataKey::CampaignConfig`, `get_campaign_config`). Proofs are checked only against that copy (`proof.rs:verify_and_consume`). Admin setters now affect only campaigns created afterwards, so a brand can inspect the config before funding. **Two-step admin transfer** (`propose_admin` / `accept_admin`) in `cliprail` and `humanity`. Tests: `cliprail/src/test/governance.rs`. | Before mainnet: the admin key becomes a Stellar multisig account; this is set at deploy time, so no code change is needed. `humanity` Aadhaar config and relayer remain global, but they only gate new registrations, because `join` reads `is_verified` once. No timelock: with the snapshots, a setter can no longer touch a funded campaign. Creation fails if the attestor or owner set is empty. Trade-off: the freeze cuts both ways, so a compromised attestor or a broken regex also cannot be removed from a live campaign. The answer for that is short campaigns, plus TM-9. |
| TM-2 | High | Mitigated | The verifier refuses to start in production without a `WRITE_TOKEN` of at least 24 characters (`services/verifier/src/config.ts:unsafeConfig`). | Open: the dashboard still ships the token as `NEXT_PUBLIC_WRITE_TOKEN`. A server-side proxy is tracked in #78. |
| TM-3 | High | Accepted (testnet) | The hosted testnet stack uses `DEMO_MODE=1` so the team can run the rehearsal. | Before mainnet: `DEMO_MODE=0`, and retire the relayer `register` path. |
| TM-4 | High | Accepted (testnet) | The UIDAI TEST key and the server-side prover are testnet-only. The prover queue is bounded (TM-13). | Before mainnet: pin the production UIDAI key, prove in the browser, and remove `/humanity/aadhaar/prove`. |
| TM-5 | High | Fixed | In production the verifier refuses to start in `simulated` mode with the public default keys (`config.ts:unsafeConfig`). | Deploy scripts should also assert that the simulated attestor is not allow-listed on non-rehearsal instances. |
| TM-6 | High | Mitigated | **Curated arbiters.** `params.arbiter` must be on the admin list (`set_arbiters`, checked in `epoch.rs:validate_params`), so a brand cannot name its own second wallet. **Challenges are never free.** Every closed dispute pays 10% of the bond, rounded up, to the arbiter whatever the outcome (`dispute.rs:DISPUTE_FEE_BPS`, `close`). The fee does not depend on the ruling, and it is computed without overflow; bonds are capped at `MAX_BUDGET`. The arbiter may not `join` or `challenge` in its own campaign. **Minimum response time.** `set_min_response_window` bounds `dispute_window / 2` at creation. On testnet it is 10 s so the rehearsal still fits; a mainnet deployment would use at least 24 h. | Budget freed by an excluded clip still flows to the other clips first and then back to the brand at `refund`. Creators are not yet notified of challenges; a dashboard and keeper alert is the follow-up. |
| TM-7 | High | Fixed | Participant codes are now `CR-` plus 10 base36 characters (about 2^51), and they are unique per campaign (`join` returns `CodeTaken`). Commit 5ad8f52; property tests in `cliprail/src/test/props.rs`. | None. |
| TM-8 | Medium | Mitigated | **Request pinned exactly** (`reclaim-verify/src/lib.rs:verify` step 3). Only the keys zkFetch emits are allowed. `method` must be `GET` and `body` must be empty. `responseMatches` must equal `required` entry for entry and in order, with nothing extra. `responseRedactions` must be empty or exactly the redactions derived from those matches. Both real zkFetch proofs (`fixtures/reclaim/{demo,x}-live-proof.json`) match this shape byte for byte. Tests: `reclaim-verify/src/test.rs` (pinned request shape section). | Open: check the X `favorite_count` / `id_str` regexes against quoted tweets and replies in the W4 rehearsal. |
| TM-9 | Medium | Open | | Threshold of attestors, Reclaim epoch check, owner key rotation runbook. |
| TM-10 | High | Accepted (testnet) | The `demo` platform exists only on testnet. | Never `set_platform("demo")` on mainnet. |
| TM-11 | Medium | Open | `/health` reports keeper liveness: the service returns 503 when the keeper is stale (commit 63a70b2). | Uptime monitor (#67) and a creator-side close-proof path. |
| TM-12 | Medium | Fixed | `X-Forwarded-For` is trusted only behind Caddy (`TRUST_PROXY=1`), and only its last hop is used. The rate-limit map uses LRU eviction instead of a global wipe (`app.ts:clientIp`, `limit.ts`). Commit 328f53b. | A global zkFetch budget across processes. |
| TM-13 | Medium | Mitigated | The Aadhaar prover queue is bounded (`AADHAAR_MAX_QUEUE`, default 3); excess requests get 503 `prover_busy`. Commit 328f53b. | Container memory limit, sized once the VPS is provisioned. |
| TM-14 | Medium | Open | | Paginate `get_clips` / `list_disputes`; per-campaign caps. |
| TM-15 | High | Open | Env files are excluded from rsync, and only Caddy publishes ports (`deploy/`). | Server phase (#66): split keeper and relayer keys, file permissions, SSH and firewall hardening, rotation runbook. |
| TM-16 | Medium | Open | | Store a metric label per platform; rate guidance in the UI. |
| TM-17 | Low | Open | | Token allow-list or a UI warning. |
| TM-18 | Low | Fixed | 500 responses carry only the generic `internal`. `/health` exposes fixed codes. `deploy/verifier.env.example` sets an explicit CORS origin. Commits 543150f and 328f53b. | None. |
| TM-19 | Low | Open | | Decide between immutable-plus-migration and a timelocked upgrade. |
| TM-20 | Medium | Mitigated | proptest suites for `cliprail` (escrow conservation, payout bounds, timeline overflow), `humanity` and `reclaim-verify` (commit 5ad8f52). | Coverage-guided fuzzing of the JSON parser. CoinFabrik Scout is blocked by an upstream build failure; the workflow is manual-only for now (#70). |
| TM-21 | Low | Open | | Defence-in-depth items, listed in the threat model. |

## Operational notes

- **Frozen config and host changes.** The `demo` platform URL includes the verifier host, and a campaign keeps the URL it was created with. If the host changes, for example from a tunnel to the VPS, existing `demo` campaigns stop accepting proofs. Only new campaigns pick up the new host. Create rehearsal campaigns after the host is final.
- **Reclaim attestor rotation.** If Reclaim rotates its attestor key, running campaigns keep the old allow-list. On testnet, campaigns last minutes to days, so this is acceptable. A mainnet design needs a brand-consented refresh or an attestor threshold (TM-9).
