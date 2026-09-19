import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scValToNative } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { HUMANITY_ERRORS } from "@cliprail/shared";
import { createChainApi } from "../src/chain";
import { createMockApi, MOCK_ACCOUNTS as A } from "../src/mock";
import { groth16ProofScVal, registerZkArgs, type AadhaarProveResponse } from "../src/humanity-zk";
import type { TxLike } from "../src/tx";

const FX = join(__dirname, "../../../fixtures/aadhaar/alice_clipper1_c1");
const meta = JSON.parse(readFileSync(join(FX, "meta.json"), "utf8"));
const sp = JSON.parse(readFileSync(join(FX, "proof_soroban.json"), "utf8"));
const RESP: AadhaarProveResponse = {
  proof: { a: sp.a, b: sp.b, c: sp.c },
  nullifier: meta.nullifier,
  timestamp: meta.timestamp,
  ageAbove18: meta.signals.ageAbove18,
  gender: meta.signals.gender,
  pinCode: meta.signals.pinCode,
  state: meta.signals.state,
  mode: "test",
};
const WALLET = meta.wallet as string;
const HUMANITY = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const CLIPRAIL = "CC4SMPQWP56TUVAUAWMK4BLOONQPBLJAWDVNPE6HMZGEMG67WW4XR7T3";

describe("register_zk args", () => {
  it("Groth16Proof is a map with sorted symbol keys and fixed-size bytes", () => {
    const v = groth16ProofScVal(RESP.proof) as any;
    expect(v.type).toBe("scvMap");
    const n = scValToNative(v);
    expect(Object.keys(n)).toEqual(["a", "b", "c"]);
    expect(JSON.stringify(v)).toMatch(/"symbol":"a".*"symbol":"b".*"symbol":"c"/);
    expect([n.a.length, n.b.length, n.c.length]).toEqual([64, 128, 64]);
    expect(Buffer.from(n.b).toString("hex")).toBe(RESP.proof.b);
    expect(() => groth16ProofScVal({ ...RESP.proof, b: RESP.proof.a })).toThrow(/128 bytes/);
  });

  it("builds the 9 arguments in contract order", () => {
    const args = registerZkArgs(1n, WALLET, RESP);
    expect(args.map((a) => (a as any).type)).toEqual([
      "scvU64",
      "scvAddress",
      "scvMap",
      "scvU256",
      "scvU64",
      "scvU256",
      "scvU256",
      "scvU256",
      "scvU256",
    ]);
    const n = args.map((a) => scValToNative(a));
    expect(n[0]).toBe(1n);
    expect(n[1]).toBe(WALLET);
    expect(n[3]).toBe(BigInt(meta.nullifier));
    expect(n[4]).toBe(BigInt(meta.timestamp));
    expect(n[5]).toBe(1n);
  });

  it("rejects malformed numbers", () => {
    expect(() => registerZkArgs(1n, WALLET, { ...RESP, nullifier: "-1" })).toThrow(/U256/);
    expect(() => registerZkArgs(1n, WALLET, { ...RESP, gender: (1n << 256n).toString() })).toThrow(/U256/);
  });
});

function setup(o: { sim?: unknown; simError?: string; fetchStatus?: number; fetchBody?: unknown } = {}) {
  const signer = { getAddress: vi.fn(async () => WALLET), signTransaction: vi.fn() };
  const fetch = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify(o.fetchBody ?? RESP), { status: o.fetchStatus ?? 200 }));
  const built: any[] = [];
  const tx: TxLike<unknown> = {
    result: o.sim ?? null,
    simulation: o.simError ? { error: o.simError } : {},
    signAndSend: vi.fn(async () => ({ result: null, sendTransactionResponse: { hash: "ab".repeat(32) } })),
  };
  const buildTx = vi.fn(async (opts: any) => (built.push(opts), tx));
  const api = createChainApi({
    rpcUrl: "http://127.0.0.1:1",
    networkPassphrase: "Test SDF Network ; September 2015",
    cliprailId: CLIPRAIL,
    humanityId: HUMANITY,
    verifierUrl: "http://verifier/",
    writeToken: "tok",
    signer,
    retryDelayMs: 0,
    fetch: fetch as unknown as typeof globalThis.fetch,
    buildTx,
  });
  return { api, fetch, built, tx, signer };
}

describe("chain registerHumanZk", () => {
  it("calls the prove endpoint then signs register_zk with the connected wallet", async () => {
    const { api, fetch, built, tx } = setup();
    const r = await api.registerHumanZk(1n, { identity: "alice" });
    expect(r).toEqual({ txHash: "ab".repeat(32), nullifier: meta.nullifier });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://verifier/humanity/aadhaar/prove");
    expect(JSON.parse(String(init.body))).toEqual({ campaignId: "1", wallet: WALLET, identity: "alice" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ method: "register_zk", contractId: HUMANITY, publicKey: WALLET });
    expect(built[0].args).toHaveLength(9);
    expect(built[0].errorTypes[5]).toEqual({ message: "InvalidProof" });
    expect(tx.signAndSend).toHaveBeenCalledOnce();
  });

  it("omits identity when not given", async () => {
    const { api, fetch } = setup();
    await api.registerHumanZk(1n);
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ campaignId: "1", wallet: WALLET });
  });

  it("maps contract errors to humanity codes without signing", async () => {
    const { api, tx } = setup({ simError: "HostError: Error(Contract, #2)" });
    await expect(api.registerHumanZk(1n)).rejects.toMatchObject({ code: 2, source: "humanity", errorName: "NullifierUsed" });
    expect(tx.signAndSend).not.toHaveBeenCalled();
    const s = setup({ simError: "HostError: Error(Contract, #6)" });
    await expect(s.api.registerHumanZk(1n)).rejects.toMatchObject({ code: 6, errorName: "StaleProof" });
  });

  it("surfaces verifier errors", async () => {
    const { api, built } = setup({ fetchStatus: 503, fetchBody: { error: "no artifacts", code: "aadhaar_unavailable" } });
    await expect(api.registerHumanZk(1n)).rejects.toMatchObject({ code: "aadhaar_unavailable", source: "verifier" });
    expect(built).toHaveLength(0);
  });
});

describe("humanity error table", () => {
  it("has the register_zk codes", () => {
    expect(Object.fromEntries(Object.entries(HUMANITY_ERRORS).map(([k, v]) => [k, v.name]))).toMatchObject({
      4: "NotConfigured",
      5: "InvalidProof",
      6: "StaleProof",
      7: "InputNotInField",
      8: "NotAnAccount",
    });
  });
});

describe("mock registerHumanZk", () => {
  it("simulates proving, registers, and rejects a reused identity", async () => {
    let who: string = A.clipper3;
    const api = createMockApi({ latencyMs: 0, zkLatencyMs: 5, now: 1_000_000n, speed: 0, address: () => who });
    const t0 = Date.now();
    const r = await api.registerHumanZk(2n, { identity: "zed" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4);
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.nullifier).toMatch(/^\d+$/);
    expect(await api.isHuman(2n, A.clipper3)).toBe(true);
    await expect(api.registerHumanZk(2n, { identity: "other" })).rejects.toMatchObject({ code: 3 });
    who = "GBNEWCLIPPERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    await expect(api.registerHumanZk(2n, { identity: "zed" })).rejects.toMatchObject({ code: 2, errorName: "NullifierUsed" });
    const ok = await api.registerHumanZk(2n);
    expect(ok.nullifier).not.toBe(r.nullifier);
  });
});
