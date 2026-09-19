"use client";

import type { ClipView } from "@cliprail/shared";
import { AddressChip } from "@/components/common/AddressChip";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusPill } from "@/components/common/StatusPill";
import { PLATFORM_LABEL, videoUrl } from "@/lib/video";

const n = (v: bigint) => v.toLocaleString("en-US");

export function ClipsTable({ clips, epochs, me }: { clips: ClipView[]; epochs: number; me: string | null }) {
  if (!clips.length) {
    return <EmptyState title="No clips yet" description="Clips show up here as clippers register them." />;
  }
  return (
    <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-3 font-normal">Clip</th>
            <th className="px-4 py-3 font-normal">Owner</th>
            <th className="px-4 py-3 text-right font-normal">Baseline</th>
            {Array.from({ length: epochs }, (_, e) => (
              <th key={e} className="px-4 py-3 text-right font-normal">
                Epoch {e + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clips.map(({ clip, epochs: ces }) => (
            <tr key={clip.id.toString()} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3">
                <a
                  href={videoUrl(clip.platform, clip.video_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <span className={`size-1.5 rounded-full ${clip.platform === "youtube" ? "bg-danger" : "bg-info"}`} aria-hidden />
                  <span className="text-muted">#{clip.id.toString()}</span>
                  {PLATFORM_LABEL[clip.platform] ?? clip.platform}
                  <span className="max-w-[9rem] truncate font-mono text-xs text-muted">{clip.video_id}</span>
                </a>
              </td>
              <td className="px-4 py-3">
                <AddressChip address={clip.owner} you={clip.owner === me} />
              </td>
              <td className="px-4 py-3 text-right font-mono tabular">{n(clip.baseline)}</td>
              {Array.from({ length: epochs }, (_, e) => {
                const ce = ces[e];
                return (
                  <td key={e} className="px-4 py-3 text-right">
                    {ce ? (
                      <span className="inline-flex flex-col items-end gap-1">
                        <span className="font-mono tabular">{n(ce.weight)}</span>
                        {ce.status !== "Active" && <StatusPill status={ce.status} />}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
