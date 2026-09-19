"use client";

import { canJoin, type CampaignView, type ClipView, type Dispute, type EpochState } from "@cliprail/shared";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { Amount } from "@/components/common/Amount";
import { CodeBadge } from "@/components/common/CodeBadge";
import { DemoBoostButton } from "./DemoBoostButton";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { PhaseTimeline } from "@/components/common/PhaseTimeline";
import { StatusPill } from "@/components/common/StatusPill";
import { Cancelled, TxButton } from "@/components/common/TxButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { useApi } from "@/lib/api/ApiProvider";
import { LIVE_MS, qk, useCampaigns, useWrite } from "@/lib/api/hooks";
import { addTotals, buildCell, type Cell, type Totals } from "@/lib/clipper";
import { useNow } from "@/lib/hooks/useNow";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { PLATFORM_LABEL, videoUrl } from "@/lib/video";

function CellActionButton({ c, clipId, cell }: { c: CampaignView; clipId: bigint; cell: Cell }) {
  const id = c.id;
  const e = cell.epoch;
  const close = useWrite((a) => a.submitClose(id, clipId, e), { campaignId: id });
  const claim = useWrite((a) => a.claim(id, clipId, e), { campaignId: id });
  const hb = useWrite((a) => a.claimHoldback(id, clipId, e), { campaignId: id });
  const respond = useWrite((a, disputeId: bigint) => a.respond(disputeId), { campaignId: id });
  const a = cell.action;
  if (!a) return null;
  const reason = a.enabled ? null : (a.reason ?? "Şu an yapılamaz");
  const cls = "h-8 px-3 text-[10px]";

  switch (a.kind) {
    case "close":
      return (
        <TxButton className={cls} variant="outline" disabledReason={reason} action={() => close.mutateAsync(undefined)} successTitle="Kapanış kanıtı gönderildi" successBody={() => "Verifier kanıtı üretti ve kontrata iletti."}>
          Kapanış kanıtı
        </TxButton>
      );
    case "claim":
      return (
        <TxButton className={cls} disabledReason={reason} action={() => claim.mutateAsync(undefined)} successTitle="Ödeme alındı" successBody={(r) => <Amount value={r.amount} />}>
          {/* lang=en: Türkçe büyük harf dönüşümü "CLAİM" yapmasın */}
          <span lang="en">Claim</span>
        </TxButton>
      );
    case "holdback":
      return (
        <TxButton className={cls} disabledReason={reason} action={() => hb.mutateAsync(undefined)} successTitle="Holdback alındı" successBody={(r) => <Amount value={r.amount} />}>
          <span lang="en">Holdback claim</span>
        </TxButton>
      );
    case "respond":
      return (
        <span className="inline-flex flex-col items-end gap-1">
          <TxButton
            className={cls}
            variant="danger"
            disabledReason={reason}
            action={() => {
              const ok = window.confirm(
                `İtiraza cevap vermek için ${Number(c.params.bond) / 1e7} USDC teminat yatıracaksın. Hakem aleyhine karar verirse teminatı kaybedersin; lehine karar verirse iki teminatı da alırsın. Devam edilsin mi?`,
              );
              if (!ok) return Promise.reject(new Cancelled());
              return respond.mutateAsync(a.disputeId);
            }}
            successTitle="İtiraza cevap verildi"
            successBody={() => "Karar hakemde."}
          >
            İtiraza cevap ver
          </TxButton>
          <span className="text-[10px] text-muted">Teminat: <Amount value={c.params.bond} /></span>
        </span>
      );
  }
}

function CampaignBlock({
  c,
  mine,
  all,
  epochs,
  disputes,
  code,
  now,
}: {
  c: CampaignView;
  mine: ClipView[];
  all: ClipView[];
  epochs: EpochState[] | undefined;
  disputes: Dispute[] | undefined;
  code: string | null;
  now: bigint;
}) {
  const E = c.params.epochs;
  return (
    <section className="rounded-[20px] border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/c/${c.id}`} className="display text-xl hover:underline">
          {c.params.title || `Kampanya #${c.id}`}
        </Link>
        {code && <CodeBadge code={code} size="sm" />}
        {canJoin(c.params, now) && !c.refunded && (
          <ButtonLink href={`/c/${c.id}/register`} variant="soft" className="ml-auto">
            Klip ekle
          </ButtonLink>
        )}
      </div>
      <div className="mt-4">
        <PhaseTimeline params={c.params} now={now} compact />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-normal">Klip</th>
              {Array.from({ length: E }, (_, e) => (
                <th key={e} className="px-3 py-2 font-normal">
                  Dönem {e + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mine.map((v) => (
              <tr key={v.clip.id.toString()} className="border-b border-border align-top last:border-b-0">
                <td className="py-3 pr-3">
                  <a href={videoUrl(v.clip.platform, v.clip.video_id)} target="_blank" rel="noreferrer" className="hover:underline">
                    <span className="text-muted">#{v.clip.id.toString()}</span> {PLATFORM_LABEL[v.clip.platform] ?? v.clip.platform}
                  </a>
                  <span className="block max-w-[10rem] truncate font-mono text-[11px] text-muted">{v.clip.video_id}</span>
                  <span className="block text-[11px] text-muted">başlangıç {v.clip.baseline.toLocaleString("en-US")}</span>
                  {v.clip.platform === "demo" && <DemoBoostButton videoId={v.clip.video_id} />}
                </td>
                {Array.from({ length: E }, (_, e) => {
                  const cell = buildCell(c, v, all, epochs, disputes, e, now);
                  return (
                    <td key={e} className="px-3 py-3">
                      <div className="flex min-w-[9rem] flex-col items-start gap-1.5">
                        {cell.weight !== null ? (
                          <>
                            <span className="font-mono text-xs text-muted tabular">w {cell.weight.toLocaleString("en-US")}</span>
                            <span className="text-sm">
                              <Amount value={cell.pay} />
                              <span className="ml-1 text-[10px] text-muted">{cell.final ? "kesin" : "tahmini"}</span>
                            </span>
                            {cell.held > 0n && (
                              <span className="text-[11px] text-muted">
                                hemen <Amount value={cell.immediate} symbol={null} /> · holdback <Amount value={cell.held} symbol={null} />
                              </span>
                            )}
                          </>
                        ) : null}
                        {cell.status && <StatusPill status={cell.status} />}
                        {cell.note && <span className="text-[11px] text-muted">{cell.note}</span>}
                        <CellActionButton c={c} clipId={v.clip.id} cell={cell} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MePanel() {
  const { api, account, mode } = useApi();
  const wallet = useWallet();
  const now = useNow();
  const campaigns = useCampaigns();
  const list = campaigns.data ?? [];

  const clipsQ = useQueries({
    queries: list.map((c) => ({ queryKey: qk.clips(c.id), queryFn: () => api.getClips(c.id), refetchInterval: LIVE_MS })),
  });
  const epochsQ = useQueries({
    queries: list.map((c) => ({
      queryKey: ["campaign", c.id, "epochs", c.params.epochs],
      queryFn: () => Promise.all(Array.from({ length: c.params.epochs }, (_, e) => api.getEpoch(c.id, e))),
      refetchInterval: LIVE_MS,
    })),
  });
  const disputesQ = useQueries({
    queries: list.map((c) => ({ queryKey: qk.disputes(c.id), queryFn: () => api.listDisputes(c.id), refetchInterval: LIVE_MS })),
  });
  const partsQ = useQueries({
    queries: list.map((c) => ({
      queryKey: qk.participant(c.id, account ?? ""),
      queryFn: () => api.getParticipant(c.id, account!),
      enabled: !!account,
    })),
  });

  if (mode === "chain" && !wallet.connected) {
    return (
      <>
        <PageHeader title="Panelim" description="Kliplerin, dönem durumları ve kazançların." />
        <EmptyState
          title="Cüzdanını bağla"
          description="Panelini görmek için kliplerini kaydettiğin cüzdanı bağla."
          action={
            <button type="button" onClick={() => wallet.connect()} className="label-mono h-10 rounded-full bg-lime px-5 text-[12px] text-lime-fg">
              Cüzdan bağla
            </button>
          }
        />
      </>
    );
  }

  const loading = campaigns.isLoading || clipsQ.some((q) => q.isLoading);
  const blocks = list
    .map((c, i) => {
      const all = clipsQ[i]?.data ?? [];
      return { c, all, mine: all.filter((v) => v.clip.owner === account), i };
    })
    .filter((b) => b.mine.length > 0);

  const totals: Totals = { earned: 0n, pending: 0n, holdback: 0n };
  for (const b of blocks) {
    for (const v of b.mine) {
      for (let e = 0; e < b.c.params.epochs; e++) {
        const cell = buildCell(b.c, v, b.all, epochsQ[b.i]?.data, disputesQ[b.i]?.data, e, now);
        addTotals(totals, cell, v.epochs[e]);
      }
    }
  }

  return (
    <>
      <PageHeader title="Panelim" description="Kliplerin, dönem durumları ve kazançların. Aksiyonlar yalnızca ilgili aşamada açılır." />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          { k: "Kazanılan", v: totals.earned, hint: "Claim edilen ödemeler ve holdback" },
          { k: "Bekleyen", v: totals.pending, hint: "Claim edilmemiş ya da henüz settle edilmemiş (tahmini)" },
          { k: "Holdback", v: totals.holdback, hint: "Video sonraki dönemde yayındaysa serbest kalır" },
        ].map((t) => (
          <div key={t.k} className="rounded-[20px] border border-border bg-surface p-5 shadow-card" title={t.hint}>
            <p className="label-mono text-[10px] text-muted">{t.k}</p>
            <p className="mt-2 text-2xl">
              <Amount value={t.v} />
            </p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : blocks.length === 0 ? (
        <EmptyState
          title="Henüz klip yok"
          description="Bir kampanyaya katıl, kodunu videonun açıklamasına ekle ve linkini kaydet."
          action={<ButtonLink href="/" variant="outline">Kampanyalara göz at</ButtonLink>}
        />
      ) : (
        <div className="space-y-6">
          {blocks.map((b) => (
            <CampaignBlock
              key={b.c.id.toString()}
              c={b.c}
              mine={b.mine}
              all={b.all}
              epochs={epochsQ[b.i]?.data}
              disputes={disputesQ[b.i]?.data}
              code={partsQ[b.i]?.data?.code ?? null}
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
