import { describe, expect, it } from "vitest";
import {
  baseBudget,
  clipWeight,
  epochBudget,
  estimateClipPay,
  estimateEpoch,
  heldOf,
  holdbackShare,
  participantWeight,
  payFor,
  rateEstimate,
  rateFor,
} from "../src";
import { USDC, epochState, params } from "./fixtures";

// Replicates contracts/cliprail/src/test/flows.rs happy_path_two_participants_three_clips_two_epochs.
describe("happy path (flows.rs)", () => {
  const p = params();

  // epoch 0: a1 1_000 → 21_000, a2 0 → 10_000, b1 500 → 30_500
  const a1w0 = clipWeight(p, 1_000n, 21_000n);
  const a2w0 = clipWeight(p, 0n, 10_000n);
  const b1w0 = clipWeight(p, 500n, 30_500n);
  const aRaw0 = a1w0 + a2w0;
  const a0 = { raw: aRaw0, weight: participantWeight(p, aRaw0) };
  const b0 = { raw: b1w0, weight: participantWeight(p, b1w0) };
  const W0 = a0.weight + b0.weight;

  it("epoch 0 settlement", () => {
    expect([a1w0, a2w0, b1w0]).toEqual([20_000n, 10_000n, 30_000n]);
    expect(W0).toBe(60_000n);
    const est = estimateEpoch(p, 0, epochState({ total_weight: W0 }));
    expect(est).toEqual({ budget: 500n * USDC, rate: USDC, spent: 60n * USDC, held_total: 12n * USDC, final: false });
    expect(rateEstimate(p, 500n * USDC, W0)).toBe(USDC);
  });

  it("epoch 0 claims: 20/10/30 USDC, immediate 16/8/24", () => {
    const rate = USDC;
    const a1 = estimateClipPay(p, 0, rate, a0, a1w0);
    const a2 = estimateClipPay(p, 0, rate, a0, a2w0);
    const b1 = estimateClipPay(p, 0, rate, b0, b1w0);
    expect(a1).toEqual({ pay: 20n * USDC, held: 4n * USDC, immediate: 16n * USDC });
    expect(a2).toEqual({ pay: 10n * USDC, held: 2n * USDC, immediate: 8n * USDC });
    expect(b1).toEqual({ pay: 30n * USDC, held: 6n * USDC, immediate: 24n * USDC });
    // a2 has no epoch-1 proof → held_survived = 4 + 6 = 10, held_total = 12
    const st = { held_total: 12n * USDC, held_survived: 10n * USDC };
    expect(holdbackShare(a1.held, st)).toBe((48n * USDC) / 10n);
    expect(holdbackShare(b1.held, st)).toBe((72n * USDC) / 10n);
  });

  it("epoch 1: carry 440, spent 70, no holdback in the last epoch", () => {
    const prev = epochState({ settled: true, total_weight: W0, budget: 500n * USDC, rate: USDC, spent: 60n * USDC });
    expect(epochBudget(p, 1, prev)).toBe(940n * USDC);
    const a1w1 = clipWeight(p, 21_000n, 41_000n);
    const b1w1 = clipWeight(p, 30_500n, 130_500n); // min(100_000, cap 50_000)
    expect([a1w1, b1w1]).toEqual([20_000n, 50_000n]);
    const est = estimateEpoch(p, 1, epochState({ total_weight: a1w1 + b1w1 }), prev);
    expect(est).toMatchObject({ budget: 940n * USDC, rate: USDC, spent: 70n * USDC, held_total: 0n });
    const a1 = estimateClipPay(p, 1, est.rate, { raw: a1w1, weight: a1w1 }, a1w1);
    const b1 = estimateClipPay(p, 1, est.rate, { raw: b1w1, weight: b1w1 }, b1w1);
    expect(a1).toEqual({ pay: 20n * USDC, held: 0n, immediate: 20n * USDC });
    expect(b1).toEqual({ pay: 50n * USDC, held: 0n, immediate: 50n * USDC });
    // refund = 1000 − (60 + 70) = 870
    expect(p.budget - 60n * USDC - 70n * USDC).toBe(870n * USDC);
  });

  it("settled state returns the final rate", () => {
    const st = epochState({ settled: true, rate: 123n, budget: 1n, spent: 1n, held_total: 0n });
    expect(rateEstimate(p, st)).toBe(123n);
    expect(estimateEpoch(p, 0, st).final).toBe(true);
  });
});

describe("rate cap and carry (flows.rs rate_cap_and_carry)", () => {
  it("W=10_000 with 50 USDC → capped at r_max; next epoch 90 USDC, W=0 → rate 0", () => {
    const p = params({ budget: 100n * USDC, holdback_bps: 0 });
    const e0 = estimateEpoch(p, 0, epochState({ total_weight: 10_000n }));
    expect(e0.rate).toBe(USDC);
    expect(e0.spent).toBe(10n * USDC);
    const prev = epochState({ settled: true, budget: e0.budget, spent: e0.spent });
    const e1 = estimateEpoch(p, 1, epochState(), prev);
    expect(e1.budget).toBe(90n * USDC);
    expect(e1.rate).toBe(0n);
  });
});

describe("primitives", () => {
  it("base budget remainder goes to the last epoch", () => {
    const p = params({ budget: 10n, epochs: 3 });
    expect([0, 1, 2].map((e) => baseBudget(p, e))).toEqual([3n, 3n, 4n]);
  });
  it("oversubscribed rate floors", () => {
    const p = params();
    // 500 USDC over 7_000_000 views → floor(5e9·1000/7e6) = 714_285
    expect(rateFor(p, 500n * USDC, 7_000_000n)).toBe(714_285n);
    expect(rateFor(p, 500n * USDC, 0n)).toBe(0n);
  });
  it("human cap scales pay by w_p/raw_p", () => {
    // raw 150_000 capped to 100_000; clip weight 50_000 → pay = rate·100k·50k/(150k·1000)
    expect(payFor(USDC, 100_000n, 150_000n, 50_000n)).toBe((USDC * 100_000n * 50_000n) / (150_000n * 1000n));
    expect(payFor(USDC, 0n, 0n, 10n)).toBe(0n);
  });
  it("held is rounded up and zero in the last epoch", () => {
    const p = params(); // 2 epochs, 20%
    expect(heldOf(p, 0, 7n)).toBe(2n); // ceil(1.4)
    expect(heldOf(p, 0, 5n)).toBe(1n); // exact
    expect(heldOf(p, 0, 0n)).toBe(0n);
    expect(heldOf(p, 1, 7n)).toBe(0n);
  });
  it("clip weight below min_views is zero, and never negative", () => {
    const p = params();
    expect(clipWeight(p, 1000n, 1099n)).toBe(0n);
    expect(clipWeight(p, 1000n, 1100n)).toBe(100n);
    expect(clipWeight(p, 1000n, 900n)).toBe(0n);
  });
});
