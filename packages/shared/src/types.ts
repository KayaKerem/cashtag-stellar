// Mirrors contracts/cliprail/src/types.rs (authoritative) and docs/INTERFACES.md v2 §2.1 / §5.
// Mapping: u64/i128 → bigint, u32 → number, Address/Symbol/String → string, Option<T> → T | null.

export type Platform = "youtube" | "demo";

export interface CampaignParams {
  token: string;
  budget: bigint;
  rate_max_per_1k: bigint;
  cap_views_clip: bigint;
  cap_views_human: bigint;
  min_views: bigint;
  start: bigint;
  epoch_len: bigint;
  epochs: number;
  proof_window: bigint;
  dispute_window: bigint;
  arbiter_window: bigint;
  claim_grace: bigint;
  /** 0..=10000, not applied to the last epoch. */
  holdback_bps: number;
  bond: bigint;
  arbiter: string;
  platforms: string[];
  require_humanity: boolean;
  /** ≤ 64 bytes */
  title: string;
  /** ≤ 200 bytes */
  brief_url: string;
}

export interface Campaign {
  id: bigint;
  brand: string;
  params: CampaignParams;
  /** Remaining balance of this campaign held by the contract. */
  balance: bigint;
  settled_epochs: number;
  refunded: boolean;
  participants: number;
  clips: number;
}

/** INTERFACES §5 uses `CampaignView` without defining it; it is the on-chain `Campaign`. */
export type CampaignView = Campaign;

export interface Participant {
  address: string;
  /** "CR-XXXXXX" */
  code: string;
  joined_at: bigint;
}

export interface Clip {
  id: bigint;
  campaign_id: bigint;
  owner: string;
  platform: string;
  video_id: string;
  baseline: bigint;
  hwm: bigint;
  registered_at: bigint;
  first_epoch: number;
}

export const CLIP_EPOCH_STATUSES = ["Active", "Challenged", "Responded", "Excluded"] as const;
export type ClipEpochStatus = (typeof CLIP_EPOCH_STATUSES)[number];

export interface ClipEpoch {
  baseline: bigint;
  /** Highest proven view count within the proof window. */
  views: bigint;
  weight: bigint;
  status: ClipEpochStatus;
  claimed: boolean;
  /** A close proof for the next epoch arrived (holdback liveness). */
  alive: boolean;
  holdback_claimed: boolean;
}

export interface ClipView {
  clip: Clip;
  /** index = epoch; null = no close proof for that epoch */
  epochs: (ClipEpoch | null)[];
}

export interface ParticipantEpoch {
  raw: bigint;
  weight: bigint;
}

export interface EpochState {
  total_weight: bigint;
  open_disputes: number;
  settled: boolean;
  /** budget/rate/spent/held_* are only meaningful once settled. */
  budget: bigint;
  rate: bigint;
  spent: bigint;
  held_total: bigint;
  held_survived: bigint;
}

export const DISPUTE_STATUSES = ["Open", "Responded", "ChallengerWon", "ClipperWon"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export interface Dispute {
  id: bigint;
  campaign_id: bigint;
  clip_id: bigint;
  epoch: number;
  challenger: string;
  /** ≤ 200 bytes */
  evidence: string;
  status: DisputeStatus;
  opened_at: bigint;
}

/** Input for `createCampaign`; INTERFACES §5 references it without a definition. */
export type CampaignParamsInput = Omit<CampaignParams, "token" | "platforms"> & {
  /** Defaults to the testnet USDC SAC on the implementation side. */
  token?: string;
  platforms: Platform[];
};

/** Soroswap quote for swap funding (amounts in base units, 7 decimals for SACs). */
export interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  /** Swap route `[tokenIn, …, tokenOut]`. */
  path: string[];
  /** Exact output (= campaign budget). */
  amountOut: bigint;
  /** Input needed at the current pool price. */
  amountIn: bigint;
  /** `amountIn` + default slippage (1%); what the brand signs as the maximum. */
  amountInMax: bigint;
  router: string;
}

export interface CliprailApi {
  listCampaigns(): Promise<CampaignView[]>;
  getCampaign(id: bigint): Promise<CampaignView>;
  getEpoch(id: bigint, e: number): Promise<EpochState>;
  getClips(id: bigint): Promise<ClipView[]>;
  getParticipant(id: bigint, addr: string): Promise<Participant | null>;
  isHuman(id: bigint, addr: string): Promise<boolean>;
  listDisputes(id: bigint): Promise<Dispute[]>;
  // writes → txHash
  createCampaign(p: CampaignParamsInput): Promise<{ id: bigint; txHash: string }>;
  /**
   * Price of funding `budget` (campaign token base units) with `tokenIn` via Soroswap
   * (`router_get_amounts_in`, simulation only). `token` defaults to the testnet USDC SAC.
   */
  quoteSwapFunding(budget: bigint, tokenIn: string, token?: string): Promise<SwapQuote>;
  /**
   * createCampaign funded with any asset: the contract swaps at most `amountInMax` of `tokenIn`
   * (default: fresh quote + `slippageBps`, default 100 = 1%) into exactly `budget` of the campaign
   * token via the Soroswap router and escrows it, atomically, in one brand-signed tx.
   */
  createCampaignWithSwap(
    p: CampaignParamsInput,
    o: { tokenIn: string; amountInMax?: bigint; slippageBps?: number },
  ): Promise<{ id: bigint; txHash: string; amountInMax: bigint; quote: SwapQuote }>;
  registerHuman(id: bigint): Promise<{ txHash: string }>;
  /**
   * Anon Aadhaar ZK registration: the verifier builds a Groth16 proof (TEST mode: UIDAI test data,
   * `identity` = demo identity name, default one per wallet), then the connected wallet signs
   * humanity.register_zk. `nullifier` is a decimal string.
   */
  registerHumanZk(id: bigint, opts?: { identity?: string }): Promise<{ txHash: string; nullifier: string }>;
  join(id: bigint): Promise<{ code: string; txHash: string }>;
  registerClip(id: bigint, platform: Platform, videoId: string): Promise<{ clipId: bigint; txHash: string }>;
  submitClose(id: bigint, clipId: bigint, e: number): Promise<{ txHash: string }>;
  challenge(id: bigint, clipId: bigint, e: number, evidence: string): Promise<{ disputeId: bigint; txHash: string }>;
  respond(disputeId: bigint): Promise<{ txHash: string }>;
  resolve(disputeId: bigint, clipperWins: boolean): Promise<{ txHash: string }>;
  finalizeDispute(disputeId: bigint): Promise<{ txHash: string }>;
  settleEpoch(id: bigint, e: number): Promise<{ txHash: string }>;
  claim(id: bigint, clipId: bigint, e: number): Promise<{ amount: bigint; txHash: string }>;
  claimHoldback(id: bigint, clipId: bigint, e: number): Promise<{ amount: bigint; txHash: string }>;
  refund(id: bigint): Promise<{ amount: bigint; txHash: string }>;
}

// ---------------------------------------------------------------- normalization

/**
 * Unit enum variants arrive in different shapes depending on the decoder:
 * generated bindings → `{ tag: "Active", values: undefined }`, `scValToNative` → `["Active"]`,
 * mocks → `"Active"`. Returns the plain variant name.
 */
export function normalizeEnum<T extends string>(v: unknown, allowed?: readonly T[]): T {
  let tag: unknown = v;
  if (Array.isArray(v)) tag = v[0];
  else if (v !== null && typeof v === "object" && "tag" in v) tag = (v as { tag: unknown }).tag;
  if (typeof tag !== "string" || (allowed && !allowed.includes(tag as T))) {
    throw new Error(`unexpected enum value: ${JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))}`);
  }
  return tag as T;
}

const big = (x: unknown): bigint => (typeof x === "bigint" ? x : BigInt(x as number | string));
const num = (x: unknown): number => Number(x);

/** Option<T> from bindings may be `undefined`, `null`, or `{ tag: "None" }` / `{ tag: "Some", values: [x] }`. */
export function normalizeOption<T>(v: unknown): T | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object" && "tag" in (v as object)) {
    const o = v as { tag: string; values?: unknown[] };
    if (o.tag === "None") return null;
    if (o.tag === "Some") return (o.values?.[0] ?? null) as T | null;
  }
  return v as T;
}

export function normalizeClipEpoch(raw: any): ClipEpoch {
  return {
    baseline: big(raw.baseline),
    views: big(raw.views),
    weight: big(raw.weight),
    status: normalizeEnum(raw.status, CLIP_EPOCH_STATUSES),
    claimed: Boolean(raw.claimed),
    alive: Boolean(raw.alive),
    holdback_claimed: Boolean(raw.holdback_claimed),
  };
}

export function normalizeClip(raw: any): Clip {
  return {
    id: big(raw.id),
    campaign_id: big(raw.campaign_id),
    owner: String(raw.owner),
    platform: String(raw.platform),
    video_id: String(raw.video_id),
    baseline: big(raw.baseline),
    hwm: big(raw.hwm),
    registered_at: big(raw.registered_at),
    first_epoch: num(raw.first_epoch),
  };
}

export function normalizeClipView(raw: any): ClipView {
  return {
    clip: normalizeClip(raw.clip),
    epochs: (raw.epochs as unknown[]).map((x) => {
      const ce = normalizeOption<any>(x);
      return ce === null ? null : normalizeClipEpoch(ce);
    }),
  };
}

export function normalizeDispute(raw: any): Dispute {
  return {
    id: big(raw.id),
    campaign_id: big(raw.campaign_id),
    clip_id: big(raw.clip_id),
    epoch: num(raw.epoch),
    challenger: String(raw.challenger),
    evidence: String(raw.evidence),
    status: normalizeEnum(raw.status, DISPUTE_STATUSES),
    opened_at: big(raw.opened_at),
  };
}

export function normalizeEpochState(raw: any): EpochState {
  return {
    total_weight: big(raw.total_weight),
    open_disputes: num(raw.open_disputes),
    settled: Boolean(raw.settled),
    budget: big(raw.budget),
    rate: big(raw.rate),
    spent: big(raw.spent),
    held_total: big(raw.held_total),
    held_survived: big(raw.held_survived),
  };
}
