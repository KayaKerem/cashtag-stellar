//! create_campaign_with_swap against a mock Soroswap router (same entrypoint and auth semantics:
//! `to.require_auth()`, input pulled from `to`, exact output sent to `to`, contract error 508 on
//! slippage, 503 past the deadline).

use std::println;

use super::setup::*;
use crate::{CampaignParams, Error};
use soroban_sdk::testutils::{Address as _, AuthorizedFunction, Events as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::Event as _;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, vec, Address, Env, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RouterError {
    DeadlineExpired = 503,
    ExcessiveInputAmount = 508,
}

#[contracttype]
enum RKey {
    Price,
    Short,
}

/// Fixed-price router: `amount_in = amount_out * price`. Holds a float of the output token.
/// With `short` set it under-delivers by 1 unit (a buggy/malicious router).
#[contract]
pub struct MockRouter;

#[contractimpl]
impl MockRouter {
    pub fn configure(env: Env, price: i128, short: bool) {
        env.storage().instance().set(&RKey::Price, &price);
        env.storage().instance().set(&RKey::Short, &short);
    }

    pub fn swap_tokens_for_exact_tokens(
        env: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Result<Vec<i128>, RouterError> {
        to.require_auth();
        if env.ledger().timestamp() > deadline {
            return Err(RouterError::DeadlineExpired);
        }
        let price: i128 = env.storage().instance().get(&RKey::Price).unwrap();
        let short: bool = env.storage().instance().get(&RKey::Short).unwrap();
        let amount_in = amount_out * price;
        if amount_in > amount_in_max {
            return Err(RouterError::ExcessiveInputAmount);
        }
        let me = env.current_contract_address();
        TokenClient::new(&env, &path.get(0).unwrap()).transfer(&to, &me, &amount_in);
        let sent = if short { amount_out - 1 } else { amount_out };
        TokenClient::new(&env, &path.get(path.len() - 1).unwrap()).transfer(&me, &to, &sent);
        Ok(vec![&env, amount_in, amount_out])
    }
}

const PRICE: i128 = 5; // 5 XLM per USDC

struct S {
    t: T,
    router: Address,
    xlm: TokenClient<'static>,
}

fn base() -> S {
    let t = T::new();
    let router = t.env.register(MockRouter, ());
    MockRouterClient::new(&t.env, &router).configure(&PRICE, &false);
    let xa = t.env.register_stellar_asset_contract_v2(t.admin.clone());
    let xlm = TokenClient::new(&t.env, &xa.address());
    StellarAssetClient::new(&t.env, &xa.address()).mint(&t.brand, &(100_000 * USDC));
    t.mint(&router, 100_000 * USDC); // router float of the campaign token
    t.c.set_router(&router);
    S { t, router, xlm }
}

impl S {
    fn path(&self) -> Vec<Address> {
        vec![
            &self.t.env,
            self.xlm.address.clone(),
            self.t.token.address.clone(),
        ]
    }
    fn try_fund(&self, p: &CampaignParams, max: i128, path: &Vec<Address>) -> Result<u64, Error> {
        match self.t.c.try_create_campaign_with_swap(
            &self.t.brand,
            p,
            &self.xlm.address,
            &max,
            path,
            &(self.t.now() + 600),
        ) {
            Ok(Ok(id)) => Ok(id),
            Err(Ok(e)) => Err(e),
            other => panic!("unexpected: {:?}", other),
        }
    }
}

#[test]
fn swap_fund_happy_path() {
    let s = base();
    let t = &s.t;
    let p = t.params();
    let usdc_before = t.token.balance(&t.brand);
    let xlm_before = s.xlm.balance(&t.brand);
    let max = p.budget * PRICE * 101 / 100;
    let id = s.try_fund(&p, max, &s.path()).unwrap();
    let cpu = t.cpu();
    // ("swapfund", id) → [token_in, amount_in]
    let evs = t.env.events().all();
    let last = evs.events().last().unwrap().clone();
    let expected = crate::events::SwapFunded {
        id,
        token_in: s.xlm.address.clone(),
        amount_in: p.budget * PRICE,
    }
    .to_xdr(&t.env, &t.c.address);
    assert_eq!(last, expected);

    // exactly `budget` escrowed, brand paid `budget * PRICE` XLM, its USDC untouched
    assert_eq!(t.campaign(id).balance, p.budget);
    assert_eq!(t.campaign(id).brand, t.brand);
    assert_eq!(t.token.balance(&t.c.address), p.budget);
    assert_eq!(t.token.balance(&t.brand), usdc_before);
    assert_eq!(s.xlm.balance(&t.brand), xlm_before - p.budget * PRICE);
    assert_eq!(s.xlm.balance(&s.router), p.budget * PRICE);
    t.check_invariant();

    println!("create_campaign_with_swap cpu (incl. mock router + 2 SAC transfers): {cpu}");

    // the campaign behaves like any other: join works
    let (_a, code) = t.join(id);
    assert!(code.starts_with("CR-"));
}

#[test]
fn swap_fund_auth_tree() {
    let s = base();
    let t = &s.t;
    let p = t.params();
    let max = p.budget * PRICE;
    let deadline = t.now() + 600;
    t.c.create_campaign_with_swap(&t.brand, &p, &s.xlm.address, &max, &s.path(), &deadline);
    let auths = t.env.auths();
    // one root authorization by the brand, covering the swap (+ its input pull) and the escrow pull
    assert_eq!(auths.len(), 1);
    let (who, inv) = &auths[0];
    assert_eq!(who, &t.brand);
    match &inv.function {
        AuthorizedFunction::Contract((c, f, _)) => {
            assert_eq!(c, &t.c.address);
            assert_eq!(f, &Symbol::new(&t.env, "create_campaign_with_swap"));
        }
        _ => panic!("expected contract fn"),
    }
    let subs: std::vec::Vec<(Address, Symbol)> = inv
        .sub_invocations
        .iter()
        .map(|i| match &i.function {
            AuthorizedFunction::Contract((c, f, _)) => (c.clone(), f.clone()),
            _ => panic!(),
        })
        .collect();
    assert_eq!(
        subs,
        std::vec![
            (
                s.router.clone(),
                Symbol::new(&t.env, "swap_tokens_for_exact_tokens")
            ),
            (t.token.address.clone(), Symbol::new(&t.env, "transfer")),
        ]
    );
    let swap = &inv.sub_invocations[0];
    assert_eq!(swap.sub_invocations.len(), 1); // xlm.transfer(brand → router)
    match &swap.sub_invocations[0].function {
        AuthorizedFunction::Contract((c, f, _)) => {
            assert_eq!(c, &s.xlm.address);
            assert_eq!(f, &Symbol::new(&t.env, "transfer"));
        }
        _ => panic!(),
    }
}

#[test]
fn swap_fund_requires_brand_auth() {
    let s = base();
    let t = &s.t;
    let p = t.params();
    t.env.set_auths(&[]);
    let r = t.c.try_create_campaign_with_swap(
        &t.brand,
        &p,
        &s.xlm.address,
        &(p.budget * PRICE),
        &s.path(),
        &(t.now() + 600),
    );
    assert!(r.is_err());
    assert_eq!(t.c.campaign_count(), 0);
}

#[test]
fn swap_fund_bad_path() {
    let s = base();
    let t = &s.t;
    let p = t.params();
    let max = p.budget * PRICE;
    let (x, u) = (s.xlm.address.clone(), t.token.address.clone());
    let other = Address::generate(&t.env);
    for path in [
        vec![&t.env, x.clone()],
        vec![&t.env, u.clone(), x.clone()],
        vec![&t.env, x.clone(), other.clone()],
        vec![&t.env, other.clone(), u.clone()],
        Vec::new(&t.env),
    ] {
        assert_eq!(s.try_fund(&p, max, &path), Err(Error::BadPath));
    }
    // token_in == campaign token
    let r = t.c.try_create_campaign_with_swap(
        &t.brand,
        &p,
        &u,
        &max,
        &vec![&t.env, u.clone(), u.clone()],
        &(t.now() + 600),
    );
    assert_eq!(r, Err(Ok(Error::BadPath)));
    // a multi-hop path is accepted by the contract (the mock prices it like a direct pair)
    // multi-hop paths pass the path check; this mock returns 2 amounts for 3 hops → rejected
    assert_eq!(
        s.try_fund(&p, max, &vec![&t.env, x.clone(), other, u.clone()]),
        Err(Error::SwapFailed)
    );
    assert_eq!(t.c.campaign_count(), 0);
}

#[test]
fn swap_fund_slippage_and_deadline() {
    let s = base();
    let t = &s.t;
    let p = t.params();
    let xlm_before = s.xlm.balance(&t.brand);
    // one stroop short of the needed input
    assert_eq!(
        s.try_fund(&p, p.budget * PRICE - 1, &s.path()),
        Err(Error::SwapFailed)
    );
    assert_eq!(s.try_fund(&p, 0, &s.path()), Err(Error::InvalidParams));
    // expired deadline
    let r = t.c.try_create_campaign_with_swap(
        &t.brand,
        &p,
        &s.xlm.address,
        &(p.budget * PRICE),
        &s.path(),
        &(t.now() - 1),
    );
    assert_eq!(r, Err(Ok(Error::SwapFailed)));
    // nothing moved
    assert_eq!(s.xlm.balance(&t.brand), xlm_before);
    assert_eq!(t.token.balance(&t.c.address), 0);
    assert_eq!(t.c.campaign_count(), 0);
}

#[test]
fn swap_fund_short_delivery_rejected() {
    let s = base();
    let t = &s.t;
    MockRouterClient::new(&t.env, &s.router).configure(&PRICE, &true);
    let p = t.params();
    assert_eq!(
        s.try_fund(&p, p.budget * PRICE, &s.path()),
        Err(Error::SwapFailed)
    );
    assert_eq!(t.c.campaign_count(), 0);
}

#[test]
fn swap_fund_router_not_set_and_invalid_params() {
    let t = T::new();
    let xlm = Address::generate(&t.env);
    let mut p = t.params();
    let path = vec![&t.env, xlm.clone(), t.token.address.clone()];
    let r =
        t.c.try_create_campaign_with_swap(&t.brand, &p, &xlm, &1, &path, &(t.now() + 1));
    assert_eq!(r, Err(Ok(Error::RouterNotSet)));
    assert_eq!(t.c.router(), None);
    // params are validated before any swap
    let s = base();
    p = s.t.params();
    p.budget = 0;
    assert_eq!(
        s.try_fund(&p, 1_000 * USDC, &s.path()),
        Err(Error::InvalidParams)
    );
}

#[test]
fn set_router_is_admin_only() {
    let s = base();
    let t = &s.t;
    assert_eq!(t.c.router(), Some(s.router.clone()));
    let r2 = Address::generate(&t.env);
    t.c.set_router(&r2);
    let auths = t.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, t.admin);
    assert_eq!(t.c.router(), Some(r2.clone()));
    t.env.set_auths(&[]);
    assert!(t.c.try_set_router(&s.router).is_err());
    assert_eq!(t.c.router(), Some(r2));
}
