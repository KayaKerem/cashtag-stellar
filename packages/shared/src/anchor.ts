// Anchor (SEP-1 / SEP-10 / SEP-24) error codes and status labels — Turkish user messages.

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
  | "anchor_underfunded";

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
