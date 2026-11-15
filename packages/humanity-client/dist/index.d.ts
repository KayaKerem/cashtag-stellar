import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, Result } from "@stellar/stellar-sdk/contract";
import type { u64, u256, Option } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly testnet: {
        readonly networkPassphrase: "Test SDF Network ; September 2015";
        readonly contractId: "CAVHXWQN6CEQSEZTTDX4HIGATZCYXAUNOGF4ONAXYP4IF2LVX2WUFBHW";
    };
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
    /**
     * `register_zk` called before `set_aadhaar_config`.
     */
    4: {
        message: string;
    };
    /**
     * Groth16 pairing check failed (wrong wallet, campaign, key or tampered proof).
     */
    5: {
        message: string;
    };
    /**
     * Proof timestamp is too old (> `max_age`) or more than 1h in the future.
     */
    6: {
        message: string;
    };
    /**
     * A public input is not a canonical BN254 scalar (>= r).
     */
    7: {
        message: string;
    };
    /**
     * `wallet` is a contract address; the signal binds an ed25519 account key.
     */
    8: {
        message: string;
    };
    /**
     * `accept_admin` without a pending `propose_admin`.
     */
    9: {
        message: string;
    };
};
/**
 * Anon Aadhaar verification parameters.
 */
export interface AadhaarConfig {
    /**
   * Maximum age of the Aadhaar QR timestamp relative to the ledger time (seconds).
   */
    max_age: u64;
    /**
   * Poseidon hash of the UIDAI RSA public key the proof must be issued under
   * (public signal 0).
   */
    pubkey_hash: u256;
    /**
   * Informational: true when `pubkey_hash` is the Anon Aadhaar test key.
   */
    test_key: boolean;
}
/**
 * Groth16 proof. G1 = be(x) || be(y); G2 = x.c1 || x.c0 || y.c1 || y.c0 (big-endian limbs).
 */
export interface Groth16Proof {
    a: Buffer;
    b: Buffer;
    c: Buffer;
}
export interface Client {
    /**
     * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a revoke transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Admin removes a wallet's registration for a campaign. The nullifier stays marked as used,
     * so the same person cannot re-register with another wallet.
     */
    revoke: ({ campaign_id, wallet }: {
        campaign_id: u64;
        wallet: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a register transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    register: ({ campaign_id, nullifier, wallet }: {
        campaign_id: u64;
        nullifier: Buffer;
        wallet: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a is_verified transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    is_verified: ({ campaign_id, wallet }: {
        campaign_id: u64;
        wallet: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
    /**
     * Construct and simulate a register_zk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Self-service registration with an Anon Aadhaar Groth16 proof.
     *
     * The contract recomputes the bound public inputs itself: pubkeyHash (config),
     * nullifierSeed = keccak256("cliprail:" + campaign_id) >> 3 and
     * signalHash = keccak256(ed25519 key of `wallet`) >> 3. The client supplies only the
     * circuit outputs (nullifier, timestamp, revealed fields).
     */
    register_zk: ({ campaign_id, wallet, proof, nullifier, timestamp, age_above_18, gender, pin_code, state }: {
        campaign_id: u64;
        wallet: string;
        proof: Groth16Proof;
        nullifier: u256;
        timestamp: u64;
        age_above_18: u256;
        gender: u256;
        pin_code: u256;
        state: u256;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a set_relayer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_relayer: ({ relayer }: {
        relayer: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Step 1 of an admin transfer; the new admin must call `accept_admin`.
     */
    propose_admin: ({ new_admin }: {
        new_admin: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a aadhaar_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    aadhaar_config: (options?: MethodOptions) => Promise<AssembledTransaction<Option<AadhaarConfig>>>;
    /**
     * Construct and simulate a set_aadhaar_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Admin sets the Anon Aadhaar verification parameters (enables `register_zk`).
     */
    set_aadhaar_config: ({ config }: {
        config: AadhaarConfig;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Constructor/Initialization Args for the contract's `__constructor` method */
    { admin, relayer }: {
        admin: string;
        relayer: string;
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
        admin: (json: string) => AssembledTransaction<string>;
        revoke: (json: string) => AssembledTransaction<null>;
        register: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        is_verified: (json: string) => AssembledTransaction<boolean>;
        register_zk: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_relayer: (json: string) => AssembledTransaction<null>;
        accept_admin: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        propose_admin: (json: string) => AssembledTransaction<null>;
        aadhaar_config: (json: string) => AssembledTransaction<Option<AadhaarConfig>>;
        set_aadhaar_config: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
    };
}
