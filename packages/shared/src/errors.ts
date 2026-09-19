// Error codes: contracts/cliprail/src/errors.rs (= INTERFACES §2.3) and contracts/humanity.

export type ErrorSource = "cliprail" | "humanity";

export const CLIPRAIL_ERRORS: Record<number, { name: string; message: string }> = {
  1: { name: "AlreadyInitialized", message: "Kontrat zaten başlatılmış." },
  2: { name: "NotInitialized", message: "Kontrat henüz başlatılmamış." },
  3: { name: "InvalidParams", message: "Kampanya parametreleri geçersiz." },
  4: { name: "CampaignNotFound", message: "Kampanya bulunamadı." },
  5: { name: "NotJoined", message: "Bu kampanyaya katılmamışsın." },
  6: { name: "AlreadyJoined", message: "Bu kampanyaya zaten katıldın." },
  7: { name: "NotHuman", message: "Önce insan doğrulamasını tamamla." },
  8: { name: "WrongPhase", message: "Bu işlem şu anki aşamada yapılamaz." },
  9: { name: "PlatformNotAllowed", message: "Bu platform kampanyada izinli değil." },
  10: { name: "VideoAlreadyRegistered", message: "Bu video zaten kayıtlı." },
  11: { name: "ClipNotFound", message: "Klip bulunamadı." },
  12: { name: "BadSignature", message: "Kanıt imzası geçersiz." },
  13: { name: "UnknownAttestor", message: "Kanıtı imzalayan tanınmıyor." },
  14: { name: "UnknownOwner", message: "Kanıt sahibi (uygulama) tanınmıyor." },
  15: { name: "UrlMismatch", message: "Kanıttaki adres bu videoyla eşleşmiyor." },
  16: { name: "MatchMismatch", message: "Kanıt beklenen biçimde değil." },
  17: { name: "CodeNotFound", message: "Katılım kodun video açıklamasında bulunamadı." },
  18: { name: "ViewsParseError", message: "İzlenme sayısı okunamadı." },
  19: { name: "ProofReused", message: "Bu kanıt daha önce kullanılmış." },
  20: { name: "ProofExpired", message: "Kanıtın süresi geçmiş, yenisini üret." },
  21: { name: "EpochNotReady", message: "Dönem henüz hazır değil." },
  22: { name: "EpochOutOfRange", message: "Geçersiz dönem." },
  23: { name: "AlreadySettled", message: "Dönem zaten kapatılmış." },
  24: { name: "OpenDisputes", message: "Sonuçlanmamış itiraz var." },
  25: { name: "AlreadyClaimed", message: "Bu ödeme zaten alınmış." },
  26: { name: "NothingToClaim", message: "Alınacak ödeme yok." },
  27: { name: "AlreadyDisputed", message: "Bu klip için zaten itiraz var." },
  28: { name: "DisputeNotFound", message: "İtiraz bulunamadı." },
  29: { name: "NotArbiter", message: "Bu işlemi yalnızca hakem yapabilir." },
  30: { name: "NotClipOwner", message: "Bu klip sana ait değil." },
  31: { name: "Excluded", message: "Klip bu dönem için dışlandı." },
  32: { name: "RefundNotReady", message: "İade zamanı henüz gelmedi." },
  33: { name: "AlreadyRefunded", message: "Kampanya zaten iade edilmiş." },
  34: { name: "PrevEpochNotSettled", message: "Önceki dönem henüz kapatılmadı." },
  35: { name: "ProofTooLarge", message: "Kanıt çok büyük." },
};

export const HUMANITY_ERRORS: Record<number, { name: string; message: string }> = {
  1: { name: "AlreadyInitialized", message: "Doğrulama kontratı zaten başlatılmış." },
  2: { name: "NullifierUsed", message: "Bu kimlik bu kampanyada zaten kullanıldı." },
  3: { name: "WalletRegistered", message: "Bu cüzdan zaten doğrulanmış." },
};

export const UNKNOWN_ERROR_MESSAGE = "Beklenmeyen bir hata oluştu.";

export interface ParsedError {
  source: ErrorSource;
  code: number;
  name: string | null;
  message: string;
}

export function errorMessage(code: number, source: ErrorSource = "cliprail"): string {
  const table = source === "humanity" ? HUMANITY_ERRORS : CLIPRAIL_ERRORS;
  return table[code]?.message ?? `${UNKNOWN_ERROR_MESSAGE} (#${code})`;
}

function make(code: number, source: ErrorSource): ParsedError {
  const table = source === "humanity" ? HUMANITY_ERRORS : CLIPRAIL_ERRORS;
  return { source, code, name: table[code]?.name ?? null, message: errorMessage(code, source) };
}

const CONTRACT_RE = /Error\(Contract,\s*#(\d+)\)/;
const VERIFIER_RE = /^(contract|humanity)_(\d+)$/;

/**
 * Extract a contract error from:
 * - strings / Error objects containing `Error(Contract, #19)` (simulation / host errors),
 * - verifier bodies `{ error, code: "contract_19" }` (or `"humanity_2"`),
 * - `{ code: 19 }` numbers.
 * `source` picks the table for bare numeric codes (both contracts start at 1).
 */
export function parseContractError(input: unknown, source: ErrorSource = "cliprail"): ParsedError | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") {
    const v = VERIFIER_RE.exec(input.trim());
    if (v) return make(Number(v[2]), v[1] === "humanity" ? "humanity" : source);
    const m = CONTRACT_RE.exec(input);
    return m ? make(Number(m[1]), source) : null;
  }
  if (typeof input === "number" && Number.isInteger(input)) return make(input, source);
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.code === "string" || typeof o.code === "number") {
      const r = parseContractError(o.code, source);
      if (r) return r;
    }
    for (const k of ["message", "error", "result"]) {
      if (typeof o[k] === "string") {
        const r = parseContractError(o[k], source);
        if (r) return r;
      }
    }
    if (o.cause) return parseContractError(o.cause, source);
  }
  return null;
}

/** Best-effort user-facing Turkish message for anything thrown. */
export function userMessage(err: unknown, source: ErrorSource = "cliprail"): string {
  const parsed = parseContractError(err, source);
  if (parsed) return parsed.message;
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/reject|declin|denied|cancel/i.test(text)) return "İşlem cüzdanda reddedildi.";
  return UNKNOWN_ERROR_MESSAGE;
}
