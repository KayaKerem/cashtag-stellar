import { xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";
import type { ProofJson } from "./proof.js";

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const bytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));

/**
 * Soroban #[contracttype] struct -> ScMap with Symbol keys sorted by key name.
 * Field names are the Rust (snake_case) ones.
 */
export function structToScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const keys = Object.keys(fields).sort();
  return xdr.ScVal.scvMap(keys.map((k) => new xdr.ScMapEntry({ key: sym(k), val: fields[k] })));
}

export function reclaimProofToScVal(p: ProofJson): xdr.ScVal {
  if (!/^[0-9a-f]{128}$/i.test(p.signature)) throw new Error("signature must be 64 bytes hex");
  return structToScVal({
    parameters: bytes(p.parameters),
    context: bytes(p.context),
    owner: bytes(p.owner),
    timestamp_s: nativeToScVal(BigInt(p.timestampS), { type: "u64" }),
    epoch: nativeToScVal(p.epoch, { type: "u32" }),
    signature: bytes(p.signature),
    recovery_id: nativeToScVal(p.recoveryId, { type: "u32" }),
  });
}

export const u64 = (v: bigint | number | string) => nativeToScVal(BigInt(v), { type: "u64" });
export const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
export const symbol = (s: string) => nativeToScVal(s, { type: "symbol" });
export const address = (a: string) => new Address(a).toScVal();
export const bytesN = (buf: Buffer) => xdr.ScVal.scvBytes(buf);
