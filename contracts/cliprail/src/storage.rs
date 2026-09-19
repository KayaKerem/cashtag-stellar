use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, String, Symbol, Vec};

use crate::errors::Error;
use crate::types::*;

pub const DAY_LEDGERS: u32 = 17_280;
pub const TTL_EXTEND: u32 = 30 * DAY_LEDGERS;
pub const TTL_THRESHOLD: u32 = TTL_EXTEND - DAY_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // instance
    Admin,
    Humanity,
    Attestors,
    Owners,
    Platform(Symbol),
    CampaignCount,
    ClipCount,
    DisputeCount,
    // persistent
    Campaign(u64),
    Epoch(u64, u32),
    Participant(u64, Address),
    ParticipantEpoch(u64, Address, u32),
    Clip(u64),
    CampaignClips(u64),
    ClipEpoch(u64, u32),
    VideoIndex(Symbol, String),
    UsedProof(BytesN<32>),
    Dispute(u64),
    CampaignDisputes(u64),
    ActiveDispute(u64, u32),
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

pub fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, v: &V) {
    let st = env.storage().persistent();
    st.set(key, v);
    st.extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND);
}

pub fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
) -> Option<V> {
    env.storage().persistent().get(key)
}

/// Read and, if present, extend the entry's TTL (used on state-changing paths).
pub fn get_live<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
) -> Option<V> {
    let st = env.storage().persistent();
    let v = st.get(key);
    if v.is_some() {
        st.extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND);
    }
    v
}

pub fn has(env: &Env, key: &DataKey) -> bool {
    env.storage().persistent().has(key)
}

// ---- instance config ----

pub fn inst_get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
) -> Option<V> {
    env.storage().instance().get(key)
}

pub fn inst_set<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, v: &V) {
    env.storage().instance().set(key, v);
}

pub fn admin(env: &Env) -> Result<Address, Error> {
    inst_get(env, &DataKey::Admin).ok_or(Error::NotInitialized)
}

pub fn next_id(env: &Env, key: &DataKey) -> u64 {
    let n: u64 = inst_get(env, key).unwrap_or(0) + 1;
    inst_set(env, key, &n);
    n
}

// ---- typed accessors ----

pub fn campaign(env: &Env, id: u64) -> Result<Campaign, Error> {
    get_live(env, &DataKey::Campaign(id)).ok_or(Error::CampaignNotFound)
}

/// Read-only variant (no TTL bump) for view functions.
pub fn campaign_or_panic(env: &Env, id: u64) -> Campaign {
    get(env, &DataKey::Campaign(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::CampaignNotFound))
}

pub fn set_campaign(env: &Env, c: &Campaign) {
    put(env, &DataKey::Campaign(c.id), c);
}

pub fn epoch(env: &Env, id: u64, e: u32) -> EpochState {
    get_live(env, &DataKey::Epoch(id, e)).unwrap_or_default()
}

pub fn set_epoch(env: &Env, id: u64, e: u32, s: &EpochState) {
    put(env, &DataKey::Epoch(id, e), s);
}

pub fn clip(env: &Env, clip_id: u64) -> Result<Clip, Error> {
    get_live(env, &DataKey::Clip(clip_id)).ok_or(Error::ClipNotFound)
}

pub fn clip_of(env: &Env, campaign_id: u64, clip_id: u64) -> Result<Clip, Error> {
    let c = clip(env, clip_id)?;
    if c.campaign_id != campaign_id {
        return Err(Error::ClipNotFound);
    }
    Ok(c)
}

pub fn clip_epoch(env: &Env, clip_id: u64, e: u32) -> Option<ClipEpoch> {
    get_live(env, &DataKey::ClipEpoch(clip_id, e))
}

pub fn set_clip_epoch(env: &Env, clip_id: u64, e: u32, ce: &ClipEpoch) {
    put(env, &DataKey::ClipEpoch(clip_id, e), ce);
}

pub fn part_epoch(env: &Env, id: u64, who: &Address, e: u32) -> ParticipantEpoch {
    get_live(env, &DataKey::ParticipantEpoch(id, who.clone(), e)).unwrap_or_default()
}

pub fn set_part_epoch(env: &Env, id: u64, who: &Address, e: u32, pe: &ParticipantEpoch) {
    put(env, &DataKey::ParticipantEpoch(id, who.clone(), e), pe);
}

pub fn participant(env: &Env, id: u64, who: &Address) -> Option<Participant> {
    get_live(env, &DataKey::Participant(id, who.clone()))
}

pub fn id_list(env: &Env, key: &DataKey) -> Vec<u64> {
    get(env, key).unwrap_or_else(|| Vec::new(env))
}

pub fn push_id(env: &Env, key: &DataKey, v: u64) {
    let mut l = id_list(env, key);
    l.push_back(v);
    put(env, key, &l);
}

pub fn dispute(env: &Env, id: u64) -> Result<Dispute, Error> {
    get(env, &DataKey::Dispute(id)).ok_or(Error::DisputeNotFound)
}

pub fn set_dispute(env: &Env, d: &Dispute) {
    put(env, &DataKey::Dispute(d.id), d);
}
