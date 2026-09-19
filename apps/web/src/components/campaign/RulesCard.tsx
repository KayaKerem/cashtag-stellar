import { explorerContractUrl, type CampaignParams } from "@cliprail/shared";
import { Amount } from "@/components/common/Amount";
import { AddressChip } from "@/components/common/AddressChip";
import { CHAIN_CONFIG } from "@/lib/api/config";
import { formatDuration } from "@/lib/hooks/useNow";
import { PLATFORM_LABEL } from "@/lib/video";

const n = (v: bigint) => v.toLocaleString("en-US");

function Row({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-muted" title={hint}>
        {k}
      </dt>
      <dd className="text-right text-sm">{v}</dd>
    </div>
  );
}

/** Campaign rules: fixed in the contract and unchangeable afterwards. */
export function RulesCard({ params }: { params: CampaignParams }) {
  return (
    <section className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-xl">Rules</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            These rules are fixed in the contract. No one can change them.
          </p>
        </div>
        {CHAIN_CONFIG.cliprailId && (
          <a
            href={explorerContractUrl(CHAIN_CONFIG.cliprailId)}
            target="_blank"
            rel="noreferrer"
            className="label-mono shrink-0 rounded-full border border-border-strong px-3 py-1.5 text-[10px] hover:bg-surface-2"
          >
            Contract ↗
          </a>
        )}
      </div>
      <dl className="mt-4">
        <Row k="Total budget" v={<Amount value={params.budget} />} />
        <Row k="Rate cap" v={<><Amount value={params.rate_max_per_1k} /> <span className="text-muted">/ 1,000 views</span></>} hint="r_eff = min(cap, 1000·B/W)" />
        <Row k="Cap per clip" v={<span className="font-mono">{n(params.cap_views_clip)} views / epoch</span>} />
        <Row k="Cap per human" v={<span className="font-mono">{n(params.cap_views_human)} views / epoch</span>} />
        <Row k="Minimum views" v={<span className="font-mono">{n(params.min_views)}</span>} hint="A clip-epoch below this counts as weight 0" />
        <Row k="Epochs" v={<span className="font-mono">{params.epochs} × {formatDuration(params.epoch_len)}</span>} />
        <Row
          k="Windows"
          v={
            <span className="font-mono text-xs">
              proof {formatDuration(params.proof_window)} · challenge {formatDuration(params.dispute_window)} · arbiter{" "}
              {formatDuration(params.arbiter_window)}
            </span>
          }
        />
        <Row k="Holdback" v={<span className="font-mono">%{params.holdback_bps / 100}</span>} hint="Released if the video is still live in the next epoch; not applied in the last epoch" />
        <Row k="Challenge bond" v={<Amount value={params.bond} />} />
        <Row k="Arbiter" v={<AddressChip address={params.arbiter} />} />
        <Row k="Platforms" v={params.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")} />
        <Row k="Human verification" v={params.require_humanity ? "Required" : "Not required"} />
      </dl>
    </section>
  );
}
