import {
  canClaim,
  canClaimHoldback,
  canRespond,
  canSubmitProof,
  contentEnd,
  estimateEpoch,
  holdbackShare,
  lastEpoch,
  participantWeight,
  payFor,
  proofEnd,
  refundAt,
  splitPay,
  holdbackReleaseEnd,
  type CampaignView,
  type ClipView,
  type Dispute,
  type EpochState,
} from "@cliprail/shared";
import type { PillStatus } from "@/components/common/StatusPill";
import { formatDuration } from "@/lib/hooks/useNow";

export type CellAction =
  | { kind: "close"; enabled: boolean; reason?: string }
  | { kind: "respond"; enabled: boolean; reason?: string; disputeId: bigint }
  | { kind: "claim"; enabled: boolean; reason?: string }
  | { kind: "holdback"; enabled: boolean; reason?: string };

export interface Cell {
  epoch: number;
  weight: bigint | null;
  /** Total share (immediate + held): final after settle, otherwise an estimate at the epoch's current total weight */
  pay: bigint;
  immediate: bigint;
  held: bigint;
  holdbackPayout: bigint;
  final: boolean;
  status: PillStatus | null;
  action: CellAction | null;
  note?: string;
  /** Parts that can no longer be claimed (expired claim, forfeited holdback): excluded from totals */
  lost?: { immediate?: boolean; held?: boolean };
}

/** A participant's raw weight in an epoch: the sum of w_clip over their non-excluded clips (same as the contract). */
function participantRaw(all: ClipView[], owner: string, e: number): bigint {
  let raw = 0n;
  for (const v of all) {
    if (v.clip.owner !== owner) continue;
    const ce = v.epochs[e];
    if (ce && ce.status !== "Excluded") raw += ce.weight;
  }
  return raw;
}

/**
 * The payout estimate, status and (phase-dependent) action for one clip-epoch cell.
 * Window rules come from the can* helpers in @cliprail/shared, identical to the contract.
 */
export function buildCell(
  c: CampaignView,
  view: ClipView,
  all: ClipView[],
  epochs: EpochState[] | undefined,
  disputes: Dispute[] | undefined,
  e: number,
  now: bigint,
): Cell {
  const p = c.params;
  const ce = view.epochs[e];
  const st = epochs?.[e];
  const empty: Cell = { epoch: e, weight: null, pay: 0n, immediate: 0n, held: 0n, holdbackPayout: 0n, final: false, status: null, action: null };

  if (e < view.clip.first_epoch) return { ...empty, note: "Before registration" };

  // No closing proof yet
  if (!ce) {
    if (canSubmitProof(p, e, now)) return { ...empty, status: "Pending", action: { kind: "close", enabled: true } };
    if (now < contentEnd(p, e))
      return {
        ...empty,
        status: "Pending",
        action: { kind: "close", enabled: false, reason: `The proof window opens in ${formatDuration(contentEnd(p, e) - now)}` },
      };
    return { ...empty, note: "No proof submitted" };
  }

  // Payout: the final rate after settle, an estimate from the current W before it
  const est = st ? estimateEpoch(p, e, st, e > 0 ? epochs?.[e - 1] : null) : null;
  const raw = participantRaw(all, view.clip.owner, e);
  const wP = participantWeight(p, raw);
  const pay = est && ce.status !== "Excluded" ? payFor(est.rate, wP, raw, ce.weight) : 0n;
  const split = splitPay(p, e, pay);
  const holdbackPayout = st?.settled && ce.alive ? holdbackShare(split.held, st) : 0n;
  const base: Cell = {
    epoch: e,
    weight: ce.weight,
    pay,
    immediate: split.immediate,
    held: split.held,
    holdbackPayout,
    final: !!est?.final,
    status: null,
    action: null,
  };

  if (ce.status === "Excluded") return { ...base, status: "Excluded", note: "You lost the challenge; no payout this epoch" };
  if (ce.status === "Responded") return { ...base, status: "Responded", note: "Waiting for the arbiter's decision" };
  if (ce.status === "Challenged") {
    const d = disputes?.find((x) => x.clip_id === view.clip.id && x.epoch === e && x.status === "Open");
    if (!d) return { ...base, status: "Challenged" };
    return {
      ...base,
      status: "Challenged",
      action: canRespond(p, e, now)
        ? { kind: "respond", enabled: true, disputeId: d.id }
        : { kind: "respond", enabled: false, disputeId: d.id, reason: "The response window has closed" },
    };
  }

  // Active
  if (canSubmitProof(p, e, now)) {
    // While the window is open, a new proof with a higher view count can be submitted
    return { ...base, status: "Active", action: { kind: "close", enabled: true }, note: "The window is open; you can submit a new proof" };
  }
  if (!st?.settled) {
    return {
      ...base,
      status: "Active",
      action: {
        kind: "claim",
        enabled: false,
        reason:
          now < proofEnd(p, e)
            ? "The proof window is still open"
            : "The epoch is not settled yet: the amount shown is an estimate at the current total weight",
      },
    };
  }
  if (!ce.claimed) {
    if (pay === 0n) return { ...base, status: "Active", note: "No payout this epoch (weight 0)" };
    if (!canClaim(p, now)) {
      return { ...base, status: "Active", note: "The claim window closed; the share went back to the brand", lost: { immediate: true, held: true } };
    }
    return { ...base, status: "Claimable", action: { kind: "claim", enabled: true } };
  }

  // Claim edildi → holdback
  if (split.held === 0n || e >= lastEpoch(p)) return { ...base, status: "Claimed" };
  if (ce.holdback_claimed) return { ...base, status: "Claimed", note: "Holdback claimed too" };
  if (!ce.alive) {
    // The window opens at proof_end(e+1) (lib.rs claim_holdback: now >= proof_end(e+1))
    if (now >= holdbackReleaseEnd(p, e))
      return { ...base, status: "Claimed", note: "Holdback forfeited (no proof in the next epoch)", lost: { held: true } };
    return {
      ...base,
      status: "Holdback",
      action: { kind: "holdback", enabled: false, reason: "Waiting for the next epoch's closing proof" },
    };
  }
  if (now >= refundAt(p)) return { ...base, status: "Claimed", note: "The holdback window has closed", lost: { held: true } };
  if (holdbackPayout === 0n) return { ...base, status: "Claimed", note: "Holdback share is 0", lost: { held: true } };
  if (canClaimHoldback(p, e, now)) return { ...base, status: "Holdback", action: { kind: "holdback", enabled: true } };
  return {
    ...base,
    status: "Holdback",
    action: {
      kind: "holdback",
      enabled: false,
      reason: now >= refundAt(p) ? "The window has closed" : `Opens in ${formatDuration(holdbackReleaseEnd(p, e) - now)}`,
    },
  };
}

export interface Totals {
  earned: bigint;
  pending: bigint;
  holdback: bigint;
}

export function addTotals(t: Totals, cell: Cell, ce: { claimed: boolean; holdback_claimed: boolean } | null) {
  if (!ce || cell.status === "Excluded") return;
  if (ce.claimed) t.earned += cell.immediate;
  else if (!cell.lost?.immediate) t.pending += cell.immediate;
  if (ce.holdback_claimed) t.earned += cell.holdbackPayout;
  else if (!cell.lost?.held) t.holdback += cell.held;
}
