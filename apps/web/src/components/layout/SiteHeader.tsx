"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_ITEMS, isActive } from "./nav";
import { AttestorBadge } from "./AttestorBadge";
import { NetworkBadge } from "./NetworkBadge";
import { WalletButton } from "@/components/wallet/WalletButton";
import { ThemeToggle } from "./ThemeToggle";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-ink text-ink-fg" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M4 8h16M4 16h16M8 4v16M16 4v16" />
        </svg>
      </span>
      ClipRail
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex" aria-label="Ana menü">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-3.5 py-2 text-[15px] transition ${
                isActive(pathname, item.href) ? "bg-surface-2 text-fg" : "text-fg/80 hover:text-fg"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-2 lg:inline-flex">
            <NetworkBadge />
            <AttestorBadge />
          </span>
          <ThemeToggle />
          <WalletButton className="hidden sm:block" />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menü"
            aria-expanded={open}
            className="inline-flex size-10 items-center justify-center rounded-full border border-border-strong md:hidden"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-border px-4 py-3 md:hidden" aria-label="Mobil menü">
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-2.5 text-[15px] ${
                  isActive(pathname, item.href) ? "bg-surface-2" : "text-muted"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap gap-2">
              <NetworkBadge />
              <AttestorBadge />
            </span>
            <WalletButton />
          </div>
        </nav>
      )}
    </header>
  );
}
