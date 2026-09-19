import { parseUsdc, type CampaignParamsInput, type Platform } from "@cliprail/shared";

/** Form fields (all text; units: USDC, seconds, views). */
export interface CampaignForm {
  title: string;
  brief_url: string;
  budget: string;
  rate_max_per_1k: string;
  cap_views_clip: string;
  cap_views_human: string;
  min_views: string;
  start_in: string; // how many seconds from now it starts
  epochs: string;
  epoch_len: string;
  proof_window: string;
  dispute_window: string;
  arbiter_window: string;
  claim_grace: string;
  holdback_pct: string; // percent (0–100); sent to the contract as bps
  bond: string;
  arbiter: string;
  platforms: Platform[];
  require_humanity: boolean;
}

export type FormErrors = Partial<Record<keyof CampaignForm, string>>;

// The limits enforced by the contract (contracts/cliprail/src/epoch.rs)
const MAX_TITLE = 64;
const MAX_URL = 200;
const MAX_EPOCHS = 52;
const MAX_CAP_VIEWS = 1_000_000_000_000n;
const MAX_RATE = 1_000_000_000_000n;
const MAX_BUDGET = 1_000_000_000_000_000n;

// Only `demo` is registered on the e2e instance; use NEXT_PUBLIC_PLATFORMS=youtube,demo elsewhere
const DEFAULT_PLATFORMS = (process.env.NEXT_PUBLIC_PLATFORMS ?? "demo")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Platform => s === "youtube" || s === "demo");

export function demoPreset(arbiter: string): CampaignForm {
  return {
    title: "Demo campaign",
    brief_url: "",
    budget: "20",
    rate_max_per_1k: "1",
    cap_views_clip: "50000",
    cap_views_human: "100000",
    min_views: "100",
    start_in: "60",
    epochs: "2",
    epoch_len: "300",
    proof_window: "90",
    dispute_window: "90",
    arbiter_window: "60",
    claim_grace: "300",
    holdback_pct: "20",
    bond: "5",
    arbiter,
    platforms: DEFAULT_PLATFORMS,
    require_humanity: true,
  };
}

export function emptyForm(arbiter: string): CampaignForm {
  return { ...demoPreset(arbiter), title: "", budget: "", epochs: "4", epoch_len: "86400", claim_grace: "86400", proof_window: "3600", dispute_window: "7200", arbiter_window: "3600" };
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length;
const isStellarAddress = (s: string) => /^G[A-Z2-7]{55}$/.test(s);

function int(v: string): bigint | null {
  const t = v.trim();
  return /^\d+$/.test(t) ? BigInt(t) : null;
}
function usdc(v: string): bigint | null {
  try {
    return v.trim() ? parseUsdc(v) : null;
  } catch {
    return null;
  }
}

/**
 * Validates the form and builds the parameters sent to the contract. The rules mirror the
 * contract's validate_params; a violation returns a per-field error message.
 */
export function buildParams(
  f: CampaignForm,
  brand: string | null,
  now: bigint,
): { params: CampaignParamsInput | null; errors: FormErrors } {
  const e: FormErrors = {};

  if (!f.title.trim()) e.title = "A title is required.";
  else if (utf8Len(f.title) > MAX_TITLE) e.title = `At most ${MAX_TITLE} bytes.`;
  if (f.brief_url && !/^https?:\/\//.test(f.brief_url)) e.brief_url = "Enter a link starting with http(s)://.";
  else if (utf8Len(f.brief_url) > MAX_URL) e.brief_url = `At most ${MAX_URL} bytes.`;

  const budget = usdc(f.budget);
  if (budget === null || budget <= 0n) e.budget = "Enter an amount greater than 0.";
  else if (budget > MAX_BUDGET) e.budget = "That budget is too large.";

  const rate = usdc(f.rate_max_per_1k);
  if (rate === null || rate <= 0n) e.rate_max_per_1k = "Enter a rate greater than 0.";
  else if (rate > MAX_RATE) e.rate_max_per_1k = "That rate is too large.";

  const capClip = int(f.cap_views_clip);
  if (capClip === null) e.cap_views_clip = "Enter a whole number.";
  else if (capClip > MAX_CAP_VIEWS) e.cap_views_clip = "That cap is too large.";
  const capHuman = int(f.cap_views_human);
  if (capHuman === null) e.cap_views_human = "Enter a whole number.";
  else if (capHuman > MAX_CAP_VIEWS) e.cap_views_human = "That cap is too large.";
  else if (capClip !== null && capHuman < capClip) e.cap_views_human = "The per-human cap can't be lower than the per-clip cap.";
  const minViews = int(f.min_views);
  if (minViews === null) e.min_views = "Enter a whole number.";

  const startIn = int(f.start_in);
  if (startIn === null) e.start_in = "Enter a whole number of seconds (0 = right away).";
  const epochs = int(f.epochs);
  if (epochs === null || epochs < 1n) e.epochs = "At least 1 epoch.";
  else if (epochs > BigInt(MAX_EPOCHS)) e.epochs = `At most ${MAX_EPOCHS} epochs.`;

  const epochLen = int(f.epoch_len);
  const proof = int(f.proof_window);
  const dispute = int(f.dispute_window);
  const arbiterW = int(f.arbiter_window);
  const grace = int(f.claim_grace);
  if (proof === null) e.proof_window = "Enter a whole number.";
  if (dispute === null) e.dispute_window = "Enter a whole number.";
  else if (dispute < 2n) e.dispute_window = "At least 2s (half for challenges, half for responses).";
  if (arbiterW === null) e.arbiter_window = "Enter a whole number.";
  if (epochLen === null || epochLen <= 0n) e.epoch_len = "Must be greater than 0.";
  else if (proof !== null && dispute !== null && arbiterW !== null && epochLen < proof + dispute + arbiterW)
    e.epoch_len = `The epoch can't be shorter than the proof + challenge + arbiter windows combined (${proof + dispute + arbiterW}s).`;
  if (grace === null) e.claim_grace = "Enter a whole number.";
  else if (epochLen !== null && grace < epochLen) e.claim_grace = "The claim window must be at least one epoch long.";

  const hb = Number(f.holdback_pct);
  if (!/^\d+(\.\d{1,2})?$/.test(f.holdback_pct.trim()) || hb < 0 || hb > 100) e.holdback_pct = "Enter a percentage between 0 and 100.";

  const bond = usdc(f.bond);
  if (bond === null || bond <= 0n) e.bond = "The bond must be greater than 0 (free challenges would let anyone exclude clips).";

  if (!isStellarAddress(f.arbiter)) e.arbiter = "Enter a valid Stellar address (G…).";
  else if (brand && f.arbiter === brand) e.arbiter = "The arbiter can't be the brand.";

  if (!f.platforms.length) e.platforms = "Pick at least one platform.";

  if (Object.keys(e).length) return { params: null, errors: e };

  return {
    errors: e,
    params: {
      title: f.title.trim(),
      brief_url: f.brief_url.trim(),
      budget: budget!,
      rate_max_per_1k: rate!,
      cap_views_clip: capClip!,
      cap_views_human: capHuman!,
      min_views: minViews!,
      // Signing can take a few seconds, and the contract requires start >= now
      start: now + (startIn! < 30n ? 30n : startIn!),
      epoch_len: epochLen!,
      epochs: Number(epochs!),
      proof_window: proof!,
      dispute_window: dispute!,
      arbiter_window: arbiterW!,
      claim_grace: grace!,
      holdback_bps: Math.round(hb * 100),
      bond: bond!,
      arbiter: f.arbiter,
      platforms: f.platforms,
      require_humanity: f.require_humanity,
    },
  };
}
