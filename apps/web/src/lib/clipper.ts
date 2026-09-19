import {
  canClaim,
  canClaimHoldback,
  canRespond,
  canSubmitProof,
  contentEnd,
  estimateEpoch,
  holdbackShare,
  lastEpoch,
  participantWeight,
  payFor,
  proofEnd,
  refundAt,
  splitPay,
  holdbackReleaseEnd,
  type CampaignView,
  type ClipView,
  type Dispute,
  type EpochState,
} from "@cliprail/shared";
import type { PillStatus } from "@/components/common/StatusPill";
import { formatDuration } from "@/lib/hooks/useNow";

export type CellAction =
  | { kind: "close"; enabled: boolean; reason?: string }
  | { kind: "respond"; enabled: boolean; reason?: string; disputeId: bigint }
  | { kind: "claim"; enabled: boolean; reason?: string }
  | { kind: "holdback"; enabled: boolean; reason?: string };

export interface Cell {
  epoch: number;
  weight: bigint | null;
  /** Tahmini ya da kesin toplam pay (immediate + held) */
  pay: bigint;
  immediate: bigint;
  held: bigint;
  holdbackPayout: bigint;
  final: boolean;
  status: PillStatus | null;
  action: CellAction | null;
  note?: string;
}

/** Katılımcının bir dönemdeki ham ağırlığı: dışlanmamış kliplerinin w_clip toplamı (kontratla aynı). */
function participantRaw(all: ClipView[], owner: string, e: number): bigint {
  let raw = 0n;
  for (const v of all) {
    if (v.clip.owner !== owner) continue;
    const ce = v.epochs[e];
    if (ce && ce.status !== "Excluded") raw += ce.weight;
  }
  return raw;
}

/**
 * Bir klip-dönem hücresi için ödeme tahmini, durum ve (fazına göre) aksiyon.
 * Pencere kuralları @cliprail/shared'deki can* fonksiyonlarıyla kontratla aynı.
 */
export function buildCell(
  c: CampaignView,
  view: ClipView,
  all: ClipView[],
  epochs: EpochState[] | undefined,
  disputes: Dispute[] | undefined,
  e: number,
  now: bigint,
): Cell {
  const p = c.params;
  const ce = view.epochs[e];
  const st = epochs?.[e];
  const empty: Cell = { epoch: e, weight: null, pay: 0n, immediate: 0n, held: 0n, holdbackPayout: 0n, final: false, status: null, action: null };

  if (e < view.clip.first_epoch) return { ...empty, note: "Kayıttan önce" };

  // Kapanış kanıtı henüz yok
  if (!ce) {
    if (canSubmitProof(p, e, now)) return { ...empty, status: "Pending", action: { kind: "close", enabled: true } };
    if (now < contentEnd(p, e))
      return {
        ...empty,
        status: "Pending",
        action: { kind: "close", enabled: false, reason: `Kanıt penceresi ${formatDuration(contentEnd(p, e) - now)} sonra açılır` },
      };
    return { ...empty, note: "Kanıt gönderilmedi" };
  }

  // Ödeme: settle sonrası kesin oran, öncesi o anki W ile tahmin
  const est = st ? estimateEpoch(p, e, st, e > 0 ? epochs?.[e - 1] : null) : null;
  const raw = participantRaw(all, view.clip.owner, e);
  const wP = participantWeight(p, raw);
  const pay = est && ce.status !== "Excluded" ? payFor(est.rate, wP, raw, ce.weight) : 0n;
  const split = splitPay(p, e, pay);
  const holdbackPayout = st?.settled && ce.alive ? holdbackShare(split.held, st) : 0n;
  const base: Cell = {
    epoch: e,
    weight: ce.weight,
    pay,
    immediate: split.immediate,
    held: split.held,
    holdbackPayout,
    final: !!est?.final,
    status: null,
    action: null,
  };

  if (ce.status === "Excluded") return { ...base, status: "Excluded", note: "İtirazı kaybettin; bu dönem ödemesi yok" };
  if (ce.status === "Responded") return { ...base, status: "Responded", note: "Hakem kararı bekleniyor" };
  if (ce.status === "Challenged") {
    const d = disputes?.find((x) => x.clip_id === view.clip.id && x.epoch === e && x.status === "Open");
    if (!d) return { ...base, status: "Challenged" };
    return {
      ...base,
      status: "Challenged",
      action: canRespond(p, e, now)
        ? { kind: "respond", enabled: true, disputeId: d.id }
        : { kind: "respond", enabled: false, disputeId: d.id, reason: "Cevap süresi doldu" },
    };
  }

  // Active
  if (canSubmitProof(p, e, now)) {
    // Pencere açıkken daha yüksek izlenmeyle yeniden kanıt gönderilebilir
    return { ...base, status: "Active", action: { kind: "close", enabled: true }, note: "Pencere açık; tekrar kanıt gönderebilirsin" };
  }
  if (!st?.settled) {
    return {
      ...base,
      status: "Active",
      action: { kind: "claim", enabled: false, reason: now < proofEnd(p, e) ? "Kanıt penceresi sürüyor" : "Dönem henüz settle edilmedi" },
    };
  }
  if (!ce.claimed) {
    if (pay === 0n) return { ...base, status: "Active", note: "Bu dönem ödeme yok (ağırlık 0)" };
    return {
      ...base,
      status: "Claimable",
      action: canClaim(p, now) ? { kind: "claim", enabled: true } : { kind: "claim", enabled: false, reason: "Claim süresi doldu (iade yapıldı)" },
    };
  }

  // Claim edildi → holdback
  if (split.held === 0n || e >= lastEpoch(p)) return { ...base, status: "Claimed" };
  if (ce.holdback_claimed) return { ...base, status: "Claimed", note: "Holdback da alındı" };
  if (!ce.alive) {
    // Pencere proof_end(e+1) anında açılır (lib.rs claim_holdback: now >= proof_end(e+1))
    if (now >= holdbackReleaseEnd(p, e)) return { ...base, status: "Claimed", note: "Holdback yandı (sonraki dönem kanıtı gelmedi)" };
    return {
      ...base,
      status: "Holdback",
      action: { kind: "holdback", enabled: false, reason: "Sonraki dönem kapanış kanıtı bekleniyor" },
    };
  }
  if (canClaimHoldback(p, e, now)) return { ...base, status: "Holdback", action: { kind: "holdback", enabled: true } };
  return {
    ...base,
    status: "Holdback",
    action: {
      kind: "holdback",
      enabled: false,
      reason: now >= refundAt(p) ? "Süre doldu" : `${formatDuration(holdbackReleaseEnd(p, e) - now)} sonra açılır`,
    },
  };
}

export interface Totals {
  earned: bigint;
  pending: bigint;
  holdback: bigint;
}

export function addTotals(t: Totals, cell: Cell, ce: { claimed: boolean; holdback_claimed: boolean } | null) {
  if (!ce || cell.status === "Excluded") return;
  if (ce.claimed) t.earned += cell.immediate;
  else t.pending += cell.immediate;
  if (ce.holdback_claimed) t.earned += cell.holdbackPayout;
  else t.holdback += cell.held;
}
