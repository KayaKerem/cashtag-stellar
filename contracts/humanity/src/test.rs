extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::IntoVal;

fn setup() -> (Env, HumanityClient<'static>, Address, Address) {
    let env = Env::default();
    let id = env.register(Humanity, ());
    let client = HumanityClient::new(&env, &id);
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    client.init(&admin, &relayer);
    (env, client, admin, relayer)
}

fn n(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

#[test]
fn register_and_query() {
    let (env, c, _admin, _relayer) = setup();
    env.mock_all_auths();
    let w = Address::generate(&env);
    assert!(!c.is_verified(&1, &w));
    c.register(&1, &n(&env, 1), &w);
    assert!(c.is_verified(&1, &w));
    assert!(!c.is_verified(&2, &w));
    // same nullifier in a different campaign is fine (campaign-scoped)
    c.register(&2, &n(&env, 1), &w);
    assert!(c.is_verified(&2, &w));
}

#[test]
fn double_init_fails() {
    let (env, c, _a, _r) = setup();
    let x = Address::generate(&env);
    assert_eq!(c.try_init(&x, &x), Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn double_nullifier_rejected() {
    let (env, c, _a, _r) = setup();
    env.mock_all_auths();
    let w1 = Address::generate(&env);
    let w2 = Address::generate(&env);
    c.register(&7, &n(&env, 9), &w1);
    assert_eq!(
        c.try_register(&7, &n(&env, 9), &w2),
        Err(Ok(Error::NullifierUsed))
    );
    assert!(!c.is_verified(&7, &w2));
}

#[test]
fn double_wallet_rejected() {
    let (env, c, _a, _r) = setup();
    env.mock_all_auths();
    let w = Address::generate(&env);
    c.register(&7, &n(&env, 1), &w);
    assert_eq!(
        c.try_register(&7, &n(&env, 2), &w),
        Err(Ok(Error::WalletRegistered))
    );
}

#[test]
fn unauthorized_register_rejected() {
    let (env, c, _a, _relayer) = setup();
    let w = Address::generate(&env);
    let mallory = Address::generate(&env);
    let null = n(&env, 3);
    let res = c
        .mock_auths(&[MockAuth {
            address: &mallory,
            invoke: &MockAuthInvoke {
                contract: &c.address,
                fn_name: "register",
                args: (5u64, null.clone(), w.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_register(&5, &null, &w);
    // host auth failure (not a contract error)
    assert!(matches!(res, Err(Err(_))));
    assert!(!c.is_verified(&5, &w));
}
