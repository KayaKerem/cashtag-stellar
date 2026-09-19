"use client";

import { carryIn, estimateEpoch, type CampaignParams, type EpochState } from "@cliprail/shared";
import { Amount } from "@/components/common/Amount";
import { Skeleton } from "@/components/common/EmptyState";

export function EpochCards({ params, epochs }: { params: CampaignParams; epochs: EpochState[] | undefined }) {
  if (!epochs) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: params.epochs }, (_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {epochs.map((st, e) => {
        const prev = e > 0 ? epochs[e - 1] : null;
        const est = estimateEpoch(params, e, st, prev);
        const carry = carryIn(prev);
        return (
          <article key={e} className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between">
              <h3 className="display text-lg">Epoch {e + 1}</h3>
              <span
                className={`label-mono rounded-full px-2.5 py-1 text-[10px] ${
                  est.final ? "bg-lime text-lime-fg" : "bg-surface-2 text-muted"
                }`}
              >
                {est.final ? "Settled" : "Estimated"}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Total weight (W)</dt>
                <dd className="font-mono tabular">{st.total_weight.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{est.final ? "Effective rate / 1,000 views" : "Estimated rate / 1,000 views"}</dt>
                <dd>
                  <Amount value={est.rate} decimals={4} />
                </dd>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">
                  {est.final ? "Paid this epoch" : "At the current W; moves until settle"} · cap{" "}
                  <Amount value={params.rate_max_per_1k} decimals={4} symbol={null} />
                </p>
              </div>
              <div>
                <dt className="text-xs text-muted">Epoch budget</dt>
                <dd>
                  <Amount value={est.budget} />
                </dd>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">Unspent carries to the next epoch</p>
              </div>
              <div>
                <dt className="text-xs text-muted">{est.final ? "Spent" : "Spend (estimated)"}</dt>
                <dd>
                  <Amount value={est.spent} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Carried in from previous epoch</dt>
                <dd>
                  <Amount value={carry} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Open challenges</dt>
                <dd className="font-mono tabular">{st.open_disputes}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
