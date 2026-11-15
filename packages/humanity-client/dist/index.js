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
        contractId: "CAVHXWQN6CEQSEZTTDX4HIGATZCYXAUNOGF4ONAXYP4IF2LVX2WUFBHW",
    }
};
export const Errors = {
    1: { message: "AlreadyInitialized" },
    2: { message: "NullifierUsed" },
    3: { message: "WalletRegistered" },
    /**
     * `register_zk` called before `set_aadhaar_config`.
     */
    4: { message: "NotConfigured" },
    /**
     * Groth16 pairing check failed (wrong wallet, campaign, key or tampered proof).
     */
    5: { message: "InvalidProof" },
    /**
     * Proof timestamp is too old (> `max_age`) or more than 1h in the future.
     */
    6: { message: "StaleProof" },
    /**
     * A public input is not a canonical BN254 scalar (>= r).
     */
    7: { message: "InputNotInField" },
    /**
     * `wallet` is a contract address; the signal binds an ed25519 account key.
     */
    8: { message: "NotAnAccount" },
    /**
     * `accept_admin` without a pending `propose_admin`.
     */
    9: { message: "NoPendingAdmin" }
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
        super(new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAAAgAAAAAAAAAQV2FsbGV0UmVnaXN0ZXJlZAAAAAMAAAAxYHJlZ2lzdGVyX3prYCBjYWxsZWQgYmVmb3JlIGBzZXRfYWFkaGFhcl9jb25maWdgLgAAAAAAAA1Ob3RDb25maWd1cmVkAAAAAAAABAAAAE1Hcm90aDE2IHBhaXJpbmcgY2hlY2sgZmFpbGVkICh3cm9uZyB3YWxsZXQsIGNhbXBhaWduLCBrZXkgb3IgdGFtcGVyZWQgcHJvb2YpLgAAAAAAAAxJbnZhbGlkUHJvb2YAAAAFAAAAR1Byb29mIHRpbWVzdGFtcCBpcyB0b28gb2xkICg+IGBtYXhfYWdlYCkgb3IgbW9yZSB0aGFuIDFoIGluIHRoZSBmdXR1cmUuAAAAAApTdGFsZVByb29mAAAAAAAGAAAANkEgcHVibGljIGlucHV0IGlzIG5vdCBhIGNhbm9uaWNhbCBCTjI1NCBzY2FsYXIgKD49IHIpLgAAAAAAD0lucHV0Tm90SW5GaWVsZAAAAAAHAAAASGB3YWxsZXRgIGlzIGEgY29udHJhY3QgYWRkcmVzczsgdGhlIHNpZ25hbCBiaW5kcyBhbiBlZDI1NTE5IGFjY291bnQga2V5LgAAAAxOb3RBbkFjY291bnQAAAAIAAAAMWBhY2NlcHRfYWRtaW5gIHdpdGhvdXQgYSBwZW5kaW5nIGBwcm9wb3NlX2FkbWluYC4AAAAAAAAOTm9QZW5kaW5nQWRtaW4AAAAAAAk=",
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
            "AAAAAQAAAFlHcm90aDE2IHByb29mLiBHMSA9IGJlKHgpIHx8IGJlKHkpOyBHMiA9IHguYzEgfHwgeC5jMCB8fCB5LmMxIHx8IHkuYzAgKGJpZy1lbmRpYW4gbGltYnMpLgAAAAAAAAAAAAAMR3JvdGgxNlByb29mAAAAAwAAAAAAAAABYQAAAAAAA+4AAABAAAAAAAAAAAFiAAAAAAAD7gAAAIAAAAAAAAAAAWMAAAAAAAPuAAAAQA=="]), options);
        this.options = options;
    }
    fromJSON = {
        admin: (this.txFromJSON),
        revoke: (this.txFromJSON),
        register: (this.txFromJSON),
        is_verified: (this.txFromJSON),
        register_zk: (this.txFromJSON),
        set_relayer: (this.txFromJSON),
        accept_admin: (this.txFromJSON),
        propose_admin: (this.txFromJSON),
        aadhaar_config: (this.txFromJSON),
        set_aadhaar_config: (this.txFromJSON)
    };
}
