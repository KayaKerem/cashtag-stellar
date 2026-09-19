#![no_std]
//! One-human-per-campaign registry. A relayer (verifier service, after checking a Self proof or
//! in demo mode) writes a campaign-scoped nullifier for a wallet; `cliprail.join` reads
//! `is_verified`. See docs/INTERFACES.md §3.
//!
//! `register_zk` is the trustless path: the wallet itself submits an Anon Aadhaar (v2.0.0)
//! Groth16 proof, verified on-chain with the BN254 host functions. Both paths share the same
//! per-campaign nullifier/wallet storage, so one identity maps to at most one wallet per campaign.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env, U256,
};

mod groth16;
mod vk;

pub use groth16::Groth16Proof;

const DAY_LEDGERS: u32 = 17_280;
const TTL_EXTEND: u32 = 30 * DAY_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_EXTEND - DAY_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NullifierUsed = 2,
    WalletRegistered = 3,
    /// `register_zk` called before `set_aadhaar_config`.
    NotConfigured = 4,
    /// Groth16 pairing check failed (wrong wallet, campaign, key or tampered proof).
    InvalidProof = 5,
    /// Proof timestamp is too old (> `max_age`) or more than 1h in the future.
    StaleProof = 6,
    /// A public input is not a canonical BN254 scalar (>= r).
    InputNotInField = 7,
    /// `wallet` is a contract address; the signal binds an ed25519 account key.
    NotAnAccount = 8,
}

/// Allowed clock skew for proof timestamps ahead of the ledger (seconds).
const MAX_FUTURE_SKEW: u64 = 3600;

/// Anon Aadhaar verification parameters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AadhaarConfig {
    /// Poseidon hash of the UIDAI RSA public key the proof must be issued under
    /// (public signal 0).
    pub pubkey_hash: U256,
    /// Maximum age of the Aadhaar QR timestamp relative to the ledger time (seconds).
    pub max_age: u64,
    /// Informational: true when `pubkey_hash` is the Anon Aadhaar test key.
    pub test_key: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Relayer,
    /// (campaign_id, nullifier) -> wallet
    Nullifier(u64, BytesN<32>),
    /// (campaign_id, wallet) -> nullifier
    Wallet(u64, Address),
    AadhaarConfig,
}

#[contractevent(topics = ["human"], data_format = "vec")]
pub struct HumanEvent {
    #[topic]
    pub campaign_id: u64,
    pub wallet: Address,
    pub nullifier: BytesN<32>,
}

#[contractevent(topics = ["humanzk"], data_format = "vec")]
pub struct HumanZkEvent {
    #[topic]
    pub campaign_id: u64,
    pub wallet: Address,
    pub nullifier: BytesN<32>,
}

#[contract]
pub struct Humanity;

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

fn admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("not initialized")
}

/// Records `nullifier -> wallet` and `wallet -> nullifier` for a campaign (shared by both paths).
fn record(
    env: &Env,
    campaign_id: u64,
    nullifier: &BytesN<32>,
    wallet: &Address,
) -> Result<(), Error> {
    let nk = DataKey::Nullifier(campaign_id, nullifier.clone());
    let wk = DataKey::Wallet(campaign_id, wallet.clone());
    let st = env.storage().persistent();
    if st.has(&nk) {
        return Err(Error::NullifierUsed);
    }
    if st.has(&wk) {
        return Err(Error::WalletRegistered);
    }
    st.set(&nk, wallet);
    st.extend_ttl(&nk, TTL_THRESHOLD, TTL_EXTEND);
    st.set(&wk, nullifier);
    st.extend_ttl(&wk, TTL_THRESHOLD, TTL_EXTEND);
    Ok(())
}

/// Freshness + Groth16 check with explicit nullifierSeed / signalHash.
#[allow(clippy::too_many_arguments)]
pub(crate) fn check_aadhaar(
    env: &Env,
    config: &AadhaarConfig,
    proof: &Groth16Proof,
    nullifier: &U256,
    timestamp: u64,
    age_above_18: &U256,
    gender: &U256,
    pin_code: &U256,
    state: &U256,
    nullifier_seed: &U256,
    signal_hash: &U256,
) -> Result<(), Error> {
    let now = env.ledger().timestamp();
    if timestamp > now.saturating_add(MAX_FUTURE_SKEW)
        || now.saturating_sub(timestamp) > config.max_age
    {
        return Err(Error::StaleProof);
    }
    let public = [
        config.pubkey_hash.clone(),
        nullifier.clone(),
        U256::from_u128(env, timestamp as u128),
        age_above_18.clone(),
        gender.clone(),
        pin_code.clone(),
        state.clone(),
        nullifier_seed.clone(),
        signal_hash.clone(),
    ];
    groth16::verify(env, proof, &public).map_err(|e| match e {
        groth16::VerifyError::InputNotInField => Error::InputNotInField,
        groth16::VerifyError::InvalidProof => Error::InvalidProof,
    })
}

#[contractimpl]
impl Humanity {
    /// Runs once at deploy (no front-runnable `init`). `AlreadyInitialized` (1) stays reserved.
    pub fn __constructor(env: Env, admin: Address, relayer: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Relayer, &relayer);
        bump_instance(&env);
    }

    pub fn set_relayer(env: Env, relayer: Address) {
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Relayer, &relayer);
        bump_instance(&env);
    }

    /// Admin removes a wallet's registration for a campaign. The nullifier stays marked as used,
    /// so the same person cannot re-register with another wallet.
    pub fn revoke(env: Env, campaign_id: u64, wallet: Address) {
        admin(&env).require_auth();
        bump_instance(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::Wallet(campaign_id, wallet));
    }

    pub fn register(
        env: Env,
        campaign_id: u64,
        nullifier: BytesN<32>,
        wallet: Address,
    ) -> Result<(), Error> {
        let relayer: Address = env
            .storage()
            .instance()
            .get(&DataKey::Relayer)
            .expect("not initialized");
        relayer.require_auth();
        bump_instance(&env);

        record(&env, campaign_id, &nullifier, &wallet)?;
        HumanEvent {
            campaign_id,
            wallet,
            nullifier,
        }
        .publish(&env);
        Ok(())
    }

    /// Admin sets the Anon Aadhaar verification parameters (enables `register_zk`).
    pub fn set_aadhaar_config(env: Env, config: AadhaarConfig) -> Result<(), Error> {
        admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AadhaarConfig, &config);
        bump_instance(&env);
        Ok(())
    }

    pub fn aadhaar_config(env: Env) -> Option<AadhaarConfig> {
        env.storage().instance().get(&DataKey::AadhaarConfig)
    }

    /// Self-service registration with an Anon Aadhaar Groth16 proof.
    ///
    /// The contract recomputes the bound public inputs itself: pubkeyHash (config),
    /// nullifierSeed = keccak256("cliprail:" + campaign_id) >> 3 and
    /// signalHash = keccak256(ed25519 key of `wallet`) >> 3. The client supplies only the
    /// circuit outputs (nullifier, timestamp, revealed fields).
    #[allow(clippy::too_many_arguments)]
    pub fn register_zk(
        env: Env,
        campaign_id: u64,
        wallet: Address,
        proof: Groth16Proof,
        nullifier: U256,
        timestamp: u64,
        age_above_18: U256,
        gender: U256,
        pin_code: U256,
        state: U256,
    ) -> Result<(), Error> {
        wallet.require_auth();
        let config: AadhaarConfig = env
            .storage()
            .instance()
            .get(&DataKey::AadhaarConfig)
            .ok_or(Error::NotConfigured)?;
        bump_instance(&env);

        let signal = groth16::signal_hash(&env, &wallet).ok_or(Error::NotAnAccount)?;
        let seed = groth16::nullifier_seed(&env, campaign_id);
        check_aadhaar(
            &env,
            &config,
            &proof,
            &nullifier,
            timestamp,
            &age_above_18,
            &gender,
            &pin_code,
            &state,
            &seed,
            &signal,
        )?;

        let nullifier_bytes: BytesN<32> = nullifier
            .to_be_bytes()
            .try_into()
            .expect("u256 is 32 bytes");
        record(&env, campaign_id, &nullifier_bytes, &wallet)?;
        HumanZkEvent {
            campaign_id,
            wallet,
            nullifier: nullifier_bytes,
        }
        .publish(&env);
        Ok(())
    }

    pub fn is_verified(env: Env, campaign_id: u64, wallet: Address) -> bool {
        let st = env.storage().persistent();
        let wk = DataKey::Wallet(campaign_id, wallet);
        if st.has(&wk) {
            st.extend_ttl(&wk, TTL_THRESHOLD, TTL_EXTEND);
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_zk;
