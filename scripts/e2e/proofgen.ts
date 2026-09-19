// Local stand-in for a Reclaim attestor: builds zkFetch-shaped claimData and signs it exactly
// like attestor-core. Signing lives in services/verifier/src/simulated.ts (shared with the
// verifier's ATTESTOR_MODE=simulated).
// TEST KEYS ONLY: derived from public strings, never use them for anything real.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { xdr } from "@stellar/stellar-sdk";
import { reclaimProofToScVal } from "../../services/verifier/src/scval.ts";
import { toProofJson, type ProofJson } from "../../services/verifier/src/proof.ts";
import {
  DEFAULT_SIM_ATTESTOR_SECRET,
  DEFAULT_SIM_OWNER_SECRET,
  addressOfSecret,
  signClaim,
  zkFetchParams,
} from "../../services/verifier/src/simulated.ts";
import { E2E_ENV, ROOT, readEnvFile } from "./lib.ts";

export const ATTESTOR_SECRET = DEFAULT_SIM_ATTESTOR_SECRET;
export const OWNER_SECRET = DEFAULT_SIM_OWNER_SECRET;
export const ATTESTOR_ADDRESS = addressOfSecret(ATTESTOR_SECRET);
export const OWNER = addressOfSecret(OWNER_SECRET);

/** Live Reclaim attestor (witnesses[0].id of a real zkFetch proof); public, not a credential. */
export const RECLAIM_ATTESTOR = "0x244897572368eadf65bfbc5aec98d8e5443a9072";
/**
 * Live Reclaim owner = the address of the Reclaim application secret. It is deployment specific and
 * stays out of the repo: set RECLAIM_OWNER or keep E2E_OWNER_LIVE in scripts/.accounts/e2e.env
 * (live-reclaim.ts records it after a real proof).
 */
export const RECLAIM_OWNER = (process.env.RECLAIM_OWNER || readEnvFile(E2E_ENV).E2E_OWNER_LIVE || "").toLowerCase();

/** url_prefix deployed with the e2e instance (placeholder host; nothing is fetched). */
export const DEFAULT_DEMO_PREFIX = "https://e2e.invalid/demo/videos/";
/** Current demo url_prefix of the e2e instance: set-demo-host.ts records it in e2e.env. */
export const DEMO_PREFIX = readEnvFile(E2E_ENV).E2E_DEMO_PREFIX || DEFAULT_DEMO_PREFIX;

const REQ = JSON.parse(readFileSync(resolve(ROOT, "fixtures/required-substrings.json"), "utf8"));
/** `required` byte strings of the demo platform (as they appear inside canonical parameters). */
export const DEMO_REQUIRED: string[] = REQ.demo.required;
const DEMO_REGEX: string[] = REQ.demo.regexValues;

export type LocalProof = {
  json: ProofJson;
  scval: xdr.ScVal;
  identifier: string;
  parameters: string;
  context: string;
  timestampS: number;
};

/**
 * Sign a demo-platform claim for `videoId` with the given view count and description.
 * `timestampS` should be chain time (ledger close time).
 */
export function makeProof(videoId: string, views: number | bigint, desc: string, timestampS: number, contextMessage = ""): LocalProof {
  const params = zkFetchParams(
    DEMO_PREFIX + videoId,
    DEMO_REGEX.map((value) => ({ type: "regex" as const, value })),
  );
  const raw = signClaim({
    params,
    extracted: { views: String(views), desc },
    context: { contextAddress: "0x0", contextMessage },
    attestorSecret: ATTESTOR_SECRET,
    owner: OWNER,
    timestampS,
  });
  const json: ProofJson = toProofJson(raw);
  const { parameters, context } = raw.claimData;
  return { json, scval: reclaimProofToScVal(json), identifier: raw.identifier!, parameters, context, timestampS };
}
