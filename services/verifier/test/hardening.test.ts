import { describe, expect, it } from "vitest";
import { config, unsafeConfig } from "../src/config.js";
import { TokenBucket } from "../src/limit.js";
import { DEFAULT_SIM_ATTESTOR_SECRET, DEFAULT_SIM_OWNER_SECRET } from "../src/simulated.js";

describe("unsafeConfig", () => {
  const base = { ...config, writeToken: "x".repeat(32), attestorMode: "reclaim" as const };
  it("accepts a safe config", () => expect(unsafeConfig(base)).toEqual([]));
  it("flags a missing or short WRITE_TOKEN", () => {
    expect(unsafeConfig({ ...base, writeToken: "" })).toHaveLength(1);
    expect(unsafeConfig({ ...base, writeToken: "short" })).toHaveLength(1);
  });
  it("flags simulated mode with the public default keys", () => {
    const sim = { ...base, attestorMode: "simulated" as const };
    expect(unsafeConfig({ ...sim, simAttestorSecret: DEFAULT_SIM_ATTESTOR_SECRET, simOwnerSecret: "0x" + "1".repeat(64) })).toHaveLength(1);
    expect(unsafeConfig({ ...sim, simAttestorSecret: "0x" + "2".repeat(64), simOwnerSecret: DEFAULT_SIM_OWNER_SECRET })).toHaveLength(1);
    expect(unsafeConfig({ ...sim, simAttestorSecret: "0x" + "2".repeat(64), simOwnerSecret: "0x" + "1".repeat(64) })).toEqual([]);
  });
});

describe("TokenBucket", () => {
  it("evicts least recently used keys instead of resetting everyone", () => {
    const b = new TokenBucket(1, 60_000, 3);
    expect(b.take("victim", 0)).toBe(true);
    expect(b.take("victim", 1)).toBe(false);
    for (const k of ["a", "b"]) b.take(k, 2);
    expect(b.take("victim", 3)).toBe(false); // still limited: under the cap, nothing evicted
    for (const k of ["c", "d", "e"]) b.take(k, 4); // pushes out a and b first, then victim
    expect(b.take("victim", 5)).toBe(true); // evicted only once it was the oldest
  });
});
