import Link from "next/link";

type Variant = "primary" | "outline" | "soft";

const base = "label-mono inline-flex items-center justify-center rounded-full text-sm transition";
const variants: Record<Variant, string> = {
  primary: "group h-12 gap-3 bg-ink py-1 pl-5 pr-1 text-ink-fg hover:opacity-90",
  outline: "h-10 border border-border-strong px-5 text-fg hover:bg-surface-2",
  soft: "h-10 bg-surface-2 px-5 text-fg hover:bg-row",
};

function Arrow() {
  return (
    <span className="grid size-10 place-items-center rounded-full bg-lime text-lime-fg transition-transform duration-300 group-hover:rotate-45 dark:bg-ink-fg dark:text-lime" aria-hidden>
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </span>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  children,
  external,
  className = "",
}: {
  href: string;
  variant?: Variant;
  children: React.ReactNode;
  external?: boolean;
  className?: string;
}) {
  const cls = `${base} ${variants[variant]} ${className}`;
  const content = (
    <>
      <span>{children}</span>
      {variant === "primary" && <Arrow />}
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {content}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {content}
    </Link>
  );
}
