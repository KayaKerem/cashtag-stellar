//! Anon Aadhaar (v2.0.0 circuit) Groth16 verifier on the Soroban BN254 host functions.
//!
//! Public signals order (snarkjs `public.json`, 9 entries):
//!   0 pubkeyHash, 1 nullifier, 2 timestamp, 3 ageAbove18, 4 gender, 5 pinCode, 6 state,
//!   7 nullifierSeed, 8 signalHash

use soroban_sdk::{
    address_payload::AddressPayload,
    contracttype,
    crypto::bn254::{Bn254Fr as Fr, Bn254G1Affine as G1, Bn254G2Affine as G2},
    vec, Address, Bytes, BytesN, Env, Vec, U256,
};

use crate::vk;

/// Number of public inputs of the circuit.
pub const N_PUBLIC: usize = vk::VK_IC.len() - 1;

/// Groth16 proof. G1 = be(x) || be(y); G2 = x.c1 || x.c0 || y.c1 || y.c0 (big-endian limbs).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Groth16Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VerifyError {
    /// A public input is >= the BN254 scalar field modulus r (would be silently reduced).
    InputNotInField,
    /// Pairing check failed.
    InvalidProof,
}

/// BN254 scalar field modulus r.
pub fn fr_modulus(env: &Env) -> U256 {
    U256::from_parts(
        env,
        0x30644e72e131a029,
        0xb85045b68181585d,
        0x2833e84879b97091,
        0x43e1f593f0000001,
    )
}

/// Anon Aadhaar `hash()` convention: keccak256(bytes) >> 3 (fits the field).
pub fn keccak_field(env: &Env, data: &Bytes) -> U256 {
    let h: BytesN<32> = env.crypto().keccak256(data).into();
    U256::from_be_bytes(env, &Bytes::from(h)).shr(3)
}

/// nullifierSeed for a campaign: keccak256(utf8("cliprail:" + decimal(campaign_id))) >> 3.
pub fn nullifier_seed(env: &Env, campaign_id: u64) -> U256 {
    const PREFIX: &[u8] = b"cliprail:";
    let mut digits = [0u8; 20];
    let mut n = campaign_id;
    let mut i = digits.len();
    loop {
        i -= 1;
        digits[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    let mut msg = Bytes::from_slice(env, PREFIX);
    msg.extend_from_slice(&digits[i..]);
    keccak_field(env, &msg)
}

/// signalHash for a Stellar account: keccak256(raw 32-byte ed25519 public key) >> 3.
/// Returns `None` for contract addresses (no ed25519 key to bind).
pub fn signal_hash(env: &Env, wallet: &Address) -> Option<U256> {
    match wallet.to_payload() {
        Some(AddressPayload::AccountIdPublicKeyEd25519(pk)) => {
            Some(keccak_field(env, &Bytes::from(pk)))
        }
        _ => None,
    }
}

/// Verifies `proof` against the embedded verification key and `public` inputs.
/// Every input must be canonical (< r); the caller supplies exactly `N_PUBLIC` inputs.
pub fn verify(
    env: &Env,
    proof: &Groth16Proof,
    public: &[U256; N_PUBLIC],
) -> Result<(), VerifyError> {
    let r = fr_modulus(env);
    let mut points: Vec<G1> = Vec::new(env);
    let mut scalars: Vec<Fr> = Vec::new(env);
    for (i, s) in public.iter().enumerate() {
        // Fr::from(U256) reduces mod r, so aliased values (s + k*r) must be rejected explicitly.
        if *s >= r {
            return Err(VerifyError::InputNotInField);
        }
        points.push_back(G1::from_array(env, &vk::VK_IC[i + 1]));
        scalars.push_back(Fr::from(s.clone()));
    }
    let bn = env.crypto().bn254();
    // vk_x = IC0 + sum(IC[i+1] * input[i])
    let vk_x = bn.g1_msm(points, scalars) + G1::from_array(env, &vk::VK_IC[0]);

    // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    let neg_a = -G1::from_bytes(proof.a.clone());
    let g1s = vec![
        env,
        neg_a,
        G1::from_array(env, &vk::VK_ALPHA_G1),
        vk_x,
        G1::from_bytes(proof.c.clone()),
    ];
    let g2s = vec![
        env,
        G2::from_bytes(proof.b.clone()),
        G2::from_array(env, &vk::VK_BETA_G2),
        G2::from_array(env, &vk::VK_GAMMA_G2),
        G2::from_array(env, &vk::VK_DELTA_G2),
    ];
    if bn.pairing_check(g1s, g2s) {
        Ok(())
    } else {
        Err(VerifyError::InvalidProof)
    }
}
