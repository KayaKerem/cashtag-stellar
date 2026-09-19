// Regression over a REAL Reclaim zkFetch proof of a PUBLIC X (Twitter) post, taken without login
// from the endpoint the official embed widget uses (fixtures/reclaim/x-live-proof.json).
// Offline: no network, no zkFetch. Mirrors every check contracts/reclaim-verify::verify makes, so
// a change in Reclaim's byte format — or in config/providers.json — breaks this test, not the chain.
//
// NOTE ON THE METRIC: cdn.syndication.twimg.com exposes no view count, only `favorite_count`
// (likes) and `conversation_count` (replies). The `views` slot therefore carries LIKES for the
// `x` platform; providers.json records that as `metric: "likes"`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalContext, toProofJson, type ZkProof } from "../src/proof.js";
import { providers } from "../src/config.js";
import { proofUrl } from "../src/zkfetch.js";
import { claimDigest, recoverAddress } from "./helpers.js";

const FIX = resolve(__dirname, "../../../fixtures");
const proof: ZkProof = JSON.parse(readFileSync(resolve(FIX, "reclaim/x-live-proof.json"), "utf8"));
const required: string[] = JSON.parse(readFileSync(resolve(FIX, "required-substrings.json"), "utf8")).x.required;

/** Reclaim's attestor node, as recorded in the proof's witness. */
const LIVE_ATTESTOR = "0x244897572368eadf65bfbc5aec98d8e5443a9072";
/** https://x.com/jack/status/1833951636005552366 — a public post, no login needed. */
const TWEET_ID = "1833951636005552366";
/** Stand-in for a participant's CR-XXXXXX: any substring of the post text the contract looks for. */
const CODE = "running code";

const str = (hex: string) => Buffer.from(hex, "hex").toString("utf8");
const pj = toProofJson(proof);

describe("live Reclaim proof (x platform, public post, no login)", () => {
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
    expect(str(pj.owner)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(str(pj.parameters)).toBe(proof.claimData.parameters);
    expect(str(pj.context)).toBe(canonicalContext(proof.claimData.context));
  });

  it("carries url_prefix‖id‖url_suffix and every `required` substring inside `parameters`", () => {
    const parameters = str(pj.parameters);
    const expectedUrl = `${providers.x.urlPrefix}${TWEET_ID}${providers.x.urlSuffix}`;
    expect(JSON.parse(parameters).url).toBe(expectedUrl);
    expect(proofUrl("x", TWEET_ID)).toBe(expectedUrl); // providers.json still builds this url
    expect(parameters).toContain(`"url":"${expectedUrl}"`); // the needle reclaim_verify builds
    for (const r of required) expect(parameters).toContain(r);
  });

  it("exposes the engagement metric and the post text through the canonical context", () => {
    const ctx = JSON.parse(str(pj.context));
    expect(Object.keys(ctx)).toEqual(["extractedParameters", "providerHash"]);
    expect(ctx.extractedParameters.views).toMatch(/^\d+$/); // likes, see the file header
    expect(ctx.extractedParameters.desc).toContain(CODE); // where a CR-XXXXXX code would sit
  });

  it("names the metric honestly in config/providers.json", () => {
    expect(providers.x.metric).toBe("likes");
  });
});
