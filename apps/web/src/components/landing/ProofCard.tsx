"use client";

import { useEffect, useState } from "react";
import { fmtInt, fmtUsd, useCountUp, useInView, usePrefersReducedMotion } from "@/lib/motion";

type Row = { platform: string; views: number; usdc: number };
type Clipper = { code: string; initials: string; campaign: string; rows: Row[] };

// Örnek veri: kampanya #1'de üç clipper'ın dönem kanıtları
const CLIPPERS: Clipper[] = [
  {
    code: "CR-7K3X9A",
    initials: "7K",
    campaign: "Kampanya #1 · dönem 1",
    rows: [
      { platform: "YouTube", views: 48210, usdc: 38.57 },
      { platform: "demo", views: 12400, usdc: 9.92 },
      { platform: "YouTube", views: 6150, usdc: 4.92 },
    ],
  },
  {
    code: "CR-P2M4QZ",
    initials: "P2",
    campaign: "Kampanya #1 · dönem 1",
    rows: [
      { platform: "demo", views: 31800, usdc: 25.44 },
      { platform: "YouTube", views: 9020, usdc: 7.22 },
      { platform: "demo", views: 2240, usdc: 1.79 },
    ],
  },
  {
    code: "CR-0H8TRW",
    initials: "0H",
    campaign: "Kampanya #2 · dönem 0",
    rows: [
      { platform: "YouTube", views: 50000, usdc: 40.0 },
      { platform: "YouTube", views: 14300, usdc: 11.44 },
      { platform: "demo", views: 870, usdc: 0 },
    ],
  },
];

// Tur: boş → 3 satır sırayla → ödendi → bekle → sonraki clipper
const STEPS = 6;
const STEP_MS = [700, 550, 550, 550, 900, 1900];

export function ProofCard() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);
  const running = inView && !reduced;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), STEP_MS[tick % STEPS]);
    return () => window.clearTimeout(id);
  }, [tick, running]);

  const clipper = CLIPPERS[Math.floor(tick / STEPS) % CLIPPERS.length];
  const step = reduced ? STEPS - 1 : tick % STEPS;
  const shown = Math.min(step, clipper.rows.length);
  const paid = step >= 4;
  const rounds = Math.floor(tick / STEPS) + (paid ? 1 : 0);

  const total = clipper.rows.slice(0, shown).reduce((s, r) => s + r.usdc, 0);
  const totalAnim = useCountUp(total, 450, running);
  const counter = useCountUp(1284 + rounds * 3, 700, running);

  return (
    <div
      ref={ref}
      className="w-full max-w-[368px] rounded-[16.8px] border border-border bg-surface px-[22px] py-[21px] shadow-float"
      aria-label="Örnek kanıt kartı"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-mono text-[11px] text-ink-fg">
          {clipper.initials}
        </span>
        <div key={clipper.code} className="rise-in min-w-0 flex-1">
          <p className="truncate font-mono text-[13px] font-medium">{clipper.code}</p>
          <p className="truncate text-[11px] text-muted">{clipper.campaign}</p>
        </div>
        <span
          className={`label-mono rounded-full px-2.5 py-1 text-[10px] transition-colors duration-300 ${
            paid ? "bg-lime text-lime-fg" : "bg-surface-2 text-muted"
          }`}
        >
          {paid ? "Ödendi" : "Kanıtlanıyor"}
        </span>
      </div>

      <div className="mt-4 space-y-1.5">
        {clipper.rows.map((row, i) => (
          <div
            key={`${clipper.code}-${i}`}
            className="flex h-11 items-center gap-3 rounded-[8.8px] border border-border bg-row px-2.5 text-[12px]"
          >
            {i < shown ? (
              <>
                <span className="rise-in flex items-center gap-1.5 text-muted">
                  <span className={`size-1.5 rounded-full ${row.platform === "demo" ? "bg-info" : "bg-danger"}`} />
                  {row.platform}
                </span>
                <span className="rise-in font-mono text-[11px] text-muted tabular">{fmtInt(row.views)} izl.</span>
                <span className="rise-in ml-auto font-mono font-medium tabular">
                  {row.usdc === 0 ? "min altı" : `$${fmtUsd(row.usdc)}`}
                </span>
              </>
            ) : (
              <span className="h-2 w-24 rounded-full bg-border" aria-hidden />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-border pt-3.5">
        <div className="flex items-end justify-between">
          <span className="text-[11px] text-muted">Dönem payı · USDC</span>
          <span className="font-mono text-xl font-medium tabular">${fmtUsd(totalAnim)}</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted">
          <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-fg">SIG ✓</span>
          <span className="truncate">kanıt kontrat içinde doğrulandı · %20 holdback</span>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between border-t border-border pt-3.5">
        <span className="text-[11px] text-muted">Kabul edilen kanıt</span>
        <span className="font-mono text-lg font-medium tabular">{fmtInt(counter)}</span>
      </div>
    </div>
  );
}
