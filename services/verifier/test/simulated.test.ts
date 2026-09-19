// Simulated attestor must produce proofs the contract accepts: same identifier/digest/signer logic
// as attestor-core (reference vector) and the e2e instance's attestor + owner.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DemoStore } from "../src/demo.js";
import { extractValues, toProofJson } from "../src/proof.js";
import {
  DEFAULT_SIM_ATTESTOR_SECRET,
  DEFAULT_SIM_OWNER_SECRET,
  addressOfSecret,
  extractFromBody,
  signClaim,
  zkFetchParams,
  type ResponseMatch,
} from "../src/simulated.js";
import { claimDigest, recoverAddress } from "./helpers.js";

const ROOT = resolve(__dirname, "../../..");
const vec = JSON.parse(readFileSync(resolve(ROOT, "fixtures/reclaim/reference-vector.json"), "utf8"));
const req = JSON.parse(readFileSync(resolve(ROOT, "fixtures/required-substrings.json"), "utf8"));
const providers = JSON.parse(readFileSync(resolve(ROOT, "config/providers.json"), "utf8"));
const str = (h: string) => Buffer.from(h, "hex").toString("utf8");

const E2E_ATTESTOR = "0x3522ca52bd619e230ef7b5c1845fb19a68a14da9";
const E2E_OWNER = "0xc76daa73f2dcea9d6ac089e008f95b57eba9e6e3";

describe("simulated attestor keys", () => {
  it("defaults are the e2e instance's attestor and owner", () => {
    expect(addressOfSecret(DEFAULT_SIM_ATTESTOR_SECRET)).toBe(E2E_ATTESTOR);
    expect(addressOfSecret(DEFAULT_SIM_OWNER_SECRET)).toBe(E2E_OWNER);
    expect(addressOfSecret(vec.attestorSecret)).toBe(vec.attestorAddress);
  });
});

describe("signClaim vs attestor-core reference vector", () => {
  it("reproduces parameters, context, identifier and signature byte for byte", () => {
    const p = JSON.parse(vec.parameters);
    const ctx = JSON.parse(vec.context);
    const raw = signClaim({
      params: zkFetchParams(p.url, p.responseMatches, p.responseRedactions),
      extracted: ctx.extractedParameters,
      context: { contextAddress: ctx.contextAddress, contextMessage: ctx.contextMessage },
      attestorSecret: vec.attestorSecret,
      owner: vec.owner,
      timestampS: vec.timestampS,
      epoch: vec.epoch,
    });
    expect(raw.claimData.parameters).toBe(vec.parameters);
    expect(raw.claimData.context).toBe(vec.context);
    expect(raw.identifier).toBe(vec.identifier);
    expect(raw.signatures[0]).toBe(vec.signature);
  });
});

describe("simulated demo proof", () => {
  const demo = new DemoStore(null);
  demo.bump("clip-7", { views: 98765, desc: 'Join: CR-7F3K9Q\nquote "x" \\ fake "viewCount":"1"' });
  const url = "https://verifier.example/demo/videos/clip-7";
  const matches: ResponseMatch[] = providers.demo.responseMatches;
  const body = JSON.stringify(demo.youtubeShape("clip-7"));
  const extracted = extractFromBody(body, matches)!;
  const timestampS = 1_760_000_000;
  const raw = signClaim({
    params: zkFetchParams(url, matches, matches.map((m) => ({ regex: m.value }))),
    extracted,
    attestorSecret: DEFAULT_SIM_ATTESTOR_SECRET,
    owner: addressOfSecret(DEFAULT_SIM_OWNER_SECRET),
    timestampS,
  });
  const pj = toProofJson(raw);

  it("extracts raw (still JSON-escaped) groups like the attestor", () => {
    expect(extracted.views).toBe("98765");
    expect(extracted.desc).toBe(JSON.stringify(demo.state.videos["clip-7"].desc).slice(1, -1));
    expect(extracted.desc).toContain("CR-7F3K9Q");
    expect(extractValues(raw)).toEqual({ views: "98765", desc: extracted.desc });
    expect(extractFromBody(JSON.stringify(demo.youtubeShape("missing")), matches)).toBeNull();
  });

  it("recomputed identifier/digest recover the simulated attestor", () => {
    const { identifier, digest } = claimDigest(str(pj.parameters), str(pj.context), str(pj.owner), pj.timestampS, pj.epoch);
    expect(identifier).toBe(raw.identifier);
    expect(recoverAddress(digest, pj.signature, pj.recoveryId)).toBe(E2E_ATTESTOR);
    expect(str(pj.owner)).toBe(E2E_OWNER);
    expect([pj.timestampS, pj.epoch]).toEqual([timestampS, 1]);
  });

  it("parameters carry what the contract checks (url needle + required substrings)", () => {
    const params = str(pj.parameters);
    expect(params).toContain(`"url":"${url}"`);
    for (const r of req.demo.required as string[]) expect(params).toContain(r);
    const ctx = JSON.parse(str(pj.context));
    expect(ctx.extractedParameters).toEqual(extracted);
    expect(ctx.providerHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
