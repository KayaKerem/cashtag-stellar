"use client";

import { CHAIN_CONFIG } from "@/lib/api/config";
import { useVerifierHealth } from "@/lib/api/health";

/**
 * Verifier simüle attestor modundaysa görünür: kanıtlar gerçek Reclaim attestor'ı yerine
 * test anahtarıyla imzalanıyor (demo için). Kontrat ID'si verifier'la uyuşmuyorsa uyarır.
 */
export function AttestorBadge() {
  const { data, isError } = useVerifierHealth();
  if (isError) {
    return (
      <span title="Verifier'a ulaşılamıyor" className="label-mono inline-flex items-center gap-1.5 rounded-full border border-danger/40 px-3 py-1.5 text-[11px] text-danger">
        <span className="size-1.5 rounded-full bg-danger" aria-hidden />
        Verifier kapalı
      </span>
    );
  }
  if (!data) return null;
  const mismatch = !!CHAIN_CONFIG.cliprailId && data.cliprailId !== CHAIN_CONFIG.cliprailId;
  if (mismatch) {
    return (
      <span title={`Verifier ${data.cliprailId} kontratına bağlı; web ${CHAIN_CONFIG.cliprailId}`} className="label-mono inline-flex items-center gap-1.5 rounded-full border border-danger/40 px-3 py-1.5 text-[11px] text-danger">
        Kontrat uyuşmuyor
      </span>
    );
  }
  if (data.attestorMode !== "simulated") return null;
  return (
    <span
      title="Kanıtlar gerçek Reclaim attestor'ı yerine demo için test anahtarıyla imzalanıyor. Kontrat içi doğrulama aynı."
      className="label-mono inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info-soft px-3 py-1.5 text-[11px] text-info"
    >
      <span className="size-1.5 rounded-full bg-info" aria-hidden />
      <span lang="en">Simulated attestor</span>
    </span>
  );
}
