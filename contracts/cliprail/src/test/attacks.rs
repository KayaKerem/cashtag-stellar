//! One test per threat in ARCHITECTURE §12 (A1–A17), asserting the exact error.

use std::format;

use super::setup::*;
use crate::{ClipEpochStatus, Error};
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, BytesN, IntoVal};

struct S {
    t: T,
    id: u64,
    a: Address,
    ca: std::string::String,
    v: std::string::String,
    clip: u64,
}

/// Campaign + one joined clipper with one registered clip (baseline 1000).
fn base() -> S {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let v = yt("atk");
    let clip = t.register(id, &a, &v, &ca, 1_000);
    S {
        t,
        id,
        a,
        ca,
        v,
        clip,
    }
}

fn try_register(s: &S, video_id: &str, proof: &crate::ReclaimProof) -> Result<u64, Error> {
    match s
        .t
        .c
        .try_register_clip(&s.id, &s.a, &s.t.sym("youtube"), &s.t.s(video_id), proof)
    {
        Ok(Ok(v)) => Ok(v),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn a01_proof_reuse() {
    let s = base();
    let t = &s.t;
    t.set_time(t.content_end(s.id, 0));
    let p = t.yt_proof(&s.v, &s.ca, 5_000);
    t.c.submit_proof(&s.id, &s.clip, &0, &p);
    assert_eq!(
        t.c.try_submit_proof(&s.id, &s.clip, &0, &p),
        Err(Ok(Error::ProofReused))
    );
    // the opening proof cannot be replayed as a new registration either
    let v2 = yt("atk2");
    let open = t.yt_proof(&v2, &s.ca, 10);
    t.c.register_clip(&s.id, &s.a, &t.sym("youtube"), &t.s(&v2), &open);
    assert_eq!(
        try_register(&s, &v2, &open),
        Err(Error::VideoAlreadyRegistered)
    );
}

#[test]
fn a02_video_twice() {
    let s = base();
    let t = &s.t;
    // same video, second campaign, different clipper with their own valid proof
    let id2 = t.create(&t.params());
    let (b, cb) = t.join(id2);
    let p = t.yt_proof(&s.v, &cb, 2_000);
    assert_eq!(
        t.c.try_register_clip(&id2, &b, &t.sym("youtube"), &t.s(&s.v), &p),
        Err(Ok(Error::VideoAlreadyRegistered))
    );
    // and the same campaign again
    let p = t.yt_proof(&s.v, &s.ca, 2_000);
    assert_eq!(
        try_register(&s, &s.v, &p),
        Err(Error::VideoAlreadyRegistered)
    );
}

#[test]
fn a03_code_added_to_viral_video() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let v = yt("viral");
    let c = t.register(id, &a, &v, &ca, 1_000_000);
    assert_eq!(t.c.get_clip(&c).baseline, 1_000_000);
    t.set_time(t.content_end(id, 0));
    t.close(id, c, 0, &v, &ca, 1_000_500);
    assert_eq!(t.c.get_clip_epoch(&c, &0).unwrap().weight, 500); // only post-registration growth
}

#[test]
fn a04_proof_for_other_video() {
    let s = base();
    let other = yt("other");
    let p = s.t.yt_proof(&other, &s.ca, 10);
    assert_eq!(try_register(&s, &yt("mine"), &p), Err(Error::UrlMismatch));
    // closing proof of another video for our clip
    let t = &s.t;
    t.set_time(t.content_end(s.id, 0));
    let p = t.yt_proof(&other, &s.ca, 9_000);
    assert_eq!(
        t.c.try_submit_proof(&s.id, &s.clip, &0, &p),
        Err(Ok(Error::UrlMismatch))
    );
}

#[test]
fn a05_other_regex() {
    let s = base();
    let t = &s.t;
    let v = yt("rx");
    // prover swaps the views regex for one capturing likeCount
    let params = T::params_json(YT_PREFIX, &v).replace("viewCount", "likeCount");
    let desc = format!("code {}", s.ca);
    let p = t.sign(
        &ATTESTOR_SK,
        &params,
        &T::context_json(&desc, "10"),
        OWNER,
        t.now(),
    );
    assert_eq!(try_register(&s, &v, &p), Err(Error::MatchMismatch));
}

#[test]
fn a06_code_missing_or_foreign() {
    let s = base();
    let t = &s.t;
    let v = yt("nocode");
    let p = t.yt_proof(&v, "no code here", 10);
    assert_eq!(try_register(&s, &v, &p), Err(Error::CodeNotFound));
    let (_, cb) = t.join(s.id);
    let p = t.yt_proof(&v, &cb, 10); // someone else's code
    assert_eq!(try_register(&s, &v, &p), Err(Error::CodeNotFound));
    // code only outside desc (e.g. in contextMessage) does not count
    let params = T::params_json(YT_PREFIX, &v);
    let ctx = T::context_json("plain", "10").replace(
        r#""contextMessage":"""#,
        &format!(r#""contextMessage":"{}""#, s.ca),
    );
    let p = t.sign(&ATTESTOR_SK, &params, &ctx, OWNER, t.now());
    assert_eq!(try_register(&s, &v, &p), Err(Error::CodeNotFound));
}

#[test]
fn a07_stale_or_future_timestamp() {
    let s = base();
    let t = &s.t;
    let v = yt("ts");
    let now = t.now();
    let old = t.yt_proof_at(&v, &s.ca, 10, now - 601);
    assert_eq!(try_register(&s, &v, &old), Err(Error::ProofExpired));
    let fut = t.yt_proof_at(&v, &s.ca, 10, now + 601);
    assert_eq!(try_register(&s, &v, &fut), Err(Error::ProofExpired));
    let ok = t.yt_proof_at(&v, &s.ca, 10, now - 600);
    assert!(try_register(&s, &v, &ok).is_ok());
    // closing proof taken well before content_end
    t.set_time(t.content_end(s.id, 0));
    let early = t.yt_proof_at(&s.v, &s.ca, 9_000, t.content_end(s.id, 0) - 61);
    assert_eq!(
        t.c.try_submit_proof(&s.id, &s.clip, &0, &early),
        Err(Ok(Error::ProofExpired))
    );
}

#[test]
fn a08_unknown_attestor_or_owner() {
    let s = base();
    let t = &s.t;
    let v = yt("rogue");
    let desc = format!("code {}", s.ca);
    let params = T::params_json(YT_PREFIX, &v);
    let ctx = T::context_json(&desc, "10");
    let p = t.sign(&ROGUE_SK, &params, &ctx, OWNER, t.now());
    assert_eq!(try_register(&s, &v, &p), Err(Error::UnknownAttestor));
    let p = t.sign(
        &ATTESTOR_SK,
        &params,
        &ctx,
        "0x000000000000000000000000000000000000dead",
        t.now(),
    );
    assert_eq!(try_register(&s, &v, &p), Err(Error::UnknownOwner));
    // tampered payload after signing
    let mut p = t.sign(&ATTESTOR_SK, &params, &ctx, OWNER, t.now());
    p.context = soroban_sdk::Bytes::from_slice(&t.env, T::context_json(&desc, "99999").as_bytes());
    assert_eq!(try_register(&s, &v, &p), Err(Error::UnknownAttestor));
    // out-of-range signature
    let mut p = t.sign(&ATTESTOR_SK, &params, &ctx, OWNER, t.now());
    p.recovery_id = 7;
    assert_eq!(try_register(&s, &v, &p), Err(Error::BadSignature));
}

#[test]
fn a09_sybil_second_wallet() {
    let t = T::new();
    let id = t.create(&t.params());
    let w1 = Address::generate(&t.env);
    let w2 = Address::generate(&t.env);
    let null = BytesN::from_array(&t.env, &[9u8; 32]);
    t.hum.register(&id, &null, &w1);
    t.c.join(&id, &w1);
    // same person (same nullifier) with a second wallet cannot be registered…
    assert_eq!(
        t.hum.try_register(&id, &null, &w2),
        Err(Ok(humanity::Error::NullifierUsed))
    );
    // …so the second wallet cannot join
    assert_eq!(t.c.try_join(&id, &w2), Err(Ok(Error::NotHuman)));
    assert_eq!(t.c.try_join(&id, &w1), Err(Ok(Error::AlreadyJoined)));
}

#[test]
fn a10_caps_many_clips() {
    let t = T::new();
    let mut p = t.params();
    p.epochs = 1;
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    let mut clips = std::vec::Vec::new();
    for i in 0..5 {
        let v = yt(&format!("m{i}"));
        clips.push((t.register(id, &a, &v, &ca, 0), v));
    }
    t.set_time(t.content_end(id, 0));
    for (c, v) in clips.iter() {
        t.close(id, *c, 0, v, &ca, 1_000_000);
    }
    assert_eq!(t.c.get_clip_epoch(&clips[0].0, &0).unwrap().weight, 50_000);
    assert_eq!(t.c.get_epoch(&id, &0).total_weight, 100_000); // 5×50k capped at 100k
    t.set_time(t.settle_at(id, 0));
    t.c.settle_epoch(&id, &0);
    let mut total = 0;
    for (c, _) in clips.iter() {
        total += t.c.claim(&id, c, &0);
    }
    assert_eq!(total, 100 * USDC); // 100k views × 1 USDC/1k
    t.check_invariant();
}

#[test]
fn a11_budget_exhaustion() {
    let t = T::new();
    let mut p = t.params();
    p.budget = USDC;
    p.epochs = 1;
    let id = t.create(&p);
    let mut total = 0;
    let mut cs = std::vec::Vec::new();
    for i in 0..3 {
        let (a, ca) = t.join(id);
        let v = yt(&format!("bx{i}"));
        cs.push((t.register(id, &a, &v, &ca, 0), v, ca));
    }
    t.set_time(t.content_end(id, 0));
    for (i, (c, v, ca)) in cs.iter().enumerate() {
        t.close(id, *c, 0, v, ca, 33_333 + i as u64);
    }
    t.set_time(t.settle_at(id, 0));
    t.c.settle_epoch(&id, &0);
    for (c, _, _) in cs.iter() {
        total += t.c.claim(&id, c, &0);
    }
    assert!(total <= USDC);
    assert!(t.campaign(id).balance >= 0);
    t.check_invariant();
}

#[test]
fn a12_views_drop_then_rise() {
    let s = base(); // baseline 1000
    let t = &s.t;
    t.set_time(t.content_end(s.id, 0));
    t.close(s.id, s.clip, 0, &s.v, &s.ca, 5_000); // w 4000, hwm 5000
    t.set_time(t.content_end(s.id, 1));
    t.close(s.id, s.clip, 1, &s.v, &s.ca, 3_000); // dropped
    let ce = t.c.get_clip_epoch(&s.clip, &1).unwrap();
    assert_eq!((ce.baseline, ce.weight), (5_000, 0));
    t.set_time(t.now() + 5);
    t.close(s.id, s.clip, 1, &s.v, &s.ca, 5_500); // re-rise: only above HWM counts
    assert_eq!(t.c.get_clip_epoch(&s.clip, &1).unwrap().weight, 500);
}

#[test]
fn a13_double_claim() {
    let s = base();
    let t = &s.t;
    t.set_time(t.content_end(s.id, 0));
    t.close(s.id, s.clip, 0, &s.v, &s.ca, 11_000);
    t.set_time(t.settle_at(s.id, 0));
    t.c.settle_epoch(&s.id, &0);
    t.c.claim(&s.id, &s.clip, &0);
    assert_eq!(
        t.c.try_claim(&s.id, &s.clip, &0),
        Err(Ok(Error::AlreadyClaimed))
    );
    t.set_time(t.content_end(s.id, 1));
    t.close(s.id, s.clip, 1, &s.v, &s.ca, 12_000);
    t.set_time(t.proof_end(s.id, 1) + 1);
    t.c.claim_holdback(&s.id, &s.clip, &0);
    assert_eq!(
        t.c.try_claim_holdback(&s.id, &s.clip, &0),
        Err(Ok(Error::AlreadyClaimed))
    );
    t.check_invariant();
}

#[test]
fn a14_claim_while_disputed() {
    let s = base();
    let t = &s.t;
    t.set_time(t.content_end(s.id, 0));
    t.close(s.id, s.clip, 0, &s.v, &s.ca, 11_000);
    t.set_time(t.proof_end(s.id, 0));
    let ch = Address::generate(&t.env);
    t.mint(&ch, 5 * USDC);
    t.c.challenge(&s.id, &s.clip, &0, &ch, &t.s("bot"));
    t.set_time(t.settle_at(s.id, 0));
    assert_eq!(
        t.c.try_settle_epoch(&s.id, &0),
        Err(Ok(Error::OpenDisputes))
    );
    assert_eq!(
        t.c.try_claim(&s.id, &s.clip, &0),
        Err(Ok(Error::EpochNotReady))
    );
    t.check_invariant();
}

#[test]
fn a15_non_arbiter_resolve() {
    let s = base();
    let t = &s.t;
    t.set_time(t.content_end(s.id, 0));
    t.close(s.id, s.clip, 0, &s.v, &s.ca, 11_000);
    t.set_time(t.proof_end(s.id, 0));
    let ch = Address::generate(&t.env);
    t.mint(&ch, 5 * USDC);
    let dis = t.c.challenge(&s.id, &s.clip, &0, &ch, &t.s("bot"));
    t.c.respond(&dis);
    t.set_time(t.dispute_end(s.id, 0));
    for who in [s.a.clone(), t.brand.clone(), ch.clone()] {
        let r =
            t.c.mock_auths(&[MockAuth {
                address: &who,
                invoke: &MockAuthInvoke {
                    contract: &t.c.address,
                    fn_name: "resolve",
                    args: (dis, false).into_val(&t.env),
                    sub_invokes: &[],
                },
            }])
            .try_resolve(&dis, &false);
        // host auth failure (Error(Auth, InvalidAction)); no contract error code exists for it
        assert!(matches!(r, Err(Err(_))), "{r:?}");
    }
    assert_eq!(
        t.c.get_clip_epoch(&s.clip, &0).unwrap().status,
        ClipEpochStatus::Responded
    );
    let arb = t.arbiter.clone();
    t.c.mock_auths(&[MockAuth {
        address: &arb,
        invoke: &MockAuthInvoke {
            contract: &t.c.address,
            fn_name: "resolve",
            args: (dis, true).into_val(&t.env),
            sub_invokes: &[],
        },
    }])
    .resolve(&dis, &true);
    assert_eq!(
        t.c.get_clip_epoch(&s.clip, &0).unwrap().status,
        ClipEpochStatus::Active
    );
    t.env.mock_all_auths();
    t.check_invariant();
}

#[test]
fn a16_early_refund() {
    let s = base();
    let t = &s.t;
    t.set_time(t.refund_at(s.id) - 1);
    assert_eq!(t.c.try_refund(&s.id), Err(Ok(Error::RefundNotReady)));
    t.set_time(t.refund_at(s.id));
    assert_eq!(t.c.refund(&s.id), 1000 * USDC);
    assert_eq!(t.c.try_refund(&s.id), Err(Ok(Error::AlreadyRefunded)));
    // claims close at refund_at
    assert_eq!(
        t.c.try_claim(&s.id, &s.clip, &0),
        Err(Ok(Error::EpochNotReady))
    );
    t.check_invariant();
}

#[test]
fn a17_deleted_video_forfeits_holdback() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let (b, cb) = t.join(id);
    let (va, vb) = (yt("alive"), yt("deleted"));
    let ka = t.register(id, &a, &va, &ca, 0);
    let kb = t.register(id, &b, &vb, &cb, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, ka, 0, &va, &ca, 10_000);
    t.close(id, kb, 0, &vb, &cb, 10_000);
    t.set_time(t.settle_at(id, 0));
    t.c.settle_epoch(&id, &0);
    assert_eq!(t.c.claim(&id, &ka, &0), 8 * USDC);
    assert_eq!(t.c.claim(&id, &kb, &0), 8 * USDC);
    assert_eq!(t.c.get_epoch(&id, &0).held_total, 4 * USDC);
    // epoch 1: only `ka` proves it is still up
    t.set_time(t.content_end(id, 1));
    t.close(id, ka, 1, &va, &ca, 10_500);
    t.set_time(t.proof_end(id, 1) + 1);
    assert_eq!(
        t.c.try_claim_holdback(&id, &kb, &0),
        Err(Ok(Error::NothingToClaim))
    );
    assert_eq!(t.c.claim_holdback(&id, &ka, &0), 4 * USDC); // survivor takes all held
    assert_eq!(t.token.balance(&b), 8 * USDC);
    assert_eq!(t.token.balance(&a), 12 * USDC);
    t.check_invariant();
}
