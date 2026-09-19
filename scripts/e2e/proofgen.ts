// Local stand-in for a Reclaim attestor: builds zkFetch-shaped claimData and signs it exactly
// like attestor-core (src/utils/claims.ts + src/utils/signatures/eth.ts), see
// docs/reclaim-notes.md and fixtures/reclaim/gen-reference-vector.mjs.
// TEST KEYS ONLY: derived from public strings, never use them for anything real.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import canonicalize from "canonicalize";
import { keccak256, toUtf8Bytes, Wallet, SigningKey, computeAddress, hashMessage } from "ethers";
import type { xdr } from "@stellar/stellar-sdk";
import { reclaimProofToScVal } from "../../services/verifier/src/scval.ts";
import { splitSignature, utf8Hex, type ProofJson } from "../../services/verifier/src/proof.ts";
import { ROOT } from "./lib.ts";

export const ATTESTOR_SECRET = keccak256(toUtf8Bytes("cliprail-e2e-test-attestor"));
export const OWNER_SECRET = keccak256(toUtf8Bytes("cliprail-e2e-test-owner"));
const attestor = new Wallet(ATTESTOR_SECRET);
export const ATTESTOR_ADDRESS = attestor.address.toLowerCase();
export const OWNER = computeAddress(new SigningKey(OWNER_SECRET).publicKey).toLowerCase();

export const DEMO_PREFIX = "https://e2e.invalid/demo/videos/";

const REQ = JSON.parse(readFileSync(resolve(ROOT, "fixtures/required-substrings.json"), "utf8"));
/** `required` byte strings of the demo platform (as they appear inside canonical parameters). */
export const DEMO_REQUIRED: string[] = REQ.demo.required;
const DEMO_REGEX: string[] = REQ.demo.regexValues;

const canon = (o: unknown) => (o ? (canonicalize(o) ?? "") : "");

function hashProviderParams(params: any): string {
  const f = {
    url: params.url,
    method: params.method,
    body: params.body ?? "",
    responseMatches: params.responseMatches.map((it: any) => ({ value: it.value, type: it.type, invert: it.invert || undefined })),
    responseRedactions:
      params.responseRedactions?.map((it: any) => ({
        xPath: it.xPath ?? "",
        jsonPath: it.jsonPath ?? "",
        regex: it.regex ?? "",
        hash: it.hash || undefined,
      })) ?? [],
  };
  return keccak256(toUtf8Bytes(canon(f))).toLowerCase();
}

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
  // zkFetch params: headers/geoLocation/paramValues undefined → dropped by canonicalize
  const params = {
    method: "GET",
    url: DEMO_PREFIX + videoId,
    responseMatches: DEMO_REGEX.map((value) => ({ type: "regex", value })),
    headers: undefined,
    geoLocation: undefined,
    responseRedactions: [],
    body: "",
    paramValues: undefined,
  };
  const parameters = canon(params);
  const ctx = {
    contextAddress: "0x0",
    contextMessage,
    providerHash: hashProviderParams(params),
    extractedParameters: { views: String(views), desc },
  };
  const context = canon(ctx);
  const identifier = keccak256(toUtf8Bytes(`http\n${parameters}\n${context}`)).toLowerCase();
  const signData = [identifier, OWNER, String(timestampS), "1"].join("\n");
  const sig = attestor.signingKey.sign(hashMessage(toUtf8Bytes(signData))).serialized; // low-s, v ∈ {27,28}
  const { signature, recoveryId } = splitSignature(sig);
  const json: ProofJson = {
    parameters: utf8Hex(parameters),
    context: utf8Hex(context),
    owner: utf8Hex(OWNER),
    timestampS,
    epoch: 1,
    signature,
    recoveryId,
  };
  return { json, scval: reclaimProofToScVal(json), identifier, parameters, context, timestampS };
}
