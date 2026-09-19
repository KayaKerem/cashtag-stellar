import { describe, expect, it } from "vitest";
import {
  canChallenge,
  canClaim,
  canClaimHoldback,
  canJoin,
  canRefund,
  canResolve,
  canRespond,
  canSettle,
  canSubmitProof,
  challengeEnd,
  contentEnd,
  currentEpoch,
  disputeEnd,
  phaseOf,
  proofEnd,
  refundAt,
  settleAt,
  timelineRows,
} from "../src";
import { params } from "./fixtures";

const p = params(); // start 1000, epoch_len 300, proof 90, dispute 90, arbiter 60, grace 300, 2 epochs

describe("timeline formulas", () => {
  it("matches epoch.rs", () => {
    expect(contentEnd(p, 0)).toBe(1300n);
    expect(proofEnd(p, 0)).toBe(1390n);
    expect(challengeEnd(p, 0)).toBe(1435n);
    expect(disputeEnd(p, 0)).toBe(1480n);
    expect(settleAt(p, 0)).toBe(1540n);
    expect(contentEnd(p, 1)).toBe(1600n);
    expect(settleAt(p, 1)).toBe(1840n);
    expect(refundAt(p)).toBe(2140n);
  });

  it("challenge_end uses integer halving of dispute_window", () => {
    const q = params({ dispute_window: 91n });
    expect(challengeEnd(q, 0)).toBe(1390n + 45n);
  });

  it("currentEpoch", () => {
    expect(currentEpoch(p, 0n)).toBe(0);
    expect(currentEpoch(p, 1000n)).toBe(0);
    expect(currentEpoch(p, 1299n)).toBe(0);
    expect(currentEpoch(p, 1300n)).toBe(1);
    expect(currentEpoch(p, 1599n)).toBe(1);
    expect(currentEpoch(p, 1600n)).toBe(2);
    expect(currentEpoch(p, 99999n)).toBe(2);
  });
});

describe("phaseOf half-open edges", () => {
  const cases: [bigint, string][] = [
    [999n, "upcoming"],
    [1000n, "content"],
    [1299n, "content"],
    [1300n, "proof"],
    [1389n, "proof"],
    [1390n, "challenge"],
    [1434n, "challenge"],
    [1435n, "response"],
    [1479n, "response"],
    [1480n, "arbiter"],
    [1539n, "arbiter"],
    [1540n, "settleable"],
  ];
  for (const [t, ph] of cases) it(`t=${t} → ${ph}`, () => expect(phaseOf(p, 0, t)).toBe(ph));

  it("epoch 1 is upcoming before its start", () => {
    expect(phaseOf(p, 1, 1299n)).toBe("upcoming");
    expect(phaseOf(p, 1, 1300n)).toBe("content");
  });
});

describe("action guards", () => {
  it("submit_proof is [content_end, proof_end)", () => {
    expect(canSubmitProof(p, 0, 1299n)).toBe(false);
    expect(canSubmitProof(p, 0, 1300n)).toBe(true);
    expect(canSubmitProof(p, 0, 1389n)).toBe(true);
    expect(canSubmitProof(p, 0, 1390n)).toBe(false);
  });
  it("challenge is [proof_end, challenge_end)", () => {
    expect(canChallenge(p, 0, 1389n)).toBe(false);
    expect(canChallenge(p, 0, 1390n)).toBe(true);
    expect(canChallenge(p, 0, 1434n)).toBe(true);
    expect(canChallenge(p, 0, 1435n)).toBe(false);
  });
  it("respond < dispute_end, resolve [dispute_end, settle_at), settle ≥ settle_at", () => {
    expect(canRespond(p, 0, 1479n)).toBe(true);
    expect(canRespond(p, 0, 1480n)).toBe(false);
    expect(canResolve(p, 0, 1479n)).toBe(false);
    expect(canResolve(p, 0, 1480n)).toBe(true);
    expect(canResolve(p, 0, 1540n)).toBe(false);
    expect(canSettle(p, 0, 1539n)).toBe(false);
    expect(canSettle(p, 0, 1540n)).toBe(true);
  });
  it("join, claims, holdback, refund", () => {
    expect(canJoin(p, 1599n)).toBe(true);
    expect(canJoin(p, 1600n)).toBe(false);
    expect(canClaim(p, 2139n)).toBe(true);
    expect(canClaim(p, 2140n)).toBe(false);
    expect(canRefund(p, 2139n)).toBe(false);
    expect(canRefund(p, 2140n)).toBe(true);
    // holdback of epoch 0 opens at proof_end(1) = 1690 (contract: now >= proof_end(e+1))
    expect(canClaimHoldback(p, 0, 1689n)).toBe(false);
    expect(canClaimHoldback(p, 0, 1690n)).toBe(true);
    expect(canClaimHoldback(p, 1, 2000n)).toBe(false); // last epoch has no holdback
  });
});

describe("timelineRows", () => {
  it("builds 6 rows per epoch + refund with active flags", () => {
    const rows = timelineRows(p, 1390n);
    expect(rows).toHaveLength(2 * 6 + 1);
    const active = rows.filter((r) => r.active).map((r) => r.key);
    expect(active).toEqual(["0:challenge", "1:content"]);
    expect(rows[0]!.label).toBe("Dönem 1 · İçerik dönemi");
    expect(rows.at(-1)).toMatchObject({ phase: "refund", start: 2140n, end: null });
  });
});
