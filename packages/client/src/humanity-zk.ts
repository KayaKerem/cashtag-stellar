// humanity.register_zk without regenerated bindings: raw ScVal args + AssembledTransaction.
//
// register_zk(campaign_id: u64, wallet: Address, proof: Groth16Proof{a: BytesN<64>, b: BytesN<128>, c: BytesN<64>},
//             nullifier: U256, timestamp: u64, age_above_18: U256, gender: U256, pin_code: U256, state: U256)
import { Buffer } from "buffer";
import { Address, contract, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { HUMANITY_ERRORS } from "@cliprail/shared";

/** Verifier `POST /humanity/aadhaar/prove` response (numbers are decimal strings). */
export interface AadhaarProveResponse {
  proof: { a: string; b: string; c: string };
  nullifier: string;
  timestamp: string;
  ageAbove18: string;
  gender: string;
  pinCode: string;
  state: string;
  mode: "test";
  identity?: string;
  publicSignals?: string[];
  cached?: boolean;
}

const U256_MAX = (1n << 256n) - 1n;

function fixedHex(v: unknown, bytes: number, field: string): Buffer {
  if (typeof v !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "i").test(v)) throw new Error(`proof.${field} must be ${bytes} bytes hex`);
  return Buffer.from(v, "hex");
}

function u256(v: unknown, field: string): xdr.ScVal {
  if (typeof v !== "string" || !/^\d{1,78}$/.test(v) || BigInt(v) > U256_MAX) throw new Error(`${field} must be a U256 decimal string`);
  return nativeToScVal(BigInt(v), { type: "u256" });
}

function u64(v: unknown, field: string): xdr.ScVal {
  const n = typeof v === "bigint" ? v : typeof v === "string" && /^\d{1,20}$/.test(v) ? BigInt(v) : typeof v === "number" && Number.isSafeInteger(v) ? BigInt(v) : -1n;
  if (n < 0n || n >= 1n << 64n) throw new Error(`${field} must be a u64`);
  return nativeToScVal(n, { type: "u64" });
}

/** Groth16Proof struct → ScMap with symbol keys in sorted order (a, b, c). */
export function groth16ProofScVal(p: { a: string; b: string; c: string }): xdr.ScVal {
  const entry = (k: string, b: Buffer) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: xdr.ScVal.scvBytes(b) });
  return xdr.ScVal.scvMap([entry("a", fixedHex(p.a, 64, "a")), entry("b", fixedHex(p.b, 128, "b")), entry("c", fixedHex(p.c, 64, "c"))]);
}

/** Argument list for humanity.register_zk, in contract order. */
export function registerZkArgs(campaignId: bigint, wallet: string, r: AadhaarProveResponse): xdr.ScVal[] {
  return [
    u64(campaignId, "campaignId"),
    new Address(wallet).toScVal(),
    groth16ProofScVal(r.proof),
    u256(r.nullifier, "nullifier"),
    u64(r.timestamp, "timestamp"),
    u256(r.ageAbove18, "ageAbove18"),
    u256(r.gender, "gender"),
    u256(r.pinCode, "pinCode"),
    u256(r.state, "state"),
  ];
}

/** HUMANITY_ERRORS in the shape AssembledTransaction's `errorTypes` expects. */
export const humanityErrorTypes = Object.fromEntries(Object.entries(HUMANITY_ERRORS).map(([k, v]) => [Number(k), { message: v.name }]));

export type BuildTx = (o: contract.AssembledTransactionOptions<unknown>) => Promise<unknown>;

export const defaultBuildTx: BuildTx = (o) => contract.AssembledTransaction.build(o);

export function registerZkTxOptions(
  base: { rpcUrl: string; networkPassphrase: string; allowHttp?: boolean; contractId: string; publicKey: string; signTransaction: contract.ClientOptions["signTransaction"] },
  args: xdr.ScVal[],
): contract.AssembledTransactionOptions<unknown> {
  return {
    ...base,
    method: "register_zk",
    args,
    parseResultXdr: (v: xdr.ScVal) => scValToNative(v),
    errorTypes: humanityErrorTypes,
  };
}
