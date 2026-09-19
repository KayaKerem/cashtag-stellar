import { parseContractError, type ErrorSource } from "@cliprail/shared";
import { CliprailError, errorFromName, toCliprailError, type ErrorContext } from "./errors";

/** Minimal slice of the bindings' AssembledTransaction we rely on (easy to fake in tests). */
export interface TxLike<T> {
  readonly result: T;
  /** Failed simulations carry `error` (e.g. "HostError: Error(Contract, #4) ..."). */
  readonly simulation?: unknown;
  signAndSend(): Promise<{
    result: T;
    sendTransactionResponse?: { hash?: string };
    getTransactionResponse?: { txHash?: string };
  }>;
}

interface ResultLike {
  isOk(): boolean;
  isErr(): boolean;
  unwrap(): unknown;
  unwrapErr(): { message?: string } | undefined;
}

const isResult = (v: unknown): v is ResultLike =>
  !!v && typeof v === "object" && typeof (v as ResultLike).isErr === "function" && typeof (v as ResultLike).unwrap === "function";

/** Unwrap bindings `Result<T>`; `Err({message: "WrongPhase"})` → CliprailError. Non-Result values pass through. */
export function unwrapResult<T>(v: unknown, source: ErrorSource = "cliprail"): T {
  if (!isResult(v)) return v as T;
  if (v.isOk()) return v.unwrap() as T;
  const msg = v.unwrapErr()?.message ?? "";
  throw errorFromName(msg, source) ?? toCliprailError(msg, source);
}

/**
 * Simulated return value; throws on a failed simulation. (For non-Result functions the bindings
 * would otherwise hand back an empty `Err`.)
 */
export function simulatedResult<T>(tx: { result: T; simulation?: unknown }): T {
  const e = (tx.simulation as { error?: unknown } | undefined)?.error;
  if (typeof e === "string" && e) throw new Error(e);
  return tx.result;
}

/** Transient failures worth a re-simulation (stale footprint, resource limits, sequence races, congestion). */
export const RETRYABLE_RE = /footprint|ExceededLimit|tx_?bad_?seq|TRY_AGAIN_LATER/i;

export function isRetryable(err: unknown): boolean {
  // contract errors are deterministic
  if ((err instanceof CliprailError && typeof err.code === "number") || parseContractError(err)) return false;
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 4; i++) {
    if (typeof e === "string") parts.push(e);
    else if (e instanceof Error) parts.push(e.message);
    else {
      try {
        parts.push(JSON.stringify(e));
      } catch {
        /* ignore */
      }
    }
    e = (e as { cause?: unknown })?.cause;
  }
  return RETRYABLE_RE.test(parts.join(" "));
}

export interface WriteResult<T> {
  txHash: string;
  result: T;
}

/**
 * Build (= simulate) → check simulated result → sign & send. On a transient failure the whole
 * thing is rebuilt (fresh simulation / sequence) up to `retries` more times.
 */
export async function runWrite<T>(
  build: () => Promise<TxLike<unknown>>,
  opts: { source?: ErrorSource; retries?: number; delayMs?: number; errorContext?: ErrorContext } = {},
): Promise<WriteResult<T>> {
  const { source = "cliprail", retries = 2, delayMs = 1000, errorContext } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      const tx = await build();
      unwrapResult(simulatedResult(tx), source); // throws the contract error before asking the wallet to sign
      const sent = await tx.signAndSend();
      const txHash = sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash ?? "";
      return { txHash, result: unwrapResult<T>(sent.result, source) };
    } catch (err) {
      if (attempt < retries && isRetryable(err)) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      throw toCliprailError(err, source, errorContext);
    }
  }
}

/** Promise.all with at most `limit` in flight; keeps order. */
export async function mapLimit<A, B>(items: readonly A[], limit: number, fn: (a: A, i: number) => Promise<B>): Promise<B[]> {
  const out = new Array<B>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
