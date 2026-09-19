"use client";

import { useEffect } from "react";
import { errorMessage } from "@/lib/api/errors";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="label-mono text-xs text-muted">Hata</p>
      <h1 className="display mt-2 text-2xl">Bir şeyler ters gitti</h1>
      <p className="mt-3 text-sm text-muted">{errorMessage(error)}</p>
      <button
        type="button"
        onClick={reset}
        className="label-mono mt-6 h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2"
      >
        Tekrar dene
      </button>
    </div>
  );
}
