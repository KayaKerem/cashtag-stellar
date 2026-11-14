import { describe, expect, it, vi } from "vitest";
import { Health } from "../src/health.js";

const clock = (t0 = 1_000_000) => {
  let t = t0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("Health", () => {
  it("ok when rpc reachable and keeper ticking", async () => {
    const c = clock();
    const h = new Health({
      version: "abc123",
      now: c.now,
      latestLedger: async () => 42,
      keeper: () => ({ intervalMs: 5000, lastTickAt: c.now(), lastTickOk: true, lastTickError: null }),
      aadhaarAvailable: () => true,
    });
    c.advance(3000);
    const s = await h.snapshot();
    expect(s).toMatchObject({ ok: true, version: "abc123", uptimeS: 3, rpc: { ok: true, latestLedger: 42 }, keeper: { enabled: true, stale: false }, aadhaar: { available: true } });
  });

  it("not ok when rpc fails", async () => {
    const s = await new Health({ version: "x", latestLedger: async () => { throw new Error("boom"); } }).snapshot();
    expect(s.ok).toBe(false);
    expect(s.rpc).toMatchObject({ ok: false, error: "boom" });
    expect(s.keeper).toEqual({ enabled: false });
  });

  it("caches the rpc probe", async () => {
    const c = clock();
    const probe = vi.fn(async () => 1);
    const h = new Health({ version: "x", now: c.now, latestLedger: probe, rpcCacheMs: 10_000 });
    await h.snapshot();
    c.advance(5_000);
    await h.snapshot();
    expect(probe).toHaveBeenCalledTimes(1);
    c.advance(5_000);
    await h.snapshot();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("flags a stale keeper (no tick within 10 intervals, min 2 min)", async () => {
    const c = clock();
    let last: number | null = null;
    const h = new Health({
      version: "x",
      now: c.now,
      latestLedger: async () => 1,
      keeper: () => ({ intervalMs: 5000, lastTickAt: last, lastTickOk: last ? true : null, lastTickError: null }),
    });
    c.advance(119_000);
    expect((await h.snapshot()).ok).toBe(true); // before first tick, within grace
    c.advance(2_000);
    const s = await h.snapshot();
    expect(s.ok).toBe(false);
    expect(s.keeper).toMatchObject({ enabled: true, stale: true });
    last = c.now();
    expect((await h.snapshot()).ok).toBe(true);
  });
});
