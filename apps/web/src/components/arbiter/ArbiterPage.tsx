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
  if (d.status !== "Responded") return "Yalnızca cevaplanmış itirazlara karar verilir";
  if (canResolve(c.params, d.epoch, now)) return null;
  if (now < disputeEnd(c.params, d.epoch)) return `Karar penceresi ${formatDuration(disputeEnd(c.params, d.epoch) - now)} sonra açılır`;
  return "Karar süresi doldu; clipper otomatik kazanır (finalize)";
}

function DisputeCard({ c, d, clip, now }: { c: CampaignView; d: Dispute; clip: ClipView | undefined; now: bigint }) {
  const resolve = useWrite((a, clipperWins: boolean) => a.resolve(d.id, clipperWins), { campaignId: c.id });
  const reason = resolveReason(c, d, now);
  const end = settleAt(c.params, d.epoch);
  const actionable = d.status === "Responded";

  return (
    <li className={`rounded-[20px] border bg-surface p-5 shadow-card ${actionable && !reason ? "border-fg" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">İtiraz #{d.id.toString()}</span>
        <Link href={`/c/${c.id}`} className="text-sm hover:underline">
          {c.params.title || `Kampanya #${c.id}`}
        </Link>
        <span className="text-sm text-muted">· Dönem {d.epoch + 1}</span>
        <span className="ml-auto">
          <StatusPill status={d.status} />
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-row p-3">
          <p className="label-mono text-[10px] text-muted">Klip</p>
          {clip ? (
            <a href={videoUrl(clip.clip.platform, clip.clip.video_id)} target="_blank" rel="noreferrer" className="mt-1 block text-sm hover:underline">
              #{clip.clip.id.toString()} {PLATFORM_LABEL[clip.clip.platform] ?? clip.clip.platform} · <span className="font-mono text-xs">{clip.clip.video_id}</span> ↗
            </a>
          ) : (
            <p className="mt-1 text-sm">Klip #{d.clip_id.toString()}</p>
          )}
          {clip?.epochs[d.epoch] && (
            <p className="mt-1 text-xs text-muted">
              Bu dönem ağırlık {clip.epochs[d.epoch]!.weight.toLocaleString("en-US")} · başlangıç {clip.clip.baseline.toLocaleString("en-US")}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-row p-3">
          <p className="label-mono text-[10px] text-muted">Taraflar</p>
          <div className="mt-1.5 flex flex-col items-start gap-1.5">
            <AddressChip address={d.challenger} label="İtiraz eden" />
            {clip && <AddressChip address={clip.clip.owner} label="Clipper" />}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-border p-3">
        <p className="label-mono text-[10px] text-muted">Kanıt</p>
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
            Kazanan iki teminatı da alır (<Amount value={c.params.bond * 2n} />).{" "}
            {now < end && !reason && <span className="text-fg">Karar için {formatDuration(end - now)} kaldı.</span>}
          </p>
          <div className="flex gap-2">
            <TxButton
              variant="outline"
              disabledReason={reason}
              action={() => resolve.mutateAsync(true)}
              successTitle="Karar verildi: clipper haklı"
              successBody={() => "Klip dönemde kalıyor; teminatlar clipper'a."}
            >
              Clipper haklı
            </TxButton>
            <TxButton
              variant="danger"
              disabledReason={reason}
              action={() => resolve.mutateAsync(false)}
              successTitle="Karar verildi: itiraz eden haklı"
              successBody={() => "Klip bu dönemden dışlandı; teminatlar itiraz edene."}
            >
              İtiraz eden haklı
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
        <PageHeader title="Hakem" description="Cevaplanmış itirazlara karar ver." />
        <EmptyState
          title="Cüzdanını bağla"
          description="Hakemi olduğun kampanyaların itirazlarını görmek için hakem cüzdanını bağla."
          action={
            <button type="button" onClick={() => wallet.connect()} className="label-mono h-10 rounded-full bg-lime px-5 text-[12px] text-lime-fg">
              Cüzdan bağla
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
        title="Hakem"
        description="Clipper'ın cevap verdiği itirazlara karar ver. Karar, cevap süresi bittikten sonra ve settle anından önce verilir; süre dolarsa clipper kazanır."
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : mine.length === 0 ? (
        <EmptyState
          title="Hakemi olduğun kampanya yok"
          description="Bu sayfa, kampanya kurulurken hakem olarak seçilen cüzdan içindir."
        />
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="display mb-4 flex items-baseline gap-2 text-2xl">
              Karar bekleyenler <span className="font-mono text-sm text-muted">{responded.length}</span>
            </h2>
            {responded.length === 0 ? (
              <EmptyState title="Karar bekleyen itiraz yok" description="Clipper bir itiraza cevap verdiğinde burada görünür." />
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
              <h2 className="display mb-1 text-xl">Cevap bekleyenler</h2>
              <p className="mb-4 text-sm text-muted">Clipper henüz cevap vermedi; cevapsız kalırsa itiraz eden kazanır ve karar gerekmez.</p>
              <ul className="space-y-4">
                {waiting.map((x) => (
                  <DisputeCard key={x.d.id.toString()} {...x} now={now} />
                ))}
              </ul>
            </section>
          )}

          {closed.length > 0 && (
            <section>
              <h2 className="display mb-4 text-xl">Sonuçlananlar</h2>
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
