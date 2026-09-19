//! Timeline (ARCHITECTURE §5.1), parameter validation and the pure payout math (§5.2).

use soroban_sdk::{Address, Env};

use crate::errors::Error;
use crate::storage::{self, DataKey};
use crate::types::*;

pub const MAX_TITLE: u32 = 64;
// Upper bounds that keep every i128/u64 product in the payout math far from overflow.
pub const MAX_EPOCHS: u32 = 52;
pub const MAX_CAP_VIEWS: u64 = 1_000_000_000_000;
pub const MAX_RATE: i128 = 1_000_000_000_000; // 100k USDC per 1k views
pub const MAX_BUDGET: i128 = 1_000_000_000_000_000;
pub const MAX_URL: u32 = 200;

pub fn content_end(p: &CampaignParams, e: u32) -> u64 {
    p.start + (e as u64 + 1) * p.epoch_len
}
pub fn proof_end(p: &CampaignParams, e: u32) -> u64 {
    content_end(p, e) + p.proof_window
}
pub fn challenge_end(p: &CampaignParams, e: u32) -> u64 {
    proof_end(p, e) + p.dispute_window / 2
}
pub fn dispute_end(p: &CampaignParams, e: u32) -> u64 {
    proof_end(p, e) + p.dispute_window
}
pub fn settle_at(p: &CampaignParams, e: u32) -> u64 {
    dispute_end(p, e) + p.arbiter_window
}
pub fn last(p: &CampaignParams) -> u32 {
    p.epochs - 1
}
/// No `prove_alive` / last-epoch holdback: refunds open `claim_grace` after the last settlement.
pub fn refund_at(p: &CampaignParams) -> u64 {
    settle_at(p, last(p)) + p.claim_grace
}

/// Content epoch index at `now`: 0 before start, `epochs` after the last content period.
pub fn current_epoch(p: &CampaignParams, now: u64) -> u32 {
    if now < p.start {
        return 0;
    }
    let e = (now - p.start) / p.epoch_len;
    if e >= p.epochs as u64 {
        p.epochs
    } else {
        e as u32
    }
}

/// The holdback of epoch `e` (< last) is released by a close proof for `e+1`, i.e. until
/// `proof_end(e+1)`; `claim_holdback` opens after that.
pub fn holdback_release_end(p: &CampaignParams, e: u32) -> u64 {
    proof_end(p, e + 1)
}

/// Holdback rate for epoch `e`: the last epoch has none (nothing could release it).
pub fn holdback_bps(p: &CampaignParams, e: u32) -> i128 {
    if e >= last(p) {
        0
    } else {
        p.holdback_bps as i128
    }
}

pub fn validate_params(env: &Env, brand: &Address, p: &CampaignParams) -> Result<(), Error> {
    let windows = p
        .proof_window
        .checked_add(p.dispute_window)
        .and_then(|x| x.checked_add(p.arbiter_window))
        .ok_or(Error::InvalidParams)?;
    let ok = p.budget > 0
        && p.budget <= MAX_BUDGET
        && p.rate_max_per_1k > 0
        && p.rate_max_per_1k <= MAX_RATE
        && p.cap_views_clip <= MAX_CAP_VIEWS
        && p.cap_views_human <= MAX_CAP_VIEWS
        && p.epochs >= 1
        && p.epochs <= MAX_EPOCHS
        // clippers must get a real claim window after the last settlement before refund
        && p.claim_grace >= p.epoch_len
        && p.epoch_len > 0
        && p.epoch_len >= windows
        && p.holdback_bps <= 10_000
        // a free challenge would let anyone exclude clips at no cost
        && p.bond > 0
        && p.arbiter != *brand
        && !p.platforms.is_empty()
        && p.start >= env.ledger().timestamp()
        && p.title.len() <= MAX_TITLE
        && p.brief_url.len() <= MAX_URL
        // the whole timeline must fit in u64
        && (p.epoch_len as u128) * (p.epochs as u128 + 1) + (windows as u128)
            + (p.claim_grace as u128) + (p.start as u128)
            < u64::MAX as u128;
    if !ok {
        return Err(Error::InvalidParams);
    }
    for pl in p.platforms.iter() {
        if !env.storage().instance().has(&DataKey::Platform(pl)) {
            return Err(Error::PlatformNotAllowed);
        }
    }
    Ok(())
}

// ---------------- payout math ----------------

/// Base share of the budget for epoch `e` (integer remainder goes to the last epoch).
pub fn base_budget(p: &CampaignParams, e: u32) -> i128 {
    let n = p.epochs as i128;
    let mut b = p.budget / n;
    if e == last(p) {
        b += p.budget % n;
    }
    b
}

/// Carry into epoch `e` = unspent budget of `e-1` (only known once `e-1` is settled).
pub fn carry_in(env: &Env, id: u64, e: u32) -> i128 {
    if e == 0 {
        return 0;
    }
    let prev = storage::epoch(env, id, e - 1);
    if prev.settled {
        prev.budget - prev.spent
    } else {
        0
    }
}

pub fn rate_for(p: &CampaignParams, budget_e: i128, w: u64) -> i128 {
    if w == 0 {
        return 0;
    }
    let r = budget_e * 1000 / (w as i128);
    if r > p.rate_max_per_1k {
        p.rate_max_per_1k
    } else {
        r
    }
}

/// Fill in budget/rate/spent/held_total for epoch `e` (does not persist).
pub fn compute_settlement(p: &CampaignParams, st: &mut EpochState, carry: i128, e: u32) {
    let budget_e = base_budget(p, e) + carry;
    let rate = rate_for(p, budget_e, st.total_weight);
    let spent = rate * (st.total_weight as i128) / 1000;
    st.budget = budget_e;
    st.rate = rate;
    st.spent = spent;
    st.held_total = spent * holdback_bps(p, e) / 10_000;
    st.settled = true;
}

/// pay = r_eff · w_p · w_clip / (raw_p · 1000)
pub fn clip_pay(rate: i128, pe: &ParticipantEpoch, w_clip: u64) -> i128 {
    if pe.raw == 0 || w_clip == 0 {
        return 0;
    }
    rate * (pe.weight as i128) * (w_clip as i128) / ((pe.raw as i128) * 1000)
}

/// Held part of a clip's pay, rounded UP so that Σ immediate + Σ survivor shares ≤ spent_e.
pub fn held_of(p: &CampaignParams, e: u32, pay: i128) -> i128 {
    (pay * holdback_bps(p, e) + 9_999) / 10_000
}

/// Clip weight for one epoch: growth over the epoch baseline, capped per clip, zeroed below `min_views`.
pub fn clip_weight(p: &CampaignParams, baseline: u64, views: u64) -> u64 {
    if views < baseline {
        return 0;
    }
    let w = core::cmp::min(views - baseline, p.cap_views_clip);
    if w < p.min_views {
        0
    } else {
        w
    }
}

/// Apply a change of one clip's weight (`old_w` → `new_w`) to its participant and epoch totals.
pub fn apply_weight_change(
    env: &Env,
    p: &CampaignParams,
    id: u64,
    owner: &Address,
    e: u32,
    old_w: u64,
    new_w: u64,
) {
    let mut pe = storage::part_epoch(env, id, owner, e);
    let old_pw = pe.weight;
    pe.raw = pe.raw - old_w + new_w;
    pe.weight = core::cmp::min(pe.raw, p.cap_views_human);
    storage::set_part_epoch(env, id, owner, e, &pe);
    if pe.weight != old_pw {
        let mut st = storage::epoch(env, id, e);
        st.total_weight = st.total_weight - old_pw + pe.weight;
        storage::set_epoch(env, id, e, &st);
    }
}
