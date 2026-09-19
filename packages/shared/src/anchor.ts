// Anchor (SEP-1 / SEP-10 / SEP-24 / SEP-6 / SEP-12 / SEP-38) error codes and status labels — Turkish user messages.

export type AnchorErrorCode =
  | "anchor_unreachable"
  | "anchor_toml_invalid"
  | "anchor_wrong_network"
  | "anchor_sep24_unsupported"
  | "anchor_asset_unsupported"
  | "anchor_challenge_invalid"
  | "anchor_auth_failed"
  | "anchor_unauthorized"
  | "anchor_request_failed"
  | "anchor_tx_not_found"
  | "anchor_tx_failed"
  | "anchor_not_ready"
  | "anchor_timeout"
  | "anchor_account_missing"
  | "anchor_trustline_failed"
  | "anchor_payment_failed"
  | "anchor_underfunded"
  | "anchor_sep6_unsupported"
  | "anchor_kyc_failed"
  | "anchor_kyc_rejected"
  | "anchor_quote_failed"
  | "anchor_simulate_failed"
  | "anchor_pending_trust"
  | "anchor_amount_invalid";

export const ANCHOR_ERROR_MESSAGES: Record<AnchorErrorCode, string> = {
  anchor_unreachable: "Anchor'a ulaşılamadı, biraz sonra tekrar dene.",
  anchor_toml_invalid: "Anchor'un stellar.toml dosyası eksik ya da hatalı.",
  anchor_wrong_network: "Anchor farklı bir Stellar ağında çalışıyor.",
  anchor_sep24_unsupported: "Anchor etkileşimli para yatırma/çekme (SEP-24) desteklemiyor.",
  anchor_asset_unsupported: "Bu varlık anchor tarafından desteklenmiyor.",
  anchor_challenge_invalid: "Anchor'un giriş isteği doğrulanamadı; güvenlik için imzalanmadı.",
  anchor_auth_failed: "Anchor girişi başarısız oldu.",
  anchor_unauthorized: "Anchor oturumunun süresi doldu, tekrar giriş yap.",
  anchor_request_failed: "Anchor isteği reddetti.",
  anchor_tx_not_found: "Anchor işlemi bulunamadı.",
  anchor_tx_failed: "Anchor işlemi başarısız oldu.",
  anchor_not_ready: "İşlem henüz ödeme adımında değil.",
  anchor_timeout: "Anchor işlemi beklenen sürede tamamlanmadı.",
  anchor_account_missing: "Stellar hesabı bulunamadı; önce hesaba biraz XLM yatırılmalı.",
  anchor_trustline_failed: "Varlık için trustline eklenemedi.",
  anchor_payment_failed: "Anchor'a ödeme gönderilemedi.",
  anchor_underfunded: "Bakiye yetersiz (işlem ücreti için XLM ya da gönderilecek varlık).",
  anchor_sep6_unsupported: "Anchor programatik para yatırma/çekme (SEP-6) desteklemiyor.",
  anchor_kyc_failed: "Kimlik doğrulama (KYC) bilgileri anchor'a gönderilemedi.",
  anchor_kyc_rejected: "Kimlik doğrulama (KYC) anchor tarafından onaylanmadı.",
  anchor_quote_failed: "TL/USDC kur teklifi alınamadı, tekrar dene.",
  anchor_simulate_failed: "Test havalesi simüle edilemedi.",
  anchor_pending_trust: "USDC trustline eksik; anchor ödemeyi trustline eklenince yapacak.",
  anchor_amount_invalid: "Geçersiz tutar.",
};

export const isAnchorErrorCode = (c: unknown): c is AnchorErrorCode => typeof c === "string" && c in ANCHOR_ERROR_MESSAGES;

/** Turkish message for an anchor error code; `detail` (anchor's own text) is appended when given. */
export function anchorErrorMessage(code: AnchorErrorCode, detail?: string | null): string {
  const base = ANCHOR_ERROR_MESSAGES[code];
  const d = detail?.trim();
  return d ? `${base} (${d.slice(0, 160)})` : base;
}

/** SEP-24 transaction statuses. */
export type Sep24Status =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_external"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_trust"
  | "pending_user"
  | "on_hold"
  | "completed"
  | "refunded"
  | "expired"
  | "no_market"
  | "too_small"
  | "too_large"
  | "error";

export const SEP24_STATUS_LABELS: Record<Sep24Status, string> = {
  incomplete: "Bilgiler bekleniyor (anchor penceresini tamamla)",
  pending_user_transfer_start: "Ödemeni bekliyor",
  pending_user_transfer_complete: "Ödeme alındı, işleniyor",
  pending_external: "Banka tarafında işleniyor",
  pending_anchor: "Anchor işliyor",
  pending_stellar: "Stellar ağında işleniyor",
  pending_trust: "Trustline bekleniyor",
  pending_user: "Senden bir işlem bekleniyor",
  on_hold: "Beklemede (anchor inceliyor)",
  completed: "Tamamlandı",
  refunded: "İade edildi",
  expired: "Süresi doldu",
  no_market: "Piyasa yok",
  too_small: "Tutar çok düşük",
  too_large: "Tutar çok yüksek",
  error: "Hata",
};

/** Statuses after which the anchor will not move the transaction any further. */
export const SEP24_FINAL_STATUSES: readonly Sep24Status[] = [
  "completed",
  "refunded",
  "expired",
  "no_market",
  "too_small",
  "too_large",
  "error",
];

export const sep24StatusLabel = (s: string): string => SEP24_STATUS_LABELS[s as Sep24Status] ?? s;
export const isSep24Final = (s: string): boolean => (SEP24_FINAL_STATUSES as readonly string[]).includes(s);

// ------------------------------------------------------------------ SEP-6 (TRY ⇄ USDC ramp)

/** SEP-6 transaction statuses (superset of SEP-24 plus the SEP-6-only info-update states). */
export type Sep6Status = Sep24Status | "pending_customer_info_update" | "pending_transaction_info_update";

export const SEP6_STATUS_LABELS: Record<Sep6Status, string> = {
  ...SEP24_STATUS_LABELS,
  incomplete: "Bilgiler bekleniyor",
  pending_customer_info_update: "Kimlik (KYC) bilgisi bekleniyor",
  pending_transaction_info_update: "İşlem bilgisi bekleniyor",
};

/** Direction-specific wording (TL yatırma = deposit, TL'ye çekme = withdrawal). */
export const SEP6_DEPOSIT_STATUS_LABELS: Partial<Record<Sep6Status, string>> = {
  pending_user_transfer_start: "TL havalesi bekleniyor",
  pending_anchor: "TL alındı, USDC gönderiliyor",
  pending_stellar: "USDC Stellar ağında gönderiliyor",
  pending_trust: "USDC trustline'ı bekleniyor",
  completed: "USDC hesabına geçti",
  error: "Hata (TL iade edildi)",
};

export const SEP6_WITHDRAW_STATUS_LABELS: Partial<Record<Sep6Status, string>> = {
  pending_user_transfer_start: "USDC ödemen bekleniyor",
  pending_anchor: "USDC alındı, TL gönderiliyor",
  pending_external: "TL banka hesabına gönderiliyor",
  completed: "TL banka hesabına gönderildi",
  error: "İptal edildi",
};

/** Turkish label for a SEP-6 status; `kind` ("deposit", "withdrawal", "deposit-exchange", ...) picks the wording. */
export function sep6StatusLabel(status: string, kind?: string | null): string {
  const k = (kind ?? "").toLowerCase();
  const table = k.startsWith("deposit") ? SEP6_DEPOSIT_STATUS_LABELS : k.startsWith("withdraw") ? SEP6_WITHDRAW_STATUS_LABELS : null;
  return table?.[status as Sep6Status] ?? SEP6_STATUS_LABELS[status as Sep6Status] ?? status;
}

export const isSep6Final = (s: string): boolean => isSep24Final(s);

/** SEP-12 customer statuses. */
export type Sep12Status = "ACCEPTED" | "PROCESSING" | "NEEDS_INFO" | "REJECTED";

export const SEP12_STATUS_LABELS: Record<Sep12Status, string> = {
  ACCEPTED: "Kimlik doğrulandı",
  PROCESSING: "Kimlik doğrulanıyor",
  NEEDS_INFO: "Kimlik bilgisi gerekli",
  REJECTED: "Kimlik doğrulaması reddedildi",
};

export const sep12StatusLabel = (s: string): string => SEP12_STATUS_LABELS[s as Sep12Status] ?? s;

/** Steps of the high-level TRY ramp helpers (`anchorDepositTRY` / `anchorWithdrawToTRY`), for progress UIs. */
export type AnchorRampStep =
  | "discover"
  | "trustline"
  | "auth"
  | "kyc"
  | "quote"
  | "deposit"
  | "bank_transfer"
  | "withdraw"
  | "payment"
  | "waiting"
  | "done";

export const ANCHOR_RAMP_STEP_LABELS: Record<AnchorRampStep, string> = {
  discover: "Anchor bilgileri alınıyor",
  trustline: "USDC trustline kontrol ediliyor",
  auth: "Anchor'a cüzdanla giriş yapılıyor",
  kyc: "Kimlik doğrulama (KYC)",
  quote: "Kur teklifi alınıyor",
  deposit: "Yatırma talimatı oluşturuluyor",
  bank_transfer: "TL havalesi gönderiliyor (test)",
  withdraw: "Çekim talimatı oluşturuluyor",
  payment: "USDC anchor'a gönderiliyor",
  waiting: "Anchor işlemi tamamlıyor",
  done: "Tamamlandı",
};

/** Default TRY ⇄ USDC anchor (hackathon mock, SEP-1/6/10/12/38) and its SEP-38 off-chain asset. */
export const TR_ANCHOR_HOME_DOMAIN = "tr-mock-anchor.fly.dev";
export const TRY_SEP38_ASSET = "iso4217:TRY";

const toNum = (v: string | number): number => (typeof v === "number" ? v : Number(String(v).replace(/\s/g, "")));

/** "5000" → "5.000,00 TL" (Turkish grouping, 2 decimals). */
export function formatTry(amount: string | number, opts: { symbol?: boolean } = {}): string {
  const n = toNum(amount);
  if (!Number.isFinite(n)) return String(amount);
  const s = n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.symbol === false ? s : `${s} TL`;
}

/** TRY per USDC → "1 USDC = 49,03 TL". */
export function formatTryRate(tryPerUsdc: string | number): string {
  const n = toNum(tryPerUsdc);
  if (!Number.isFinite(n)) return String(tryPerUsdc);
  return `1 USDC = ${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} TL`;
}
