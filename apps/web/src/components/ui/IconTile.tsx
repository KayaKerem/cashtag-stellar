export function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid size-10 place-items-center rounded-[10px] bg-lime text-lime-fg" aria-hidden>
      {children}
    </span>
  );
}
