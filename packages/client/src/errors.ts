import {
  CLIPRAIL_ERRORS,
  HUMANITY_ERRORS,
  UNKNOWN_ERROR_MESSAGE,
  parseContractError,
  userMessage,
  type ErrorSource,
} from "@cliprail/shared";

export type CliprailErrorSource = ErrorSource | "verifier" | "wallet" | "network";

/**
 * Typed error thrown by every api method.
 * `code`: contract error number (source cliprail/humanity) or a string tag
 * ("wallet_rejected", "http_401", "unknown", ...). `message` is Turkish, ready for the UI.
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

/** Anything thrown → CliprailError (contract errors are parsed from host/simulation messages). */
export function toCliprailError(err: unknown, source: ErrorSource = "cliprail"): CliprailError {
  if (err instanceof CliprailError) return err;
  const parsed = parseContractError(err, source);
  if (parsed) return new CliprailError(parsed.code, parsed.source, parsed.message, parsed.name, err);
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (REJECT_RE.test(text)) return new CliprailError("wallet_rejected", "wallet", userMessage(err, source), null, err);
  if (/fetch failed|network|ECONN|timeout/i.test(text))
    return new CliprailError("network", "network", "Ağa bağlanılamadı, tekrar dene.", null, err);
  return new CliprailError("unknown", source, text ? `${UNKNOWN_ERROR_MESSAGE} (${text.slice(0, 160)})` : UNKNOWN_ERROR_MESSAGE, null, err);
}
