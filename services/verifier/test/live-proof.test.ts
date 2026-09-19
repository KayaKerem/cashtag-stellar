// Regression over a REAL Reclaim zkFetch proof (fixtures/reclaim/demo-live-proof.json, demo platform).
// Offline: no network, no zkFetch. Guards the byte format the contract depends on — if a future
// Reclaim release changes `parameters`/`context`, the identifier stops matching and this test fails.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toProofJson, canonicalContext, type ZkProof } from "../src/proof.js";
import { claimDigest, recoverAddress } from "./helpers.js";

const FIX = resolve(__dirname, "../../../fixtures/reclaim");
const proof: ZkProof = JSON.parse(readFileSync(resolve(FIX, "demo-live-proof.json"), "utf8"));
const required: string[] = JSON.parse(readFileSync(resolve(FIX, "../required-substrings.json"), "utf8")).demo.required;

/** Reclaim's attestor node, as recorded in the proof's witness. */
const LIVE_ATTESTOR = "0x244897572368eadf65bfbc5aec98d8e5443a9072";

const str = (hex: string) => Buffer.from(hex, "hex").toString("utf8");

describe("live Reclaim proof (demo platform)", () => {
  const pj = toProofJson(proof);

  it("is signed by the live Reclaim attestor", () => {
    expect(proof.witnesses?.[0]).toMatchObject({ id: LIVE_ATTESTOR });
    const { identifier, digest } = claimDigest(str(pj.parameters), str(pj.context), str(pj.owner), pj.timestampS, pj.epoch);
    expect(identifier).toBe(proof.claimData.identifier);
    expect(recoverAddress(digest, pj.signature, pj.recoveryId)).toBe(LIVE_ATTESTOR);
  });

  it("keeps the claim shape the contract expects", () => {
    expect(proof.claimData.provider).toBe("http");
    expect(pj.epoch).toBe(1);
    expect([0, 1]).toContain(pj.recoveryId);
    expect(str(pj.owner)).toMatch(/^0x[0-9a-f]{40}$/); // lowercase ASCII, as set_owners stores it
  });

  it("sends `parameters` byte for byte and re-canonicalizes `context`", () => {
    expect(str(pj.parameters)).toBe(proof.claimData.parameters);
    expect(str(pj.context)).toBe(canonicalContext(proof.claimData.context));
  });

  it("carries the url and every `required` substring inside `parameters`", () => {
    const parameters = str(pj.parameters);
    const url = JSON.parse(parameters).url as string;
    expect(parameters).toContain(`"url":"${url}"`); // the needle reclaim_verify builds from expected_url
    for (const r of required) expect(parameters).toContain(r);
  });

  it("exposes views and desc through the canonical context", () => {
    const ctx = JSON.parse(str(pj.context));
    expect(Object.keys(ctx)).toEqual(["extractedParameters", "providerHash"]);
    expect(ctx.extractedParameters.views).toMatch(/^\d+$/);
    expect(ctx.extractedParameters.desc).toMatch(/CR-[0-9A-Z]{6}/); // participant code the contract looks for
  });
});
