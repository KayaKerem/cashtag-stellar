import type { CampaignParams, EpochState } from "../src/types";

export const USDC = 10_000_000n;

/** Same defaults as contracts/cliprail/src/test/setup.rs `T::params()` with start = 1000. */
export function params(over: Partial<CampaignParams> = {}): CampaignParams {
  return {
    token: "CCRCO347GR4FVCZACMTXZWE4EKTICARZXRRTS4R4HZZYK7R7E65UX45E",
    budget: 1000n * USDC,
    rate_max_per_1k: USDC,
    cap_views_clip: 50_000n,
    cap_views_human: 100_000n,
    min_views: 100n,
    start: 1000n,
    epoch_len: 300n,
    epochs: 2,
    proof_window: 90n,
    dispute_window: 90n,
    arbiter_window: 60n,
    claim_grace: 300n,
    holdback_bps: 2000,
    bond: 5n * USDC,
    arbiter: "GDH2Z5OKYIMU7ON3ALKOU6LUVH3F7KBQQ4IUUOM7KUV54VCZGPRT54RP",
    platforms: ["youtube", "demo"],
    require_humanity: true,
    title: "Launch trailer clips",
    brief_url: "https://example.com/brief",
    ...over,
  };
}

export function epochState(over: Partial<EpochState> = {}): EpochState {
  return {
    total_weight: 0n,
    open_disputes: 0,
    settled: false,
    budget: 0n,
    rate: 0n,
    spent: 0n,
    held_total: 0n,
    held_survived: 0n,
    ...over,
  };
}
