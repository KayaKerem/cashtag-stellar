import { describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { closePrecheck, Ops, PROOF_MARGIN, SIM_PROOF_MARGIN, SLACK, proofMargin, type PrecheckInput } from "../src/ops.js";
import { HttpError } from "../src/zkfetch.js";

// start=1000, epoch_len=240 -> content_end(0)=1240, proof_end(0)=1300, settle_at(0)=1391, content_end(1)=1480, proof_end(1)=1540
const params = { start: 1000n, epoch_len: 240n, epochs: 2, proof_window: 60n, dispute_window: 61n, arbiter_window: 30n, claim_grace: 240n };
const base = (over: Partial<PrecheckInput> = {}): PrecheckInput => ({
  campaign: { id: 1n, settled_epochs: 0, params },
  clip: { campaign_id: 1n, first_epoch: 0 },
  clipEpoch: null,
  disputes: [],
  campaignId: 1n,
  epoch: 0,
  now: 1240 + SLACK,
  haveProof: false,
  ...over,
});
const code = (f: () => void) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return (e as HttpError).code;
  }
};

describe("closePrecheck", () => {
  it("accepts a clip in the proof window", () => expect(code(() => closePrecheck(base()))).toBe("ok"));
  it("wrong campaign / epoch range", () => {
    expect(code(() => closePrecheck(base({ campaignId: 2n })))).toBe("contract_11");
    expect(code(() => closePrecheck(base({ epoch: 2 })))).toBe("contract_22");
    expect(code(() => closePrecheck(base({ clip: { campaign_id: 1n, first_epoch: 1 } })))).toBe("contract_22");
  });
  it("window: too early, margin, half-open end", () => {
    expect(code(() => closePrecheck(base({ now: 1239 })))).toBe("contract_21");
    expect(code(() => closePrecheck(base({ now: 1271 })))).toBe("contract_8"); // < 30 s left, no proof yet
    expect(code(() => closePrecheck(base({ now: 1280, haveProof: true })))).toBe("ok"); // kept proof may be resent
    expect(code(() => closePrecheck(base({ now: 1300, haveProof: true })))).toBe("contract_8");
    // simulated attestor: fresh proofs are instant, so the margin shrinks (short demo proof windows)
    expect(code(() => closePrecheck(base({ now: 1271, marginS: SIM_PROOF_MARGIN })))).toBe("ok");
    expect(code(() => closePrecheck(base({ now: 1290, marginS: SIM_PROOF_MARGIN })))).toBe("contract_8");
    expect(proofMargin({ attestorMode: "simulated" })).toBe(SIM_PROOF_MARGIN);
    expect(proofMargin({ attestorMode: "reclaim" })).toBe(PROOF_MARGIN);
  });
  it("clip epoch status", () => {
    expect(code(() => closePrecheck(base({ clipEpoch: { status: ["Excluded"], views: 0n } })))).toBe("contract_31");
    expect(code(() => closePrecheck(base({ clipEpoch: { status: ["Challenged"], views: 0n } })))).toBe("contract_27");
  });
  it("previous epoch must be settled or settleable", () => {
    const e1 = { epoch: 1, now: 1480 + SLACK }; // > settle_at(0)+SLACK
    expect(code(() => closePrecheck(base(e1)))).toBe("ok");
    expect(code(() => closePrecheck(base({ ...e1, disputes: [{ epoch: 0, status: ["Responded"] }] })))).toBe("contract_34");
    expect(code(() => closePrecheck(base({ ...e1, disputes: [{ epoch: 0, status: ["ChallengerWon"] }] })))).toBe("ok");
  });
});

function mkOps(invoke: (...a: any[]) => Promise<any>) {
  const reads: Record<string, any> = {
    get_campaign: { id: 1n, settled_epochs: 0, params },
    get_clip: { id: 5n, campaign_id: 1n, first_epoch: 0, platform: "demo", video_id: "vid1" },
    get_clip_epoch: undefined,
    list_disputes: [],
  };
  const chain = { read: vi.fn(async (_id: string, m: string) => reads[m]), invoke: vi.fn(invoke) };
  const proofs = {
    get: vi.fn(async () => ({ proof: { parameters: "", context: "", owner: "", timestampS: 1, epoch: 1, signature: "ab".repeat(64), recoveryId: 0 }, extracted: { views: "9", desc: "" }, cached: false })),
  };
  const ops = new Ops({ ...config, cliprailId: "C" }, proofs as any, chain as any, () => 1250);
  return { ops, chain, proofs };
}

describe("Ops.submitClose job registry", () => {
  it("dedupes concurrent calls and returns the done result afterwards", async () => {
    const { ops, chain, proofs } = mkOps(async () => ({ txHash: "h1" }));
    const [a, b] = await Promise.all([ops.submitClose(1n, 5n, 0), ops.submitClose(1n, 5n, 0)]);
    expect(a).toEqual({ txHash: "h1", views: "9" });
    expect(b).toBe(a);
    expect(await ops.submitClose(1n, 5n, 0)).toEqual(a);
    expect(chain.invoke).toHaveBeenCalledTimes(1);
    expect(proofs.get).toHaveBeenCalledTimes(1);
  });

  it("keeps the proof on transient errors, refetches on ProofExpired, stops on permanent", async () => {
    const errs = [new HttpError(502, "net", "tx_failed"), new HttpError(409, "exp", "contract_20"), new HttpError(409, "code", "contract_17")];
    const { ops, chain, proofs } = mkOps(async () => {
      throw errs.shift();
    });
    await expect(ops.submitClose(1n, 5n, 0)).rejects.toMatchObject({ code: "tx_failed" });
    expect(ops.jobState(5n, 0)?.proof).toBeTruthy();
    await expect(ops.submitClose(1n, 5n, 0)).rejects.toMatchObject({ code: "contract_20" });
    expect(proofs.get).toHaveBeenCalledTimes(1); // reused the kept proof
    expect(ops.jobState(5n, 0)?.proof).toBeUndefined();
    await expect(ops.submitClose(1n, 5n, 0)).rejects.toMatchObject({ code: "contract_17" });
    expect(proofs.get).toHaveBeenCalledTimes(2);
    await expect(ops.submitClose(1n, 5n, 0)).rejects.toMatchObject({ code: "contract_17" }); // sticky
    expect(chain.invoke).toHaveBeenCalledTimes(3);
  });
});
