// Mirrors contracts/cliprail/src/epoch.rs (timeline) plus the phase guards in lib.rs / dispute.rs.
//
//   content  [epochStart(e), content_end(e))
//   proof    [content_end(e), proof_end(e))        submit_proof (half-open)
//   challenge[proof_end(e), challenge_end(e))      challenge
//   response [challenge_end(e), dispute_end(e))    respond is allowed for the whole  < dispute_end
//   arbiter  [dispute_end(e), settle_at(e))        resolve
//   settle   ≥ settle_at(e)                        settle_epoch; claims until refund_at

import type { CampaignParams } from "./types";

type TimelineParams = Pick<
  CampaignParams,
  "start" | "epoch_len" | "epochs" | "proof_window" | "dispute_window" | "arbiter_window" | "claim_grace"
>;

const B = (e: number) => BigInt(e);

export const epochStart = (p: TimelineParams, e: number): bigint => p.start + B(e) * p.epoch_len;
export const contentEnd = (p: TimelineParams, e: number): bigint => p.start + (B(e) + 1n) * p.epoch_len;
export const proofEnd = (p: TimelineParams, e: number): bigint => contentEnd(p, e) + p.proof_window;
export const challengeEnd = (p: TimelineParams, e: number): bigint => proofEnd(p, e) + p.dispute_window / 2n;
export const disputeEnd = (p: TimelineParams, e: number): bigint => proofEnd(p, e) + p.dispute_window;
export const settleAt = (p: TimelineParams, e: number): bigint => disputeEnd(p, e) + p.arbiter_window;
export const lastEpoch = (p: TimelineParams): number => p.epochs - 1;
export const refundAt = (p: TimelineParams): bigint => settleAt(p, lastEpoch(p)) + p.claim_grace;
/** claim_holdback(e) opens at this instant (`now >= proof_end(e+1)`, see lib.rs claim_holdback). */
export const holdbackReleaseEnd = (p: TimelineParams, e: number): bigint => proofEnd(p, e + 1);

/** Content epoch index at `now`: 0 before start, `epochs` after the last content period. */
export function currentEpoch(p: TimelineParams, now: bigint): number {
  if (now < p.start) return 0;
  const e = (now - p.start) / p.epoch_len;
  return e >= B(p.epochs) ? p.epochs : Number(e);
}

export type Phase = "upcoming" | "content" | "proof" | "challenge" | "response" | "arbiter" | "settleable";

export function phaseOf(p: TimelineParams, e: number, now: bigint): Phase {
  if (now < epochStart(p, e)) return "upcoming";
  if (now < contentEnd(p, e)) return "content";
  if (now < proofEnd(p, e)) return "proof";
  if (now < challengeEnd(p, e)) return "challenge";
  if (now < disputeEnd(p, e)) return "response";
  if (now < settleAt(p, e)) return "arbiter";
  return "settleable";
}

// ---- action guards (same comparisons as the contract)

/** join / register_clip: `now < content_end(last)`. */
export const canJoin = (p: TimelineParams, now: bigint) => now < contentEnd(p, lastEpoch(p));
/** submit_proof(e): `[content_end(e), proof_end(e))`. */
export const canSubmitProof = (p: TimelineParams, e: number, now: bigint) =>
  now >= contentEnd(p, e) && now < proofEnd(p, e);
/** challenge(e): `[proof_end(e), challenge_end(e))`. */
export const canChallenge = (p: TimelineParams, e: number, now: bigint) =>
  now >= proofEnd(p, e) && now < challengeEnd(p, e);
/** respond: `now < dispute_end(e)` (dispute must be Open). */
export const canRespond = (p: TimelineParams, e: number, now: bigint) => now < disputeEnd(p, e);
/** resolve: `[dispute_end(e), settle_at(e))` (dispute must be Responded). */
export const canResolve = (p: TimelineParams, e: number, now: bigint) =>
  now >= disputeEnd(p, e) && now < settleAt(p, e);
/** settle_epoch(e): `now >= settle_at(e)` (plus no open disputes, previous epoch settled). */
export const canSettle = (p: TimelineParams, e: number, now: bigint) => now >= settleAt(p, e);
/** claim / claim_holdback: `now < refund_at` (and epoch settled). */
export const canClaim = (p: TimelineParams, now: bigint) => now < refundAt(p);
/** claim_holdback(e): `e < last`, `proof_end(e+1) <= now < refund_at`. */
export const canClaimHoldback = (p: TimelineParams, e: number, now: bigint) =>
  e < lastEpoch(p) && now >= holdbackReleaseEnd(p, e) && now < refundAt(p);
/** refund: `now >= refund_at`. */
export const canRefund = (p: TimelineParams, now: bigint) => now >= refundAt(p);

// ---- UI rows

export interface TimelineRow {
  key: string;
  epoch: number | null;
  phase: Phase | "refund";
  label: string;
  start: bigint;
  /** exclusive; null = open-ended */
  end: bigint | null;
  active: boolean;
}

const PHASE_LABEL: Record<Exclude<Phase, "upcoming">, string> = {
  content: "İçerik dönemi",
  proof: "Kanıt penceresi",
  challenge: "İtiraz penceresi",
  response: "Cevap süresi",
  arbiter: "Hakem kararı",
  settleable: "Ödeme",
};

/** One row per phase per epoch plus a final refund row. Intervals are half-open [start, end). */
export function timelineRows(p: TimelineParams, now: bigint): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const push = (epoch: number | null, phase: TimelineRow["phase"], label: string, start: bigint, end: bigint | null) =>
    rows.push({
      key: epoch === null ? phase : `${epoch}:${phase}`,
      epoch,
      phase,
      label,
      start,
      end,
      active: now >= start && (end === null || now < end),
    });
  for (let e = 0; e < p.epochs; e++) {
    const n = `Dönem ${e + 1}`;
    push(e, "content", `${n} · ${PHASE_LABEL.content}`, epochStart(p, e), contentEnd(p, e));
    push(e, "proof", `${n} · ${PHASE_LABEL.proof}`, contentEnd(p, e), proofEnd(p, e));
    push(e, "challenge", `${n} · ${PHASE_LABEL.challenge}`, proofEnd(p, e), challengeEnd(p, e));
    push(e, "response", `${n} · ${PHASE_LABEL.response}`, challengeEnd(p, e), disputeEnd(p, e));
    push(e, "arbiter", `${n} · ${PHASE_LABEL.arbiter}`, disputeEnd(p, e), settleAt(p, e));
    push(e, "settleable", `${n} · ${PHASE_LABEL.settleable}`, settleAt(p, e), refundAt(p));
  }
  push(null, "refund", "İade (markaya)", refundAt(p), null);
  return rows;
}

export const PHASE_LABELS = PHASE_LABEL;
