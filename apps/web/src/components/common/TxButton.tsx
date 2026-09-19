"use client";

import { useState } from "react";
import { useToast } from "./Toast";

/** The user cancelled in the confirmation dialog: no toast is shown. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

type Variant = "primary" | "outline" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-ink-fg hover:opacity-90",
  outline: "border border-border-strong text-fg hover:bg-surface-2",
  danger: "border border-danger/40 text-danger hover:bg-danger-soft",
};

/**
 * Click -> sign -> wait -> success toast + TxLink. On failure, a toast with a readable message.
 * With `disabledReason` the button is disabled and the reason shows as a tooltip.
 */
export function TxButton<T extends { txHash: string }>({
  action,
  children,
  successTitle,
  successBody,
  onSuccess,
  disabledReason,
  variant = "primary",
  className = "",
}: {
  action: () => Promise<T>;
  children: React.ReactNode;
  successTitle: string;
  successBody?: (result: T) => React.ReactNode;
  onSuccess?: (result: T) => void;
  disabledReason?: string | null;
  variant?: Variant;
  className?: string;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const disabled = pending || !!disabledReason;

  async function run() {
    if (disabled) return;
    setPending(true);
    try {
      const result = await action();
      toast.success(successTitle, { txHash: result.txHash, body: successBody?.(result) });
      onSuccess?.(result);
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="group relative inline-flex flex-col items-start" title={disabledReason ?? undefined}>
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        aria-busy={pending}
        className={`label-mono inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-45 ${VARIANT[variant]} ${className}`}
      >
        {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
        {pending ? "Signing…" : children}
      </button>
      {/* No tooltips on touch screens: show the reason under the button */}
      {disabledReason && !pending && <span className="mt-1 max-w-[14rem] text-[10px] leading-tight text-muted sm:hidden">{disabledReason}</span>}
    </span>
  );
}
