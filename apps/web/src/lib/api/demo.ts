import { API_MODE, CHAIN_CONFIG } from "./config";

export interface DemoVideo {
  id: string;
  views: number;
  desc: string;
}

/**
 * Updates a video on the demo platform (verifier `POST /demo/videos/:id/bump`).
 * `desc` sets the description, `views` sets the count, `delta` increments it. No network call in mock mode.
 */
export async function bumpDemoVideo(id: string, body: { views?: number; delta?: number; desc?: string }): Promise<DemoVideo> {
  if (API_MODE !== "chain") {
    await new Promise((r) => setTimeout(r, 400));
    return { id, views: body.views ?? body.delta ?? 0, desc: body.desc ?? "" };
  }
  const res = await fetch(`${CHAIN_CONFIG.verifierUrl.replace(/\/$/, "")}/demo/videos/${encodeURIComponent(id)}/bump`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CHAIN_CONFIG.writeToken ? { Authorization: `Bearer ${CHAIN_CONFIG.writeToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = res.status === 401 ? "The verifier rejected the write (WRITE_TOKEN)." : data?.error ?? `Verifier error (${res.status})`;
    throw new Error(msg);
  }
  return data as DemoVideo;
}

/** Demo description: the code + the ad tag (the proof looks for the code in the description). */
export const demoDescription = (code: string, title: string) => `${code} #ad Demo clip for the ${title || "Cashtag"} campaign`;

/** Suggested demo video ID: lowercase letters, digits and dashes (<= 32). */
export function suggestDemoId(code: string): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `clip-${code.replace(/^CR-/, "").toLowerCase()}-${rand}`.slice(0, 32);
}
