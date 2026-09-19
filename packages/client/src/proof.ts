import { Buffer } from "buffer";
import type { ReclaimProof } from "cliprail-client";

/** Verifier `POST /proof` payload (INTERFACES §4); byte fields are hex without 0x. */
export interface ProofJson {
  parameters: string;
  context: string;
  owner: string;
  timestampS: number;
  epoch: number;
  /** 128 hex chars, r‖s */
  signature: string;
  /** 0 | 1 */
  recoveryId: number;
}

const HEX_RE = /^(?:[0-9a-f]{2})*$/i;

function hexBytes(v: unknown, field: string): Buffer {
  if (typeof v !== "string" || !HEX_RE.test(v)) throw new Error(`proof.${field} must be even-length hex`);
  return Buffer.from(v, "hex");
}

/** ProofJson → bindings `ReclaimProof` (same field mapping as services/verifier/src/scval.ts). */
export function proofJsonToReclaimProof(p: ProofJson): ReclaimProof {
  if (typeof p.signature !== "string" || !/^[0-9a-f]{128}$/i.test(p.signature)) throw new Error("proof.signature must be 64 bytes hex");
  if (p.recoveryId !== 0 && p.recoveryId !== 1) throw new Error("proof.recoveryId must be 0 or 1");
  if (!Number.isInteger(p.epoch) || p.epoch < 0) throw new Error("proof.epoch must be a u32");
  return {
    parameters: hexBytes(p.parameters, "parameters"),
    context: hexBytes(p.context, "context"),
    owner: hexBytes(p.owner, "owner"),
    timestamp_s: BigInt(p.timestampS),
    epoch: p.epoch,
    signature: Buffer.from(p.signature, "hex"),
    recovery_id: p.recoveryId,
  } as ReclaimProof;
}
