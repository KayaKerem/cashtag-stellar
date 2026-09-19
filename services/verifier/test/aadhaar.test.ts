import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { config, REPO_ROOT } from "../src/config.js";
import {
  AadhaarProver,
  AADHAAR_SIGNAL_NAMES,
  TEST_PUBKEY_HASH,
  circuitInput,
  defaultIdentity,
  identityPhoto,
  loadTestData,
  nullifierSeed,
  resultFromSignals,
  signalHash,
  snarkjs,
  toSorobanProof,
  walletSignal,
  type FullProve,
} from "../src/aadhaar.js";
import { createApp, parseAadhaarProveReq } from "../src/app.js";
import { DemoStore } from "../src/demo.js";

const FX = join(REPO_ROOT, "fixtures/aadhaar");
const FIXTURES = ["alice_clipper1_c1", "bob_clipper2_c1", "alice_clipper2_c1_sybil"];
const load = (name: string) => ({
  meta: JSON.parse(readFileSync(join(FX, name, "meta.json"), "utf8")),
  soroban: JSON.parse(readFileSync(join(FX, name, "proof_soroban.json"), "utf8")),
  snark: JSON.parse(readFileSync(join(FX, name, "proof_snarkjs.json"), "utf8")),
});
const W1 = load("alice_clipper1_c1").meta.wallet as string;

describe("aadhaar convention (matches fixtures)", () => {
  it.each(FIXTURES)("%s: seed, signal, signalHash", (name) => {
    const { meta } = load(name);
    expect(nullifierSeed(BigInt(meta.campaign_id)).toString()).toBe(meta.nullifier_seed);
    expect(meta.signals.nullifierSeed).toBe(meta.nullifier_seed);
    expect(walletSignal(meta.wallet)).toBe(meta.signal);
    expect(signalHash(meta.wallet).toString()).toBe(meta.signal_hash);
    expect(meta.signals.signalHash).toBe(meta.signal_hash);
    expect(meta.signals.pubkeyHash).toBe(TEST_PUBKEY_HASH);
  });

  it("seed is keccak(utf8('cliprail:<id>'))>>3 and fits the field", () => {
    const s = nullifierSeed(1n);
    expect(s < 1n << 253n).toBe(true);
    expect(nullifierSeed(2n)).not.toBe(s);
  });

  it("rejects non-account wallets", () => {
    expect(() => signalHash("CCLIPRAIL")).toThrow(/G\.\.\. account/);
  });

  it.each(FIXTURES)("%s: snarkjs → Soroban bytes", (name) => {
    const { soroban, snark } = load(name);
    const s = toSorobanProof(snark.proof);
    expect(s).toEqual({ a: soroban.a, b: soroban.b, c: soroban.c });
    expect(s.a).toHaveLength(128);
    expect(s.b).toHaveLength(256);
    expect(s.c).toHaveLength(128);
    expect(soroban.public_signals).toEqual(snark.publicSignals);
  });

  it("nullifier depends on identity only (sybil fixture shares alice's nullifier)", () => {
    const a = load("alice_clipper1_c1").meta, b = load("bob_clipper2_c1").meta, s = load("alice_clipper2_c1_sybil").meta;
    expect(s.nullifier).toBe(a.nullifier);
    expect(b.nullifier).not.toBe(a.nullifier);
    expect(s.wallet).not.toBe(a.wallet);
  });

  it("resultFromSignals maps the 9 public signals in contract order", () => {
    const { snark, meta } = load("alice_clipper1_c1");
    const r = resultFromSignals(snark.proof, snark.publicSignals, "alice");
    expect(AADHAAR_SIGNAL_NAMES).toHaveLength(9);
    expect(r).toMatchObject({
      nullifier: meta.nullifier,
      timestamp: meta.timestamp,
      ageAbove18: "1",
      gender: "0",
      pinCode: "0",
      state: "0",
      mode: "test",
    });
  });

  it("identity photos are deterministic and distinct", () => {
    expect(identityPhoto("alice", 100)).toEqual(identityPhoto("alice", 100));
    expect(identityPhoto("alice", 100)).not.toEqual(identityPhoto("bob", 100));
    expect(identityPhoto("x", 33)).toHaveLength(33);
  });

  it("circuit input carries the convention's seed and signal hash", async () => {
    const input = await circuitInput(loadTestData(FX), 1n, W1, "alice");
    expect(input.nullifierSeed).toBe(nullifierSeed(1n).toString());
    expect(input.signalHash).toBe(signalHash(W1).toString());
    expect(input.revealAgeAbove18).toBe("1");
  });
});

// ---- prover service with a fake snarkjs ----
function fakeProve(delayMs = 20) {
  const { snark } = load("alice_clipper1_c1");
  let active = 0;
  const stats = { calls: 0, maxActive: 0 };
  const fn: FullProve = async (input) => {
    stats.calls++;
    active++;
    stats.maxActive = Math.max(stats.maxActive, active);
    await new Promise((r) => setTimeout(r, delayMs));
    active--;
    const pub = [...snark.publicSignals];
    pub[7] = String(input.nullifierSeed);
    pub[8] = String(input.signalHash);
    return { proof: snark.proof, publicSignals: pub };
  };
  return { fn, stats };
}

describe("AadhaarProver", () => {
  it("503 without artifacts", async () => {
    const p = new AadhaarProver({ artifactsDir: "", testDataDir: FX });
    expect(p.available).toBe(false);
    await expect(p.prove({ campaignId: 1n, wallet: W1, identity: "alice" })).rejects.toMatchObject({ status: 503 });
  });

  it("runs one job at a time, dedupes and caches per (campaign, wallet, identity)", async () => {
    const { fn, stats } = fakeProve();
    const p = new AadhaarProver({ artifactsDir: "", testDataDir: FX, fullProve: fn });
    const [a, b, c] = await Promise.all([
      p.prove({ campaignId: 1n, wallet: W1, identity: "alice" }),
      p.prove({ campaignId: 1n, wallet: W1, identity: "alice" }),
      p.prove({ campaignId: 2n, wallet: W1, identity: "alice" }),
    ]);
    expect(stats.calls).toBe(2);
    expect(stats.maxActive).toBe(1);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(c.publicSignals[7]).toBe(nullifierSeed(2n).toString());
    expect(a.proof).toEqual(toSorobanProof(load("alice_clipper1_c1").snark.proof));
    await p.prove({ campaignId: 1n, wallet: W1, identity: "alice" });
    expect(stats.calls).toBe(2);
  });

  it("expires the cache after 10 min", async () => {
    const { fn, stats } = fakeProve(1);
    let now = 0;
    const p = new AadhaarProver({ artifactsDir: "", testDataDir: FX, fullProve: fn, now: () => now });
    await p.prove({ campaignId: 1n, wallet: W1, identity: "bob" });
    now = 10 * 60_000 + 1;
    const r = await p.prove({ campaignId: 1n, wallet: W1, identity: "bob" });
    expect(r.cached).toBe(false);
    expect(stats.calls).toBe(2);
  });

  it("times out with 504 and does not cache failures", async () => {
    const { fn } = fakeProve(200);
    const p = new AadhaarProver({ artifactsDir: "", testDataDir: FX, fullProve: fn, timeoutMs: 20 });
    await expect(p.prove({ campaignId: 1n, wallet: W1, identity: "alice" })).rejects.toMatchObject({ status: 504 });
    const bad = new AadhaarProver({ artifactsDir: "", testDataDir: FX, fullProve: vi.fn(async () => Promise.reject(new Error("boom"))) });
    await expect(bad.prove({ campaignId: 1n, wallet: W1, identity: "alice" })).rejects.toThrow("boom");
    await expect(bad.prove({ campaignId: 1n, wallet: W1, identity: "alice" })).rejects.toThrow("boom");
  });

  it("validates wallet and identity", async () => {
    const p = new AadhaarProver({ artifactsDir: "", testDataDir: FX, fullProve: fakeProve().fn });
    await expect(p.prove({ campaignId: 1n, wallet: "GBAD", identity: "alice" })).rejects.toMatchObject({ status: 400 });
    await expect(p.prove({ campaignId: 1n, wallet: W1, identity: "a b" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("POST /humanity/aadhaar/prove", () => {
  const cfg = { ...config, writeToken: "tok", demoMode: false };
  const mkApp = (aadhaar?: any) =>
    createApp({
      cfg,
      demo: new DemoStore(join(tmpdir(), `aadhaar-demo-${process.pid}.json`)),
      proofs: { get: vi.fn() } as any,
      ops: { submitClose: vi.fn(), demoRegister: vi.fn() } as any,
      aadhaar,
    });
  const post = (app: any, body: unknown, auth = "Bearer tok") =>
    app.request("/humanity/aadhaar/prove", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
    });

  it("parses body with a per-wallet default identity", () => {
    expect(parseAadhaarProveReq({ campaignId: "1", wallet: W1 })).toEqual({ campaignId: 1n, wallet: W1, identity: defaultIdentity(W1) });
    expect(parseAadhaarProveReq({ campaignId: 1, wallet: W1, identity: "bob" }).identity).toBe("bob");
    expect(() => parseAadhaarProveReq({ campaignId: -1, wallet: W1 })).toThrow();
  });

  it("requires the bearer token", async () => {
    const r = await post(mkApp({ available: true, prove: vi.fn() }), { campaignId: 1, wallet: W1 }, "");
    expect(r.status).toBe(401);
  });

  it("503 when artifacts are missing", async () => {
    const r = await post(mkApp(new AadhaarProver({ artifactsDir: "", testDataDir: FX })), { campaignId: 1, wallet: W1 });
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("aadhaar_unavailable");
    expect((await post(mkApp(), { campaignId: 1, wallet: W1 })).status).toBe(503);
  });

  it("returns the proof", async () => {
    const p = new AadhaarProver({ artifactsDir: "", testDataDir: FX, fullProve: fakeProve(1).fn });
    const r = await post(mkApp(p), { campaignId: 1, wallet: W1, identity: "alice" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ mode: "test", identity: "alice", ageAbove18: "1", cached: false });
    expect(j.proof.b).toHaveLength(256);
  });

  it("400 on a contract wallet", async () => {
    const p = new AadhaarProver({ artifactsDir: "", testDataDir: FX, fullProve: fakeProve(1).fn });
    const r = await post(mkApp(p), { campaignId: 1, wallet: "CB24BRMGW4ZTLJVC2ETKU5URUD7PXQ6BOYEKV4JUIO7O62GZWM6ZZZUM" });
    expect(r.status).toBe(400);
  });
});

describe("fixtures verify against vkey", () => {
  const vk = JSON.parse(readFileSync(join(FX, "vkey.json"), "utf8"));
  it.each(FIXTURES)("%s", async (name) => {
    const { snark } = load(name);
    expect(await snarkjs().groth16.verify(vk, snark.publicSignals, snark.proof)).toBe(true);
  });
});

// Real proving (~30 s, ~3.7 GB RAM): AADHAAR_ARTIFACTS_DIR=<dir> AADHAAR_REAL=1 pnpm --filter verifier test aadhaar
describe.skipIf(!(process.env.AADHAAR_REAL === "1" && config.aadhaarArtifactsDir))("real proof", () => {
  it("proves and verifies", { timeout: 180_000 }, async () => {
    const p = new AadhaarProver({ artifactsDir: config.aadhaarArtifactsDir, testDataDir: FX });
    const r = await p.prove({ campaignId: 1n, wallet: W1, identity: "alice" });
    expect(r.nullifier).toBe(load("alice_clipper1_c1").meta.nullifier);
    expect(r.publicSignals[0]).toBe(TEST_PUBKEY_HASH);
  });
});
