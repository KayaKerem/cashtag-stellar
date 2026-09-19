import { describe, expect, it, vi } from "vitest";
import { Asset, Keypair, Networks, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";

vi.mock("../src/anchor", async (orig) => {
  const actual = await orig<typeof import("../src/anchor")>();
  return {
    ...actual,
    assetBalance: vi.fn(async () => "10.0000000"),
    ensureTrustline: vi.fn(async () => ({ created: false, txHash: null })),
    completeWithdrawPayment: vi.fn(async () => "a".repeat(64)),
  };
});

import {
  completeWithdrawPayment,
  discoverAnchor,
  ensureKyc,
  pollTransaction,
  sep38AssetId,
  sep38Price,
  sep38Quote,
  sep6Deposit,
  sep6Withdraw,
  simulateDepositArrival,
  withdrawResponseToTx,
  type AnchorInfo,
} from "../src/anchor";
import { anchorDepositTRY, anchorPriceTRY, anchorWithdrawToTRY, createTryRamp } from "../src/anchor-ramp";
import { createMockTryRamp } from "../src/anchor-mock";

const HOME = "tr.example";
const B = `https://${HOME}`;
const ANCHOR_KP = Keypair.random();
const ISSUER = Keypair.random().publicKey();
const USDC = `stellar:USDC:${ISSUER}`;
const TREASURY = Keypair.random().publicKey();
const user = Keypair.random();

const TOML = `
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SIGNING_KEY="${ANCHOR_KP.publicKey()}"
WEB_AUTH_ENDPOINT="${B}/auth"
TRANSFER_SERVER="${B}/sep6"
KYC_SERVER="${B}/sep12"
ANCHOR_QUOTE_SERVER="${B}/sep38"

[[CURRENCIES]]
code="USDC"
issuer="${ISSUER}"
anchor_asset="TRY"
`;

const SEP6_INFO = {
  deposit: { USDC: { enabled: true, authentication_required: true, fee_percent: 0.5, funding_methods: ["bank_account"] } },
  "deposit-exchange": { USDC: { enabled: true } },
  withdraw: { USDC: { enabled: true } },
  "withdraw-exchange": { USDC: { enabled: true } },
  features: { claimable_balances: true },
};

const INSTRUCTIONS = {
  bank_name: { value: "TR Mock Bank A.Ş.", description: "Bank" },
  bank_account_number: { value: "TR050009900000000000000001", description: "IBAN" },
  external_transfer_memo: { value: "TRMA-AAAA-BBBB", description: "Reference" },
};

type Call = { url: string; init?: RequestInit };

/** Stateful fake of the mock anchor (enough of SEP-1/6/10/12/38 for the flows). */
function fakeAnchor() {
  const calls: Call[] = [];
  let kyc = "NEEDS_INFO";
  const txs = new Map<string, Record<string, unknown>>();
  let polls = 0;
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const u = new URL(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const authed = (init?.headers as Record<string, string> | undefined)?.authorization === "Bearer jwt-1";
    if (url === `${B}/.well-known/stellar.toml`) return new Response(TOML);
    if (u.pathname === "/sep6/info") return json(SEP6_INFO);
    if (u.pathname === "/auth" && init?.method !== "POST") {
      const tx = WebAuth.buildChallengeTx(ANCHOR_KP, u.searchParams.get("account")!, HOME, 300, Networks.TESTNET, HOME);
      return json({ transaction: tx, network_passphrase: Networks.TESTNET });
    }
    if (u.pathname === "/auth") return json({ token: "jwt-1" });
    if (u.pathname.startsWith("/sep6/tx/") && u.pathname.endsWith("/simulate-bank-transfer")) {
      const id = u.pathname.split("/")[3];
      const t = txs.get(id);
      if (!t) return json({ error: "not found" }, 404);
      Object.assign(t, { status: "pending_anchor", amount_out: "101.9826321", amount_fee: "24.88" });
      return json({ ok: true, transaction: t });
    }
    if (!authed) return json({ type: "authentication_required", error: "missing or invalid SEP-10 token" }, 403);
    if (u.pathname === "/sep12/customer" && init?.method === "PUT") {
      kyc = "ACCEPTED";
      return json({ id: "cus_1" });
    }
    if (u.pathname === "/sep12/customer") return json({ id: kyc === "ACCEPTED" ? "cus_1" : undefined, status: kyc, fields: {} });
    if (u.pathname === "/sep38/quote") {
      const b = JSON.parse(String(init?.body));
      const dep = b.sell_asset === "iso4217:TRY";
      return json(
        dep
          ? { id: "qt_d", expires_at: "2030-01-01T00:00:00Z", total_price: "49.0279560", price: "48.784036", sell_asset: b.sell_asset, buy_asset: b.buy_asset, sell_amount: "5000.00", buy_amount: "101.9826321", fee: { total: "24.88", asset: "iso4217:TRY" } }
          : { id: "qt_w", expires_at: "2030-01-01T00:00:00Z", total_price: "0.0206015657", price: "0.0204985090", sell_asset: b.sell_asset, buy_asset: b.buy_asset, sell_amount: "5.0000000", buy_amount: "242.70", fee: { total: "0.0250119", asset: USDC } },
      );
    }
    if (u.pathname === "/sep6/deposit-exchange" || u.pathname === "/sep6/deposit") {
      if (u.searchParams.get("asset_code") !== "USDC") return json({ error: "unsupported asset_code 'X'" }, 400);
      const id = "sep_dep";
      txs.set(id, { id, kind: "deposit", status: "pending_user_transfer_start", amount_in: u.searchParams.get("amount"), amount_in_asset: "iso4217:TRY", amount_out_asset: USDC, instructions: INSTRUCTIONS, more_info_url: `${B}/sep6/tx/${id}` });
      return json({ id, how: "Send TRY", instructions: INSTRUCTIONS, eta: 5, fee_percent: 0.5, extra_info: { message: `Sandbox: simulate the transfer at ${B}/sep6/tx/${id}. Then ...` } });
    }
    if (u.pathname === "/sep6/withdraw-exchange" || u.pathname === "/sep6/withdraw") {
      const id = "sep_wd";
      txs.set(id, { id, kind: "withdrawal", status: "pending_user_transfer_start", amount_in: u.searchParams.get("amount"), withdraw_anchor_account: TREASURY, withdraw_memo: "860873126114", withdraw_memo_type: "id" });
      return json({ id, account_id: TREASURY, memo_type: "id", memo: "860873126114", eta: 10, extra_info: { message: "Send USDC", payment_uri: "web+stellar:pay?x" } });
    }
    if (u.pathname === "/sep6/transaction") {
      const t = txs.get(u.searchParams.get("id")!);
      if (!t) return json({ error: "transaction not found" }, 404);
      polls++;
      if (t.kind === "deposit" && t.status === "pending_anchor" && polls > 1) Object.assign(t, { status: "completed", stellar_transaction_id: "b".repeat(64) });
      if (t.kind === "withdrawal" && paid && polls > 1) Object.assign(t, { status: "completed", amount_out: "242.70", amount_fee: "1.22", to: "TR130009908571421317856964", external_transaction_id: "FAST123" });
      return json({ transaction: t });
    }
    return json({ error: "no route" }, 404);
  }) as unknown as typeof fetch;
  let paid = false;
  return { f, calls, txs, markPaid: () => (paid = true) };
}

const signer = {
  signTransaction: vi.fn(async (xdr: string, o: { networkPassphrase: string }) => {
    const tx = TransactionBuilder.fromXDR(xdr, o.networkPassphrase);
    tx.sign(user);
    return { signedTxXdr: tx.toXDR() };
  }),
};

const discover = (f: typeof fetch) => discoverAnchor(HOME, { fetch: f });

describe("SEP-6 discovery", () => {
  it("reads TRANSFER_SERVER / KYC_SERVER / ANCHOR_QUOTE_SERVER and /info without SEP-24", async () => {
    const { f } = fakeAnchor();
    const a = await discover(f);
    expect(a).toMatchObject({ transferServer: `${B}/sep6`, kycServer: `${B}/sep12`, quoteServer: `${B}/sep38`, sep24: null });
    expect(a.transferServerSep24).toBeUndefined();
    expect(a.sep6?.deposit.USDC).toMatchObject({ enabled: true, feePercent: 0.5, fundingMethods: ["bank_account"] });
    expect(a.sep6?.withdrawExchange.USDC.enabled).toBe(true);
    expect(a.sep6?.claimableBalances).toBe(true);
    await expect(pollTransaction({ anchor: a, jwt: "jwt-1", id: "x", protocol: "sep24", fetch: f })).rejects.toMatchObject({ code: "anchor_sep24_unsupported" });
  });
});

describe("SEP-6 / 12 / 38 primitives", () => {
  let anchor: AnchorInfo;
  const setup = async () => {
    const fa = fakeAnchor();
    anchor = await discover(fa.f);
    return fa;
  };

  it("deposit-exchange sends SEP-38 identifiers and returns bank instructions", async () => {
    const { f, calls } = await setup();
    const d = await sep6Deposit({ anchor, jwt: "jwt-1", account: user.publicKey(), amount: "5000", quoteId: "qt_d", fetch: f });
    const q = new URL(calls.at(-1)!.url).searchParams;
    expect(new URL(calls.at(-1)!.url).pathname).toBe("/sep6/deposit-exchange");
    expect(Object.fromEntries(q)).toMatchObject({ asset_code: "USDC", destination_asset: "USDC", source_asset: "iso4217:TRY", quote_id: "qt_d", amount: "5000", type: "bank_account", funding_method: "bank_account" });
    expect(d).toMatchObject({ id: "sep_dep", iban: "TR050009900000000000000001", reference: "TRMA-AAAA-BBBB", bankName: "TR Mock Bank A.Ş.", moreInfoUrl: `${B}/sep6/tx/sep_dep`, eta: 5 });
  });

  it("maps anchor errors and amount validation", async () => {
    const { f } = await setup();
    await expect(sep6Deposit({ anchor, jwt: "jwt-1", account: "G", assetCode: "EUR", fetch: f })).rejects.toMatchObject({ code: "anchor_request_failed", source: "anchor" });
    await expect(sep6Deposit({ anchor, jwt: "bad", account: "G", fetch: f })).rejects.toMatchObject({ code: "anchor_unauthorized" });
    await expect(sep6Deposit({ anchor, jwt: "jwt-1", account: "G", amount: "-5", fetch: f })).rejects.toMatchObject({ code: "anchor_amount_invalid" });
    await expect(sep6Deposit({ anchor, jwt: "jwt-1", account: "G", exchange: true, fetch: f })).rejects.toMatchObject({ code: "anchor_amount_invalid" });
  });

  it("withdraw returns account + memo and becomes a payable tx", async () => {
    const { f, calls } = await setup();
    const w = await sep6Withdraw({ anchor, jwt: "jwt-1", amount: "5", quoteId: "qt_w", fetch: f });
    expect(new URL(calls.at(-1)!.url).searchParams.get("source_asset")).toBe("USDC");
    expect(new URL(calls.at(-1)!.url).searchParams.get("destination_asset")).toBe("iso4217:TRY");
    expect(w).toMatchObject({ id: "sep_wd", accountId: TREASURY, memo: "860873126114", memoType: "id", paymentUri: "web+stellar:pay?x" });
    const tx = withdrawResponseToTx(w, "5");
    expect(tx).toMatchObject({ needsUserPayment: true, withdrawAnchorAccount: TREASURY, withdrawMemoType: "id", statusLabel: "USDC ödemen bekleniyor" });
  });

  it("simulates the bank transfer and polls the SEP-6 transaction", async () => {
    const { f, calls } = await setup();
    await sep6Deposit({ anchor, jwt: "jwt-1", account: user.publicKey(), amount: "5000", fetch: f });
    const t = await simulateDepositArrival({ anchor, id: "sep_dep", amount: "5000", fetch: f });
    expect(calls.at(-1)!.url).toBe(`${B}/sep6/tx/sep_dep/simulate-bank-transfer`);
    expect(JSON.parse(String(calls.at(-1)!.init?.body))).toEqual({ amount: "5000" });
    expect(t).toMatchObject({ status: "pending_anchor", statusLabel: "TL alındı, USDC gönderiliyor", amountOut: "101.9826321" });
    const p = await pollTransaction({ anchor, jwt: "jwt-1", id: "sep_dep", fetch: f });
    expect(p).toMatchObject({ amountInAsset: "iso4217:TRY", amountOutAsset: USDC });
    expect(p.instructions?.external_transfer_memo.value).toBe("TRMA-AAAA-BBBB");
    await expect(simulateDepositArrival({ anchor, id: "nope", amount: "1", fetch: f })).rejects.toMatchObject({ code: "anchor_simulate_failed" });
  });

  it("KYC: PUTs once when not accepted", async () => {
    const { f, calls } = await setup();
    const c = await ensureKyc({ anchor, jwt: "jwt-1", fetch: f });
    expect(c.status).toBe("ACCEPTED");
    expect(calls.filter((c) => c.init?.method === "PUT")).toHaveLength(1);
    await ensureKyc({ anchor, jwt: "jwt-1", fetch: f });
    expect(calls.filter((c) => c.init?.method === "PUT")).toHaveLength(1);
  });

  it("SEP-38 quote gives TRY per USDC both ways", async () => {
    const { f } = await setup();
    const asset = new Asset("USDC", ISSUER);
    expect(sep38AssetId(asset)).toBe(USDC);
    const d = await sep38Quote({ anchor, jwt: "jwt-1", sellAsset: "iso4217:TRY", buyAsset: USDC, sellAmount: "5000", fetch: f });
    expect(d.id).toBe("qt_d");
    expect(d.tryPerUsdc).toBeCloseTo(49.028, 3);
    const w = await sep38Quote({ anchor, jwt: "jwt-1", sellAsset: USDC, buyAsset: "iso4217:TRY", sellAmount: "5", fetch: f });
    expect(w.tryPerUsdc).toBeCloseTo(48.54, 2);
    await expect(sep38Price({ anchor, sellAsset: USDC, buyAsset: "iso4217:TRY", fetch: f })).rejects.toMatchObject({ code: "anchor_amount_invalid" });
  });
});

describe("high-level TRY ramp", () => {
  it("anchorDepositTRY: auth → KYC → quote → deposit-exchange → simulate → completed", async () => {
    const { f } = fakeAnchor();
    const steps: string[] = [];
    const r = await anchorDepositTRY({ signer, account: user.publicKey(), amountTRY: "5000", homeDomain: HOME, fetch: f, intervalMs: 1, onStep: (s) => steps.push(s) });
    expect(steps).toEqual(["discover", "trustline", "auth", "kyc", "quote", "deposit", "bank_transfer", "waiting", "done"]);
    expect(r).toMatchObject({ status: "completed", usdcReceived: "101.9826321", amountTRY: "5000", reference: "TRMA-AAAA-BBBB", txLink: `https://stellar.expert/explorer/testnet/tx/${"b".repeat(64)}` });
    expect(r.tryPerUsdc).toBeCloseTo(49.028, 3);
  });

  it("anchorWithdrawToTRY: quote → withdraw-exchange → pay with memo → completed", async () => {
    const fa = fakeAnchor();
    vi.mocked(completeWithdrawPayment).mockImplementationOnce(async (o) => {
      expect(o.tx).toMatchObject({ withdrawAnchorAccount: TREASURY, withdrawMemo: "860873126114", withdrawMemoType: "id" });
      expect(o.amount).toBe("5");
      fa.markPaid();
      return "c".repeat(64);
    });
    const r = await anchorWithdrawToTRY({ signer, account: user.publicKey(), amountUSDC: "5", homeDomain: HOME, fetch: fa.f, intervalMs: 1 });
    expect(r).toMatchObject({ status: "completed", tryPaidOut: "242.70", iban: "TR130009908571421317856964", payoutReference: "FAST123", paymentTxHash: "c".repeat(64) });
    await expect(anchorWithdrawToTRY({ signer, account: user.publicKey(), amountUSDC: "50", homeDomain: HOME, fetch: fa.f })).rejects.toMatchObject({ code: "anchor_underfunded" });
  });

  it("anchorPriceTRY uses the public /price", async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("stellar.toml")) return new Response(TOML);
      return new Response(JSON.stringify({ total_price: "49.0279560", price: "48.78", sell_amount: "1000.00", buy_amount: "20.3965264", fee: { total: "4.98", asset: "iso4217:TRY" } }));
    }) as unknown as typeof fetch;
    const p = await anchorPriceTRY({ direction: "deposit", amount: "1000", homeDomain: HOME, fetch: f });
    expect(p).toMatchObject({ sellAmount: "1000.00", buyAmount: "20.3965264", feeTotal: "4.98" });
    expect(p.tryPerUsdc).toBeCloseTo(49.03, 2);
  });
});

describe("mock TRY ramp", () => {
  it("deposits and withdraws instantly with balance tracking", async () => {
    const ramp = createMockTryRamp({ balances: {} });
    const d = await ramp.depositTRY({ account: "GA", amountTRY: "4902.79" });
    expect(Number(d.usdcReceived)).toBeCloseTo(100, 0);
    expect(d.txLink).toMatch(/stellar\.expert/);
    const w = await ramp.withdrawToTRY({ account: "GA", amountUSDC: "5" });
    expect(w).toMatchObject({ status: "completed", tryPaidOut: "242.70" });
    expect(ramp.balanceOf!("GA")).toBeCloseTo(95, 0);
    await expect(ramp.withdrawToTRY({ account: "GA", amountUSDC: "1000" })).rejects.toMatchObject({ code: "anchor_underfunded" });
    expect((await ramp.priceTRY({ direction: "withdraw", amount: "1" })).buyAmount).toBe("48.54");
    await expect(createTryRamp("chain").depositTRY({ account: "GA", amountTRY: "1" })).rejects.toMatchObject({ code: "anchor_auth_failed" });
  });
});
