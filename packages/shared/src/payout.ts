// Mirrors the payout math in contracts/cliprail/src/epoch.rs and lib.rs (claim / claim_holdback).
// All integer divisions truncate like Rust i128 (values are non-negative here, so = floor).

import type { CampaignParams, EpochState } from "./types";

type PayoutParams = Pick<
  CampaignParams,
  "budget" | "epochs" | "rate_max_per_1k" | "holdback_bps" | "cap_views_clip" | "cap_views_human" | "min_views"
>;

const last = (p: Pick<CampaignParams, "epochs">) => p.epochs - 1;

/** Base share of the budget for epoch `e`; the integer remainder goes to the last epoch. */
export function baseBudget(p: Pick<CampaignParams, "budget" | "epochs">, e: number): bigint {
  const n = BigInt(p.epochs);
  let b = p.budget / n;
  if (e === last(p)) b += p.budget % n;
  return b;
}

/** Carry into epoch e = unspent budget of e-1, known only once e-1 is settled. */
export function carryIn(prev: EpochState | null | undefined): bigint {
  return prev && prev.settled ? prev.budget - prev.spent : 0n;
}

/** budget_e = base_budget(e) + carry. Pass the state of epoch e-1 (ignored for e = 0). */
export function epochBudget(p: Pick<CampaignParams, "budget" | "epochs">, e: number, prev?: EpochState | null): bigint {
  return baseBudget(p, e) + (e === 0 ? 0n : carryIn(prev));
}

/** rate = min(r_max, floor(1000·budget_e / W)); 0 when W = 0. Same as `rate_for`. */
export function rateFor(p: Pick<CampaignParams, "rate_max_per_1k">, budgetE: bigint, w: bigint): bigint {
  if (w === 0n) return 0n;
  const r = (budgetE * 1000n) / w;
  return r > p.rate_max_per_1k ? p.rate_max_per_1k : r;
}

/**
 * Rate estimate for an epoch.
 * - `EpochState` that is settled → its final `rate`.
 * - otherwise `budgetE` must be given (see `epochBudget`); W defaults to `state.total_weight`.
 */
export function rateEstimate(
  p: Pick<CampaignParams, "rate_max_per_1k">,
  src: bigint | EpochState,
  w?: bigint,
  budgetE?: bigint,
): bigint {
  if (typeof src === "bigint") {
    if (w === undefined) throw new Error("rateEstimate: W is required with a budget");
    return rateFor(p, src, w);
  }
  if (src.settled) return src.rate;
  if (budgetE === undefined) throw new Error("rateEstimate: budget_e is required for an unsettled epoch");
  return rateFor(p, budgetE, w ?? src.total_weight);
}

/** Holdback bps for epoch e: the last epoch has none. */
export function holdbackBps(p: Pick<CampaignParams, "epochs" | "holdback_bps">, e: number): bigint {
  return e >= last(p) ? 0n : BigInt(p.holdback_bps);
}

/** Clip weight for one epoch: growth over baseline, capped per clip, zero below `min_views`. */
export function clipWeight(p: Pick<CampaignParams, "cap_views_clip" | "min_views">, baseline: bigint, views: bigint): bigint {
  if (views < baseline) return 0n;
  let w = views - baseline;
  if (w > p.cap_views_clip) w = p.cap_views_clip;
  return w < p.min_views ? 0n : w;
}

/** Participant weight: raw = Σ clip weights, weight = min(raw, cap_views_human). */
export function participantWeight(p: Pick<CampaignParams, "cap_views_human">, raw: bigint): bigint {
  return raw < p.cap_views_human ? raw : p.cap_views_human;
}

/** pay = rate · w_p · w_clip / (raw_p · 1000); 0 if raw_p or w_clip is 0. */
export function payFor(rate: bigint, wP: bigint, rawP: bigint, wClip: bigint): bigint {
  if (rawP === 0n || wClip === 0n) return 0n;
  return (rate * wP * wClip) / (rawP * 1000n);
}

/** Held part of a clip's pay, rounded UP: ceil(pay·bps/10000); 0 in the last epoch. */
export function heldOf(p: Pick<CampaignParams, "epochs" | "holdback_bps">, e: number, pay: bigint): bigint {
  const bps = holdbackBps(p, e);
  if (bps === 0n || pay <= 0n) return 0n;
  return (pay * bps + 9_999n) / 10_000n;
}

export interface PaySplit {
  pay: bigint;
  held: bigint;
  immediate: bigint;
}

export function splitPay(p: Pick<CampaignParams, "epochs" | "holdback_bps">, e: number, pay: bigint): PaySplit {
  const held = heldOf(p, e, pay);
  return { pay, held, immediate: pay - held };
}

export interface EpochEstimate {
  budget: bigint;
  rate: bigint;
  spent: bigint;
  held_total: bigint;
  /** true when taken from a settled EpochState */
  final: boolean;
}

/**
 * Epoch-level numbers: exact after settle, otherwise what `compute_settlement` would produce now.
 * `prev` = state of epoch e-1 (for the carry); unsettled prev ⇒ carry 0, as in the contract.
 */
export function estimateEpoch(p: PayoutParams, e: number, st: EpochState, prev?: EpochState | null): EpochEstimate {
  if (st.settled) {
    return { budget: st.budget, rate: st.rate, spent: st.spent, held_total: st.held_total, final: true };
  }
  const budget = epochBudget(p, e, prev);
  const rate = rateFor(p, budget, st.total_weight);
  const spent = (rate * st.total_weight) / 1000n;
  const held_total = (spent * holdbackBps(p, e)) / 10_000n;
  return { budget, rate, spent, held_total, final: false };
}

/** Estimated split for one clip in epoch e. */
export function estimateClipPay(
  p: PayoutParams,
  e: number,
  rate: bigint,
  participant: { raw: bigint; weight: bigint },
  wClip: bigint,
): PaySplit {
  return splitPay(p, e, payFor(rate, participant.weight, participant.raw, wClip));
}

/** claim_holdback share: held_i · held_total / held_survived (0 if nothing survived). */
export function holdbackShare(heldI: bigint, st: Pick<EpochState, "held_total" | "held_survived">): bigint {
  if (st.held_survived === 0n) return 0n;
  return (heldI * st.held_total) / st.held_survived;
}
