//! Anon Aadhaar / Groth16 tests.
//!
//! * `spike_*`: a real v2.0.0 proof (test UIDAI key) generated with a string campaign
//!   ("cliprail-campaign-42"), checked through `check_aadhaar` with explicit seed/signal.
//! * `zk_*`: end-to-end `register_zk` against `fixtures/aadhaar/` (generated with the
//!   contract's seed/signal convention).
extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Bytes, IntoVal};
use std::string::String;

const SPIKE_PROOF: &str = include_str!("../testdata/spike_proof.json");
const SPIKE_META: &str = include_str!("../testdata/spike_meta.json");
const FIXTURE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/aadhaar");

/// Maximum proof age used by the tests (3 days).
const MAX_AGE: u64 = 3 * 24 * 3600;

// ---------- helpers ----------

fn strip0x(s: &str) -> &str {
    s.strip_prefix("0x").unwrap_or(s)
}

fn hex_bytes<const N: usize>(h: &str) -> [u8; N] {
    let h = strip0x(h);
    assert_eq!(h.len(), 2 * N, "hex length");
    let mut out = [0u8; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

/// Decimal string -> 32-byte big-endian.
fn dec_bytes(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for ch in s.trim().bytes() {
        assert!(ch.is_ascii_digit(), "bad decimal {s}");
        let mut carry = (ch - b'0') as u32;
        for b in out.iter_mut().rev() {
            let v = (*b as u32) * 10 + carry;
            *b = (v & 0xff) as u8;
            carry = v >> 8;
        }
        assert_eq!(carry, 0, "overflow {s}");
    }
    out
}

/// JSON value (decimal string, 0x/64-hex string or number) -> U256.
fn u256_of(env: &Env, v: &serde_json::Value) -> U256 {
    let bytes = match v {
        serde_json::Value::Number(n) => dec_bytes(&std::format!("{n}")),
        serde_json::Value::String(s) => {
            let t = strip0x(s);
            if s.starts_with("0x") || (t.len() == 64 && t.bytes().any(|c| c.is_ascii_alphabetic()))
            {
                let mut padded = String::from("0").repeat(64 - t.len());
                padded.push_str(t);
                hex_bytes::<32>(&padded)
            } else {
                dec_bytes(s)
            }
        }
        _ => panic!("not a number: {v}"),
    };
    U256::from_be_bytes(env, &Bytes::from_array(env, &bytes))
}

fn u64_of(v: &serde_json::Value) -> u64 {
    match v {
        serde_json::Value::Number(n) => n.as_u64().unwrap(),
        serde_json::Value::String(s) => s.parse().unwrap(),
        _ => panic!("not a u64: {v}"),
    }
}

fn proof_of(env: &Env, v: &serde_json::Value) -> Groth16Proof {
    Groth16Proof {
        a: BytesN::from_array(env, &hex_bytes::<64>(v["a"].as_str().unwrap())),
        b: BytesN::from_array(env, &hex_bytes::<128>(v["b"].as_str().unwrap())),
        c: BytesN::from_array(env, &hex_bytes::<64>(v["c"].as_str().unwrap())),
    }
}

fn test_pubkey_hash(env: &Env) -> U256 {
    // 15134874015316324267425466444584014077184337590635665158241104437045239495873
    U256::from_parts(
        env,
        0x217608fddff9ccea,
        0x4198e5674875e703,
        0x458f8700115ef34b,
        0xbee6ae94a3c83cc1,
    )
}

fn prod_pubkey_hash(env: &Env) -> U256 {
    // 18063425702624337643644061197836918910810808173893535653269228433734128853484
    U256::from_parts(
        env,
        0x27ef89612fc4a823,
        0xb52a334ed4f2a48f,
        0x8d066d8b3ed2ba56,
        0x72bb5f531aab61ec,
    )
}

fn test_config(env: &Env) -> AadhaarConfig {
    AadhaarConfig {
        pubkey_hash: test_pubkey_hash(env),
        max_age: MAX_AGE,
        test_key: true,
    }
}

fn setup() -> (Env, HumanityClient<'static>, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let id = env.register(Humanity, (admin.clone(), relayer.clone()));
    let client = HumanityClient::new(&env, &id);
    (env, client, admin, relayer)
}

// ---------- spike proof (explicit seed/signal) ----------

struct Spike {
    proof: Groth16Proof,
    public: std::vec::Vec<U256>,
    wallet: Address,
    campaign: String,
}

fn spike(env: &Env) -> Spike {
    let p: serde_json::Value = serde_json::from_str(SPIKE_PROOF).unwrap();
    let m: serde_json::Value = serde_json::from_str(SPIKE_META).unwrap();
    Spike {
        proof: proof_of(env, &p),
        public: p["public"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| u256_of(env, s))
            .collect(),
        wallet: Address::from_str(env, m["STELLAR_ADDRESS"].as_str().unwrap()),
        campaign: m["CAMPAIGN_ID"].as_str().unwrap().into(),
    }
}

/// Runs `check_aadhaar` on the spike proof with (possibly modified) inputs.
fn check_spike(
    env: &Env,
    c: &HumanityClient,
    config: &AadhaarConfig,
    proof: &Groth16Proof,
    pubs: &[U256],
) -> Result<(), Error> {
    let ts: u64 = pubs[2].to_u128().unwrap() as u64;
    env.as_contract(&c.address, || {
        check_aadhaar(
            env, config, proof, &pubs[1], ts, &pubs[3], &pubs[4], &pubs[5], &pubs[6], &pubs[7],
            &pubs[8],
        )
    })
}

fn spike_env() -> (Env, HumanityClient<'static>, Spike) {
    let (env, c, _a, _r) = setup();
    let s = spike(&env);
    let ts = s.public[2].to_u128().unwrap() as u64;
    env.ledger().set_timestamp(ts + 60);
    (env, c, s)
}

#[test]
fn spike_proof_verifies() {
    let (env, c, s) = spike_env();
    assert_eq!(s.public[0], test_pubkey_hash(&env));
    // the contract's hashing matches the prover's (signal = raw ed25519 key; string seed)
    assert_eq!(groth16::signal_hash(&env, &s.wallet).unwrap(), s.public[8]);
    let seed = groth16::keccak_field(&env, &Bytes::from_slice(&env, s.campaign.as_bytes()));
    assert_eq!(seed, s.public[7]);

    env.cost_estimate().budget().reset_default();
    assert_eq!(
        check_spike(&env, &c, &test_config(&env), &s.proof, &s.public),
        Ok(())
    );
    std::println!(
        "groth16 verify (9 inputs): cpu_insns={} mem_bytes={}",
        env.cost_estimate().budget().cpu_instruction_cost(),
        env.cost_estimate().budget().memory_bytes_cost()
    );
}

#[test]
fn spike_tampered_inputs_rejected() {
    let (env, c, s) = spike_env();
    let cfg = test_config(&env);
    let one = U256::from_u32(&env, 1);
    // each revealed/bound signal is covered by the proof
    for idx in [1usize, 3, 4, 5, 6, 7, 8] {
        let mut p = s.public.clone();
        p[idx] = p[idx].add(&one);
        assert_eq!(
            check_spike(&env, &c, &cfg, &s.proof, &p),
            Err(Error::InvalidProof),
            "signal {idx}"
        );
    }
    // timestamp shifted by one second
    let mut p = s.public.clone();
    p[2] = p[2].add(&one);
    env.ledger().set_timestamp(p[2].to_u128().unwrap() as u64);
    assert_eq!(
        check_spike(&env, &c, &cfg, &s.proof, &p),
        Err(Error::InvalidProof)
    );
}

#[test]
fn spike_tampered_proof_rejected() {
    let (env, c, s) = spike_env();
    let cfg = test_config(&env);
    // A and C swapped (both valid G1 points)
    let swapped = Groth16Proof {
        a: s.proof.c.clone(),
        b: s.proof.b.clone(),
        c: s.proof.a.clone(),
    };
    assert_eq!(
        check_spike(&env, &c, &cfg, &swapped, &s.public),
        Err(Error::InvalidProof)
    );
    // -A instead of A (y -> p - y keeps it on the curve)
    let neg_a = {
        let a = soroban_sdk::crypto::bn254::Bn254G1Affine::from_bytes(s.proof.a.clone());
        (-a).to_bytes()
    };
    let flipped = Groth16Proof {
        a: neg_a,
        b: s.proof.b.clone(),
        c: s.proof.c.clone(),
    };
    assert_eq!(
        check_spike(&env, &c, &cfg, &flipped, &s.public),
        Err(Error::InvalidProof)
    );
}

#[test]
fn spike_wrong_key_wallet_or_campaign_rejected() {
    let (env, c, s) = spike_env();
    // production key pinned: a test-key proof fails
    let prod = AadhaarConfig {
        pubkey_hash: prod_pubkey_hash(&env),
        max_age: MAX_AGE,
        test_key: false,
    };
    assert_eq!(
        check_spike(&env, &c, &prod, &s.proof, &s.public),
        Err(Error::InvalidProof)
    );
    // other wallet
    let other = Address::from_str(
        &env,
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
    );
    let mut p = s.public.clone();
    p[8] = groth16::signal_hash(&env, &other).unwrap();
    assert_eq!(
        check_spike(&env, &c, &test_config(&env), &s.proof, &p),
        Err(Error::InvalidProof)
    );
    // numeric campaign seed instead of the proof's
    let mut p = s.public.clone();
    p[7] = groth16::nullifier_seed(&env, 42);
    assert_eq!(
        check_spike(&env, &c, &test_config(&env), &s.proof, &p),
        Err(Error::InvalidProof)
    );
}

#[test]
fn spike_aliased_inputs_rejected() {
    let (env, c, s) = spike_env();
    let r = groth16::fr_modulus(&env);
    // nullifier + r is the same field element: must not be accepted as a distinct nullifier
    for idx in [1usize, 3, 7, 8] {
        let mut p = s.public.clone();
        p[idx] = p[idx].add(&r);
        assert_eq!(
            check_spike(&env, &c, &test_config(&env), &s.proof, &p),
            Err(Error::InputNotInField),
            "signal {idx}"
        );
    }
    // r itself is out of range, r - 1 is in range (but not the right value)
    let mut p = s.public.clone();
    p[4] = r.clone();
    assert_eq!(
        check_spike(&env, &c, &test_config(&env), &s.proof, &p),
        Err(Error::InputNotInField)
    );
    p[4] = r.sub(&U256::from_u32(&env, 1));
    assert_eq!(
        check_spike(&env, &c, &test_config(&env), &s.proof, &p),
        Err(Error::InvalidProof)
    );
    // aliased configured pubkey hash
    let cfg = AadhaarConfig {
        pubkey_hash: test_pubkey_hash(&env).add(&r),
        max_age: MAX_AGE,
        test_key: true,
    };
    assert_eq!(
        check_spike(&env, &c, &cfg, &s.proof, &s.public),
        Err(Error::InputNotInField)
    );
}

#[test]
fn spike_freshness_window() {
    let (env, c, s) = spike_env();
    let cfg = test_config(&env);
    let ts = s.public[2].to_u128().unwrap() as u64;
    // exactly max_age old: ok; one more second: stale
    env.ledger().set_timestamp(ts + MAX_AGE);
    assert_eq!(check_spike(&env, &c, &cfg, &s.proof, &s.public), Ok(()));
    env.ledger().set_timestamp(ts + MAX_AGE + 1);
    assert_eq!(
        check_spike(&env, &c, &cfg, &s.proof, &s.public),
        Err(Error::StaleProof)
    );
    // up to 1h in the future: ok; beyond: stale
    env.ledger().set_timestamp(ts - 3600);
    assert_eq!(check_spike(&env, &c, &cfg, &s.proof, &s.public), Ok(()));
    env.ledger().set_timestamp(ts - 3601);
    assert_eq!(
        check_spike(&env, &c, &cfg, &s.proof, &s.public),
        Err(Error::StaleProof)
    );
}

// ---------- hashing conventions ----------

#[test]
fn nullifier_seed_convention() {
    let env = Env::default();
    for (id, s) in [
        (0u64, "cliprail:0"),
        (7, "cliprail:7"),
        (42, "cliprail:42"),
        (1_000_000, "cliprail:1000000"),
        (u64::MAX, "cliprail:18446744073709551615"),
    ] {
        let expected = groth16::keccak_field(&env, &Bytes::from_slice(&env, s.as_bytes()));
        assert_eq!(groth16::nullifier_seed(&env, id), expected, "{s}");
        assert!(expected < groth16::fr_modulus(&env));
    }
}

#[test]
fn signal_hash_rejects_contract_address() {
    let env = Env::default();
    let contract_addr = Address::generate(&env);
    assert!(groth16::signal_hash(&env, &contract_addr).is_none());
}

// ---------- config / register_zk guards (no fixture needed) ----------

#[test]
fn aadhaar_config_admin_only() {
    let (env, c, admin, relayer) = setup();
    assert_eq!(c.aadhaar_config(), None);
    let cfg = test_config(&env);
    let res = c
        .mock_auths(&[MockAuth {
            address: &relayer,
            invoke: &MockAuthInvoke {
                contract: &c.address,
                fn_name: "set_aadhaar_config",
                args: (cfg.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_aadhaar_config(&cfg);
    assert!(matches!(res, Err(Err(_))), "{res:?}");
    assert_eq!(c.aadhaar_config(), None);

    env.mock_all_auths();
    c.set_aadhaar_config(&cfg);
    assert_eq!(env.auths()[0].0, admin);
    assert_eq!(c.aadhaar_config(), Some(cfg));
}

#[test]
fn register_zk_requires_config() {
    let (env, c, _a, _r) = setup();
    env.mock_all_auths();
    let s = spike(&env);
    let p = &s.public;
    let res = c.try_register_zk(
        &1, &s.wallet, &s.proof, &p[1], &1, &p[3], &p[4], &p[5], &p[6],
    );
    assert_eq!(res, Err(Ok(Error::NotConfigured)));
}

#[test]
fn register_zk_rejects_contract_wallet() {
    let (env, c, _a, _r) = setup();
    env.mock_all_auths();
    c.set_aadhaar_config(&test_config(&env));
    let s = spike(&env);
    let p = &s.public;
    let w = Address::generate(&env); // contract address
    let res = c.try_register_zk(&1, &w, &s.proof, &p[1], &1, &p[3], &p[4], &p[5], &p[6]);
    assert_eq!(res, Err(Ok(Error::NotAnAccount)));
}

#[test]
fn register_zk_requires_wallet_auth() {
    let (env, c, admin, _r) = setup();
    c.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &c.address,
            fn_name: "set_aadhaar_config",
            args: (test_config(&env),).into_val(&env),
            sub_invokes: &[],
        },
    }])
    .set_aadhaar_config(&test_config(&env));
    let s = spike(&env);
    let p = &s.public;
    let res = c.try_register_zk(
        &1, &s.wallet, &s.proof, &p[1], &1, &p[3], &p[4], &p[5], &p[6],
    );
    assert!(matches!(res, Err(Err(_))), "{res:?}");
}

#[test]
fn register_zk_spike_proof_fails_under_numeric_campaign() {
    // the spike proof was bound to a string campaign, so no u64 campaign id can accept it
    let (env, c, s) = spike_env();
    env.mock_all_auths();
    c.set_aadhaar_config(&test_config(&env));
    let p = &s.public;
    let ts = p[2].to_u128().unwrap() as u64;
    let res = c.try_register_zk(
        &42, &s.wallet, &s.proof, &p[1], &ts, &p[3], &p[4], &p[5], &p[6],
    );
    assert_eq!(res, Err(Ok(Error::InvalidProof)));
    assert!(!c.is_verified(&42, &s.wallet));
}

// ---------- end-to-end with fixtures/aadhaar ----------

struct Fixture {
    proof: Groth16Proof,
    campaign_id: u64,
    wallet: Address,
    nullifier: U256,
    timestamp: u64,
    age: U256,
    gender: U256,
    pin: U256,
    state: U256,
    pubkey_hash: U256,
}

/// Fixture identities (`fixtures/aadhaar/<name>/`): distinct test identities, campaign 1.
const ALICE: &str = "alice_clipper1_c1";
const BOB: &str = "bob_clipper2_c1";
/// Alice's identity again, proving for Bob's wallet (clipper2): same nullifier as ALICE.
const ALICE_SYBIL: &str = "alice_clipper2_c1_sybil";

fn fixture(env: &Env, name: &str) -> Fixture {
    let read = |f: &str| {
        let path = std::format!("{FIXTURE_DIR}/{name}/{f}");
        let s = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        serde_json::from_str::<serde_json::Value>(&s).unwrap()
    };
    let p = read("proof_soroban.json");
    let m = read("meta.json");
    let sig: std::vec::Vec<U256> = p["public_signals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| u256_of(env, v))
        .collect();
    assert_eq!(sig.len(), 9);
    let fx = Fixture {
        proof: proof_of(env, &p),
        campaign_id: u64_of(&m["campaign_id"]),
        wallet: Address::from_str(env, m["wallet"].as_str().unwrap()),
        nullifier: sig[1].clone(),
        timestamp: sig[2].to_u128().unwrap() as u64,
        age: sig[3].clone(),
        gender: sig[4].clone(),
        pin: sig[5].clone(),
        state: sig[6].clone(),
        pubkey_hash: sig[0].clone(),
    };
    // meta fields agree with the signals, and the signals follow the contract's convention
    if let Some(n) = m.get("nullifier") {
        assert_eq!(u256_of(env, n), fx.nullifier, "meta.nullifier");
    }
    if let Some(t) = m.get("timestamp") {
        assert_eq!(u64_of(t), fx.timestamp, "meta.timestamp");
    }
    assert_eq!(
        groth16::nullifier_seed(env, fx.campaign_id),
        sig[7],
        "seed convention"
    );
    assert_eq!(
        groth16::signal_hash(env, &fx.wallet).unwrap(),
        sig[8],
        "signal convention"
    );
    fx
}

fn zk_env() -> (Env, HumanityClient<'static>, Address, Fixture) {
    let (env, c, _admin, relayer) = setup();
    let fx = fixture(&env, ALICE);
    env.ledger().set_timestamp(fx.timestamp + 60);
    env.mock_all_auths();
    c.set_aadhaar_config(&AadhaarConfig {
        pubkey_hash: fx.pubkey_hash.clone(),
        max_age: MAX_AGE,
        test_key: fx.pubkey_hash == test_pubkey_hash(&env),
    });
    (env, c, relayer, fx)
}

fn zk_register(
    c: &HumanityClient,
    fx: &Fixture,
    campaign_id: u64,
    wallet: &Address,
) -> Result<(), Result<Error, soroban_sdk::InvokeError>> {
    match c.try_register_zk(
        &campaign_id,
        wallet,
        &fx.proof,
        &fx.nullifier,
        &fx.timestamp,
        &fx.age,
        &fx.gender,
        &fx.pin,
        &fx.state,
    ) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => panic!("conversion error {e:?}"),
        Err(Ok(e)) => Err(Ok(e)),
        Err(Err(e)) => Err(Err(e)),
    }
}

fn nullifier_bytes(fx: &Fixture) -> BytesN<32> {
    fx.nullifier.to_be_bytes().try_into().unwrap()
}

#[test]
fn zk_register_ok_and_cost() {
    let (env, c, _r, fx) = zk_env();
    assert!(!c.is_verified(&fx.campaign_id, &fx.wallet));

    env.cost_estimate().budget().reset_default();
    zk_register(&c, &fx, fx.campaign_id, &fx.wallet).unwrap();
    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let mem = env.cost_estimate().budget().memory_bytes_cost();
    std::println!("register_zk: cpu_insns={cpu} mem_bytes={mem}");
    assert!(cpu < 60_000_000, "register_zk cpu {cpu}");

    // wallet authorized the call; ("humanzk", campaign_id) -> [wallet, nullifier_bytes]
    assert_eq!(env.auths()[0].0, fx.wallet);
    let expected = HumanZkEvent {
        campaign_id: fx.campaign_id,
        wallet: fx.wallet.clone(),
        nullifier: nullifier_bytes(&fx),
    };
    assert_eq!(
        env.events().all().filter_by_contract(&c.address),
        [soroban_sdk::Event::to_xdr(&expected, &env, &c.address)]
    );

    assert!(c.is_verified(&fx.campaign_id, &fx.wallet));
    assert!(!c.is_verified(&(fx.campaign_id + 1), &fx.wallet));
}

#[test]
fn zk_same_proof_twice_nullifier_used() {
    let (_env, c, _r, fx) = zk_env();
    zk_register(&c, &fx, fx.campaign_id, &fx.wallet).unwrap();
    // replay: the nullifier is taken first
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::NullifierUsed))
    );
    // after revoke the identity still cannot come back (nullifier stays used)
    c.revoke(&fx.campaign_id, &fx.wallet);
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::NullifierUsed))
    );
    assert!(!c.is_verified(&fx.campaign_id, &fx.wallet));
}

#[test]
fn zk_same_identity_second_wallet_nullifier_used() {
    // Identity already bound to another wallet (via the relayer path) in this campaign: a
    // valid proof for a new wallet with the same nullifier is refused.
    let (env, c, _r, fx) = zk_env();
    let first_wallet = Address::generate(&env);
    c.register(&fx.campaign_id, &nullifier_bytes(&fx), &first_wallet);
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::NullifierUsed))
    );
    assert!(!c.is_verified(&fx.campaign_id, &fx.wallet));
    assert!(c.is_verified(&fx.campaign_id, &first_wallet));
}

#[test]
fn zk_relayer_nullifier_then_zk_nullifier_used() {
    let (_env, c, _r, fx) = zk_env();
    // the relayer registered the same nullifier bytes for the same wallet first
    c.register(&fx.campaign_id, &nullifier_bytes(&fx), &fx.wallet);
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::NullifierUsed))
    );
}

#[test]
fn zk_then_relayer_same_nullifier_rejected() {
    let (env, c, _r, fx) = zk_env();
    zk_register(&c, &fx, fx.campaign_id, &fx.wallet).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        c.try_register(&fx.campaign_id, &nullifier_bytes(&fx), &other),
        Err(Ok(Error::NullifierUsed))
    );
}

#[test]
fn zk_wallet_already_registered() {
    let (env, c, _r, fx) = zk_env();
    // wallet already registered via the relayer with a different nullifier
    c.register(
        &fx.campaign_id,
        &BytesN::from_array(&env, &[0xAB; 32]),
        &fx.wallet,
    );
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::WalletRegistered))
    );
}

#[test]
fn zk_stale_proof() {
    let (env, c, _r, fx) = zk_env();
    env.ledger().set_timestamp(fx.timestamp + MAX_AGE + 1);
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::StaleProof))
    );
    env.ledger().set_timestamp(fx.timestamp - 3601);
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::StaleProof))
    );
    env.ledger().set_timestamp(fx.timestamp + MAX_AGE);
    zk_register(&c, &fx, fx.campaign_id, &fx.wallet).unwrap();
}

#[test]
fn zk_wrong_campaign_invalid() {
    let (_env, c, _r, fx) = zk_env();
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id + 1, &fx.wallet),
        Err(Ok(Error::InvalidProof))
    );
    assert!(!c.is_verified(&(fx.campaign_id + 1), &fx.wallet));
}

#[test]
fn zk_wrong_wallet_invalid() {
    let (env, c, _r, fx) = zk_env();
    let other = Address::from_str(
        &env,
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
    );
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &other),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn zk_tampered_outputs_invalid() {
    let (env, c, _r, fx) = zk_env();
    let one = U256::from_u32(&env, 1);
    let r = groth16::fr_modulus(&env);
    let call = |n: &U256, ts: u64, age: &U256| {
        c.try_register_zk(
            &fx.campaign_id,
            &fx.wallet,
            &fx.proof,
            n,
            &ts,
            age,
            &fx.gender,
            &fx.pin,
            &fx.state,
        )
    };
    assert_eq!(
        call(&fx.nullifier.add(&one), fx.timestamp, &fx.age),
        Err(Ok(Error::InvalidProof))
    );
    assert_eq!(
        call(&fx.nullifier.add(&r), fx.timestamp, &fx.age),
        Err(Ok(Error::InputNotInField))
    );
    assert_eq!(
        call(&fx.nullifier, fx.timestamp - 1, &fx.age),
        Err(Ok(Error::InvalidProof))
    );
    let flipped_age = if fx.age == one {
        U256::from_u32(&env, 0)
    } else {
        one.clone()
    };
    assert_eq!(
        call(&fx.nullifier, fx.timestamp, &flipped_age),
        Err(Ok(Error::InvalidProof))
    );
    assert!(!c.is_verified(&fx.campaign_id, &fx.wallet));
}

#[test]
fn zk_production_key_rejects_test_proof() {
    let (env, c, _r, fx) = zk_env();
    if fx.pubkey_hash != test_pubkey_hash(&env) {
        return;
    }
    c.set_aadhaar_config(&AadhaarConfig {
        pubkey_hash: prod_pubkey_hash(&env),
        max_age: MAX_AGE,
        test_key: false,
    });
    assert_eq!(
        zk_register(&c, &fx, fx.campaign_id, &fx.wallet),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn zk_two_identities_same_campaign() {
    let (env, c, _r, alice) = zk_env();
    let bob = fixture(&env, BOB);
    assert_eq!(bob.campaign_id, alice.campaign_id);
    assert_ne!(bob.nullifier, alice.nullifier);
    zk_register(&c, &alice, alice.campaign_id, &alice.wallet).unwrap();
    zk_register(&c, &bob, bob.campaign_id, &bob.wallet).unwrap();
    assert!(c.is_verified(&alice.campaign_id, &alice.wallet));
    assert!(c.is_verified(&bob.campaign_id, &bob.wallet));
    // proofs are not transferable between wallets
    assert_eq!(
        zk_register(&c, &bob, bob.campaign_id, &alice.wallet),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn fixture_vkey_matches_embedded_vk() {
    let path = std::format!("{FIXTURE_DIR}/vkey.json");
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(v["nPublic"].as_u64().unwrap() as usize, groth16::N_PUBLIC);
    let fq = |x: &serde_json::Value| dec_bytes(x.as_str().unwrap());
    let g1 = |p: &serde_json::Value| {
        let mut out = [0u8; 64];
        out[..32].copy_from_slice(&fq(&p[0]));
        out[32..].copy_from_slice(&fq(&p[1]));
        out
    };
    let g2 = |p: &serde_json::Value| {
        let mut out = [0u8; 128];
        out[..32].copy_from_slice(&fq(&p[0][1]));
        out[32..64].copy_from_slice(&fq(&p[0][0]));
        out[64..96].copy_from_slice(&fq(&p[1][1]));
        out[96..].copy_from_slice(&fq(&p[1][0]));
        out
    };
    assert_eq!(g1(&v["vk_alpha_1"]), vk::VK_ALPHA_G1);
    assert_eq!(g2(&v["vk_beta_2"]), vk::VK_BETA_G2);
    assert_eq!(g2(&v["vk_gamma_2"]), vk::VK_GAMMA_G2);
    assert_eq!(g2(&v["vk_delta_2"]), vk::VK_DELTA_G2);
    let ic = v["IC"].as_array().unwrap();
    assert_eq!(ic.len(), vk::VK_IC.len());
    for (i, p) in ic.iter().enumerate() {
        assert_eq!(g1(p), vk::VK_IC[i], "IC[{i}]");
    }
}

#[test]
fn zk_same_identity_second_wallet_real_proof() {
    let (env, c, _r, alice) = zk_env();
    let sybil = fixture(&env, ALICE_SYBIL);
    assert_eq!(sybil.nullifier, alice.nullifier);
    assert_ne!(sybil.wallet, alice.wallet);
    zk_register(&c, &alice, alice.campaign_id, &alice.wallet).unwrap();
    // a valid proof from the same person for a second wallet is refused
    assert_eq!(
        zk_register(&c, &sybil, sybil.campaign_id, &sybil.wallet),
        Err(Ok(Error::NullifierUsed))
    );
    assert!(!c.is_verified(&sybil.campaign_id, &sybil.wallet));
    // and the proof cannot be replayed into another campaign (seed is campaign-bound)
    assert_eq!(
        zk_register(&c, &sybil, sybil.campaign_id + 1, &sybil.wallet),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn zk_sybil_proof_valid_alone_then_wallet_registered() {
    let (env, c, _r, _alice) = zk_env();
    let sybil = fixture(&env, ALICE_SYBIL);
    let bob = fixture(&env, BOB);
    assert_eq!(sybil.wallet, bob.wallet);
    // Bob's wallet is registered with Bob's identity; Alice's proof for that wallet is refused
    zk_register(&c, &bob, bob.campaign_id, &bob.wallet).unwrap();
    assert_eq!(
        zk_register(&c, &sybil, sybil.campaign_id, &sybil.wallet),
        Err(Ok(Error::WalletRegistered))
    );
    // in a fresh contract the sybil proof alone is valid
    let (env2, c2, _r2, _a2) = zk_env();
    zk_register(
        &c2,
        &fixture(&env2, ALICE_SYBIL),
        sybil.campaign_id,
        &sybil.wallet,
    )
    .unwrap();
    assert!(c2.is_verified(&sybil.campaign_id, &sybil.wallet));
}
