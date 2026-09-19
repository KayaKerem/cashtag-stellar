// Soroswap (AMM on Soroban) — used to fund a campaign with any asset: cliprail.create_campaign_with_swap
// swaps `token_in` → campaign token through the Soroswap router and escrows exactly `budget`.
// Testnet ids: github.com/soroswap/core public/testnet.contracts.json.

export const SOROSWAP_TESTNET = {
  router: "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
  factory: "CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY",
} as const;

/** Native XLM Stellar Asset Contract on testnet (`stellar contract id asset --asset native --network testnet`). */
export const XLM_SAC_TESTNET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** Circle testnet USDC (USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5) SAC; Soroswap has a deep XLM pair for it. */
export const CIRCLE_USDC_TESTNET_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const CIRCLE_USDC_TESTNET_ASSET = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Default slippage tolerance for swap funding (basis points). */
export const DEFAULT_SWAP_SLIPPAGE_BPS = 100;

/** Swap deadline offset (seconds from now). */
export const SWAP_DEADLINE_SECS = 600;

/** `quote` increased by `bps` basis points, rounded up. */
export function withSlippage(quote: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("slippageBps must be an integer in 0..10000");
  return (quote * BigInt(10_000 + bps) + 9_999n) / 10_000n;
}

/** Soroswap router `CombinedRouterError` codes we surface to the UI. */
export const SOROSWAP_ERRORS: Record<number, { name: string; message: string }> = {
  503: { name: "DeadlineExpired", message: "Takas süresi doldu, tekrar dene." },
  508: { name: "ExcessiveInputAmount", message: "Fiyat kaydı (slippage) limiti aşıldı, tekrar teklif al." },
  509: { name: "PairDoesNotExist", message: "Bu varlık için Soroswap havuzu yok." },
  511: { name: "InsufficientLiquidity", message: "Soroswap havuzunda yeterli likidite yok." },
  514: { name: "InvalidPath", message: "Takas yolu geçersiz." },
};
