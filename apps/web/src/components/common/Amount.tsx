import { formatUsdc } from "@cliprail/shared";

/** Renders an i128 amount (7 decimals) as USDC. */
export function Amount({
  value,
  symbol = "USDC",
  decimals = 2,
  className = "",
}: {
  value: bigint;
  symbol?: string | null;
  decimals?: number;
  className?: string;
}) {
  return (
    <span className={`font-mono tabular ${className}`}>
      {formatUsdc(value, { maxDecimals: decimals, minDecimals: Math.min(2, decimals), group: "," })}
      {symbol && <span className="ml-1 text-[0.8em] text-muted">{symbol}</span>}
    </span>
  );
}
