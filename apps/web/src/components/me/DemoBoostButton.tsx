"use client";

import { useState } from "react";
import { useToast } from "@/components/common/Toast";
import { bumpDemoVideo } from "@/lib/api/demo";

/** Boosts a video's view count on the demo platform (for the live demo). */
export function DemoBoostButton({ videoId, delta = 3000 }: { videoId: string; delta?: number }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function boost() {
    setPending(true);
    try {
      const v = await bumpDemoVideo(videoId, { delta });
      toast.success(`+${delta.toLocaleString("en-US")} views`, {
        body: `${videoId}: now at ${v.views.toLocaleString("en-US")} views. They count in the closing proof.`,
      });
    } catch (err) {
      toast.show({ tone: "error", title: "Couldn't boost the views", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={boost}
      disabled={pending}
      title="Boosts this video's view count on the demo platform"
      className="label-mono mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong px-2.5 text-[10px] transition hover:bg-surface-2 disabled:opacity-50"
    >
      {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}+{delta.toLocaleString("en-US")} views
    </button>
  );
}
