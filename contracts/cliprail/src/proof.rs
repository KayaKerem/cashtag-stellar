//! Glue between cliprail and the `reclaim-verify` library: expected URL, error mapping,
//! replay protection.

use reclaim_verify::{ReclaimProof, VerifyError};
use soroban_sdk::{Bytes, BytesN, Env, String, Symbol, Vec};

use crate::errors::Error;
use crate::storage::{self, DataKey};
use crate::types::PlatformConfig;

pub const MAX_VIDEO_ID: u32 = 64;
/// Opening proofs may be at most this old …
pub const MAX_PROOF_AGE: u64 = 600;
/// … and at most this far in the future (clock skew).
pub const MAX_FUTURE_SKEW: u64 = 600;
/// Closing proofs may be timestamped at most this long before `content_end(e)`.
pub const CLOSE_SLACK: u64 = 60;

pub fn map_err(e: VerifyError) -> Error {
    match e {
        VerifyError::BadSignature => Error::BadSignature,
        VerifyError::UnknownAttestor => Error::UnknownAttestor,
        VerifyError::UnknownOwner => Error::UnknownOwner,
        VerifyError::UrlMismatch => Error::UrlMismatch,
        VerifyError::MatchMismatch => Error::MatchMismatch,
        VerifyError::CodeNotFound => Error::CodeNotFound,
        VerifyError::ViewsParseError => Error::ViewsParseError,
        VerifyError::TooLarge => Error::ProofTooLarge,
    }
}

/// Video ids are restricted per platform so that no id can smuggle extra query parameters or
/// quotes into the expected URL (which would let one video be registered twice):
/// `youtube` = `[A-Za-z0-9_-]{11}`, `demo` = `[a-z0-9-]{1,32}`, others = `[A-Za-z0-9_-]{1,64}`.
pub fn validate_video_id(env: &Env, platform: &Symbol, video_id: &String) -> Result<Bytes, Error> {
    let n = video_id.len();
    let (min, max, lower_only, underscore) = if *platform == Symbol::new(env, "youtube") {
        (11, 11, false, true)
    } else if *platform == Symbol::new(env, "demo") {
        (1, 32, true, false)
    } else {
        (1, MAX_VIDEO_ID, false, true)
    };
    if n < min || n > max {
        return Err(Error::InvalidParams);
    }
    let mut buf = [0u8; MAX_VIDEO_ID as usize];
    let s = &mut buf[..n as usize];
    video_id.copy_into_slice(s);
    for c in s.iter() {
        let ok = c.is_ascii_digit()
            || c.is_ascii_lowercase()
            || (!lower_only && c.is_ascii_uppercase())
            || *c == b'-'
            || (underscore && *c == b'_');
        if !ok {
            return Err(Error::InvalidParams);
        }
    }
    Ok(video_id.to_bytes())
}

pub fn platform(env: &Env, platform: &Symbol) -> Result<PlatformConfig, Error> {
    storage::inst_get(env, &DataKey::Platform(platform.clone())).ok_or(Error::PlatformNotAllowed)
}

/// Full verification + replay protection. Returns the proven view count.
pub fn verify_and_consume(
    env: &Env,
    proof: &ReclaimProof,
    platform_sym: &Symbol,
    video_id: &Bytes,
    code: &String,
) -> Result<u64, Error> {
    let cfg = platform(env, platform_sym)?;
    let mut url = cfg.url_prefix.clone();
    url.append(video_id);
    url.append(&cfg.url_suffix);
    let attestors: Vec<BytesN<20>> =
        storage::inst_get(env, &DataKey::Attestors).unwrap_or_else(|| Vec::new(env));
    let owners: Vec<Bytes> =
        storage::inst_get(env, &DataKey::Owners).unwrap_or_else(|| Vec::new(env));
    let checked = reclaim_verify::verify(
        env,
        proof,
        &attestors,
        &owners,
        &url,
        &cfg.required,
        &code.to_bytes(),
    )
    .map_err(map_err)?;
    // replay key = keccak256(identifier ‖ timestamp_s BE): two zkFetch runs over identical data
    // share an identifier but differ in timestamp
    let mut pre: Bytes = checked.identifier.into();
    pre.extend_from_array(&proof.timestamp_s.to_be_bytes());
    let key = DataKey::UsedProof(env.crypto().keccak256(&pre).into());
    if storage::has(env, &key) {
        return Err(Error::ProofReused);
    }
    storage::put(env, &key, &true);
    Ok(checked.views)
}
