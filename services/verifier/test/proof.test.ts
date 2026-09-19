import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { transformForOnchain } from "@reclaimprotocol/js-sdk";
import { extractValues, splitSignature, toProofJson } from "../src/proof.js";
import { addressOf, claimDigest, makeProof, TEST_ATTESTOR } from "./helpers.js";

const fromHex = (h: string) => Buffer.from(h, "hex").toString("utf8");

describe("toProofJson", () => {
  const raw = makeProof();
  const pj = toProofJson(raw);

  it("hex-encodes the exact claim strings", () => {
    expect(fromHex(pj.parameters)).toBe(raw.claimData.parameters);
    expect(fromHex(pj.context)).toBe(raw.claimData.context);
    expect(fromHex(pj.owner)).toBe(raw.claimData.owner);
    expect(fromHex(pj.owner)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(pj.parameters).toMatch(/^[0-9a-f]+$/);
  });

  it("splits signature into r‖s (128 hex) + recoveryId", () => {
    expect(pj.signature).toMatch(/^[0-9a-f]{128}$/);
    expect([0, 1]).toContain(pj.recoveryId);
    expect(pj.timestampS).toBe(raw.claimData.timestampS);
    expect(pj.epoch).toBe(1);
  });

  it("signature recovers to the attestor with the contract's digest recipe", () => {
    const { digest } = claimDigest(fromHex(pj.parameters), fromHex(pj.context), fromHex(pj.owner), pj.timestampS, pj.epoch);
    const sig = Uint8Array.from(Buffer.from([pj.recoveryId, ...Buffer.from(pj.signature, "hex")]));
    const pub = secp256k1.recoverPublicKey(sig, digest, { prehash: false });
    const pub65 = secp256k1.Point.fromBytes(pub).toBytes(false);
    expect(addressOf(pub65)).toBe(TEST_ATTESTOR);
  });

  it("gives the same result for transformForOnchain output", () => {
    expect(toProofJson(transformForOnchain(raw as any) as any)).toEqual(pj);
  });

  it("lowercases owner", () => {
    const p = makeProof();
    p.claimData.owner = p.claimData.owner.toUpperCase().replace("0X", "0x");
    expect(fromHex(toProofJson(p).owner)).toBe(p.claimData.owner.toLowerCase());
  });
});

describe("splitSignature", () => {
  it("maps v=27/28 to 0/1", () => {
    const rs = "ab".repeat(64);
    expect(splitSignature("0x" + rs + "1b")).toEqual({ signature: rs, recoveryId: 0 });
    expect(splitSignature("0x" + rs + "1c")).toEqual({ signature: rs, recoveryId: 1 });
    expect(splitSignature(rs + "01").recoveryId).toBe(1);
  });
  it("rejects bad lengths", () => {
    expect(() => splitSignature("0x1234")).toThrow();
    expect(() => splitSignature("0x" + "ab".repeat(64) + "1d")).toThrow();
  });
});

describe("extractValues", () => {
  it("reads extractedParameterValues", () => {
    expect(extractValues(makeProof({ views: "42", desc: "hi" }))).toEqual({ views: "42", desc: "hi" });
  });
  it("falls back to context.extractedParameters", () => {
    const p = makeProof({ views: "7" });
    delete p.extractedParameterValues;
    expect(extractValues(p).views).toBe("7");
  });
  it("rejects non-numeric views", () => {
    const p = makeProof();
    p.extractedParameterValues = { views: "12a" };
    expect(() => extractValues(p)).toThrow();
  });
});
