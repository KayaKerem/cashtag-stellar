#![no_std]
//! Verifies Reclaim Protocol (zkTLS / zkFetch) proofs inside a Soroban contract and extracts
//! the values we pay on. See docs/ARCHITECTURE.md §8.2, docs/DEVELOPMENT_PLAN.md §4.3 and
//! docs/reclaim-notes.md (exact byte formats, taken from attestor-core source).
//!
//! PUBLIC API IS FROZEN (used by `cliprail`): `ReclaimProof`, `VerifyError`, `Checked`, `verify`,
//! `recover_address`, and `testutils::{attestor_address, sign_proof}`.

use soroban_sdk::{contracttype, Bytes, BytesN, Env, Vec};

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_vectors;

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

/// Max size of `parameters` / `context`.
pub const MAX_JSON: usize = 8192;
/// Max size of `owner`, `expected_url`, each `required` entry and `code`.
pub const MAX_SMALL: usize = 1024;

/// secp256k1 group order n and n/2, big-endian.
const N: [u8; 32] = hex32(b"fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_N: [u8; 32] = hex32(b"7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

/// Full check: signature by an allowed attestor, allowed owner, URL == `expected_url`,
/// every `required` substring present in `parameters`, `views` parsed from context,
/// `code` present inside the extracted `desc`.
///
/// `expected_url` and each `required` entry must be given in the form they take *inside* the
/// canonical JSON (i.e. JSON-string-escaped: `"` → `\"`, `\` → `\\`; `/` and `&` are not escaped).
pub fn verify(
    env: &Env,
    proof: &ReclaimProof,
    attestors: &Vec<BytesN<20>>,
    owners: &Vec<Bytes>,
    expected_url: &Bytes,
    required: &Vec<Bytes>,
    code: &Bytes,
) -> Result<Checked, VerifyError> {
    use VerifyError::*;

    // Each Bytes is copied into guest memory exactly once; all scanning is plain Rust.
    let mut pbuf = [0u8; MAX_JSON];
    let mut cbuf = [0u8; MAX_JSON];
    let mut obuf = [0u8; 64];
    let params = copy(&proof.parameters, &mut pbuf)?;
    let ctx = copy(&proof.context, &mut cbuf)?;
    let owner = copy(&proof.owner, &mut obuf)?;

    // 1. identifier = keccak256("http\n" ‖ parameters ‖ "\n" ‖ context), hashed host-side.
    let mut pre = Bytes::from_slice(env, b"http\n");
    pre.append(&proof.parameters);
    pre.push_back(b'\n');
    pre.append(&proof.context);
    let identifier: BytesN<32> = env.crypto().keccak256(&pre).into();

    // 2. EIP-191 digest of "0x<id>\n<owner>\n<ts>\n<epoch>" and signer recovery.
    let mut msg = [0u8; 256];
    let n = eip191_message(&identifier.to_array(), owner, proof.timestamp_s, proof.epoch, &mut msg);
    let digest: BytesN<32> = env.crypto().keccak256(&Bytes::from_slice(env, &msg[..n])).into();
    // The host traps (not Err) on invalid input; reject everything we can detect cheaply first.
    // A well-formed but unrecoverable (r, s) (r not an x-coordinate) still traps the host.
    if proof.recovery_id > 1 || !sig_in_range(&proof.signature.to_array()) {
        return Err(BadSignature);
    }
    let signer = recover_address(env, &digest, &proof.signature, proof.recovery_id);
    if !attestors.contains(&signer) {
        return Err(UnknownAttestor);
    }
    if !owners.contains(&proof.owner) {
        return Err(UnknownOwner);
    }

    // 3. Request shape: exact URL and every expected responseMatch / redaction substring.
    let mut sbuf = [0u8; MAX_SMALL + 8];
    let url_len = expected_url.len() as usize;
    if url_len > MAX_SMALL {
        return Err(TooLarge);
    }
    sbuf[..7].copy_from_slice(b"\"url\":\"");
    expected_url.copy_into_slice(&mut sbuf[7..7 + url_len]);
    sbuf[7 + url_len] = b'"';
    if find(params, &sbuf[..8 + url_len]).is_none() {
        return Err(UrlMismatch);
    }
    for r in required.iter() {
        if find(params, copy(&r, &mut sbuf)?).is_none() {
            return Err(MatchMismatch);
        }
    }

    // 4. Extracted values from context.extractedParameters.
    let (views, desc) = extracted(ctx).ok_or(ViewsParseError)?;
    let views = parse_u64(views.ok_or(ViewsParseError)?).ok_or(ViewsParseError)?;
    let code = copy(code, &mut sbuf)?;
    let desc = desc.ok_or(CodeNotFound)?;
    if code.is_empty() || find(desc, code).is_none() {
        return Err(CodeNotFound);
    }

    Ok(Checked { identifier, views })
}

/// Recover the Ethereum-style address (last 20 bytes of keccak(pubkey)) that signed `digest`.
/// Traps (host error) on an invalid signature / recovery id; `verify` pre-validates to avoid that.
pub fn recover_address(env: &Env, digest: &BytesN<32>, sig: &BytesN<64>, rec_id: u32) -> BytesN<20> {
    let pk: BytesN<65> = env.crypto_hazmat().secp256k1_recover(digest, sig, rec_id);
    let pk_bytes: Bytes = pk.into();
    let h: BytesN<32> = env.crypto().keccak256(&pk_bytes.slice(1..65)).into();
    let hb: Bytes = h.into();
    hb.slice(12..32).try_into().unwrap()
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (no host calls).

fn copy<'a>(b: &Bytes, buf: &'a mut [u8]) -> Result<&'a [u8], VerifyError> {
    let n = b.len() as usize;
    if n > buf.len() {
        return Err(VerifyError::TooLarge);
    }
    b.copy_into_slice(&mut buf[..n]);
    Ok(&buf[..n])
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    let first = *needle.first()?;
    hay.windows(needle.len()).position(|w| w[0] == first && w == needle)
}

/// 1 ≤ r < n and 1 ≤ s ≤ n/2 (the host rejects high-s signatures by trapping).
fn sig_in_range(sig: &[u8; 64]) -> bool {
    let (r, s) = sig.split_at(32);
    let zero = [0u8; 32];
    r != zero && r < &N[..] && s != zero && s <= &HALF_N[..]
}

/// Writes `v` as ASCII decimal at the start of `out`; returns the length.
fn write_dec(out: &mut [u8], mut v: u64) -> usize {
    let mut tmp = [0u8; 20];
    let mut i = tmp.len();
    loop {
        i -= 1;
        tmp[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    let n = tmp.len() - i;
    out[..n].copy_from_slice(&tmp[i..]);
    n
}

/// Builds `"\x19Ethereum Signed Message:\n" ‖ len ‖ serialized` where
/// `serialized = "0x" ‖ hex(id) ‖ "\n" ‖ owner ‖ "\n" ‖ ts ‖ "\n" ‖ epoch` (attestor-core
/// `createSignDataForClaim` + ethers EIP-191). `owner` must be ≤ 64 bytes. Returns the length.
pub(crate) fn eip191_message(id: &[u8; 32], owner: &[u8], ts: u64, epoch: u32, out: &mut [u8; 256]) -> usize {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut ser = [0u8; 192];
    ser[..2].copy_from_slice(b"0x");
    for (i, b) in id.iter().enumerate() {
        ser[2 + 2 * i] = HEX[(b >> 4) as usize];
        ser[3 + 2 * i] = HEX[(b & 15) as usize];
    }
    let mut n = 66;
    ser[n] = b'\n';
    ser[n + 1..n + 1 + owner.len()].copy_from_slice(owner);
    n += 1 + owner.len();
    ser[n] = b'\n';
    n += 1 + write_dec(&mut ser[n + 1..], ts);
    ser[n] = b'\n';
    n += 1 + write_dec(&mut ser[n + 1..], epoch as u64);

    const PREFIX: &[u8] = b"\x19Ethereum Signed Message:\n";
    out[..PREFIX.len()].copy_from_slice(PREFIX);
    let mut m = PREFIX.len();
    m += write_dec(&mut out[m..], n as u64);
    out[m..m + n].copy_from_slice(&ser[..n]);
    m + n
}

/// Reads a JSON string starting at `b[i] == '"'`. Returns the raw (still escaped) contents and
/// the index after the closing quote.
fn json_str(b: &[u8], i: usize) -> Option<(&[u8], usize)> {
    if b.get(i) != Some(&b'"') {
        return None;
    }
    let mut j = i + 1;
    loop {
        match *b.get(j)? {
            b'\\' => j += 2,
            b'"' => return Some((&b[i + 1..j], j + 1)),
            _ => j += 1,
        }
    }
}

/// Walks the flat `"extractedParameters":{"k":"v",...}` object of canonical context JSON and
/// returns the raw `views` and `desc` values. `None` = malformed object.
/// Quotes inside JSON strings are always escaped, so the key needle can only match structurally.
#[allow(clippy::type_complexity)]
fn extracted(ctx: &[u8]) -> Option<(Option<&[u8]>, Option<&[u8]>)> {
    const KEY: &[u8] = b"\"extractedParameters\":{";
    let mut i = find(ctx, KEY)? + KEY.len();
    let (mut views, mut desc) = (None, None);
    if ctx.get(i) == Some(&b'}') {
        return Some((views, desc));
    }
    loop {
        let (k, j) = json_str(ctx, i)?;
        if ctx.get(j) != Some(&b':') {
            return None;
        }
        let (v, j) = json_str(ctx, j + 1)?;
        match k {
            b"views" => views = Some(v),
            b"desc" => desc = Some(v),
            _ => {}
        }
        match *ctx.get(j)? {
            b',' => i = j + 1,
            b'}' => return Some((views, desc)),
            _ => return None,
        }
    }
}

fn parse_u64(s: &[u8]) -> Option<u64> {
    if s.is_empty() {
        return None;
    }
    s.iter().try_fold(0u64, |acc, &c| {
        if !c.is_ascii_digit() {
            return None;
        }
        acc.checked_mul(10)?.checked_add((c - b'0') as u64)
    })
}

const fn hex32(s: &[u8; 64]) -> [u8; 32] {
    const fn nib(c: u8) -> u8 {
        match c {
            b'0'..=b'9' => c - b'0',
            _ => c - b'a' + 10,
        }
    }
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (nib(s[2 * i]) << 4) | nib(s[2 * i + 1]);
        i += 1;
    }
    out
}

#[cfg(any(test, feature = "testutils"))]
pub mod testutils {
    use super::*;
    use k256::ecdsa::SigningKey;
    use sha3::{Digest, Keccak256};

    fn key(secret: &[u8; 32]) -> SigningKey {
        SigningKey::from_bytes(secret.into()).expect("valid secp256k1 secret")
    }

    fn eth_address(sk: &SigningKey) -> [u8; 20] {
        let pt = sk.verifying_key().to_encoded_point(false);
        let h = Keccak256::digest(&pt.as_bytes()[1..]);
        h[12..].try_into().unwrap()
    }

    /// Ethereum address of a local secp256k1 test key.
    pub fn attestor_address(env: &Env, secret: &[u8; 32]) -> BytesN<20> {
        BytesN::from_array(env, &eth_address(&key(secret)))
    }

    /// Build a proof signed exactly like a Reclaim attestor would sign it
    /// (ethers `signingKey.sign(eip191Digest(signData))`: RFC 6979, low-s, v = 27 + recid).
    /// `owner` is lowercased as attestor-core does before signing.
    pub fn sign_proof(
        env: &Env,
        secret: &[u8; 32],
        parameters: &str,
        context: &str,
        owner: &str,
        timestamp_s: u64,
        epoch: u32,
    ) -> ReclaimProof {
        let mut h = Keccak256::new();
        h.update(b"http\n");
        h.update(parameters.as_bytes());
        h.update(b"\n");
        h.update(context.as_bytes());
        let id: [u8; 32] = h.finalize().into();

        let mut owner_lc = [0u8; 64];
        let owner_lc = &mut owner_lc[..owner.len()];
        owner_lc.copy_from_slice(owner.as_bytes());
        owner_lc.make_ascii_lowercase();

        let mut msg = [0u8; 256];
        let n = eip191_message(&id, owner_lc, timestamp_s, epoch, &mut msg);
        let digest = Keccak256::digest(&msg[..n]);
        let (sig, rid) = key(secret).sign_prehash_recoverable(&digest).expect("sign");
        ReclaimProof {
            parameters: Bytes::from_slice(env, parameters.as_bytes()),
            context: Bytes::from_slice(env, context.as_bytes()),
            owner: Bytes::from_slice(env, owner_lc),
            timestamp_s,
            epoch,
            signature: BytesN::from_array(env, &sig.to_bytes().into()),
            recovery_id: rid.to_byte() as u32,
        }
    }
}
