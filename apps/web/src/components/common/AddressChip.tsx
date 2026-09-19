"use client";

import { explorerAddressUrl, shortAddress } from "@cliprail/shared";
import { useCopy } from "./CopyButton";

export function AddressChip({ address, label, you }: { address: string; label?: string; you?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pl-2.5 pr-1 font-mono text-xs">
      {label && <span className="font-sans text-muted">{label}</span>}
      <a href={explorerAddressUrl(address)} target="_blank" rel="noreferrer" title={address} className="hover:underline">
        {shortAddress(address)}
      </a>
      {you && <span className="rounded-full bg-lime px-1.5 font-sans text-[10px] text-lime-fg">sen</span>}
      <button
        type="button"
        onClick={() => copy(address)}
        aria-label="Adresi kopyala"
        className="grid size-5 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg"
      >
        {copied ? "✓" : (
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </span>
  );
}
