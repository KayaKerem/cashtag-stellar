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
    contractId: "CAUU4KCBSL3L5CCLU2S5GNZ354S4X3DP6Z5ZSWMSDDCNNNE3AJSCGKMQ",
  }
} as const

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NullifierUsed"},
  3: {message:"WalletRegistered"}
}


export interface Client {
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
   * Construct and simulate a set_relayer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_relayer: ({relayer}: {relayer: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAAwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAAAgAAAAAAAAAQV2FsbGV0UmVnaXN0ZXJlZAAAAAM=",
        "AAAABQAAAAAAAAAAAAAACkh1bWFuRXZlbnQAAAAAAAEAAAAFaHVtYW4AAAAAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAQAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAAAQ==",
        "AAAAAAAAAJRBZG1pbiByZW1vdmVzIGEgd2FsbGV0J3MgcmVnaXN0cmF0aW9uIGZvciBhIGNhbXBhaWduLiBUaGUgbnVsbGlmaWVyIHN0YXlzIG1hcmtlZCBhcyB1c2VkLApzbyB0aGUgc2FtZSBwZXJzb24gY2Fubm90IHJlLXJlZ2lzdGVyIHdpdGggYW5vdGhlciB3YWxsZXQuAAAABnJldm9rZQAAAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAIcmVnaXN0ZXIAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAALaXNfdmVyaWZpZWQAAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAALc2V0X3JlbGF5ZXIAAAAAAQAAAAAAAAAHcmVsYXllcgAAAAATAAAAAA==",
        "AAAAAAAAAFhSdW5zIG9uY2UgYXQgZGVwbG95IChubyBmcm9udC1ydW5uYWJsZSBgaW5pdGApLiBgQWxyZWFkeUluaXRpYWxpemVkYCAoMSkgc3RheXMgcmVzZXJ2ZWQuAAAADV9fY29uc3RydWN0b3IAAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB3JlbGF5ZXIAAAAAEwAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    revoke: this.txFromJSON<null>,
        register: this.txFromJSON<Result<void>>,
        is_verified: this.txFromJSON<boolean>,
        set_relayer: this.txFromJSON<null>
  }
}