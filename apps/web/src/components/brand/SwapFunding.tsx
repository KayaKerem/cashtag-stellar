"use client";

import { isCliprailError } from "@cliprail/client";
import { CIRCLE_USDC_TESTNET_SAC, XLM_SAC_TESTNET, formatUsdc } from "@cliprail/shared";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/lib/api/ApiProvider";
import { errorMessage } from "@/lib/api/errors";

export type FundWith = "usdc" | "xlm";

/** The Soroswap pool is for Circle testnet USDC; that becomes the token of an XLM-funded campaign. */
export const SWAP_CAMPAIGN_TOKEN = CIRCLE_USDC_TESTNET_SAC;
export const SWAP_TOKEN_IN = XLM_SAC_TESTNET;

/** Turns swap errors into language a brand can act on (issue #61). */
export function swapErrorMessage(err: unknown): string {
  if (isCliprailError(err)) {
    if (err.source === "cliprail" && err.code === 38) return "The price moved; refresh the quote and try again.";
    if (err.code === "no_trustline") return "Add a Circle USDC trustline to your wallet first; the swap output lands in your account.";
    // The pre-check looks at the XLM balance, but the message comes back saying USDC
    if (err.code === "insufficient_balance") return err.message.replace(/USDC/g, "XLM");
    if (err.source === "swap" && (err.code === 509 || err.code === 511)) return `${err.message} Try another asset or a smaller budget.`;
  }
  return errorMessage(err);
}

export function useSwapQuote(budget: bigint | null, enabled: boolean) {
  const { api } = useApi();
  return useQuery({
    queryKey: ["swapQuote", SWAP_TOKEN_IN, SWAP_CAMPAIGN_TOKEN, budget],
    queryFn: () => api.quoteSwapFunding(budget!, SWAP_TOKEN_IN, SWAP_CAMPAIGN_TOKEN),
    enabled: enabled && budget !== null && budget > 0n,
    refetchInterval: 15_000,
    retry: 0,
  });
}

export function FundingChoice({
  value,
  onChange,
  budget,
}: {
  value: FundWith;
  onChange(v: FundWith): void;
  budget: bigint | null;
}) {
  const quote = useSwapQuote(budget, value === "xlm");
  const opts: { v: FundWith; t: string; d: string }[] = [
    { v: "usdc", t: "USDC", d: "The budget is locked from the USDC in your wallet." },
    { v: "xlm", t: "Fund with XLM", d: "The contract swaps XLM for exactly the budget in USDC on Soroswap and locks it in one transaction." },
  ];
  return (
    <div className="sm:col-span-2">
      <span className="text-sm font-medium">Funding asset</span>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={value === o.v}
            className={`rounded-2xl border p-3 text-left transition ${value === o.v ? "border-fg bg-surface-2" : "border-border-strong hover:bg-surface-2"}`}
          >
            <span className="block text-sm font-medium">{o.t}</span>
            <span className="mt-0.5 block text-xs text-muted">{o.d}</span>
          </button>
        ))}
      </div>

      {value === "xlm" && (
        <div className="mt-3 rounded-2xl bg-panel p-4 text-sm" aria-live="polite">
          {!budget || budget <= 0n ? (
            <p className="text-muted">Enter a budget to get a quote.</p>
          ) : quote.isLoading ? (
            <p className="text-muted">Getting the Soroswap quote…</p>
          ) : quote.error ? (
            <p className="text-danger">{swapErrorMessage(quote.error)}</p>
          ) : quote.data ? (
            <>
              <p>
                <span className="font-mono text-lg tabular">≈ {formatUsdc(quote.data.amountIn, { maxDecimals: 2, group: "," })} XLM</span>{" "}
                <span className="text-muted">(at most {formatUsdc(quote.data.amountInMax, { maxDecimals: 2, group: "," })} XLM, 1% slippage)</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                Swapped to {formatUsdc(quote.data.amountOut, { maxDecimals: 2, group: "," })} USDC on Soroswap and locked in the contract. The quote refreshes every 15s.
              </p>
            </>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              The campaign token becomes Circle testnet USDC; the brand and the clippers need a trustline for it.
            </span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => quote.refetch()} className="underline underline-offset-4 hover:text-fg">
                Refresh quote
              </button>
              <span className="label-mono rounded-full border border-border-strong px-2 py-0.5 text-[9px]">Powered by Soroswap</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
