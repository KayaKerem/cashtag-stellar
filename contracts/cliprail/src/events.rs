//! Events per docs/INTERFACES.md §2.4: topics = (Symbol, campaign_id), data = vec of fields.

use soroban_sdk::{contractevent, Address, Bytes, String, Symbol};

#[contractevent(topics = ["campaign"], data_format = "vec")]
pub struct CampaignCreated {
    #[topic]
    pub id: u64,
    pub brand: Address,
    pub budget: i128,
    pub epochs: u32,
}

#[contractevent(topics = ["joined"], data_format = "vec")]
pub struct Joined {
    #[topic]
    pub id: u64,
    pub participant: Address,
    pub code: String,
}

#[contractevent(topics = ["clip"], data_format = "vec")]
pub struct ClipRegistered {
    #[topic]
    pub id: u64,
    pub clip_id: u64,
    pub owner: Address,
    pub platform: Symbol,
    pub video_id: String,
    pub baseline: u64,
}

#[contractevent(topics = ["proof"], data_format = "vec")]
pub struct ProofAccepted {
    #[topic]
    pub id: u64,
    pub clip_id: u64,
    pub epoch: u32,
    pub views: u64,
    pub weight: u64,
}

#[contractevent(topics = ["settled"], data_format = "vec")]
pub struct Settled {
    #[topic]
    pub id: u64,
    pub epoch: u32,
    pub rate: i128,
    pub spent: i128,
    pub total_weight: u64,
}

#[contractevent(topics = ["claimed"], data_format = "vec")]
pub struct Claimed {
    #[topic]
    pub id: u64,
    pub clip_id: u64,
    pub epoch: u32,
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["hbclaim"], data_format = "vec")]
pub struct HoldbackClaimed {
    #[topic]
    pub id: u64,
    pub clip_id: u64,
    pub epoch: u32,
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["challenge"], data_format = "vec")]
pub struct Challenged {
    #[topic]
    pub id: u64,
    pub dispute_id: u64,
    pub clip_id: u64,
    pub epoch: u32,
    pub challenger: Address,
}

#[contractevent(topics = ["respond"], data_format = "vec")]
pub struct Responded {
    #[topic]
    pub id: u64,
    pub dispute_id: u64,
}

#[contractevent(topics = ["resolved"], data_format = "vec")]
pub struct Resolved {
    #[topic]
    pub id: u64,
    pub dispute_id: u64,
    pub clipper_wins: bool,
}

#[contractevent(topics = ["refund"], data_format = "vec")]
pub struct Refunded {
    #[topic]
    pub id: u64,
    pub brand: Address,
    pub amount: i128,
}

/// Campaign funded through a swap: `amount_in` of `token_in` became exactly `budget` of the
/// campaign token (see `CampaignCreated`).
#[contractevent(topics = ["swapfund"], data_format = "vec")]
pub struct SwapFunded {
    #[topic]
    pub id: u64,
    pub token_in: Address,
    pub amount_in: i128,
}

#[contractevent(topics = ["admin"], data_format = "vec")]
pub struct AdminChanged {
    pub admin: Address,
}

/// `propose_admin`: step 1 of an admin transfer (TM-21).
#[contractevent(topics = ["adminprop"], data_format = "vec")]
pub struct AdminProposed {
    pub pending: Address,
}

/// An admin setter changed instance config (TM-21). `key` names the setting:
/// `arbiters`, `minresp`, `attestors`, `owners` or `router`. Only campaigns created
/// afterwards see the change.
#[contractevent(topics = ["config"], data_format = "vec")]
pub struct ConfigSet {
    #[topic]
    pub key: Symbol,
    pub admin: Address,
}

/// `set_platform` (TM-21).
#[contractevent(topics = ["platform"], data_format = "vec")]
pub struct PlatformSet {
    #[topic]
    pub platform: Symbol,
    pub url_prefix: Bytes,
    pub url_suffix: Bytes,
}

/// `withdraw`: dispute payouts or arbiter fees paid out (TM-21).
#[contractevent(topics = ["withdraw"], data_format = "vec")]
pub struct Withdrawn {
    #[topic]
    pub who: Address,
    pub token: Address,
    pub amount: i128,
}
