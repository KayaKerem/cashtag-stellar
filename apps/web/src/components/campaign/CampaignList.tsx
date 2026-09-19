"use client";

import { currentEpoch, formatUsdc, phaseOf, type CampaignView } from "@cliprail/shared";
import Link from "next/link";
import { useCampaigns } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/errors";

const PHASE_TEXT: Record<string, string> = {
  upcoming: "Not started",
  content: "Content",
  proof: "Proof",
  challenge: "Challenge",
  response: "Response",
  arbiter: "Arbiter",
  settleable: "Settle",
};

function status(c: CampaignView, now: bigint) {
  if (c.refunded) return { label: "Finished", live: false };
  const e = Math.min(currentEpoch(c.params, now), c.params.epochs - 1);
  const phase = phaseOf(c.params, e, now);
  return { label: `Epoch ${e + 1}/${c.params.epochs} · ${PHASE_TEXT[phase] ?? phase}`, live: phase !== "upcoming" };
}

export function CampaignList() {
  const { data, isLoading, error } = useCampaigns();
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-44 animate-pulse rounded-[20px] bg-panel" />
        ))}
      </div>
    );
  }
  if (error) {
    return <p className="rounded-[20px] bg-danger-soft p-6 text-sm text-danger">{errorMessage(error)}</p>;
  }
  if (!data?.length) {
    return (
      <div className="rounded-[20px] border border-dashed border-border-strong bg-panel p-10 text-center text-sm text-muted">
        No campaigns yet.{" "}
        <Link href="/brand/new" className="text-fg underline underline-offset-4">
          Create the first one
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((c) => {
        const s = status(c, now);
        return (
          <Link
            key={c.id.toString()}
            href={`/c/${c.id}`}
            className="group flex flex-col rounded-[20px] border border-border bg-surface p-5 shadow-card transition hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${s.live ? "pulse-lime bg-lime" : "bg-border-strong"}`} aria-hidden />
              <span className="label-mono text-[10px] text-muted">{s.label}</span>
              <span className="ml-auto font-mono text-xs text-muted">#{c.id.toString()}</span>
            </div>
            <h3 className="display mt-4 line-clamp-2 text-xl leading-snug">{c.params.title || `Campaign #${c.id}`}</h3>
            <dl className="mt-auto grid grid-cols-3 gap-2 pt-6 text-xs">
              <div>
                <dt className="text-muted">Budget</dt>
                <dd className="font-mono text-sm tabular">{formatUsdc(c.params.budget, { maxDecimals: 2, group: "," })}</dd>
              </div>
              <div>
                <dt className="text-muted">Remaining</dt>
                <dd className="font-mono text-sm tabular">{formatUsdc(c.balance, { maxDecimals: 2, group: "," })}</dd>
              </div>
              <div className="text-right">
                <dt className="text-muted">Participants · clips</dt>
                <dd className="font-mono text-sm tabular">
                  {c.participants} · {c.clips}
                </dd>
              </div>
            </dl>
          </Link>
        );
      })}
    </div>
  );
}
