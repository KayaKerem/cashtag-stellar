"use client";

import { CheckDot } from "@/components/ui/Chip";
import { fmtInt, useCountUp, useInView, useLoop, usePrefersReducedMotion } from "@/lib/motion";
import { VizFooter, VizHeader, VizShell } from "./VizHeader";

// reclaim-verify adımları (ARCHITECTURE §8.2)
const STEPS = [
  { title: "Attestor imzası", meta: "secp256k1 · keccak", tag: "SIG" },
  { title: "URL şablonu", meta: "youtube · video_id", tag: "URL" },
  { title: "Kod açıklamada", meta: "CR-7K3X9A · bulundu", tag: "CODE" },
  { title: "İzlenme → ağırlık", meta: "48,210 − baseline", tag: "VIEWS" },
];

export function ProofStepsCard() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const running = inView && !reduced;
  // 0: boş, 1..4: adım tiklenir, 5: %100'de bekle
  const step = useLoop(STEPS.length + 2, [700, 800, 800, 800, 800, 2000], running);
  const done = reduced ? STEPS.length : Math.min(step, STEPS.length);
  const pct = useCountUp((done / STEPS.length) * 100, 500, running);
  const accepted = useCountUp(1284 + (done === STEPS.length ? 1 : 0), 400, running);

  return (
    <VizShell>
      <div ref={ref}>
        <VizHeader label="Kanıt doğrulama · kontrat içinde" badge="Soroban" />
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-row">
            <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-9 text-right font-mono text-[11px] tabular">{Math.round(pct)}%</span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {STEPS.map((s, i) => {
            const ok = i < done;
            return (
              <li
                key={s.tag}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors duration-300 ${
                  ok ? "border-border bg-lime/20" : "border-border bg-row"
                }`}
              >
                {ok ? (
                  <CheckDot className="pop-in" />
                ) : (
                  <span className="size-[18px] shrink-0 rounded-full border border-border-strong" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{s.title}</span>
                  <span className="block truncate font-mono text-[10px] text-muted">{s.meta}</span>
                </span>
                <span
                  className={`label-mono rounded-full px-2 py-0.5 text-[9px] transition-colors duration-300 ${
                    ok ? "bg-lime text-lime-fg" : "bg-surface-2 text-muted"
                  }`}
                >
                  {s.tag}
                </span>
              </li>
            );
          })}
        </ul>
        <VizFooter label="Kabul edilen kanıt" value={fmtInt(accepted)} />
      </div>
    </VizShell>
  );
}
