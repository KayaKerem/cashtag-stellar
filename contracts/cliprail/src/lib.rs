#![no_std]
//! ClipRail: brand campaign escrow paying clippers pro rata for zkTLS-proven view growth.
//! Design: docs/ARCHITECTURE.md; interface: docs/INTERFACES.md (v2).
//!
//! Implementation notes / deviations (hackathon scope):
//! - No `prove_alive` and no last-epoch holdback: the holdback of epoch `e` is released by a close
//!   proof for `e+1`; the last epoch pays in full at `claim`. Holdback that no survivor claims
//!   (and anything else left) returns to the brand via `refund` at `settle_at(last) + claim_grace`.
//! - Only the challenger posts a bond; the clipper responds for free.
//! - `submit_proof(e)` settles every pending epoch `< e` first (in order) and reverts with the
//!   settle error (`EpochNotReady` / `OpenDisputes` / …) if that is impossible, so the previous
//!   epoch's liveness marking is never skipped silently.
//! - Replay key = keccak256(identifier ‖ timestamp_s BE): two zkFetch runs over identical data
//!   share an identifier, so the attestor timestamp disambiguates them.
//! - `resolve` has no caller argument: a non-arbiter caller fails `require_auth` with a host auth
//!   error, so the `NotArbiter` (29) and `NotClipOwner` (30) codes are never returned.
//! - `challenge` on a clip-epoch without any close proof returns `NothingToClaim` (26).
//! - Participant code = "CR-" + base36(u32_be(sha256(campaign_id_be ‖ xdr(address))[0..4]) mod 36^6).

use soroban_sdk::{
    contract, contractclient, contractimpl, panic_with_error, token, xdr::ToXdr, Address, Bytes,
    BytesN, Env, String, Symbol, Vec,
};

mod dispute;
mod epoch;
mod errors;
mod events;
mod proof;
mod storage;
mod types;

pub use errors::Error;
pub use reclaim_verify::ReclaimProof;
pub use types::*;

use storage::DataKey;

/// Minimal client for the `humanity` contract (only what `join` needs).
#[contractclient(name = "HumanityClient")]
pub trait HumanityInterface {
    fn is_verified(env: Env, campaign_id: u64, wallet: Address) -> bool;
}

#[contract]
pub struct Cliprail;

fn now(env: &Env) -> u64 {
    env.ledger().timestamp()
}

fn pay_out(env: &Env, c: &mut Campaign, to: &Address, amount: i128) -> i128 {
    // clamp to the campaign ledger (rounding safety)
    let amt = if amount > c.balance {
        c.balance
    } else {
        amount
    };
    if amt > 0 {
        token::Client::new(env, &c.params.token).transfer(
            &env.current_contract_address(),
            to,
            &amt,
        );
        c.balance -= amt;
    }
    amt
}

fn participant_code(env: &Env, campaign_id: u64, who: &Address) -> String {
    const ALPHABET: &[u8; 36] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut pre = Bytes::from_array(env, &campaign_id.to_be_bytes());
    pre.append(&who.clone().to_xdr(env));
    let h = env.crypto().sha256(&pre).to_array();
    let mut n = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) % 2_176_782_336; // 36^6
    let mut out = *b"CR-000000";
    for i in (3..9).rev() {
        out[i] = ALPHABET[(n % 36) as usize];
        n /= 36;
    }
    String::from_bytes(env, &out)
}

/// Settle epoch `e` if all conditions hold (ARCHITECTURE §5.2 step 7). Mutates and persists `c`.
fn settle(env: &Env, c: &mut Campaign, e: u32) -> Result<(), Error> {
    let p = &c.params;
    if e >= p.epochs {
        return Err(Error::EpochOutOfRange);
    }
    let mut st = storage::epoch(env, c.id, e);
    if st.settled {
        return Err(Error::AlreadySettled);
    }
    if e > 0 && !storage::epoch(env, c.id, e - 1).settled {
        return Err(Error::PrevEpochNotSettled);
    }
    if now(env) < epoch::settle_at(p, e) {
        return Err(Error::EpochNotReady);
    }
    if st.open_disputes > 0 {
        return Err(Error::OpenDisputes);
    }
    let carry = epoch::carry_in(env, c.id, e);
    epoch::compute_settlement(p, &mut st, carry, e);
    storage::set_epoch(env, c.id, e, &st);
    c.settled_epochs = e + 1;
    storage::set_campaign(env, c);
    events::Settled {
        id: c.id,
        epoch: e,
        rate: st.rate,
        spent: st.spent,
        total_weight: st.total_weight,
    }
    .publish(env);
    Ok(())
}

fn clip_pay(env: &Env, c: &Campaign, clip: &Clip, e: u32, ce: &ClipEpoch, rate: i128) -> i128 {
    let pe = storage::part_epoch(env, c.id, &clip.owner, e);
    epoch::clip_pay(rate, &pe, ce.weight)
}

#[contractimpl]
impl Cliprail {
    // ------------------------------------------------------------------ admin

    pub fn init(env: Env, admin: Address, humanity: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        storage::inst_set(&env, &DataKey::Admin, &admin);
        storage::inst_set(&env, &DataKey::Humanity, &humanity);
        storage::bump_instance(&env);
        Ok(())
    }

    pub fn set_attestors(env: Env, attestors: Vec<BytesN<20>>) -> Result<(), Error> {
        storage::admin(&env)?.require_auth();
        storage::inst_set(&env, &DataKey::Attestors, &attestors);
        storage::bump_instance(&env);
        Ok(())
    }

    pub fn set_owners(env: Env, owners: Vec<Bytes>) -> Result<(), Error> {
        storage::admin(&env)?.require_auth();
        storage::inst_set(&env, &DataKey::Owners, &owners);
        storage::bump_instance(&env);
        Ok(())
    }

    pub fn set_platform(
        env: Env,
        platform: Symbol,
        url_prefix: Bytes,
        url_suffix: Bytes,
        required: Vec<Bytes>,
    ) -> Result<(), Error> {
        storage::admin(&env)?.require_auth();
        let cfg = PlatformConfig {
            url_prefix,
            url_suffix,
            required,
        };
        storage::inst_set(&env, &DataKey::Platform(platform), &cfg);
        storage::bump_instance(&env);
        Ok(())
    }

    // ------------------------------------------------------------------ campaign

    pub fn create_campaign(env: Env, brand: Address, params: CampaignParams) -> Result<u64, Error> {
        brand.require_auth();
        storage::admin(&env)?;
        storage::bump_instance(&env);
        epoch::validate_params(&env, &brand, &params)?;
        token::Client::new(&env, &params.token).transfer(
            &brand,
            env.current_contract_address(),
            &params.budget,
        );
        let id = storage::next_id(&env, &DataKey::CampaignCount);
        let c = Campaign {
            id,
            brand: brand.clone(),
            balance: params.budget,
            settled_epochs: 0,
            refunded: false,
            participants: 0,
            clips: 0,
            params,
        };
        storage::set_campaign(&env, &c);
        events::CampaignCreated {
            id,
            brand,
            budget: c.params.budget,
            epochs: c.params.epochs,
        }
        .publish(&env);
        Ok(id)
    }

    pub fn join(env: Env, campaign_id: u64, participant: Address) -> Result<String, Error> {
        participant.require_auth();
        storage::bump_instance(&env);
        let mut c = storage::campaign(&env, campaign_id)?;
        let p = &c.params;
        if now(&env) >= epoch::content_end(p, epoch::last(p)) {
            return Err(Error::WrongPhase);
        }
        let key = DataKey::Participant(campaign_id, participant.clone());
        if storage::has(&env, &key) {
            return Err(Error::AlreadyJoined);
        }
        if p.require_humanity {
            let h: Address =
                storage::inst_get(&env, &DataKey::Humanity).ok_or(Error::NotInitialized)?;
            if !HumanityClient::new(&env, &h).is_verified(&campaign_id, &participant) {
                return Err(Error::NotHuman);
            }
        }
        let code = participant_code(&env, campaign_id, &participant);
        let part = Participant {
            address: participant.clone(),
            code: code.clone(),
            joined_at: now(&env),
        };
        storage::put(&env, &key, &part);
        c.participants += 1;
        storage::set_campaign(&env, &c);
        events::Joined {
            id: campaign_id,
            participant,
            code: code.clone(),
        }
        .publish(&env);
        Ok(code)
    }

    pub fn register_clip(
        env: Env,
        campaign_id: u64,
        participant: Address,
        platform: Symbol,
        video_id: String,
        proof: ReclaimProof,
    ) -> Result<u64, Error> {
        participant.require_auth();
        storage::bump_instance(&env);
        let mut c = storage::campaign(&env, campaign_id)?;
        let p = &c.params;
        let t = now(&env);
        if t >= epoch::content_end(p, epoch::last(p)) {
            return Err(Error::WrongPhase);
        }
        let part = storage::participant(&env, campaign_id, &participant).ok_or(Error::NotJoined)?;
        if !p.platforms.contains(&platform) {
            return Err(Error::PlatformNotAllowed);
        }
        let vid = proof::validate_video_id(&env, &platform, &video_id)?;
        let vkey = DataKey::VideoIndex(platform.clone(), video_id.clone());
        if storage::has(&env, &vkey) {
            return Err(Error::VideoAlreadyRegistered);
        }
        if proof.timestamp_s > t + proof::MAX_FUTURE_SKEW
            || t.saturating_sub(proof.timestamp_s) > proof::MAX_PROOF_AGE
        {
            return Err(Error::ProofExpired);
        }
        let views = proof::verify_and_consume(&env, &proof, &platform, &vid, &part.code)?;

        let clip_id = storage::next_id(&env, &DataKey::ClipCount);
        let clip = Clip {
            id: clip_id,
            campaign_id,
            owner: participant.clone(),
            platform: platform.clone(),
            video_id: video_id.clone(),
            baseline: views,
            hwm: views,
            registered_at: t,
            first_epoch: epoch::current_epoch(p, t),
        };
        storage::put(&env, &DataKey::Clip(clip_id), &clip);
        storage::put(&env, &vkey, &clip_id);
        storage::push_id(&env, &DataKey::CampaignClips(campaign_id), clip_id);
        c.clips += 1;
        storage::set_campaign(&env, &c);
        events::ClipRegistered {
            id: campaign_id,
            clip_id,
            owner: participant,
            platform,
            video_id,
            baseline: views,
        }
        .publish(&env);
        Ok(clip_id)
    }

    // ------------------------------------------------------------------ epochs

    pub fn submit_proof(
        env: Env,
        campaign_id: u64,
        clip_id: u64,
        epoch: u32,
        proof: ReclaimProof,
    ) -> Result<(), Error> {
        let e = epoch;
        storage::bump_instance(&env);
        let mut c = storage::campaign(&env, campaign_id)?;
        let mut clip = storage::clip_of(&env, campaign_id, clip_id)?;
        let p = c.params.clone();
        if e >= p.epochs || e < clip.first_epoch {
            return Err(Error::EpochOutOfRange);
        }
        let t = now(&env);
        if t < epoch::content_end(&p, e) {
            return Err(Error::EpochNotReady);
        }
        if t > epoch::proof_end(&p, e) {
            return Err(Error::WrongPhase);
        }
        if proof.timestamp_s.saturating_add(proof::CLOSE_SLACK) < epoch::content_end(&p, e)
            || proof.timestamp_s > t + proof::MAX_FUTURE_SKEW
        {
            return Err(Error::ProofExpired);
        }
        let mut ce = storage::clip_epoch(&env, clip_id, e).unwrap_or(ClipEpoch {
            baseline: clip.hwm,
            views: 0,
            weight: 0,
            status: ClipEpochStatus::Active,
            claimed: false,
            alive: false,
            holdback_claimed: false,
        });
        match ce.status {
            ClipEpochStatus::Active => {}
            ClipEpochStatus::Excluded => return Err(Error::Excluded),
            _ => return Err(Error::AlreadyDisputed),
        }
        // liveness of e-1 needs e-1 settled: settle everything pending first, or revert
        if e >= 1 {
            while c.settled_epochs < e {
                let k = c.settled_epochs;
                settle(&env, &mut c, k)?;
            }
        }
        let part = storage::participant(&env, campaign_id, &clip.owner).ok_or(Error::NotJoined)?;
        let vid = clip.video_id.to_bytes();
        let views = proof::verify_and_consume(&env, &proof, &clip.platform, &vid, &part.code)?;

        // never decrease within the window
        if views > ce.views {
            ce.views = views;
        }
        let new_w = epoch::clip_weight(&p, ce.baseline, ce.views);
        epoch::apply_weight_change(&env, &p, campaign_id, &clip.owner, e, ce.weight, new_w);
        ce.weight = new_w;
        storage::set_clip_epoch(&env, clip_id, e, &ce);
        if views > clip.hwm {
            clip.hwm = views;
            storage::put(&env, &DataKey::Clip(clip_id), &clip);
        }

        // holdback liveness for e-1
        if e >= 1 {
            if let Some(mut prev) = storage::clip_epoch(&env, clip_id, e - 1) {
                if prev.weight > 0 && prev.status == ClipEpochStatus::Active && !prev.alive {
                    let mut st = storage::epoch(&env, campaign_id, e - 1);
                    let pay = clip_pay(&env, &c, &clip, e - 1, &prev, st.rate);
                    st.held_survived += epoch::held_of(&p, e - 1, pay);
                    storage::set_epoch(&env, campaign_id, e - 1, &st);
                    prev.alive = true;
                    storage::set_clip_epoch(&env, clip_id, e - 1, &prev);
                }
            }
        }
        events::ProofAccepted {
            id: campaign_id,
            clip_id,
            epoch: e,
            views: ce.views,
            weight: new_w,
        }
        .publish(&env);
        Ok(())
    }

    pub fn settle_epoch(env: Env, campaign_id: u64, epoch: u32) -> Result<(), Error> {
        storage::bump_instance(&env);
        let mut c = storage::campaign(&env, campaign_id)?;
        settle(&env, &mut c, epoch)
    }

    pub fn claim(env: Env, campaign_id: u64, clip_id: u64, epoch: u32) -> Result<i128, Error> {
        let e = epoch;
        storage::bump_instance(&env);
        let mut c = storage::campaign(&env, campaign_id)?;
        let clip = storage::clip_of(&env, campaign_id, clip_id)?;
        if e >= c.params.epochs {
            return Err(Error::EpochOutOfRange);
        }
        let st = storage::epoch(&env, campaign_id, e);
        if !st.settled {
            return Err(Error::EpochNotReady);
        }
        if now(&env) >= epoch::refund_at(&c.params) || c.refunded {
            return Err(Error::WrongPhase);
        }
        let mut ce = storage::clip_epoch(&env, clip_id, e).ok_or(Error::NothingToClaim)?;
        match ce.status {
            ClipEpochStatus::Excluded => return Err(Error::Excluded),
            ClipEpochStatus::Active => {}
            _ => return Err(Error::OpenDisputes),
        }
        if ce.claimed {
            return Err(Error::AlreadyClaimed);
        }
        let pay = clip_pay(&env, &c, &clip, e, &ce, st.rate);
        if pay == 0 {
            return Err(Error::NothingToClaim);
        }
        let immediate = pay - epoch::held_of(&c.params, e, pay);
        ce.claimed = true;
        storage::set_clip_epoch(&env, clip_id, e, &ce);
        let amt = pay_out(&env, &mut c, &clip.owner, immediate);
        storage::set_campaign(&env, &c);
        events::Claimed {
            id: campaign_id,
            clip_id,
            epoch: e,
            to: clip.owner,
            amount: amt,
        }
        .publish(&env);
        Ok(amt)
    }

    pub fn claim_holdback(
        env: Env,
        campaign_id: u64,
        clip_id: u64,
        epoch: u32,
    ) -> Result<i128, Error> {
        let e = epoch;
        storage::bump_instance(&env);
        let mut c = storage::campaign(&env, campaign_id)?;
        let clip = storage::clip_of(&env, campaign_id, clip_id)?;
        if e >= epoch::last(&c.params) {
            // the last epoch has no holdback
            return Err(Error::EpochOutOfRange);
        }
        let st = storage::epoch(&env, campaign_id, e);
        if !st.settled {
            return Err(Error::EpochNotReady);
        }
        let t = now(&env);
        if t <= epoch::holdback_release_end(&c.params, e) {
            return Err(Error::EpochNotReady);
        }
        if t >= epoch::refund_at(&c.params) || c.refunded {
            return Err(Error::WrongPhase);
        }
        let mut ce = storage::clip_epoch(&env, clip_id, e).ok_or(Error::NothingToClaim)?;
        if ce.status == ClipEpochStatus::Excluded {
            return Err(Error::Excluded);
        }
        if ce.holdback_claimed {
            return Err(Error::AlreadyClaimed);
        }
        if !ce.alive || st.held_survived == 0 {
            return Err(Error::NothingToClaim);
        }
        let held_i = epoch::held_of(&c.params, e, clip_pay(&env, &c, &clip, e, &ce, st.rate));
        let share = held_i * st.held_total / st.held_survived;
        if share == 0 {
            return Err(Error::NothingToClaim);
        }
        ce.holdback_claimed = true;
        storage::set_clip_epoch(&env, clip_id, e, &ce);
        let amt = pay_out(&env, &mut c, &clip.owner, share);
        storage::set_campaign(&env, &c);
        events::HoldbackClaimed {
            id: campaign_id,
            clip_id,
            epoch: e,
            to: clip.owner,
            amount: amt,
        }
        .publish(&env);
        Ok(amt)
    }

    pub fn refund(env: Env, campaign_id: u64) -> Result<i128, Error> {
        storage::bump_instance(&env);
        let mut c = storage::campaign(&env, campaign_id)?;
        if c.refunded {
            return Err(Error::AlreadyRefunded);
        }
        if now(&env) < epoch::refund_at(&c.params) {
            return Err(Error::RefundNotReady);
        }
        let brand = c.brand.clone();
        let amount = c.balance;
        let amt = pay_out(&env, &mut c, &brand, amount);
        c.refunded = true;
        storage::set_campaign(&env, &c);
        events::Refunded {
            id: campaign_id,
            brand,
            amount: amt,
        }
        .publish(&env);
        Ok(amt)
    }

    // ------------------------------------------------------------------ disputes

    pub fn challenge(
        env: Env,
        campaign_id: u64,
        clip_id: u64,
        epoch: u32,
        challenger: Address,
        evidence: String,
    ) -> Result<u64, Error> {
        storage::bump_instance(&env);
        dispute::challenge(&env, campaign_id, clip_id, epoch, challenger, evidence)
    }

    pub fn respond(env: Env, dispute_id: u64) -> Result<(), Error> {
        storage::bump_instance(&env);
        dispute::respond(&env, dispute_id)
    }

    pub fn resolve(env: Env, dispute_id: u64, clipper_wins: bool) -> Result<(), Error> {
        storage::bump_instance(&env);
        dispute::resolve(&env, dispute_id, clipper_wins)
    }

    pub fn finalize_dispute(env: Env, dispute_id: u64) -> Result<(), Error> {
        storage::bump_instance(&env);
        dispute::finalize(&env, dispute_id)
    }

    // ------------------------------------------------------------------ reads

    pub fn get_campaign(env: Env, id: u64) -> Campaign {
        storage::campaign_or_panic(&env, id)
    }

    pub fn get_epoch(env: Env, id: u64, e: u32) -> EpochState {
        let c = storage::campaign_or_panic(&env, id);
        if e >= c.params.epochs {
            panic_with_error!(&env, Error::EpochOutOfRange);
        }
        storage::epoch(&env, id, e)
    }

    pub fn get_participant(env: Env, id: u64, addr: Address) -> Option<Participant> {
        storage::participant(&env, id, &addr)
    }

    pub fn get_clip(env: Env, clip_id: u64) -> Clip {
        storage::clip(&env, clip_id).unwrap_or_else(|e| panic_with_error!(&env, e))
    }

    pub fn get_clip_epoch(env: Env, clip_id: u64, e: u32) -> Option<ClipEpoch> {
        storage::clip_epoch(&env, clip_id, e)
    }

    /// All clips of a campaign (registration order) with their per-epoch state.
    pub fn get_clips(env: Env, campaign_id: u64) -> Vec<ClipView> {
        let c = storage::campaign_or_panic(&env, campaign_id);
        let mut out = Vec::new(&env);
        for clip_id in storage::id_list(&env, &DataKey::CampaignClips(campaign_id)).iter() {
            let clip = storage::clip(&env, clip_id).unwrap_or_else(|e| panic_with_error!(&env, e));
            let mut epochs = Vec::new(&env);
            for e in 0..c.params.epochs {
                epochs.push_back(storage::clip_epoch(&env, clip_id, e));
            }
            out.push_back(ClipView { clip, epochs });
        }
        out
    }

    pub fn list_disputes(env: Env, campaign_id: u64) -> Vec<Dispute> {
        let mut out = Vec::new(&env);
        for id in storage::id_list(&env, &DataKey::CampaignDisputes(campaign_id)).iter() {
            if let Ok(d) = storage::dispute(&env, id) {
                out.push_back(d);
            }
        }
        out
    }

    pub fn campaign_count(env: Env) -> u64 {
        storage::inst_get(&env, &DataKey::CampaignCount).unwrap_or(0)
    }
}

#[cfg(test)]
extern crate std;
#[cfg(test)]
mod test;
