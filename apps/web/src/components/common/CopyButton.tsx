"use client";

import { useState } from "react";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return { copied, copy };
}

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className={`label-mono rounded-full border border-border-strong px-3 py-1.5 text-[11px] transition hover:bg-surface-2 ${className}`}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
