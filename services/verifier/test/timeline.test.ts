import { describe, expect, it } from "vitest";
import { challengeEnd, contentEnd, currentEpoch, disputeEnd, epochPhase, proofEnd, refundAt, settleAt } from "../src/timeline.js";

const p = { start: 1000n, epoch_len: 240n, epochs: 2, proof_window: 60n, dispute_window: 61n, arbiter_window: 30n, claim_grace: 100n };

describe("timeline", () => {
  it("matches the INTERFACES formulas", () => {
    expect(contentEnd(p, 0)).toBe(1240);
    expect(contentEnd(p, 1)).toBe(1480);
    expect(proofEnd(p, 0)).toBe(1300);
    expect(challengeEnd(p, 0)).toBe(1330); // floor(61/2)
    expect(disputeEnd(p, 0)).toBe(1361);
    expect(settleAt(p, 0)).toBe(1391);
    expect(refundAt(p)).toBe(settleAt(p, 1) + 100);
  });
  it("currentEpoch clamps", () => {
    expect(currentEpoch(p, 0)).toBe(0);
    expect(currentEpoch(p, 1239)).toBe(0);
    expect(currentEpoch(p, 1240)).toBe(1);
    expect(currentEpoch(p, 99999)).toBe(2);
  });
  it("epochPhase", () => {
    expect(epochPhase(p, 0, 1100)).toBe("content");
    expect(epochPhase(p, 0, 1240)).toBe("proof");
    expect(epochPhase(p, 0, 1300)).toBe("proof");
    expect(epochPhase(p, 0, 1301)).toBe("challenge");
    expect(epochPhase(p, 0, 1330)).toBe("response");
    expect(epochPhase(p, 0, 1361)).toBe("arbiter");
    expect(epochPhase(p, 0, 1391)).toBe("settleable");
  });
});
