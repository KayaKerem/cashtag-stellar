import { scValToNative } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { CLIPRAIL_ERRORS, SOROSWAP_TESTNET, XLM_SAC_TESTNET, withSlippage, type CampaignParamsInput } from "@cliprail/shared";
import { createChainApi } from "../src/chain";
import { createMockApi, MOCK_ACCOUNTS as A } from "../src/mock";
import { campaignParamsScVal, quoteSwap, swapFundArgs, type SwapQuoter } from "../src/swap";
import { toRawParams } from "../src/chain";
import type { TxLike } from "../src/tx";

const USDC = "CCRCO347GR4FVCZACMTXZWE4EKTICARZXRRTS4R4HZZYK7R7E65UX45E";
const CLIPRAIL = "CBI6VFC5E2KFBRSDVCLMQVDOC7Q3AIO3EIMXTHSS2YXEUSY52EF2TQVZ";
const HUMANITY = "CBXO7SKDQ22E7J7QAASIFLSJ7JAPX45YM3QA5KARY5OJHMFP3KTKP5MN";
const U = 10_000_000n;

const input = (budget = 5n * U): CampaignParamsInput => ({
  budget,
  rate_max_per_1k: U,
  cap_views_clip: 50_000n,
  cap_views_human: 100_000n,
  min_views: 100n,
  start: 2_000_000_000n,
  epoch_len: 300n,
  epochs: 2,
  proof_window: 90n,
  dispute_window: 90n,
  arbiter_window: 60n,
  claim_grace: 300n,
  holdback_bps: 2000,
  bond: U,
  arbiter: A.arbiter,
  platforms: ["demo"],
  require_humanity: true,
  title: "Swap funded",
  brief_url: "https://example.com/b",
});

describe("slippage + args", () => {
  it("withSlippage rounds up and validates bps", () => {
    expect(withSlippage(10_000n, 100)).toBe(10_100n);
    expect(withSlippage(1n, 100)).toBe(2n);
    expect(withSlippage(253_926_337n, 0)).toBe(253_926_337n);
    expect(() => withSlippage(1n, -1)).toThrow();
    expect(() => withSlippage(1n, 10_001)).toThrow();
  });

  it("CampaignParams encodes as a map with sorted keys and contract types", () => {
    const v = campaignParamsScVal(toRawParams(input(), USDC)) as any;
    expect(v.type).toBe("scvMap");
    const n = scValToNative(v);
    const keys = Object.keys(n);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toHaveLength(20);
    expect(n.budget).toBe(5n * U);
    expect(typeof n.epochs).toBe("number"); // u32
    expect(n.start).toBe(2_000_000_000n); // u64
    expect(n.token).toBe(USDC);
    expect(n.platforms).toEqual(["demo"]);
  });

  it("create_campaign_with_swap args are in contract order", () => {
    const args = swapFundArgs(A.brand, toRawParams(input(), USDC), XLM_SAC_TESTNET, 26n * U, [XLM_SAC_TESTNET, USDC], 123n);
    expect(args.map((a: any) => a.type)).toEqual(["scvAddress", "scvMap", "scvAddress", "scvI128", "scvVec", "scvU64"]);
    const n = args.map((a) => scValToNative(a));
    expect(n[0]).toBe(A.brand);
    expect(n[2]).toBe(XLM_SAC_TESTNET);
    expect(n[3]).toBe(26n * U);
    expect(n[4]).toEqual([XLM_SAC_TESTNET, USDC]);
    expect(n[5]).toBe(123n);
  });
});

describe("quoteSwap", () => {
  it("quotes the direct pair and adds slippage", async () => {
    const quoter: SwapQuoter = { amountsIn: vi.fn(async () => [253_926_337n, 5n * U]) };
    const q = await quoteSwap(quoter, "CROUTER", 5n * U, XLM_SAC_TESTNET, USDC);
    expect(quoter.amountsIn).toHaveBeenCalledWith("CROUTER", 5n * U, [XLM_SAC_TESTNET, USDC]);
    expect(q).toMatchObject({ amountIn: 253_926_337n, amountInMax: withSlippage(253_926_337n, 100), path: [XLM_SAC_TESTNET, USDC], amountOut: 5n * U });
  });

  it("maps router errors (no pool, liquidity) and bad inputs", async () => {
    const fail = (msg: string): SwapQuoter => ({ amountsIn: async () => Promise.reject(new Error(msg)) });
    await expect(quoteSwap(fail("HostError: Error(Contract, #509)"), "R", U, XLM_SAC_TESTNET, USDC)).rejects.toMatchObject({
      code: 509,
      source: "swap",
      errorName: "PairDoesNotExist",
    });
    await expect(quoteSwap(fail("boom"), "R", U, XLM_SAC_TESTNET, USDC)).rejects.toMatchObject({ code: "swap_quote_failed" });
    const ok: SwapQuoter = { amountsIn: async () => [1n, 1n] };
    await expect(quoteSwap(ok, "R", U, USDC, USDC)).rejects.toMatchObject({ code: 37, errorName: "BadPath" });
    await expect(quoteSwap(ok, "R", 0n, XLM_SAC_TESTNET, USDC)).rejects.toMatchObject({ code: 3 });
  });
});

function setup(o: { simError?: string; balance?: bigint } = {}) {
  const signer = { getAddress: vi.fn(async () => A.brand), signTransaction: vi.fn() };
  const built: any[] = [];
  const tx: TxLike<unknown> = {
    result: 7n,
    simulation: o.simError ? { error: o.simError } : {},
    signAndSend: vi.fn(async () => ({ result: 7n, sendTransactionResponse: { hash: "cd".repeat(32) } })),
  };
  const buildTx = vi.fn(async (opts: any) => (built.push(opts), tx));
  const swapQuoter: SwapQuoter = { amountsIn: vi.fn(async (_r: string, out: bigint) => [out * 5n, out]) };
  const tokenReader = { balance: vi.fn(async () => o.balance ?? 1_000_000n * U) };
  const api = createChainApi({
    rpcUrl: "http://127.0.0.1:1",
    networkPassphrase: "Test SDF Network ; September 2015",
    cliprailId: CLIPRAIL,
    humanityId: HUMANITY,
    verifierUrl: "http://verifier/",
    usdcSac: USDC,
    signer,
    retryDelayMs: 0,
    buildTx,
    swapQuoter,
    tokenReader,
    nowSecs: () => 1_800_000_000,
  });
  return { api, built, tx, swapQuoter, tokenReader };
}

describe("chain createCampaignWithSwap", () => {
  it("quotes, adds 1% slippage, and signs create_campaign_with_swap as the brand", async () => {
    const { api, built, tx, swapQuoter, tokenReader } = setup();
    const r = await api.createCampaignWithSwap(input(), { tokenIn: XLM_SAC_TESTNET });
    expect(r).toMatchObject({ id: 7n, txHash: "cd".repeat(32), amountInMax: 25n * U + 25n * U / 100n });
    expect(swapQuoter.amountsIn).toHaveBeenCalledWith(SOROSWAP_TESTNET.router, 5n * U, [XLM_SAC_TESTNET, USDC]);
    expect(tokenReader.balance).toHaveBeenCalledWith(XLM_SAC_TESTNET, A.brand);
    expect(built[0]).toMatchObject({ method: "create_campaign_with_swap", contractId: CLIPRAIL, publicKey: A.brand });
    const n = built[0].args.map((a: any) => scValToNative(a));
    expect(n[0]).toBe(A.brand);
    expect(n[1].token).toBe(USDC);
    expect(n[2]).toBe(XLM_SAC_TESTNET);
    expect(n[3]).toBe(r.amountInMax);
    expect(n[4]).toEqual([XLM_SAC_TESTNET, USDC]);
    expect(n[5]).toBe(1_800_000_600n);
    expect(built[0].errorTypes[38]).toEqual({ message: "SwapFailed" });
    expect(tx.signAndSend).toHaveBeenCalledOnce();
  });

  it("honours explicit amountInMax / slippageBps", async () => {
    const a = setup();
    const r = await a.api.createCampaignWithSwap(input(), { tokenIn: XLM_SAC_TESTNET, amountInMax: 30n * U });
    expect(r.amountInMax).toBe(30n * U);
    const b = setup();
    const r2 = await b.api.createCampaignWithSwap(input(), { tokenIn: XLM_SAC_TESTNET, slippageBps: 500 });
    expect(r2.amountInMax).toBe(25n * U + (25n * U * 5n) / 100n);
  });

  it("blocks on a short tokenIn balance and maps SwapFailed without signing", async () => {
    const low = setup({ balance: U });
    await expect(low.api.createCampaignWithSwap(input(), { tokenIn: XLM_SAC_TESTNET })).rejects.toMatchObject({ code: "insufficient_balance" });
    expect(low.built).toHaveLength(0);
    const f = setup({ simError: "HostError: Error(Contract, #38)" });
    await expect(f.api.createCampaignWithSwap(input(), { tokenIn: XLM_SAC_TESTNET })).rejects.toMatchObject({
      code: 38,
      errorName: "SwapFailed",
      message: CLIPRAIL_ERRORS[38].message,
    });
    expect(f.tx.signAndSend).not.toHaveBeenCalled();
  });

  it("quoteSwapFunding defaults to the USDC campaign token", async () => {
    const { api } = setup();
    const q = await api.quoteSwapFunding(5n * U, XLM_SAC_TESTNET);
    expect(q).toMatchObject({ tokenOut: USDC, amountIn: 25n * U, router: SOROSWAP_TESTNET.router });
  });
});

describe("mock swap funding", () => {
  it("quotes and creates a funded campaign; rejects a too-low max", async () => {
    const api = createMockApi({ latencyMs: 0, now: 1_000_000n, speed: 0, address: A.brand });
    const q = await api.quoteSwapFunding(5n * U, XLM_SAC_TESTNET);
    expect(q.amountIn).toBeGreaterThan(25n * U);
    expect(q.amountInMax).toBe(withSlippage(q.amountIn, 100));
    const r = await api.createCampaignWithSwap(input(), { tokenIn: XLM_SAC_TESTNET });
    const c = await api.getCampaign(r.id);
    expect(c).toMatchObject({ brand: A.brand, balance: 5n * U });
    await expect(api.createCampaignWithSwap(input(), { tokenIn: XLM_SAC_TESTNET, amountInMax: 1n })).rejects.toMatchObject({ code: 38 });
    await expect(api.quoteSwapFunding(5n * U, USDC)).rejects.toMatchObject({ code: 37 });
  });
});
