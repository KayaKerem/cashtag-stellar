export function CheckDot({ className = "" }: { className?: string }) {
  return (
    <span className={`grid size-[18px] shrink-0 place-items-center rounded-full bg-lime text-lime-fg ${className}`} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  );
}

/** Beyaz pill + lime tik (hero altındaki özellik çipleri) */
export function FeatureChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium shadow-chip">
      <CheckDot />
      {children}
    </span>
  );
}

/** Küçük etiket çipi (hero üstü) */
export function TagChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] font-medium shadow-chip">
      {children}
    </span>
  );
}
