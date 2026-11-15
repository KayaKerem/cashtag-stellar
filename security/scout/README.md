# CoinFabrik Scout scan

The three Soroban contracts (`cliprail`, `humanity`, `reclaim-verify`) as deployed on testnet on 2026-11-15, scanned at commit `adae4b5`.

- Tool: `cargo-scout-audit` 0.3.17 (driver toolchain `nightly-2025-09-18`).
- Run on 2026-11-16 with `cargo scout-audit` in each `contracts/<name>`.
- Raw reports: [`raw/`](raw), as Markdown and JSON, unedited except that local absolute paths were made relative.

| Contract | Critical | Medium | Minor | Enhancement |
|---|---|---|---|---|
| `cliprail` | 40 | 15 | 0 | 22 |
| `humanity` | 3 | 4 | 1 | 7 |
| `reclaim-verify` | 39 | 1 | 0 | 0 |

**Result:** every finding was triaged by hand. Two are real:

- Unbounded per-campaign id lists, Medium, already tracked as TM-14.
- Missing events on `withdraw` and the admin setters, Low, added to TM-21.

All other findings are false positives or accepted by design. No finding allows funds to be taken or miscounted.

## Why the 82 "critical" findings are not exploitable

All 82 critical findings come from one detector, `integer_overflow_or_underflow`, which flags every plain `+`, `-`, `*` and `/`.

The release profile sets `overflow-checks = true` ([`contracts/Cargo.toml`](../../contracts/Cargo.toml)). An overflow therefore aborts the transaction, so it can never wrap silently and produce a wrong amount. The remaining question is whether some input can make a call revert and lock funds. We checked every flagged site:

| Where | Why it cannot underflow or overflow |
|---|---|
| `cliprail` timeline: `content_end`, `proof_end`, `dispute_end`, `settle_at`, `refund_at` (`epoch.rs`) | `validate_params` rejects any campaign whose whole timeline does not fit in `u64` (checked in `u128`). Covered by the `prop_create_campaign_extremes` proptest (commit 5ad8f52). |
| `cliprail` amounts: rate, spent, pay, holdback, carry (`epoch.rs`, `lib.rs:claim`, `claim_holdback`) | Bounded by `MAX_BUDGET` (1e15), `MAX_RATE` (1e12) and `MAX_CAP_VIEWS` (1e12) from `validate_params`; the largest product, `rate × weight × w_clip`, stays below `i128::MAX`. Divisions are guarded: `w == 0` returns early, and `held_survived == 0` returns `NothingToClaim`. Covered by the `prop_escrow_conservation`, `prop_settlement_math_bounded` and `prop_clip_pay_bounded` proptests. |
| `cliprail` subtractions: `e - 1`, `views - baseline`, `budget - spent`, `pay - held`, `c.balance -= amt`, `open_disputes -= 1`, `bond - fee` | Each one has a guard on the line before it: `e >= 1` or `e == 0` returns, `views < baseline` returns 0, `spent <= budget`, `held <= pay`, `amt` is clamped to `balance`, `close` runs only on an open dispute, and `fee <= bond`. |
| `cliprail` counters: `participants`, `clips`, `open_disputes`, id counter (`storage.rs:104`), `owed` credit | `u64` / `u32` counters incremented by one per transaction; `owed` is a sum of bonds, each at most `MAX_BUDGET`. |
| `humanity` `nullifier_seed` (`groth16.rs:60-61`), `reclaim-verify` `write_dec` (`lib.rs:204-211`) | Decimal writers for `u64`: at most 20 digits into a 20-byte buffer, and `n % 10 < 10`. |
| `humanity` `VK_IC[i + 1]` (`groth16.rs:98`) | `public` is a fixed-size `[U256; N_PUBLIC]` that matches the verifying key. |
| `reclaim-verify` JSON / canonical-form parser (`lib.rs:224-360`) | Indices into byte slices whose length is capped by `ProofTooLarge` (a few KB), so `usize` arithmetic cannot overflow. Out-of-range indexing would trap, and the parser checks every bound first (`i + 1 == obj.len()` style). `prop_signed_mutated_claim_never_traps_and_is_sound` mutates signed claims at random and checks that the parser never traps (`reclaim-verify/tests/props.rs`). |
| `reclaim-verify` `hex32` (`lib.rs:398-410`) | A `const fn` evaluated at compile time on constant hex strings; it never runs on-chain. |

## Medium, minor and enhancement findings

| # | Contract | Detector | Location | Verdict | Notes |
|---|---|---|---|---|---|
| S-1 | cliprail | `dos_unexpected_revert_with_storage` | `storage.rs:177` (`push_id`), `lib.rs:451`, `dispute.rs:84` | **Real, Medium → TM-14** | `CampaignClips` and `CampaignDisputes` are one storage entry each and grow without a cap. After a few thousand clips the entry would hit the ledger entry size limit, so new `register_clip` / `challenge` calls in that campaign would revert. Existing clips, claims and refunds are unaffected, so no funds lock. Fix before mainnet: a per-campaign cap plus paginated lists (TM-14). |
| S-2 | cliprail | `dos_unexpected_revert_with_storage`, `dos_unbounded_operation` | `lib.rs:767-779` (`get_clips`, `list_disputes`) | Same root cause, Low | Read-only views; the loop over epochs is bounded by `MAX_EPOCHS` (52). Pagination is part of TM-14. |
| S-3 | cliprail | `dos_unexpected_revert_with_storage` | `proof.rs:71` (`snapshot` map `set`) | False positive | One entry per campaign platform; platforms must already be allow-listed by the admin, so the map is small. |
| S-4 | cliprail | `avoid_vec_map_input` | `set_arbiters`, `set_attestors`, `set_owners`, `set_platform` | Accepted | Admin-only setters (`admin.require_auth`); the admin chooses the list size. |
| S-5 | cliprail | `avoid_vec_map_input` | `create_campaign_with_swap` `path` | Accepted | The path is checked (first = `token_in`, last = campaign token, at least 2 entries), and the brand pays for its own transaction. A huge path only makes the brand's own call run out of budget. |
| S-6 | cliprail | `unsafe_unwrap` | `dispute.rs:172-173` | False positive | A dispute can only exist for a registered clip-epoch (`challenge` checks both), and neither is ever deleted. |
| S-7 | cliprail | `unsafe_map_get` | `proof.rs:100` | False positive | Uses `.get(…).ok_or(Error::PlatformNotAllowed)?`; there is no panic path. |
| S-8 | cliprail | `divide_before_multiply` | `dispute.rs:26` (`dispute_fee`) | False positive | Deliberate: `bond / 10_000 * BPS + ceil(bond % 10_000 * BPS / 10_000)` is an exact round-up that cannot overflow. It is mirrored and tested in `packages/shared/src/payout.ts`. |
| S-9 | cliprail | `front_running` | `dispute.rs:165` (`withdraw`) | False positive | The amount comes from the caller's own `owed` ledger entry, which is removed before the transfer. There is no price or slippage. |
| S-10 | humanity | `missing_new_admin_auth` | `lib.rs:179` (`propose_admin`) | False positive | Two-step transfer: `propose_admin` only stores a pending admin, and `accept_admin` requires the new admin's signature. |
| S-11 | humanity | `unsafe_expect` | `lib.rs:222` (relayer) | False positive | The constructor always sets the relayer. |
| S-12 | humanity | `unsafe_expect` | `lib.rs:297` (`U256` to 32 bytes) | False positive | A `U256` is always 32 bytes. |
| S-13 | humanity | `dos_unexpected_revert_with_storage` | `groth16.rs:99` | False positive | A local `Vec` sized by the fixed number of public inputs; not storage. |
| S-14 | humanity | `unused_return_enum` | `lib.rs:247` | Accepted | `set_aadhaar_config` returns `Result` for a uniform admin API; there is no error path today. |
| S-15 | reclaim-verify | `unsafe_unwrap` | `lib.rs:172` | False positive | Slicing bytes 12..32 of a 32-byte hash always gives 20 bytes. |
| S-16 | all | `storage_change_events` (29, enhancement) | admin setters and user calls | **Partly real, Low** | These calls already emit events: create, swap funding, join, clip registration, proof, settle, claim, holdback claim, challenge, respond, resolve, refund, admin change, and both humanity registrations. Two groups do not. `withdraw` (dispute payouts) emits nothing, so indexers only see the token transfer. The admin setters emit nothing either: `set_attestors`, `set_owners`, `set_platform`, `set_arbiters`, `set_router`, `set_min_response_window`, `set_relayer`, `set_aadhaar_config` and `revoke`. Both are added to the mainnet hardening list with TM-21. |

## Reproducing

Scout 0.3.17 pins `dylint_driver` 4.1.2. Its build step clones `rust-lang/rust-clippy` at branch `master`, but that repository's default branch is now `main`, so the build fails with `revparse_ext failed for master`. This is the same failure as CI run 43616706075 (#70).

Until Scout ships a newer pin, apply a one-line local fix to the cargo registry copy and run:

```bash
sed -i '' 's/clone(RUST_CLIPPY_URL, "master"/clone(RUST_CLIPPY_URL, "main"/' \
  ~/.cargo/registry/src/*/dylint_internal-4.1.2/src/clippy_utils/repository.rs
for c in cliprail humanity reclaim-verify; do (cd contracts/$c && cargo scout-audit -o md --output-path ../../security/scout/raw/$c.md); done
```

The GitHub workflow (`.github/workflows/scout.yml`) stays manual-only, because the official action uses its own image with the same pin.
