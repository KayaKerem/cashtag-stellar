"use client";

import { canJoin, currentEpoch } from "@cliprail/shared";
import { AddressChip } from "@/components/common/AddressChip";
import { CodeBadge } from "@/components/common/CodeBadge";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { PhaseTimeline } from "@/components/common/PhaseTimeline";
import { ButtonLink } from "@/components/ui/Button";
import { useApi } from "@/lib/api/ApiProvider";
import { errorMessage } from "@/lib/api/errors";
import { useCampaign, useClips, useDisputes, useEpochs, useParticipant } from "@/lib/api/hooks";
import { useNow } from "@/lib/hooks/useNow";
import { ClipsTable } from "./ClipsTable";
import { DisputeList } from "./DisputeList";
import { EpochCards } from "./EpochCards";
import { RulesCard } from "./RulesCard";

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="display mb-4 flex items-baseline gap-2 text-2xl">
      {children}
      {count !== undefined && <span className="font-mono text-sm text-muted">{count}</span>}
    </h2>
  );
}

export function CampaignPage({ id }: { id: bigint }) {
  const { account } = useApi();
  const now = useNow();
  const campaign = useCampaign(id);
  const c = campaign.data;
  const epochs = useEpochs(id, c?.params.epochs);
  const clips = useClips(id);
  const disputes = useDisputes(id);
  const me = useParticipant(id, account);

  if (campaign.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (campaign.error || !c) {
    return (
      <EmptyState
        title="Campaign not found"
        description={campaign.error ? errorMessage(campaign.error) : undefined}
        action={<ButtonLink href="/" variant="outline">Back to campaigns</ButtonLink>}
      />
    );
  }

  const p = c.params;
  const joinOpen = canJoin(p, now) && !c.refunded;
  const joined = !!me.data;
  const e = Math.min(currentEpoch(p, now), p.epochs - 1);

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="label-mono text-[11px] text-muted">Campaign #{c.id.toString()}</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">{p.title || `Campaign #${c.id}`}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <AddressChip address={c.brand} label="Brand" you={c.brand === account} />
            {p.brief_url && (
              <a href={p.brief_url} target="_blank" rel="noreferrer" className="text-muted underline underline-offset-4 hover:text-fg">
                Brief / source video ↗
              </a>
            )}
            <span className="text-muted">
              {c.participants} participants · {c.clips} clips
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {joined && joinOpen ? (
            <ButtonLink href={`/c/${c.id}/register`}>Register clip</ButtonLink>
          ) : joinOpen ? (
            <ButtonLink href={`/c/${c.id}/join`}>Join</ButtonLink>
          ) : null}
          {joined && (
            <ButtonLink href="/me" variant="outline">
              My dashboard
            </ButtonLink>
          )}
          {c.brand === account && (
            <ButtonLink href={`/brand/${c.id}`} variant="outline">
              Brand panel
            </ButtonLink>
          )}
        </div>
      </header>

      {joined && me.data && (
        <div className="flex flex-col gap-3 rounded-[20px] border border-border bg-panel p-4 sm:flex-row sm:items-center">
          <p className="text-sm">
            You&apos;re in. Add this code to your video description, then register the link:
          </p>
          <div className="sm:ml-auto">
            <CodeBadge code={me.data.code} size="sm" />
          </div>
        </div>
      )}

      <PhaseTimeline params={p} now={now} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <RulesCard params={p} />
        <div>
          <SectionTitle>Epochs</SectionTitle>
          <EpochCards params={p} epochs={epochs.data} />
          <p className="mt-3 text-xs text-muted">
            Currently in epoch {e + 1}. The rate is a cap, not a fixed price: an epoch pays min(cap, 1,000 × epoch budget ÷ W), so extra
            reach shares the epoch budget pro-rata instead of adding to it. Before settle it is an estimate at the current W; unspent budget
            carries to the next epoch and is refunded to the brand at the end.
          </p>
        </div>
      </div>

      <section>
        <SectionTitle count={clips.data?.length}>Clips</SectionTitle>
        {clips.data ? <ClipsTable clips={clips.data} epochs={p.epochs} me={account} /> : <Skeleton className="h-40" />}
      </section>

      <section>
        <SectionTitle count={disputes.data?.length}>Challenges</SectionTitle>
        {disputes.data ? <DisputeList disputes={disputes.data} /> : <Skeleton className="h-24" />}
      </section>
    </div>
  );
}
