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
import { TryRampButton } from "@/components/anchor/TryRampDialog";
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
  if (st.settled) return "Settled";
  if (!canSettle(c.params, e, now)) return `Settleable in ${formatDuration(settleAt(c.params, e) - now)}`;
  if (st.open_disputes > 0) return `${st.open_disputes} open challenge(s) must be resolved first`;
  if (e > 0 && !epochs[e - 1].settled) return "The previous epoch must be settled first";
  return null;
}

function finalizeReason(c: CampaignView, d: Dispute, now: bigint): string | null {
  if (d.status === "Open") return now >= disputeEnd(c.params, d.epoch) ? null : `The response window closes in ${formatDuration(disputeEnd(c.params, d.epoch) - now)}`;
  if (d.status === "Responded") return now >= settleAt(c.params, d.epoch) ? null : "Waiting for the arbiter's decision";
  return "Resolved";
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
        title="Campaign not found"
        description={campaign.error ? errorMessage(campaign.error) : undefined}
        action={<ButtonLink href="/" variant="outline">Back to campaigns</ButtonLink>}
      />
    );
  }

  const p = c.params;
  const isBrand = c.brand === account;
  const eps = epochs.data;
  const spent = eps ? eps.reduce((s, st, e) => s + (st.settled ? st.spent : 0n), 0n) : 0n;
  const lastSettled = eps ? [...eps].reverse().find((st) => st.settled) ?? null : null;
  const refundReason = c.refunded ? "Refund claimed" : canRefund(p, now) ? null : `In ${formatDuration(refundAt(p) - now)}`;

  return (
    <>
      <PageHeader
        title={p.title || `Campaign #${c.id}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            Brand panel · <AddressChip address={c.brand} you={isBrand} />
          </span>
        }
        actions={
          <>
            {isBrand && <TryRampButton kind="deposit" />}
            <ButtonLink href={`/c/${c.id}`} variant="outline">Public page</ButtonLink>
          </>
        }
      />

      {!isBrand && (
        <p className="mb-6 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info">
          You&apos;re not the brand for this campaign, so this panel is read-only. Challenge, settle and refund actions are open to the brand only.
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Total budget" v={<Amount value={p.budget} />} />
        <Stat k="Spent" v={<Amount value={spent} />} hint="Total across settled epochs" />
        <Stat k="Contract balance" v={<Amount value={c.balance} />} hint="Includes unclaimed shares" />
        <Stat k="Carry-over" v={<Amount value={carryIn(lastSettled)} />} hint="Rolls from the last settled epoch into the next one" />
      </div>

      <div className="mb-8">
        <PhaseTimeline params={p} now={now} />
      </div>

      <section className="mb-10">
        <h2 className="display mb-4 text-2xl">Epochs</h2>
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
                    <p className="display text-lg">Epoch {e + 1}</p>
                    <p className="label-mono text-[10px] text-muted">{est.final ? "Settled" : "Estimated"}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between gap-x-4 text-xs text-muted">
                      <span>
                        W <span className="font-mono text-fg">{st.total_weight.toLocaleString("en-US")}</span>
                      </span>
                      <span>
                        rate <Amount value={est.rate} decimals={4} className="text-fg" /> / 1k
                      </span>
                      <span>
                        <Amount value={est.spent} className="text-fg" /> / <Amount value={est.budget} />
                      </span>
                      {st.open_disputes > 0 && <span className="text-warning">{st.open_disputes} open challenges</span>}
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-row" aria-label={`${pct}% of the budget`}>
                      <div className={`h-full rounded-full ${est.final ? "bg-lime" : "bg-lime/50"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                  {isBrand && !st.settled && (
                    <TxButton
                      variant="outline"
                      disabledReason={reason}
                      action={() => settle.mutateAsync(e)}
                      successTitle={`Epoch ${e + 1} settled`}
                      successBody={() => "The rate is final; clippers can claim now."}
                    >
                      Settle epoch
                    </TxButton>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="display mb-4 text-2xl">Clips</h2>
        {!clips.data ? (
          <Skeleton className="h-40" />
        ) : clips.data.length === 0 ? (
          <EmptyState title="No clips yet" />
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-3 font-normal">Clip</th>
                  <th className="px-4 py-3 font-normal">Owner</th>
                  {Array.from({ length: p.epochs }, (_, e) => (
                    <th key={e} className="px-4 py-3 font-normal">
                      Epoch {e + 1}
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
                        ? "No proof for this epoch"
                        : ce.status !== "Active"
                          ? "This clip-epoch already has a challenge"
                          : ce.weight === 0n
                            ? "Weight is 0; no need to challenge"
                            : open
                              ? null
                              : now < proofEnd(p, e)
                                ? `Challenges open in ${formatDuration(proofEnd(p, e) - now)}`
                                : "The challenge window has closed";
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
                                  Challenge
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
        <h2 className="display mb-4 text-2xl">Challenges</h2>
        {!disputes.data ? (
          <Skeleton className="h-24" />
        ) : disputes.data.length === 0 ? (
          <EmptyState title="No challenges" />
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
                        Clip #{d.clip_id.toString()} · Epoch {d.epoch + 1}
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
                      successTitle="Challenge resolved"
                      successBody={() => (d.status === "Open" ? "No response: the clip is excluded and your bond is returned." : "The arbiter window ran out: the clipper wins.")}
                    >
                      Finalize
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
            <h2 className="display text-xl">Refund</h2>
            <p className="mt-1 text-sm text-muted">
              When the claim window ends, unspent budget, forfeited holdback and unclaimed shares go back to the brand. The contract currently holds{" "}
              <Amount value={c.balance} className="text-fg" />.
            </p>
          </div>
          <TxButton
            disabledReason={refundReason}
            action={() => refund.mutateAsync(undefined)}
            successTitle="Refund claimed"
            successBody={(r) => <Amount value={r.amount} />}
          >
            Claim refund
          </TxButton>
        </section>
      )}

      {challengeFor && (
        <ChallengeDialog
          clipLabel={`Clip #${challengeFor.clip.clip.id} · ${PLATFORM_LABEL[challengeFor.clip.clip.platform] ?? challengeFor.clip.clip.platform}`}
          epoch={challengeFor.e}
          bond={p.bond}
          onClose={() => setChallengeFor(null)}
          onSubmit={(evidence) => challenge.mutateAsync({ clipId: challengeFor.clip.clip.id, e: challengeFor.e, evidence })}
        />
      )}
    </>
  );
}
