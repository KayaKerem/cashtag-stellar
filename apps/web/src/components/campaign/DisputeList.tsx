import type { Dispute } from "@cliprail/shared";
import { AddressChip } from "@/components/common/AddressChip";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusPill } from "@/components/common/StatusPill";

export function DisputeList({ disputes }: { disputes: Dispute[] }) {
  if (!disputes.length) {
    return <EmptyState title="İtiraz yok" description="Bot izlenme şüphesi olan klibe teminat yatırılarak itiraz edilebilir." />;
  }
  return (
    <ul className="space-y-3">
      {disputes.map((d) => (
        <li key={d.id.toString()} className="rounded-[20px] border border-border bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">İtiraz #{d.id.toString()}</span>
            <span className="text-sm">
              Klip #{d.clip_id.toString()} · Dönem {d.epoch + 1}
            </span>
            <span className="ml-auto">
              <StatusPill status={d.status} />
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <AddressChip address={d.challenger} label="İtiraz eden" />
          </div>
          {d.evidence && (
            <p className="mt-2 break-words rounded-xl bg-row px-3 py-2 text-sm text-muted">
              {/^https?:\/\//.test(d.evidence) ? (
                <a href={d.evidence} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {d.evidence}
                </a>
              ) : (
                d.evidence
              )}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
