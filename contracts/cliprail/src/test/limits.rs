//! Bounded per-campaign lists and pagination (TM-14), config and payout events (TM-21).

use super::setup::*;
use crate::dispute::MAX_DISPUTES_PER_CAMPAIGN;
use crate::storage::{self, DataKey};
use crate::{Error, MAX_CLIPS_PER_CAMPAIGN, MAX_PAGE};
use reclaim_verify::testutils::attestor_address;
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::Event as _;
use soroban_sdk::{vec, Address, Bytes, Symbol, Vec};

fn last_event(t: &T) -> soroban_sdk::xdr::ContractEvent {
    t.env.events().all().events().last().unwrap().clone()
}

/// One-epoch campaign with one closed clip, inside its challenge window.
fn challengeable(t: &T) -> (u64, u64, Address) {
    let mut p = t.params();
    p.epochs = 1;
    let id = t.create(&p);
    let (a, code) = t.join(id);
    let v = yt("cap");
    let clip = t.register(id, &a, &v, &code, 0);
    t.set_time(t.content_end(id, 0));
    t.close(id, clip, 0, &v, &code, 10_000);
    t.set_time(t.proof_end(id, 0));
    let ch = Address::generate(&t.env);
    t.mint(&ch, 5 * USDC);
    (id, clip, ch)
}

#[test]
fn clip_list_is_capped() {
    let t = T::new();
    let id = t.create(&t.params());
    let (a, code) = t.join(id);
    t.env.as_contract(&t.c.address, || {
        let mut c = storage::campaign(&t.env, id).unwrap();
        c.clips = MAX_CLIPS_PER_CAMPAIGN;
        storage::set_campaign(&t.env, &c);
    });
    let v = yt("full");
    let p = t.yt_proof(&v, &code, 1);
    let r =
        t.c.try_register_clip(&id, &a, &t.sym("youtube"), &t.s(&v), &p);
    assert_eq!(r, Err(Ok(Error::ListFull)));
    // the rejected proof was not consumed: it still registers once there is room
    t.env.as_contract(&t.c.address, || {
        let mut c = storage::campaign(&t.env, id).unwrap();
        c.clips = MAX_CLIPS_PER_CAMPAIGN - 1;
        storage::set_campaign(&t.env, &c);
    });
    t.c.register_clip(&id, &a, &t.sym("youtube"), &t.s(&v), &p);
    assert_eq!(t.campaign(id).clips, MAX_CLIPS_PER_CAMPAIGN);
}

#[test]
fn dispute_list_is_capped() {
    let t = T::new();
    let (id, clip, ch) = challengeable(&t);
    t.env.as_contract(&t.c.address, || {
        let mut l = Vec::new(&t.env);
        for i in 0..MAX_DISPUTES_PER_CAMPAIGN {
            l.push_back(10_000 + i as u64);
        }
        storage::put(&t.env, &DataKey::CampaignDisputes(id), &l);
    });
    let r = t.c.try_challenge(&id, &clip, &0, &ch, &t.s("ipfs://e"));
    assert_eq!(r, Err(Ok(Error::ListFull)));
    // nothing moved: the bond stays with the challenger
    assert_eq!(t.token.balance(&ch), 5 * USDC);
    assert_eq!(t.c.get_epoch(&id, &0).open_disputes, 0);
}

#[test]
fn clips_page_through_registration_order() {
    let t = T::new();
    let id = t.create(&t.params());
    let mut ids = std::vec::Vec::new();
    for i in 0..5 {
        let (a, code) = t.join(id);
        ids.push(t.register(id, &a, &yt(&std::format!("pg{i}")), &code, 0));
    }
    let page = |s: u32, l: u32| -> std::vec::Vec<u64> {
        t.c.get_clips_page(&id, &s, &l)
            .iter()
            .map(|v| v.clip.id)
            .collect()
    };
    assert_eq!(page(0, 2), ids[0..2]);
    assert_eq!(page(2, 2), ids[2..4]);
    assert_eq!(page(4, 2), ids[4..5]);
    assert!(page(5, 2).is_empty());
    assert!(page(u32::MAX, u32::MAX).is_empty());
    assert!(page(0, 0).is_empty());
    assert_eq!(page(0, u32::MAX), ids);
    assert_eq!(t.c.get_clips(&id).len(), 5);
}

#[test]
fn page_size_is_bounded() {
    let t = T::new();
    let id = t.create(&t.params());
    t.env.as_contract(&t.c.address, || {
        let mut l = Vec::new(&t.env);
        for i in 0..(MAX_PAGE + 20) {
            l.push_back(9_000 + i as u64); // ids without dispute entries are skipped
        }
        storage::put(&t.env, &DataKey::CampaignDisputes(id), &l);
    });
    assert_eq!(t.c.list_disputes_page(&id, &0, &u32::MAX).len(), 0);

    let (id, clip, ch) = challengeable(&t);
    let dis = t.c.challenge(&id, &clip, &0, &ch, &t.s("ipfs://e"));
    let all = t.c.list_disputes(&id);
    assert_eq!(all.len(), 1);
    assert_eq!(t.c.list_disputes_page(&id, &0, &10), all);
    assert_eq!(t.c.list_disputes_page(&id, &0, &10).get(0).unwrap().id, dis);
    assert!(t.c.list_disputes_page(&id, &1, &10).is_empty());
}

#[test]
fn admin_setters_emit_events() {
    let t = T::new();
    let cfg = |key: &str| {
        crate::events::ConfigSet {
            key: Symbol::new(&t.env, key),
            admin: t.admin.clone(),
        }
        .to_xdr(&t.env, &t.c.address)
    };
    t.c.set_arbiters(&vec![&t.env, t.arbiter.clone()]);
    assert_eq!(last_event(&t), cfg("arbiters"));
    t.c.set_min_response_window(&60);
    assert_eq!(last_event(&t), cfg("minresp"));
    t.c.set_attestors(&vec![&t.env, attestor_address(&t.env, &ATTESTOR_SK)]);
    assert_eq!(last_event(&t), cfg("attestors"));
    t.c.set_owners(&vec![&t.env, Bytes::from_slice(&t.env, OWNER.as_bytes())]);
    assert_eq!(last_event(&t), cfg("owners"));
    let router = Address::generate(&t.env);
    t.c.set_router(&router);
    assert_eq!(last_event(&t), cfg("router"));

    let prefix = Bytes::from_slice(&t.env, DEMO_PREFIX.as_bytes());
    t.c.set_platform(&t.sym("demo"), &prefix, &Bytes::new(&t.env), &vec![&t.env]);
    let expected = crate::events::PlatformSet {
        platform: t.sym("demo"),
        url_prefix: prefix,
        url_suffix: Bytes::new(&t.env),
    }
    .to_xdr(&t.env, &t.c.address);
    assert_eq!(last_event(&t), expected);

    let next = Address::generate(&t.env);
    t.c.propose_admin(&next);
    let expected = crate::events::AdminProposed {
        pending: next.clone(),
    }
    .to_xdr(&t.env, &t.c.address);
    assert_eq!(last_event(&t), expected);
}

#[test]
fn withdraw_emits_event() {
    let t = T::new();
    let (id, clip, ch) = challengeable(&t);
    let dis = t.c.challenge(&id, &clip, &0, &ch, &t.s("ipfs://e"));
    t.set_time(t.dispute_end(id, 0));
    t.c.finalize_dispute(&dis);
    let owed = t.c.owed(&t.arbiter, &t.token.address);
    assert!(owed > 0);
    assert_eq!(t.c.withdraw(&t.arbiter, &t.token.address), owed);
    let expected = crate::events::Withdrawn {
        who: t.arbiter.clone(),
        token: t.token.address.clone(),
        amount: owed,
    }
    .to_xdr(&t.env, &t.c.address);
    assert_eq!(last_event(&t), expected);
}
