use soroban_sdk::{contracttype, Address, Bytes, String, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignParams {
    pub token: Address,
    pub budget: i128,
    pub rate_max_per_1k: i128,
    pub cap_views_clip: u64,
    pub cap_views_human: u64,
    pub min_views: u64,
    pub start: u64,
    pub epoch_len: u64,
    pub epochs: u32,
    pub proof_window: u64,
    pub dispute_window: u64,
    pub arbiter_window: u64,
    pub claim_grace: u64,
    pub holdback_bps: u32,
    pub bond: i128,
    pub arbiter: Address,
    pub platforms: Vec<Symbol>,
    pub require_humanity: bool,
    pub title: String,
    pub brief_url: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub id: u64,
    pub brand: Address,
    pub params: CampaignParams,
    pub balance: i128,
    pub settled_epochs: u32,
    pub refunded: bool,
    pub participants: u32,
    pub clips: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Participant {
    pub address: Address,
    pub code: String,
    pub joined_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Clip {
    pub id: u64,
    pub campaign_id: u64,
    pub owner: Address,
    pub platform: Symbol,
    pub video_id: String,
    pub baseline: u64,
    pub hwm: u64,
    pub registered_at: u64,
    pub first_epoch: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClipEpochStatus {
    Active,
    Challenged,
    Responded,
    Excluded,
}

/// Clip plus its per-epoch state (index = epoch; `None` = no close proof for that epoch).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClipView {
    pub clip: Clip,
    pub epochs: Vec<Option<ClipEpoch>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClipEpoch {
    pub baseline: u64,
    pub views: u64,
    pub weight: u64,
    pub status: ClipEpochStatus,
    pub claimed: bool,
    pub alive: bool,
    pub holdback_claimed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ParticipantEpoch {
    pub raw: u64,
    pub weight: u64,
}

#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EpochState {
    pub total_weight: u64,
    pub open_disputes: u32,
    pub settled: bool,
    pub budget: i128,
    pub rate: i128,
    pub spent: i128,
    pub held_total: i128,
    pub held_survived: i128,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    Open,
    Responded,
    ChallengerWon,
    ClipperWon,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub id: u64,
    pub campaign_id: u64,
    pub clip_id: u64,
    pub epoch: u32,
    pub challenger: Address,
    pub evidence: String,
    pub status: DisputeStatus,
    pub opened_at: u64,
}

/// Admin-configured platform: expected URL is `url_prefix ‖ video_id ‖ url_suffix`;
/// every `required` byte string must appear in the proof `parameters`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformConfig {
    pub url_prefix: Bytes,
    pub url_suffix: Bytes,
    pub required: Vec<Bytes>,
}
