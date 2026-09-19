#![no_std]
use soroban_sdk::{Bytes, BytesN, Env};

/// Recover the Ethereum-style address (last 20 bytes of keccak(pubkey)) that signed `digest`.
pub fn recover_address(env: &Env, digest: &BytesN<32>, sig: &BytesN<64>, rec_id: u32) -> BytesN<20> {
    let pk: BytesN<65> = env.crypto_hazmat().secp256k1_recover(digest, sig, rec_id);
    let pk_bytes: Bytes = pk.into();
    let h: BytesN<32> = env.crypto().keccak256(&pk_bytes.slice(1..65)).into();
    let hb: Bytes = h.into();
    hb.slice(12..32).try_into().unwrap()
}
