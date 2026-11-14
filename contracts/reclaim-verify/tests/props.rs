//! Property / fuzz-style tests for `reclaim_verify::verify`: random and mutated claims,
//! signatures, owners and attestors. `verify` runs inside a small wrapper contract so a host
//! trap shows up as `Err(Err(_))` instead of aborting the test.
//!
//! Case counts are moderate; raise them locally with `PROPTEST_CASES=<n>`.

use k256::ecdsa::SigningKey;
use proptest::prelude::*;
use proptest::test_runner::Config;
use reclaim_verify::{verify, ReclaimProof, VerifyError};
use sha3::{Digest, Keccak256};
use soroban_sdk::{contract, contracterror, contractimpl, vec, Bytes, BytesN, Env, Vec};

// ------------------------------------------------------------------ fixtures (reference vector)

const SECRET: [u8; 32] = [0x11; 32];
const OWNER: &str = "0x732456af65a53384cf71a174865dd31414df4c6b";
const TS: u64 = 1758240000;
const URL: &str = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=dQw4w9WgXcQ";
const PARAMS: &str = r#"{"body":"","method":"GET","responseMatches":[{"type":"regex","value":"\"viewCount\":\\s*\"(?<views>\\d+)\""},{"type":"regex","value":"\"description\":\\s*\"(?<desc>(?:[^\"\\\\]|\\\\.)*)\""}],"responseRedactions":[],"url":"https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=dQw4w9WgXcQ"}"#;
const CONTEXT: &str = r#"{"contextAddress":"0x0","contextMessage":"cliprail:c1:e1","extractedParameters":{"desc":"Official video. Join the campaign: CR-7F3K9Q\\nLinks: https://example.com/?a=1&b=2 \\\"quoted\\\" \\\\ backslash é 🎉 fake \\\"viewCount\\\":\\\"999\\\" and \\\"views\\\":\\\"888\\\"","views":"1234567"},"providerHash":"0xa058c1b0997d173fbd84aa29d828967239b4c699eba7f71faa16ad88d98c2321"}"#;
const REQ_VIEWS: &str = r#"{"type":"regex","value":"\"viewCount\":\\s*\"(?<views>\\d+)\""}"#;
const REQ_DESC: &str = r#"{"type":"regex","value":"\"description\":\\s*\"(?<desc>(?:[^\"\\\\]|\\\\.)*)\""}"#;
const CODE: &str = "CR-7F3K9Q";

/// secp256k1 n/2 and n, big-endian.
const HALF_N: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];
const N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

// ------------------------------------------------------------------ wrapper contract

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum E {
    BadSignature = 1,
    UnknownAttestor = 2,
    UnknownOwner = 3,
    UrlMismatch = 4,
    MatchMismatch = 5,
    CodeNotFound = 6,
    ViewsParseError = 7,
    TooLarge = 8,
}

impl From<VerifyError> for E {
    fn from(e: VerifyError) -> E {
        match e {
            VerifyError::BadSignature => E::BadSignature,
            VerifyError::UnknownAttestor => E::UnknownAttestor,
            VerifyError::UnknownOwner => E::UnknownOwner,
            VerifyError::UrlMismatch => E::UrlMismatch,
            VerifyError::MatchMismatch => E::MatchMismatch,
            VerifyError::CodeNotFound => E::CodeNotFound,
            VerifyError::ViewsParseError => E::ViewsParseError,
            VerifyError::TooLarge => E::TooLarge,
        }
    }
}

#[contract]
pub struct Harness;

#[contractimpl]
impl Harness {
    pub fn check(
        env: Env,
        proof: ReclaimProof,
        attestors: Vec<BytesN<20>>,
        owners: Vec<Bytes>,
        url: Bytes,
        required: Vec<Bytes>,
        code: Bytes,
    ) -> Result<(BytesN<32>, u64), E> {
        let c = verify(&env, &proof, &attestors, &owners, &url, &required, &code)?;
        Ok((c.identifier, c.views))
    }
}

/// Outcome of one verification: `Ok(views)`, a clean error, or a host trap.
#[derive(Clone, Debug, PartialEq)]
enum Out {
    Ok(u64),
    Err(E),
    Trap,
}

struct Ctx {
    env: Env,
    client: HarnessClient<'static>,
    attestors: Vec<BytesN<20>>,
    owners: Vec<Bytes>,
    url: Bytes,
    required: Vec<Bytes>,
    code: Bytes,
}

fn b(env: &Env, s: &[u8]) -> Bytes {
    Bytes::from_slice(env, s)
}

impl Ctx {
    fn new() -> Ctx {
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();
        let id = env.register(Harness, ());
        let client = HarnessClient::new(&env, &id);
        Ctx {
            attestors: vec![&env, BytesN::from_array(&env, &eth_address(&SECRET))],
            owners: vec![&env, b(&env, OWNER.as_bytes())],
            url: b(&env, URL.as_bytes()),
            required: vec![&env, b(&env, REQ_VIEWS.as_bytes()), b(&env, REQ_DESC.as_bytes())],
            code: b(&env, CODE.as_bytes()),
            client,
            env,
        }
    }
    fn run(&self, p: &ReclaimProof) -> Out {
        match self.client.try_check(p, &self.attestors, &self.owners, &self.url, &self.required, &self.code) {
            Ok(Ok((_, v))) => Out::Ok(v),
            Ok(Err(e)) => panic!("conversion error {e:?}"),
            Err(Ok(e)) => Out::Err(e),
            Err(Err(_)) => Out::Trap,
        }
    }
    fn signed(&self, params: &[u8], ctx: &[u8], owner: &[u8], ts: u64, epoch: u32) -> ReclaimProof {
        sign(&self.env, &SECRET, params, ctx, owner, ts, epoch)
    }
}

// ------------------------------------------------------------------ independent signer

fn eth_address(secret: &[u8; 32]) -> [u8; 20] {
    let sk = SigningKey::from_bytes(secret.into()).unwrap();
    let pt = sk.verifying_key().to_encoded_point(false);
    Keccak256::digest(&pt.as_bytes()[1..])[12..].try_into().unwrap()
}

/// Re-statement of the attestor signing recipe over raw bytes (any length / content).
fn sign(env: &Env, secret: &[u8; 32], params: &[u8], ctx: &[u8], owner: &[u8], ts: u64, epoch: u32) -> ReclaimProof {
    let mut h = Keccak256::new();
    h.update(b"http\n");
    h.update(params);
    h.update(b"\n");
    h.update(ctx);
    let id: [u8; 32] = h.finalize().into();
    let mut ser = std::vec::Vec::new();
    ser.extend_from_slice(b"0x");
    for x in id {
        ser.extend_from_slice(format!("{x:02x}").as_bytes());
    }
    ser.push(b'\n');
    ser.extend_from_slice(owner);
    ser.extend_from_slice(format!("\n{ts}\n{epoch}").as_bytes());
    let mut msg = format!("\x19Ethereum Signed Message:\n{}", ser.len()).into_bytes();
    msg.extend_from_slice(&ser);
    let digest = Keccak256::digest(&msg);
    let sk = SigningKey::from_bytes(secret.into()).unwrap();
    let (sig, rid) = sk.sign_prehash_recoverable(&digest).unwrap();
    ReclaimProof {
        parameters: Bytes::from_slice(env, params),
        context: Bytes::from_slice(env, ctx),
        owner: Bytes::from_slice(env, owner),
        timestamp_s: ts,
        epoch,
        signature: BytesN::from_array(env, &sig.to_bytes().into()),
        recovery_id: rid.to_byte() as u32,
    }
}

fn sig_in_range(sig: &[u8; 64]) -> bool {
    let (r, s) = sig.split_at(32);
    r != [0u8; 32] && r < &N[..] && s != [0u8; 32] && s <= &HALF_N[..]
}

fn cfg(cases: u32) -> Config {
    Config {
        cases: std::env::var("PROPTEST_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(cases),
        failure_persistence: None,
        ..Config::default()
    }
}

/// When `verify` accepts, the claim must mean what it was accepted for (checked with a real JSON
/// parser whenever the bytes are valid JSON): root `url` == expected, extracted `views` equals
/// the returned value and the extracted `desc` contains the code.
fn assert_sound(params: &[u8], ctx: &[u8], views: u64) -> Result<(), TestCaseError> {
    let (Ok(p), Ok(c)) = (
        serde_json::from_slice::<serde_json::Value>(params),
        serde_json::from_slice::<serde_json::Value>(ctx),
    ) else {
        return Ok(()); // lenient parse of non-JSON bytes; attestors only sign canonical JSON
    };
    prop_assert_eq!(p.get("url").and_then(|u| u.as_str()), Some(URL), "accepted url");
    let ext = c.get("extractedParameters");
    let v = ext.and_then(|e| e.get("views")).and_then(|v| v.as_str()).map(|s| s.parse::<u64>());
    prop_assert_eq!(v, Some(Ok(views)), "accepted views");
    let d = ext.and_then(|e| e.get("desc")).and_then(|v| v.as_str()).unwrap_or("");
    prop_assert!(d.contains(CODE), "accepted desc without code: {}", d);
    let rm = serde_json::to_string(p.get("responseMatches").unwrap_or(&serde_json::Value::Null)).unwrap();
    prop_assert!(rm.contains("viewCount") && rm.contains("description"), "accepted matches {}", rm);
    Ok(())
}

#[test]
fn harness_accepts_reference_shape() {
    let t = Ctx::new();
    let p = t.signed(PARAMS.as_bytes(), CONTEXT.as_bytes(), OWNER.as_bytes(), TS, 1);
    assert_eq!(t.run(&p), Out::Ok(1234567));
}

// ------------------------------------------------------------------ properties

#[derive(Clone, Debug)]
enum Edit {
    Flip(usize, u8),
    Insert(usize, u8),
    Delete(usize),
    Splice(usize, &'static str),
}

fn edit() -> impl Strategy<Value = Edit> {
    let tok = prop::sample::select(std::vec![
        "\"", "\\", "{", "}", "[", "]", ":", ",", "\"url\":\"x\",", "\"views\":\"1\",",
        "\"desc\":\"CR-7F3K9Q\",", "\"extractedParameters\":{},", "\\\"", "\"a\":{\"url\":\"",
        "\"responseMatches\":[],", "\u{0}", "é",
    ]);
    prop_oneof![
        (any::<usize>(), any::<u8>()).prop_map(|(i, x)| Edit::Flip(i, x)),
        (any::<usize>(), any::<u8>()).prop_map(|(i, x)| Edit::Insert(i, x)),
        any::<usize>().prop_map(Edit::Delete),
        (any::<usize>(), tok).prop_map(|(i, s)| Edit::Splice(i, s)),
    ]
}

fn apply(src: &[u8], edits: &[Edit]) -> std::vec::Vec<u8> {
    let mut v = src.to_vec();
    for e in edits {
        let n = v.len().max(1);
        match e {
            Edit::Flip(i, x) => {
                if !v.is_empty() {
                    v[i % n] ^= x;
                }
            }
            Edit::Insert(i, x) => v.insert(i % (v.len() + 1), *x),
            Edit::Delete(i) => {
                if !v.is_empty() {
                    v.remove(i % n);
                }
            }
            Edit::Splice(i, s) => {
                let at = i % (v.len() + 1);
                v.splice(at..at, s.bytes());
            }
        }
    }
    v
}

proptest! {
    #![proptest_config(cfg(256))]

    /// Correctly signed but structurally mutated claim JSON: `verify` never traps (all parsing is
    /// in guest code) and, when it accepts, the accepted claim is semantically right.
    #[test]
    fn prop_signed_mutated_claim_never_traps_and_is_sound(
        pe in proptest::collection::vec(edit(), 0..4),
        ce in proptest::collection::vec(edit(), 0..4),
    ) {
        let t = Ctx::new();
        let params = apply(PARAMS.as_bytes(), &pe);
        let ctx = apply(CONTEXT.as_bytes(), &ce);
        let out = t.run(&t.signed(&params, &ctx, OWNER.as_bytes(), TS, 1));
        prop_assert_ne!(&out, &Out::Trap, "trap on signed claim");
        if let Out::Ok(v) = out {
            assert_sound(&params, &ctx, v)?;
        }
    }

    /// Fully random (signed) parameters/context bytes: never a trap, never accepted.
    #[test]
    fn prop_signed_random_bytes_rejected(
        params in proptest::collection::vec(any::<u8>(), 0..300),
        ctx in proptest::collection::vec(any::<u8>(), 0..300),
    ) {
        let t = Ctx::new();
        let out = t.run(&t.signed(&params, &ctx, OWNER.as_bytes(), TS, 1));
        prop_assert!(matches!(out, Out::Err(_)), "{:?}", out);
    }

    /// Random signature / recovery id on a valid claim: never accepted. A host trap may only
    /// happen for an in-range (low-s) signature with recovery id 0/1 whose r is not a curve
    /// x-coordinate (documented in `verify`); every other malformed signature is a clean error.
    #[test]
    fn prop_random_signature_rejected(
        sig in proptest::collection::vec(any::<u8>(), 64),
        rid in prop_oneof![0u32..=1, 0u32..=3, Just(u32::MAX)],
        keep_r in any::<bool>(),
    ) {
        let t = Ctx::new();
        let mut p = t.signed(PARAMS.as_bytes(), CONTEXT.as_bytes(), OWNER.as_bytes(), TS, 1);
        let mut s: [u8; 64] = sig.try_into().unwrap();
        if keep_r {
            // valid r (a real x-coordinate) with a random s: exercises recovery, not the trap
            s[..32].copy_from_slice(&p.signature.to_array()[..32]);
            s[32] &= 0x7f;
        }
        p.signature = BytesN::from_array(&t.env, &s);
        p.recovery_id = rid;
        let out = t.run(&p);
        prop_assert!(!matches!(out, Out::Ok(_)), "random signature accepted");
        if out == Out::Trap {
            prop_assert!(rid <= 1 && sig_in_range(&s), "trap on a pre-checkable signature");
        }
    }

    /// A different attestor key, any owner / timestamp / epoch: rejected unless the attestor and
    /// owner are both allow-listed. Owners longer than 64 bytes → TooLarge, never a trap.
    #[test]
    fn prop_attestor_and_owner_allowlists(
        secret in prop_oneof![Just(SECRET), any::<[u8; 32]>()],
        owner in prop_oneof![Just(OWNER.as_bytes().to_vec()), proptest::collection::vec(any::<u8>(), 0..100)],
        ts in any::<u64>(),
        epoch in any::<u32>(),
    ) {
        prop_assume!(SigningKey::from_bytes((&secret).into()).is_ok());
        let t = Ctx::new();
        let p = sign(&t.env, &secret, PARAMS.as_bytes(), CONTEXT.as_bytes(), &owner, ts, epoch);
        let out = t.run(&p);
        if owner.len() > 64 {
            prop_assert_eq!(out, Out::Err(E::TooLarge));
        } else if secret != SECRET {
            prop_assert_eq!(out, Out::Err(E::UnknownAttestor));
        } else if owner != OWNER.as_bytes() {
            prop_assert_eq!(out, Out::Err(E::UnknownOwner));
        } else {
            prop_assert_eq!(out, Out::Ok(1234567));
        }
    }

    /// Any signed field changed after signing (timestamp, epoch, owner, claim bytes) changes the
    /// recovered signer: never accepted.
    #[test]
    fn prop_tamper_after_signing_rejected(which in 0u8..5, x in 1u8..=255, i in any::<usize>(), d in 1u64..=u64::MAX) {
        let t = Ctx::new();
        let mut p = t.signed(PARAMS.as_bytes(), CONTEXT.as_bytes(), OWNER.as_bytes(), TS, 1);
        let flip = |b: &Bytes| {
            let mut v: std::vec::Vec<u8> = b.iter().collect();
            let k = i % v.len();
            v[k] ^= x;
            Bytes::from_slice(&t.env, &v)
        };
        match which {
            0 => p.timestamp_s = p.timestamp_s.wrapping_add(d),
            1 => p.epoch = p.epoch.wrapping_add(d as u32 | 1),
            2 => p.owner = flip(&p.owner),
            3 => p.parameters = flip(&p.parameters),
            _ => p.context = flip(&p.context),
        }
        let out = t.run(&p);
        prop_assert!(matches!(out, Out::Err(_)), "{:?}", out);
    }

    /// views: any u64 decimal round-trips; anything else (overflow, sign, spaces, non-digits,
    /// non-string) is ViewsParseError.
    #[test]
    fn prop_views_parsing(
        v in any::<u64>(),
        junk in prop_oneof![
            Just(String::new()), Just("18446744073709551616".to_string()), Just("-1".to_string()),
            Just(" 1".to_string()), Just("1e3".to_string()), Just("0x10".to_string()),
            "[1-9][0-9]{20,29}", "[0-9]{0,5}[a-zA-Z .+-][0-9]{0,5}"
        ],
        quoted in any::<bool>(),
    ) {
        let t = Ctx::new();
        let ctx = |val: &str| format!(
            r#"{{"contextAddress":"0x0","contextMessage":"","extractedParameters":{{"desc":"{CODE}","views":{val}}},"providerHash":"0x00"}}"#
        );
        let good = ctx(&format!("\"{v}\""));
        prop_assert_eq!(t.run(&t.signed(PARAMS.as_bytes(), good.as_bytes(), OWNER.as_bytes(), TS, 1)), Out::Ok(v));
        let bad = if quoted { ctx(&format!("\"{junk}\"")) } else { ctx(&format!("{v}")) };
        prop_assert_eq!(t.run(&t.signed(PARAMS.as_bytes(), bad.as_bytes(), OWNER.as_bytes(), TS, 1)), Out::Err(E::ViewsParseError));
    }
}

/// `verify` pre-checks recovery id and the (r, s) ranges, but an in-range r that is not the
/// x-coordinate of a curve point still makes `secp256k1_recover` trap the host instead of
/// returning `BadSignature`. The transaction fails either way (no state change), but callers
/// (e.g. simulation / error reporting) see a host error rather than a contract error code.
#[test]
#[ignore = "KNOWN (info): secp256k1_recover traps on unrecoverable signatures; tx fails, nothing accepted"]
fn unrecoverable_in_range_signature_is_clean_error() {
    let t = Ctx::new();
    let base = t.signed(PARAMS.as_bytes(), CONTEXT.as_bytes(), OWNER.as_bytes(), TS, 1);
    let mut traps = std::vec::Vec::new();
    for r in 1u8..=16 {
        let mut s = [0u8; 64];
        s[31] = r;
        s[63] = 1;
        let mut p = base.clone();
        p.signature = BytesN::from_array(&t.env, &s);
        p.recovery_id = 0;
        let out = t.run(&p);
        assert!(!matches!(out, Out::Ok(_)));
        if out == Out::Trap {
            traps.push(r);
        }
    }
    assert!(traps.is_empty(), "host trap for r in {traps:?}");
}
