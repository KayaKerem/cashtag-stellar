"use client";

import { fmtUsd, useCountUp, useInView, useLoop, usePrefersReducedMotion } from "@/lib/motion";
import { VizFooter, VizHeader, VizShell } from "./VizHeader";

// Kampanya yaşam döngüsü; aktif aşama kayar, kart o aşamanın örneğini gösterir
const PHASES = ["İçerik", "Kanıt", "İtiraz", "Settle", "Claim", "Holdback", "İade"] as const;
const SAMPLES = [
  { code: "CR-7K3X9A", initials: "7K", pay: 42.8 },
  { code: "CR-P2M4QZ", initials: "P2", pay: 27.36 },
  { code: "CR-0H8TRW", initials: "0H", pay: 41.15 },
];

export function ClaimCard() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const running = inView && !reduced;
  const tick = useLoop(PHASES.length * SAMPLES.length, 1400, running);
  const phase = reduced ? 4 : tick % PHASES.length;
  const sample = SAMPLES[Math.floor(tick / PHASES.length) % SAMPLES.length];

  const immediate = sample.pay * 0.8;
  const held = sample.pay - immediate;
  const payAnim = useCountUp(sample.pay, 600, running);
  const claimed = useCountUp(412.5 + (phase >= 4 ? immediate : 0), 600, running);

  return (
    <VizShell>
      <div ref={ref}>
        <VizHeader label="Claim · clipper payı" badge="USDC" />
        <div key={sample.code} className="rise-in mt-4 rounded-xl border border-border bg-surface p-3 shadow-chip">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lime font-mono text-[10px] text-lime-fg">
              {sample.initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-[12px] font-medium">{sample.code}</span>
              <span className="block text-[10px] text-muted">dönem 1 · settle edildi</span>
            </span>
            <span className="ml-auto font-mono text-xl font-medium tabular">${fmtUsd(payAnim)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-2.5">
            <div>
              <p className="label-mono text-[9px] text-muted">Hemen · 80%</p>
              <p className="font-mono text-[12px] font-medium tabular">${fmtUsd(immediate)}</p>
            </div>
            <div className="text-right">
              <p className="label-mono text-[9px] text-muted">Holdback · 20%</p>
              <p className="font-mono text-[12px] font-medium tabular">${fmtUsd(held)}</p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PHASES.map((p, i) => (
            <span
              key={p}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors duration-300 ${
                i === phase ? "border-transparent bg-lime font-medium text-lime-fg" : "border-border bg-row text-muted"
              }`}
            >
              {p}
            </span>
          ))}
        </div>
        <VizFooter label="Claim edilen" value={`$${fmtUsd(claimed)}`} />
      </div>
    </VizShell>
  );
}
