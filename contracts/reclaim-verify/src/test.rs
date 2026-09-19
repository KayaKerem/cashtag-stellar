extern crate std;

use super::testutils::{attestor_address, sign_proof};
use super::*;
use crate::test_vectors::*;
use soroban_sdk::{contract, contractimpl, vec};
use std::{format, string::String};

fn unhex<const N: usize>(s: &str) -> [u8; N] {
    let s = s.trim_start_matches("0x");
    assert_eq!(s.len(), 2 * N);
    core::array::from_fn(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
}

fn b(env: &Env, s: &str) -> Bytes {
    Bytes::from_slice(env, s.as_bytes())
}

const OTHER_SECRET: [u8; 32] = [7u8; 32];

struct Ctx {
    env: Env,
    secret: [u8; 32],
    attestors: Vec<BytesN<20>>,
    owners: Vec<Bytes>,
    url: Bytes,
    required: Vec<Bytes>,
    code: Bytes,
}

impl Ctx {
    fn new() -> Self {
        let env = Env::default();
        let secret = unhex::<32>(REF_ATTESTOR_SECRET);
        Ctx {
            attestors: vec![&env, attestor_address(&env, &OTHER_SECRET), attestor_address(&env, &secret)],
            owners: vec![&env, b(&env, REF_OWNER)],
            url: b(&env, REF_URL),
            required: vec![&env, b(&env, REQ_VIEWS), b(&env, REQ_DESC)],
            code: b(&env, CODE),
            secret,
            env,
        }
    }
    fn proof(&self, params: &str, context: &str) -> ReclaimProof {
        sign_proof(&self.env, &self.secret, params, context, REF_OWNER, REF_TIMESTAMP_S, REF_EPOCH)
    }
    fn run(&self, p: &ReclaimProof) -> Result<Checked, VerifyError> {
        verify(&self.env, p, &self.attestors, &self.owners, &self.url, &self.required, &self.code)
    }
    /// Signs a context whose extractedParameters are `inner` (already canonical JSON members).
    fn run_extracted(&self, inner: &str) -> Result<Checked, VerifyError> {
        self.run(&self.proof(REF_PARAMETERS, &context_with(inner)))
    }
}

fn context_with(inner: &str) -> String {
    format!(r#"{{"contextAddress":"0x0","contextMessage":"cliprail:c1:e1","extractedParameters":{{{inner}}},"providerHash":"0x00"}}"#)
}

// ------------------------------------------------------------------ real data / format

#[test]
fn real_reclaim_vector_recovers_witness() {
    let env = Env::default();
    let addr = recover_address(
        &env,
        &BytesN::from_array(&env, &unhex(REAL_DIGEST)),
        &BytesN::from_array(&env, &unhex(REAL_SIGNATURE)),
        REAL_RECOVERY_ID,
    );
    assert_eq!(addr.to_array(), unhex::<20>(REAL_WITNESS));
}

#[test]
fn reference_vector_matches_attestor_core_bytes() {
    let t = Ctx::new();
    assert_eq!(attestor_address(&t.env, &t.secret).to_array(), unhex::<20>(REF_ATTESTOR_ADDRESS));

    // Digest recipe matches ethers' eip191Digest(createSignDataForClaim(claim)).
    let mut msg = [0u8; 256];
    let n = eip191_message(&unhex(REF_IDENTIFIER), REF_OWNER.as_bytes(), REF_TIMESTAMP_S, REF_EPOCH, &mut msg);
    use sha3::Digest;
    assert_eq!(<[u8; 32]>::from(sha3::Keccak256::digest(&msg[..n])), unhex::<32>(REF_DIGEST));

    // sign_proof reproduces the attestor's signature byte for byte (RFC 6979 on both sides).
    let p = t.proof(REF_PARAMETERS, REF_CONTEXT);
    let rsv = unhex::<65>(REF_SIGNATURE_RSV);
    assert_eq!(p.signature.to_array()[..], rsv[..64]);
    assert_eq!(p.recovery_id, rsv[64] as u32 - 27);

    // And the ethers signature itself verifies.
    let mut real = p.clone();
    real.signature = BytesN::from_array(&t.env, &rsv[..64].try_into().unwrap());
    let c = t.run(&real).unwrap();
    assert_eq!(c.identifier.to_array(), unhex::<32>(REF_IDENTIFIER));
    assert_eq!(c.views, 1234567);
}

#[test]
fn owner_is_lowercased_like_attestor_core() {
    let t = Ctx::new();
    let upper = "0x732456AF65A53384CF71A174865DD31414DF4C6B";
    let p = sign_proof(&t.env, &t.secret, REF_PARAMETERS, REF_CONTEXT, upper, REF_TIMESTAMP_S, REF_EPOCH);
    assert_eq!(p.owner, b(&t.env, REF_OWNER));
    assert!(t.run(&p).is_ok());
}

// ------------------------------------------------------------------ happy path + adversarial

#[test]
fn happy_path_youtube_shape() {
    let t = Ctx::new();
    // The desc contains fake `\"viewCount\":\"999\"` and `\"views\":\"888\"`: must not be picked up.
    let c = t.run(&t.proof(REF_PARAMETERS, REF_CONTEXT)).unwrap();
    assert_eq!(c.views, 1234567);
}

#[test]
fn fake_views_inside_desc_are_ignored_when_real_views_missing() {
    let t = Ctx::new();
    let r = t.run_extracted(r#""desc":"CR-7F3K9Q \"views\":\"999\" \\\"views\\\":\\\"999\\\"""#);
    assert_eq!(r, Err(VerifyError::ViewsParseError));
}

#[test]
fn escaped_quote_does_not_end_desc_early() {
    let t = Ctx::new();
    // Code sits after an escaped quote and an escaped backslash.
    let r = t.run_extracted(r#""desc":"a \\\" b \\\\ c CR-7F3K9Q","views":"5""#).unwrap();
    assert_eq!(r.views, 5);
}

#[test]
fn unicode_and_escapes_in_desc() {
    let t = Ctx::new();
    let r = t.run_extracted(r#""desc":"çğüşöı 日本語 🎉\\n\\t\\u00e9 CR-7F3K9Q ✓","views":"42""#).unwrap();
    assert_eq!(r.views, 42);
}

#[test]
fn code_at_desc_boundaries() {
    let t = Ctx::new();
    assert!(t.run_extracted(r#""desc":"CR-7F3K9Q","views":"1""#).is_ok());
    assert!(t.run_extracted(r#""desc":"CR-7F3K9Q tail","views":"1""#).is_ok());
    assert!(t.run_extracted(r#""desc":"head CR-7F3K9Q","views":"1""#).is_ok());
    // Truncated code and code split across the closing quote do not count.
    assert_eq!(t.run_extracted(r#""desc":"head CR-7F3K9","views":"1""#), Err(VerifyError::CodeNotFound));
    assert_eq!(t.run_extracted(r#""desc":"x","views":"CR-7F3K9Q""#), Err(VerifyError::ViewsParseError));
}

#[test]
fn code_outside_desc_does_not_count() {
    let t = Ctx::new();
    // Code only in another extracted param and in contextMessage.
    let ctx = r#"{"contextAddress":"0x0","contextMessage":"CR-7F3K9Q","extractedParameters":{"desc":"nothing here","title":"CR-7F3K9Q","views":"1"},"providerHash":"0x00"}"#;
    assert_eq!(t.run(&t.proof(REF_PARAMETERS, ctx)), Err(VerifyError::CodeNotFound));
}

#[test]
fn views_edge_values() {
    let t = Ctx::new();
    assert_eq!(t.run_extracted(r#""desc":"CR-7F3K9Q","views":"0""#).unwrap().views, 0);
    let max = format!(r#""desc":"CR-7F3K9Q","views":"{}""#, u64::MAX);
    assert_eq!(t.run_extracted(&max).unwrap().views, u64::MAX);
}

// ------------------------------------------------------------------ one test per error

#[test]
fn err_bad_signature() {
    let t = Ctx::new();
    let good = t.proof(REF_PARAMETERS, REF_CONTEXT);

    let mut p = good.clone();
    p.recovery_id = 2;
    assert_eq!(t.run(&p), Err(VerifyError::BadSignature));

    // High-s (malleated) signature: the host would trap, we reject first.
    let mut sig = good.signature.to_array();
    let n = N;
    let mut borrow = 0i16;
    for i in (32..64).rev() {
        let d = n[i - 32] as i16 - sig[i] as i16 - borrow;
        sig[i] = d.rem_euclid(256) as u8;
        borrow = (d < 0) as i16;
    }
    let mut p = good.clone();
    p.signature = BytesN::from_array(&t.env, &sig);
    p.recovery_id ^= 1;
    assert_eq!(t.run(&p), Err(VerifyError::BadSignature));

    let mut p = good.clone();
    p.signature = BytesN::from_array(&t.env, &[0u8; 64]);
    assert_eq!(t.run(&p), Err(VerifyError::BadSignature));

    let mut p = good;
    p.signature = BytesN::from_array(&t.env, &[0xffu8; 64]);
    assert_eq!(t.run(&p), Err(VerifyError::BadSignature));
}

#[test]
#[should_panic]
fn host_traps_on_high_s() {
    // Documents host behaviour: secp256k1_recover panics instead of returning an error.
    let env = Env::default();
    let mut sig = unhex::<64>(REAL_SIGNATURE);
    sig[32] = 0xff;
    recover_address(&env, &BytesN::from_array(&env, &unhex(REAL_DIGEST)), &BytesN::from_array(&env, &sig), 0);
}

#[test]
fn err_unknown_attestor() {
    let t = Ctx::new();
    let p = sign_proof(&t.env, &[9u8; 32], REF_PARAMETERS, REF_CONTEXT, REF_OWNER, REF_TIMESTAMP_S, REF_EPOCH);
    assert_eq!(t.run(&p), Err(VerifyError::UnknownAttestor));

    // Tampering with any signed field changes the recovered address.
    let good = t.proof(REF_PARAMETERS, REF_CONTEXT);
    let mut p = good.clone();
    p.context = b(&t.env, &REF_CONTEXT.replace("1234567", "9234567"));
    assert_eq!(t.run(&p), Err(VerifyError::UnknownAttestor));
    let mut p = good.clone();
    p.timestamp_s += 1;
    assert_eq!(t.run(&p), Err(VerifyError::UnknownAttestor));
    let mut p = good.clone();
    p.epoch = 2;
    assert_eq!(t.run(&p), Err(VerifyError::UnknownAttestor));
    let mut p = good;
    p.owner = b(&t.env, "0x0000000000000000000000000000000000000001");
    assert_eq!(t.run(&p), Err(VerifyError::UnknownAttestor));
}

#[test]
fn err_unknown_owner() {
    let t = Ctx::new();
    let p = sign_proof(
        &t.env, &t.secret, REF_PARAMETERS, REF_CONTEXT,
        "0x0000000000000000000000000000000000000001", REF_TIMESTAMP_S, REF_EPOCH,
    );
    assert_eq!(t.run(&p), Err(VerifyError::UnknownOwner));
}

#[test]
fn err_url_mismatch() {
    let t = Ctx::new();
    let other = REF_PARAMETERS.replace("id=dQw4w9WgXcQ", "id=AAAAAAAAAAA");
    assert_eq!(t.run(&t.proof(&other, REF_CONTEXT)), Err(VerifyError::UrlMismatch));
    // Expected URL must match up to the closing quote (no prefix / extra-query tricks).
    let longer = REF_PARAMETERS.replace("id=dQw4w9WgXcQ", "id=dQw4w9WgXcQ&id=evil");
    assert_eq!(t.run(&t.proof(&longer, REF_CONTEXT)), Err(VerifyError::UrlMismatch));
}

#[test]
fn err_match_mismatch() {
    let t = Ctx::new();
    // Prover swaps the desc regex for one that captures a field they control.
    let other = REF_PARAMETERS.replace(r#"\"description\""#, r#"\"title\""#);
    assert_eq!(t.run(&t.proof(&other, REF_CONTEXT)), Err(VerifyError::MatchMismatch));
}

#[test]
fn err_code_not_found() {
    let t = Ctx::new();
    assert_eq!(t.run_extracted(r#""desc":"no code","views":"1""#), Err(VerifyError::CodeNotFound));
    assert_eq!(t.run_extracted(r#""views":"1""#), Err(VerifyError::CodeNotFound));
    let mut t2 = Ctx::new();
    t2.code = Bytes::new(&t2.env);
    assert_eq!(t2.run(&t2.proof(REF_PARAMETERS, REF_CONTEXT)), Err(VerifyError::CodeNotFound));
}

#[test]
fn err_views_parse() {
    let t = Ctx::new();
    for inner in [
        r#""desc":"CR-7F3K9Q""#,
        r#""desc":"CR-7F3K9Q","views":"""#,
        r#""desc":"CR-7F3K9Q","views":"12a""#,
        r#""desc":"CR-7F3K9Q","views":"-1""#,
        r#""desc":"CR-7F3K9Q","views":" 1""#,
        r#""desc":"CR-7F3K9Q","views":"18446744073709551616""#,
        r#""desc":"CR-7F3K9Q","views":1"#,
    ] {
        assert_eq!(t.run_extracted(inner), Err(VerifyError::ViewsParseError), "{inner}");
    }
    let no_extracted = r#"{"contextAddress":"0x0","providerHash":"0x00"}"#;
    assert_eq!(t.run(&t.proof(REF_PARAMETERS, no_extracted)), Err(VerifyError::ViewsParseError));
}

#[test]
fn err_too_large() {
    let t = Ctx::new();
    let big = format!("{}{}", REF_PARAMETERS, " ".repeat(MAX_JSON));
    assert_eq!(t.run(&t.proof(&big, REF_CONTEXT)), Err(VerifyError::TooLarge));
    let big_ctx = format!("{}{}", REF_CONTEXT, " ".repeat(MAX_JSON));
    assert_eq!(t.run(&t.proof(REF_PARAMETERS, &big_ctx)), Err(VerifyError::TooLarge));
}

// ------------------------------------------------------------------ cost

#[contract]
struct Bench;

#[contractimpl]
impl Bench {
    pub fn check(
        env: Env,
        proof: ReclaimProof,
        attestors: Vec<BytesN<20>>,
        owners: Vec<Bytes>,
        url: Bytes,
        required: Vec<Bytes>,
        code: Bytes,
    ) -> u64 {
        verify(&env, &proof, &attestors, &owners, &url, &required, &code).unwrap().views
    }
}

#[test]
fn cost_of_one_verify() {
    let t = Ctx::new();
    // Pad desc so the context is ~6 KB, a realistic upper bound for a YouTube description.
    let pad = "lorem ipsum ".repeat(450);
    let ctx = context_with(&format!(r#""desc":"{pad} CR-7F3K9Q","views":"1234567""#));
    let p = t.proof(REF_PARAMETERS, &ctx);
    let id = t.env.register(Bench, ());
    let client = BenchClient::new(&t.env, &id);
    t.env.cost_estimate().budget().reset_default();
    assert_eq!(client.check(&p, &t.attestors, &t.owners, &t.url, &t.required, &t.code), 1234567);
    let cpu = t.env.cost_estimate().budget().cpu_instruction_cost();
    let mem = t.env.cost_estimate().budget().memory_bytes_cost();
    std::println!("verify(): context {} B -> host cpu {cpu} insns, mem {mem} B (native test: guest-side Rust scanning not metered)", ctx.len());
    assert!(cpu < 40_000_000);
}
