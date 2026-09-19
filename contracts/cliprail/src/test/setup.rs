use std::cell::Cell;
use std::format;
use std::string::String as StdString;

use reclaim_verify::testutils::{attestor_address, sign_proof};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{vec, Address, Bytes, BytesN, Env, String, Symbol};

use crate::{Campaign, CampaignParams, Cliprail, CliprailClient, DisputeStatus, ReclaimProof};

pub const T0: u64 = 1_000_000;
pub const USDC: i128 = 10_000_000;
pub const ATTESTOR_SK: [u8; 32] = [0x11; 32];
pub const ROGUE_SK: [u8; 32] = [0x22; 32];
pub const OWNER: &str = "0x3c0e62a4e9f6e8d7a1b2c3d4e5f60718293a4b5c";
pub const YT_PREFIX: &str =
    "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=";
pub const DEMO_PREFIX: &str = "https://demo.cliprail.example/demo/videos/";
/// responseMatches regexes as they appear inside the canonical parameters JSON (escaped).
pub const RE_VIEWS: &str = r#"\"viewCount\":\"(?<views>\\d+)\""#;
pub const RE_DESC: &str = r#"\"description\":\"(?<desc>(?:[^\"\\\\]|\\\\.)*)\""#;

pub struct T {
    pub env: Env,
    pub c: CliprailClient<'static>,
    pub hum: humanity::HumanityClient<'static>,
    pub token: TokenClient<'static>,
    pub sac: StellarAssetClient<'static>,
    pub brand: Address,
    pub arbiter: Address,
    pub admin: Address,
    nonce: Cell<u8>,
}

pub fn yt(p: &str) -> StdString {
    // 11-char youtube-shaped id
    format!("{:_<11}", p)
}

impl T {
    pub fn new() -> T {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(T0);
        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let brand = Address::generate(&env);
        let arbiter = Address::generate(&env);

        let hid = env.register(humanity::Humanity, (admin.clone(), relayer));
        let hum = humanity::HumanityClient::new(&env, &hid);

        let cid = env.register(Cliprail, (admin.clone(), hid.clone()));
        let c = CliprailClient::new(&env, &cid);
        c.set_attestors(&vec![&env, attestor_address(&env, &ATTESTOR_SK)]);
        c.set_owners(&vec![&env, Bytes::from_slice(&env, OWNER.as_bytes())]);
        let req = vec![
            &env,
            Bytes::from_slice(&env, RE_VIEWS.as_bytes()),
            Bytes::from_slice(&env, RE_DESC.as_bytes()),
        ];
        c.set_platform(
            &Symbol::new(&env, "youtube"),
            &Bytes::from_slice(&env, YT_PREFIX.as_bytes()),
            &Bytes::new(&env),
            &req,
        );
        c.set_platform(
            &Symbol::new(&env, "demo"),
            &Bytes::from_slice(&env, DEMO_PREFIX.as_bytes()),
            &Bytes::new(&env),
            &req,
        );

        let sa = env.register_stellar_asset_contract_v2(admin.clone());
        let token = TokenClient::new(&env, &sa.address());
        let sac = StellarAssetClient::new(&env, &sa.address());
        sac.mint(&brand, &(1_000_000 * USDC));
        T {
            env,
            c,
            hum,
            token,
            sac,
            brand,
            arbiter,
            admin,
            nonce: Cell::new(0),
        }
    }

    pub fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }
    pub fn set_time(&self, t: u64) {
        self.env.ledger().set_timestamp(t);
    }

    /// Demo-ish defaults (ARCHITECTURE §6) with a 1000 USDC budget.
    pub fn params(&self) -> CampaignParams {
        let env = &self.env;
        CampaignParams {
            token: self.token.address.clone(),
            budget: 1000 * USDC,
            rate_max_per_1k: USDC,
            cap_views_clip: 50_000,
            cap_views_human: 100_000,
            min_views: 100,
            start: self.now() + 60,
            epoch_len: 300,
            epochs: 2,
            proof_window: 90,
            dispute_window: 90,
            arbiter_window: 60,
            claim_grace: 300,
            holdback_bps: 2000,
            bond: 5 * USDC,
            arbiter: self.arbiter.clone(),
            platforms: vec![env, Symbol::new(env, "youtube"), Symbol::new(env, "demo")],
            require_humanity: true,
            title: String::from_str(env, "Launch trailer clips"),
            brief_url: String::from_str(env, "https://example.com/brief"),
        }
    }

    pub fn create(&self, p: &CampaignParams) -> u64 {
        self.c.create_campaign(&self.brand, p)
    }

    pub fn campaign(&self, id: u64) -> Campaign {
        self.c.get_campaign(&id)
    }

    // ---- timeline (independent re-statement of ARCHITECTURE §5.1) ----
    pub fn content_end(&self, id: u64, e: u32) -> u64 {
        let p = self.campaign(id).params;
        p.start + (e as u64 + 1) * p.epoch_len
    }
    pub fn proof_end(&self, id: u64, e: u32) -> u64 {
        self.content_end(id, e) + self.campaign(id).params.proof_window
    }
    pub fn challenge_end(&self, id: u64, e: u32) -> u64 {
        self.proof_end(id, e) + self.campaign(id).params.dispute_window / 2
    }
    pub fn dispute_end(&self, id: u64, e: u32) -> u64 {
        self.proof_end(id, e) + self.campaign(id).params.dispute_window
    }
    pub fn settle_at(&self, id: u64, e: u32) -> u64 {
        self.dispute_end(id, e) + self.campaign(id).params.arbiter_window
    }
    pub fn refund_at(&self, id: u64) -> u64 {
        let p = self.campaign(id).params;
        self.settle_at(id, p.epochs - 1) + p.claim_grace
    }

    // ---- people ----
    pub fn human(&self, id: u64) -> Address {
        let a = Address::generate(&self.env);
        let n = self.nonce.get().wrapping_add(1);
        self.nonce.set(n);
        let mut raw = [0u8; 32];
        raw[0] = n;
        raw[1] = id as u8;
        self.hum
            .register(&id, &BytesN::from_array(&self.env, &raw), &a);
        a
    }

    pub fn join(&self, id: u64) -> (Address, StdString) {
        let a = self.human(id);
        let code = self.c.join(&id, &a);
        (a, to_std(&code))
    }

    pub fn mint(&self, to: &Address, amt: i128) {
        self.sac.mint(to, &amt);
    }

    // ---- proofs ----
    pub fn params_json(prefix: &str, video_id: &str) -> StdString {
        format!(
            r#"{{"body":"","method":"GET","responseMatches":[{{"type":"regex","value":"{RE_VIEWS}"}},{{"type":"regex","value":"{RE_DESC}"}}],"responseRedactions":[],"url":"{prefix}{video_id}"}}"#
        )
    }

    pub fn context_json(desc: &str, views: &str) -> StdString {
        format!(
            r#"{{"contextAddress":"0x0","contextMessage":"","extractedParameters":{{"desc":"{desc}","views":"{views}"}},"providerHash":"0x5f1c7a2e"}}"#
        )
    }

    pub fn sign(
        &self,
        sk: &[u8; 32],
        params: &str,
        ctx: &str,
        owner: &str,
        ts: u64,
    ) -> ReclaimProof {
        sign_proof(&self.env, sk, params, ctx, owner, ts, 1)
    }

    /// Well-formed youtube proof: `desc` contains `code`, signed now by the trusted attestor.
    pub fn yt_proof(&self, video_id: &str, code: &str, views: u64) -> ReclaimProof {
        self.yt_proof_at(video_id, code, views, self.now())
    }

    pub fn yt_proof_at(&self, video_id: &str, code: &str, views: u64, ts: u64) -> ReclaimProof {
        let desc = format!("New clip! Use my code {code} \\n#shorts");
        self.sign(
            &ATTESTOR_SK,
            &Self::params_json(YT_PREFIX, video_id),
            &Self::context_json(&desc, &format!("{views}")),
            OWNER,
            ts,
        )
    }

    pub fn register(&self, id: u64, who: &Address, video_id: &str, code: &str, views: u64) -> u64 {
        let p = self.yt_proof(video_id, code, views);
        self.c.register_clip(
            &id,
            who,
            &Symbol::new(&self.env, "youtube"),
            &String::from_str(&self.env, video_id),
            &p,
        )
    }

    pub fn close(&self, id: u64, clip: u64, e: u32, video_id: &str, code: &str, views: u64) {
        let p = self.yt_proof(video_id, code, views);
        self.c.submit_proof(&id, &clip, &e, &p);
    }

    /// Contract token balance == Σ campaign.balance + open bonds.
    pub fn check_invariant(&self) {
        let mut expect: i128 = 0;
        for id in 1..=self.c.campaign_count() {
            let camp = self.campaign(id);
            expect += camp.balance;
            for d in self.c.list_disputes(&id).iter() {
                if matches!(d.status, DisputeStatus::Open | DisputeStatus::Responded) {
                    expect += camp.params.bond;
                }
            }
        }
        assert_eq!(
            self.token.balance(&self.c.address),
            expect,
            "balance invariant"
        );
    }

    pub fn cpu(&self) -> u64 {
        self.env.cost_estimate().budget().cpu_instruction_cost()
    }

    pub fn sym(&self, s: &str) -> Symbol {
        Symbol::new(&self.env, s)
    }
    pub fn s(&self, s: &str) -> String {
        String::from_str(&self.env, s)
    }
}

pub fn to_std(s: &String) -> StdString {
    let mut buf = [0u8; 64];
    let n = s.len() as usize;
    s.copy_into_slice(&mut buf[..n]);
    StdString::from_utf8(buf[..n].to_vec()).unwrap()
}
