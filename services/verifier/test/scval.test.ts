import { describe, expect, it } from "vitest";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { reclaimProofToScVal, structToScVal } from "../src/scval.js";
import { toProofJson } from "../src/proof.js";
import { makeProof } from "./helpers.js";

// works with both the method-style (<=v14) and property-style (v17) XDR objects
const call = (o: any, k: string) => (typeof o[k] === "function" ? o[k]() : o[k]);
const typeOf = (v: any): string => (typeof v.switch === "function" ? v.switch().name : v.type);
const entries = (v: any): { key: any; val: any }[] => call(v, "map").map((e: any) => ({ key: call(e, "key"), val: call(e, "val") }));

describe("ReclaimProof ScVal", () => {
  const pj = toProofJson(makeProof());
  const v = reclaimProofToScVal(pj);

  it("is a map with alphabetically sorted symbol keys", () => {
    expect(typeOf(v)).toBe("scvMap");
    const es = entries(v);
    expect(es.every((e) => typeOf(e.key) === "scvSymbol")).toBe(true);
    expect(es.map((e) => scValToNative(e.key))).toEqual([
      "context", "epoch", "owner", "parameters", "recovery_id", "signature", "timestamp_s",
    ]);
  });

  it("uses the right ScVal types", () => {
    const m = Object.fromEntries(entries(v).map((e) => [scValToNative(e.key), e.val]));
    for (const k of ["parameters", "context", "owner", "signature"]) expect(typeOf(m[k])).toBe("scvBytes");
    expect(scValToNative(m.signature).length).toBe(64);
    expect(typeOf(m.timestamp_s)).toBe("scvU64");
    expect(typeOf(m.epoch)).toBe("scvU32");
    expect(typeOf(m.recovery_id)).toBe("scvU32");
  });

  it("round-trips through XDR", () => {
    const back = scValToNative(xdr.ScVal.fromXDR(v.toXDR("base64"), "base64"));
    expect(Buffer.from(back.parameters).toString("hex")).toBe(pj.parameters);
    expect(Buffer.from(back.owner).toString("hex")).toBe(pj.owner);
    expect(back.timestamp_s).toBe(BigInt(pj.timestampS));
    expect(back.recovery_id).toBe(pj.recoveryId);
    expect(back.epoch).toBe(pj.epoch);
  });

  it("rejects bad signature length", () => {
    expect(() => reclaimProofToScVal({ ...pj, signature: "ab" })).toThrow();
  });

  it("structToScVal sorts keys", () => {
    const s = structToScVal({ b: xdr.ScVal.scvVoid(), a: xdr.ScVal.scvVoid() });
    expect(entries(s).map((e) => scValToNative(e.key))).toEqual(["a", "b"]);
  });
});
