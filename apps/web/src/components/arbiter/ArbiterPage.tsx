"use client";

import { canResolve, disputeEnd, settleAt, type CampaignView, type ClipView, type Dispute } from "@cliprail/shared";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { AddressChip } from "@/components/common/AddressChip";
import { Amount } from "@/components/common/Amount";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { StatusPill } from "@/components/common/StatusPill";
import { TxButton } from "@/components/common/TxButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { useApi } from "@/lib/api/ApiProvider";
import { LIVE_MS, qk, useCampaigns, useWrite } from "@/lib/api/hooks";
import { formatDuration, useNow } from "@/lib/hooks/useNow";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { PLATFORM_LABEL, videoUrl } from "@/lib/video";

function resolveReason(c: CampaignView, d: Dispute, now: bigint): string | null {
  if (d.status !== "Responded") return "Only challenges that got a response can be decided";
  if (canResolve(c.params, d.epoch, now)) return null;
  if (now < disputeEnd(c.params, d.epoch)) return `The decision window opens in ${formatDuration(disputeEnd(c.params, d.epoch) - now)}`;
  return "The decision window has closed; the clipper wins automatically (finalize)";
}

function DisputeCard({ c, d, clip, now }: { c: CampaignView; d: Dispute; clip: ClipView | undefined; now: bigint }) {
  const resolve = useWrite((a, clipperWins: boolean) => a.resolve(d.id, clipperWins), { campaignId: c.id });
  const reason = resolveReason(c, d, now);
  const end = settleAt(c.params, d.epoch);
  const actionable = d.status === "Responded";

  return (
    <li className={`rounded-[20px] border bg-surface p-5 shadow-card ${actionable && !reason ? "border-fg" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">Challenge #{d.id.toString()}</span>
        <Link href={`/c/${c.id}`} className="text-sm hover:underline">
          {c.params.title || `Campaign #${c.id}`}
        </Link>
        <span className="text-sm text-muted">· Epoch {d.epoch + 1}</span>
        <span className="ml-auto">
          <StatusPill status={d.status} />
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-row p-3">
          <p className="label-mono text-[10px] text-muted">Clip</p>
          {clip ? (
            <a href={videoUrl(clip.clip.platform, clip.clip.video_id)} target="_blank" rel="noreferrer" className="mt-1 block text-sm hover:underline">
              #{clip.clip.id.toString()} {PLATFORM_LABEL[clip.clip.platform] ?? clip.clip.platform} · <span className="font-mono text-xs">{clip.clip.video_id}</span> ↗
            </a>
          ) : (
            <p className="mt-1 text-sm">Clip #{d.clip_id.toString()}</p>
          )}
          {clip?.epochs[d.epoch] && (
            <p className="mt-1 text-xs text-muted">
              Weight this epoch {clip.epochs[d.epoch]!.weight.toLocaleString("en-US")} · baseline {clip.clip.baseline.toLocaleString("en-US")}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-row p-3">
          <p className="label-mono text-[10px] text-muted">Parties</p>
          <div className="mt-1.5 flex flex-col items-start gap-1.5">
            <AddressChip address={d.challenger} label="Challenger" />
            {clip && <AddressChip address={clip.clip.owner} label="Clipper" />}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-border p-3">
        <p className="label-mono text-[10px] text-muted">Evidence</p>
        <p className="mt-1 break-words text-sm">
          {/^https?:\/\//.test(d.evidence) ? (
            <a href={d.evidence} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {d.evidence}
            </a>
          ) : (
            d.evidence || <span className="text-muted">—</span>
          )}
        </p>
      </div>

      {actionable && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-xs text-muted">
            The winner takes both bonds (<Amount value={c.params.bond * 2n} />).{" "}
            {now < end && !reason && <span className="text-fg">{formatDuration(end - now)} left to decide.</span>}
          </p>
          <div className="flex gap-2">
            <TxButton
              variant="outline"
              disabledReason={reason}
              action={() => resolve.mutateAsync(true)}
              successTitle="Decided: the clipper was right"
              successBody={() => "The clip stays in the epoch; both bonds go to the clipper."}
            >
              Clipper is right
            </TxButton>
            <TxButton
              variant="danger"
              disabledReason={reason}
              action={() => resolve.mutateAsync(false)}
              successTitle="Decided: the challenger was right"
              successBody={() => "The clip is excluded from this epoch; both bonds go to the challenger."}
            >
              Challenger is right
            </TxButton>
          </div>
        </div>
      )}
    </li>
  );
}

export function ArbiterPage() {
  const { api, account, mode } = useApi();
  const wallet = useWallet();
  const now = useNow();
  const campaigns = useCampaigns();
  const mine = (campaigns.data ?? []).filter((c) => c.params.arbiter === account);

  const disputesQ = useQueries({
    queries: mine.map((c) => ({ queryKey: qk.disputes(c.id), queryFn: () => api.listDisputes(c.id), refetchInterval: LIVE_MS })),
  });
  const clipsQ = useQueries({
    queries: mine.map((c) => ({ queryKey: qk.clips(c.id), queryFn: () => api.getClips(c.id), refetchInterval: LIVE_MS })),
  });

  if (mode === "chain" && !wallet.connected) {
    return (
      <>
        <PageHeader title="Arbiter" description="Decide the challenges that got a response." />
        <EmptyState
          title="Connect your wallet"
          description="Connect the arbiter wallet to see challenges from the campaigns you arbitrate."
          action={
            <button type="button" onClick={() => wallet.connect()} className="label-mono h-10 rounded-full bg-lime px-5 text-[12px] text-lime-fg">
              Connect wallet
            </button>
          }
        />
      </>
    );
  }

  const loading = campaigns.isLoading || disputesQ.some((q) => q.isLoading);
  const items = mine.flatMap((c, i) =>
    (disputesQ[i]?.data ?? []).map((d) => ({ c, d, clip: clipsQ[i]?.data?.find((v) => v.clip.id === d.clip_id) })),
  );
  const responded = items.filter((x) => x.d.status === "Responded");
  const waiting = items.filter((x) => x.d.status === "Open");
  const closed = items.filter((x) => x.d.status === "ChallengerWon" || x.d.status === "ClipperWon");

  return (
    <>
      <PageHeader
        title="Arbiter"
        description="Decide the challenges a clipper responded to. Decisions happen after the response window closes and before settle; if the window runs out, the clipper wins."
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : mine.length === 0 ? (
        <EmptyState
          title="No campaigns to arbitrate"
          description="This page is for the wallet chosen as arbiter when a campaign was created."
        />
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="display mb-4 flex items-baseline gap-2 text-2xl">
              Waiting for your decision <span className="font-mono text-sm text-muted">{responded.length}</span>
            </h2>
            {responded.length === 0 ? (
              <EmptyState title="Nothing to decide" description="Challenges show up here when a clipper responds to one." />
            ) : (
              <ul className="space-y-4">
                {responded.map((x) => (
                  <DisputeCard key={x.d.id.toString()} {...x} now={now} />
                ))}
              </ul>
            )}
          </section>

          {waiting.length > 0 && (
            <section>
              <h2 className="display mb-1 text-xl">Waiting for a response</h2>
              <p className="mb-4 text-sm text-muted">The clipper hasn&apos;t responded yet; with no response the challenger wins and no decision is needed.</p>
              <ul className="space-y-4">
                {waiting.map((x) => (
                  <DisputeCard key={x.d.id.toString()} {...x} now={now} />
                ))}
              </ul>
            </section>
          )}

          {closed.length > 0 && (
            <section>
              <h2 className="display mb-4 text-xl">Resolved</h2>
              <ul className="space-y-4">
                {closed.map((x) => (
                  <DisputeCard key={x.d.id.toString()} {...x} now={now} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
