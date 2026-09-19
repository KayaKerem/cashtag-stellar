"use client";

import { useState } from "react";
import { useToast } from "@/components/common/Toast";
import { bumpDemoVideo } from "@/lib/api/demo";

/** Demo platformundaki videonun izlenmesini artırır (canlı demo için). */
export function DemoBoostButton({ videoId, delta = 3000 }: { videoId: string; delta?: number }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function boost() {
    setPending(true);
    try {
      const v = await bumpDemoVideo(videoId, { delta });
      toast.success(`+${delta.toLocaleString("en-US")} izlenme`, {
        body: `${videoId}: şu an ${v.views.toLocaleString("en-US")} izlenme. Kapanış kanıtında sayılır.`,
      });
    } catch (err) {
      toast.show({ tone: "error", title: "İzlenme artırılamadı", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={boost}
      disabled={pending}
      title="Demo platformunda bu videonun izlenmesini artırır"
      className="label-mono mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong px-2.5 text-[10px] transition hover:bg-surface-2 disabled:opacity-50"
    >
      {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}+{delta.toLocaleString("en-US")} izlenme
    </button>
  );
}
