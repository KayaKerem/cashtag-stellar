// High-level TRY ⇄ USDC ramp over a SEP-6 anchor (default: the hackathon TR mock anchor).
// One call per direction for the UI: auth (SEP-10) → KYC (SEP-12) → quote (SEP-38) →
// deposit-exchange / withdraw-exchange (SEP-6) → bank leg / USDC payment → wait for completion.
import { Asset } from "@stellar/stellar-sdk";
import { TR_ANCHOR_HOME_DOMAIN, TRY_SEP38_ASSET, explorerTxUrl, type AnchorRampStep } from "@cliprail/shared";
import {
  anchorAsset,
  anchorError,
  assetBalance,
  checkAmount,
  completeWithdrawPayment,
  discoverAnchor,
  ensureKyc,
  ensureTrustline,
  sep10Auth,
  sep38AssetId,
  sep38Price,
  sep38Quote,
  sep6DepositExchange,
  sep6WithdrawExchange,
  simulateDepositArrival,
  waitForTransaction,
  type AnchorInfo,
  type AnchorTransaction,
  type Sep38Price,
  type Sep38Quote,
} from "./anchor";
import type { Signer } from "./chain";
import { createMockTryRamp, type MockTryRampOptions, type TryRamp } from "./anchor-mock";

/** `NEXT_PUBLIC_ANCHOR_HOME_DOMAIN` (inlined by Next at build time), else the TR mock anchor. */
export function defaultTryAnchorHomeDomain(): string {
  try {
    return process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN || TR_ANCHOR_HOME_DOMAIN;
  } catch {
    return TR_ANCHOR_HOME_DOMAIN;
  }
}

/** `NEXT_PUBLIC_ANCHOR_ASSET_CODE` or "USDC". */
export function defaultTryAnchorAssetCode(): string {
  try {
    return process.env.NEXT_PUBLIC_ANCHOR_ASSET_CODE || "USDC";
  } catch {
    return "USDC";
  }
}

type Fetch = typeof fetch;

export interface TryRampCommon {
  /** Wallet signer (Freighter / Wallets Kit / keypair): signs the SEP-10 challenge and classic txs. */
  signer: Pick<Signer, "signTransaction">;
  account: string;
  homeDomain?: string;
  assetCode?: string;
  /** Asset issuer override (default: from the anchor's stellar.toml). */
  assetIssuer?: string;
  /** Already discovered anchor / JWT (skips those steps). */
  anchor?: AnchorInfo;
  jwt?: string;
  /** SEP-9 fields for SEP-12 (e.g. `{ bank_account_number: "TR..." }`); the mock needs none. */
  kycFields?: Record<string, string>;
  onStep?: (step: AnchorRampStep) => void;
  onUpdate?: (tx: AnchorTransaction) => void;
  timeoutMs?: number;
  intervalMs?: number;
  horizonUrl?: string;
  networkPassphrase?: string;
  fetch?: Fetch;
}

export interface TryDepositParams extends TryRampCommon {
  /** TRY to deposit, e.g. "5000". */
  amountTRY: string;
  /** Add the USDC trustline first when missing (default true). */
  ensureTrust?: boolean;
  /** Sandbox: trigger the incoming bank transfer (default true). Set false on a real anchor. */
  simulate?: boolean;
}

export interface TryDepositResult {
  id: string;
  status: string;
  statusLabel: string;
  amountTRY: string;
  /** USDC credited on Stellar. */
  usdcReceived: string;
  feeTRY?: string;
  /** TRY per 1 USDC (quote, fee included). */
  tryPerUsdc?: number;
  quote: Sep38Quote;
  bankName?: string;
  iban?: string;
  reference?: string;
  moreInfoUrl?: string;
  stellarTransactionId?: string;
  txLink?: string;
  claimableBalanceId?: string;
  trustlineTxHash?: string | null;
  tx: AnchorTransaction;
}

export interface TryWithdrawParams extends TryRampCommon {
  /** USDC to off-ramp, e.g. "5". */
  amountUSDC: string;
  /** Destination IBAN (optional on the mock: SEP-12 IBAN or a sandbox IBAN). */
  iban?: string;
}

export interface TryWithdrawResult {
  id: string;
  status: string;
  statusLabel: string;
  amountUSDC: string;
  /** TRY paid to the bank account (simulated on the mock). */
  tryPaidOut: string;
  feeTRY?: string;
  tryPerUsdc?: number;
  quote: Sep38Quote;
  /** IBAN the TRY went to. */
  iban?: string;
  /** Bank payout reference. */
  payoutReference?: string;
  paymentTxHash: string;
  txLink: string;
  tx: AnchorTransaction;
}

async function prepare(p: TryRampCommon) {
  const f = p.fetch ?? globalThis.fetch;
  p.onStep?.("discover");
  const anchor = p.anchor ?? (await discoverAnchor(p.homeDomain ?? defaultTryAnchorHomeDomain(), { fetch: f, networkPassphrase: p.networkPassphrase, skipInfo: true }));
  const asset = anchorAsset(anchor, p.assetCode ?? defaultTryAnchorAssetCode(), p.assetIssuer);
  return { f, anchor, asset };
}

async function authAndKyc(p: TryRampCommon, anchor: AnchorInfo, f: Fetch): Promise<string> {
  p.onStep?.("auth");
  const jwt = p.jwt ?? (await sep10Auth({ anchor, account: p.account, signer: p.signer, fetch: f }));
  p.onStep?.("kyc");
  await ensureKyc({ anchor, jwt, fields: p.kycFields, fetch: f });
  return jwt;
}

/**
 * TRY → USDC: trustline → SEP-10 → KYC → SEP-38 quote → SEP-6 deposit-exchange → (sandbox) simulate the
 * bank transfer → wait until the anchor paid USDC. Wallet prompts: trustline (only if missing) + SEP-10.
 */
export async function anchorDepositTRY(p: TryDepositParams): Promise<TryDepositResult> {
  const amountTRY = checkAmount(p.amountTRY, 2);
  const { f, anchor, asset } = await prepare(p);
  const classic = { horizonUrl: p.horizonUrl, networkPassphrase: p.networkPassphrase };

  let trustlineTxHash: string | null = null;
  if (p.ensureTrust !== false) {
    p.onStep?.("trustline");
    trustlineTxHash = (await ensureTrustline(asset, p.account, p.signer, classic)).txHash;
  }
  const jwt = await authAndKyc(p, anchor, f);

  p.onStep?.("quote");
  const quote = await sep38Quote({
    anchor,
    jwt,
    sellAsset: TRY_SEP38_ASSET,
    buyAsset: sep38AssetId(asset),
    sellAmount: amountTRY,
    sellDeliveryMethod: "bank_account",
    fetch: f,
  });

  p.onStep?.("deposit");
  const dep = await sep6DepositExchange({ anchor, jwt, assetCode: asset.getCode(), account: p.account, amount: amountTRY, quoteId: quote.id, fetch: f });

  if (p.simulate !== false) {
    p.onStep?.("bank_transfer");
    await simulateDepositArrival({ anchor, id: dep.id, amount: amountTRY, moreInfoUrl: dep.moreInfoUrl, fetch: f });
  }

  p.onStep?.("waiting");
  const tx = await waitForTransaction({
    anchor,
    jwt,
    id: dep.id,
    protocol: "sep6",
    until: ["completed", "pending_trust"],
    timeoutMs: p.timeoutMs ?? 3 * 60_000,
    intervalMs: p.intervalMs ?? 2000,
    onUpdate: p.onUpdate,
    fetch: f,
  });
  if (tx.status === "pending_trust") throw anchorError("anchor_pending_trust", tx.message);
  if (tx.status !== "completed") throw anchorError("anchor_tx_failed", `${tx.status}${tx.message ? `: ${tx.message}` : ""}`);
  p.onStep?.("done");
  return {
    id: dep.id,
    status: tx.status,
    statusLabel: tx.statusLabel,
    amountTRY: tx.amountIn ?? amountTRY,
    usdcReceived: tx.amountOut ?? quote.buyAmount,
    feeTRY: tx.amountFee,
    tryPerUsdc: quote.tryPerUsdc,
    quote,
    bankName: dep.bankName,
    iban: dep.iban,
    reference: dep.reference,
    moreInfoUrl: dep.moreInfoUrl ?? tx.moreInfoUrl,
    stellarTransactionId: tx.stellarTransactionId,
    txLink: tx.stellarTransactionId ? explorerTxUrl(tx.stellarTransactionId) : undefined,
    claimableBalanceId: tx.claimableBalanceId,
    trustlineTxHash,
    tx,
  };
}

/**
 * USDC → TRY: SEP-10 → KYC → SEP-38 quote → SEP-6 withdraw-exchange → pay USDC to the anchor with the
 * memo → wait until the anchor paid TRY out. Wallet prompts: SEP-10 + the USDC payment.
 */
export async function anchorWithdrawToTRY(p: TryWithdrawParams): Promise<TryWithdrawResult> {
  const amountUSDC = checkAmount(p.amountUSDC, 7);
  const { f, anchor, asset } = await prepare(p);
  const classic = { horizonUrl: p.horizonUrl, networkPassphrase: p.networkPassphrase };

  const bal = await assetBalance(asset, p.account, classic);
  if (bal === null) throw anchorError("anchor_trustline_failed", `no ${asset.getCode()} trustline`);
  if (Number(bal) < Number(amountUSDC)) throw anchorError("anchor_underfunded", `${bal} ${asset.getCode()}`);

  const jwt = await authAndKyc({ ...p, kycFields: p.kycFields ?? (p.iban ? { bank_account_number: p.iban } : undefined) }, anchor, f);

  p.onStep?.("quote");
  const quote = await sep38Quote({
    anchor,
    jwt,
    sellAsset: sep38AssetId(asset),
    buyAsset: TRY_SEP38_ASSET,
    sellAmount: amountUSDC,
    buyDeliveryMethod: "bank_account",
    fetch: f,
  });

  p.onStep?.("withdraw");
  const w = await sep6WithdrawExchange({
    anchor,
    jwt,
    assetCode: asset.getCode(),
    account: p.account,
    amount: amountUSDC,
    quoteId: quote.id,
    dest: p.iban,
    fetch: f,
  });

  const pending = await waitForTransaction({ anchor, jwt, id: w.id, protocol: "sep6", until: ["pending_user_transfer_start"], timeoutMs: 60_000, intervalMs: 1500, fetch: f });
  if (pending.status !== "pending_user_transfer_start") throw anchorError("anchor_tx_failed", pending.status);
  // The withdraw response is authoritative for account + memo; the tx may omit them on other anchors.
  const payTx: AnchorTransaction = {
    ...pending,
    withdrawAnchorAccount: pending.withdrawAnchorAccount ?? w.accountId,
    withdrawMemo: pending.withdrawMemo ?? w.memo,
    withdrawMemoType: pending.withdrawMemoType ?? w.memoType,
  };

  p.onStep?.("payment");
  const paymentTxHash = await completeWithdrawPayment({ tx: payTx, asset, account: p.account, signer: p.signer, amount: amountUSDC, ...classic });

  p.onStep?.("waiting");
  const tx = await waitForTransaction({
    anchor,
    jwt,
    id: w.id,
    protocol: "sep6",
    timeoutMs: p.timeoutMs ?? 3 * 60_000,
    intervalMs: p.intervalMs ?? 3000,
    onUpdate: p.onUpdate,
    fetch: f,
  });
  if (tx.status !== "completed") throw anchorError("anchor_tx_failed", `${tx.status}${tx.message ? `: ${tx.message}` : ""}`);
  p.onStep?.("done");
  return {
    id: w.id,
    status: tx.status,
    statusLabel: tx.statusLabel,
    amountUSDC: tx.amountIn ?? amountUSDC,
    tryPaidOut: tx.amountOut ?? quote.buyAmount,
    feeTRY: tx.amountFee,
    tryPerUsdc: quote.tryPerUsdc,
    quote,
    iban: tx.to,
    payoutReference: tx.externalTransactionId,
    paymentTxHash,
    txLink: explorerTxUrl(paymentTxHash),
    tx,
  };
}

export interface TryPriceParams {
  /** "deposit": amount is TRY in, result USDC out; "withdraw": amount is USDC in, result TRY out. */
  direction: "deposit" | "withdraw";
  amount: string;
  homeDomain?: string;
  anchor?: AnchorInfo;
  assetCode?: string;
  assetIssuer?: string;
  fetch?: Fetch;
}

export interface TryPrice {
  direction: "deposit" | "withdraw";
  /** What the user pays (TRY for deposit, USDC for withdraw). */
  sellAmount: string;
  /** What the user gets (USDC for deposit, TRY for withdraw). */
  buyAmount: string;
  /** TRY per 1 USDC, fee included. */
  tryPerUsdc?: number;
  feeTotal?: string;
  feeAsset?: string;
  raw: Sep38Price;
}

/** Indicative SEP-38 price (no wallet, no auth) — show "1 USDC = 49,03 TL" before the user confirms. */
export async function anchorPriceTRY(p: TryPriceParams): Promise<TryPrice> {
  const f = p.fetch ?? globalThis.fetch;
  const anchor = p.anchor ?? (await discoverAnchor(p.homeDomain ?? defaultTryAnchorHomeDomain(), { fetch: f, skipInfo: true }));
  const asset: Asset = anchorAsset(anchor, p.assetCode ?? defaultTryAnchorAssetCode(), p.assetIssuer);
  const usdc = sep38AssetId(asset);
  const dep = p.direction === "deposit";
  const price = await sep38Price({
    anchor,
    sellAsset: dep ? TRY_SEP38_ASSET : usdc,
    buyAsset: dep ? usdc : TRY_SEP38_ASSET,
    sellAmount: p.amount,
    ...(dep ? { sellDeliveryMethod: "bank_account" } : { buyDeliveryMethod: "bank_account" }),
    fetch: f,
  });
  return {
    direction: p.direction,
    sellAmount: price.sellAmount,
    buyAmount: price.buyAmount,
    tryPerUsdc: price.tryPerUsdc,
    feeTotal: price.fee?.total,
    feeAsset: price.fee?.asset,
    raw: price,
  };
}

/**
 * TRY ramp for the UI: "chain" talks to the real (testnet) anchor, "mock" is instant and offline.
 * `defaults` are merged into every call (e.g. `{ homeDomain }`).
 */
export function createTryRamp(mode: "mock" | "chain", defaults: Partial<TryRampCommon> & MockTryRampOptions = {}): TryRamp {
  if (mode === "mock") return createMockTryRamp(defaults);
  const needSigner = <T extends { signer?: TryRampCommon["signer"] }>(p: T) => {
    const signer = p.signer ?? defaults.signer;
    if (!signer) throw anchorError("anchor_auth_failed", "signer required");
    return signer;
  };
  return {
    depositTRY: async (p) => anchorDepositTRY({ ...defaults, ...p, signer: needSigner(p) }),
    withdrawToTRY: async (p) => anchorWithdrawToTRY({ ...defaults, ...p, signer: needSigner(p) }),
    priceTRY: (p) => anchorPriceTRY({ homeDomain: defaults.homeDomain, anchor: defaults.anchor, fetch: defaults.fetch, ...p }),
  };
}
