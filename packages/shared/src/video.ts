// Video id extraction/validation. Formats: INTERFACES §2.1 (Clip.video_id).

import type { Platform } from "./types";

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const DEMO_ID_RE = /^[a-z0-9-]{1,32}$/;

export type VideoLinkResult = { ok: true; id: string } | { ok: false; error: string };

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YT_PATH_PREFIXES = ["shorts", "embed", "live", "v"];

function toUrl(s: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function youtubeId(input: string): string | null {
  if (YOUTUBE_ID_RE.test(input)) return input;
  const u = toUrl(input);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "youtu.be" || host === "www.youtu.be") return parts[0] ?? null;
  if (!YT_HOSTS.has(host)) return null;
  if (parts[0] === "watch") return u.searchParams.get("v");
  if (parts.length >= 2 && YT_PATH_PREFIXES.includes(parts[0]!)) return parts[1]!;
  return null;
}

export function parseVideoLink(platform: Platform | string, input: string): VideoLinkResult {
  const s = (input ?? "").trim();
  if (!s) return { ok: false, error: "Video bağlantısı ya da kimliği gir." };
  if (platform === "youtube") {
    const id = youtubeId(s);
    if (id && YOUTUBE_ID_RE.test(id)) return { ok: true, id };
    return { ok: false, error: "Geçerli bir YouTube bağlantısı değil (11 karakterlik video kimliği bulunamadı)." };
  }
  if (platform === "demo") {
    let id = s;
    if (s.includes("/")) {
      const u = toUrl(s);
      id = u?.pathname.split("/").filter(Boolean).pop() ?? "";
    }
    if (DEMO_ID_RE.test(id)) return { ok: true, id };
    return { ok: false, error: "Demo video kimliği 1–32 karakter olmalı: küçük harf, rakam ve tire." };
  }
  return { ok: false, error: "Desteklenmeyen platform." };
}
