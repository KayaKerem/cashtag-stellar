"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { TxLink } from "./TxLink";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  body?: React.ReactNode;
  txHash?: string;
}

interface ToastApi {
  show(t: Omit<ToastItem, "id">): void;
  success(title: string, opts?: { body?: React.ReactNode; txHash?: string }): void;
  /** Contract error code -> readable message (INTERFACES §2.3) */
  error(err: unknown, title?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

const TONE: Record<Tone, string> = {
  success: "border-success/30",
  error: "border-danger/40",
  info: "border-border-strong",
};
const DOT: Record<Tone, string> = { success: "bg-success", error: "bg-danger", info: "bg-lime" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = nextId++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.tone === "error" ? 9000 : 6000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, opts) => show({ tone: "success", title, ...opts }),
      error: (err, title = "Transaction failed") => show({ tone: "error", title, body: errorMessage(err) }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto w-full max-w-sm rounded-2xl border bg-surface p-3.5 shadow-float ${TONE[t.tone]}`}
          >
            <div className="flex items-start gap-2.5">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[t.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-muted">{t.body}</p>}
                {t.txHash && <TxLink hash={t.txHash} className="mt-1.5" />}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Close"
                className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface-2"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
