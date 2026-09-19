//! Bonded dispute outcomes (only the challenger posts a bond).

use super::setup::*;
use crate::{ClipEpochStatus, DisputeStatus, Error};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

/// One-epoch campaign, small budget (pro rata, rate < r_max), two clippers with growth 30k / 10k.
struct D {
    t: T,
    id: u64,
    bot: u64,
    good: u64,
    bot_owner: Address,
    good_owner: Address,
    ch: Address,
}

fn setup() -> D {
    let t = T::new();
    let mut p = t.params();
    p.budget = 20 * USDC;
    p.epochs = 1;
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    let (b, cb) = t.join(id);
    let (va, vb) = (yt("bot"), yt("good"));
    let bot = t.register(id, &a, &va, &ca, 0);
    let good = t.register(id, &b, &vb, &cb, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, bot, 0, &va, &ca, 30_000);
    t.close(id, good, 0, &vb, &cb, 10_000);
    assert_eq!(t.c.get_epoch(&id, &0).total_weight, 40_000);
    let ch = Address::generate(&t.env);
    t.mint(&ch, 5 * USDC);
    D {
        t,
        id,
        bot,
        good,
        bot_owner: a,
        good_owner: b,
        ch,
    }
}

fn open(d: &D) -> u64 {
    d.t.set_time(d.t.proof_end(d.id, 0));
    let dis =
        d.t.c
            .challenge(&d.id, &d.bot, &0, &d.ch, &d.t.s("ipfs://evidence"));
    assert_eq!(d.t.token.balance(&d.ch), 0);
    assert_eq!(d.t.c.get_epoch(&d.id, &0).open_disputes, 1);
    assert_eq!(
        d.t.c.get_clip_epoch(&d.bot, &0).unwrap().status,
        ClipEpochStatus::Challenged
    );
    d.t.check_invariant();
    dis
}

fn assert_excluded(d: &D) {
    let t = &d.t;
    let ce = t.c.get_clip_epoch(&d.bot, &0).unwrap();
    assert_eq!((ce.status, ce.weight), (ClipEpochStatus::Excluded, 0));
    assert_eq!(t.c.get_epoch(&d.id, &0).total_weight, 10_000);
    assert_eq!(t.c.get_epoch(&d.id, &0).open_disputes, 0);
    t.set_time(t.settle_at(d.id, 0));
    t.c.settle_epoch(&d.id, &0);
    // W shrank 40k → 10k: the good clipper's rate rises (20 USDC / 10k views, capped at r_max)
    let e0 = t.c.get_epoch(&d.id, &0);
    assert_eq!(e0.rate, USDC);
    assert_eq!(t.c.claim(&d.id, &d.good, &0), 10 * USDC);
    assert_eq!(t.c.try_claim(&d.id, &d.bot, &0), Err(Ok(Error::Excluded)));
    assert_eq!(t.token.balance(&d.good_owner), 10 * USDC);
    assert_eq!(t.token.balance(&d.bot_owner), 0);
    t.check_invariant();
}

fn assert_clipper_kept(d: &D) {
    let t = &d.t;
    assert_eq!(
        t.c.get_clip_epoch(&d.bot, &0).unwrap().status,
        ClipEpochStatus::Active
    );
    assert_eq!(t.c.get_epoch(&d.id, &0).total_weight, 40_000);
    t.set_time(t.settle_at(d.id, 0));
    t.c.settle_epoch(&d.id, &0);
    let e0 = t.c.get_epoch(&d.id, &0);
    assert_eq!(e0.rate, 20 * USDC * 1000 / 40_000);
    assert_eq!(t.c.claim(&d.id, &d.bot, &0), 15 * USDC);
    // bot owner also received the challenger's bond
    assert_eq!(t.token.balance(&d.bot_owner), 20 * USDC);
    t.check_invariant();
}

#[test]
fn unanswered_challenge_excludes_after_dispute_end() {
    let d = setup();
    let dis = open(&d);
    let t = &d.t;
    assert_eq!(t.c.try_finalize_dispute(&dis), Err(Ok(Error::WrongPhase)));
    t.set_time(t.dispute_end(d.id, 0));
    assert_eq!(t.c.try_respond(&dis), Err(Ok(Error::WrongPhase))); // too late
    t.c.finalize_dispute(&dis);
    assert_eq!(
        t.c.list_disputes(&d.id).get(0).unwrap().status,
        DisputeStatus::ChallengerWon
    );
    assert_eq!(t.token.balance(&d.ch), 5 * USDC); // bond refunded
    assert_eq!(t.c.try_finalize_dispute(&dis), Err(Ok(Error::WrongPhase)));
    assert_excluded(&d);
}

#[test]
fn responded_arbiter_rules_for_clipper() {
    let d = setup();
    let dis = open(&d);
    let t = &d.t;
    t.c.respond(&dis);
    assert_eq!(
        t.c.get_clip_epoch(&d.bot, &0).unwrap().status,
        ClipEpochStatus::Responded
    );
    assert_eq!(t.c.try_respond(&dis), Err(Ok(Error::WrongPhase)));
    assert_eq!(t.c.try_resolve(&dis, &true), Err(Ok(Error::WrongPhase))); // before dispute_end
    t.set_time(t.dispute_end(d.id, 0));
    assert_eq!(t.c.try_finalize_dispute(&dis), Err(Ok(Error::WrongPhase))); // arbiter's turn
    t.c.resolve(&dis, &true);
    assert_eq!(
        t.c.list_disputes(&d.id).get(0).unwrap().status,
        DisputeStatus::ClipperWon
    );
    assert_eq!(t.token.balance(&d.ch), 0);
    assert_eq!(t.token.balance(&d.bot_owner), 5 * USDC);
    assert_clipper_kept(&d);
}

#[test]
fn responded_arbiter_rules_for_challenger() {
    let d = setup();
    let dis = open(&d);
    let t = &d.t;
    t.c.respond(&dis);
    t.set_time(t.dispute_end(d.id, 0) + 10);
    t.c.resolve(&dis, &false);
    assert_eq!(t.token.balance(&d.ch), 5 * USDC);
    assert_eq!(t.c.try_resolve(&dis, &true), Err(Ok(Error::WrongPhase)));
    assert_excluded(&d);
}

#[test]
fn arbiter_timeout_clipper_wins() {
    let d = setup();
    let dis = open(&d);
    let t = &d.t;
    t.c.respond(&dis);
    t.set_time(t.settle_at(d.id, 0) - 1);
    assert_eq!(t.c.try_finalize_dispute(&dis), Err(Ok(Error::WrongPhase)));
    t.set_time(t.settle_at(d.id, 0));
    assert_eq!(t.c.try_resolve(&dis, &false), Err(Ok(Error::WrongPhase))); // arbiter too late
    t.c.finalize_dispute(&dis);
    assert_eq!(t.token.balance(&d.bot_owner), 5 * USDC);
    assert_clipper_kept(&d);
}

#[test]
fn challenge_rules() {
    let d = setup();
    let t = &d.t;
    let ev = t.s("x");
    // before proof_end
    assert_eq!(
        t.c.try_challenge(&d.id, &d.bot, &0, &d.ch, &ev),
        Err(Ok(Error::WrongPhase))
    );
    let dis = open(&d);
    t.mint(&d.ch, 5 * USDC);
    assert_eq!(
        t.c.try_challenge(&d.id, &d.bot, &0, &d.ch, &ev),
        Err(Ok(Error::AlreadyDisputed))
    );
    assert_eq!(
        t.c.try_challenge(&d.id, &d.bot, &1, &d.ch, &ev),
        Err(Ok(Error::EpochOutOfRange))
    );
    assert_eq!(
        t.c.try_challenge(&99, &d.bot, &0, &d.ch, &ev),
        Err(Ok(Error::CampaignNotFound))
    );
    let long = t.s(&"e".repeat(201));
    assert_eq!(
        t.c.try_challenge(&d.id, &d.good, &0, &d.ch, &long),
        Err(Ok(Error::InvalidParams))
    );
    assert_eq!(t.c.try_respond(&42), Err(Ok(Error::DisputeNotFound)));
    t.set_time(t.challenge_end(d.id, 0));
    assert_eq!(
        t.c.try_challenge(&d.id, &d.good, &0, &d.ch, &ev),
        Err(Ok(Error::WrongPhase))
    );
    // one dispute per clip-epoch, even after it is closed
    t.set_time(t.settle_at(d.id, 0));
    t.c.finalize_dispute(&dis);
    t.check_invariant();
}

#[test]
fn challenge_zero_weight_rejected() {
    let t = T::new();
    let mut p = t.params();
    p.epochs = 1;
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    let v = yt("zero");
    let c = t.register(id, &a, &v, &ca, 1_000);
    t.set_time(t.content_end(id, 0));
    t.close(id, c, 0, &v, &ca, 1_050); // growth 50 < min_views ⇒ weight 0
    t.set_time(t.proof_end(id, 0));
    let ch = Address::generate(&t.env);
    t.mint(&ch, 5 * USDC);
    assert_eq!(
        t.c.try_challenge(&id, &c, &0, &ch, &t.s("x")),
        Err(Ok(Error::NothingToClaim))
    );
    assert_eq!(t.token.balance(&ch), 5 * USDC);
}
