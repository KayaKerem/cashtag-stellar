export function NetworkBadge() {
  return (
    <span className="label-mono inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3 py-1.5 text-[11px] text-fg/80">
      <span className="size-1.5 rounded-full bg-warning" aria-hidden />
      Testnet
    </span>
  );
}
