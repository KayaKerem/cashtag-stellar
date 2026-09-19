"use client";

import { canJoin } from "@cliprail/shared";
import { AddressChip } from "@/components/common/AddressChip";
import { HumanStep, ZkDoneCard, type ZkResult } from "./HumanStep";
import { CodeBadge } from "@/components/common/CodeBadge";
import { CopyButton } from "@/components/common/CopyButton";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { TxButton } from "@/components/common/TxButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { CheckDot } from "@/components/ui/Chip";
import { useApi } from "@/lib/api/ApiProvider";
import { errorMessage } from "@/lib/api/errors";
import { useCampaign, useIsHuman, useParticipant, useWrite } from "@/lib/api/hooks";
import { useNow } from "@/lib/hooks/useNow";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useState } from "react";

type StepState = "done" | "current" | "locked";

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children?: React.ReactNode;
}) {
  return (
    <li
      className={`rounded-[20px] border p-5 transition ${
        state === "current" ? "border-fg bg-surface shadow-card" : "border-border bg-surface"
      } ${state === "locked" ? "opacity-55" : ""}`}
    >
      <div className="flex items-center gap-3">
        {state === "done" ? (
          <CheckDot className="size-7" />
        ) : (
          <span
            className={`grid size-7 place-items-center rounded-full font-mono text-xs ${
              state === "current" ? "bg-ink text-ink-fg" : "bg-surface-2 text-muted"
            }`}
          >
            {n}
          </span>
        )}
        <h2 className="display text-lg">{title}</h2>
      </div>
      {children && <div className="mt-4 pl-10">{children}</div>}
    </li>
  );
}

export function JoinFlow({ id }: { id: bigint }) {
  const { api, account, mode } = useApi();
  const wallet = useWallet();
  const now = useNow();
  const campaign = useCampaign(id);
  const human = useIsHuman(id, account);
  const participant = useParticipant(id, account);
  const join = useWrite((a, cid: bigint) => a.join(cid), { campaignId: id });
  const [zkResult, setZkResult] = useState<ZkResult | null>(null);

  if (campaign.isLoading) return <Skeleton className="h-96" />;
  const c = campaign.data;
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
  const walletOk = mode === "chain" ? wallet.connected && !!account : !!account;
  const needsHuman = p.require_humanity;
  const isHuman = !needsHuman || human.data === true;
  const joined = participant.data ?? null;
  const open = canJoin(p, now) && !c.refunded;

  const s1: StepState = walletOk ? "done" : "current";
  const humanLoading = walletOk && needsHuman && human.isLoading;
  const partLoading = walletOk && participant.isLoading;
  const s2: StepState = !walletOk ? "locked" : isHuman ? "done" : "current";
  const s3: StepState = joined ? "done" : walletOk && isHuman ? "current" : "locked";

  const sampleDesc = joined
    ? `#ad A clip made for ${p.title}. ClipRail code: ${joined.code}`
    : "";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Join the campaign"
        description={
          <>
            <span className="text-fg">{p.title || `Campaign #${c.id}`}</span> · join in three steps, get your code,
            and add it to your video description.
          </>
        }
      />

      {!open && !joined && (
        <p className="mb-5 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
          Joining is closed for this campaign: the content phase of the last epoch is over, so no new participants are accepted.
        </p>
      )}

      <ol className="space-y-3">
        <Step n={1} title="Connect your wallet" state={s1}>
          {walletOk && account ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <AddressChip address={account} you />
              {mode === "mock" && !wallet.connected && <span className="text-muted">Mock role (change it at the bottom right)</span>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => wallet.connect()}
              className="label-mono h-10 rounded-full bg-lime px-5 text-[12px] text-lime-fg hover:opacity-90"
            >
              Connect wallet
            </button>
          )}
        </Step>

        <Step n={2} title="Human verification" state={s2}>
          {!needsHuman ? (
            <p className="text-sm text-muted">This campaign doesn&apos;t require human verification.</p>
          ) : humanLoading ? (
            <Skeleton className="h-24" />
          ) : s2 === "done" ? (
            zkResult ? (
              <ZkDoneCard result={zkResult} />
            ) : (
              <p className="text-sm text-muted">You&apos;re already registered as a unique human for this campaign.</p>
            )
          ) : s2 === "current" ? (
            <HumanStep campaignId={id} onZkDone={setZkResult} />
          ) : (
            <p className="text-sm text-muted">Connect your wallet first.</p>
          )}
        </Step>

        <Step n={3} title="Join and get your code" state={s3}>
          {partLoading || humanLoading ? (
            <Skeleton className="h-10 w-32" />
          ) : joined ? (
            <div className="space-y-4">
              <CodeBadge code={joined.code} />
              <div className="rounded-2xl bg-panel p-4 text-sm">
                <p className="font-medium">Add this code to your video description</p>
                <p className="mt-1 text-muted">
                  The proof looks for this code in the description. Without it, the clip is rejected. Add #ad to disclose the promotion.
                </p>
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-surface p-3">
                  <p className="min-w-0 flex-1 break-words font-mono text-xs">{sampleDesc}</p>
                  <CopyButton text={sampleDesc} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/c/${c.id}/register`}>Register your clip</ButtonLink>
                <ButtonLink href={`/c/${c.id}`} variant="outline">
                  Campaign page
                </ButtonLink>
              </div>
            </div>
          ) : s3 === "current" ? (
            <TxButton
              action={() => join.mutateAsync(id)}
              successTitle="You joined the campaign"
              successBody={(r) => `Your code: ${r.code}`}
              disabledReason={open ? null : "Joining is closed"}
            >
              Join
            </TxButton>
          ) : (
            <p className="text-sm text-muted">Complete the previous steps first.</p>
          )}
        </Step>
      </ol>
    </div>
  );
}
