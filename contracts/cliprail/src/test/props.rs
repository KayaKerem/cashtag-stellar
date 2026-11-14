//! Property-based tests (proptest): escrow conservation against an independent model of the
//! payout math, replay protection, authorization and arithmetic edge cases.
//!
//! Case counts are kept moderate so the whole workspace `cargo test` stays fast; raise them
//! locally with `PROPTEST_CASES=<n>`.

use std::collections::BTreeMap;
use std::format;
use std::string::String as StdString;
use std::vec::Vec as SVec;

use proptest::prelude::*;
use proptest::test_runner::Config;
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{Address, Bytes, BytesN, Env, IntoVal, InvokeError, Symbol};

use super::setup::*;
use crate::dispute::dispute_fee;
use crate::epoch::{self, MAX_BUDGET, MAX_CAP_VIEWS, MAX_EPOCHS, MAX_RATE};
use crate::{CampaignParams, ClipEpochStatus, Error, EpochState, ParticipantEpoch};

fn cfg(cases: u32) -> Config {
    Config {
        cases: std::env::var("PROPTEST_CASES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(cases),
        failure_persistence: None,
        ..Config::default()
    }
}

/// Flattens a `try_*` result; a host error (trap / auth failure) becomes `Err(None)`.
fn flat<V, C: core::fmt::Debug>(
    r: Result<Result<V, C>, Result<Error, InvokeError>>,
) -> Result<V, Option<Error>> {
    match r {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => panic!("conversion error {e:?}"),
        Err(Ok(e)) => Err(Some(e)),
        Err(Err(_)) => Err(None),
    }
}

// =============================================================================================
// 1. Escrow conservation vs. an independent model
// =============================================================================================

/// What the clipper proves for one epoch.
#[derive(Clone, Debug)]
enum Obs {
    /// No close proof (video deleted / clipper absent).
    Skip,
    /// views = hwm + g, optionally a second proof (one second later) with views = baseline + g2.
    Up(u64, Option<u64>),
    /// views = hwm − d (a view drop).
    Down(u64),
}

/// Dispute played against a clip-epoch (only applied when its weight is > 0).
#[derive(Clone, Copy, Debug, PartialEq)]
enum Disp {
    None,
    /// challenger wins at `dispute_end` via `finalize_dispute`
    Unanswered,
    /// clipper responds, arbiter silent → clipper wins via `finalize_dispute` at `settle_at`
    RespondedSilent,
    /// clipper responds, arbiter rules (clipper_wins)
    Arbiter(bool),
}

#[derive(Clone, Debug)]
struct ClipPlan {
    owner: usize,
    base: u64,
    obs: SVec<Obs>,
    disp: SVec<Disp>,
    claim: SVec<bool>,
    claim_hb: SVec<bool>,
}

#[derive(Clone, Debug)]
struct Econ {
    budget: i128,
    rate_max: i128,
    cap_clip: u64,
    cap_human: u64,
    min_views: u64,
    holdback_bps: u32,
    bond: i128,
    epochs: u32,
}

fn econ() -> impl Strategy<Value = Econ> {
    (
        prop_oneof![
            1i128..=1_000,
            1i128..=1_000_000 * USDC,
            (MAX_BUDGET - 1_000)..=MAX_BUDGET
        ],
        prop_oneof![1i128..=10, 1i128..=10 * USDC, (MAX_RATE - 10)..=MAX_RATE],
        prop_oneof![0u64..=200, 0u64..=200_000, (MAX_CAP_VIEWS - 10)..=MAX_CAP_VIEWS],
        prop_oneof![0u64..=200, 0u64..=300_000, (MAX_CAP_VIEWS - 10)..=MAX_CAP_VIEWS],
        prop_oneof![Just(0u64), 0u64..=300],
        prop_oneof![Just(0u32), Just(10_000u32), 0u32..=10_000],
        1i128..=10 * USDC,
        1u32..=3,
    )
        .prop_map(
            |(budget, rate_max, cap_clip, cap_human, min_views, holdback_bps, bond, epochs)| Econ {
                budget,
                rate_max,
                cap_clip,
                cap_human,
                min_views,
                holdback_bps,
                bond,
                epochs,
            },
        )
}

fn growth() -> impl Strategy<Value = u64> {
    prop_oneof![0u64..=300, 0u64..=300_000, 0u64..=2 * MAX_CAP_VIEWS]
}

fn obs() -> impl Strategy<Value = Obs> {
    prop_oneof![
        1 => Just(Obs::Skip),
        4 => (growth(), proptest::option::of(growth())).prop_map(|(g, g2)| Obs::Up(g, g2)),
        1 => (0u64..=100_000).prop_map(Obs::Down),
    ]
}

fn disp() -> impl Strategy<Value = Disp> {
    prop_oneof![
        6 => Just(Disp::None),
        1 => Just(Disp::Unanswered),
        1 => Just(Disp::RespondedSilent),
        1 => any::<bool>().prop_map(Disp::Arbiter),
    ]
}

fn plans(epochs: u32) -> impl Strategy<Value = (usize, SVec<ClipPlan>)> {
    let e = epochs as usize;
    (1usize..=3).prop_flat_map(move |n_part| {
        let clip = (
            0..n_part,
            prop_oneof![3 => 0u64..=1_000_000_000, 1 => (u64::MAX - 1_000_000)..=u64::MAX],
            proptest::collection::vec(obs(), e),
            proptest::collection::vec(disp(), e),
            proptest::collection::vec(prop::bool::weighted(0.85), e),
            proptest::collection::vec(prop::bool::weighted(0.85), e),
        )
            .prop_map(|(owner, base, obs, disp, claim, claim_hb)| ClipPlan {
                owner,
                base,
                obs,
                disp,
                claim,
                claim_hb,
            });
        (Just(n_part), proptest::collection::vec(clip, 1..=4))
    })
}

fn scenario() -> impl Strategy<Value = (Econ, usize, SVec<ClipPlan>)> {
    econ().prop_flat_map(|ec| {
        let e = ec.epochs;
        (Just(ec), plans(e)).prop_map(|(ec, (n, cl))| (ec, n, cl))
    })
}

/// Model state of one clip-epoch.
#[derive(Clone, Debug, Default)]
struct MCe {
    proved: bool,
    baseline: u64,
    views: u64,
    weight: u64,
    excluded: bool,
}

/// pay = r · w_p · w_clip / (raw_p · 1000), re-stated independently of `epoch::clip_pay`.
fn m_pay(rate: i128, raw: u64, wp: u64, w: u64) -> i128 {
    if raw == 0 || w == 0 {
        return 0;
    }
    rate * wp as i128 * w as i128 / (raw as i128 * 1000)
}

fn m_held(pay: i128, bps: i128) -> i128 {
    // ceil(pay·bps/10000)
    (pay * bps + 9_999) / 10_000
}

fn run_conservation(ec: &Econ, n_part: usize, plans: &[ClipPlan]) {
    let t = T::new();
    let mut p = t.params();
    p.budget = ec.budget;
    p.rate_max_per_1k = ec.rate_max;
    p.cap_views_clip = ec.cap_clip;
    p.cap_views_human = ec.cap_human;
    p.min_views = ec.min_views;
    p.holdback_bps = ec.holdback_bps;
    p.bond = ec.bond;
    p.epochs = ec.epochs;
    t.mint(&t.brand, ec.budget);
    let brand_before = t.token.balance(&t.brand);
    let id = t.create(&p);
    assert_eq!(t.token.balance(&t.brand), brand_before - ec.budget);
    let p = t.campaign(id).params;
    let n_ep = ec.epochs as usize;
    let last = n_ep - 1;

    let parts: SVec<(Address, StdString)> = (0..n_part).map(|_| t.join(id)).collect();
    let mut clip_ids = SVec::new();
    let mut videos = SVec::new();
    let mut hwm = SVec::new();
    for (i, cp) in plans.iter().enumerate() {
        let v = yt(&format!("c{i}"));
        let (who, code) = &parts[cp.owner];
        clip_ids.push(t.register(id, who, &v, code, cp.base));
        videos.push(v);
        hwm.push(cp.base);
    }
    t.check_invariant();

    let mut m: SVec<SVec<MCe>> = vec_of(plans.len(), n_ep);
    let mut bonds_to_owner: BTreeMap<usize, i128> = BTreeMap::new();
    let mut m_epochs: SVec<EpochState> = SVec::new();
    let mut carry: i128 = 0;

    for e in 0..n_ep {
        let eu = e as u32;
        // ---- close proofs
        t.set_time(t.content_end(id, eu));
        let mut seconds = SVec::new();
        for (i, cp) in plans.iter().enumerate() {
            let (_, code) = &parts[cp.owner];
            let ce = &mut m[i][e];
            ce.baseline = hwm[i];
            let v1 = match cp.obs[e] {
                Obs::Skip => continue,
                Obs::Up(g, g2) => {
                    if let Some(g2) = g2 {
                        seconds.push((i, ce.baseline.saturating_add(g2)));
                    }
                    hwm[i].saturating_add(g)
                }
                Obs::Down(d) => hwm[i].saturating_sub(d),
            };
            t.close(id, clip_ids[i], eu, &videos[i], code, v1);
            ce.proved = true;
            ce.views = ce.views.max(v1);
            hwm[i] = hwm[i].max(v1);
        }
        if !seconds.is_empty() {
            t.set_time(t.content_end(id, eu) + 1);
            for (i, v2) in seconds {
                let (_, code) = &parts[plans[i].owner];
                t.close(id, clip_ids[i], eu, &videos[i], code, v2);
                let ce = &mut m[i][e];
                ce.views = ce.views.max(v2);
                hwm[i] = hwm[i].max(v2);
            }
        }
        for (i, _) in plans.iter().enumerate() {
            let ce = &mut m[i][e];
            if ce.proved {
                ce.weight = m_weight(&p, ce.baseline, ce.views);
                let got = t.c.get_clip_epoch(&clip_ids[i], &eu).unwrap();
                assert_eq!(got.weight, ce.weight, "clip {i} epoch {e} weight");
                assert_eq!(got.baseline, ce.baseline, "clip {i} epoch {e} baseline");
            } else {
                assert!(t.c.get_clip_epoch(&clip_ids[i], &eu).is_none());
            }
        }
        t.check_invariant();

        // ---- disputes
        t.set_time(t.proof_end(id, eu));
        let mut dis: SVec<(usize, u64, Disp, Address)> = SVec::new();
        for (i, cp) in plans.iter().enumerate() {
            if cp.disp[e] == Disp::None {
                continue;
            }
            let ch = Address::generate(&t.env);
            t.mint(&ch, p.bond);
            let r = flat(t.c.try_challenge(&id, &clip_ids[i], &eu, &ch, &t.s("ev")));
            if m[i][e].weight == 0 {
                assert_eq!(r, Err(Some(Error::NothingToClaim)), "challenge weight 0");
                continue;
            }
            dis.push((i, r.unwrap(), cp.disp[e], ch));
        }
        t.check_invariant();
        t.set_time(t.proof_end(id, eu) + 1);
        for (_, d, kind, _) in dis.iter() {
            if *kind != Disp::Unanswered {
                t.c.respond(d);
            }
        }
        t.set_time(t.dispute_end(id, eu));
        for (i, d, kind, ch) in dis.iter() {
            match kind {
                Disp::Unanswered => {
                    t.c.finalize_dispute(d);
                }
                Disp::Arbiter(cw) => {
                    t.c.resolve(d, cw);
                }
                _ => continue,
            }
            let clipper_wins = *kind == Disp::Arbiter(true);
            if clipper_wins {
                *bonds_to_owner.entry(plans[*i].owner).or_default() += p.bond - dispute_fee(p.bond);
            } else {
                m[*i][e].excluded = true;
                assert_eq!(t.paid(ch), p.bond - dispute_fee(p.bond), "bond back to challenger, minus fee");
            }
        }
        t.check_invariant();
        // finalize a still-open dispute early is impossible
        for (_, d, kind, _) in dis.iter() {
            if *kind == Disp::RespondedSilent {
                assert_eq!(
                    flat(t.c.try_finalize_dispute(d)),
                    Err(Some(Error::WrongPhase))
                );
            }
        }

        // ---- settle
        t.set_time(t.settle_at(id, eu));
        // settling with unresolved disputes must fail
        if dis.iter().any(|(_, _, k, _)| *k == Disp::RespondedSilent) {
            assert_eq!(
                flat(t.c.try_settle_epoch(&id, &eu)),
                Err(Some(Error::OpenDisputes))
            );
        }
        for (i, d, kind, _) in dis.iter() {
            if *kind == Disp::RespondedSilent {
                t.c.finalize_dispute(d);
                *bonds_to_owner.entry(plans[*i].owner).or_default() += p.bond - dispute_fee(p.bond);
            }
        }
        t.c.settle_epoch(&id, &eu);
        assert_eq!(
            flat(t.c.try_settle_epoch(&id, &eu)),
            Err(Some(Error::AlreadySettled))
        );
        t.check_invariant();

        // ---- model settlement
        let mut raw = vec![0u64; n_part];
        for (i, cp) in plans.iter().enumerate() {
            let ce = &m[i][e];
            if ce.proved && !ce.excluded {
                raw[cp.owner] += ce.weight;
            }
        }
        let w_tot: u64 = raw.iter().map(|r| (*r).min(p.cap_views_human)).sum();
        let base = p.budget / p.epochs as i128
            + if e == last {
                p.budget % p.epochs as i128
            } else {
                0
            };
        let budget_e = base + carry;
        let rate = if w_tot == 0 {
            0
        } else {
            (budget_e * 1000 / w_tot as i128).min(p.rate_max_per_1k)
        };
        let spent = rate * w_tot as i128 / 1000;
        let bps = if e == last { 0 } else { p.holdback_bps as i128 };
        let held_total = spent * bps / 10_000;
        let got = t.c.get_epoch(&id, &eu);
        assert!(got.settled);
        assert_eq!(got.total_weight, w_tot, "epoch {e} W");
        assert_eq!(got.budget, budget_e, "epoch {e} budget");
        assert_eq!(got.rate, rate, "epoch {e} rate");
        assert_eq!(got.spent, spent, "epoch {e} spent");
        assert_eq!(got.held_total, held_total, "epoch {e} held_total");
        assert_eq!(got.open_disputes, 0);
        // core budget invariants
        assert!(0 <= rate && rate <= p.rate_max_per_1k);
        assert!(0 <= spent && spent <= budget_e, "spent > epoch budget");
        assert!(0 <= held_total && held_total <= spent);
        carry = budget_e - spent;
        assert!(carry >= 0);
        m_epochs.push(got);
        let _ = raw;
    }

    // ---- model payouts (over ALL clips, claimed or not)
    let mut raw_of = vec_of_u64(n_ep, n_part);
    for (i, cp) in plans.iter().enumerate() {
        for e in 0..n_ep {
            let ce = &m[i][e];
            if ce.proved && !ce.excluded {
                raw_of[e][cp.owner] += ce.weight;
            }
        }
    }
    let mut pay = vec_of_i128(plans.len(), n_ep);
    let mut held = vec_of_i128(plans.len(), n_ep);
    let mut alive = vec![vec![false; n_ep]; plans.len()];
    for (i, cp) in plans.iter().enumerate() {
        for e in 0..n_ep {
            let ce = &m[i][e];
            if !ce.proved || ce.excluded {
                continue;
            }
            let raw = raw_of[e][cp.owner];
            let wp = raw.min(p.cap_views_human);
            pay[i][e] = m_pay(m_epochs[e].rate, raw, wp, ce.weight);
            let bps = if e == last { 0 } else { p.holdback_bps as i128 };
            held[i][e] = m_held(pay[i][e], bps);
            alive[i][e] = e < last && ce.weight > 0 && m[i][e + 1].proved;
        }
    }
    for e in 0..n_ep {
        let sum_pay: i128 = (0..plans.len()).map(|i| pay[i][e]).sum();
        assert!(sum_pay <= m_epochs[e].spent, "Σ pay > spent (epoch {e})");
        if e < last {
            let surv: i128 = (0..plans.len()).filter(|&i| alive[i][e]).map(|i| held[i][e]).sum();
            assert_eq!(m_epochs[e].held_survived, 0, "held_survived read before final");
            let got = t.c.get_epoch(&id, &(e as u32));
            assert_eq!(got.held_survived, surv, "epoch {e} held_survived");
            // Σ immediate + Σ survivor shares ≤ spent
            let imm: i128 = (0..plans.len()).map(|i| pay[i][e] - held[i][e]).sum();
            let shares: i128 = if surv == 0 {
                0
            } else {
                (0..plans.len())
                    .filter(|&i| alive[i][e])
                    .map(|i| held[i][e] * got.held_total / surv)
                    .sum()
            };
            assert!(imm + shares <= got.spent, "epoch {e} overpays");
        }
    }

    // ---- claims (all at settle_at(last), before refund_at)
    let mut paid: i128 = 0;
    let mut paid_to: BTreeMap<usize, i128> = BTreeMap::new();
    for (i, cp) in plans.iter().enumerate() {
        for e in 0..n_ep {
            let eu = e as u32;
            let ce = &m[i][e];
            if cp.claim[e] {
                let r = flat(t.c.try_claim(&id, &clip_ids[i], &eu));
                let expect = if !ce.proved {
                    Err(Some(Error::NothingToClaim))
                } else if ce.excluded {
                    Err(Some(Error::Excluded))
                } else if pay[i][e] == 0 {
                    Err(Some(Error::NothingToClaim))
                } else {
                    Ok(pay[i][e] - held[i][e])
                };
                assert_eq!(r, expect, "claim clip {i} epoch {e}");
                if let Ok(a) = r {
                    assert!(a >= 0);
                    paid += a;
                    *paid_to.entry(cp.owner).or_default() += a;
                    assert_eq!(
                        flat(t.c.try_claim(&id, &clip_ids[i], &eu)),
                        Err(Some(Error::AlreadyClaimed))
                    );
                }
            }
            if e < last && cp.claim_hb[e] {
                let st = t.c.get_epoch(&id, &eu);
                let r = flat(t.c.try_claim_holdback(&id, &clip_ids[i], &eu));
                let share = if st.held_survived == 0 {
                    0
                } else {
                    held[i][e] * st.held_total / st.held_survived
                };
                let expect = if !ce.proved {
                    Err(Some(Error::NothingToClaim))
                } else if ce.excluded {
                    Err(Some(Error::Excluded))
                } else if !alive[i][e] || st.held_survived == 0 || share == 0 {
                    Err(Some(Error::NothingToClaim))
                } else {
                    Ok(share)
                };
                assert_eq!(r, expect, "holdback clip {i} epoch {e}");
                if let Ok(a) = r {
                    paid += a;
                    *paid_to.entry(cp.owner).or_default() += a;
                    assert_eq!(
                        flat(t.c.try_claim_holdback(&id, &clip_ids[i], &eu)),
                        Err(Some(Error::AlreadyClaimed))
                    );
                }
            }
            t.check_invariant();
        }
    }
    assert!(paid <= p.budget);
    assert_eq!(t.campaign(id).balance, p.budget - paid, "ledger balance");

    // ---- refund
    t.set_time(t.refund_at(id));
    let refunded = t.c.refund(&id);
    assert_eq!(refunded, p.budget - paid);
    assert_eq!(paid + refunded, p.budget, "conservation");
    assert_eq!(t.campaign(id).balance, 0);
    // dispute payouts are pull payments: every recipient withdraws what it is owed
    for d in t.c.list_disputes(&id).iter() {
        let owner = t.c.get_clip(&d.clip_id).owner;
        for who in [p.arbiter.clone(), d.challenger.clone(), owner] {
            let owed = t.c.owed(&who, &t.token.address);
            if owed > 0 {
                let before = t.token.balance(&who);
                assert_eq!(t.c.withdraw(&who, &t.token.address), owed);
                assert_eq!(t.token.balance(&who), before + owed);
                assert_eq!(flat(t.c.try_withdraw(&who, &t.token.address)), Err(Some(Error::NothingToClaim)));
            }
        }
    }
    assert_eq!(t.token.balance(&t.c.address), 0, "contract drained");
    assert_eq!(t.token.balance(&t.brand), brand_before - p.budget + refunded);
    for (k, (who, _)) in parts.iter().enumerate() {
        let exp = paid_to.get(&k).copied().unwrap_or(0) + bonds_to_owner.get(&k).copied().unwrap_or(0);
        assert_eq!(t.paid(who), exp, "participant {k} balance");
    }
    // nothing more can leave
    assert_eq!(flat(t.c.try_refund(&id)), Err(Some(Error::AlreadyRefunded)));
    for (i, _) in plans.iter().enumerate() {
        for e in 0..n_ep as u32 {
            assert_eq!(
                flat(t.c.try_claim(&id, &clip_ids[i], &e)),
                Err(Some(Error::WrongPhase))
            );
        }
    }
    t.check_invariant();
}

/// Campaign params without deploying anything (for the pure-math properties).
fn bare_params(env: &Env) -> CampaignParams {
    CampaignParams {
        token: Address::generate(env),
        budget: 1000 * USDC,
        rate_max_per_1k: USDC,
        cap_views_clip: 50_000,
        cap_views_human: 100_000,
        min_views: 100,
        start: 0,
        epoch_len: 300,
        epochs: 2,
        proof_window: 90,
        dispute_window: 90,
        arbiter_window: 60,
        claim_grace: 300,
        holdback_bps: 2000,
        bond: 5 * USDC,
        arbiter: Address::generate(env),
        platforms: soroban_sdk::Vec::new(env),
        require_humanity: false,
        title: soroban_sdk::String::from_str(env, ""),
        brief_url: soroban_sdk::String::from_str(env, ""),
    }
}

fn m_weight(p: &CampaignParams, baseline: u64, views: u64) -> u64 {
    if views < baseline {
        return 0;
    }
    let w = (views - baseline).min(p.cap_views_clip);
    if w < p.min_views {
        0
    } else {
        w
    }
}

fn vec_of(n: usize, e: usize) -> SVec<SVec<MCe>> {
    (0..n).map(|_| vec![MCe::default(); e]).collect()
}
fn vec_of_u64(e: usize, n: usize) -> SVec<SVec<u64>> {
    (0..e).map(|_| vec![0u64; n]).collect()
}
fn vec_of_i128(n: usize, e: usize) -> SVec<SVec<i128>> {
    (0..n).map(|_| vec![0i128; e]).collect()
}

// `vec!` from soroban_sdk shadows std's; use std's explicitly in this module.
use std::vec;

proptest! {
    #![proptest_config(cfg(24))]

    /// Random campaigns × random clip/view/dispute/claim histories: every settled epoch, claim,
    /// holdback share and the final refund match an independent model exactly;
    /// paid + refunded == deposited; spent ≤ epoch budget; contract balance == Σ ledgers + bonds.
    #[test]
    fn prop_escrow_conservation((ec, n, plans) in scenario()) {
        run_conservation(&ec, n, &plans);
    }
}

// =============================================================================================
// 2. Pure payout math at the extremes allowed by `validate_params`
// =============================================================================================

proptest! {
    #![proptest_config(cfg(512))]

    /// rate ≤ r_max, spent ≤ budget, held ≤ spent; no overflow at the validated maxima
    /// (incl. carry, which at most doubles the epoch budget).
    #[test]
    fn prop_settlement_math_bounded(
        budget in prop_oneof![1i128..=1_000, 1i128..=MAX_BUDGET, Just(MAX_BUDGET)],
        rmax in prop_oneof![1i128..=10, 1i128..=MAX_RATE, Just(MAX_RATE)],
        epochs in 1u32..=MAX_EPOCHS,
        e_sel in any::<u32>(),
        carry_frac in 0u32..=100,
        w in prop_oneof![Just(0u64), 1u64..=10, 1u64..=MAX_CAP_VIEWS, 1u64..=u64::MAX / 2, Just(u64::MAX)],
        bps in 0u32..=10_000,
    ) {
        let env = Env::default();
        let mut p = bare_params(&env);
        p.budget = budget;
        p.rate_max_per_1k = rmax;
        p.epochs = epochs;
        p.holdback_bps = bps;
        let e = e_sel % epochs;
        let carry = budget * carry_frac as i128 / 100;
        let mut st = EpochState { total_weight: w, ..Default::default() };
        epoch::compute_settlement(&p, &mut st, carry, e);
        let b = epoch::base_budget(&p, e) + carry;
        prop_assert_eq!(st.budget, b);
        prop_assert!(st.rate >= 0 && st.rate <= rmax);
        prop_assert!(st.spent >= 0 && st.spent <= b, "spent {} > budget {}", st.spent, b);
        prop_assert!(st.held_total >= 0 && st.held_total <= st.spent);
        if w == 0 { prop_assert_eq!(st.rate, 0); prop_assert_eq!(st.spent, 0); }
        // base budgets sum to the whole budget
        let total: i128 = (0..epochs).map(|k| epoch::base_budget(&p, k)).sum();
        prop_assert_eq!(total, budget);
    }

    /// Σ clip_pay over a participant's clips ≤ r·w_p/1000 and held ≤ pay, at the extremes
    /// (rate ≤ MAX_RATE, weights ≤ MAX_CAP_VIEWS).
    #[test]
    fn prop_clip_pay_bounded(
        rate in prop_oneof![Just(0i128), 1i128..=MAX_RATE, Just(MAX_RATE)],
        ws in proptest::collection::vec(prop_oneof![0u64..=1_000, 0u64..=MAX_CAP_VIEWS, Just(MAX_CAP_VIEWS)], 1..6),
        cap_h in prop_oneof![0u64..=1_000, 0u64..=MAX_CAP_VIEWS, Just(MAX_CAP_VIEWS)],
        bps in 0u32..=10_000,
    ) {
        let env = Env::default();
        let mut p = bare_params(&env);
        p.holdback_bps = bps;
        p.epochs = 2;
        let raw: u64 = ws.iter().sum();
        let pe = ParticipantEpoch { raw, weight: raw.min(cap_h) };
        let mut sum = 0i128;
        for w in ws.iter() {
            let pay = epoch::clip_pay(rate, &pe, *w);
            prop_assert!(pay >= 0);
            let h = epoch::held_of(&p, 0, pay);
            prop_assert!(0 <= h && h <= pay);
            prop_assert_eq!(epoch::held_of(&p, 1, pay), 0);
            sum += pay;
        }
        prop_assert!(sum <= rate * pe.weight as i128 / 1000);
    }

    /// clip_weight: ≤ cap, 0 below min_views or on a drop, never panics for any u64.
    #[test]
    fn prop_clip_weight_total(baseline in any::<u64>(), views in any::<u64>(),
                              cap in any::<u64>(), min in any::<u64>()) {
        let env = Env::default();
        let mut p = bare_params(&env);
        p.cap_views_clip = cap;
        p.min_views = min;
        let w = epoch::clip_weight(&p, baseline, views);
        prop_assert!(w <= cap);
        if views < baseline { prop_assert_eq!(w, 0); }
        if w > 0 { prop_assert!(w >= min && w <= views - baseline); }
    }
}

// =============================================================================================
// 3. Parameter validation never traps on extreme values
// =============================================================================================

fn extreme_i128() -> impl Strategy<Value = i128> {
    prop_oneof![
        Just(i128::MIN),
        Just(-1i128),
        Just(0i128),
        Just(1i128),
        Just(i128::MAX),
        any::<i128>(),
        1i128..=MAX_BUDGET + 1
    ]
}
fn extreme_u64() -> impl Strategy<Value = u64> {
    prop_oneof![Just(0u64), Just(1u64), Just(u64::MAX), Just(u64::MAX - 1), any::<u64>(), 0u64..=1_000]
}

proptest! {
    #![proptest_config(cfg(128))]

    /// `create_campaign` with arbitrary numeric params returns Ok or a contract error
    /// (InvalidParams), never a host trap; on Ok the escrow holds exactly `budget`.
    #[test]
    fn prop_create_campaign_extremes(
        budget in extreme_i128(), rate in extreme_i128(), bond in extreme_i128(),
        cap_c in extreme_u64(), cap_h in extreme_u64(),
        start_off in extreme_u64(), epoch_len in extreme_u64(),
        pw in extreme_u64(), dw in extreme_u64(), aw in extreme_u64(), grace in extreme_u64(),
        epochs in prop_oneof![Just(0u32), Just(1u32), Just(MAX_EPOCHS), Just(MAX_EPOCHS + 1), Just(u32::MAX), any::<u32>()],
        bps in prop_oneof![Just(0u32), Just(10_000u32), Just(10_001u32), Just(u32::MAX)],
    ) {
        let t = T::new();
        let mut p = t.params();
        p.budget = budget;
        p.rate_max_per_1k = rate;
        p.bond = bond;
        p.cap_views_clip = cap_c;
        p.cap_views_human = cap_h;
        p.start = t.now().saturating_add(start_off);
        p.epoch_len = epoch_len;
        p.proof_window = pw;
        p.dispute_window = dw;
        p.arbiter_window = aw;
        p.claim_grace = grace;
        p.epochs = epochs;
        p.holdback_bps = bps;
        if budget > 0 && budget <= MAX_BUDGET {
            t.mint(&t.brand, budget);
        }
        let before = t.token.balance(&t.c.address);
        let r = flat(t.c.try_create_campaign(&t.brand, &p));
        match r {
            Ok(id) => {
                prop_assert!(budget > 0 && budget <= MAX_BUDGET);
                prop_assert!(rate > 0 && rate <= MAX_RATE && bond > 0);
                prop_assert!(epochs >= 1 && epochs <= MAX_EPOCHS && bps <= 10_000);
                prop_assert_eq!(t.token.balance(&t.c.address), before + budget);
                prop_assert_eq!(t.campaign(id).balance, budget);
                // the whole timeline fits in u64 (refund_at computable)
                let c = t.campaign(id);
                let _ = epoch::refund_at(&c.params);
            }
            Err(Some(e)) => prop_assert_eq!(e, Error::InvalidParams),
            Err(None) => prop_assert!(false, "host trap in create_campaign: {:?}", p),
        }
    }
}

// =============================================================================================
// 4. Replay protection
// =============================================================================================

proptest! {
    #![proptest_config(cfg(16))]

    /// A proof accepted once (as opening or closing proof) is rejected everywhere afterwards:
    /// same clip/epoch, another clip, another epoch, or as a registration. An opening proof
    /// whose timestamp is inside the close window of epoch 0 cannot double as the close proof.
    #[test]
    fn prop_proof_replay_rejected(
        views in prop_oneof![0u64..=10_000, Just(u64::MAX)],
        growth in 100u64..=100_000,
        reg_before_end in 1u64..=59,
    ) {
        let t = T::new();
        let mut p = t.params();
        p.epochs = 2;
        let id = t.create(&p);
        let (a, ca) = t.join(id);
        let (b, cb) = t.join(id);
        let va = yt("rpa");
        let vb = yt("rpb");
        let clip_b = t.register(id, &b, &vb, &cb, 0);
        // register `a` shortly before content_end(0): its opening proof is within CLOSE_SLACK
        t.set_time(t.content_end(id, 0) - reg_before_end);
        let open = t.yt_proof(&va, &ca, views);
        let clip_a = t.c.register_clip(&id, &a, &t.sym("youtube"), &t.s(&va), &open);
        t.set_time(t.content_end(id, 0));
        prop_assert_eq!(
            flat(t.c.try_submit_proof(&id, &clip_a, &0, &open)),
            Err(Some(Error::ProofReused))
        );
        let close = t.yt_proof(&va, &ca, views.saturating_add(growth));
        t.c.submit_proof(&id, &clip_a, &0, &close);
        let w0 = t.c.get_clip_epoch(&clip_a, &0).unwrap();
        prop_assert_eq!(
            flat(t.c.try_submit_proof(&id, &clip_a, &0, &close)),
            Err(Some(Error::ProofReused))
        );
        // another clip / another participant's code → rejected before or at replay check
        let r = flat(t.c.try_submit_proof(&id, &clip_b, &0, &close));
        prop_assert!(r.is_err(), "proof accepted for another clip");
        // as a registration of a fresh video (different URL) → rejected
        let vc = yt("rpc");
        let r = flat(t.c.try_register_clip(&id, &a, &t.sym("youtube"), &t.s(&vc), &close));
        prop_assert!(r.is_err());
        // next epoch, same proof bytes (timestamp now too old for the window)
        t.set_time(t.settle_at(id, 0));
        t.c.settle_epoch(&id, &0);
        t.set_time(t.content_end(id, 1));
        let r = flat(t.c.try_submit_proof(&id, &clip_a, &1, &close));
        prop_assert!(r.is_err());
        // state untouched by the rejected attempts
        prop_assert_eq!(t.c.get_clip_epoch(&clip_a, &0).unwrap(), w0);
        prop_assert!(t.c.get_clip_epoch(&clip_a, &1).is_none());
        t.check_invariant();
    }
}

// =============================================================================================
// 5. Malformed proofs through the contract: always a clean contract error, never accepted
// =============================================================================================

#[derive(Clone, Debug)]
enum Mutation {
    ParamsByte(usize, u8),
    ContextByte(usize, u8),
    OwnerByte(usize, u8),
    SigByte(usize, u8),
    RecId(u32),
    Timestamp(u64),
    Epoch(u32),
    TruncParams(usize),
    TruncContext(usize),
}

fn mutation() -> impl Strategy<Value = Mutation> {
    prop_oneof![
        (any::<usize>(), 1u8..=255).prop_map(|(i, x)| Mutation::ParamsByte(i, x)),
        (any::<usize>(), 1u8..=255).prop_map(|(i, x)| Mutation::ContextByte(i, x)),
        (any::<usize>(), 1u8..=255).prop_map(|(i, x)| Mutation::OwnerByte(i, x)),
        (0usize..64, 1u8..=255).prop_map(|(i, x)| Mutation::SigByte(i, x)),
        (2u32..=u32::MAX).prop_map(Mutation::RecId),
        any::<u64>().prop_map(Mutation::Timestamp),
        any::<u32>().prop_map(Mutation::Epoch),
        any::<usize>().prop_map(Mutation::TruncParams),
        any::<usize>().prop_map(Mutation::TruncContext),
    ]
}

fn xor_at(env: &soroban_sdk::Env, b: &Bytes, i: usize, x: u8) -> Bytes {
    let mut v: SVec<u8> = b.iter().collect();
    if v.is_empty() {
        return Bytes::from_slice(env, &[x]);
    }
    let k = i % v.len();
    v[k] ^= x;
    Bytes::from_slice(env, &v)
}

proptest! {
    #![proptest_config(cfg(96))]

    /// Any single mutation of a valid opening proof is rejected by `register_clip`. A
    /// signature-byte mutation may hit the documented host trap (secp256k1 recovery of an
    /// in-range but unrecoverable r); everything else must be a clean contract error.
    #[test]
    fn prop_mutated_proof_rejected(m in mutation()) {
        let t = T::new();
        let id = t.create(&t.params());
        let (a, ca) = t.join(id);
        let v = yt("mut");
        let mut pr = t.yt_proof(&v, &ca, 1_000);
        match m.clone() {
            Mutation::ParamsByte(i, x) => pr.parameters = xor_at(&t.env, &pr.parameters, i, x),
            Mutation::ContextByte(i, x) => pr.context = xor_at(&t.env, &pr.context, i, x),
            Mutation::OwnerByte(i, x) => pr.owner = xor_at(&t.env, &pr.owner, i, x),
            Mutation::SigByte(i, x) => {
                let mut s = pr.signature.to_array();
                s[i] ^= x;
                pr.signature = BytesN::from_array(&t.env, &s);
            }
            Mutation::RecId(r) => pr.recovery_id = r,
            Mutation::Timestamp(ts) => { if ts == pr.timestamp_s { return Ok(()); } pr.timestamp_s = ts }
            Mutation::Epoch(e) => { if e == pr.epoch { return Ok(()); } pr.epoch = e }
            Mutation::TruncParams(n) => { let l = pr.parameters.len(); pr.parameters = pr.parameters.slice(0..(n as u32 % l)) }
            Mutation::TruncContext(n) => { let l = pr.context.len(); pr.context = pr.context.slice(0..(n as u32 % l)) }
        }
        let r = flat(t.c.try_register_clip(&id, &a, &t.sym("youtube"), &t.s(&v), &pr));
        prop_assert!(r.is_err(), "mutated proof accepted: {:?}", m);
        if r == Err(None) {
            prop_assert!(matches!(m, Mutation::SigByte(..)), "host trap on {:?}", m);
        }
        prop_assert_eq!(t.campaign(id).clips, 0);
    }
}

// =============================================================================================
// 6. Authorization: every privileged entry point rejects anyone but its rightful signer
// =============================================================================================

#[derive(Clone, Copy, Debug)]
enum Role {
    Admin,
    Brand,
    Arbiter,
    Clipper,
    Challenger,
    Stranger,
}

fn role() -> impl Strategy<Value = Role> {
    prop_oneof![
        Just(Role::Admin),
        Just(Role::Brand),
        Just(Role::Arbiter),
        Just(Role::Clipper),
        Just(Role::Challenger),
        Just(Role::Stranger),
    ]
}

proptest! {
    #![proptest_config(cfg(24))]

    #[test]
    fn prop_privileged_calls_need_rightful_auth(attacker in role(), f in 0usize..10) {
        let t = T::new();
        // two epochs: join / register stay open while epoch 0 is in its dispute phase
        let p = t.params();
        let id = t.create(&p);
        let (a, ca) = t.join(id);
        let v = yt("auth");
        let clip = t.register(id, &a, &v, &ca, 0);
        t.set_time(t.content_end(id, 0));
        t.close(id, clip, 0, &v, &ca, 10_000);
        t.set_time(t.proof_end(id, 0));
        let ch = Address::generate(&t.env);
        t.mint(&ch, p.bond);
        let stranger = Address::generate(&t.env);
        let newbie = t.human(id);
        let env = &t.env;

        let who = match attacker {
            Role::Admin => t.admin.clone(),
            Role::Brand => t.brand.clone(),
            Role::Arbiter => t.arbiter.clone(),
            Role::Clipper => a.clone(),
            Role::Challenger => ch.clone(),
            Role::Stranger => stranger.clone(),
        };
        let attestors = soroban_sdk::vec![env, BytesN::from_array(env, &[7u8; 20])];
        let owners = soroban_sdk::vec![env, Bytes::from_slice(env, b"0xevil")];
        let sym = Symbol::new(env, "evil");
        let empty = Bytes::new(env);
        let req: soroban_sdk::Vec<Bytes> = soroban_sdk::Vec::new(env);
        let ev = t.s("ev");
        let p2 = { let mut q = t.params(); q.start = t.now() + 10; q };
        let open_proof = t.yt_proof(&yt("auth2"), &ca, 0);
        let yt_sym = t.sym("youtube");
        let v2 = t.s(&yt("auth2"));

        // (fn name, args, rightful signer)
        let (name, args, rightful): (&str, soroban_sdk::Vec<soroban_sdk::Val>, Address) = match f {
            0 => ("set_attestors", (attestors.clone(),).into_val(env), t.admin.clone()),
            1 => ("set_owners", (owners.clone(),).into_val(env), t.admin.clone()),
            2 => ("set_platform", (sym.clone(), empty.clone(), empty.clone(), req.clone()).into_val(env), t.admin.clone()),
            3 => ("set_router", (stranger.clone(),).into_val(env), t.admin.clone()),
            4 => ("create_campaign", (t.brand.clone(), p2.clone()).into_val(env), t.brand.clone()),
            5 => ("join", (id, newbie.clone()).into_val(env), newbie.clone()),
            6 => ("register_clip", (id, a.clone(), yt_sym.clone(), v2.clone(), open_proof.clone()).into_val(env), a.clone()),
            7 => ("challenge", (id, clip, 0u32, ch.clone(), ev.clone()).into_val(env), ch.clone()),
            8 => ("respond", (1u64,).into_val(env), a.clone()),
            _ => ("resolve", (1u64, false).into_val(env), t.arbiter.clone()),
        };
        // states that respond / resolve need
        if f == 8 || f == 9 {
            t.c.challenge(&id, &clip, &0, &ch, &ev);
        }
        if f == 9 {
            t.c.respond(&1);
            t.set_time(t.dispute_end(id, 0));
        }
        let attacker_is_rightful = who == rightful;
        let call = |sign_as: &Address| -> Result<(), Option<Error>> {
            let auths = [MockAuth {
                address: sign_as,
                invoke: &MockAuthInvoke {
                    contract: &t.c.address,
                    fn_name: name,
                    args: args.clone(),
                    sub_invokes: &[],
                },
            }];
            let c = t.c.mock_auths(&auths);
            match f {
                0 => flat(c.try_set_attestors(&attestors)),
                1 => flat(c.try_set_owners(&owners)),
                2 => flat(c.try_set_platform(&sym, &empty, &empty, &req)),
                3 => flat(c.try_set_router(&stranger)),
                4 => flat(c.try_create_campaign(&t.brand, &p2)).map(|_| ()),
                5 => flat(c.try_join(&id, &newbie)).map(|_| ()),
                6 => flat(c.try_register_clip(&id, &a, &yt_sym, &v2, &open_proof)).map(|_| ()),
                7 => flat(c.try_challenge(&id, &clip, &0, &ch, &ev)).map(|_| ()),
                8 => flat(c.try_respond(&1)),
                _ => flat(c.try_resolve(&1, &false)),
            }
        };
        if !attacker_is_rightful {
            let r = call(&who);
            prop_assert_eq!(r, Err(None), "{} accepted signature of {:?}", name, attacker);
            // state unchanged
            match f {
                3 => prop_assert!(t.c.router().is_none()),
                4 => prop_assert_eq!(t.c.campaign_count(), 1),
                5 => prop_assert!(t.c.get_participant(&id, &newbie).is_none()),
                6 => prop_assert_eq!(t.campaign(id).clips, 1),
                7 => prop_assert_eq!(t.c.get_epoch(&id, &0).open_disputes, 0),
                8 => prop_assert_eq!(t.c.get_clip_epoch(&clip, &0).unwrap().status, ClipEpochStatus::Challenged),
                9 => prop_assert_eq!(t.c.get_clip_epoch(&clip, &0).unwrap().status, ClipEpochStatus::Responded),
                _ => {}
            }
        }
        // the rightful signer alone is sufficient at the contract level (token sub-calls are
        // covered by mock_all_auths; we then check who authorized the top-level call)
        t.env.mock_all_auths();
        let r = match f {
            0 => flat(t.c.try_set_attestors(&attestors)),
            1 => flat(t.c.try_set_owners(&owners)),
            2 => flat(t.c.try_set_platform(&sym, &empty, &empty, &req)),
            3 => flat(t.c.try_set_router(&stranger)),
            4 => flat(t.c.try_create_campaign(&t.brand, &p2)).map(|_| ()),
            5 => flat(t.c.try_join(&id, &newbie)).map(|_| ()),
            6 => flat(t.c.try_register_clip(&id, &a, &yt_sym, &v2, &open_proof)).map(|_| ()),
            7 => flat(t.c.try_challenge(&id, &clip, &0, &ch, &ev)).map(|_| ()),
            8 => flat(t.c.try_respond(&1)),
            _ => flat(t.c.try_resolve(&1, &false)),
        };
        prop_assert_eq!(r, Ok(()), "{} failed for rightful signer", name);
        let signers: SVec<Address> = t.env.auths().iter().map(|(a, _)| a.clone()).collect();
        prop_assert!(signers.contains(&rightful), "{} not authorized by rightful signer", name);
    }
}

/// Permissionless entry points (claim / claim_holdback / refund / settle / finalize) can be
/// triggered by anyone, but funds only ever go to the clip owner / brand.
#[test]
fn permissionless_calls_pay_only_rightful_recipient() {
    let t = T::new();
    let mut p = t.params();
    p.epochs = 2;
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    let v = yt("perm");
    let clip = t.register(id, &a, &v, &ca, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, clip, 0, &v, &ca, 10_000);
    t.set_time(t.settle_at(id, 0));
    // no auths at all from here on
    t.env.mock_auths(&[]);
    t.c.settle_epoch(&id, &0);
    t.set_time(t.content_end(id, 1));
    // submit_proof needs no auth either; the proof binds the owner's code
    let pr = t.yt_proof(&v, &ca, 20_000);
    t.c.submit_proof(&id, &clip, &1, &pr);
    t.set_time(t.settle_at(id, 1));
    t.c.settle_epoch(&id, &1);
    let got = t.c.claim(&id, &clip, &0) + t.c.claim(&id, &clip, &1) + t.c.claim_holdback(&id, &clip, &0);
    assert_eq!(t.token.balance(&a), got);
    assert!(t.env.auths().is_empty());
    t.set_time(t.refund_at(id));
    let before = t.token.balance(&t.brand);
    let r = t.c.refund(&id);
    assert_eq!(t.token.balance(&t.brand), before + r);
    assert_eq!(got + r, p.budget);
    t.env.mock_all_auths();
}

// =============================================================================================
// 7. Timeline extremes
// =============================================================================================

/// A campaign whose timeline ends within MAX_FUTURE_SKEW (600 s) of u64::MAX passes
/// `validate_params`, but `register_clip` / `submit_proof` compute `t + MAX_FUTURE_SKEW`
/// unchecked and trap (overflow-checks are on in release) instead of returning an error.
#[test]
fn timeline_near_u64_max_traps_in_register_clip() {
    let t = T::new();
    let mut p = t.params();
    p.epochs = 1;
    p.epoch_len = 10;
    p.proof_window = 2;
    p.dispute_window = 2;
    p.arbiter_window = 2;
    p.claim_grace = 10;
    p.start = u64::MAX - 100;
    let id = t.create(&p);
    let (a, ca) = t.join(id);
    t.set_time(p.start + 1);
    let v = yt("max");
    let pr = t.yt_proof(&v, &ca, 0);
    let r = flat(t.c.try_register_clip(&id, &a, &t.sym("youtube"), &t.s(&v), &pr));
    assert_ne!(r, Err(None), "host trap (arithmetic overflow) instead of a contract error");
}

// =============================================================================================
// 8. Participant code collisions
// =============================================================================================

/// XDR of an ed25519 account `Address` as `to_xdr` produces it:
/// ScVal::Address (18) ‖ ScAddress::Account (0) ‖ PublicKey::Ed25519 (0) ‖ key.
fn account_xdr(key: &[u8; 32]) -> [u8; 44] {
    let mut out = [0u8; 44];
    out[3] = 18;
    out[12..].copy_from_slice(key);
    out
}

fn account(env: &Env, key: &[u8; 32]) -> Address {
    use soroban_sdk::address_payload::AddressPayload;
    Address::from_payload(env, AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(env, key)))
}

/// Off-chain replica of `participant_code` ("CR-" + 10 base36 chars of u64(sha256[0..8]) mod 36^10).
fn code_of(campaign_id: u64, key: &[u8; 32]) -> StdString {
    use sha2::{Digest, Sha256};
    const ALPHABET: &[u8; 36] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut h = Sha256::new();
    h.update(campaign_id.to_be_bytes());
    h.update(account_xdr(key));
    let d = h.finalize();
    let mut n = u64::from_be_bytes([d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]]) % 3_656_158_440_062_976;
    let mut out = *b"CR-0000000000";
    for i in (3..13).rev() {
        out[i] = ALPHABET[(n % 36) as usize];
        n /= 36;
    }
    StdString::from_utf8(out.to_vec()).unwrap()
}

fn key_of(i: u64) -> [u8; 32] {
    let mut k = [0u8; 32];
    k[..8].copy_from_slice(&i.to_be_bytes());
    k[8] = 0xc0;
    k
}

/// Codes are "CR-" + 10 base36 chars (~2^51.7 values), derived exactly as the replica above, so
/// grinding an address onto a victim's code is impractical.
#[test]
fn participant_code_is_ten_chars_and_matches_replica() {
    let t = T::new();
    let id = t.create(&t.params());
    for i in 0..8u64 {
        let k = key_of(1000 + i);
        let who = account(&t.env, &k);
        assert_eq!(
            who.clone().to_xdr(&t.env),
            Bytes::from_slice(&t.env, &account_xdr(&k))
        );
        t.hum.register(&id, &BytesN::from_array(&t.env, &[i as u8 + 1; 32]), &who);
        let code = to_std(&t.c.join(&id, &who));
        assert_eq!(code.len(), 13);
        assert_eq!(code, code_of(id, &k));
    }
}

/// Codes are unique per campaign: if a participant's derived code is already taken (a hash
/// collision, simulated here by seeding the code index), `join` fails with `CodeTaken`, so a
/// colliding participant can never present another participant's code as its own.
#[test]
fn participant_code_collision_rejected() {
    let t = T::new();
    let id = t.create(&t.params());
    let kb = key_of(7);
    let b = account(&t.env, &kb);
    t.hum.register(&id, &BytesN::from_array(&t.env, &[2; 32]), &b);
    let victim = Address::generate(&t.env);
    let taken = soroban_sdk::String::from_str(&t.env, &code_of(id, &kb));
    t.env.as_contract(&t.c.address, || {
        crate::storage::put(&t.env, &crate::storage::DataKey::Code(id, taken.clone()), &victim)
    });
    assert_eq!(flat(t.c.try_join(&id, &b)), Err(Some(Error::CodeTaken)));
    // the same address still joins a campaign where its code is free
    let id2 = t.create(&t.params());
    t.hum.register(&id2, &BytesN::from_array(&t.env, &[3; 32]), &b);
    assert_eq!(to_std(&t.c.join(&id2, &b)), code_of(id2, &kb));
}
