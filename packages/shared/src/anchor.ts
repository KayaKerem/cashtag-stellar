// Anchor (SEP-1 / SEP-10 / SEP-24 / SEP-6 / SEP-12 / SEP-38) error codes and status labels — English user messages.

export type AnchorErrorCode =
  | "anchor_unreachable"
  | "anchor_toml_invalid"
  | "anchor_wrong_network"
  | "anchor_sep24_unsupported"
  | "anchor_asset_unsupported"
  | "anchor_challenge_invalid"
  | "anchor_auth_failed"
  | "anchor_unauthorized"
  | "anchor_request_failed"
  | "anchor_tx_not_found"
  | "anchor_tx_failed"
  | "anchor_not_ready"
  | "anchor_timeout"
  | "anchor_account_missing"
  | "anchor_trustline_failed"
  | "anchor_payment_failed"
  | "anchor_underfunded"
  | "anchor_sep6_unsupported"
  | "anchor_kyc_failed"
  | "anchor_kyc_rejected"
  | "anchor_quote_failed"
  | "anchor_simulate_failed"
  | "anchor_pending_trust"
  | "anchor_amount_invalid";

export const ANCHOR_ERROR_MESSAGES: Record<AnchorErrorCode, string> = {
  anchor_unreachable: "Could not reach the anchor, try again in a moment.",
  anchor_toml_invalid: "The anchor's stellar.toml file is missing or invalid.",
  anchor_wrong_network: "The anchor runs on a different Stellar network.",
  anchor_sep24_unsupported: "The anchor does not support interactive deposits/withdrawals (SEP-24).",
  anchor_asset_unsupported: "The anchor does not support this asset.",
  anchor_challenge_invalid: "The anchor's sign-in challenge could not be verified, so it was not signed.",
  anchor_auth_failed: "Signing in to the anchor failed.",
  anchor_unauthorized: "The anchor session expired, sign in again.",
  anchor_request_failed: "The anchor rejected the request.",
  anchor_tx_not_found: "Anchor transaction not found.",
  anchor_tx_failed: "The anchor transaction failed.",
  anchor_not_ready: "The transaction is not at the payment step yet.",
  anchor_timeout: "The anchor transaction did not finish in time.",
  anchor_account_missing: "Stellar account not found; fund it with some XLM first.",
  anchor_trustline_failed: "Could not add the trustline for this asset.",
  anchor_payment_failed: "Could not send the payment to the anchor.",
  anchor_underfunded: "Not enough balance (XLM for the fee, or the asset being sent).",
  anchor_sep6_unsupported: "The anchor does not support programmatic deposits/withdrawals (SEP-6).",
  anchor_kyc_failed: "Could not send your identity (KYC) details to the anchor.",
  anchor_kyc_rejected: "The anchor did not approve your identity (KYC) details.",
  anchor_quote_failed: "Could not get a TRY/USDC quote, try again.",
  anchor_simulate_failed: "Could not simulate the test bank transfer.",
  anchor_pending_trust: "The USDC trustline is missing; the anchor will pay once it is added.",
  anchor_amount_invalid: "Invalid amount.",
};

export const isAnchorErrorCode = (c: unknown): c is AnchorErrorCode => typeof c === "string" && c in ANCHOR_ERROR_MESSAGES;

/** English message for an anchor error code; `detail` (the anchor's own text) is appended when given. */
export function anchorErrorMessage(code: AnchorErrorCode, detail?: string | null): string {
  const base = ANCHOR_ERROR_MESSAGES[code];
  const d = detail?.trim();
  return d ? `${base} (${d.slice(0, 160)})` : base;
}

/** SEP-24 transaction statuses. */
export type Sep24Status =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_external"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_trust"
  | "pending_user"
  | "on_hold"
  | "completed"
  | "refunded"
  | "expired"
  | "no_market"
  | "too_small"
  | "too_large"
  | "error";

export const SEP24_STATUS_LABELS: Record<Sep24Status, string> = {
  incomplete: "Waiting for your details (finish in the anchor window)",
  pending_user_transfer_start: "Waiting for your payment",
  pending_user_transfer_complete: "Payment received, processing",
  pending_external: "Processing at the bank",
  pending_anchor: "The anchor is processing",
  pending_stellar: "Processing on the Stellar network",
  pending_trust: "Waiting for a trustline",
  pending_user: "Waiting for an action from you",
  on_hold: "On hold (the anchor is reviewing)",
  completed: "Completed",
  refunded: "Refunded",
  expired: "Expired",
  no_market: "No market",
  too_small: "Amount too small",
  too_large: "Amount too large",
  error: "Error",
};

/** Statuses after which the anchor will not move the transaction any further. */
export const SEP24_FINAL_STATUSES: readonly Sep24Status[] = [
  "completed",
  "refunded",
  "expired",
  "no_market",
  "too_small",
  "too_large",
  "error",
];

export const sep24StatusLabel = (s: string): string => SEP24_STATUS_LABELS[s as Sep24Status] ?? s;
export const isSep24Final = (s: string): boolean => (SEP24_FINAL_STATUSES as readonly string[]).includes(s);

// ------------------------------------------------------------------ SEP-6 (TRY ⇄ USDC ramp)

/** SEP-6 transaction statuses (superset of SEP-24 plus the SEP-6-only info-update states). */
export type Sep6Status = Sep24Status | "pending_customer_info_update" | "pending_transaction_info_update";

export const SEP6_STATUS_LABELS: Record<Sep6Status, string> = {
  ...SEP24_STATUS_LABELS,
  incomplete: "Waiting for your details",
  pending_customer_info_update: "Waiting for identity (KYC) details",
  pending_transaction_info_update: "Waiting for transaction details",
};

/** Direction-specific wording (TRY in = deposit, TRY out = withdrawal). */
export const SEP6_DEPOSIT_STATUS_LABELS: Partial<Record<Sep6Status, string>> = {
  pending_user_transfer_start: "Waiting for the bank transfer",
  pending_anchor: "TRY received, sending USDC",
  pending_stellar: "Sending USDC on the Stellar network",
  pending_trust: "Waiting for the USDC trustline",
  completed: "USDC arrived in your account",
  error: "Error (TRY refunded)",
};

export const SEP6_WITHDRAW_STATUS_LABELS: Partial<Record<Sep6Status, string>> = {
  pending_user_transfer_start: "Waiting for your USDC payment",
  pending_anchor: "USDC received, sending TRY",
  pending_external: "Sending TRY to your bank account",
  completed: "TRY sent to your bank account",
  error: "Canceled",
};

/** English label for a SEP-6 status; `kind` ("deposit", "withdrawal", "deposit-exchange", ...) picks the wording. */
export function sep6StatusLabel(status: string, kind?: string | null): string {
  const k = (kind ?? "").toLowerCase();
  const table = k.startsWith("deposit") ? SEP6_DEPOSIT_STATUS_LABELS : k.startsWith("withdraw") ? SEP6_WITHDRAW_STATUS_LABELS : null;
  return table?.[status as Sep6Status] ?? SEP6_STATUS_LABELS[status as Sep6Status] ?? status;
}

export const isSep6Final = (s: string): boolean => isSep24Final(s);

/** SEP-12 customer statuses. */
export type Sep12Status = "ACCEPTED" | "PROCESSING" | "NEEDS_INFO" | "REJECTED";

export const SEP12_STATUS_LABELS: Record<Sep12Status, string> = {
  ACCEPTED: "Identity verified",
  PROCESSING: "Verifying your identity",
  NEEDS_INFO: "Identity details needed",
  REJECTED: "Identity verification rejected",
};

export const sep12StatusLabel = (s: string): string => SEP12_STATUS_LABELS[s as Sep12Status] ?? s;

/** Steps of the high-level TRY ramp helpers (`anchorDepositTRY` / `anchorWithdrawToTRY`), for progress UIs. */
export type AnchorRampStep =
  | "discover"
  | "trustline"
  | "auth"
  | "kyc"
  | "quote"
  | "deposit"
  | "bank_transfer"
  | "withdraw"
  | "payment"
  | "waiting"
  | "done";

export const ANCHOR_RAMP_STEP_LABELS: Record<AnchorRampStep, string> = {
  discover: "Fetching anchor details",
  trustline: "Checking the USDC trustline",
  auth: "Signing in to the anchor",
  kyc: "Identity verification (KYC)",
  quote: "Getting the exchange rate",
  deposit: "Creating the deposit instructions",
  bank_transfer: "Sending the bank transfer (test)",
  withdraw: "Creating the withdrawal instructions",
  payment: "Paying the anchor",
  waiting: "The anchor is finishing the transaction",
  done: "Completed",
};

/** Default TRY ⇄ USDC anchor (hackathon mock, SEP-1/6/10/12/38) and its SEP-38 off-chain asset. */
export const TR_ANCHOR_HOME_DOMAIN = "tr-mock-anchor.fly.dev";
export const TRY_SEP38_ASSET = "iso4217:TRY";

const toNum = (v: string | number): number => (typeof v === "number" ? v : Number(String(v).replace(/\s/g, "")));

/** "5000" → "5,000.00 TRY" (en-US grouping, 2 decimals). */
export function formatTry(amount: string | number, opts: { symbol?: boolean } = {}): string {
  const n = toNum(amount);
  if (!Number.isFinite(n)) return String(amount);
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.symbol === false ? s : `${s} TRY`;
}

/** TRY per USDC → "1 USDC = 49.03 TRY". */
export function formatTryRate(tryPerUsdc: string | number): string {
  const n = toNum(tryPerUsdc);
  if (!Number.isFinite(n)) return String(tryPerUsdc);
  return `1 USDC = ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} TRY`;
}
