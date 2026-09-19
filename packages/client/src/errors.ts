import {
  CLIPRAIL_ERRORS,
  HUMANITY_ERRORS,
  TOKEN_ERROR_MESSAGES,
  UNKNOWN_ERROR_MESSAGE,
  parseContractError,
  tokenErrorCode,
  userMessage,
  type ErrorSource,
} from "@cliprail/shared";

export type CliprailErrorSource = ErrorSource | "token" | "verifier" | "wallet" | "network" | "anchor";

/**
 * Typed error thrown by every api method.
 * `code`: contract error number (source cliprail/humanity) or a string tag
 * ("wallet_rejected", "http_401", "unknown", ...; source "token": "insufficient_balance",
 * "no_trustline", "token_error"). `message` is Turkish, ready for the UI.
 */
export class CliprailError extends Error {
  readonly code: number | string;
  readonly source: CliprailErrorSource;
  /** Contract error name (e.g. "WrongPhase") when known. */
  readonly errorName: string | null;
  constructor(code: number | string, source: CliprailErrorSource, message: string, errorName: string | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CliprailError";
    this.code = code;
    this.source = source;
    this.errorName = errorName;
  }
}

export const isCliprailError = (e: unknown): e is CliprailError => e instanceof CliprailError;

/** Bindings' `Err` carries `{ message: "WrongPhase" }` (the Rust variant name) — map it back to a code. */
export function errorFromName(name: string, source: ErrorSource = "cliprail"): CliprailError | null {
  const table = source === "humanity" ? HUMANITY_ERRORS : CLIPRAIL_ERRORS;
  for (const [code, e] of Object.entries(table)) {
    if (e.name === name) return new CliprailError(Number(code), source, e.message, e.name);
  }
  return null;
}

const REJECT_RE = /reject|declin|denied|cancel/i;

/** Which contracts a failing call may have hit (to tell token/SAC errors from cliprail codes). */
export interface ErrorContext {
  /** Token contract ids (USDC SAC); an error raised by one of these maps to source "token". */
  tokenIds?: readonly (string | undefined)[];
  /**
   * Our own contracts (cliprail, humanity). When given, an error raised by any *other* contract
   * is also treated as a token error (cliprail's only external callees are token contracts).
   */
  ownIds?: readonly (string | undefined)[];
}

/** Message + nested causes as one string. */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 4; i++) {
    if (typeof e === "string") parts.push(e);
    else if (e instanceof Error) parts.push(e.message);
    else if (typeof e === "object") {
      const o = e as Record<string, unknown>;
      for (const k of ["message", "error"]) if (typeof o[k] === "string") parts.push(o[k] as string);
    }
    e = (e as { cause?: unknown })?.cause;
  }
  return parts.join("\n");
}

// `0: [Diagnostic Event] contract:C..., topics:[error, Error(Contract, #10)], data:[...]`
const ERROR_EVENT_RE = /contract:\s*(C[A-Z2-7]{55})[^\n]*?topics:\s*\[\s*error,\s*Error\(Contract,\s*#(\d+)\)/g;
// SAC's own diagnostic strings (soroban-env-host stellar_asset_contract)
const SAC_TRUSTLINE_RE = /trustline entry is missing/i;
const SAC_BALANCE_RE = /balance is not sufficient/i;

/** The contract that raised the error (oldest error event in the host's event log) and its code. */
export function failingContract(text: string): { contractId: string; code: number } | null {
  const hits = [...text.matchAll(ERROR_EVENT_RE)].map((m) => ({ contractId: m[1], code: Number(m[2]) }));
  if (!hits.length) return null;
  return /oldest first/i.test(text) ? hits[0] : hits[hits.length - 1];
}

/** Token (USDC SAC) failure → CliprailError with source "token"; null when it is not one. */
export function tokenError(err: unknown, ctx: ErrorContext = {}): CliprailError | null {
  const text = errorText(err);
  if (!text) return null;
  const tokens = (ctx.tokenIds ?? []).filter(Boolean);
  const own = (ctx.ownIds ?? []).filter(Boolean);
  const hit = failingContract(text);
  let code: ReturnType<typeof tokenErrorCode> | null = null;
  if (hit && (tokens.includes(hit.contractId) || (own.length > 0 && !own.includes(hit.contractId)))) {
    code = tokenErrorCode(hit.code);
  } else if (!hit || tokens.includes(hit.contractId)) {
    if (SAC_TRUSTLINE_RE.test(text)) code = "no_trustline";
    else if (SAC_BALANCE_RE.test(text)) code = "insufficient_balance";
  }
  return code ? new CliprailError(code, "token", TOKEN_ERROR_MESSAGES[code], null, err) : null;
}

/** Anything thrown → CliprailError (contract errors are parsed from host/simulation messages). */
export function toCliprailError(err: unknown, source: ErrorSource = "cliprail", ctx?: ErrorContext): CliprailError {
  if (err instanceof CliprailError) return err;
  const tok = tokenError(err, ctx);
  if (tok) return tok;
  const parsed = parseContractError(err, source);
  if (parsed) return new CliprailError(parsed.code, parsed.source, parsed.message, parsed.name, err);
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (REJECT_RE.test(text)) return new CliprailError("wallet_rejected", "wallet", userMessage(err, source), null, err);
  if (/fetch failed|network|ECONN|timeout/i.test(text))
    return new CliprailError("network", "network", "Ağa bağlanılamadı, tekrar dene.", null, err);
  return new CliprailError("unknown", source, text ? `${UNKNOWN_ERROR_MESSAGE} (${text.slice(0, 160)})` : UNKNOWN_ERROR_MESSAGE, null, err);
}
