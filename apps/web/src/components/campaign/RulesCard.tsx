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

/** Kampanya kuralları: kontratta sabit, sonradan değiştirilemez. */
export function RulesCard({ params }: { params: CampaignParams }) {
  return (
    <section className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-xl">Kurallar</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Bu kurallar kontratta sabit, kimse değiştiremez.
          </p>
        </div>
        {CHAIN_CONFIG.cliprailId && (
          <a
            href={explorerContractUrl(CHAIN_CONFIG.cliprailId)}
            target="_blank"
            rel="noreferrer"
            className="label-mono shrink-0 rounded-full border border-border-strong px-3 py-1.5 text-[10px] hover:bg-surface-2"
          >
            Kontrat ↗
          </a>
        )}
      </div>
      <dl className="mt-4">
        <Row k="Toplam bütçe" v={<Amount value={params.budget} />} />
        <Row k="Oran tavanı" v={<><Amount value={params.rate_max_per_1k} /> <span className="text-muted">/ 1000 izlenme</span></>} hint="r_eff = min(tavan, 1000·B/W)" />
        <Row k="Klip başına tavan" v={<span className="font-mono">{n(params.cap_views_clip)} izl. / dönem</span>} />
        <Row k="İnsan başına tavan" v={<span className="font-mono">{n(params.cap_views_human)} izl. / dönem</span>} />
        <Row k="Minimum izlenme" v={<span className="font-mono">{n(params.min_views)}</span>} hint="Bunun altındaki klip-dönem ağırlığı 0 sayılır" />
        <Row k="Dönemler" v={<span className="font-mono">{params.epochs} × {formatDuration(params.epoch_len)}</span>} />
        <Row
          k="Pencereler"
          v={
            <span className="font-mono text-xs">
              kanıt {formatDuration(params.proof_window)} · itiraz {formatDuration(params.dispute_window)} · hakem{" "}
              {formatDuration(params.arbiter_window)}
            </span>
          }
        />
        <Row k="Holdback" v={<span className="font-mono">%{params.holdback_bps / 100}</span>} hint="Video sonraki dönemde yayındaysa serbest kalır; son dönemde uygulanmaz" />
        <Row k="İtiraz teminatı" v={<Amount value={params.bond} />} />
        <Row k="Hakem" v={<AddressChip address={params.arbiter} />} />
        <Row k="Platformlar" v={params.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")} />
        <Row k="Tek insan zorunlu" v={params.require_humanity ? "Evet" : "Hayır"} />
      </dl>
    </section>
  );
}
