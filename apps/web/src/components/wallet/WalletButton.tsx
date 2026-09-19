"use client";

import { explorerAccountUrl, shortAddress } from "@cliprail/shared";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";

export function WalletButton({ className = "" }: { className?: string }) {
  const { ready, connected, address, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!connected || !address) {
    return (
      <button
        type="button"
        onClick={() => connect()}
        disabled={!ready}
        className={`label-mono h-10 rounded-full bg-lime px-5 text-sm text-lime-fg transition hover:opacity-90 disabled:opacity-60 ${className}`}
      >
        Connect wallet
      </button>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border-strong bg-surface pl-1.5 pr-3.5 font-mono text-[13px] transition hover:bg-surface-2"
      >
        <span className="grid size-7 place-items-center rounded-full bg-lime text-[10px] text-lime-fg" aria-hidden>
          {address.slice(1, 3)}
        </span>
        {shortAddress(address)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-border bg-surface p-2 shadow-float"
        >
          <p className="px-2.5 pb-2 pt-1.5 font-mono text-[11px] break-all text-muted">{address}</p>
          <button type="button" role="menuitem" onClick={copy} className="w-full rounded-xl px-2.5 py-2 text-left text-sm hover:bg-surface-2">
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          <a
            role="menuitem"
            href={explorerAccountUrl(address)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl px-2.5 py-2 text-sm hover:bg-surface-2"
          >
            View on stellar.expert ↗
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await disconnect();
            }}
            className="w-full rounded-xl px-2.5 py-2 text-left text-sm text-danger hover:bg-danger-soft"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
