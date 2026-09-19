import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, Result } from "@stellar/stellar-sdk/contract";
import type { u32, u64, i128, Option } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly testnet: {
        readonly networkPassphrase: "Test SDF Network ; September 2015";
        readonly contractId: "CCICEPQCY25RNF5SAJ3FPUXPXEIRQ3GOUMSVZGVCHRJ6L6Q3FHJL3TST";
    };
};
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
export type DisputeStatus = {
    tag: "Open";
    values: void;
} | {
    tag: "Responded";
    values: void;
} | {
    tag: "ChallengerWon";
    values: void;
} | {
    tag: "ClipperWon";
    values: void;
};
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
export type ClipEpochStatus = {
    tag: "Active";
    values: void;
} | {
    tag: "Challenged";
    values: void;
} | {
    tag: "Responded";
    values: void;
} | {
    tag: "Excluded";
    values: void;
};
export declare const Errors: {
    1: {
        message: string;
    };
    2: {
        message: string;
    };
    3: {
        message: string;
    };
    4: {
        message: string;
    };
    5: {
        message: string;
    };
    6: {
        message: string;
    };
    7: {
        message: string;
    };
    8: {
        message: string;
    };
    9: {
        message: string;
    };
    10: {
        message: string;
    };
    11: {
        message: string;
    };
    12: {
        message: string;
    };
    13: {
        message: string;
    };
    14: {
        message: string;
    };
    15: {
        message: string;
    };
    16: {
        message: string;
    };
    17: {
        message: string;
    };
    18: {
        message: string;
    };
    19: {
        message: string;
    };
    20: {
        message: string;
    };
    21: {
        message: string;
    };
    22: {
        message: string;
    };
    23: {
        message: string;
    };
    24: {
        message: string;
    };
    25: {
        message: string;
    };
    26: {
        message: string;
    };
    27: {
        message: string;
    };
    28: {
        message: string;
    };
    29: {
        message: string;
    };
    30: {
        message: string;
    };
    31: {
        message: string;
    };
    32: {
        message: string;
    };
    33: {
        message: string;
    };
    34: {
        message: string;
    };
    35: {
        message: string;
    };
};
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
    join: ({ campaign_id, participant }: {
        campaign_id: u64;
        participant: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>;
    /**
     * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    claim: ({ campaign_id, clip_id, epoch }: {
        campaign_id: u64;
        clip_id: u64;
        epoch: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>;
    /**
     * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    refund: ({ campaign_id }: {
        campaign_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>;
    /**
     * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    resolve: ({ dispute_id, clipper_wins }: {
        dispute_id: u64;
        clipper_wins: boolean;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a respond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    respond: ({ dispute_id }: {
        dispute_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a get_clip transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_clip: ({ clip_id }: {
        clip_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Clip>>;
    /**
     * Construct and simulate a challenge transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    challenge: ({ campaign_id, clip_id, epoch, challenger, evidence }: {
        campaign_id: u64;
        clip_id: u64;
        epoch: u32;
        challenger: string;
        evidence: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>;
    /**
     * Construct and simulate a get_clips transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * All clips of a campaign (registration order) with their per-epoch state.
     * Unpaginated: reads clips × epochs entries, so the practical limit is a few hundred clips
     * per campaign before simulation hits the read budget (fine at hackathon scale).
     */
    get_clips: ({ campaign_id }: {
        campaign_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<ClipView>>>;
    /**
     * Construct and simulate a get_epoch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_epoch: ({ id, e }: {
        id: u64;
        e: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<EpochState>>;
    /**
     * Construct and simulate a set_owners transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_owners: ({ owners }: {
        owners: Array<Buffer>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a get_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_campaign: ({ id }: {
        id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Campaign>>;
    /**
     * Construct and simulate a set_platform transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_platform: ({ platform, url_prefix, url_suffix, required }: {
        platform: string;
        url_prefix: Buffer;
        url_suffix: Buffer;
        required: Array<Buffer>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a settle_epoch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    settle_epoch: ({ campaign_id, epoch }: {
        campaign_id: u64;
        epoch: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a submit_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    submit_proof: ({ campaign_id, clip_id, epoch, proof }: {
        campaign_id: u64;
        clip_id: u64;
        epoch: u32;
        proof: ReclaimProof;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a list_disputes transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    list_disputes: ({ campaign_id }: {
        campaign_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<Dispute>>>;
    /**
     * Construct and simulate a register_clip transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    register_clip: ({ campaign_id, participant, platform, video_id, proof }: {
        campaign_id: u64;
        participant: string;
        platform: string;
        video_id: string;
        proof: ReclaimProof;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>;
    /**
     * Construct and simulate a set_attestors transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_attestors: ({ attestors }: {
        attestors: Array<Buffer>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a campaign_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    campaign_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
    /**
     * Construct and simulate a claim_holdback transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    claim_holdback: ({ campaign_id, clip_id, epoch }: {
        campaign_id: u64;
        clip_id: u64;
        epoch: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>;
    /**
     * Construct and simulate a get_clip_epoch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_clip_epoch: ({ clip_id, e }: {
        clip_id: u64;
        e: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Option<ClipEpoch>>>;
    /**
     * Construct and simulate a create_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    create_campaign: ({ brand, params }: {
        brand: string;
        params: CampaignParams;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>;
    /**
     * Construct and simulate a get_participant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_participant: ({ id, addr }: {
        id: u64;
        addr: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Option<Participant>>>;
    /**
     * Construct and simulate a finalize_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    finalize_dispute: ({ dispute_id }: {
        dispute_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Constructor/Initialization Args for the contract's `__constructor` method */
    { admin, humanity }: {
        admin: string;
        humanity: string;
    }, 
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
    }): Promise<AssembledTransaction<T>>;
    constructor(options: ContractClientOptions);
    readonly fromJSON: {
        join: (json: string) => AssembledTransaction<Result<string, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        claim: (json: string) => AssembledTransaction<Result<bigint, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        refund: (json: string) => AssembledTransaction<Result<bigint, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        resolve: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        respond: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_clip: (json: string) => AssembledTransaction<Clip>;
        challenge: (json: string) => AssembledTransaction<Result<bigint, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_clips: (json: string) => AssembledTransaction<ClipView[]>;
        get_epoch: (json: string) => AssembledTransaction<EpochState>;
        set_owners: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_campaign: (json: string) => AssembledTransaction<Campaign>;
        set_platform: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        settle_epoch: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        submit_proof: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        list_disputes: (json: string) => AssembledTransaction<Dispute[]>;
        register_clip: (json: string) => AssembledTransaction<Result<bigint, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_attestors: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        campaign_count: (json: string) => AssembledTransaction<bigint>;
        claim_holdback: (json: string) => AssembledTransaction<Result<bigint, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_clip_epoch: (json: string) => AssembledTransaction<Option<ClipEpoch>>;
        create_campaign: (json: string) => AssembledTransaction<Result<bigint, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_participant: (json: string) => AssembledTransaction<Option<Participant>>;
        finalize_dispute: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
    };
}
