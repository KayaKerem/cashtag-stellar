// Offline equivalents of the TRY ramp helpers (instant, no network, no wallet prompts) for UI work.
// Same signatures and result shapes as anchorDepositTRY / anchorWithdrawToTRY / anchorPriceTRY.
import { explorerTxUrl, sep6StatusLabel, CIRCLE_USDC_TESTNET_ASSET, TRY_SEP38_ASSET, type AnchorRampStep } from "@cliprail/shared";
import { anchorError, checkAmount, type AnchorTransaction, type Sep38Quote } from "./anchor";
import type { TryDepositParams, TryDepositResult, TryPrice, TryPriceParams, TryWithdrawParams, TryWithdrawResult } from "./anchor-ramp";

export interface MockTryRampOptions {
  /** TRY per USDC when buying USDC (deposit). */
  buyRate?: number;
  /** TRY per USDC when selling USDC (withdraw). */
  sellRate?: number;
  /** Artificial delay per step (ms, default 0). */
  stepDelayMs?: number;
  /** Starting USDC balances by account; withdraw fails with `anchor_underfunded` above the balance. Omit to skip the check. */
  balances?: Record<string, number>;
}

export interface TryRamp {
  depositTRY(p: Omit<TryDepositParams, "signer"> & Partial<Pick<TryDepositParams, "signer">>): Promise<TryDepositResult>;
  withdrawToTRY(p: Omit<TryWithdrawParams, "signer"> & Partial<Pick<TryWithdrawParams, "signer">>): Promise<TryWithdrawResult>;
  priceTRY(p: TryPriceParams): Promise<TryPrice>;
  /** Mock only: current simulated USDC balance (null when balances are not tracked). */
  balanceOf?(account: string): number | null;
}

const USDC_ID = `stellar:${CIRCLE_USDC_TESTNET_ASSET}`;
const MID = 48.784036;
const rnd = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
const hex64 = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function mockQuote(sellAsset: string, buyAsset: string, sellAmount: string, buyAmount: string, feeTotal: string, feeAsset: string, tryPerUsdc: number): Sep38Quote {
  return {
    id: `qt_${rnd(20)}`,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    sellAsset,
    buyAsset,
    sellAmount,
    buyAmount,
    totalPrice: (Number(sellAmount) / Number(buyAmount)).toFixed(7),
    price: sellAsset === TRY_SEP38_ASSET ? MID.toFixed(6) : (1 / MID).toFixed(10),
    fee: { total: feeTotal, asset: feeAsset },
    tryPerUsdc,
    raw: {},
  };
}

function mockTx(raw: Record<string, unknown>): AnchorTransaction {
  const status = String(raw.status);
  const kind = String(raw.kind);
  return {
    id: String(raw.id),
    kind,
    status,
    statusLabel: sep6StatusLabel(status, kind),
    final: status === "completed",
    needsUserPayment: false,
    amountIn: raw.amount_in as string,
    amountOut: raw.amount_out as string,
    amountFee: raw.amount_fee as string,
    amountInAsset: raw.amount_in_asset as string,
    amountOutAsset: raw.amount_out_asset as string,
    stellarTransactionId: raw.stellar_transaction_id as string | undefined,
    externalTransactionId: raw.external_transaction_id as string | undefined,
    to: raw.to as string | undefined,
    raw,
  };
}

/** In-memory TRY ⇄ USDC ramp with the mock anchor's rates (50 bps spread around 48.78 TRY/USD). */
export function createMockTryRamp(opts: MockTryRampOptions = {}): TryRamp {
  const buy = opts.buyRate ?? 49.027956;
  const sell = opts.sellRate ?? 48.540115;
  const balances = opts.balances ? new Map(Object.entries(opts.balances)) : null;
  const step = async (cb: ((s: AnchorRampStep) => void) | undefined, s: AnchorRampStep) => {
    cb?.(s);
    await sleep(opts.stepDelayMs ?? 0);
  };

  return {
    async depositTRY(p) {
      const amountTRY = checkAmount(p.amountTRY, 2);
      for (const s of ["discover", "trustline", "auth", "kyc", "quote", "deposit", "bank_transfer", "waiting"] as const) await step(p.onStep, s);
      const usdc = (Number(amountTRY) / buy).toFixed(7);
      const fee = ((Number(amountTRY) * (buy - MID)) / buy).toFixed(2);
      const hash = hex64();
      const id = `sep_${rnd(20)}`;
      const reference = `TRMA-${rnd(4).toUpperCase()}-${rnd(4).toUpperCase()}`;
      const quote = mockQuote(TRY_SEP38_ASSET, USDC_ID, Number(amountTRY).toFixed(2), usdc, fee, TRY_SEP38_ASSET, buy);
      const tx = mockTx({
        id,
        kind: "deposit",
        status: "completed",
        amount_in: Number(amountTRY).toFixed(2),
        amount_in_asset: TRY_SEP38_ASSET,
        amount_out: usdc,
        amount_out_asset: USDC_ID,
        amount_fee: fee,
        stellar_transaction_id: hash,
        external_transaction_id: reference,
        to: p.account,
      });
      p.onUpdate?.(tx);
      if (balances) balances.set(p.account, (balances.get(p.account) ?? 0) + Number(usdc));
      await step(p.onStep, "done");
      return {
        id,
        status: "completed",
        statusLabel: tx.statusLabel,
        amountTRY: tx.amountIn!,
        usdcReceived: usdc,
        feeTRY: fee,
        tryPerUsdc: buy,
        quote,
        bankName: "TR Mock Bank A.Ş.",
        iban: "TR050009900000000000000001",
        reference,
        moreInfoUrl: undefined,
        stellarTransactionId: hash,
        txLink: explorerTxUrl(hash),
        trustlineTxHash: null,
        tx,
      };
    },

    async withdrawToTRY(p) {
      const amountUSDC = checkAmount(p.amountUSDC, 7);
      if (balances && (balances.get(p.account) ?? 0) < Number(amountUSDC))
        throw anchorError("anchor_underfunded", `${balances.get(p.account) ?? 0} USDC`);
      for (const s of ["discover", "auth", "kyc", "quote", "withdraw", "payment", "waiting"] as const) await step(p.onStep, s);
      const tryOut = (Number(amountUSDC) * sell).toFixed(2);
      const fee = (Number(amountUSDC) * (MID - sell)).toFixed(2);
      const hash = hex64();
      const id = `sep_${rnd(20)}`;
      const iban = p.iban ?? "TR130009908571421317856964";
      const quote = mockQuote(USDC_ID, TRY_SEP38_ASSET, Number(amountUSDC).toFixed(7), tryOut, (Number(amountUSDC) * 0.005).toFixed(7), USDC_ID, sell);
      const tx = mockTx({
        id,
        kind: "withdrawal",
        status: "completed",
        amount_in: Number(amountUSDC).toFixed(7),
        amount_in_asset: USDC_ID,
        amount_out: tryOut,
        amount_out_asset: TRY_SEP38_ASSET,
        amount_fee: fee,
        stellar_transaction_id: hash,
        external_transaction_id: `FAST${rnd(10).toUpperCase()}`,
        to: iban,
      });
      p.onUpdate?.(tx);
      if (balances) balances.set(p.account, (balances.get(p.account) ?? 0) - Number(amountUSDC));
      await step(p.onStep, "done");
      return {
        id,
        status: "completed",
        statusLabel: tx.statusLabel,
        amountUSDC: tx.amountIn!,
        tryPaidOut: tryOut,
        feeTRY: fee,
        tryPerUsdc: sell,
        quote,
        iban,
        payoutReference: tx.externalTransactionId,
        paymentTxHash: hash,
        txLink: explorerTxUrl(hash),
        tx,
      };
    },

    async priceTRY(p) {
      const amount = checkAmount(p.amount);
      const dep = p.direction === "deposit";
      const out = dep ? (Number(amount) / buy).toFixed(7) : (Number(amount) * sell).toFixed(2);
      const q = dep
        ? mockQuote(TRY_SEP38_ASSET, USDC_ID, amount, out, ((Number(amount) * (buy - MID)) / buy).toFixed(2), TRY_SEP38_ASSET, buy)
        : mockQuote(USDC_ID, TRY_SEP38_ASSET, amount, out, (Number(amount) * 0.005).toFixed(7), USDC_ID, sell);
      return { direction: p.direction, sellAmount: amount, buyAmount: out, tryPerUsdc: dep ? buy : sell, feeTotal: q.fee?.total, feeAsset: q.fee?.asset, raw: q };
    },

    balanceOf: (account) => (balances ? (balances.get(account) ?? 0) : null),
  };
}
