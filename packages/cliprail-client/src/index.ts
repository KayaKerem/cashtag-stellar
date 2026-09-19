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
  35: {message:"ProofTooLarge"}
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
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim: ({campaign_id, clip_id, epoch}: {campaign_id: u64, clip_id: u64, epoch: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  refund: ({campaign_id}: {campaign_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve: ({dispute_id, clipper_wins}: {dispute_id: u64, clipper_wins: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a respond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  respond: ({dispute_id}: {dispute_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_clip transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_clip: ({clip_id}: {clip_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Clip>>

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
   * Construct and simulate a get_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_campaign: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Campaign>>

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
        "AAAAAAAAAAAAAAAFY2xhaW0AAAAAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAAAAAAdjbGlwX2lkAAAAAAYAAAAAAAAABWVwb2NoAAAAAAAABAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAGcmVmdW5kAAAAAAABAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAHcmVzb2x2ZQAAAAACAAAAAAAAAApkaXNwdXRlX2lkAAAAAAAGAAAAAAAAAAxjbGlwcGVyX3dpbnMAAAABAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHcmVzcG9uZAAAAAABAAAAAAAAAApkaXNwdXRlX2lkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAIZ2V0X2NsaXAAAAABAAAAAAAAAAdjbGlwX2lkAAAAAAYAAAABAAAH0AAAAARDbGlw",
        "AAAAAAAAAAAAAAAJY2hhbGxlbmdlAAAAAAAABQAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAACmNoYWxsZW5nZXIAAAAAABMAAAAAAAAACGV2aWRlbmNlAAAAEAAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAPFBbGwgY2xpcHMgb2YgYSBjYW1wYWlnbiAocmVnaXN0cmF0aW9uIG9yZGVyKSB3aXRoIHRoZWlyIHBlci1lcG9jaCBzdGF0ZS4KVW5wYWdpbmF0ZWQ6IHJlYWRzIGNsaXBzIMOXIGVwb2NocyBlbnRyaWVzLCBzbyB0aGUgcHJhY3RpY2FsIGxpbWl0IGlzIGEgZmV3IGh1bmRyZWQgY2xpcHMKcGVyIGNhbXBhaWduIGJlZm9yZSBzaW11bGF0aW9uIGhpdHMgdGhlIHJlYWQgYnVkZ2V0IChmaW5lIGF0IGhhY2thdGhvbiBzY2FsZSkuAAAAAAAACWdldF9jbGlwcwAAAAAAAAEAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAABAAAD6gAAB9AAAAAIQ2xpcFZpZXc=",
        "AAAAAAAAAAAAAAAJZ2V0X2Vwb2NoAAAAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAAAWUAAAAAAAAEAAAAAQAAB9AAAAAKRXBvY2hTdGF0ZQAA",
        "AAAAAAAAAAAAAAAKc2V0X293bmVycwAAAAAAAQAAAAAAAAAGb3duZXJzAAAAAAPqAAAADgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMZ2V0X2NhbXBhaWduAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAH0AAAAAhDYW1wYWlnbg==",
        "AAAAAAAAAAAAAAAMc2V0X3BsYXRmb3JtAAAABAAAAAAAAAAIcGxhdGZvcm0AAAARAAAAAAAAAAp1cmxfcHJlZml4AAAAAAAOAAAAAAAAAAp1cmxfc3VmZml4AAAAAAAOAAAAAAAAAAhyZXF1aXJlZAAAA+oAAAAOAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc2V0dGxlX2Vwb2NoAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc3VibWl0X3Byb29mAAAABAAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAABXByb29mAAAAAAAH0AAAAAxSZWNsYWltUHJvb2YAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAGVSdW5zIG9uY2UgYXQgZGVwbG95LCBzbyBjb25maWd1cmF0aW9uIGNhbm5vdCBiZSBmcm9udC1ydW4uCihgQWxyZWFkeUluaXRpYWxpemVkYCAoMSkgc3RheXMgcmVzZXJ2ZWQuKQAAAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhodW1hbml0eQAAABMAAAAA",
        "AAAAAAAAAAAAAAANbGlzdF9kaXNwdXRlcwAAAAAAAAEAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAABAAAD6gAAB9AAAAAHRGlzcHV0ZQA=",
        "AAAAAAAAAAAAAAANcmVnaXN0ZXJfY2xpcAAAAAAAAAUAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAAAAAAAC3BhcnRpY2lwYW50AAAAABMAAAAAAAAACHBsYXRmb3JtAAAAEQAAAAAAAAAIdmlkZW9faWQAAAAQAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAMUmVjbGFpbVByb29mAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAANc2V0X2F0dGVzdG9ycwAAAAAAAAEAAAAAAAAACWF0dGVzdG9ycwAAAAAAA+oAAAPuAAAAFAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAOY2FtcGFpZ25fY291bnQAAAAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAAOY2xhaW1faG9sZGJhY2sAAAAAAAMAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAAAAAAAB2NsaXBfaWQAAAAABgAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAOZ2V0X2NsaXBfZXBvY2gAAAAAAAIAAAAAAAAAB2NsaXBfaWQAAAAABgAAAAAAAAABZQAAAAAAAAQAAAABAAAD6AAAB9AAAAAJQ2xpcEVwb2NoAAAA",
        "AAAAAAAAAAAAAAAPY3JlYXRlX2NhbXBhaWduAAAAAAIAAAAAAAAABWJyYW5kAAAAAAAAEwAAAAAAAAAGcGFyYW1zAAAAAAfQAAAADkNhbXBhaWduUGFyYW1zAAAAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAAAAAAAPZ2V0X3BhcnRpY2lwYW50AAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAARhZGRyAAAAEwAAAAEAAAPoAAAH0AAAAAtQYXJ0aWNpcGFudAA=",
        "AAAAAAAAAAAAAAAQZmluYWxpemVfZGlzcHV0ZQAAAAEAAAAAAAAACmRpc3B1dGVfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAQAAAAAAAAAAAAAABENsaXAAAAAJAAAAAAAAAAhiYXNlbGluZQAAAAYAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAYAAAAAAAAAC2ZpcnN0X2Vwb2NoAAAAAAQAAAAAAAAAA2h3bQAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAhwbGF0Zm9ybQAAABEAAAAAAAAADXJlZ2lzdGVyZWRfYXQAAAAAAAAGAAAAAAAAAAh2aWRlb19pZAAAABA=",
        "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AAAAIQAAAAAAAAATUHJldkVwb2NoTm90U2V0dGxlZAAAAAAiAAAAAAAAAA1Qcm9vZlRvb0xhcmdlAAAAAAAAIw==",
        "AAAABQAAAAAAAAAAAAAABkpvaW5lZAAAAAAAAQAAAAZqb2luZWQAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAALcGFydGljaXBhbnQAAAAAEwAAAAAAAAAAAAAABGNvZGUAAAAQAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAAB0NsYWltZWQAAAAAAQAAAAdjbGFpbWVkAAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAAAAAAAAAAACdG8AAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAQAAAAdzZXR0bGVkAAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAAAAAAAAAAAEcmF0ZQAAAAsAAAAAAAAAAAAAAAVzcGVudAAAAAAAAAsAAAAAAAAAAAAAAAx0b3RhbF93ZWlnaHQAAAAGAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAACFJlZnVuZGVkAAAAAQAAAAZyZWZ1bmQAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFYnJhbmQAAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAACFJlc29sdmVkAAAAAQAAAAhyZXNvbHZlZAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAKZGlzcHV0ZV9pZAAAAAAABgAAAAAAAAAAAAAADGNsaXBwZXJfd2lucwAAAAEAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAACVJlc3BvbmRlZAAAAAAAAAEAAAAHcmVzcG9uZAAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAACmRpc3B1dGVfaWQAAAAAAAYAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAACkNoYWxsZW5nZWQAAAAAAAEAAAAJY2hhbGxlbmdlAAAAAAAABQAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAApkaXNwdXRlX2lkAAAAAAAGAAAAAAAAAAAAAAAHY2xpcF9pZAAAAAAGAAAAAAAAAAAAAAAFZXBvY2gAAAAAAAAEAAAAAAAAAAAAAAAKY2hhbGxlbmdlcgAAAAAAEwAAAAAAAAAB",
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
        claim: this.txFromJSON<Result<i128>>,
        refund: this.txFromJSON<Result<i128>>,
        resolve: this.txFromJSON<Result<void>>,
        respond: this.txFromJSON<Result<void>>,
        get_clip: this.txFromJSON<Clip>,
        challenge: this.txFromJSON<Result<u64>>,
        get_clips: this.txFromJSON<Array<ClipView>>,
        get_epoch: this.txFromJSON<EpochState>,
        set_owners: this.txFromJSON<Result<void>>,
        get_campaign: this.txFromJSON<Campaign>,
        set_platform: this.txFromJSON<Result<void>>,
        settle_epoch: this.txFromJSON<Result<void>>,
        submit_proof: this.txFromJSON<Result<void>>,
        list_disputes: this.txFromJSON<Array<Dispute>>,
        register_clip: this.txFromJSON<Result<u64>>,
        set_attestors: this.txFromJSON<Result<void>>,
        campaign_count: this.txFromJSON<u64>,
        claim_holdback: this.txFromJSON<Result<i128>>,
        get_clip_epoch: this.txFromJSON<Option<ClipEpoch>>,
        create_campaign: this.txFromJSON<Result<u64>>,
        get_participant: this.txFromJSON<Option<Participant>>,
        finalize_dispute: this.txFromJSON<Result<void>>
  }
}