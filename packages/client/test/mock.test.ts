import { describe, expect, it } from "vitest";
import { refundAt } from "@cliprail/shared";
import { createApi, createMockApi, MOCK_ACCOUNTS as A, type MockApi } from "../src";

function setup() {
  let who: string = A.clipper1;
  const api = createMockApi({ latencyMs: 0, now: 1_000_000n, speed: 0, address: () => who });
  return { api, as: (a: string) => (who = a) };
}

describe("mock api", () => {
  it("is seeded with 2 campaigns, 3 participants, clips and one open dispute", async () => {
    const { api } = setup();
    const cs = await api.listCampaigns();
    expect(cs.map((c) => c.id)).toEqual([1n, 2n]);
    expect(cs[0].participants).toBe(3);
    expect((await api.getClips(1n)).length).toBe(4);
    const ds = await api.listDisputes(1n);
    expect(ds).toHaveLength(1);
    expect(ds[0].status).toBe("Open");
    expect((await api.getEpoch(1n, 0)).open_disputes).toBe(1);
    expect((await api.getEpoch(2n, 0)).settled).toBe(true);
    expect(await api.getParticipant(1n, A.clipper2)).toMatchObject({ code: expect.stringMatching(/^CR-[A-Z0-9]{6}$/) });
    expect(await api.getParticipant(1n, A.brand)).toBeNull();
  });

  it("human → join → registerClip; errors are typed", async () => {
    const { api, as } = setup();
    const me = "GBNEWCLIPPERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    as(me);
    await expect(api.join(1n)).rejects.toMatchObject({ code: 7, errorName: "NotHuman" });
    await expect(api.registerClip(1n, "demo", "x")).rejects.toMatchObject({ code: 5 });
    const h = await api.registerHuman(1n);
    expect(h.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await api.isHuman(1n, me)).toBe(true);
    const j = await api.join(1n);
    expect(j.code).toMatch(/^CR-/);
    await expect(api.join(1n)).rejects.toMatchObject({ code: 6 });
    const r = await api.registerClip(1n, "demo", "demo-yeni-99");
    expect(r.clipId).toBe(7n);
    await expect(api.registerClip(1n, "demo", "demo-yeni-99")).rejects.toMatchObject({ code: 10 });
    await expect(api.registerClip(2n, "youtube", "abc")).rejects.toMatchObject({ code: 5 });
    const clips = await api.getClips(1n);
    expect(clips.at(-1)!.clip).toMatchObject({ owner: me, first_epoch: 1 });
  });

  it("dispute → respond → resolve → settle → claim", async () => {
    const { api, as } = setup();
    as(A.clipper1);
    await expect(api.respond(1n)).rejects.toMatchObject({ code: 30 });
    as(A.clipper3);
    await api.respond(1n);
    expect((await api.listDisputes(1n))[0].status).toBe("Responded");
    as(A.arbiter);
    await expect(api.resolve(1n, true)).rejects.toMatchObject({ code: 8 }); // still in response window
    api.advance(110); // arbiter window
    await expect(api.settleEpoch(1n, 0)).rejects.toMatchObject({ code: 21 });
    await api.resolve(1n, true);
    expect((await api.listDisputes(1n))[0].status).toBe("ClipperWon");
    api.advance(60);
    await api.settleEpoch(1n, 0);
    const st = await api.getEpoch(1n, 0);
    expect(st.settled && st.rate > 0n && st.spent > 0n && st.spent <= st.budget).toBe(true);
    as(A.clipper1);
    const c = await api.claim(1n, 1n, 0);
    expect(c.amount).toBeGreaterThan(0n);
    await expect(api.claim(1n, 1n, 0)).rejects.toMatchObject({ code: 25 });
    await expect(api.claim(1n, 3n, 0)).rejects.toMatchObject({ code: 30 });
    expect((await api.getCampaign(1n)).balance).toBe(3000n * 10_000_000n - c.amount);
  });

  it("unanswered dispute is finalized for the challenger", async () => {
    const { api } = setup();
    await expect(api.finalizeDispute(1n)).rejects.toMatchObject({ code: 8 });
    api.advance(100);
    await api.finalizeDispute(1n);
    expect((await api.listDisputes(1n))[0].status).toBe("ChallengerWon");
    expect((await api.getClips(1n))[2].epochs[0]!.status).toBe("Excluded");
  });

  it("close proof → holdback → refund on campaign 2", async () => {
    const { api, as } = setup();
    as(A.clipper2);
    expect((await api.claim(2n, 6n, 0)).amount).toBeGreaterThan(0n);
    as(A.clipper1);
    await expect(api.submitClose(2n, 5n, 1)).rejects.toMatchObject({ code: 8 });
    api.advance(250); // epoch 1 proof window
    await api.submitClose(2n, 5n, 1);
    expect((await api.getClips(2n))[0].epochs[0]!.alive).toBe(true);
    await expect(api.claimHoldback(2n, 5n, 0)).rejects.toMatchObject({ code: 8 });
    api.advance(100);
    const st = await api.getEpoch(2n, 0);
    const hb = await api.claimHoldback(2n, 5n, 0);
    expect(hb.amount).toBe(st.held_total); // clip 6 did not survive, clip 5 takes the whole pool
    const c = await api.getCampaign(2n);
    await expect(api.refund(2n)).rejects.toMatchObject({ code: 32 });
    api.advance(refundAt(c.params) - api.now());
    const r = await api.refund(2n);
    expect(r.amount).toBe(c.balance);
    await expect(api.refund(2n)).rejects.toMatchObject({ code: 33 });
  });

  it("createCampaign defaults token and ids increase; latency applies", async () => {
    const api = createApi("mock", { latencyMs: 30, address: A.brand }) as MockApi;
    const cs = await api.listCampaigns();
    const p = cs[0].params;
    const t = Date.now();
    const r = await api.createCampaign({ ...p, token: undefined, platforms: ["demo"], start: api.now() + 60n });
    expect(Date.now() - t).toBeGreaterThanOrEqual(25);
    expect(r.id).toBe(3n);
    const c = await api.getCampaign(3n);
    expect(c).toMatchObject({ brand: A.brand, balance: p.budget });
    expect(c.params.token).toMatch(/^C/);
    // returned objects are copies
    c.balance = 0n;
    expect((await api.getCampaign(3n)).balance).toBe(p.budget);
  });
});
