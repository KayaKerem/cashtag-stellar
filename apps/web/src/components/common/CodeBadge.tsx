"use client";

import { useCopy } from "./CopyButton";

/** Join code: large, copied in a single tap. */
export function CodeBadge({ code, size = "lg" }: { code: string; size?: "sm" | "lg" }) {
  const { copied, copy } = useCopy();
  if (size === "sm") {
    return (
      <button
        type="button"
        onClick={() => copy(code)}
        title="Copy"
        className="rounded-md border border-border bg-lime/30 px-1.5 py-0.5 font-mono text-xs"
      >
        {copied ? "copied ✓" : code}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => copy(code)}
      className="group flex w-full flex-col items-center gap-2 rounded-[20px] border-2 border-dashed border-border-strong bg-lime/20 px-6 py-6 transition hover:bg-lime/35"
    >
      <span className="font-mono text-4xl font-medium tracking-[0.08em] sm:text-5xl">{code}</span>
      <span className="label-mono text-[11px] text-muted">{copied ? "Copied ✓" : "Tap to copy"}</span>
    </button>
  );
}
