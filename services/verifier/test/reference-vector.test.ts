// Conversion must reproduce the attestor-core identifier/digest/signer (fixtures/reclaim/reference-vector.json).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { toProofJson, type ZkProof } from "../src/proof.js";
import { addressOf, claimDigest } from "./helpers.js";

const v = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/reclaim/reference-vector.json"), "utf8"));
const str = (h: string) => Buffer.from(h, "hex").toString("utf8");

function fromVector(context: string): ZkProof {
  return {
    claimData: {
      provider: "http",
      parameters: v.parameters,
      context,
      owner: v.owner,
      timestampS: v.timestampS,
      epoch: v.epoch,
      identifier: v.identifier,
    },
    signatures: [v.signature],
  };
}

function check(context: string) {
  const pj = toProofJson(fromVector(context));
  const { identifier, digest } = claimDigest(str(pj.parameters), str(pj.context), str(pj.owner), pj.timestampS, pj.epoch);
  expect(identifier).toBe(v.identifier);
  expect("0x" + Buffer.from(digest).toString("hex")).toBe(v.digest);
  const sig = Uint8Array.from([pj.recoveryId, ...Buffer.from(pj.signature, "hex")]);
  const pub = secp256k1.Point.fromBytes(secp256k1.recoverPublicKey(sig, digest, { prehash: false })).toBytes(false);
  expect(addressOf(pub)).toBe(v.attestorAddress);
  return pj;
}

describe("reference vector (attestor-core)", () => {
  it("canonical context reproduces identifier, digest and signer", () => {
    const pj = check(v.context);
    expect(str(pj.parameters)).toBe(v.parameters);
    expect(str(pj.context)).toBe(v.context);
  });

  it("non-canonical context (reordered keys, whitespace) is re-canonicalized", () => {
    const obj = JSON.parse(v.context);
    const messy = JSON.stringify({ providerHash: obj.providerHash, extractedParameters: obj.extractedParameters, contextMessage: obj.contextMessage, contextAddress: obj.contextAddress }, null, 2);
    expect(messy).not.toBe(v.context);
    check(messy);
  });
});
