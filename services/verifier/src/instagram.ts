// Instagram campaigns (pilot): participants submit their post, the campaign organiser (brand)
// confirms its engagement, and /ig/posts/:code serves the confirmed score in the same shape as
// the demo platform, so the existing zkFetch proof path and contract verification are reused.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Keypair, StrKey, hash } from "@stellar/stellar-sdk";

/** Instagram shortcode (the id in instagram.com/p/<code>/ or /reel/<code>/). */
export const IG_CODE_RE = /^[A-Za-z0-9_-]{5,40}$/;
export const MAX_POSTS = 2000;
/** Per participant and campaign, so one wallet cannot fill the store. */
export const MAX_POSTS_PER_WALLET = 20;
export const MAX_COUNT = 100_000_000;
/** Signed requests are accepted for this long after their `ts`. */
export const SIGNED_MAX_AGE_S = 600;

export type IgPost = {
  code: string;
  campaignId: string;
  wallet: string;
  /** The participant's campaign code (CR-…); served as the post description for the on-chain check. */
  participantCode: string;
  likes: number;
  comments: number;
  approved: boolean;
  submittedAt: number;
  approvedAt?: number;
};

/** Shortcode from a post URL (instagram.com/p|reel|tv/<code>) or a bare shortcode. */
export function parsePostRef(ref: string): string | null {
  const s = ref.trim();
  if (IG_CODE_RE.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return m && IG_CODE_RE.test(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}

/** Engagement score the campaign pays on: likes + comments, once the organiser approved them. */
export const score = (p: IgPost) => (p.approved ? p.likes + p.comments : 0);

export class IgStore {
  posts: Record<string, IgPost>;
  constructor(private path: string | null) {
    this.posts = path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")).posts ?? {}) : {};
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ posts: this.posts }, null, 2));
  }

  get(code: string): IgPost | undefined {
    return this.posts[code];
  }

  /** Same shape as the demo platform, so the same responseMatches apply. Unknown post -> no items. */
  shape(code: string) {
    const p = this.posts[code];
    if (!p) return { kind: "cashtag#instagramPost", items: [] };
    return {
      kind: "cashtag#instagramPost",
      items: [{ id: code, snippet: { description: `Cashtag ${p.participantCode}` }, statistics: { viewCount: String(score(p)) } }],
    };
  }

  /** Throws Error with a user-facing message. Re-submitting the same post by the same participant is a no-op. */
  submit(i: { code: string; campaignId: string; wallet: string; participantCode: string }, now = Date.now()): IgPost {
    if (!IG_CODE_RE.test(i.code)) throw new Error("invalid Instagram post");
    const cur = this.posts[i.code];
    if (cur) {
      if (cur.campaignId !== i.campaignId || cur.wallet !== i.wallet) throw new Error("this post was already submitted by another participant");
      return cur;
    }
    if (Object.keys(this.posts).length >= MAX_POSTS) throw new Error(`post limit reached (${MAX_POSTS})`);
    const mine = Object.values(this.posts).filter((p) => p.campaignId === i.campaignId && p.wallet === i.wallet).length;
    if (mine >= MAX_POSTS_PER_WALLET) throw new Error(`at most ${MAX_POSTS_PER_WALLET} posts per participant`);
    const p: IgPost = { ...i, likes: 0, comments: 0, approved: false, submittedAt: Math.floor(now / 1000) };
    this.posts[i.code] = p;
    this.save();
    return p;
  }

  approve(code: string, campaignId: string, likes: number, comments: number, now = Date.now()): IgPost {
    const p = this.posts[code];
    if (!p || p.campaignId !== campaignId) throw new Error("post not found in this campaign");
    const ok = (x: number) => Number.isSafeInteger(x) && x >= 0 && x <= MAX_COUNT;
    if (!ok(likes) || !ok(comments)) throw new Error(`likes and comments must be integers in [0, ${MAX_COUNT}]`);
    Object.assign(p, { likes, comments, approved: true, approvedAt: Math.floor(now / 1000) });
    this.save();
    return p;
  }

  /** Organiser removes a submission that is not theirs to pay (e.g. someone else's post). Approved posts stay. */
  reject(code: string, campaignId: string): void {
    const p = this.posts[code];
    if (!p || p.campaignId !== campaignId) throw new Error("post not found in this campaign");
    if (p.approved) throw new Error("approved posts cannot be removed");
    delete this.posts[code];
    this.save();
  }

  isApproved(code: string): boolean {
    return !!this.posts[code]?.approved;
  }

  list(campaignId: string): (IgPost & { score: number })[] {
    return Object.values(this.posts)
      .filter((p) => p.campaignId === campaignId)
      .sort((a, b) => a.submittedAt - b.submittedAt)
      .map((p) => ({ ...p, score: score(p) }));
  }
}

// ---- wallet-signed requests (SEP-53 message signing) ----

const SEP53_PREFIX = "Stellar Signed Message:\n";

/** True if `signature` (base64) is `address`'s signature over `message`: SEP-53 hash, or the raw message (older wallets). */
export function verifySignedMessage(address: string, message: string, signature: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(address)) return false;
  const sig = Buffer.from(signature, "base64");
  if (sig.length !== 64) return false;
  const kp = Keypair.fromPublicKey(address);
  const msg = Buffer.from(message, "utf8");
  try {
    return kp.verify(hash(Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), msg])), sig) || kp.verify(msg, sig);
  } catch {
    return false;
  }
}

export type SignedAction = { action: string; ts: number; [k: string]: unknown };

/**
 * Parse and check a signed request body `{ message, signature, address }`, where `message` is a JSON
 * SignedAction. Returns the action and the signer; the caller checks the signer's role.
 */
export function openSigned(body: unknown, action: string, nowS = Date.now() / 1000): { msg: SignedAction; signer: string } {
  const b = body as { message?: unknown; signature?: unknown; address?: unknown } | null;
  if (!b || typeof b.message !== "string" || typeof b.signature !== "string" || typeof b.address !== "string")
    throw new Error("signed request needs message, signature and address");
  if (b.message.length > 4096) throw new Error("message too long");
  let msg: SignedAction;
  try {
    msg = JSON.parse(b.message);
  } catch {
    throw new Error("message must be JSON");
  }
  if (!msg || msg.action !== action) throw new Error(`message action must be "${action}"`);
  if (typeof msg.ts !== "number" || Math.abs(nowS - msg.ts) > SIGNED_MAX_AGE_S) throw new Error("message expired, sign again");
  if (!verifySignedMessage(b.address, b.message, b.signature)) throw new Error("bad signature");
  return { msg, signer: b.address };
}
