// Error codes: contracts/cliprail/src/errors.rs (= INTERFACES §2.3) and contracts/humanity.
import { formatUsdc } from "./format";

export type ErrorSource = "cliprail" | "humanity";

export const CLIPRAIL_ERRORS: Record<number, { name: string; message: string }> = {
  1: { name: "AlreadyInitialized", message: "The contract is already initialized." },
  2: { name: "NotInitialized", message: "The contract is not initialized yet." },
  3: { name: "InvalidParams", message: "The campaign parameters are invalid." },
  4: { name: "CampaignNotFound", message: "Campaign not found." },
  5: { name: "NotJoined", message: "You have not joined this campaign." },
  6: { name: "AlreadyJoined", message: "You already joined this campaign." },
  7: { name: "NotHuman", message: "Complete human verification first." },
  8: { name: "WrongPhase", message: "This action is not allowed in the current phase." },
  9: { name: "PlatformNotAllowed", message: "This platform is not allowed in this campaign." },
  10: { name: "VideoAlreadyRegistered", message: "This video is already registered." },
  11: { name: "ClipNotFound", message: "Clip not found." },
  12: { name: "BadSignature", message: "The proof signature is invalid." },
  13: { name: "UnknownAttestor", message: "The proof signer is not recognized." },
  14: { name: "UnknownOwner", message: "The proof owner (app) is not recognized." },
  15: { name: "UrlMismatch", message: "The URL in the proof does not match this video." },
  16: { name: "MatchMismatch", message: "The proof is not in the expected format." },
  17: { name: "CodeNotFound", message: "Your join code is missing from the video description." },
  18: { name: "ViewsParseError", message: "Could not read the view count." },
  19: { name: "ProofReused", message: "This proof has already been used." },
  20: { name: "ProofExpired", message: "The proof has expired, generate a new one." },
  21: { name: "EpochNotReady", message: "This epoch is not ready yet." },
  22: { name: "EpochOutOfRange", message: "Invalid epoch." },
  23: { name: "AlreadySettled", message: "This epoch is already settled." },
  24: { name: "OpenDisputes", message: "There are unresolved challenges." },
  25: { name: "AlreadyClaimed", message: "This payout was already claimed." },
  26: { name: "NothingToClaim", message: "Nothing to claim." },
  27: { name: "AlreadyDisputed", message: "This clip already has a challenge." },
  28: { name: "DisputeNotFound", message: "Challenge not found." },
  29: { name: "NotArbiter", message: "Only the arbiter can do this." },
  30: { name: "NotClipOwner", message: "This clip is not yours." },
  31: { name: "Excluded", message: "This clip was excluded from this epoch." },
  32: { name: "RefundNotReady", message: "It is not time for a refund yet." },
  33: { name: "AlreadyRefunded", message: "This campaign was already refunded." },
  34: { name: "PrevEpochNotSettled", message: "The previous epoch is not settled yet." },
  35: { name: "ProofTooLarge", message: "The proof is too large." },
  36: { name: "RouterNotSet", message: "Funding with a swap is not configured on this contract." },
  37: { name: "BadPath", message: "The swap path is invalid (it must start with the asset you pay and end with the campaign token)." },
  38: { name: "SwapFailed", message: "Swap failed (slippage limit, deadline or liquidity). Get a new quote and try again." },
};

export const HUMANITY_ERRORS: Record<number, { name: string; message: string }> = {
  1: { name: "AlreadyInitialized", message: "The verification contract is already initialized." },
  2: { name: "NullifierUsed", message: "This identity was already used in this campaign." },
  3: { name: "WalletRegistered", message: "This wallet is already verified." },
  // register_zk (Anon Aadhaar). Codes 4..8 assumed to follow 1..3 — TO BE CONFIRMED against contracts/humanity.
  4: { name: "NotConfigured", message: "ZK identity verification is not configured on this contract." },
  5: { name: "InvalidProof", message: "The identity proof is invalid." },
  6: { name: "StaleProof", message: "The identity proof is too old, generate a new one." },
  7: { name: "InputNotInField", message: "The proof inputs are invalid (outside the field range)." },
  8: { name: "NotAnAccount", message: "Only account (G...) wallets can be verified." },
};

/**
 * USDC (token contract / SAC) failures. Client-side codes: preflight checks before a write that
 * moves USDC from the user, or a failed call whose diagnostic events point at the token contract.
 */
export type TokenErrorCode = "insufficient_balance" | "no_trustline" | "token_error";

export const TOKEN_ERROR_MESSAGES: Record<TokenErrorCode, string> = {
  insufficient_balance: "Not enough USDC.",
  no_trustline: "This account has no USDC trustline",
  token_error: "USDC transfer failed (token contract error).",
};

/** SAC `ContractError` numbers we name (soroban-env-host): 10 BalanceError, 13 TrustlineMissingError. */
export const SAC_ERROR_CODES: Record<number, TokenErrorCode> = { 10: "insufficient_balance", 13: "no_trustline" };

export const tokenErrorCode = (sacCode: number): TokenErrorCode => SAC_ERROR_CODES[sacCode] ?? "token_error";

/** "Not enough USDC: need 10.00, have 2.50" (amounts in base units). */
export const insufficientBalanceMessage = (needed: bigint, available: bigint): string =>
  `Not enough USDC: need ${formatUsdc(needed)}, have ${formatUsdc(available)}`;

const isTokenCode = (c: unknown): c is TokenErrorCode => typeof c === "string" && c in TOKEN_ERROR_MESSAGES;

export const UNKNOWN_ERROR_MESSAGE = "Something went wrong.";

export interface ParsedError {
  source: ErrorSource;
  code: number;
  name: string | null;
  message: string;
}

export function errorMessage(code: number, source: ErrorSource = "cliprail"): string {
  const table = source === "humanity" ? HUMANITY_ERRORS : CLIPRAIL_ERRORS;
  return table[code]?.message ?? `${UNKNOWN_ERROR_MESSAGE} (#${code})`;
}

function make(code: number, source: ErrorSource): ParsedError {
  const table = source === "humanity" ? HUMANITY_ERRORS : CLIPRAIL_ERRORS;
  return { source, code, name: table[code]?.name ?? null, message: errorMessage(code, source) };
}

const CONTRACT_RE = /Error\(Contract,\s*#(\d+)\)/;
const VERIFIER_RE = /^(contract|humanity)_(\d+)$/;

/**
 * Extract a contract error from:
 * - strings / Error objects containing `Error(Contract, #19)` (simulation / host errors),
 * - verifier bodies `{ error, code: "contract_19" }` (or `"humanity_2"`),
 * - `{ code: 19 }` numbers.
 * `source` picks the table for bare numeric codes (both contracts start at 1).
 */
export function parseContractError(input: unknown, source: ErrorSource = "cliprail"): ParsedError | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") {
    const v = VERIFIER_RE.exec(input.trim());
    if (v) return make(Number(v[2]), v[1] === "humanity" ? "humanity" : source);
    const m = CONTRACT_RE.exec(input);
    return m ? make(Number(m[1]), source) : null;
  }
  if (typeof input === "number" && Number.isInteger(input)) return make(input, source);
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.code === "string" || typeof o.code === "number") {
      const r = parseContractError(o.code, source);
      if (r) return r;
    }
    for (const k of ["message", "error", "result"]) {
      if (typeof o[k] === "string") {
        const r = parseContractError(o[k], source);
        if (r) return r;
      }
    }
    if (o.cause) return parseContractError(o.cause, source);
  }
  return null;
}

/** Best-effort user-facing English message for anything thrown. */
export function userMessage(err: unknown, source: ErrorSource = "cliprail"): string {
  if (err && typeof err === "object" && isTokenCode((err as { code?: unknown }).code)) {
    const e = err as { code: TokenErrorCode; message?: unknown };
    return typeof e.message === "string" && e.message ? e.message : TOKEN_ERROR_MESSAGES[e.code];
  }
  if (isTokenCode(err)) return TOKEN_ERROR_MESSAGES[err];
  const parsed = parseContractError(err, source);
  if (parsed) return parsed.message;
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/reject|declin|denied|cancel/i.test(text)) return "The transaction was rejected in your wallet.";
  return UNKNOWN_ERROR_MESSAGE;
}
