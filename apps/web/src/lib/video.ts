import { CHAIN_CONFIG } from "@/lib/api/config";

/** Public link to a clip: youtube -> youtu.be, instagram -> the post, demo -> the demo endpoint on the verifier. */
export function videoUrl(platform: string, videoId: string): string {
  if (platform === "youtube") return `https://youtu.be/${videoId}`;
  if (platform === "instagram") return instagramUrl(videoId);
  return `${CHAIN_CONFIG.verifierUrl.replace(/\/$/, "")}/demo/videos/${videoId}`;
}

export const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", demo: "Demo", instagram: "Instagram" };

export const instagramUrl = (code: string) => `https://www.instagram.com/p/${code}/`;

/** Instagram campaigns admit approved participants only and pay on organiser-confirmed likes + comments. */
export const isInstagram = (platforms: readonly string[]) => platforms.includes("instagram");

/** What a clip's count measures: views, or engagement (likes + comments) on Instagram. */
export function metricLabel(platforms: readonly string[]): string {
  if (!isInstagram(platforms)) return "views";
  return platforms.every((p) => p === "instagram") ? "engagement" : "views / engagement";
}

const IG_CODE_RE = /^[A-Za-z0-9_-]{5,40}$/;

/** Shortcode from an Instagram post link (/p/, /reel/, /reels/, /tv/, optionally under /<user>/) or a bare shortcode. */
export function parseInstagramPost(input: string): { ok: true; id: string } | { ok: false; error: string } {
  const s = input.trim();
  if (!s) return { ok: false, error: "Enter your Instagram post link." };
  if (IG_CODE_RE.test(s)) return { ok: true, id: s };
  const bad = { ok: false as const, error: "Not an Instagram post link (instagram.com/p/… or /reel/…)." };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return bad;
  }
  if (!/(^|\.)instagram\.com$/.test(u.hostname)) return bad;
  const m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m && IG_CODE_RE.test(m[1]) ? { ok: true, id: m[1] } : bad;
}
