import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { Health } from "./health.js";
import { cors } from "hono/cors";
import { getConnInfo } from "@hono/node-server/conninfo";
import { timingSafeEqual } from "node:crypto";
import { TokenBucket } from "./limit.js";
import type { Config, Platform } from "./config.js";
import { PLATFORMS, attestorAddress } from "./config.js";
import type { DemoStore } from "./demo.js";
import { IG_CODE_RE, openSigned, parsePostRef, score, type IgStore } from "./instagram.js";
import { DEMO_ID_RE } from "./demo.js";
import type { Ops } from "./ops.js";
import { defaultIdentity, type AadhaarProver } from "./aadhaar.js";
import { HttpError, type ProofService } from "./zkfetch.js";

export interface Deps {
  cfg: Config;
  demo: DemoStore;
  proofs: Pick<ProofService, "get">;
  ops: Pick<Ops, "submitClose" | "demoRegister" | "campaignInfo" | "participantCode">;
  ig?: IgStore;
  aadhaar?: Pick<AadhaarProver, "prove" | "available">;
  health?: Pick<Health, "snapshot">;
}

// ---- request validation (exported for tests) ----
const isObj = (b: unknown): b is Record<string, unknown> => typeof b === "object" && b !== null && !Array.isArray(b);

/** u64 id from number or decimal string. */
export function parseId(v: unknown, name: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d{1,20}$/.test(v)) return BigInt(v);
  throw new HttpError(400, `${name} must be a non-negative integer`, "bad_request");
}

export function parseProofReq(b: unknown): { platform: Platform; videoId: string } {
  if (!isObj(b)) throw new HttpError(400, "JSON body required", "bad_request");
  if (!PLATFORMS.includes(b.platform as Platform)) throw new HttpError(400, `platform must be ${PLATFORMS.join("|")}`, "bad_request");
  if (typeof b.videoId !== "string" || !b.videoId) throw new HttpError(400, "videoId required", "bad_request");
  return { platform: b.platform as Platform, videoId: b.videoId };
}

export function parseSubmitReq(b: unknown): { campaignId: bigint; clipId: bigint; epoch: number } {
  if (!isObj(b)) throw new HttpError(400, "JSON body required", "bad_request");
  if (b.kind !== undefined && b.kind !== "close")
    throw new HttpError(400, 'only kind "close" is supported (prove_alive removed)', "bad_request");
  const epoch = b.epoch;
  if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0 || epoch > 0xffffffff)
    throw new HttpError(400, "epoch must be a u32", "bad_request");
  return { campaignId: parseId(b.campaignId, "campaignId"), clipId: parseId(b.clipId, "clipId"), epoch };
}

export function parseDemoRegisterReq(b: unknown): { campaignId: bigint; wallet: string } {
  if (!isObj(b)) throw new HttpError(400, "JSON body required", "bad_request");
  if (typeof b.wallet !== "string" || !b.wallet) throw new HttpError(400, "wallet required", "bad_request");
  return { campaignId: parseId(b.campaignId, "campaignId"), wallet: b.wallet };
}

export function parseAadhaarProveReq(b: unknown): { campaignId: bigint; wallet: string; identity: string } {
  if (!isObj(b)) throw new HttpError(400, "JSON body required", "bad_request");
  if (typeof b.wallet !== "string" || !b.wallet) throw new HttpError(400, "wallet required", "bad_request");
  if (b.identity !== undefined && b.identity !== null && typeof b.identity !== "string")
    throw new HttpError(400, "identity must be a string", "bad_request");
  const identity = typeof b.identity === "string" && b.identity ? b.identity : defaultIdentity(b.wallet);
  return { campaignId: parseId(b.campaignId, "campaignId"), wallet: b.wallet, identity };
}

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, "invalid JSON body", "bad_request");
  }
}

export const PROOF_REUSE_S = 120; // /proof reuses a cached proof at most this old
export const PROOF_RATE = { perMin: 5 }; // /proof per client IP
export const SIGNED_RATE = { perMin: 30 }; // signed /ig/* writes per client IP

/**
 * Client IP. Behind our proxy (TRUST_PROXY=1) it is the LAST X-Forwarded-For hop: the proxy
 * appends the address it saw, while earlier hops are client-supplied and spoofable. Otherwise the
 * socket address; X-Forwarded-For is ignored.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  const xff = trustProxy ? c.req.header("x-forwarded-for") : undefined;
  if (xff) {
    const last = xff.split(",").pop()?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** When WRITE_TOKEN is set, require `Authorization: Bearer <token>`. */
function requireToken(token: string): MiddlewareHandler {
  const want = Buffer.from(`Bearer ${token}`);
  return async (c, next) => {
    if (token) {
      const got = Buffer.from(c.req.header("authorization") ?? "");
      if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "missing or invalid bearer token", "unauthorized");
    }
    await next();
  };
}

export function createApp({ cfg, demo, proofs, ops, aadhaar, health, ig }: Deps) {
  const app = new Hono();
  // CORS_ORIGIN: "*" (default) or comma-separated origins, e.g. "https://cliprail.app,http://localhost:3000"
  app.use("*", cors({ origin: cfg.corsOrigin === "*" ? "*" : cfg.corsOrigin.split(",").map((s) => s.trim()) }));
  const auth = requireToken(cfg.writeToken);
  const bucket = new TokenBucket(PROOF_RATE.perMin, 60_000);
  const signedBucket = new TokenBucket(SIGNED_RATE.perMin, 60_000);

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status as any);
    console.error(err); // details stay in the server log
    return c.json({ error: "internal error", code: "internal" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));

  const attestor = attestorAddress(cfg);
  app.get("/health", async (c) => {
    const base = {
      network: "testnet",
      cliprailId: cfg.cliprailId || null,
      humanityId: cfg.humanityId || null,
      // "simulated": proofs are signed by a local test attestor, not Reclaim
      attestorMode: cfg.attestorMode,
      attestor,
    };
    if (!health) return c.json({ ok: true, ...base });
    const snap = await health.snapshot();
    return c.json({ ...base, ...snap }, snap.ok ? 200 : 503);
  });

  app.post("/proof", async (c) => {
    const { platform, videoId } = parseProofReq(await body(c));
    if (!bucket.take(clientIp(c, cfg.trustProxy))) throw new HttpError(429, "too many proof requests, try again in a minute", "rate_limited");
    const maxAgeS = c.req.query("cached") === "1" ? Infinity : PROOF_REUSE_S;
    const r = await proofs.get(platform, videoId, { maxAgeS, purpose: "open" });
    return c.json({ proof: r.proof, extracted: r.extracted, cached: r.cached });
  });

  app.post("/proof/submit", auth, async (c) => {
    const { campaignId, clipId, epoch } = parseSubmitReq(await body(c));
    return c.json(await ops.submitClose(campaignId, clipId, epoch));
  });

  app.get("/demo/videos/:id", (c) => {
    const id = c.req.param("id");
    if (!DEMO_ID_RE.test(id)) return c.json({ error: "invalid demo video id", code: "bad_request" }, 400);
    return c.json(demo.youtubeShape(id));
  });

  app.post("/demo/videos/:id/bump", auth, async (c) => {
    const b = await body(c);
    if (!isObj(b)) throw new HttpError(400, "JSON body required", "bad_request");
    try {
      return c.json(demo.bump(c.req.param("id"), b));
    } catch (e: any) {
      throw new HttpError(400, e.message, "bad_request");
    }
  });

  app.post("/humanity/demo-register", auth, async (c) => {
    if (!cfg.demoMode) throw new HttpError(403, "demo registration disabled (DEMO_MODE!=1)", "disabled");
    const { campaignId, wallet } = parseDemoRegisterReq(await body(c));
    // Instagram campaigns admit only participants the organiser approved (/ig/participants/approve).
    if ((await ops.campaignInfo(campaignId)).platforms.includes("instagram"))
      throw new HttpError(403, "this campaign admits only participants approved by the organiser", "approval_required");
    return c.json(await ops.demoRegister(campaignId, wallet));
  });

  // ---- Instagram campaigns (instagram.ts) ----
  if (ig) {
    /** Signed body -> action + signer; rate-limited per IP. */
    const signed = async (c: Context, action: string) => {
      if (!signedBucket.take(clientIp(c, cfg.trustProxy))) throw new HttpError(429, "too many requests, try again in a minute", "rate_limited");
      try {
        return openSigned(await body(c), action);
      } catch (e: any) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(e.message === "bad signature" ? 401 : 400, e.message, e.message === "bad signature" ? "unauthorized" : "bad_request");
      }
    };
    const postOf = (v: unknown) => {
      const code = typeof v === "string" ? parsePostRef(v) : null;
      if (!code) throw new HttpError(400, "post must be an Instagram post link or shortcode", "bad_request");
      return code;
    };
    const instagramCampaign = async (campaignId: bigint) => {
      const info = await ops.campaignInfo(campaignId);
      if (!info.platforms.includes("instagram")) throw new HttpError(400, "not an Instagram campaign", "bad_request");
      return info;
    };
    const asBrand = (signer: string, brand: string) => {
      if (signer !== brand) throw new HttpError(403, "only the campaign organiser can do this", "forbidden");
    };
    const storeErr = (e: any): never => {
      throw new HttpError(400, e?.message ?? String(e), "bad_request");
    };

    // Read by the attestor (zkFetch) and by anyone: the organiser-confirmed engagement score.
    app.get("/ig/posts/:code", (c) => {
      const code = c.req.param("code");
      if (!IG_CODE_RE.test(code)) return c.json({ error: "invalid post", code: "bad_request" }, 400);
      return c.json(ig.shape(code));
    });

    app.get("/ig/campaigns/:id/posts", (c) => c.json({ posts: ig.list(String(parseId(c.req.param("id"), "id"))) }));

    // Participant (signed by their wallet) submits their post before registering it as a clip.
    app.post("/ig/submit", async (c) => {
      const { msg, signer } = await signed(c, "cashtag:ig-submit");
      const campaignId = parseId(msg.campaignId, "campaignId");
      const code = postOf(msg.post);
      await instagramCampaign(campaignId);
      const participantCode = await ops.participantCode(campaignId, signer);
      if (!participantCode) throw new HttpError(400, "join the campaign first", "not_joined");
      let post;
      try {
        post = ig.submit({ code, campaignId: String(campaignId), wallet: signer, participantCode });
      } catch (e) {
        storeErr(e);
      }
      return c.json({ post: { ...post!, score: score(post!) } });
    });

    // Organiser (signed by the campaign's brand wallet) confirms a post's engagement.
    app.post("/ig/approve", async (c) => {
      const { msg, signer } = await signed(c, "cashtag:ig-approve");
      const campaignId = parseId(msg.campaignId, "campaignId");
      const code = postOf(msg.post);
      asBrand(signer, (await instagramCampaign(campaignId)).brand);
      let post;
      try {
        post = ig.approve(code, String(campaignId), msg.likes as number, msg.comments as number);
      } catch (e) {
        storeErr(e);
      }
      return c.json({ post: { ...post!, score: score(post!) } });
    });

    // Organiser removes a submission it will not pay (only while unconfirmed).
    app.post("/ig/reject", async (c) => {
      const { msg, signer } = await signed(c, "cashtag:ig-reject");
      const campaignId = parseId(msg.campaignId, "campaignId");
      const code = postOf(msg.post);
      asBrand(signer, (await instagramCampaign(campaignId)).brand);
      try {
        ig.reject(code, String(campaignId));
      } catch (e) {
        storeErr(e);
      }
      return c.json({ ok: true });
    });

    // Organiser approves a participant: registers the wallet in humanity for this campaign only.
    app.post("/ig/participants/approve", async (c) => {
      if (!cfg.demoMode) throw new HttpError(403, "participant registration disabled (DEMO_MODE!=1)", "disabled");
      const { msg, signer } = await signed(c, "cashtag:ig-approve-participant");
      const campaignId = parseId(msg.campaignId, "campaignId");
      if (typeof msg.wallet !== "string" || !msg.wallet) throw new HttpError(400, "wallet required", "bad_request");
      asBrand(signer, (await instagramCampaign(campaignId)).brand);
      return c.json(await ops.demoRegister(campaignId, msg.wallet));
    });
  }

  // Anon Aadhaar ZK proof for humanity.register_zk — TEST mode (UIDAI test key/data, demo identities).
  // Production proves in the browser from the user's own QR; the server never sees identity data.
  app.post("/humanity/aadhaar/prove", auth, async (c) => {
    if (!aadhaar?.available) throw new HttpError(503, "Aadhaar proving unavailable (AADHAAR_ARTIFACTS_DIR missing)", "aadhaar_unavailable");
    const req = parseAadhaarProveReq(await body(c));
    return c.json(await aadhaar.prove(req));
  });

  return app;
}
