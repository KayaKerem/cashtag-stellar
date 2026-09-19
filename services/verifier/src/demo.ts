// Demo "platform": a YouTube videos.list look-alike whose numbers we control (proved with real zkTLS).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DemoVideo = { views: number; desc: string };
export type DemoState = { videos: Record<string, DemoVideo> };
export type BumpInput = { views?: unknown; delta?: unknown; desc?: unknown };

export const DEMO_ID_RE = /^[a-z0-9-]{1,32}$/;
const MAX_DESC = 5000;

export class DemoStore {
  state: DemoState;
  constructor(
    private path: string | null,
    seedPath?: string,
  ) {
    const src = path && existsSync(path) ? path : seedPath && existsSync(seedPath) ? seedPath : null;
    this.state = src ? JSON.parse(readFileSync(src, "utf8")) : { videos: {} };
    this.state.videos ??= {};
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }

  /** YouTube `videos.list` shape; unknown id -> empty items (like YouTube). */
  youtubeShape(id: string) {
    const v = this.state.videos[id];
    if (!v) return { kind: "youtube#videoListResponse", items: [] };
    return {
      kind: "youtube#videoListResponse",
      items: [{ kind: "youtube#video", id, snippet: { description: v.desc }, statistics: { viewCount: String(v.views) } }],
    };
  }

  /** Throws Error with a user-facing message on invalid input. */
  bump(id: string, body: BumpInput): { id: string; views: number; desc: string } {
    if (!DEMO_ID_RE.test(id)) throw new Error("invalid demo video id (^[a-z0-9-]{1,32}$)");
    const isInt = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);
    if (body.views !== undefined && !(isInt(body.views) && body.views >= 0)) throw new Error("views must be a non-negative integer");
    if (body.delta !== undefined && !isInt(body.delta)) throw new Error("delta must be an integer");
    if (body.desc !== undefined && (typeof body.desc !== "string" || body.desc.length > MAX_DESC))
      throw new Error(`desc must be a string (≤ ${MAX_DESC} chars)`);
    const cur = this.state.videos[id] ?? { views: 0, desc: "" };
    let views = body.views !== undefined ? (body.views as number) : cur.views;
    if (body.delta !== undefined) views += body.delta as number;
    if (views < 0) throw new Error("views would become negative");
    const next = { views, desc: body.desc !== undefined ? (body.desc as string) : cur.desc };
    this.state.videos[id] = next;
    this.save();
    return { id, ...next };
  }
}
