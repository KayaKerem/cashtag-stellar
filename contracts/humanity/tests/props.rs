//! Property tests for the humanity registry: nullifier / wallet uniqueness against a model,
//! authorization of privileged calls, and malformed Groth16 proofs / public inputs.
//!
//! Case counts are moderate (pairings are expensive); raise locally with `PROPTEST_CASES=<n>`.

use std::collections::{BTreeMap, BTreeSet};

use humanity::{AadhaarConfig, Error, Groth16Proof, Humanity, HumanityClient};
use proptest::prelude::*;
use proptest::test_runner::Config;
use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, Bytes, BytesN, Env, IntoVal, InvokeError, U256};

fn cfg(cases: u32) -> Config {
    Config {
        cases: std::env::var("PROPTEST_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(cases),
        failure_persistence: None,
        ..Config::default()
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Out {
    Ok,
    Err(Error),
    Trap,
}

fn out<C: core::fmt::Debug>(r: Result<Result<(), C>, Result<Error, InvokeError>>) -> Out {
    match r {
        Ok(Ok(())) => Out::Ok,
        Ok(Err(e)) => panic!("conversion error {e:?}"),
        Err(Ok(e)) => Out::Err(e),
        Err(Err(_)) => Out::Trap,
    }
}

struct S {
    env: Env,
    c: HumanityClient<'static>,
    admin: Address,
    relayer: Address,
}

fn setup() -> S {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let id = env.register(Humanity, (admin.clone(), relayer.clone()));
    let c = HumanityClient::new(&env, &id);
    S { env, c, admin, relayer }
}

// =============================================================================================
// 1. Nullifier / wallet registry vs. model
// =============================================================================================

#[derive(Clone, Debug)]
enum Op {
    Register { campaign: u64, nullifier: u8, wallet: usize },
    Revoke { campaign: u64, wallet: usize },
}

fn op() -> impl Strategy<Value = Op> {
    let campaign = prop_oneof![0u64..=2, Just(u64::MAX)];
    prop_oneof![
        4 => (campaign.clone(), 0u8..=4, 0usize..4)
            .prop_map(|(campaign, nullifier, wallet)| Op::Register { campaign, nullifier, wallet }),
        1 => (campaign, 0usize..4).prop_map(|(campaign, wallet)| Op::Revoke { campaign, wallet }),
    ]
}

proptest! {
    #![proptest_config(cfg(64))]

    /// Random register / revoke sequences: a nullifier is accepted at most once per campaign
    /// (forever, even after revoke), a wallet holds at most one live registration per campaign,
    /// and `is_verified` always matches the model.
    #[test]
    fn prop_registry_matches_model(ops in proptest::collection::vec(op(), 1..30)) {
        let s = setup();
        s.env.mock_all_auths();
        let wallets: std::vec::Vec<Address> = (0..4).map(|_| Address::generate(&s.env)).collect();
        let mut used: BTreeSet<(u64, u8)> = BTreeSet::new();
        let mut live: BTreeMap<(u64, usize), u8> = BTreeMap::new();
        for o in ops.iter() {
            match *o {
                Op::Register { campaign, nullifier, wallet } => {
                    let n = BytesN::from_array(&s.env, &[nullifier; 32]);
                    let got = out(s.c.try_register(&campaign, &n, &wallets[wallet]));
                    let want = if used.contains(&(campaign, nullifier)) {
                        Out::Err(Error::NullifierUsed)
                    } else if live.contains_key(&(campaign, wallet)) {
                        Out::Err(Error::WalletRegistered)
                    } else {
                        used.insert((campaign, nullifier));
                        live.insert((campaign, wallet), nullifier);
                        Out::Ok
                    };
                    prop_assert_eq!(got, want, "{:?}", o);
                }
                Op::Revoke { campaign, wallet } => {
                    s.c.revoke(&campaign, &wallets[wallet]);
                    live.remove(&(campaign, wallet));
                }
            }
            for campaign in [0u64, 1, 2, u64::MAX] {
                for (w, a) in wallets.iter().enumerate() {
                    prop_assert_eq!(s.c.is_verified(&campaign, a), live.contains_key(&(campaign, w)));
                }
            }
        }
    }
}

// =============================================================================================
// 2. Authorization
// =============================================================================================

proptest! {
    #![proptest_config(cfg(32))]

    /// Only the relayer can `register`; only the admin can `set_relayer`, `revoke` and
    /// `set_aadhaar_config`. Any other signer gets a host auth error and changes nothing.
    #[test]
    fn prop_privileged_calls_need_rightful_auth(f in 0usize..4, attacker in 0usize..4) {
        let s = setup();
        let env = &s.env;
        let wallet = Address::generate(env);
        let stranger = Address::generate(env);
        let n = BytesN::from_array(env, &[9u8; 32]);
        // pre-state for revoke
        s.env.mock_all_auths();
        s.c.register(&1, &BytesN::from_array(env, &[1u8; 32]), &wallet);
        let cfg = AadhaarConfig { pubkey_hash: U256::from_u32(env, 1), max_age: 1, test_key: true };
        let who = [s.admin.clone(), s.relayer.clone(), wallet.clone(), stranger.clone()][attacker].clone();
        let (name, args, rightful) = match f {
            0 => ("register", (2u64, n.clone(), wallet.clone()).into_val(env), s.relayer.clone()),
            1 => ("set_relayer", (stranger.clone(),).into_val(env), s.admin.clone()),
            2 => ("revoke", (1u64, wallet.clone()).into_val(env), s.admin.clone()),
            _ => ("set_aadhaar_config", (cfg.clone(),).into_val(env), s.admin.clone()),
        };
        prop_assume!(who != rightful);
        let auths = [MockAuth {
            address: &who,
            invoke: &MockAuthInvoke { contract: &s.c.address, fn_name: name, args, sub_invokes: &[] },
        }];
        let c = s.c.mock_auths(&auths);
        let failed = match f {
            0 => c.try_register(&2, &n, &wallet).is_err(),
            1 => c.try_set_relayer(&stranger).is_err(),
            2 => c.try_revoke(&1, &wallet).is_err(),
            _ => c.try_set_aadhaar_config(&cfg).is_err(),
        };
        prop_assert!(failed, "{} accepted signer #{}", name, attacker);
        prop_assert!(!s.c.is_verified(&2, &wallet));
        prop_assert!(s.c.is_verified(&1, &wallet));
        prop_assert!(s.c.aadhaar_config().is_none());
        // relayer unchanged: the original relayer can still register
        s.env.mock_all_auths();
        s.c.register(&3, &n, &wallet);
        prop_assert_eq!(s.env.auths()[0].0.clone(), s.relayer.clone());
    }
}

// =============================================================================================
// 3. Groth16: mutated proofs / public inputs and replay
// =============================================================================================

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/aadhaar/alice_clipper1_c1"
);
const MAX_AGE: u64 = 3 * 24 * 3600;

fn hex<const N: usize>(h: &str) -> [u8; N] {
    let h = h.trim_start_matches("0x");
    assert_eq!(h.len(), 2 * N);
    core::array::from_fn(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap())
}

fn dec(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for ch in s.bytes() {
        let mut carry = (ch - b'0') as u32;
        for b in out.iter_mut().rev() {
            let v = (*b as u32) * 10 + carry;
            *b = v as u8;
            carry = v >> 8;
        }
    }
    out
}

#[derive(Clone)]
struct Fx {
    a: [u8; 64],
    b: [u8; 128],
    c: [u8; 64],
    signals: std::vec::Vec<[u8; 32]>,
    campaign: u64,
    wallet: std::string::String,
}

fn load() -> Fx {
    let read = |f: &str| -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURE}/{f}")).unwrap()).unwrap()
    };
    let p = read("proof_soroban.json");
    let m = read("meta.json");
    Fx {
        a: hex(p["a"].as_str().unwrap()),
        b: hex(p["b"].as_str().unwrap()),
        c: hex(p["c"].as_str().unwrap()),
        signals: p["public_signals"].as_array().unwrap().iter().map(|v| dec(v.as_str().unwrap())).collect(),
        campaign: m["campaign_id"].as_u64().unwrap(),
        wallet: m["wallet"].as_str().unwrap().to_string(),
    }
}

fn u256(env: &Env, b: &[u8; 32]) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, b))
}

fn ts_of(fx: &Fx) -> u64 {
    u64::from_be_bytes(fx.signals[2][24..].try_into().unwrap())
}

struct Zk {
    s: S,
    fx: Fx,
    wallet: Address,
}

fn zk() -> Zk {
    let s = setup();
    let fx = load();
    s.env.ledger().set_timestamp(ts_of(&fx) + 60);
    s.env.mock_all_auths();
    s.c.set_aadhaar_config(&AadhaarConfig {
        pubkey_hash: u256(&s.env, &fx.signals[0]),
        max_age: MAX_AGE,
        test_key: true,
    });
    let wallet = Address::from_str(&s.env, &fx.wallet);
    Zk { s, fx, wallet }
}

impl Zk {
    fn call(&self, campaign: u64, wallet: &Address, a: &[u8; 64], b: &[u8; 128], c: &[u8; 64], sig: &[[u8; 32]], ts: u64) -> Out {
        let env = &self.s.env;
        let proof = Groth16Proof {
            a: BytesN::from_array(env, a),
            b: BytesN::from_array(env, b),
            c: BytesN::from_array(env, c),
        };
        out(self.s.c.try_register_zk(
            &campaign,
            wallet,
            &proof,
            &u256(env, &sig[1]),
            &ts,
            &u256(env, &sig[3]),
            &u256(env, &sig[4]),
            &u256(env, &sig[5]),
            &u256(env, &sig[6]),
        ))
    }
    fn honest(&self) -> Out {
        let f = &self.fx;
        self.call(f.campaign, &self.wallet, &f.a, &f.b, &f.c, &f.signals, ts_of(f))
    }
}

#[test]
fn fixture_registers() {
    let z = zk();
    assert_eq!(z.honest(), Out::Ok);
    assert!(z.s.c.is_verified(&z.fx.campaign, &z.wallet));
}

#[derive(Clone, Debug)]
enum PMut {
    /// xor one byte of A / B / C
    Byte(u8, usize, u8),
    /// replace a point with arbitrary bytes
    Random(u8, std::vec::Vec<u8>),
    /// identity (all-zero) point
    Zero(u8),
}

fn pmut() -> impl Strategy<Value = PMut> {
    prop_oneof![
        (0u8..3, any::<usize>(), 1u8..=255).prop_map(|(w, i, x)| PMut::Byte(w, i, x)),
        (0u8..3, proptest::collection::vec(any::<u8>(), 128)).prop_map(|(w, v)| PMut::Random(w, v)),
        (0u8..3).prop_map(PMut::Zero),
    ]
}

fn mutate(fx: &Fx, m: &PMut) -> ([u8; 64], [u8; 128], [u8; 64]) {
    let (mut a, mut b, mut c) = (fx.a, fx.b, fx.c);
    let pick = |w: u8, a: &mut [u8; 64], b: &mut [u8; 128], c: &mut [u8; 64], f: &mut dyn FnMut(&mut [u8])| match w {
        0 => f(a),
        1 => f(b),
        _ => f(c),
    };
    match m {
        PMut::Byte(w, i, x) => pick(*w, &mut a, &mut b, &mut c, &mut |s: &mut [u8]| {
            let k = i % s.len();
            s[k] ^= x
        }),
        PMut::Random(w, v) => pick(*w, &mut a, &mut b, &mut c, &mut |s: &mut [u8]| {
            let n = s.len();
            s.copy_from_slice(&v[..n])
        }),
        PMut::Zero(w) => pick(*w, &mut a, &mut b, &mut c, &mut |s: &mut [u8]| s.fill(0)),
    }
    (a, b, c)
}

proptest! {
    #![proptest_config(cfg(24))]

    /// A mutated proof is never accepted and never registers anything. (Whether the rejection is
    /// a clean `InvalidProof` or a host trap is checked separately below.)
    #[test]
    fn prop_mutated_proof_never_accepted(m in pmut()) {
        let z = zk();
        let (a, b, c) = mutate(&z.fx, &m);
        prop_assume!((a, b, c) != (z.fx.a, z.fx.b, z.fx.c));
        let r = z.call(z.fx.campaign, &z.wallet, &a, &b, &c, &z.fx.signals, ts_of(&z.fx));
        prop_assert_ne!(&r, &Out::Ok, "mutated proof accepted: {:?}", m);
        prop_assert!(!z.s.c.is_verified(&z.fx.campaign, &z.wallet));
        // the honest proof still works afterwards (no nullifier burned by the failed attempt)
        prop_assert_eq!(z.honest(), Out::Ok);
    }

    /// Random public outputs (nullifier / revealed fields / timestamp): a clean contract error
    /// (InvalidProof, InputNotInField or StaleProof), never accepted, never a trap.
    #[test]
    fn prop_mutated_public_inputs_rejected(
        idx in prop_oneof![Just(1usize), Just(2usize), 3usize..=6],
        val in any::<[u8; 32]>(),
        small in any::<u64>(),
        use_small in any::<bool>(),
    ) {
        let z = zk();
        let mut sig = z.fx.signals.clone();
        let mut ts = ts_of(&z.fx);
        let mut v = val;
        if use_small || idx == 2 {
            v = [0u8; 32];
            v[24..].copy_from_slice(&small.to_be_bytes());
        }
        prop_assume!(v != sig[idx]);
        if idx == 2 { ts = small } else { sig[idx] = v }
        let r = z.call(z.fx.campaign, &z.wallet, &z.fx.a, &z.fx.b, &z.fx.c, &sig, ts);
        prop_assert!(
            matches!(r, Out::Err(Error::InvalidProof) | Out::Err(Error::InputNotInField) | Out::Err(Error::StaleProof)),
            "{:?}", r
        );
        prop_assert!(!z.s.c.is_verified(&z.fx.campaign, &z.wallet));
    }

    /// Replay: once registered, the same proof is rejected for the same wallet (any campaign it
    /// is bound to) and cannot be moved to another campaign or wallet.
    #[test]
    fn prop_zk_replay_rejected(other_campaign in any::<u64>()) {
        let z = zk();
        prop_assert_eq!(z.honest(), Out::Ok);
        prop_assert_eq!(z.honest(), Out::Err(Error::NullifierUsed));
        let f = &z.fx;
        if other_campaign != f.campaign {
            let r = z.call(other_campaign, &z.wallet, &f.a, &f.b, &f.c, &f.signals, ts_of(f));
            prop_assert_eq!(r, Out::Err(Error::InvalidProof));
            prop_assert!(!z.s.c.is_verified(&other_campaign, &z.wallet));
        }
        let w2 = Address::generate(&z.s.env);
        // Address::generate yields a contract address: rejected before the pairing
        let r = z.call(f.campaign, &w2, &f.a, &f.b, &f.c, &f.signals, ts_of(f));
        prop_assert_eq!(r, Out::Err(Error::NotAnAccount));
    }
}

/// Points that are not on the curve (or not in the G2 subgroup) make the BN254 host functions
/// trap instead of `register_zk` returning `InvalidProof`. Nothing is registered either way, so
/// this is an error-reporting issue, not a soundness one.
#[test]
#[ignore = "KNOWN (info): BN254 host fns trap on malformed points; tx fails, nothing registered, nullifier not consumed"]
fn malformed_points_are_clean_errors() {
    let z = zk();
    let mut traps = std::vec::Vec::new();
    for (k, m) in [
        PMut::Byte(0, 63, 1),
        PMut::Byte(1, 127, 1),
        PMut::Byte(2, 63, 1),
        PMut::Random(0, std::vec![0xff; 128]),
        PMut::Random(1, std::vec![0xff; 128]),
    ]
    .iter()
    .enumerate()
    {
        let (a, b, c) = mutate(&z.fx, m);
        let r = z.call(z.fx.campaign, &z.wallet, &a, &b, &c, &z.fx.signals, ts_of(&z.fx));
        assert_ne!(r, Out::Ok);
        if r == Out::Trap {
            traps.push(k);
        }
    }
    assert!(traps.is_empty(), "host trap for mutations {traps:?}");
}
