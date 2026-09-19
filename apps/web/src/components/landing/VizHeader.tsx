export function VizHeader({ label, badge }: { label: string; badge: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="pulse-lime size-2 rounded-full bg-lime" aria-hidden />
      <span className="truncate text-[12px] text-muted">{label}</span>
      <span className="label-mono ml-auto shrink-0 rounded-full bg-lime px-2 py-0.5 text-[9px] text-lime-fg">{badge}</span>
    </div>
  );
}

export function VizFooter({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-end justify-between border-t border-border pt-3.5">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="font-mono text-lg font-medium tabular">{value}</span>
    </div>
  );
}

/** Mockup kabuğu: beyaz iç kart */
export function VizShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[16.8px] border border-border bg-surface px-[22px] py-[21px] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ${className}`}>
      {children}
    </div>
  );
}
