import { API_MODE, CHAIN_CONFIG } from "./config";

export interface DemoVideo {
  id: string;
  views: number;
  desc: string;
}

/**
 * Demo platformundaki videoyu günceller (verifier `POST /demo/videos/:id/bump`).
 * `desc` açıklamayı yazar, `views` sayıyı ayarlar, `delta` artırır. Mock modunda ağ çağrısı yapılmaz.
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
    const msg = res.status === 401 ? "Verifier yazma izni reddedildi (WRITE_TOKEN)." : data?.error ?? `Verifier hatası (${res.status})`;
    throw new Error(msg);
  }
  return data as DemoVideo;
}

/** Demo açıklaması: kod + reklam etiketi (kanıt açıklamada kodu arar). */
export const demoDescription = (code: string, title: string) => `${code} #ad ${title || "ClipRail"} kampanyası için demo klip`;

/** Demo video kimliği önerisi: küçük harf, rakam, tire (≤ 32). */
export function suggestDemoId(code: string): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `clip-${code.replace(/^CR-/, "").toLowerCase()}-${rand}`.slice(0, 32);
}
