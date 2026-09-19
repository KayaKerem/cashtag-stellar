// Campaign timeline (INTERFACES §2.1). Same formulas as the contract and apps/web lib/timeline.ts.
// All inputs may be number or bigint (scValToNative returns bigint for u64); outputs are seconds (number).

type N = number | bigint;
export interface TimelineParams {
  start: N;
  epoch_len: N;
  epochs: N;
  proof_window: N;
  dispute_window: N;
  arbiter_window: N;
  claim_grace: N;
}

const n = (v: N) => Number(v);

export const contentEnd = (p: TimelineParams, e: number) => n(p.start) + (e + 1) * n(p.epoch_len);
export const proofEnd = (p: TimelineParams, e: number) => contentEnd(p, e) + n(p.proof_window);
export const challengeEnd = (p: TimelineParams, e: number) => proofEnd(p, e) + Math.floor(n(p.dispute_window) / 2);
export const disputeEnd = (p: TimelineParams, e: number) => proofEnd(p, e) + n(p.dispute_window);
export const settleAt = (p: TimelineParams, e: number) => disputeEnd(p, e) + n(p.arbiter_window);
export const refundAt = (p: TimelineParams) => settleAt(p, n(p.epochs) - 1) + n(p.claim_grace);

/** Content epoch index at `now`: 0 before start, `epochs` after the last content window. */
export function currentEpoch(p: TimelineParams, now: number): number {
  if (now < n(p.start)) return 0;
  return Math.min(n(p.epochs), Math.floor((now - n(p.start)) / n(p.epoch_len)));
}

export type EpochPhase = "content" | "proof" | "challenge" | "response" | "arbiter" | "settleable";

/** Phase of epoch e at `now` (before content_end it's "content"). */
export function epochPhase(p: TimelineParams, e: number, now: number): EpochPhase {
  if (now < contentEnd(p, e)) return "content";
  if (now <= proofEnd(p, e)) return "proof";
  if (now < challengeEnd(p, e)) return "challenge";
  if (now < disputeEnd(p, e)) return "response";
  if (now < settleAt(p, e)) return "arbiter";
  return "settleable";
}
