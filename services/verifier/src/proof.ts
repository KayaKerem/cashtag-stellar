// zkFetch proof -> ProofJson (INTERFACES §4) conversion. Pure functions only.
// Byte format: docs/reclaim-notes.md. parameters are sent exactly as signed; context is
// re-canonicalized (JCS) because the attestor hashes canonicalize(JSON.parse(context)).
import canonicalize from "canonicalize";

export type ProofJson = {
  parameters: string; // hex (no 0x) of the exact UTF-8 claim string
  context: string;
  owner: string; // hex of lowercase ASCII "0x…"
  timestampS: number;
  epoch: number;
  signature: string; // 128 hex chars, r‖s
  recoveryId: number; // 0 | 1
};

export type Extracted = { views: string; desc: string };

/** Minimal shape of a zkFetch / js-sdk Proof that we rely on. */
export interface ZkProof {
  identifier?: string;
  claimData: {
    provider: string;
    parameters: string;
    context: string;
    owner: string;
    timestampS: number;
    epoch: number;
    identifier?: string;
  };
  signatures: string[];
  extractedParameterValues?: Record<string, string>;
  witnesses?: unknown[];
}

/** Output of js-sdk transformForOnchain(). */
export interface OnchainProof {
  claimInfo: { provider: string; parameters: string; context: string };
  signedClaim: {
    claim: { identifier: string; owner: string; timestampS: number; epoch: number };
    signatures: string[];
  };
}

/** Canonical (JCS) form of claimData.context, as used in the identifier preimage. */
export const canonicalContext = (ctx: string) => (ctx ? (canonicalize(JSON.parse(ctx)) ?? "") : "");

export const utf8Hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
export const strip0x = (s: string) => (s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s);

/** Split a 65-byte Ethereum-style signature (r‖s‖v) into r‖s hex and recovery id. */
export function splitSignature(sig: string): { signature: string; recoveryId: number } {
  const hex = strip0x(sig).toLowerCase();
  if (!/^[0-9a-f]{130}$/.test(hex)) throw new Error(`bad signature length/format (${hex.length} hex chars)`);
  const v = parseInt(hex.slice(128, 130), 16);
  const recoveryId = v >= 27 ? v - 27 : v;
  if (recoveryId !== 0 && recoveryId !== 1) throw new Error(`bad recovery byte v=${v}`);
  return { signature: hex.slice(0, 128), recoveryId };
}

/** Accepts either a raw zkFetch proof or the transformForOnchain() output. */
export function toProofJson(p: ZkProof | OnchainProof): ProofJson {
  const o: OnchainProof =
    "claimInfo" in p
      ? p
      : {
          claimInfo: { provider: p.claimData.provider, parameters: p.claimData.parameters, context: p.claimData.context },
          signedClaim: {
            claim: {
              identifier: p.claimData.identifier ?? p.identifier ?? "",
              owner: p.claimData.owner,
              timestampS: p.claimData.timestampS,
              epoch: p.claimData.epoch,
            },
            signatures: p.signatures,
          },
        };
  const { claim, signatures } = o.signedClaim;
  if (!signatures?.length) throw new Error("proof has no signatures");
  const { signature, recoveryId } = splitSignature(signatures[0]);
  return {
    parameters: utf8Hex(o.claimInfo.parameters),
    context: utf8Hex(canonicalContext(o.claimInfo.context)),
    owner: utf8Hex(claim.owner.toLowerCase()),
    timestampS: Number(claim.timestampS),
    epoch: Number(claim.epoch),
    signature,
    recoveryId,
  };
}

/** views/desc from extractedParameterValues, falling back to context.extractedParameters. */
export function extractValues(p: ZkProof): Extracted {
  let ex: Record<string, string> | undefined = p.extractedParameterValues;
  if (!ex || ex.views === undefined) {
    try {
      ex = JSON.parse(p.claimData.context)?.extractedParameters;
    } catch {
      /* ignore */
    }
  }
  const views = ex?.views;
  if (views === undefined || !/^\d+$/.test(String(views))) throw new Error("proof has no numeric 'views'");
  return { views: String(views), desc: String(ex?.desc ?? "") };
}

/** URL inside claim parameters (for sanity checks). */
export function claimUrl(p: ZkProof): string | undefined {
  try {
    return JSON.parse(p.claimData.parameters)?.url;
  } catch {
    return undefined;
  }
}
