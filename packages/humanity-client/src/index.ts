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
    contractId: "CAVHXWQN6CEQSEZTTDX4HIGATZCYXAUNOGF4ONAXYP4IF2LVX2WUFBHW",
  }
} as const

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NullifierUsed"},
  3: {message:"WalletRegistered"},
  /**
   * `register_zk` called before `set_aadhaar_config`.
   */
  4: {message:"NotConfigured"},
  /**
   * Groth16 pairing check failed (wrong wallet, campaign, key or tampered proof).
   */
  5: {message:"InvalidProof"},
  /**
   * Proof timestamp is too old (> `max_age`) or more than 1h in the future.
   */
  6: {message:"StaleProof"},
  /**
   * A public input is not a canonical BN254 scalar (>= r).
   */
  7: {message:"InputNotInField"},
  /**
   * `wallet` is a contract address; the signal binds an ed25519 account key.
   */
  8: {message:"NotAnAccount"},
  /**
   * `accept_admin` without a pending `propose_admin`.
   */
  9: {message:"NoPendingAdmin"}
}




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
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a revoke transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin removes a wallet's registration for a campaign. The nullifier stays marked as used,
   * so the same person cannot re-register with another wallet.
   */
  revoke: ({campaign_id, wallet}: {campaign_id: u64, wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a register transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register: ({campaign_id, nullifier, wallet}: {campaign_id: u64, nullifier: Buffer, wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_verified transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_verified: ({campaign_id, wallet}: {campaign_id: u64, wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a register_zk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Self-service registration with an Anon Aadhaar Groth16 proof.
   * 
   * The contract recomputes the bound public inputs itself: pubkeyHash (config),
   * nullifierSeed = keccak256("cliprail:" + campaign_id) >> 3 and
   * signalHash = keccak256(ed25519 key of `wallet`) >> 3. The client supplies only the
   * circuit outputs (nullifier, timestamp, revealed fields).
   */
  register_zk: ({campaign_id, wallet, proof, nullifier, timestamp, age_above_18, gender, pin_code, state}: {campaign_id: u64, wallet: string, proof: Groth16Proof, nullifier: u256, timestamp: u64, age_above_18: u256, gender: u256, pin_code: u256, state: u256}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_relayer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_relayer: ({relayer}: {relayer: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 1 of an admin transfer; the new admin must call `accept_admin`.
   */
  propose_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a aadhaar_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  aadhaar_config: (options?: MethodOptions) => Promise<AssembledTransaction<Option<AadhaarConfig>>>

  /**
   * Construct and simulate a set_aadhaar_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin sets the Anon Aadhaar verification parameters (enables `register_zk`).
   */
  set_aadhaar_config: ({config}: {config: AadhaarConfig}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, relayer}: {admin: string, relayer: string},
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
    return ContractClient.deploy({admin, relayer}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAAAgAAAAAAAAAQV2FsbGV0UmVnaXN0ZXJlZAAAAAMAAAAxYHJlZ2lzdGVyX3prYCBjYWxsZWQgYmVmb3JlIGBzZXRfYWFkaGFhcl9jb25maWdgLgAAAAAAAA1Ob3RDb25maWd1cmVkAAAAAAAABAAAAE1Hcm90aDE2IHBhaXJpbmcgY2hlY2sgZmFpbGVkICh3cm9uZyB3YWxsZXQsIGNhbXBhaWduLCBrZXkgb3IgdGFtcGVyZWQgcHJvb2YpLgAAAAAAAAxJbnZhbGlkUHJvb2YAAAAFAAAAR1Byb29mIHRpbWVzdGFtcCBpcyB0b28gb2xkICg+IGBtYXhfYWdlYCkgb3IgbW9yZSB0aGFuIDFoIGluIHRoZSBmdXR1cmUuAAAAAApTdGFsZVByb29mAAAAAAAGAAAANkEgcHVibGljIGlucHV0IGlzIG5vdCBhIGNhbm9uaWNhbCBCTjI1NCBzY2FsYXIgKD49IHIpLgAAAAAAD0lucHV0Tm90SW5GaWVsZAAAAAAHAAAASGB3YWxsZXRgIGlzIGEgY29udHJhY3QgYWRkcmVzczsgdGhlIHNpZ25hbCBiaW5kcyBhbiBlZDI1NTE5IGFjY291bnQga2V5LgAAAAxOb3RBbkFjY291bnQAAAAIAAAAMWBhY2NlcHRfYWRtaW5gIHdpdGhvdXQgYSBwZW5kaW5nIGBwcm9wb3NlX2FkbWluYC4AAAAAAAAOTm9QZW5kaW5nQWRtaW4AAAAAAAk=",
        "AAAABQAAAAAAAAAAAAAACkh1bWFuRXZlbnQAAAAAAAEAAAAFaHVtYW4AAAAAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAQAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAADEh1bWFuWmtFdmVudAAAAAEAAAAHaHVtYW56awAAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAQAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAAAQ==",
        "AAAAAQAAACVBbm9uIEFhZGhhYXIgdmVyaWZpY2F0aW9uIHBhcmFtZXRlcnMuAAAAAAAAAAAAAA1BYWRoYWFyQ29uZmlnAAAAAAAAAwAAAE5NYXhpbXVtIGFnZSBvZiB0aGUgQWFkaGFhciBRUiB0aW1lc3RhbXAgcmVsYXRpdmUgdG8gdGhlIGxlZGdlciB0aW1lIChzZWNvbmRzKS4AAAAAAAdtYXhfYWdlAAAAAAYAAABbUG9zZWlkb24gaGFzaCBvZiB0aGUgVUlEQUkgUlNBIHB1YmxpYyBrZXkgdGhlIHByb29mIG11c3QgYmUgaXNzdWVkIHVuZGVyCihwdWJsaWMgc2lnbmFsIDApLgAAAAALcHVia2V5X2hhc2gAAAAADAAAAERJbmZvcm1hdGlvbmFsOiB0cnVlIHdoZW4gYHB1YmtleV9oYXNoYCBpcyB0aGUgQW5vbiBBYWRoYWFyIHRlc3Qga2V5LgAAAAh0ZXN0X2tleQAAAAE=",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAJRBZG1pbiByZW1vdmVzIGEgd2FsbGV0J3MgcmVnaXN0cmF0aW9uIGZvciBhIGNhbXBhaWduLiBUaGUgbnVsbGlmaWVyIHN0YXlzIG1hcmtlZCBhcyB1c2VkLApzbyB0aGUgc2FtZSBwZXJzb24gY2Fubm90IHJlLXJlZ2lzdGVyIHdpdGggYW5vdGhlciB3YWxsZXQuAAAABnJldm9rZQAAAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAIcmVnaXN0ZXIAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAALaXNfdmVyaWZpZWQAAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAVVTZWxmLXNlcnZpY2UgcmVnaXN0cmF0aW9uIHdpdGggYW4gQW5vbiBBYWRoYWFyIEdyb3RoMTYgcHJvb2YuCgpUaGUgY29udHJhY3QgcmVjb21wdXRlcyB0aGUgYm91bmQgcHVibGljIGlucHV0cyBpdHNlbGY6IHB1YmtleUhhc2ggKGNvbmZpZyksCm51bGxpZmllclNlZWQgPSBrZWNjYWsyNTYoImNsaXByYWlsOiIgKyBjYW1wYWlnbl9pZCkgPj4gMyBhbmQKc2lnbmFsSGFzaCA9IGtlY2NhazI1NihlZDI1NTE5IGtleSBvZiBgd2FsbGV0YCkgPj4gMy4gVGhlIGNsaWVudCBzdXBwbGllcyBvbmx5IHRoZQpjaXJjdWl0IG91dHB1dHMgKG51bGxpZmllciwgdGltZXN0YW1wLCByZXZlYWxlZCBmaWVsZHMpLgAAAAAAAAtyZWdpc3Rlcl96awAAAAAJAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAAAAAAZ3YWxsZXQAAAAAABMAAAAAAAAABXByb29mAAAAAAAH0AAAAAxHcm90aDE2UHJvb2YAAAAAAAAACW51bGxpZmllcgAAAAAAAAwAAAAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAAAAAAADGFnZV9hYm92ZV8xOAAAAAwAAAAAAAAABmdlbmRlcgAAAAAADAAAAAAAAAAIcGluX2NvZGUAAAAMAAAAAAAAAAVzdGF0ZQAAAAAAAAwAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAALc2V0X3JlbGF5ZXIAAAAAAQAAAAAAAAAHcmVsYXllcgAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAFhSdW5zIG9uY2UgYXQgZGVwbG95IChubyBmcm9udC1ydW5uYWJsZSBgaW5pdGApLiBgQWxyZWFkeUluaXRpYWxpemVkYCAoMSkgc3RheXMgcmVzZXJ2ZWQuAAAADV9fY29uc3RydWN0b3IAAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB3JlbGF5ZXIAAAAAEwAAAAA=",
        "AAAAAAAAAERTdGVwIDEgb2YgYW4gYWRtaW4gdHJhbnNmZXI7IHRoZSBuZXcgYWRtaW4gbXVzdCBjYWxsIGBhY2NlcHRfYWRtaW5gLgAAAA1wcm9wb3NlX2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOYWFkaGFhcl9jb25maWcAAAAAAAAAAAABAAAD6AAAB9AAAAANQWFkaGFhckNvbmZpZwAAAA==",
        "AAAAAAAAAExBZG1pbiBzZXRzIHRoZSBBbm9uIEFhZGhhYXIgdmVyaWZpY2F0aW9uIHBhcmFtZXRlcnMgKGVuYWJsZXMgYHJlZ2lzdGVyX3prYCkuAAAAEnNldF9hYWRoYWFyX2NvbmZpZwAAAAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAADUFhZGhhYXJDb25maWcAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAQAAAFlHcm90aDE2IHByb29mLiBHMSA9IGJlKHgpIHx8IGJlKHkpOyBHMiA9IHguYzEgfHwgeC5jMCB8fCB5LmMxIHx8IHkuYzAgKGJpZy1lbmRpYW4gbGltYnMpLgAAAAAAAAAAAAAMR3JvdGgxNlByb29mAAAAAwAAAAAAAAABYQAAAAAAA+4AAABAAAAAAAAAAAFiAAAAAAAD7gAAAIAAAAAAAAAAAWMAAAAAAAPuAAAAQA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    admin: this.txFromJSON<string>,
        revoke: this.txFromJSON<null>,
        register: this.txFromJSON<Result<void>>,
        is_verified: this.txFromJSON<boolean>,
        register_zk: this.txFromJSON<Result<void>>,
        set_relayer: this.txFromJSON<null>,
        accept_admin: this.txFromJSON<Result<void>>,
        propose_admin: this.txFromJSON<null>,
        aadhaar_config: this.txFromJSON<Option<AadhaarConfig>>,
        set_aadhaar_config: this.txFromJSON<Result<void>>
  }
}