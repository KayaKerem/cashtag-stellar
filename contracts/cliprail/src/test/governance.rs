//! Admin power over live campaigns (TM-1) and dispute economics (TM-6).

use std::format;

use super::setup::*;
use crate::dispute::{dispute_fee, DISPUTE_FEE_BPS};
use crate::Error;
use reclaim_verify::testutils::attestor_address;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Bytes};

fn flat<V, E1: core::fmt::Debug, E2: core::fmt::Debug>(
    r: Result<Result<V, E1>, Result<Error, E2>>,
) -> Result<V, Error> {
    match r {
        Ok(Ok(v)) => Ok(v),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected {:?}", other.err()),
    }
}

#[test]
fn live_campaign_keeps_its_config_after_admin_changes() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, code) = t.join(id);
    let v = yt("snap");
    let clip = t.register(id, &a, &v, &code, 1_000);
    let before = t.c.get_campaign_config(&id);

    // A compromised admin swaps in its own attestor and repoints youtube to its own host.
    t.c.set_attestors(&vec![&t.env, attestor_address(&t.env, &ROGUE_SK)]);
    let evil = "https://evil.example/v?id=";
    t.c.set_platform(
        &t.sym("youtube"),
        &Bytes::from_slice(&t.env, evil.as_bytes()),
        &Bytes::new(&t.env),
        &vec![&t.env, Bytes::from_slice(&t.env, match_entry(RE_VIEWS).as_bytes())],
    );
    assert_eq!(t.c.get_campaign_config(&id), before);

    // The rogue attestor cannot mint weight in the existing campaign …
    t.set_time(t.content_end(id, 0));
    let desc = format!("code {code}");
    let forged = t.sign(&ROGUE_SK, &T::params_json(YT_PREFIX, &v), &T::context_json(&desc, "9999999"), OWNER, t.now());
    assert_eq!(flat(t.c.try_submit_proof(&id, &clip, &0, &forged)), Err(Error::UnknownAttestor));
    let forged = t.sign(&ROGUE_SK, &T::params_json(evil, &v), &T::context_json(&desc, "9999999"), OWNER, t.now());
    assert!(flat(t.c.try_submit_proof(&id, &clip, &0, &forged)).is_err());
    // … while honest proofs keep working there.
    t.c.submit_proof(&id, &clip, &0, &t.yt_proof(&v, &code, 5_000));
    assert_eq!(t.c.get_clip_epoch(&clip, &0).unwrap().views, 5_000);

    // Only campaigns created afterwards (which the brand can inspect first) see the new config.
    let id2 = t.create(&t.params());
    let cfg2 = t.c.get_campaign_config(&id2);
    assert_eq!(cfg2.attestors, vec![&t.env, attestor_address(&t.env, &ROGUE_SK)]);
    assert_eq!(
        cfg2.platforms.get(t.sym("youtube")).unwrap().url_prefix,
        Bytes::from_slice(&t.env, evil.as_bytes())
    );
    // only the campaign's own platforms are frozen
    let mut p = t.params();
    p.platforms = vec![&t.env, t.sym("demo")];
    let id3 = t.create(&p);
    let cfg3 = t.c.get_campaign_config(&id3);
    assert_eq!(cfg3.platforms.len(), 1);
    assert!(cfg3.platforms.get(t.sym("youtube")).is_none());
}

#[test]
fn arbiter_must_be_curated_and_not_the_brand() {
    let t = T::new();
    let mut p = t.params();
    p.arbiter = Address::generate(&t.env); // a brand's second wallet
    assert_eq!(flat(t.c.try_create_campaign(&t.brand, &p)), Err(Error::ArbiterNotAllowed));
    // even if listed, the brand itself can never be its own arbiter
    t.c.set_arbiters(&vec![&t.env, t.arbiter.clone(), t.brand.clone()]);
    p.arbiter = t.brand.clone();
    assert_eq!(flat(t.c.try_create_campaign(&t.brand, &p)), Err(Error::InvalidParams));
    assert_eq!(t.c.arbiters().len(), 2);
    // delisting an arbiter does not affect campaigns that already named it
    let id = t.create(&t.params());
    t.c.set_arbiters(&vec![&t.env]);
    assert_eq!(t.campaign(id).params.arbiter, t.arbiter);
    assert_eq!(flat(t.c.try_create_campaign(&t.brand, &t.params())), Err(Error::ArbiterNotAllowed));
}

#[test]
fn min_response_window_is_enforced_at_creation() {
    let t = T::new();
    assert_eq!(t.c.min_response_window(), 0);
    t.c.set_min_response_window(&60);
    let mut p = t.params();
    p.dispute_window = 90; // 45 s to respond after a last-second challenge
    assert_eq!(flat(t.c.try_create_campaign(&t.brand, &p)), Err(Error::InvalidParams));
    p.dispute_window = 120;
    p.epoch_len = 400;
    p.claim_grace = 400;
    assert!(flat(t.c.try_create_campaign(&t.brand, &p)).is_ok());
}

#[test]
fn admin_transfer_is_two_step() {
    let t = T::new();
    assert_eq!(flat(t.c.try_accept_admin()), Err(Error::NoPendingAdmin));
    let next = Address::generate(&t.env);
    t.c.propose_admin(&next);
    assert_eq!(t.c.admin(), t.admin); // nothing changes until accepted
    t.c.accept_admin();
    assert_eq!(t.env.auths()[0].0, next); // the new admin signed the acceptance
    assert_eq!(t.c.admin(), next);
    assert_eq!(flat(t.c.try_accept_admin()), Err(Error::NoPendingAdmin));
}

#[test]
fn dispute_fee_is_never_zero() {
    assert_eq!(DISPUTE_FEE_BPS, 1_000);
    assert_eq!(dispute_fee(1), 1);
    assert_eq!(dispute_fee(10), 1);
    assert_eq!(dispute_fee(11), 2);
    assert_eq!(dispute_fee(5 * USDC), USDC / 2);
    // no overflow at the extremes
    assert_eq!(dispute_fee(i128::MAX), i128::MAX / 10 + 1);
    for b in [9_999i128, 10_000, 10_001, 123_456_789] {
        assert_eq!(dispute_fee(b), (b * DISPUTE_FEE_BPS + 9_999) / 10_000);
    }
}

#[test]
fn arbiter_cannot_join_or_challenge() {
    let t = T::new();
    let id = t.create(&t.params());
    assert_eq!(flat(t.c.try_join(&id, &t.arbiter)), Err(Error::InvalidParams));
    let (a, code) = t.join(id);
    let clip = t.register(id, &a, &yt("arb"), &code, 1_000);
    t.set_time(t.content_end(id, 0));
    t.c.submit_proof(&id, &clip, &0, &t.yt_proof(&yt("arb"), &code, 5_000));
    t.set_time(t.proof_end(id, 0));
    t.mint(&t.arbiter, 5 * USDC);
    assert_eq!(
        flat(t.c.try_challenge(&id, &clip, &0, &t.arbiter, &t.s("x"))),
        Err(Error::InvalidParams)
    );
}

#[test]
fn creation_needs_attestors_and_owners() {
    let t = T::new();
    t.c.set_owners(&vec![&t.env]);
    assert_eq!(flat(t.c.try_create_campaign(&t.brand, &t.params())), Err(Error::NotInitialized));
}
