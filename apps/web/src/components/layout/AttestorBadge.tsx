"use client";

import { CHAIN_CONFIG } from "@/lib/api/config";
import { useVerifierHealth } from "@/lib/api/health";

/**
 * Shown when the verifier runs in simulated attestor mode: proofs are signed with a test key
 * instead of the live Reclaim attestor (for the demo). Also warns when the contract ID does not
 * match the verifier's.
 */
export function AttestorBadge() {
  const { data, isError } = useVerifierHealth();
  if (isError) {
    return (
      <span title="Can't reach the verifier" className="label-mono inline-flex items-center gap-1.5 rounded-full border border-danger/40 px-3 py-1.5 text-[11px] text-danger">
        <span className="size-1.5 rounded-full bg-danger" aria-hidden />
        Verifier offline
      </span>
    );
  }
  if (!data) return null;
  const mismatch = !!CHAIN_CONFIG.cliprailId && data.cliprailId !== CHAIN_CONFIG.cliprailId;
  if (mismatch) {
    return (
      <span title={`The verifier points at contract ${data.cliprailId}; the app uses ${CHAIN_CONFIG.cliprailId}`} className="label-mono inline-flex items-center gap-1.5 rounded-full border border-danger/40 px-3 py-1.5 text-[11px] text-danger">
        Contract mismatch
      </span>
    );
  }
  if (data.attestorMode !== "simulated") return null;
  return (
    <span
      title="For this demo, proofs are signed with a test key instead of the live Reclaim attestor. In-contract verification is identical."
      className="label-mono inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info-soft px-3 py-1.5 text-[11px] text-info"
    >
      <span className="size-1.5 rounded-full bg-info" aria-hidden />
      Simulated attestor
    </span>
  );
}
