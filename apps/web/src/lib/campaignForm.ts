import { parseUsdc, type CampaignParamsInput, type Platform } from "@cliprail/shared";

/** Form alanları (hepsi metin; birimler: USDC, saniye, izlenme). */
export interface CampaignForm {
  title: string;
  brief_url: string;
  budget: string;
  rate_max_per_1k: string;
  cap_views_clip: string;
  cap_views_human: string;
  min_views: string;
  start_in: string; // şu andan kaç saniye sonra başlasın
  epochs: string;
  epoch_len: string;
  proof_window: string;
  dispute_window: string;
  arbiter_window: string;
  claim_grace: string;
  holdback_pct: string; // yüzde (0–100); kontrata bps olarak gider
  bond: string;
  arbiter: string;
  platforms: Platform[];
  require_humanity: boolean;
}

export type FormErrors = Partial<Record<keyof CampaignForm, string>>;

// Kontrattaki sınırlar (contracts/cliprail/src/epoch.rs)
const MAX_TITLE = 64;
const MAX_URL = 200;
const MAX_EPOCHS = 52;
const MAX_CAP_VIEWS = 1_000_000_000_000n;
const MAX_RATE = 1_000_000_000_000n;
const MAX_BUDGET = 1_000_000_000_000_000n;

// E2E instance'ta yalnız `demo` kayıtlı; farklı kurulumda NEXT_PUBLIC_PLATFORMS=youtube,demo
const DEFAULT_PLATFORMS = (process.env.NEXT_PUBLIC_PLATFORMS ?? "demo")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Platform => s === "youtube" || s === "demo");

export function demoPreset(arbiter: string): CampaignForm {
  return {
    title: "Demo kampanyası",
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
 * Formu doğrular ve kontrata gidecek parametreleri üretir. Kurallar kontratın
 * validate_params'ıyla aynı; ihlal edilirse alan başına Türkçe hata döner.
 */
export function buildParams(
  f: CampaignForm,
  brand: string | null,
  now: bigint,
): { params: CampaignParamsInput | null; errors: FormErrors } {
  const e: FormErrors = {};

  if (!f.title.trim()) e.title = "Başlık gerekli.";
  else if (utf8Len(f.title) > MAX_TITLE) e.title = `En fazla ${MAX_TITLE} bayt.`;
  if (f.brief_url && !/^https?:\/\//.test(f.brief_url)) e.brief_url = "http(s):// ile başlayan bir link gir.";
  else if (utf8Len(f.brief_url) > MAX_URL) e.brief_url = `En fazla ${MAX_URL} bayt.`;

  const budget = usdc(f.budget);
  if (budget === null || budget <= 0n) e.budget = "0'dan büyük bir tutar gir.";
  else if (budget > MAX_BUDGET) e.budget = "Bütçe çok büyük.";

  const rate = usdc(f.rate_max_per_1k);
  if (rate === null || rate <= 0n) e.rate_max_per_1k = "0'dan büyük bir oran gir.";
  else if (rate > MAX_RATE) e.rate_max_per_1k = "Oran çok büyük.";

  const capClip = int(f.cap_views_clip);
  if (capClip === null) e.cap_views_clip = "Tam sayı gir.";
  else if (capClip > MAX_CAP_VIEWS) e.cap_views_clip = "Tavan çok büyük.";
  const capHuman = int(f.cap_views_human);
  if (capHuman === null) e.cap_views_human = "Tam sayı gir.";
  else if (capHuman > MAX_CAP_VIEWS) e.cap_views_human = "Tavan çok büyük.";
  else if (capClip !== null && capHuman < capClip) e.cap_views_human = "İnsan tavanı klip tavanından küçük olmamalı.";
  const minViews = int(f.min_views);
  if (minViews === null) e.min_views = "Tam sayı gir.";

  const startIn = int(f.start_in);
  if (startIn === null) e.start_in = "Saniye cinsinden tam sayı gir (0 = hemen).";
  const epochs = int(f.epochs);
  if (epochs === null || epochs < 1n) e.epochs = "En az 1 dönem.";
  else if (epochs > BigInt(MAX_EPOCHS)) e.epochs = `En fazla ${MAX_EPOCHS} dönem.`;

  const epochLen = int(f.epoch_len);
  const proof = int(f.proof_window);
  const dispute = int(f.dispute_window);
  const arbiterW = int(f.arbiter_window);
  const grace = int(f.claim_grace);
  if (proof === null) e.proof_window = "Tam sayı gir.";
  if (dispute === null) e.dispute_window = "Tam sayı gir.";
  else if (dispute < 2n) e.dispute_window = "En az 2 sn (yarısı itiraz, yarısı cevap).";
  if (arbiterW === null) e.arbiter_window = "Tam sayı gir.";
  if (epochLen === null || epochLen <= 0n) e.epoch_len = "0'dan büyük olmalı.";
  else if (proof !== null && dispute !== null && arbiterW !== null && epochLen < proof + dispute + arbiterW)
    e.epoch_len = `Dönem süresi kanıt + itiraz + hakem pencerelerinin toplamından (${proof + dispute + arbiterW} sn) kısa olamaz.`;
  if (grace === null) e.claim_grace = "Tam sayı gir.";
  else if (epochLen !== null && grace < epochLen) e.claim_grace = "Claim süresi en az bir dönem uzunluğunda olmalı.";

  const hb = Number(f.holdback_pct);
  if (!/^\d+(\.\d{1,2})?$/.test(f.holdback_pct.trim()) || hb < 0 || hb > 100) e.holdback_pct = "0–100 arası bir yüzde gir.";

  const bond = usdc(f.bond);
  if (bond === null || bond <= 0n) e.bond = "Teminat 0'dan büyük olmalı (bedava itiraz herkesin klip dışlamasına izin verir).";

  if (!isStellarAddress(f.arbiter)) e.arbiter = "Geçerli bir Stellar adresi (G…) gir.";
  else if (brand && f.arbiter === brand) e.arbiter = "Hakem, markanın kendisi olamaz.";

  if (!f.platforms.length) e.platforms = "En az bir platform seç.";

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
      // İmzalama birkaç saniye sürebilir; kontrat start ≥ now istiyor
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
