import { CHAIN_CONFIG } from "@/lib/api/config";

/** Public link to a clip: youtube -> youtu.be, demo -> the demo endpoint on the verifier. */
export function videoUrl(platform: string, videoId: string): string {
  if (platform === "youtube") return `https://youtu.be/${videoId}`;
  return `${CHAIN_CONFIG.verifierUrl.replace(/\/$/, "")}/demo/videos/${videoId}`;
}

export const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", demo: "Demo" };
