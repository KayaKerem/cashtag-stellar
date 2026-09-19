import { Buffer } from "buffer";
import { Client as ContractClient, Spec as ContractSpec, } from "@stellar/stellar-sdk/contract";
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
};
export const Errors = {
    1: { message: "AlreadyInitialized" },
    2: { message: "NullifierUsed" },
    3: { message: "WalletRegistered" }
};
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Constructor/Initialization Args for the contract's `__constructor` method */
    { admin, relayer }, 
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy({ admin, relayer }, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAAwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAAAgAAAAAAAAAQV2FsbGV0UmVnaXN0ZXJlZAAAAAM=",
            "AAAABQAAAAAAAAAAAAAACkh1bWFuRXZlbnQAAAAAAAEAAAAFaHVtYW4AAAAAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAQAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAAAQ==",
            "AAAAAAAAAJRBZG1pbiByZW1vdmVzIGEgd2FsbGV0J3MgcmVnaXN0cmF0aW9uIGZvciBhIGNhbXBhaWduLiBUaGUgbnVsbGlmaWVyIHN0YXlzIG1hcmtlZCBhcyB1c2VkLApzbyB0aGUgc2FtZSBwZXJzb24gY2Fubm90IHJlLXJlZ2lzdGVyIHdpdGggYW5vdGhlciB3YWxsZXQuAAAABnJldm9rZQAAAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAA==",
            "AAAAAAAAAAAAAAAIcmVnaXN0ZXIAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAGAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
            "AAAAAAAAAAAAAAALaXNfdmVyaWZpZWQAAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABgAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAAAE=",
            "AAAAAAAAAAAAAAALc2V0X3JlbGF5ZXIAAAAAAQAAAAAAAAAHcmVsYXllcgAAAAATAAAAAA==",
            "AAAAAAAAAFhSdW5zIG9uY2UgYXQgZGVwbG95IChubyBmcm9udC1ydW5uYWJsZSBgaW5pdGApLiBgQWxyZWFkeUluaXRpYWxpemVkYCAoMSkgc3RheXMgcmVzZXJ2ZWQuAAAADV9fY29uc3RydWN0b3IAAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB3JlbGF5ZXIAAAAAEwAAAAA="]), options);
        this.options = options;
    }
    fromJSON = {
        revoke: (this.txFromJSON),
        register: (this.txFromJSON),
        is_verified: (this.txFromJSON),
        set_relayer: (this.txFromJSON)
    };
}
