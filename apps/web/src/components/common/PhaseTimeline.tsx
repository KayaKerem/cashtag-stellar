"use client";

import { refundAt, timelineRows, type CampaignParams, type TimelineRow } from "@cliprail/shared";
import { formatDuration, useNow } from "@/lib/hooks/useNow";

const SEG_COLOR: Record<string, string> = {
  content: "bg-lime/70",
  proof: "bg-info/60",
  challenge: "bg-warning/60",
  response: "bg-warning/40",
  arbiter: "bg-danger/40",
};
const SEG_SHORT: Record<string, string> = {
  content: "Content",
  proof: "Proof",
  challenge: "Challenge",
  response: "Response",
  arbiter: "Arbiter",
};

type Params = Pick<
  CampaignParams,
  "start" | "epoch_len" | "epochs" | "proof_window" | "dispute_window" | "arbiter_window" | "claim_grace"
>;

/**
 * Shows epochs as horizontal bars: content -> proof -> challenge -> response -> arbiter, then settle.
 * The active phase is highlighted with a countdown to its end. Without `now`, a live clock is used.
 */
export function PhaseTimeline({ params, now: nowProp, compact }: { params: Params; now?: bigint; compact?: boolean }) {
  const liveNow = useNow();
  const now = nowProp ?? liveNow;
  const rows = timelineRows(params as CampaignParams, now);
  const refund = refundAt(params as CampaignParams);

  // Each epoch: from the start of content to the settle moment
  const epochs = Array.from({ length: params.epochs }, (_, e) => {
    const segs = rows.filter((r) => r.epoch === e && r.phase !== "settleable");
    const settle = rows.find((r) => r.epoch === e && r.phase === "settleable")!;
    return { e, segs, settle, from: segs[0].start, to: settle.start };
  });

  // The most recently started active phase (epochs can overlap; show the newest one)
  const active: TimelineRow | undefined = [...rows]
    .filter((r) => r.active && r.phase !== "settleable" && r.phase !== "refund")
    .sort((a, b) => Number(b.start - a.start))[0];
  const notStarted = now < params.start;
  const refundOpen = now >= refund;

  return (
    <div className="rounded-[20px] border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`size-2 rounded-full ${active ? "pulse-lime bg-lime" : "bg-border-strong"}`} aria-hidden />
        <span className="text-sm font-medium">
          {notStarted
            ? "Campaign hasn't started"
            : refundOpen
              ? "Campaign over · refund open"
              : active
                ? active.label
                : "Settle / claim time"}
        </span>
        <span className="font-mono text-sm tabular text-muted">
          {notStarted
            ? `starts in ${formatDuration(params.start - now)}`
            : active?.end
              ? `${formatDuration(active.end - now)} left`
              : !refundOpen
                ? `refund in ${formatDuration(refund - now)}`
                : ""}
        </span>
      </div>

      <div className="space-y-3">
        {epochs.map(({ e, segs, settle, from, to }) => {
          const total = Number(to - from) || 1;
          const settled = now >= settle.start;
          return (
            <div key={e} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-muted">Epoch {e + 1}</span>
              <div className="flex h-7 flex-1 overflow-hidden rounded-lg bg-row">
                {segs.map((s) => {
                  const w = (Number((s.end ?? s.start) - s.start) / total) * 100;
                  const done = s.end !== null && now >= s.end;
                  const progress = s.active && s.end ? (Number(now - s.start) / Number(s.end - s.start)) * 100 : 0;
                  return (
                    <div
                      key={s.key}
                      style={{ width: `${w}%` }}
                      title={s.label}
                      className={`relative border-r border-bg/60 last:border-r-0 ${done ? SEG_COLOR[s.phase] : ""} ${
                        s.active ? "ring-2 ring-inset ring-fg" : ""
                      }`}
                    >
                      {s.active && (
                        <div className={`absolute inset-y-0 left-0 ${SEG_COLOR[s.phase]}`} style={{ width: `${progress}%` }} />
                      )}
                      {!compact && w > 12 && (
                        <span className="relative z-10 flex h-full items-center px-1.5 text-[10px] font-medium text-fg/80">
                          {SEG_SHORT[s.phase]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <span
                className={`label-mono w-16 shrink-0 text-right text-[10px] ${settled ? "text-fg" : "text-muted"}`}
                title="Settleable from this point on"
              >
                {settled ? "Settle ✓" : "Settle"}
              </span>
            </div>
          );
        })}
      </div>

      {!compact && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted">
          {Object.entries(SEG_SHORT).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${SEG_COLOR[k]}`} aria-hidden />
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
