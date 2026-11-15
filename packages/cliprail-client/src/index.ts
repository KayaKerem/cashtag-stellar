import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCICEPQCY25RNF5SAJ3FPUXPXEIRQ3GOUMSVZGVCHRJ6L6Q3FHJL3TST",
  }
} as const


export interface Clip {
  baseline: u64;
  campaign_id: u64;
  first_epoch: u32;
  hwm: u64;
  id: u64;
  owner: string;
  platform: string;
  registered_at: u64;
  video_id: string;
}


export interface Dispute {
  campaign_id: u64;
  challenger: string;
  clip_id: u64;
  epoch: u32;
  evidence: string;
  id: u64;
  opened_at: u64;
  status: DisputeStatus;
}


export interface Campaign {
  balance: i128;
  brand: string;
  clips: u32;
  id: u64;
  params: CampaignParams;
  participants: u32;
  refunded: boolean;
  settled_epochs: u32;
}


/**
 * Clip plus its per-epoch state (index = epoch; `None` = no close proof for that epoch).
 */
export interface ClipView {
  clip: Clip;
  epochs: Array<Option<ClipEpoch>>;
}


export interface ClipEpoch {
  alive: boolean;
  baseline: u64;
  claimed: boolean;
  holdback_claimed: boolean;
  status: ClipEpochStatus;
  views: u64;
  weight: u64;
}


export interface EpochState {
  budget: i128;
  held_survived: i128;
  held_total: i128;
  open_disputes: u32;
  rate: i128;
  settled: boolean;
  spent: i128;
  total_weight: u64;
}


export interface Participant {
  address: string;
  code: string;
  joined_at: u64;
}

export type DisputeStatus = {tag: "Open", values: void} | {tag: "Responded", values: void} | {tag: "ChallengerWon", values: void} | {tag: "ClipperWon", values: void};


/**
 * Verification config frozen into a campaign at creation (TM-1): later admin changes to
 * attestors, owners or platforms only affect campaigns created afterwards.
 */
export interface CampaignConfig {
  attestors: Array<Buffer>;
  owners: Array<Buffer>;
  platforms: Map<string, PlatformConfig>;
}


export interface CampaignParams {
  arbiter: string;
  arbiter_window: u64;
  bond: i128;
  brief_url: string;
  budget: i128;
  cap_views_clip: u64;
  cap_views_human: u64;
  claim_grace: u64;
  dispute_window: u64;
  epoch_len: u64;
  epochs: u32;
  holdback_bps: u32;
  min_views: u64;
  platforms: Array<string>;
  proof_window: u64;
  rate_max_per_1k: i128;
  require_humanity: boolean;
  start: u64;
  title: string;
  token: string;
}


/**
 * Admin-configured platform: expected URL is `url_prefix ‖ video_id ‖ url_suffix`;
 * every `required` byte string must appear in the proof `parameters`.
 */
export interface PlatformConfig {
  required: Array<Buffer>;
  url_prefix: Buffer;
  url_suffix: Buffer;
}

export type ClipEpochStatus = {tag: "Active", values: void} | {tag: "Challenged", values: void} | {tag: "Responded", values: void} | {tag: "Excluded", values: void};

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"InvalidParams"},
  4: {message:"CampaignNotFound"},
  5: {message:"NotJoined"},
  6: {message:"AlreadyJoined"},
  7: {message:"NotHuman"},
  8: {message:"WrongPhase"},
  9: {message:"PlatformNotAllowed"},
  10: {message:"VideoAlreadyRegistered"},
  11: {message:"ClipNotFound"},
  12: {message:"BadSignature"},
  13: {message:"UnknownAttestor"},
  14: {message:"UnknownOwner"},
  15: {message:"UrlMismatch"},
  16: {message:"MatchMismatch"},
  17: {message:"CodeNotFound"},
  18: {message:"ViewsParseError"},
  19: {message:"ProofReused"},
  20: {message:"ProofExpired"},
  21: {message:"EpochNotReady"},
  22: {message:"EpochOutOfRange"},
  23: {message:"AlreadySettled"},
  24: {message:"OpenDisputes"},
  25: {message:"AlreadyClaimed"},
  26: {message:"NothingToClaim"},
  27: {message:"AlreadyDisputed"},
  28: {message:"DisputeNotFound"},
  29: {message:"NotArbiter"},
  30: {message:"NotClipOwner"},
  31: {message:"Excluded"},
  32: {message:"RefundNotReady"},
  33: {message:"AlreadyRefunded"},
  34: {message:"PrevEpochNotSettled"},
  35: {message:"ProofTooLarge"},
  /**
   * `create_campaign_with_swap` before the admin configured a swap router.
   */
  36: {message:"RouterNotSet"},
  /**
   * Swap path must be `[token_in, …, params.token]` with at least two distinct ends.
   */
  37: {message:"BadPath"},
  /**
   * Router call failed (slippage over `amount_in_max`, deadline, liquidity) or delivered too little.
   */
  38: {message:"SwapFailed"},
  /**
   * `join`: the derived participant code is already used by another participant of the campaign.
   */
  39: {message:"CodeTaken"},
  /**
   * `create_campaign`: `params.arbiter` is not on the admin-curated arbiter list.
   */
  40: {message:"ArbiterNotAllowed"},
  /**
   * `accept_admin` without a pending `propose_admin`.
   */
  41: {message:"NoPendingAdmin"}
}















/**
 * A Reclaim claim + attestor signature, exactly as produced by zkFetch (`claimData` + `signatures[0]`).
 */
export interface ReclaimProof {
  /**
 * JCS-canonical `claimData.context` string, byte for byte.
 */
context: Buffer;
  /**
 * Reclaim epoch (not our campaign epoch).
 */
epoch: u32;
  /**
 * `claimData.owner` as lowercase ASCII "0x…".
 */
owner: Buffer;
  /**
 * JCS-canonical `claimData.parameters` string, byte for byte.
 */
parameters: Buffer;
  /**
 * v − 27 (0 or 1)
 */
recovery_id: u32;
  /**
 * r ‖ s
 */
signature: Buffer;
  timestamp_s: u64;
}

export interface Client {
  /**
   * Construct and simulate a join transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  join: ({campaign_id, participant}: {campaign_id: u64, participant: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a owed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  owed: ({who, token}: {who: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim: ({campaign_id, clip_id, epoch}: {campaign_id: u64, clip_id: u64, epoch: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  refund: ({campaign_id}: {campaign_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a router transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  router: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve: ({dispute_id, clipper_wins}: {dispute_id: u64, clipper_wins: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a respond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  respond: ({dispute_id}: {dispute_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a arbiters transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  arbiters: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_clip transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_clip: ({clip_id}: {clip_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Clip>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Withdraw dispute bond payouts and arbiter fees credited to `who` in `token`.
   */
  withdraw: ({who, token}: {who: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a challenge transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  challenge: ({campaign_id, clip_id, epoch, challenger, evidence}: {campaign_id: u64, clip_id: u64, epoch: u32, challenger: string, evidence: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_clips transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * All clips of a campaign (registration order) with their per-epoch state.
   * Unpaginated: reads clips × epochs entries, so the practical limit is a few hundred clips
   * per campaign before simulation hits the read budget (fine at hackathon scale).
   */
  get_clips: ({campaign_id}: {campaign_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<ClipView>>>

  /**
   * Construct and simulate a get_epoch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_epoch: ({id, e}: {id: u64, e: u32}, options?: MethodOptions) => Promise<AssembledTransaction<EpochState>>

  /**
   * Construct and simulate a set_owners transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_owners: ({owners}: {owners: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_router transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Soroswap router used by `create_campaign_with_swap`.
   */
  set_router: ({router}: {router: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_campaign: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Campaign>>

  /**
   * Construct and simulate a set_arbiters transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Curated neutral arbiters a new campaign may name (TM-6). Existing campaigns keep theirs.
   */
  set_arbiters: ({arbiters}: {arbiters: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_platform transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_platform: ({platform, url_prefix, url_suffix, required}: {platform: string, url_prefix: Buffer, url_suffix: Buffer, required: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle_epoch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  settle_epoch: ({campaign_id, epoch}: {campaign_id: u64, epoch: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_proof: ({campaign_id, clip_id, epoch, proof}: {campaign_id: u64, clip_id: u64, epoch: u32, proof: ReclaimProof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a list_disputes transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  list_disputes: ({campaign_id}: {campaign_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Dispute>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 1 of an admin transfer; the new admin must call `accept_admin` (no typo lock-out).
   */
  propose_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_clip transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_clip: ({campaign_id, participant, platform, video_id, proof}: {campaign_id: u64, participant: string, platform: string, video_id: string, proof: ReclaimProof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a set_attestors transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_attestors: ({attestors}: {attestors: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a campaign_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  campaign_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a claim_holdback transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_holdback: ({campaign_id, clip_id, epoch}: {campaign_id: u64, clip_id: u64, epoch: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_clip_epoch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_clip_epoch: ({clip_id, e}: {clip_id: u64, e: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<ClipEpoch>>>

  /**
   * Construct and simulate a create_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_campaign: ({brand, params}: {brand: string, params: CampaignParams}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_participant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_participant: ({id, addr}: {id: u64, addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Participant>>>

  /**
   * Construct and simulate a finalize_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  finalize_dispute: ({dispute_id}: {dispute_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_campaign_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Attestors, owners and platform configs frozen into the campaign at creation.
   */
  get_campaign_config: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<CampaignConfig>>

  /**
   * Construct and simulate a min_response_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  min_response_window: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a set_min_response_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Lower bound (seconds) on the clipper's response time, checked at campaign creation.
   */
  set_min_response_window: ({seconds}: {seconds: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_campaign_with_swap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Funds a campaign with any asset: swaps at most `amount_in_max` of `token_in` into exactly
   * `params.budget` of `params.token` via the Soroswap router (`path` = `[token_in, …, params.token]`,
   * output to the brand), then escrows the budget like `create_campaign`. All or nothing.
   */
  create_campaign_with_swap: ({brand, params, token_in, amount_in_max, path, deadline}: {brand: string, params: CampaignParams, token_in: string, amount_in_max: i128, path: Array<string>, deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, humanity}: {admin: string, humanity: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, humanity}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAEam9pbgAAAAIAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAAAAAAAC3BhcnRpY2lwYW50AAAAABMAAAABAAAD6QAAABAAAAAD",
        "AAAAAAAAAAAAAAAEb3dlZAAAAAIAAAAAAAAAA3dobwAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAAFY2xhaW0AAAAAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAAAAAAdjbGlwX2lkAAAAAAYAAAAAAAAABWVwb2NoAAAAAAAABAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAGcmVmdW5kAAAAAAABAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAGcm91dGVyAAAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAAHcmVzb2x2ZQAAAAACAAAAAAAAAApkaXNwdXRlX2lkAAAAAAAGAAAAAAAAAAxjbGlwcGVyX3dpbnMAAAABAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHcmVzcG9uZAAAAAABAAAAAAAAAApkaXNwdXRlX2lkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAIYXJiaXRlcnMAAAAAAAAAAQAAA+oAAAAT",
        "AAAAAAAAAAAAAAAIZ2V0X2NsaXAAAAABAAAAAAAAAAdjbGlwX2lkAAAAAAYAAAABAAAH0AAAAARDbGlw",
        "AAAAAAAAAExXaXRoZHJhdyBkaXNwdXRlIGJvbmQgcGF5b3V0cyBhbmQgYXJiaXRlciBmZWVzIGNyZWRpdGVkIHRvIGB3aG9gIGluIGB0b2tlbmAuAAAACHdpdGhkcmF3AAAAAgAAAAAAAAADd2hvAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAJY2hhbGxlbmdlAAAAAAAABQAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAACmNoYWxsZW5nZXIAAAAAABMAAAAAAAAACGV2aWRlbmNlAAAAEAAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAPFBbGwgY2xpcHMgb2YgYSBjYW1wYWlnbiAocmVnaXN0cmF0aW9uIG9yZGVyKSB3aXRoIHRoZWlyIHBlci1lcG9jaCBzdGF0ZS4KVW5wYWdpbmF0ZWQ6IHJlYWRzIGNsaXBzIMOXIGVwb2NocyBlbnRyaWVzLCBzbyB0aGUgcHJhY3RpY2FsIGxpbWl0IGlzIGEgZmV3IGh1bmRyZWQgY2xpcHMKcGVyIGNhbXBhaWduIGJlZm9yZSBzaW11bGF0aW9uIGhpdHMgdGhlIHJlYWQgYnVkZ2V0IChmaW5lIGF0IGhhY2thdGhvbiBzY2FsZSkuAAAAAAAACWdldF9jbGlwcwAAAAAAAAEAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAABAAAD6gAAB9AAAAAIQ2xpcFZpZXc=",
        "AAAAAAAAAAAAAAAJZ2V0X2Vwb2NoAAAAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAAAWUAAAAAAAAEAAAAAQAAB9AAAAAKRXBvY2hTdGF0ZQAA",
        "AAAAAAAAAAAAAAAKc2V0X293bmVycwAAAAAAAQAAAAAAAAAGb3duZXJzAAAAAAPqAAAADgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADRTb3Jvc3dhcCByb3V0ZXIgdXNlZCBieSBgY3JlYXRlX2NhbXBhaWduX3dpdGhfc3dhcGAuAAAACnNldF9yb3V0ZXIAAAAAAAEAAAAAAAAABnJvdXRlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMZ2V0X2NhbXBhaWduAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAH0AAAAAhDYW1wYWlnbg==",
        "AAAAAAAAAFhDdXJhdGVkIG5ldXRyYWwgYXJiaXRlcnMgYSBuZXcgY2FtcGFpZ24gbWF5IG5hbWUgKFRNLTYpLiBFeGlzdGluZyBjYW1wYWlnbnMga2VlcCB0aGVpcnMuAAAADHNldF9hcmJpdGVycwAAAAEAAAAAAAAACGFyYml0ZXJzAAAD6gAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMc2V0X3BsYXRmb3JtAAAABAAAAAAAAAAIcGxhdGZvcm0AAAARAAAAAAAAAAp1cmxfcHJlZml4AAAAAAAOAAAAAAAAAAp1cmxfc3VmZml4AAAAAAAOAAAAAAAAAAhyZXF1aXJlZAAAA+oAAAAOAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc2V0dGxlX2Vwb2NoAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc3VibWl0X3Byb29mAAAABAAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAABXByb29mAAAAAAAH0AAAAAxSZWNsYWltUHJvb2YAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAGVSdW5zIG9uY2UgYXQgZGVwbG95LCBzbyBjb25maWd1cmF0aW9uIGNhbm5vdCBiZSBmcm9udC1ydW4uCihgQWxyZWFkeUluaXRpYWxpemVkYCAoMSkgc3RheXMgcmVzZXJ2ZWQuKQAAAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhodW1hbml0eQAAABMAAAAA",
        "AAAAAAAAAAAAAAANbGlzdF9kaXNwdXRlcwAAAAAAAAEAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAABAAAD6gAAB9AAAAAHRGlzcHV0ZQA=",
        "AAAAAAAAAFdTdGVwIDEgb2YgYW4gYWRtaW4gdHJhbnNmZXI7IHRoZSBuZXcgYWRtaW4gbXVzdCBjYWxsIGBhY2NlcHRfYWRtaW5gIChubyB0eXBvIGxvY2stb3V0KS4AAAAADXByb3Bvc2VfYWRtaW4AAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAANcmVnaXN0ZXJfY2xpcAAAAAAAAAUAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAAAAAAAC3BhcnRpY2lwYW50AAAAABMAAAAAAAAACHBsYXRmb3JtAAAAEQAAAAAAAAAIdmlkZW9faWQAAAAQAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAMUmVjbGFpbVByb29mAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAANc2V0X2F0dGVzdG9ycwAAAAAAAAEAAAAAAAAACWF0dGVzdG9ycwAAAAAAA+oAAAPuAAAAFAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAOY2FtcGFpZ25fY291bnQAAAAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAAOY2xhaW1faG9sZGJhY2sAAAAAAAMAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAAAAAAAB2NsaXBfaWQAAAAABgAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAOZ2V0X2NsaXBfZXBvY2gAAAAAAAIAAAAAAAAAB2NsaXBfaWQAAAAABgAAAAAAAAABZQAAAAAAAAQAAAABAAAD6AAAB9AAAAAJQ2xpcEVwb2NoAAAA",
        "AAAAAAAAAAAAAAAPY3JlYXRlX2NhbXBhaWduAAAAAAIAAAAAAAAABWJyYW5kAAAAAAAAEwAAAAAAAAAGcGFyYW1zAAAAAAfQAAAADkNhbXBhaWduUGFyYW1zAAAAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAAAAAAAPZ2V0X3BhcnRpY2lwYW50AAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAARhZGRyAAAAEwAAAAEAAAPoAAAH0AAAAAtQYXJ0aWNpcGFudAA=",
        "AAAAAAAAAAAAAAAQZmluYWxpemVfZGlzcHV0ZQAAAAEAAAAAAAAACmRpc3B1dGVfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAExBdHRlc3RvcnMsIG93bmVycyBhbmQgcGxhdGZvcm0gY29uZmlncyBmcm96ZW4gaW50byB0aGUgY2FtcGFpZ24gYXQgY3JlYXRpb24uAAAAE2dldF9jYW1wYWlnbl9jb25maWcAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAH0AAAAA5DYW1wYWlnbkNvbmZpZwAA",
        "AAAAAAAAAAAAAAATbWluX3Jlc3BvbnNlX3dpbmRvdwAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAFNMb3dlciBib3VuZCAoc2Vjb25kcykgb24gdGhlIGNsaXBwZXIncyByZXNwb25zZSB0aW1lLCBjaGVja2VkIGF0IGNhbXBhaWduIGNyZWF0aW9uLgAAAAAXc2V0X21pbl9yZXNwb25zZV93aW5kb3cAAAAAAQAAAAAAAAAHc2Vjb25kcwAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAARRGdW5kcyBhIGNhbXBhaWduIHdpdGggYW55IGFzc2V0OiBzd2FwcyBhdCBtb3N0IGBhbW91bnRfaW5fbWF4YCBvZiBgdG9rZW5faW5gIGludG8gZXhhY3RseQpgcGFyYW1zLmJ1ZGdldGAgb2YgYHBhcmFtcy50b2tlbmAgdmlhIHRoZSBTb3Jvc3dhcCByb3V0ZXIgKGBwYXRoYCA9IGBbdG9rZW5faW4sIOKApiwgcGFyYW1zLnRva2VuXWAsCm91dHB1dCB0byB0aGUgYnJhbmQpLCB0aGVuIGVzY3Jvd3MgdGhlIGJ1ZGdldCBsaWtlIGBjcmVhdGVfY2FtcGFpZ25gLiBBbGwgb3Igbm90aGluZy4AAAAZY3JlYXRlX2NhbXBhaWduX3dpdGhfc3dhcAAAAAAAAAYAAAAAAAAABWJyYW5kAAAAAAAAEwAAAAAAAAAGcGFyYW1zAAAAAAfQAAAADkNhbXBhaWduUGFyYW1zAAAAAAAAAAAACHRva2VuX2luAAAAEwAAAAAAAAANYW1vdW50X2luX21heAAAAAAAAAsAAAAAAAAABHBhdGgAAAPqAAAAEwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAQAAAAAAAAAAAAAABENsaXAAAAAJAAAAAAAAAAhiYXNlbGluZQAAAAYAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAAAAAAAC2ZpcnN0X2Vwb2NoAAAAAAQAAAAAAAAAA2h3bQAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAhwbGF0Zm9ybQAAABEAAAAAAAAADXJlZ2lzdGVyZWRfYXQAAAAAAAAGAAAAAAAAAAh2aWRlb19pZAAAABA=",
        "AAAAAQAAAAAAAAAAAAAAB0Rpc3B1dGUAAAAACAAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAKY2hhbGxlbmdlcgAAAAAAEwAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAACGV2aWRlbmNlAAAAEAAAAAAAAAACaWQAAAAAAAYAAAAAAAAACW9wZW5lZF9hdAAAAAAAAAYAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA1EaXNwdXRlU3RhdHVzAAAA",
        "AAAAAQAAAAAAAAAAAAAACENhbXBhaWduAAAACAAAAAAAAAAHYmFsYW5jZQAAAAALAAAAAAAAAAVicmFuZAAAAAAAABMAAAAAAAAABWNsaXBzAAAAAAAABAAAAAAAAAACaWQAAAAAAAYAAAAAAAAABnBhcmFtcwAAAAAH0AAAAA5DYW1wYWlnblBhcmFtcwAAAAAAAAAAAAxwYXJ0aWNpcGFudHMAAAAEAAAAAAAAAAhyZWZ1bmRlZAAAAAEAAAAAAAAADnNldHRsZWRfZXBvY2hzAAAAAAAE",
        "AAAAAQAAAFZDbGlwIHBsdXMgaXRzIHBlci1lcG9jaCBzdGF0ZSAoaW5kZXggPSBlcG9jaDsgYE5vbmVgID0gbm8gY2xvc2UgcHJvb2YgZm9yIHRoYXQgZXBvY2gpLgAAAAAAAAAAAAhDbGlwVmlldwAAAAIAAAAAAAAABGNsaXAAAAfQAAAABENsaXAAAAAAAAAABmVwb2NocwAAAAAD6gAAA+gAAAfQAAAACUNsaXBFcG9jaAAAAA==",
        "AAAAAQAAAAAAAAAAAAAACUNsaXBFcG9jaAAAAAAAAAcAAAAAAAAABWFsaXZlAAAAAAAAAQAAAAAAAAAIYmFzZWxpbmUAAAAGAAAAAAAAAAdjbGFpbWVkAAAAAAEAAAAAAAAAEGhvbGRiYWNrX2NsYWltZWQAAAABAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAPQ2xpcEVwb2NoU3RhdHVzAAAAAAAAAAAFdmlld3MAAAAAAAAGAAAAAAAAAAZ3ZWlnaHQAAAAAAAY=",
        "AAAAAQAAAAAAAAAAAAAACkVwb2NoU3RhdGUAAAAAAAgAAAAAAAAABmJ1ZGdldAAAAAAACwAAAAAAAAANaGVsZF9zdXJ2aXZlZAAAAAAAAAsAAAAAAAAACmhlbGRfdG90YWwAAAAAAAsAAAAAAAAADW9wZW5fZGlzcHV0ZXMAAAAAAAAEAAAAAAAAAARyYXRlAAAACwAAAAAAAAAHc2V0dGxlZAAAAAABAAAAAAAAAAVzcGVudAAAAAAAAAsAAAAAAAAADHRvdGFsX3dlaWdodAAAAAY=",
        "AAAAAQAAAAAAAAAAAAAAC1BhcnRpY2lwYW50AAAAAAMAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAEY29kZQAAABAAAAAAAAAACWpvaW5lZF9hdAAAAAAAAAY=",
        "AAAAAgAAAAAAAAAAAAAADURpc3B1dGVTdGF0dXMAAAAAAAAEAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAACVJlc3BvbmRlZAAAAAAAAAAAAAAAAAAADUNoYWxsZW5nZXJXb24AAAAAAAAAAAAAAAAAAApDbGlwcGVyV29uAAA=",
        "AAAAAQAAAJ5WZXJpZmljYXRpb24gY29uZmlnIGZyb3plbiBpbnRvIGEgY2FtcGFpZ24gYXQgY3JlYXRpb24gKFRNLTEpOiBsYXRlciBhZG1pbiBjaGFuZ2VzIHRvCmF0dGVzdG9ycywgb3duZXJzIG9yIHBsYXRmb3JtcyBvbmx5IGFmZmVjdCBjYW1wYWlnbnMgY3JlYXRlZCBhZnRlcndhcmRzLgAAAAAAAAAAAA5DYW1wYWlnbkNvbmZpZwAAAAAAAwAAAAAAAAAJYXR0ZXN0b3JzAAAAAAAD6gAAA+4AAAAUAAAAAAAAAAZvd25lcnMAAAAAA+oAAAAOAAAAAAAAAAlwbGF0Zm9ybXMAAAAAAAPsAAAAEQAAB9AAAAAOUGxhdGZvcm1Db25maWcAAA==",
        "AAAAAQAAAAAAAAAAAAAADkNhbXBhaWduUGFyYW1zAAAAAAAUAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAADmFyYml0ZXJfd2luZG93AAAAAAAGAAAAAAAAAARib25kAAAACwAAAAAAAAAJYnJpZWZfdXJsAAAAAAAAEAAAAAAAAAAGYnVkZ2V0AAAAAAALAAAAAAAAAA5jYXBfdmlld3NfY2xpcAAAAAAABgAAAAAAAAAPY2FwX3ZpZXdzX2h1bWFuAAAAAAYAAAAAAAAAC2NsYWltX2dyYWNlAAAAAAYAAAAAAAAADmRpc3B1dGVfd2luZG93AAAAAAAGAAAAAAAAAAllcG9jaF9sZW4AAAAAAAAGAAAAAAAAAAZlcG9jaHMAAAAAAAQAAAAAAAAADGhvbGRiYWNrX2JwcwAAAAQAAAAAAAAACW1pbl92aWV3cwAAAAAAAAYAAAAAAAAACXBsYXRmb3JtcwAAAAAAA+oAAAARAAAAAAAAAAxwcm9vZl93aW5kb3cAAAAGAAAAAAAAAA9yYXRlX21heF9wZXJfMWsAAAAACwAAAAAAAAAQcmVxdWlyZV9odW1hbml0eQAAAAEAAAAAAAAABXN0YXJ0AAAAAAAABgAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAV0b2tlbgAAAAAAABM=",
        "AAAAAQAAAJhBZG1pbi1jb25maWd1cmVkIHBsYXRmb3JtOiBleHBlY3RlZCBVUkwgaXMgYHVybF9wcmVmaXgg4oCWIHZpZGVvX2lkIOKAliB1cmxfc3VmZml4YDsKZXZlcnkgYHJlcXVpcmVkYCBieXRlIHN0cmluZyBtdXN0IGFwcGVhciBpbiB0aGUgcHJvb2YgYHBhcmFtZXRlcnNgLgAAAAAAAAAOUGxhdGZvcm1Db25maWcAAAAAAAMAAAAAAAAACHJlcXVpcmVkAAAD6gAAAA4AAAAAAAAACnVybF9wcmVmaXgAAAAAAA4AAAAAAAAACnVybF9zdWZmaXgAAAAAAA4=",
        "AAAAAgAAAAAAAAAAAAAAD0NsaXBFcG9jaFN0YXR1cwAAAAAEAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAApDaGFsbGVuZ2VkAAAAAAAAAAAAAAAAAAlSZXNwb25kZWQAAAAAAAAAAAAAAAAAAAhFeGNsdWRlZA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAKQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAANSW52YWxpZFBhcmFtcwAAAAAAAAMAAAAAAAAAEENhbXBhaWduTm90Rm91bmQAAAAEAAAAAAAAAAlOb3RKb2luZWQAAAAAAAAFAAAAAAAAAA1BbHJlYWR5Sm9pbmVkAAAAAAAABgAAAAAAAAAITm90SHVtYW4AAAAHAAAAAAAAAApXcm9uZ1BoYXNlAAAAAAAIAAAAAAAAABJQbGF0Zm9ybU5vdEFsbG93ZWQAAAAAAAkAAAAAAAAAFlZpZGVvQWxyZWFkeVJlZ2lzdGVyZWQAAAAAAAoAAAAAAAAADENsaXBOb3RGb3VuZAAAAAsAAAAAAAAADEJhZFNpZ25hdHVyZQAAAAwAAAAAAAAAD1Vua25vd25BdHRlc3RvcgAAAAANAAAAAAAAAAxVbmtub3duT3duZXIAAAAOAAAAAAAAAAtVcmxNaXNtYXRjaAAAAAAPAAAAAAAAAA1NYXRjaE1pc21hdGNoAAAAAAAAEAAAAAAAAAAMQ29kZU5vdEZvdW5kAAAAEQAAAAAAAAAPVmlld3NQYXJzZUVycm9yAAAAABIAAAAAAAAAC1Byb29mUmV1c2VkAAAAABMAAAAAAAAADFByb29mRXhwaXJlZAAAABQAAAAAAAAADUVwb2NoTm90UmVhZHkAAAAAAAAVAAAAAAAAAA9FcG9jaE91dE9mUmFuZ2UAAAAAFgAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAABcAAAAAAAAADE9wZW5EaXNwdXRlcwAAABgAAAAAAAAADkFscmVhZHlDbGFpbWVkAAAAAAAZAAAAAAAAAA5Ob3RoaW5nVG9DbGFpbQAAAAAAGgAAAAAAAAAPQWxyZWFkeURpc3B1dGVkAAAAABsAAAAAAAAAD0Rpc3B1dGVOb3RGb3VuZAAAAAAcAAAAAAAAAApOb3RBcmJpdGVyAAAAAAAdAAAAAAAAAAxOb3RDbGlwT3duZXIAAAAeAAAAAAAAAAhFeGNsdWRlZAAAAB8AAAAAAAAADlJlZnVuZE5vdFJlYWR5AAAAAAAgAAAAAAAAAA9BbHJlYWR5UmVmdW5kZWQAAAAAIQAAAAAAAAATUHJldkVwb2NoTm90U2V0dGxlZAAAAAAiAAAAAAAAAA1Qcm9vZlRvb0xhcmdlAAAAAAAAIwAAAEZgY3JlYXRlX2NhbXBhaWduX3dpdGhfc3dhcGAgYmVmb3JlIHRoZSBhZG1pbiBjb25maWd1cmVkIGEgc3dhcCByb3V0ZXIuAAAAAAAMUm91dGVyTm90U2V0AAAAJAAAAFJTd2FwIHBhdGggbXVzdCBiZSBgW3Rva2VuX2luLCDigKYsIHBhcmFtcy50b2tlbl1gIHdpdGggYXQgbGVhc3QgdHdvIGRpc3RpbmN0IGVuZHMuAAAAAAAHQmFkUGF0aAAAAAAlAAAAYFJvdXRlciBjYWxsIGZhaWxlZCAoc2xpcHBhZ2Ugb3ZlciBgYW1vdW50X2luX21heGAsIGRlYWRsaW5lLCBsaXF1aWRpdHkpIG9yIGRlbGl2ZXJlZCB0b28gbGl0dGxlLgAAAApTd2FwRmFpbGVkAAAAAAAmAAAAXGBqb2luYDogdGhlIGRlcml2ZWQgcGFydGljaXBhbnQgY29kZSBpcyBhbHJlYWR5IHVzZWQgYnkgYW5vdGhlciBwYXJ0aWNpcGFudCBvZiB0aGUgY2FtcGFpZ24uAAAACUNvZGVUYWtlbgAAAAAAACcAAABNYGNyZWF0ZV9jYW1wYWlnbmA6IGBwYXJhbXMuYXJiaXRlcmAgaXMgbm90IG9uIHRoZSBhZG1pbi1jdXJhdGVkIGFyYml0ZXIgbGlzdC4AAAAAAAARQXJiaXRlck5vdEFsbG93ZWQAAAAAAAAoAAAAMWBhY2NlcHRfYWRtaW5gIHdpdGhvdXQgYSBwZW5kaW5nIGBwcm9wb3NlX2FkbWluYC4AAAAAAAAOTm9QZW5kaW5nQWRtaW4AAAAAACk=",
        "AAAABQAAAAAAAAAAAAAABkpvaW5lZAAAAAAAAQAAAAZqb2luZWQAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAALcGFydGljaXBhbnQAAAAAEwAAAAAAAAAAAAAABGNvZGUAAAAQAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAAB0NsYWltZWQAAAAAAQAAAAdjbGFpbWVkAAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAAAAAAAAAAACdG8AAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAQAAAAdzZXR0bGVkAAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAAAAAAAAAAAEcmF0ZQAAAAsAAAAAAAAAAAAAAAVzcGVudAAAAAAAAAsAAAAAAAAAAAAAAAx0b3RhbF93ZWlnaHQAAAAGAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAACFJlZnVuZGVkAAAAAQAAAAZyZWZ1bmQAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFYnJhbmQAAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAACFJlc29sdmVkAAAAAQAAAAhyZXNvbHZlZAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAKZGlzcHV0ZV9pZAAAAAAABgAAAAAAAAAAAAAADGNsaXBwZXJfd2lucwAAAAEAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAACVJlc3BvbmRlZAAAAAAAAAEAAAAHcmVzcG9uZAAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAACmRpc3B1dGVfaWQAAAAAAAYAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAACkNoYWxsZW5nZWQAAAAAAAEAAAAJY2hhbGxlbmdlAAAAAAAABQAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAApkaXNwdXRlX2lkAAAAAAAGAAAAAAAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAAAAAAAAAAAKY2hhbGxlbmdlcgAAAAAAEwAAAAAAAAAB",
        "AAAABQAAAIBDYW1wYWlnbiBmdW5kZWQgdGhyb3VnaCBhIHN3YXA6IGBhbW91bnRfaW5gIG9mIGB0b2tlbl9pbmAgYmVjYW1lIGV4YWN0bHkgYGJ1ZGdldGAgb2YgdGhlCmNhbXBhaWduIHRva2VuIChzZWUgYENhbXBhaWduQ3JlYXRlZGApLgAAAAAAAAAKU3dhcEZ1bmRlZAAAAAAAAQAAAAhzd2FwZnVuZAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAIdG9rZW5faW4AAAATAAAAAAAAAAAAAAAJYW1vdW50X2luAAAAAAAACwAAAAAAAAAB",
        "AAAABQAAAAAAAAAAAAAADEFkbWluQ2hhbmdlZAAAAAEAAAAFYWRtaW4AAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAADVByb29mQWNjZXB0ZWQAAAAAAAABAAAABXByb29mAAAAAAAABQAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAdjbGlwX2lkAAAAAAYAAAAAAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAAAAAAAAV2aWV3cwAAAAAAAAYAAAAAAAAAAAAAAAZ3ZWlnaHQAAAAAAAYAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAADkNsaXBSZWdpc3RlcmVkAAAAAAABAAAABGNsaXAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAAB2NsaXBfaWQAAAAABgAAAAAAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAAAAAACHBsYXRmb3JtAAAAEQAAAAAAAAAAAAAACHZpZGVvX2lkAAAAEAAAAAAAAAAAAAAACGJhc2VsaW5lAAAABgAAAAAAAAAB",
        "AAAABQAAAAAAAAAAAAAAD0NhbXBhaWduQ3JlYXRlZAAAAAABAAAACGNhbXBhaWduAAAABAAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVicmFuZAAAAAAAABMAAAAAAAAAAAAAAAZidWRnZXQAAAAAAAsAAAAAAAAAAAAAAAZlcG9jaHMAAAAAAAQAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAAD0hvbGRiYWNrQ2xhaW1lZAAAAAABAAAAB2hiY2xhaW0AAAAABQAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAdjbGlwX2lkAAAAAAYAAAAAAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAB",
        "AAAAAQAAAGVBIFJlY2xhaW0gY2xhaW0gKyBhdHRlc3RvciBzaWduYXR1cmUsIGV4YWN0bHkgYXMgcHJvZHVjZWQgYnkgemtGZXRjaCAoYGNsYWltRGF0YWAgKyBgc2lnbmF0dXJlc1swXWApLgAAAAAAAAAAAAAMUmVjbGFpbVByb29mAAAABwAAADhKQ1MtY2Fub25pY2FsIGBjbGFpbURhdGEuY29udGV4dGAgc3RyaW5nLCBieXRlIGZvciBieXRlLgAAAAdjb250ZXh0AAAAAA4AAAAnUmVjbGFpbSBlcG9jaCAobm90IG91ciBjYW1wYWlnbiBlcG9jaCkuAAAAAAVlcG9jaAAAAAAAAAQAAAAtYGNsYWltRGF0YS5vd25lcmAgYXMgbG93ZXJjYXNlIEFTQ0lJICIweOKApiIuAAAAAAAABW93bmVyAAAAAAAADgAAADtKQ1MtY2Fub25pY2FsIGBjbGFpbURhdGEucGFyYW1ldGVyc2Agc3RyaW5nLCBieXRlIGZvciBieXRlLgAAAAAKcGFyYW1ldGVycwAAAAAADgAAABF2IOKIkiAyNyAoMCBvciAxKQAAAAAAAAtyZWNvdmVyeV9pZAAAAAAEAAAAB3Ig4oCWIHMAAAAACXNpZ25hdHVyZQAAAAAAA+4AAABAAAAAAAAAAAt0aW1lc3RhbXBfcwAAAAAG" ]),
      options
    )
  }
  public readonly fromJSON = {
    join: this.txFromJSON<Result<string>>,
        owed: this.txFromJSON<i128>,
        admin: this.txFromJSON<Result<string>>,
        claim: this.txFromJSON<Result<i128>>,
        refund: this.txFromJSON<Result<i128>>,
        router: this.txFromJSON<Option<string>>,
        resolve: this.txFromJSON<Result<void>>,
        respond: this.txFromJSON<Result<void>>,
        arbiters: this.txFromJSON<Array<string>>,
        get_clip: this.txFromJSON<Clip>,
        withdraw: this.txFromJSON<Result<i128>>,
        challenge: this.txFromJSON<Result<u64>>,
        get_clips: this.txFromJSON<Array<ClipView>>,
        get_epoch: this.txFromJSON<EpochState>,
        set_owners: this.txFromJSON<Result<void>>,
        set_router: this.txFromJSON<Result<void>>,
        accept_admin: this.txFromJSON<Result<void>>,
        get_campaign: this.txFromJSON<Campaign>,
        set_arbiters: this.txFromJSON<Result<void>>,
        set_platform: this.txFromJSON<Result<void>>,
        settle_epoch: this.txFromJSON<Result<void>>,
        submit_proof: this.txFromJSON<Result<void>>,
        list_disputes: this.txFromJSON<Array<Dispute>>,
        propose_admin: this.txFromJSON<Result<void>>,
        register_clip: this.txFromJSON<Result<u64>>,
        set_attestors: this.txFromJSON<Result<void>>,
        campaign_count: this.txFromJSON<u64>,
        claim_holdback: this.txFromJSON<Result<i128>>,
        get_clip_epoch: this.txFromJSON<Option<ClipEpoch>>,
        create_campaign: this.txFromJSON<Result<u64>>,
        get_participant: this.txFromJSON<Option<Participant>>,
        finalize_dispute: this.txFromJSON<Result<void>>,
        get_campaign_config: this.txFromJSON<CampaignConfig>,
        min_response_window: this.txFromJSON<u64>,
        set_min_response_window: this.txFromJSON<Result<void>>,
        create_campaign_with_swap: this.txFromJSON<Result<u64>>
  }
}