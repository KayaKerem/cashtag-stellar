"use client";

import { useQuery } from "@tanstack/react-query";
import { API_MODE, CHAIN_CONFIG } from "./config";

export interface VerifierHealth {
  ok: boolean;
  network: string;
  cliprailId: string;
  humanityId: string;
  attestorMode?: "simulated" | "reclaim" | string;
  attestor?: string;
}

/** Verifier `/health`: ağ, kontrat ID'leri ve attestor modu. Yalnız chain modunda sorgulanır. */
export function useVerifierHealth() {
  return useQuery({
    queryKey: ["verifier", "health", CHAIN_CONFIG.verifierUrl],
    queryFn: async (): Promise<VerifierHealth> => {
      const res = await fetch(`${CHAIN_CONFIG.verifierUrl.replace(/\/$/, "")}/health`);
      if (!res.ok) throw new Error(`verifier ${res.status}`);
      return res.json();
    },
    enabled: API_MODE === "chain",
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
