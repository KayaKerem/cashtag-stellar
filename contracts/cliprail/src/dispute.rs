//! Bonded disputes (ARCHITECTURE §7, as amended): only the challenger posts a bond.
//! Bond payouts are credited and pulled with `withdraw`.
//! - challenger wins (unanswered by `dispute_end`, or arbiter) → bond refunded, clip-epoch excluded
//! - clipper wins (arbiter, or responded and arbiter silent until `settle_at`) → bond to clipper
//!
//! - every dispute, whatever the outcome, pays `DISPUTE_FEE_BPS` of the bond (rounded up) to the
//!   arbiter, so challenges are never free and the fee does not depend on the ruling (TM-6)
//!
//! Bonds never touch `campaign.balance`.

use soroban_sdk::{token, Address, Env, String};

use crate::epoch;
use crate::errors::Error;
use crate::events;
use crate::storage::{self, DataKey};
use crate::types::*;

pub const MAX_EVIDENCE: u32 = 200;
/// Share of the challenger's bond paid to the arbiter on every closed dispute.
pub const DISPUTE_FEE_BPS: i128 = 1_000;

/// Arbiter fee for `bond` (rounded up, so any positive bond pays at least 1 unit).
/// Overflow-free for any non-negative bond.
pub fn dispute_fee(bond: i128) -> i128 {
    bond / 10_000 * DISPUTE_FEE_BPS + (bond % 10_000 * DISPUTE_FEE_BPS + 9_999) / 10_000
}

pub fn challenge(
    env: &Env,
    campaign_id: u64,
    clip_id: u64,
    e: u32,
    challenger: Address,
    evidence: String,
) -> Result<u64, Error> {
    challenger.require_auth();
    let c = storage::campaign(env, campaign_id)?;
    let p = &c.params;
    // the arbiter must not rule on its own challenge
    if challenger == p.arbiter {
        return Err(Error::InvalidParams);
    }
    storage::clip_of(env, campaign_id, clip_id)?;
    if e >= p.epochs {
        return Err(Error::EpochOutOfRange);
    }
    if evidence.len() > MAX_EVIDENCE {
        return Err(Error::InvalidParams);
    }
    let now = env.ledger().timestamp();
    if now < epoch::proof_end(p, e) || now >= epoch::challenge_end(p, e) {
        return Err(Error::WrongPhase);
    }
    let mut ce = storage::clip_epoch(env, clip_id, e).ok_or(Error::NothingToClaim)?;
    if ce.weight == 0 {
        // nothing would be excluded
        return Err(Error::NothingToClaim);
    }
    let active_key = DataKey::ActiveDispute(clip_id, e);
    if storage::has(env, &active_key) || ce.status != ClipEpochStatus::Active {
        return Err(Error::AlreadyDisputed);
    }
    if p.bond > 0 {
        token::Client::new(env, &p.token).transfer(
            &challenger,
            env.current_contract_address(),
            &p.bond,
        );
    }
    let id = storage::next_id(env, &DataKey::DisputeCount);
    let d = Dispute {
        id,
        campaign_id,
        clip_id,
        epoch: e,
        challenger: challenger.clone(),
        evidence,
        status: DisputeStatus::Open,
        opened_at: now,
    };
    storage::set_dispute(env, &d);
    storage::put(env, &active_key, &id);
    storage::push_id(env, &DataKey::CampaignDisputes(campaign_id), id);
    ce.status = ClipEpochStatus::Challenged;
    storage::set_clip_epoch(env, clip_id, e, &ce);
    let mut st = storage::epoch(env, campaign_id, e);
    st.open_disputes += 1;
    storage::set_epoch(env, campaign_id, e, &st);
    events::Challenged {
        id: campaign_id,
        dispute_id: id,
        clip_id,
        epoch: e,
        challenger,
    }
    .publish(env);
    Ok(id)
}

pub fn respond(env: &Env, dispute_id: u64) -> Result<(), Error> {
    let mut d = storage::dispute(env, dispute_id)?;
    let c = storage::campaign(env, d.campaign_id)?;
    let clip = storage::clip(env, d.clip_id)?;
    clip.owner.require_auth();
    if d.status != DisputeStatus::Open {
        return Err(Error::WrongPhase);
    }
    if env.ledger().timestamp() >= epoch::dispute_end(&c.params, d.epoch) {
        return Err(Error::WrongPhase);
    }
    d.status = DisputeStatus::Responded;
    storage::set_dispute(env, &d);
    if let Some(mut ce) = storage::clip_epoch(env, d.clip_id, d.epoch) {
        ce.status = ClipEpochStatus::Responded;
        storage::set_clip_epoch(env, d.clip_id, d.epoch, &ce);
    }
    events::Responded {
        id: d.campaign_id,
        dispute_id,
    }
    .publish(env);
    Ok(())
}

pub fn resolve(env: &Env, dispute_id: u64, clipper_wins: bool) -> Result<(), Error> {
    let d = storage::dispute(env, dispute_id)?;
    let c = storage::campaign(env, d.campaign_id)?;
    c.params.arbiter.require_auth();
    if d.status != DisputeStatus::Responded {
        return Err(Error::WrongPhase);
    }
    let now = env.ledger().timestamp();
    if now < epoch::dispute_end(&c.params, d.epoch) || now >= epoch::settle_at(&c.params, d.epoch) {
        return Err(Error::WrongPhase);
    }
    close(env, &c, d, clipper_wins);
    Ok(())
}

pub fn finalize(env: &Env, dispute_id: u64) -> Result<(), Error> {
    let d = storage::dispute(env, dispute_id)?;
    let c = storage::campaign(env, d.campaign_id)?;
    let now = env.ledger().timestamp();
    match d.status {
        DisputeStatus::Open if now >= epoch::dispute_end(&c.params, d.epoch) => {
            close(env, &c, d, false)
        }
        DisputeStatus::Responded if now >= epoch::settle_at(&c.params, d.epoch) => {
            close(env, &c, d, true)
        }
        _ => return Err(Error::WrongPhase),
    }
    Ok(())
}

/// Pay out what `close` credited to `who` in `token`.
pub fn withdraw(env: &Env, who: Address, token_id: Address) -> Result<i128, Error> {
    who.require_auth();
    let amount = storage::owed(env, &who, &token_id);
    if amount <= 0 {
        return Err(Error::NothingToClaim);
    }
    env.storage().persistent().remove(&DataKey::Owed(who.clone(), token_id.clone()));
    token::Client::new(env, &token_id).transfer(&env.current_contract_address(), &who, &amount);
    Ok(amount)
}

/// Credit the bond, update clip-epoch / epoch state, emit `resolved`.
fn close(env: &Env, c: &Campaign, mut d: Dispute, clipper_wins: bool) {
    let p = &c.params;
    let clip = storage::clip(env, d.clip_id).unwrap();
    let mut ce = storage::clip_epoch(env, d.clip_id, d.epoch).unwrap();
    let to = if clipper_wins {
        ce.status = ClipEpochStatus::Active;
        d.status = DisputeStatus::ClipperWon;
        clip.owner.clone()
    } else {
        // exclude: remove this clip's weight from raw_p, w_p and W_e
        epoch::apply_weight_change(env, p, c.id, &clip.owner, d.epoch, ce.weight, 0);
        ce.weight = 0;
        ce.status = ClipEpochStatus::Excluded;
        d.status = DisputeStatus::ChallengerWon;
        d.challenger.clone()
    };
    // Credited, not pushed: a recipient that cannot receive the token (no trustline,
    // deauthorized) must never be able to block the dispute and hence settlement.
    if p.bond > 0 {
        let fee = dispute_fee(p.bond);
        storage::credit(env, &p.arbiter, &p.token, fee);
        storage::credit(env, &to, &p.token, p.bond - fee);
    }
    storage::set_clip_epoch(env, d.clip_id, d.epoch, &ce);
    let mut st = storage::epoch(env, c.id, d.epoch);
    st.open_disputes -= 1;
    storage::set_epoch(env, c.id, d.epoch, &st);
    storage::set_dispute(env, &d);
    events::Resolved {
        id: c.id,
        dispute_id: d.id,
        clipper_wins,
    }
    .publish(env);
}
