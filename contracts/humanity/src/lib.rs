#![no_std]
//! One-human-per-campaign registry. A relayer (verifier service, after checking a Self proof or
//! in demo mode) writes a campaign-scoped nullifier for a wallet; `cliprail.join` reads
//! `is_verified`. See docs/INTERFACES.md §3.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
};

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
}

#[contractevent(topics = ["human"], data_format = "vec")]
pub struct HumanEvent {
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

        let nk = DataKey::Nullifier(campaign_id, nullifier.clone());
        let wk = DataKey::Wallet(campaign_id, wallet.clone());
        let st = env.storage().persistent();
        if st.has(&nk) {
            return Err(Error::NullifierUsed);
        }
        if st.has(&wk) {
            return Err(Error::WalletRegistered);
        }
        st.set(&nk, &wallet);
        st.extend_ttl(&nk, TTL_THRESHOLD, TTL_EXTEND);
        st.set(&wk, &nullifier);
        st.extend_ttl(&wk, TTL_THRESHOLD, TTL_EXTEND);
        HumanEvent {
            campaign_id,
            wallet,
            nullifier,
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
