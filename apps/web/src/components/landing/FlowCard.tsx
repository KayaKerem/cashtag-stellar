"use client";

import { fmtInt, useCountUp, useInView, useLoop, usePrefersReducedMotion } from "@/lib/motion";
import { VizFooter, VizHeader, VizShell } from "./VizHeader";

// Dönemin klip ağırlıkları (w_clip); hepsi tek W_e'de birleşir
const SOURCES = [
  { code: "CR-7K3X9A", platform: "YouTube", weight: 18200 },
  { code: "CR-P2M4QZ", platform: "demo", weight: 9600 },
  { code: "CR-0H8TRW", platform: "YouTube", weight: 50000 },
  { code: "CR-4NDL2C", platform: "demo", weight: 4150 },
  { code: "CR-X91BQE", platform: "YouTube", weight: 2700 },
];
const BUDGET = 250; // bu dönemin bütçesi (USDC)
const RATE_MAX = 1; // 1000 izlenme başına tavan

const ROW_H = 36;
const GAP = 6;

export function FlowCard() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const running = inView && !reduced;
  // 0..4: kaynaklar sırayla birleşir, 5: bekleme
  const step = useLoop(SOURCES.length + 2, [900, 900, 900, 900, 900, 1800, 900], running);
  const merged = reduced ? SOURCES.length : Math.min(step, SOURCES.length);

  const W = SOURCES.slice(0, merged).reduce((s, x) => s + x.weight, 0);
  const wAnim = useCountUp(W, 600, running);
  const rate = W === 0 ? 0 : Math.min(RATE_MAX, (1000 * BUDGET) / W);

  const h = SOURCES.length * ROW_H + (SOURCES.length - 1) * GAP;
  const targetY = h / 2;

  return (
    <VizShell>
      <div ref={ref}>
        <VizHeader label="Dönem 1 · ağırlıklar birleşiyor" badge="Canlı" />
        <div className="relative mt-4" style={{ height: h }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden>
            {SOURCES.map((s, i) => {
              const y = i * (ROW_H + GAP) + ROW_H / 2;
              const on = i < merged;
              return (
                <path
                  key={s.code}
                  d={`M 44 ${y} C 56 ${y}, 56 ${targetY}, 66 ${targetY}`}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  className={on ? "dash-flow" : ""}
                  stroke={on ? "var(--fg)" : "var(--border-strong)"}
                  strokeWidth={on ? 1.4 : 1}
                  style={{ transition: "stroke 300ms" }}
                />
              );
            })}
          </svg>

          <div className="relative flex w-[46%] flex-col" style={{ gap: GAP }}>
            {SOURCES.map((s, i) => {
              const on = i < merged;
              return (
                <div
                  key={s.code}
                  className={`flex items-center gap-2 rounded-lg border px-2 text-[11px] transition-colors duration-300 ${
                    on ? "border-border bg-lime/25" : "border-border bg-row"
                  }`}
                  style={{ height: ROW_H }}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${on ? "bg-fg" : "bg-border-strong"}`} />
                  <span className="truncate font-mono">{s.code}</span>
                  <span className="ml-auto font-mono tabular text-muted">{fmtInt(s.weight / 1000)}k</span>
                </div>
              );
            })}
          </div>

          <div className="absolute right-0 top-1/2 w-[36%] -translate-y-1/2 rounded-xl border border-border bg-surface p-2.5 shadow-chip">
            <p className="label-mono text-[9px] text-muted">W · dönem ağırlığı</p>
            <p className="mt-1 font-mono text-lg font-medium leading-none tabular">{fmtInt(wAnim)}</p>
            <p className="mt-1.5 text-[10px] leading-tight text-muted">
              r<sub>eff</sub> = {rate.toFixed(2)} USDC / 1k
            </p>
          </div>
        </div>
        <VizFooter label="Dönem bütçesi" value={`$${BUDGET}.00`} />
      </div>
    </VizShell>
  );
}
