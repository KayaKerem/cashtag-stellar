// Amounts are i128 with 7 decimals (1 USDC = 10_000_000).

export const USDC_DECIMALS = 7;
export const USDC_UNIT = 10_000_000n;

export interface FormatUsdcOptions {
  /** minimum fraction digits (default 2) */
  minDecimals?: number;
  /** maximum fraction digits, truncated toward zero (default 7) */
  maxDecimals?: number;
  /** thousands separator, e.g. "." or "," (default none) */
  group?: string;
  /** decimal separator (default ".") */
  decimal?: string;
}

export function formatUsdc(amount: bigint, opts: FormatUsdcOptions = {}): string {
  const { minDecimals = 2, maxDecimals = USDC_DECIMALS, group = "", decimal = "." } = opts;
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  let int = (abs / USDC_UNIT).toString();
  let frac = (abs % USDC_UNIT).toString().padStart(USDC_DECIMALS, "0").slice(0, maxDecimals);
  frac = frac.replace(/0+$/, "");
  if (frac.length < minDecimals) frac = frac.padEnd(Math.min(minDecimals, maxDecimals), "0");
  if (group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const s = frac ? `${int}${decimal}${frac}` : int;
  return neg && /[1-9]/.test(s) ? `-${s}` : s;
}

/**
 * "12.5" / "12,5" / "1000" → base units. Throws on invalid input or more than 7 decimals.
 * A comma is accepted as the decimal separator only when there is no dot.
 */
export function parseUsdc(input: string): bigint {
  let s = input.trim().replace(/[\s_]/g, "");
  if (!s.includes(".") && (s.match(/,/g)?.length ?? 0) === 1) s = s.replace(",", ".");
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error("Invalid amount.");
  const frac = m[3] ?? "";
  if (frac.length > USDC_DECIMALS) throw new Error("Use at most 7 decimal places.");
  const v = BigInt(m[2] || "0") * USDC_UNIT + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0");
  return m[1] ? -v : v;
}

export function shortAddress(addr: string, head = 4, tail = 4): string {
  if (!addr || addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

export const explorerTxUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const explorerContractUrl = (id: string) => `${EXPLORER_BASE}/contract/${id}`;
export const explorerAccountUrl = (addr: string) => `${EXPLORER_BASE}/account/${addr}`;
/** G… → account, C… → contract. */
export const explorerAddressUrl = (addr: string) =>
  addr.startsWith("C") ? explorerContractUrl(addr) : explorerAccountUrl(addr);
