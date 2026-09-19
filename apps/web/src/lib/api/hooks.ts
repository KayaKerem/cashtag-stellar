"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./ApiProvider";

/** Phase and timeline data refresh on this interval (DEVELOPMENT_PLAN §6: 5s) */
export const LIVE_MS = 5_000;

export const qk = {
  campaigns: ["campaigns"] as const,
  campaign: (id: bigint) => ["campaign", id] as const,
  epoch: (id: bigint, e: number) => ["campaign", id, "epoch", e] as const,
  clips: (id: bigint) => ["campaign", id, "clips"] as const,
  participant: (id: bigint, addr: string) => ["campaign", id, "participant", addr] as const,
  human: (id: bigint, addr: string) => ["campaign", id, "human", addr] as const,
  disputes: (id: bigint) => ["campaign", id, "disputes"] as const,
};

export function useCampaigns() {
  const { api } = useApi();
  return useQuery({ queryKey: qk.campaigns, queryFn: () => api.listCampaigns(), refetchInterval: LIVE_MS });
}

export function useCampaign(id: bigint | null) {
  const { api } = useApi();
  return useQuery({
    queryKey: qk.campaign(id ?? 0n),
    queryFn: () => api.getCampaign(id!),
    enabled: id !== null,
    refetchInterval: LIVE_MS,
  });
}

export function useEpoch(id: bigint | null, e: number) {
  const { api } = useApi();
  return useQuery({
    queryKey: qk.epoch(id ?? 0n, e),
    queryFn: () => api.getEpoch(id!, e),
    enabled: id !== null,
    refetchInterval: LIVE_MS,
  });
}

/** Every epoch state of a campaign (the epoch count comes from the campaign) */
export function useEpochs(id: bigint | null, epochs: number | undefined) {
  const { api } = useApi();
  return useQuery({
    queryKey: [...qk.clips(id ?? 0n).slice(0, 2), "epochs", epochs ?? 0],
    queryFn: () => Promise.all(Array.from({ length: epochs! }, (_, e) => api.getEpoch(id!, e))),
    enabled: id !== null && !!epochs,
    refetchInterval: LIVE_MS,
  });
}

export function useClips(id: bigint | null) {
  const { api } = useApi();
  return useQuery({
    queryKey: qk.clips(id ?? 0n),
    queryFn: () => api.getClips(id!),
    enabled: id !== null,
    refetchInterval: LIVE_MS,
  });
}

export function useParticipant(id: bigint | null, addr: string | null) {
  const { api } = useApi();
  return useQuery({
    queryKey: qk.participant(id ?? 0n, addr ?? ""),
    queryFn: () => api.getParticipant(id!, addr!),
    enabled: id !== null && !!addr,
  });
}

export function useIsHuman(id: bigint | null, addr: string | null) {
  const { api } = useApi();
  return useQuery({
    queryKey: qk.human(id ?? 0n, addr ?? ""),
    queryFn: () => api.isHuman(id!, addr!),
    enabled: id !== null && !!addr,
  });
}

export function useDisputes(id: bigint | null) {
  const { api } = useApi();
  return useQuery({
    queryKey: qk.disputes(id ?? 0n),
    queryFn: () => api.listDisputes(id!),
    enabled: id !== null,
    refetchInterval: LIVE_MS,
  });
}

/**
 * A write: calls the API and, on success, refreshes that campaign's queries (or all of them).
 * Usage: const join = useWrite((api, id: bigint) => api.join(id), { campaignId });
 */
export function useWrite<TArgs, TResult extends { txHash: string }>(
  fn: (api: ReturnType<typeof useApi>["api"], args: TArgs) => Promise<TResult>,
  opts?: { campaignId?: bigint },
) {
  const { api } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => fn(api, args),
    onSuccess: () => {
      if (opts?.campaignId !== undefined) {
        qc.invalidateQueries({ queryKey: ["campaign", opts.campaignId] });
        qc.invalidateQueries({ queryKey: qk.campaigns });
      } else {
        qc.invalidateQueries();
      }
    },
  });
}
