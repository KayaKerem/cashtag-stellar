#![no_std]
//! Verifies Reclaim Protocol (zkTLS / zkFetch) proofs inside a Soroban contract and extracts
//! the values we pay on. See docs/ARCHITECTURE.md §8.2 and docs/DEVELOPMENT_PLAN.md §4.3.
//!
//! PUBLIC API IS FROZEN (used by `cliprail`): `ReclaimProof`, `VerifyError`, `Checked`, `verify`,
//! `recover_address`, and `testutils::{attestor_address, sign_proof}`.

use soroban_sdk::{contracttype, Bytes, BytesN, Env, Vec};

/// A Reclaim claim + attestor signature, exactly as produced by zkFetch (`claimData` + `signatures[0]`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReclaimProof {
    /// JCS-canonical `claimData.parameters` string, byte for byte.
    pub parameters: Bytes,
    /// JCS-canonical `claimData.context` string, byte for byte.
    pub context: Bytes,
    /// `claimData.owner` as lowercase ASCII "0x…".
    pub owner: Bytes,
    pub timestamp_s: u64,
    /// Reclaim epoch (not our campaign epoch).
    pub epoch: u32,
    /// r ‖ s
    pub signature: BytesN<64>,
    /// v − 27 (0 or 1)
    pub recovery_id: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VerifyError {
    BadSignature,
    UnknownAttestor,
    UnknownOwner,
    UrlMismatch,
    MatchMismatch,
    CodeNotFound,
    ViewsParseError,
    TooLarge,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Checked {
    /// keccak256("http\n" ‖ parameters ‖ "\n" ‖ context) — use as replay key.
    pub identifier: BytesN<32>,
    pub views: u64,
}

/// Full check: signature by an allowed attestor, allowed owner, URL == `expected_url`,
/// every `required` substring present in `parameters`, `views` parsed from context,
/// `code` present inside the extracted `desc`.
pub fn verify(
    _env: &Env,
    _proof: &ReclaimProof,
    _attestors: &Vec<BytesN<20>>,
    _owners: &Vec<Bytes>,
    _expected_url: &Bytes,
    _required: &Vec<Bytes>,
    _code: &Bytes,
) -> Result<Checked, VerifyError> {
    unimplemented!("K05")
}

/// Recover the Ethereum-style address (last 20 bytes of keccak(pubkey)) that signed `digest`.
pub fn recover_address(env: &Env, digest: &BytesN<32>, sig: &BytesN<64>, rec_id: u32) -> BytesN<20> {
    let pk: BytesN<65> = env.crypto_hazmat().secp256k1_recover(digest, sig, rec_id);
    let pk_bytes: Bytes = pk.into();
    let h: BytesN<32> = env.crypto().keccak256(&pk_bytes.slice(1..65)).into();
    let hb: Bytes = h.into();
    hb.slice(12..32).try_into().unwrap()
}

#[cfg(any(test, feature = "testutils"))]
pub mod testutils {
    use super::*;
    /// Ethereum address of a local secp256k1 test key.
    pub fn attestor_address(_env: &Env, _secret: &[u8; 32]) -> BytesN<20> {
        unimplemented!("K05")
    }
    /// Build a proof signed exactly like a Reclaim attestor would sign it.
    pub fn sign_proof(
        _env: &Env,
        _secret: &[u8; 32],
        _parameters: &str,
        _context: &str,
        _owner: &str,
        _timestamp_s: u64,
        _epoch: u32,
    ) -> ReclaimProof {
        unimplemented!("K05")
    }
}
