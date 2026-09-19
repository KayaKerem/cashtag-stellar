#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn version(_env: Env) -> u32 {
        1
    }
}
