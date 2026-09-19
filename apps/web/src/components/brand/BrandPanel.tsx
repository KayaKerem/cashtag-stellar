"use client";

import {
  canChallenge,
  canRefund,
  canSettle,
  carryIn,
  disputeEnd,
  estimateEpoch,
  proofEnd,
  refundAt,
  settleAt,
  type CampaignView,
  type ClipView,
  type Dispute,
  type EpochState,
} from "@cliprail/shared";
import { useState } from "react";
import { AddressChip } from "@/components/common/AddressChip";
import { Amount } from "@/components/common/Amount";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { PhaseTimeline } from "@/components/common/PhaseTimeline";
import { StatusPill } from "@/components/common/StatusPill";
import { TxButton } from "@/components/common/TxButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { useApi } from "@/lib/api/ApiProvider";
import { errorMessage } from "@/lib/api/errors";
import { useCampaign, useClips, useDisputes, useEpochs, useWrite } from "@/lib/api/hooks";
import { formatDuration, useNow } from "@/lib/hooks/useNow";
import { PLATFORM_LABEL, videoUrl } from "@/lib/video";
import { ChallengeDialog } from "./ChallengeDialog";

function Stat({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-[20px] border border-border bg-surface p-5 shadow-card" title={hint}>
      <p className="label-mono text-[10px] text-muted">{k}</p>
      <p className="mt-2 text-2xl">{v}</p>
    </div>
  );
}

function settleReason(c: CampaignView, epochs: EpochState[], e: number, now: bigint): string | null {
  const st = epochs[e];
  if (st.settled) return "Settle edildi";
  if (!canSettle(c.params, e, now)) return `${formatDuration(settleAt(c.params, e) - now)} sonra settle edilebilir`;
  if (st.open_disputes > 0) return `${st.open_disputes} açık itiraz sonuçlanmalı`;
  if (e > 0 && !epochs[e - 1].settled) return "Önce önceki dönem settle edilmeli";
  return null;
}

function finalizeReason(c: CampaignView, d: Dispute, now: bigint): string | null {
  if (d.status === "Open") return now >= disputeEnd(c.params, d.epoch) ? null : `Cevap süresi ${formatDuration(disputeEnd(c.params, d.epoch) - now)} sonra biter`;
  if (d.status === "Responded") return now >= settleAt(c.params, d.epoch) ? null : "Hakem kararı bekleniyor";
  return "Sonuçlandı";
}

export function BrandPanel({ id }: { id: bigint }) {
  const { account } = useApi();
  const now = useNow();
  const campaign = useCampaign(id);
  const c = campaign.data;
  const epochs = useEpochs(id, c?.params.epochs);
  const clips = useClips(id);
  const disputes = useDisputes(id);
  const [challengeFor, setChallengeFor] = useState<{ clip: ClipView; e: number } | null>(null);

  const settle = useWrite((a, e: number) => a.settleEpoch(id, e), { campaignId: id });
  const refund = useWrite((a) => a.refund(id), { campaignId: id });
  const finalize = useWrite((a, disputeId: bigint) => a.finalizeDispute(disputeId), { campaignId: id });
  const challenge = useWrite(
    (a, v: { clipId: bigint; e: number; evidence: string }) => a.challenge(id, v.clipId, v.e, v.evidence),
    { campaignId: id },
  );

  if (campaign.isLoading) return <Skeleton className="h-96" />;
  if (!c) {
    return (
      <EmptyState
        title="Kampanya bulunamadı"
        description={campaign.error ? errorMessage(campaign.error) : undefined}
        action={<ButtonLink href="/" variant="outline">Kampanyalara dön</ButtonLink>}
      />
    );
  }

  const p = c.params;
  const isBrand = c.brand === account;
  const eps = epochs.data;
  const spent = eps ? eps.reduce((s, st, e) => s + (st.settled ? st.spent : 0n), 0n) : 0n;
  const lastSettled = eps ? [...eps].reverse().find((st) => st.settled) ?? null : null;
  const refundReason = c.refunded ? "İade alındı" : canRefund(p, now) ? null : `${formatDuration(refundAt(p) - now)} sonra`;

  return (
    <>
      <PageHeader
        title={p.title || `Kampanya #${c.id}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            Marka paneli · <AddressChip address={c.brand} you={isBrand} />
          </span>
        }
        actions={<ButtonLink href={`/c/${c.id}`} variant="outline">Public sayfa</ButtonLink>}
      />

      {!isBrand && (
        <p className="mb-6 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info">
          Bu kampanyanın markası değilsin; panel salt okunur. İtiraz, settle ve iade aksiyonları yalnızca markaya açık.
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Toplam bütçe" v={<Amount value={p.budget} />} />
        <Stat k="Harcanan" v={<Amount value={spent} />} hint="Settle edilmiş dönemlerin toplamı" />
        <Stat k="Kontrattaki bakiye" v={<Amount value={c.balance} />} hint="Claim edilmemiş paylar dahil" />
        <Stat k="Devreden" v={<Amount value={carryIn(lastSettled)} />} hint="Son settle edilen dönemden sonrakine geçen" />
      </div>

      <div className="mb-8">
        <PhaseTimeline params={p} now={now} />
      </div>

      <section className="mb-10">
        <h2 className="display mb-4 text-2xl">Dönemler</h2>
        {!eps ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-3">
            {eps.map((st, e) => {
              const est = estimateEpoch(p, e, st, e > 0 ? eps[e - 1] : null);
              const pct = est.budget > 0n ? Number((est.spent * 1000n) / est.budget) / 10 : 0;
              const reason = settleReason(c, eps, e, now);
              return (
                <div key={e} className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-center">
                  <div className="w-24 shrink-0">
                    <p className="display text-lg">Dönem {e + 1}</p>
                    <p className="label-mono text-[10px] text-muted">{est.final ? "Settle edildi" : "Tahmini"}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between gap-x-4 text-xs text-muted">
                      <span>
                        W <span className="font-mono text-fg">{st.total_weight.toLocaleString("en-US")}</span>
                      </span>
                      <span>
                        oran <Amount value={est.rate} decimals={4} className="text-fg" /> / 1k
                      </span>
                      <span>
                        <Amount value={est.spent} className="text-fg" /> / <Amount value={est.budget} />
                      </span>
                      {st.open_disputes > 0 && <span className="text-warning">{st.open_disputes} açık itiraz</span>}
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-row" aria-label={`Bütçenin %${pct} kadarı`}>
                      <div className={`h-full rounded-full ${est.final ? "bg-lime" : "bg-lime/50"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                  {isBrand && !st.settled && (
                    <TxButton
                      variant="outline"
                      disabledReason={reason}
                      action={() => settle.mutateAsync(e)}
                      successTitle={`Dönem ${e + 1} settle edildi`}
                      successBody={() => "Oran kesinleşti; clipper'lar claim edebilir."}
                    >
                      Dönemi settle et
                    </TxButton>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="display mb-4 text-2xl">Klipler</h2>
        {!clips.data ? (
          <Skeleton className="h-40" />
        ) : clips.data.length === 0 ? (
          <EmptyState title="Henüz klip yok" />
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-3 font-normal">Klip</th>
                  <th className="px-4 py-3 font-normal">Sahip</th>
                  {Array.from({ length: p.epochs }, (_, e) => (
                    <th key={e} className="px-4 py-3 font-normal">
                      Dönem {e + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clips.data.map((v) => (
                  <tr key={v.clip.id.toString()} className="border-b border-border align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <a href={videoUrl(v.clip.platform, v.clip.video_id)} target="_blank" rel="noreferrer" className="hover:underline">
                        <span className="text-muted">#{v.clip.id.toString()}</span> {PLATFORM_LABEL[v.clip.platform] ?? v.clip.platform}
                      </a>
                      <span className="block max-w-[10rem] truncate font-mono text-[11px] text-muted">{v.clip.video_id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <AddressChip address={v.clip.owner} />
                    </td>
                    {Array.from({ length: p.epochs }, (_, e) => {
                      const ce = v.epochs[e];
                      const open = canChallenge(p, e, now);
                      const why = !ce
                        ? "Bu dönem kanıt yok"
                        : ce.status !== "Active"
                          ? "Bu klip-dönem için itiraz zaten var"
                          : ce.weight === 0n
                            ? "Ağırlık 0; itiraz gereksiz"
                            : open
                              ? null
                              : now < proofEnd(p, e)
                                ? `İtiraz ${formatDuration(proofEnd(p, e) - now)} sonra açılır`
                                : "İtiraz penceresi kapandı";
                      return (
                        <td key={e} className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1.5">
                            {ce ? (
                              <>
                                <span className="font-mono text-xs tabular">w {ce.weight.toLocaleString("en-US")}</span>
                                {ce.status !== "Active" && <StatusPill status={ce.status} />}
                              </>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                            {isBrand && ce && ce.status === "Active" && (
                              <span title={why ?? undefined}>
                                <button
                                  type="button"
                                  disabled={!!why}
                                  onClick={() => setChallengeFor({ clip: v, e })}
                                  className="label-mono h-8 rounded-full border border-danger/40 px-3 text-[10px] text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  İtiraz et
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="display mb-4 text-2xl">İtirazlar</h2>
        {!disputes.data ? (
          <Skeleton className="h-24" />
        ) : disputes.data.length === 0 ? (
          <EmptyState title="İtiraz yok" />
        ) : (
          <ul className="space-y-3">
            {disputes.data.map((d) => {
              const reason = finalizeReason(c, d, now);
              const done = d.status === "ChallengerWon" || d.status === "ClipperWon";
              return (
                <li key={d.id.toString()} className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">#{d.id.toString()}</span>
                      <span className="text-sm">
                        Klip #{d.clip_id.toString()} · Dönem {d.epoch + 1}
                      </span>
                      <StatusPill status={d.status} />
                    </div>
                    {d.evidence && <p className="mt-1.5 truncate text-sm text-muted">{d.evidence}</p>}
                  </div>
                  {!done && (
                    <TxButton
                      variant="outline"
                      disabledReason={reason}
                      action={() => finalize.mutateAsync(d.id)}
                      successTitle="İtiraz sonuçlandı"
                      successBody={() => (d.status === "Open" ? "Cevap gelmedi: klip dışlandı, teminatın iade edildi." : "Hakem süresi doldu: clipper kazandı.")}
                    >
                      Sonuçlandır
                    </TxButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isBrand && (
        <section className="flex flex-col gap-3 rounded-[20px] border border-border bg-panel p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <h2 className="display text-xl">İade</h2>
            <p className="mt-1 text-sm text-muted">
              Claim süresi bitince harcanmayan bütçe, yanan holdback ve claim edilmemiş paylar markaya döner. Şu an kontratta{" "}
              <Amount value={c.balance} className="text-fg" /> var.
            </p>
          </div>
          <TxButton
            disabledReason={refundReason}
            action={() => refund.mutateAsync(undefined)}
            successTitle="İade alındı"
            successBody={(r) => <Amount value={r.amount} />}
          >
            İade al
          </TxButton>
        </section>
      )}

      {challengeFor && (
        <ChallengeDialog
          clipLabel={`Klip #${challengeFor.clip.clip.id} · ${PLATFORM_LABEL[challengeFor.clip.clip.platform] ?? challengeFor.clip.clip.platform}`}
          epoch={challengeFor.e}
          bond={p.bond}
          onClose={() => setChallengeFor(null)}
          onSubmit={(evidence) => challenge.mutateAsync({ clipId: challengeFor.clip.clip.id, e: challengeFor.e, evidence })}
        />
      )}
    </>
  );
}
