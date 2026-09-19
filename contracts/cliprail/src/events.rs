//! Events per docs/INTERFACES.md §2.4: topics = (Symbol, campaign_id), data = vec of fields.

use soroban_sdk::{contractevent, Address, String, Symbol};

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
