// Simulated attestor: builds zkFetch-shaped claims and signs them exactly like attestor-core
// (src/utils/claims.ts + src/utils/signatures/eth.ts). Pure functions only (no config, no I/O),
// shared by the verifier (ATTESTOR_MODE=simulated) and scripts/e2e/proofgen.ts.
// The default keys are TEST KEYS derived from public strings: never trust them on a real deployment.
import canonicalize from "canonicalize";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ZkProof } from "./proof.js";

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const keccakHex = (b: Uint8Array) => "0x" + hex(keccak_256(b));
/** JCS; undefined fields are dropped (same as attestor-core canonicalStringify). */
export const canon = (o: unknown) => (o ? (canonicalize(o) ?? "") : "");

// Same derivation as the e2e instance (scripts/e2e): keccak256(utf8(label)).
export const DEFAULT_SIM_ATTESTOR_SECRET = keccakHex(enc("cliprail-e2e-test-attestor"));
export const DEFAULT_SIM_OWNER_SECRET = keccakHex(enc("cliprail-e2e-test-owner"));

function secretBytes(secret: string): Uint8Array {
  const h = secret.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("simulated attestor/owner secret must be 32 bytes hex");
  return Uint8Array.from(Buffer.from(h, "hex"));
}

/** Lowercase Ethereum address of a secp256k1 secret (hex). */
export function addressOfSecret(secret: string): string {
  const pub = secp256k1.getPublicKey(secretBytes(secret), false);
  return "0x" + hex(keccak_256(pub.slice(1)).slice(12));
}

export type ResponseMatch = { type: "regex" | "contains"; value: string; invert?: boolean };
export type ResponseRedaction = { regex?: string; xPath?: string; jsonPath?: string; hash?: string };

/** `http` provider params as zkFetch sends them (undefined fields vanish in canonicalization). */
export type HttpParams = {
  method: string;
  url: string;
  responseMatches: ResponseMatch[];
  headers?: Record<string, string>;
  geoLocation?: string;
  responseRedactions: ResponseRedaction[];
  body: string;
  paramValues?: Record<string, string>;
};

/** zkFetch `createClaimOnAttestor` params for a GET without public headers. */
export function zkFetchParams(url: string, responseMatches: ResponseMatch[], responseRedactions: ResponseRedaction[] = []): HttpParams {
  return {
    method: "GET",
    url,
    responseMatches: responseMatches.map(({ type, value }) => ({ type, value })),
    headers: undefined,
    geoLocation: undefined,
    responseRedactions,
    body: "",
    paramValues: undefined,
  };
}

export function hashProviderParams(params: HttpParams): string {
  const f = {
    url: params.url,
    method: params.method,
    body: params.body ?? "",
    responseMatches: params.responseMatches.map((it) => ({ value: it.value, type: it.type, invert: it.invert || undefined })),
    responseRedactions:
      params.responseRedactions?.map((it) => ({
        xPath: it.xPath ?? "",
        jsonPath: it.jsonPath ?? "",
        regex: it.regex ?? "",
        hash: it.hash || undefined,
      })) ?? [],
  };
  return keccakHex(enc(canon(f))).toLowerCase();
}

/**
 * Apply responseMatches to the raw response body like the attestor: every match must hold,
 * named regex groups become extractedParameters (raw substrings, JSON escapes kept).
 * Returns null when a match fails.
 */
export function extractFromBody(body: string, matches: ResponseMatch[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const m of matches) {
    if (m.type === "contains") {
      if (body.includes(m.value) === Boolean(m.invert)) return null;
      continue;
    }
    const r = new RegExp(m.value, "s").exec(body);
    if (!r === !m.invert) return null;
    for (const [k, v] of Object.entries(r?.groups ?? {})) if (v !== undefined) out[k] = v;
  }
  return out;
}

export type SignClaimInput = {
  params: HttpParams;
  extracted: Record<string, string>;
  /** extra context fields supplied by the client (e.g. contextAddress/contextMessage); zkFetch without context = {} */
  context?: Record<string, unknown>;
  attestorSecret: string;
  owner: string;
  timestampS: number;
  epoch?: number;
};

/** Signed zkFetch-shaped proof (claimData + signature + witness), accepted by toProofJson/extractValues. */
export function signClaim(x: SignClaimInput): ZkProof {
  const epoch = x.epoch ?? 1;
  const owner = x.owner.toLowerCase();
  const parameters = canon(x.params);
  const context = canon({ ...(x.context ?? {}), providerHash: hashProviderParams(x.params), extractedParameters: x.extracted });
  const identifier = keccakHex(enc(`http\n${parameters}\n${context}`)).toLowerCase();
  const signData = [identifier, owner, String(x.timestampS), String(epoch)].join("\n");
  const msg = enc(signData);
  const digest = keccak_256(new Uint8Array([...enc(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
  const rec = secp256k1.sign(digest, secretBytes(x.attestorSecret), { prehash: false, format: "recovered" }); // recovery ‖ r ‖ s, low-s
  const signature = "0x" + hex(rec.slice(1)) + (27 + rec[0]).toString(16);
  return {
    identifier,
    claimData: { provider: "http", parameters, context, owner, timestampS: x.timestampS, epoch, identifier },
    signatures: [signature],
    witnesses: [{ id: addressOfSecret(x.attestorSecret), url: "simulated://attestor" }],
    extractedParameterValues: x.extracted,
  };
}
