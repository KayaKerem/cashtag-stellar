import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { getConnInfo } from "@hono/node-server/conninfo";
import { timingSafeEqual } from "node:crypto";
import { TokenBucket } from "./limit.js";
import type { Config, Platform } from "./config.js";
import { PLATFORMS, attestorAddress } from "./config.js";
import type { DemoStore } from "./demo.js";
import { DEMO_ID_RE } from "./demo.js";
import type { Ops } from "./ops.js";
import { defaultIdentity, type AadhaarProver } from "./aadhaar.js";
import { HttpError, type ProofService } from "./zkfetch.js";

export interface Deps {
  cfg: Config;
  demo: DemoStore;
  proofs: Pick<ProofService, "get">;
  ops: Pick<Ops, "submitClose" | "demoRegister">;
  aadhaar?: Pick<AadhaarProver, "prove" | "available">;
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

/** Client IP: first X-Forwarded-For hop (Caddy in front), else the socket address. */
function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
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

export function createApp({ cfg, demo, proofs, ops, aadhaar }: Deps) {
  const app = new Hono();
  // CORS_ORIGIN: "*" (default) or comma-separated origins, e.g. "https://cliprail.app,http://localhost:3000"
  app.use("*", cors({ origin: cfg.corsOrigin === "*" ? "*" : cfg.corsOrigin.split(",").map((s) => s.trim()) }));
  const auth = requireToken(cfg.writeToken);
  const bucket = new TokenBucket(PROOF_RATE.perMin, 60_000);

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status as any);
    console.error(err);
    return c.json({ error: String((err as any)?.message ?? err), code: "internal" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));

  const attestor = attestorAddress(cfg);
  app.get("/health", (c) =>
    c.json({
      ok: true,
      network: "testnet",
      cliprailId: cfg.cliprailId || null,
      humanityId: cfg.humanityId || null,
      // "simulated": proofs are signed by a local test attestor, not Reclaim
      attestorMode: cfg.attestorMode,
      attestor,
    }),
  );

  app.post("/proof", async (c) => {
    const { platform, videoId } = parseProofReq(await body(c));
    if (!bucket.take(clientIp(c))) throw new HttpError(429, "too many proof requests, try again in a minute", "rate_limited");
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
    return c.json(await ops.demoRegister(campaignId, wallet));
  });

  // Anon Aadhaar ZK proof for humanity.register_zk — TEST mode (UIDAI test key/data, demo identities).
  // Production proves in the browser from the user's own QR; the server never sees identity data.
  app.post("/humanity/aadhaar/prove", auth, async (c) => {
    if (!aadhaar?.available) throw new HttpError(503, "Aadhaar proving unavailable (AADHAAR_ARTIFACTS_DIR missing)", "aadhaar_unavailable");
    const req = parseAadhaarProveReq(await body(c));
    return c.json(await aadhaar.prove(req));
  });

  return app;
}
