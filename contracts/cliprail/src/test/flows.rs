//! Non-adversarial flows: happy path with exact numbers, rate cap + carry, oversubscription,
//! caps, holdback, params validation, codes, reads, events, instruction costs.

use std::println;

use super::setup::*;
use crate::{ClipEpochStatus, Error};
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::vec;

#[test]
fn happy_path_two_participants_three_clips_two_epochs() {
    let t = T::new();
    let p = t.params();
    let id = t.create(&p);
    assert_eq!(t.campaign(id).balance, 1000 * USDC);
    let (a, ca) = t.join(id);
    let (b, cb) = t.join(id);
    assert_ne!(ca, cb);

    let (va1, va2, vb1) = (yt("a1"), yt("a2"), yt("b1"));
    let a1 = t.register(id, &a, &va1, &ca, 1_000);
    let cpu_register = t.cpu();
    let a2 = t.register(id, &a, &va2, &ca, 0);
    let b1 = t.register(id, &b, &vb1, &cb, 500);
    assert_eq!(t.campaign(id).clips, 3);
    assert_eq!(t.campaign(id).participants, 2);
    assert_eq!(t.c.get_clip(&a1).first_epoch, 0);

    // ---- epoch 0 close proofs
    t.set_time(t.content_end(id, 0));
    t.close(id, a1, 0, &va1, &ca, 21_000); // w 20_000
    let cpu_submit = t.cpu();
    t.close(id, a2, 0, &va2, &ca, 10_000); // w 10_000
    t.close(id, b1, 0, &vb1, &cb, 30_500); // w 30_000
    assert_eq!(t.c.get_epoch(&id, &0).total_weight, 60_000);

    t.set_time(t.settle_at(id, 0));
    t.c.settle_epoch(&id, &0);
    let e0 = t.c.get_epoch(&id, &0);
    // budget_0 = 500 USDC; 1000·B/W ≫ r_max ⇒ rate = r_max
    assert_eq!(e0.budget, 500 * USDC);
    assert_eq!(e0.rate, USDC);
    assert_eq!(e0.spent, 60 * USDC);
    assert_eq!(e0.held_total, 12 * USDC);

    // pay a1 = 20 USDC (held 4), a2 = 10 (held 2), b1 = 30 (held 6)
    assert_eq!(t.c.claim(&id, &a1, &0), 16 * USDC);
    let cpu_claim = t.cpu();
    assert_eq!(t.c.claim(&id, &a2, &0), 8 * USDC);
    assert_eq!(t.c.claim(&id, &b1, &0), 24 * USDC);
    t.check_invariant();

    // ---- epoch 1: a2 is deleted (no proof)
    t.set_time(t.content_end(id, 1));
    t.close(id, a1, 1, &va1, &ca, 41_000); // baseline 21_000 → w 20_000
    t.close(id, b1, 1, &vb1, &cb, 130_500); // w min(100_000, 50_000) = 50_000
    assert_eq!(t.c.get_clip_epoch(&a1, &1).unwrap().baseline, 21_000);
    assert!(t.c.get_clip_epoch(&a1, &0).unwrap().alive);
    assert!(!t.c.get_clip_epoch(&a2, &0).unwrap().alive);
    assert_eq!(t.c.get_epoch(&id, &0).held_survived, 10 * USDC);

    // holdback of epoch 0 opens after proof_end(1)
    assert_eq!(
        t.c.try_claim_holdback(&id, &a1, &0),
        Err(Ok(Error::EpochNotReady))
    );
    t.set_time(t.proof_end(id, 1) + 1);
    assert_eq!(t.c.claim_holdback(&id, &a1, &0), 48 * USDC / 10); // 4·12/10
    assert_eq!(t.c.claim_holdback(&id, &b1, &0), 72 * USDC / 10); // 6·12/10
    assert_eq!(
        t.c.try_claim_holdback(&id, &a2, &0),
        Err(Ok(Error::NothingToClaim))
    );

    t.set_time(t.settle_at(id, 1));
    t.c.settle_epoch(&id, &1);
    let e1 = t.c.get_epoch(&id, &1);
    assert_eq!(e1.budget, 500 * USDC + 440 * USDC); // base + carry
    assert_eq!(e1.rate, USDC);
    assert_eq!(e1.spent, 70 * USDC);
    assert_eq!(e1.held_total, 0); // no holdback in the last epoch
    assert_eq!(t.c.claim(&id, &a1, &1), 20 * USDC);
    assert_eq!(t.c.claim(&id, &b1, &1), 50 * USDC);
    assert_eq!(
        t.c.try_claim_holdback(&id, &a1, &1),
        Err(Ok(Error::EpochOutOfRange))
    );

    // totals
    assert_eq!(t.token.balance(&a), (16 + 8 + 20) * USDC + 48 * USDC / 10);
    assert_eq!(t.token.balance(&b), (24 + 50) * USDC + 72 * USDC / 10);
    t.check_invariant();

    t.set_time(t.refund_at(id));
    let before = t.token.balance(&t.brand);
    assert_eq!(t.c.refund(&id), 870 * USDC);
    assert_eq!(t.token.balance(&t.brand), before + 870 * USDC);
    assert_eq!(t.campaign(id).balance, 0);
    assert_eq!(t.token.balance(&t.c.address), 0);
    t.check_invariant();

    println!("CPU instructions: register_clip={cpu_register} submit_proof={cpu_submit} claim={cpu_claim}");
}

#[test]
fn rate_cap_and_carry() {
    let t = T::new();
    let mut p = t.params();
    p.budget = 100 * USDC;
    p.holdback_bps = 0;
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    let v = yt("rc");
    let c1 = t.register(id, &a, &v, &ca, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, c1, 0, &v, &ca, 10_000);
    t.set_time(t.settle_at(id, 0));
    t.c.settle_epoch(&id, &0);
    let e0 = t.c.get_epoch(&id, &0);
    assert_eq!(e0.rate, USDC); // capped at r_max
    assert_eq!(e0.spent, 10 * USDC);
    t.set_time(t.settle_at(id, 1));
    t.c.settle_epoch(&id, &1);
    let e1 = t.c.get_epoch(&id, &1);
    assert_eq!(e1.budget, 50 * USDC + 40 * USDC);
    assert_eq!(e1.rate, 0); // W = 0
    assert_eq!(e1.spent, 0);
    assert_eq!(t.c.claim(&id, &c1, &0), 10 * USDC);
    // double settle is rejected
    assert_eq!(
        t.c.try_settle_epoch(&id, &1),
        Err(Ok(Error::AlreadySettled))
    );
    t.check_invariant();
}

#[test]
fn budget_remainder_goes_to_last_epoch_and_order_enforced() {
    let t = T::new();
    let mut p = t.params();
    p.budget = 100 * USDC + 1; // odd
    p.epochs = 3;
    let id = t.create(&p);
    t.set_time(t.settle_at(id, 1));
    assert_eq!(
        t.c.try_settle_epoch(&id, &1),
        Err(Ok(Error::PrevEpochNotSettled))
    );
    assert_eq!(
        t.c.try_settle_epoch(&id, &2),
        Err(Ok(Error::PrevEpochNotSettled))
    );
    assert_eq!(
        t.c.try_settle_epoch(&id, &3),
        Err(Ok(Error::EpochOutOfRange))
    );
    t.c.settle_epoch(&id, &0);
    t.c.settle_epoch(&id, &1);
    assert_eq!(t.c.try_settle_epoch(&id, &2), Err(Ok(Error::EpochNotReady)));
    t.set_time(t.settle_at(id, 2));
    t.c.settle_epoch(&id, &2);
    let b = 100 * USDC + 1;
    assert_eq!(t.c.get_epoch(&id, &0).budget, b / 3);
    assert_eq!(t.c.get_epoch(&id, &2).budget, b / 3 + b % 3 + 2 * (b / 3)); // + carries
    assert_eq!(t.campaign(id).settled_epochs, 3);
}

#[test]
fn oversubscription_pro_rata_within_budget() {
    let t = T::new();
    let mut p = t.params();
    p.budget = 10 * USDC;
    p.epochs = 1;
    let id = t.create(&p);
    let mut clips = std::vec::Vec::new();
    let mut who = std::vec::Vec::new();
    for (i, grow) in [20_000u64, 10_000, 30_000].iter().enumerate() {
        let (a, ca) = t.join(id);
        let v = yt(&std::format!("os{i}"));
        let c = t.register(id, &a, &v, &ca, 7);
        clips.push((c, v, ca, *grow));
        who.push(a);
    }
    t.set_time(t.content_end(id, 0));
    for (c, v, ca, g) in clips.iter() {
        t.close(id, *c, 0, v, ca, 7 + g);
    }
    t.set_time(t.settle_at(id, 0));
    t.c.settle_epoch(&id, &0);
    let e0 = t.c.get_epoch(&id, &0);
    assert_eq!(e0.rate, 10 * USDC * 1000 / 60_000); // 1_666_666 < r_max
    assert!(e0.rate < USDC);
    assert_eq!(e0.spent, e0.rate * 60_000 / 1000);
    assert_eq!(e0.held_total, 0); // single epoch = last epoch
    let mut total = 0;
    for (c, _, _, g) in clips.iter() {
        let got = t.c.claim(&id, c, &0);
        assert_eq!(got, e0.rate * (*g as i128) / 1000);
        total += got;
    }
    assert!(total <= e0.spent && e0.spent <= 10 * USDC);
    t.check_invariant();
    t.set_time(t.refund_at(id));
    assert_eq!(t.c.refund(&id), 10 * USDC - total);
    t.check_invariant();
}

#[test]
fn caps_clip_human_min_views() {
    let t = T::new();
    let mut p = t.params();
    p.epochs = 1;
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    let (b, cb) = t.join(id);
    let vs: std::vec::Vec<_> = (0..3).map(|i| yt(&std::format!("cap{i}"))).collect();
    let cs: std::vec::Vec<u64> = vs.iter().map(|v| t.register(id, &a, v, &ca, 0)).collect();
    let vb = yt("tiny");
    let cbid = t.register(id, &b, &vb, &cb, 1_000);
    t.set_time(t.content_end(id, 0));
    for (c, v) in cs.iter().zip(vs.iter()) {
        t.close(id, *c, 0, v, &ca, 80_000); // clip cap → 50_000 each
    }
    t.close(id, cbid, 0, &vb, &cb, 1_099); // growth 99 < min_views ⇒ 0
    assert_eq!(t.c.get_clip_epoch(&cs[0], &0).unwrap().weight, 50_000);
    assert_eq!(t.c.get_clip_epoch(&cbid, &0).unwrap().weight, 0);
    assert_eq!(t.c.get_epoch(&id, &0).total_weight, 100_000); // human cap
    t.set_time(t.settle_at(id, 0));
    t.c.settle_epoch(&id, &0);
    // pay per clip = r·w_p·w_c/(raw·1000) = 1e7·100_000·50_000/(150_000·1000)
    let each = USDC * 100_000 * 50_000 / (150_000 * 1000);
    for c in cs.iter() {
        assert_eq!(t.c.claim(&id, c, &0), each);
    }
    assert_eq!(
        t.c.try_claim(&id, &cbid, &0),
        Err(Ok(Error::NothingToClaim))
    );
    assert!(3 * each <= 100 * USDC);
    t.check_invariant();
}

#[test]
fn views_never_decrease_within_window_and_resubmit_updates() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let v = yt("mx");
    let c = t.register(id, &a, &v, &ca, 100);
    t.set_time(t.content_end(id, 0));
    t.close(id, c, 0, &v, &ca, 5_100);
    t.set_time(t.now() + 1);
    t.close(id, c, 0, &v, &ca, 3_000); // lower: ignored
    let ce = t.c.get_clip_epoch(&c, &0).unwrap();
    assert_eq!((ce.views, ce.weight), (5_100, 5_000));
    t.set_time(t.now() + 1);
    t.close(id, c, 0, &v, &ca, 6_100);
    let ce = t.c.get_clip_epoch(&c, &0).unwrap();
    assert_eq!((ce.views, ce.weight), (6_100, 6_000));
    assert_eq!(t.c.get_epoch(&id, &0).total_weight, 6_000);
    assert_eq!(t.c.get_clip(&c).hwm, 6_100);
}

#[test]
fn submit_proof_windows() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let v = yt("wn");
    let c = t.register(id, &a, &v, &ca, 0);
    let p = t.yt_proof(&v, &ca, 500);
    assert_eq!(
        t.c.try_submit_proof(&id, &c, &0, &p),
        Err(Ok(Error::EpochNotReady))
    );
    assert_eq!(
        t.c.try_submit_proof(&id, &c, &2, &p),
        Err(Ok(Error::EpochOutOfRange))
    );
    // half-open window: proof_end itself is already closed
    t.set_time(t.proof_end(id, 0));
    let p = t.yt_proof(&v, &ca, 500);
    assert_eq!(
        t.c.try_submit_proof(&id, &c, &0, &p),
        Err(Ok(Error::WrongPhase))
    );
    t.set_time(t.proof_end(id, 0) + 1);
    let p = t.yt_proof(&v, &ca, 500);
    assert_eq!(
        t.c.try_submit_proof(&id, &c, &0, &p),
        Err(Ok(Error::WrongPhase))
    );
    // epoch 1 before its content_end
    assert_eq!(
        t.c.try_submit_proof(&id, &c, &1, &p),
        Err(Ok(Error::EpochNotReady))
    );
}

#[test]
fn liveness_requires_prev_settle_or_reverts() {
    // submit_proof(e) settles e-1 itself; if that is impossible it reverts (never skips)
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let (_m, _) = t.join(id);
    let v = yt("lv");
    let c = t.register(id, &a, &v, &ca, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, c, 0, &v, &ca, 1_000);
    t.set_time(t.proof_end(id, 0));
    let ch = soroban_sdk::Address::generate(&t.env);
    t.mint(&ch, 5 * USDC);
    t.c.challenge(&id, &c, &0, &ch, &t.s("bot views"));
    t.c.respond(&1);
    t.set_time(t.content_end(id, 1));
    // responded dispute not finalized ⇒ epoch 0 cannot settle ⇒ revert
    let p = t.yt_proof(&v, &ca, 2_000);
    assert_eq!(
        t.c.try_submit_proof(&id, &c, &1, &p),
        Err(Ok(Error::OpenDisputes))
    );
    t.c.finalize_dispute(&1); // arbiter silent ⇒ clipper wins
    t.c.submit_proof(&id, &c, &1, &p);
    assert!(t.c.get_epoch(&id, &0).settled);
    assert!(t.c.get_clip_epoch(&c, &0).unwrap().alive);
    t.check_invariant();
}

#[test]
fn validate_params_rules() {
    let t = T::new();
    let base = t.params();
    let bad = |f: &dyn Fn(&mut crate::CampaignParams)| {
        let mut p = base.clone();
        f(&mut p);
        t.c.try_create_campaign(&t.brand, &p)
    };
    assert_eq!(bad(&|p| p.budget = 0), Err(Ok(Error::InvalidParams)));
    assert_eq!(
        bad(&|p| p.rate_max_per_1k = 0),
        Err(Ok(Error::InvalidParams))
    );
    assert_eq!(bad(&|p| p.epochs = 0), Err(Ok(Error::InvalidParams)));
    assert_eq!(bad(&|p| p.epoch_len = 239), Err(Ok(Error::InvalidParams)));
    assert_eq!(
        bad(&|p| p.holdback_bps = 10_001),
        Err(Ok(Error::InvalidParams))
    );
    assert_eq!(bad(&|p| p.bond = -1), Err(Ok(Error::InvalidParams)));
    assert_eq!(bad(&|p| p.bond = 0), Err(Ok(Error::InvalidParams)));
    assert_eq!(bad(&|p| p.claim_grace = 299), Err(Ok(Error::InvalidParams)));
    assert_eq!(bad(&|p| p.epochs = 53), Err(Ok(Error::InvalidParams)));
    assert_eq!(
        bad(&|p| p.cap_views_clip = 1_000_000_000_001),
        Err(Ok(Error::InvalidParams))
    );
    assert_eq!(
        bad(&|p| p.cap_views_human = u64::MAX),
        Err(Ok(Error::InvalidParams))
    );
    assert_eq!(
        bad(&|p| p.rate_max_per_1k = 1_000_000_000_001),
        Err(Ok(Error::InvalidParams))
    );
    assert_eq!(
        bad(&|p| p.budget = 1_000_000_000_000_001),
        Err(Ok(Error::InvalidParams))
    );
    assert!(bad(&|p| p.epochs = 52).is_ok());
    assert_eq!(bad(&|p| p.start = T0 - 1), Err(Ok(Error::InvalidParams)));
    assert_eq!(
        bad(&|p| p.platforms = soroban_sdk::Vec::new(&t.env)),
        Err(Ok(Error::InvalidParams))
    );
    let brand = t.brand.clone();
    assert_eq!(
        bad(&|p| p.arbiter = brand.clone()),
        Err(Ok(Error::InvalidParams))
    );
    let tiktok = t.sym("tiktok");
    assert_eq!(
        bad(&|p| p.platforms = vec![&t.env, tiktok.clone()]),
        Err(Ok(Error::PlatformNotAllowed))
    );
    let long = t.s(&"x".repeat(65));
    assert_eq!(
        bad(&|p| p.title = long.clone()),
        Err(Ok(Error::InvalidParams))
    );
    // epoch_len == sum of windows is fine
    assert!(bad(&|p| p.epoch_len = 240).is_ok());
    assert_eq!(t.c.campaign_count(), 2);
}

#[test]
fn join_code_and_phase() {
    let t = T::new();
    let mut p = t.params();
    p.require_humanity = false;
    let id = t.create(&p);
    let a = soroban_sdk::Address::generate(&t.env);
    let code = to_std(&t.c.join(&id, &a));
    assert_eq!(code.len(), 9);
    assert!(code.starts_with("CR-"));
    assert!(code[3..]
        .bytes()
        .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase()));
    let part = t.c.get_participant(&id, &a).unwrap();
    assert_eq!(to_std(&part.code), code);
    assert_eq!(t.c.try_join(&id, &a), Err(Ok(Error::AlreadyJoined)));
    // deterministic & campaign-scoped
    let id2 = t.create(&p);
    let code2 = to_std(&t.c.join(&id2, &a));
    assert_ne!(code, code2);
    assert_eq!(t.c.get_participant(&99, &a), None);
    assert_eq!(t.c.try_join(&99, &a), Err(Ok(Error::CampaignNotFound)));
    t.set_time(t.content_end(id, 1));
    let late = soroban_sdk::Address::generate(&t.env);
    assert_eq!(t.c.try_join(&id, &late), Err(Ok(Error::WrongPhase)));
}

#[test]
fn register_rules() {
    let t = T::new();
    let mut p = t.params();
    p.platforms = vec![&t.env, t.sym("youtube")];
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    let stranger = soroban_sdk::Address::generate(&t.env);
    let v = yt("rr");
    let pr = t.yt_proof(&v, &ca, 10);
    let ytb = t.sym("youtube");
    assert_eq!(
        t.c.try_register_clip(&id, &stranger, &ytb, &t.s(&v), &pr),
        Err(Ok(Error::NotJoined))
    );
    assert_eq!(
        t.c.try_register_clip(&id, &a, &t.sym("demo"), &t.s("abc"), &pr),
        Err(Ok(Error::PlatformNotAllowed))
    );
    for bad in ["short", "has space__", "abc&x=1____", "twelve_chars"] {
        assert_eq!(
            t.c.try_register_clip(&id, &a, &ytb, &t.s(bad), &pr),
            Err(Ok(Error::InvalidParams)),
            "{bad}"
        );
    }
    t.c.register_clip(&id, &a, &ytb, &t.s(&v), &pr);
    t.set_time(t.content_end(id, 1));
    let v2 = yt("rr2");
    let pr = t.yt_proof(&v2, &ca, 10);
    assert_eq!(
        t.c.try_register_clip(&id, &a, &ytb, &t.s(&v2), &pr),
        Err(Ok(Error::WrongPhase))
    );
}

#[test]
fn demo_platform_video_ids() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let demo = t.sym("demo");
    let mk = |vid: &str| {
        let desc = std::format!("demo {ca}");
        t.sign(
            &ATTESTOR_SK,
            &T::params_json(DEMO_PREFIX, vid),
            &T::context_json(&desc, "42"),
            OWNER,
            t.now(),
        )
    };
    assert_eq!(
        t.c.try_register_clip(&id, &a, &demo, &t.s("Upper"), &mk("Upper")),
        Err(Ok(Error::InvalidParams))
    );
    let c =
        t.c.register_clip(&id, &a, &demo, &t.s("demo-video-1"), &mk("demo-video-1"));
    assert_eq!(t.c.get_clip(&c).baseline, 42);
}

#[test]
fn reads_get_clips_and_events() {
    let t = T::new();
    let id = t.create(&t.params());
    let evs = t.env.events().all();
    assert!(!evs.events().is_empty());
    let (a, ca) = t.join(id);
    let v = yt("rd");
    let c = t.register(id, &a, &v, &ca, 5);
    t.set_time(t.content_end(id, 0));
    t.close(id, c, 0, &v, &ca, 505);
    let views = t.c.get_clips(&id);
    assert_eq!(views.len(), 1);
    let cv = views.get(0).unwrap();
    assert_eq!(cv.clip.id, c);
    assert_eq!(cv.epochs.len(), 2);
    let e0 = cv.epochs.get(0).unwrap().unwrap();
    assert_eq!((e0.weight, e0.status), (500, ClipEpochStatus::Active));
    assert!(cv.epochs.get(1).unwrap().is_none());
    assert_eq!(t.c.try_get_clip(&77), Err(Ok(sdk_err(Error::ClipNotFound))));
    assert_eq!(
        t.c.try_get_epoch(&id, &2),
        Err(Ok(sdk_err(Error::EpochOutOfRange)))
    );
    assert_eq!(
        t.c.try_get_campaign(&9),
        Err(Ok(sdk_err(Error::CampaignNotFound)))
    );
    assert_eq!(t.c.list_disputes(&id).len(), 0);
}

fn sdk_err(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}

#[test]
fn submit_proof_wrong_campaign_and_before_first_epoch() {
    let t = T::new();
    let id = t.create(&t.params());
    let id2 = t.create(&t.params());
    let (a, ca) = t.join(id);
    let v = yt("wc");
    let c = t.register(id, &a, &v, &ca, 0);
    t.set_time(t.content_end(id, 0));
    let p = t.yt_proof(&v, &ca, 900);
    assert_eq!(
        t.c.try_submit_proof(&id2, &c, &0, &p),
        Err(Ok(Error::ClipNotFound))
    );
    // registered during epoch 1 content ⇒ first_epoch = 1; epoch 0 proofs are rejected
    let v2 = yt("late");
    let c2 = t.register(id, &a, &v2, &ca, 0);
    assert_eq!(t.c.get_clip(&c2).first_epoch, 1);
    let p = t.yt_proof(&v2, &ca, 900);
    assert_eq!(
        t.c.try_submit_proof(&id, &c2, &0, &p),
        Err(Ok(Error::EpochOutOfRange))
    );
}

#[test]
fn excluded_clip_can_still_earn_next_epoch() {
    // documented behaviour: exclusion is per clip-epoch
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let v = yt("ex");
    let c = t.register(id, &a, &v, &ca, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, c, 0, &v, &ca, 10_000);
    t.set_time(t.proof_end(id, 0));
    let ch = soroban_sdk::Address::generate(&t.env);
    t.mint(&ch, 5 * USDC);
    let d = t.c.challenge(&id, &c, &0, &ch, &t.s("bot"));
    t.set_time(t.dispute_end(id, 0));
    t.c.finalize_dispute(&d);
    t.set_time(t.content_end(id, 1));
    t.close(id, c, 1, &v, &ca, 12_000); // baseline = hwm 10_000
    let prev = t.c.get_clip_epoch(&c, &0).unwrap();
    assert_eq!(prev.status, ClipEpochStatus::Excluded);
    assert!(!prev.alive);
    assert_eq!(t.c.get_clip_epoch(&c, &1).unwrap().weight, 2_000);
    assert_eq!(t.c.try_claim(&id, &c, &0), Err(Ok(Error::Excluded)));
    t.set_time(t.proof_end(id, 1));
    assert_eq!(
        t.c.try_claim_holdback(&id, &c, &0),
        Err(Ok(Error::Excluded))
    );
    t.set_time(t.settle_at(id, 1));
    t.c.settle_epoch(&id, &1);
    assert_eq!(t.c.claim(&id, &c, &1), 2 * USDC);
    t.check_invariant();
}

#[test]
fn refund_with_last_epoch_unsettled() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, ca) = t.join(id);
    let v = yt("ru");
    let c = t.register(id, &a, &v, &ca, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, c, 0, &v, &ca, 10_000);
    t.set_time(t.content_end(id, 1));
    t.close(id, c, 1, &v, &ca, 20_000); // settles epoch 0
    let paid = t.c.claim(&id, &c, &0);
    assert_eq!(paid, 8 * USDC);
    // nobody settles epoch 1; after refund_at the brand gets everything left
    t.set_time(t.refund_at(id));
    assert!(!t.c.get_epoch(&id, &1).settled);
    assert_eq!(t.c.refund(&id), 1000 * USDC - paid);
    assert_eq!(t.c.try_claim(&id, &c, &1), Err(Ok(Error::EpochNotReady)));
    assert_eq!(
        t.c.try_claim_holdback(&id, &c, &0),
        Err(Ok(Error::WrongPhase))
    );
    t.check_invariant();
}

#[test]
fn holdback_rounding_never_overpays() {
    let t = T::new();
    let mut p = t.params();
    p.budget = 777_777_777;
    p.rate_max_per_1k = 3_333_333;
    p.holdback_bps = 3_333;
    p.cap_views_clip = 50_000;
    p.cap_views_human = 70_000;
    p.min_views = 1;
    let id = t.create(&p);
    let mut seed: u64 = 12_345;
    let mut rnd = || {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) % 90_000 + 1
    };
    let mut clips = std::vec::Vec::new();
    for pi in 0..4 {
        let (a, ca) = t.join(id);
        for k in 0..3 {
            let v = yt(&std::format!("r{pi}x{k}"));
            let base = rnd();
            let c = t.register(id, &a, &v, &ca, base);
            clips.push((c, v, ca.clone(), base));
        }
    }
    t.set_time(t.content_end(id, 0));
    let mut v0 = std::vec::Vec::new();
    for (c, v, ca, base) in clips.iter() {
        let views = base + rnd();
        t.close(id, *c, 0, v, ca, views);
        v0.push(views);
    }
    t.set_time(t.content_end(id, 1));
    for (i, (c, v, ca, _)) in clips.iter().enumerate() {
        if i % 3 != 0 {
            t.close(id, *c, 1, v, ca, v0[i] + rnd());
        }
    }
    let e0 = t.c.get_epoch(&id, &0);
    assert!(e0.spent > 0 && e0.held_total > 0);
    let mut paid0: i128 = 0;
    for (c, _, _, _) in clips.iter() {
        if let Ok(Ok(x)) = t.c.try_claim(&id, c, &0) {
            paid0 += x;
        }
    }
    t.set_time(t.proof_end(id, 1));
    for (c, _, _, _) in clips.iter() {
        if let Ok(Ok(x)) = t.c.try_claim_holdback(&id, c, &0) {
            paid0 += x;
        }
    }
    assert!(paid0 <= e0.spent, "paid {paid0} > spent {}", e0.spent);
    assert!(
        e0.spent - paid0 < 1_000_000,
        "forfeited share should be small here"
    );
    t.set_time(t.settle_at(id, 1));
    t.c.settle_epoch(&id, &1);
    let e1 = t.c.get_epoch(&id, &1);
    let mut paid1: i128 = 0;
    for (c, _, _, _) in clips.iter() {
        if let Ok(Ok(x)) = t.c.try_claim(&id, c, &1) {
            paid1 += x;
        }
    }
    assert!(paid1 <= e1.spent);
    assert!(paid0 + paid1 <= p.budget);
    t.check_invariant();
}
