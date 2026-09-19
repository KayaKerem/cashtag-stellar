export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="label-mono inline-flex items-center gap-2.5 text-[13px] text-fg sm:text-sm">
      <span className="size-1.5 bg-fg" aria-hidden />
      {children}
    </p>
  );
}
