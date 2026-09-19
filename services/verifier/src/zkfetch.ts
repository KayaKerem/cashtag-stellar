// zkFetch wrapper: builds the provider request, generates a proof, checks url + attestor.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as defaultConfig, providers, hasReclaim, type Config, type Platform, type ProviderCfg } from "./config.js";
import { ProofCache } from "./cache.js";
import { pLimit } from "./limit.js";
import { attestorOf, claimUrl, extractValues, toProofJson, type Extracted, type ProofJson, type ZkProof } from "./proof.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const VIDEO_ID_RE: Record<Platform, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  demo: /^[a-z0-9-]{1,32}$/,
};

/** Full URL that ends up in the claim parameters (must equal contract url_prefix ‖ id ‖ url_suffix). */
export function proofUrl(platform: Platform, videoId: string, cfg: Config = defaultConfig, prov: ProviderCfg = providers[platform]) {
  let prefix = prov.urlPrefix;
  if (platform === "demo") {
    if (!cfg.demoPublicBase) throw new HttpError(503, "DEMO_PUBLIC_BASE not configured", "config");
    prefix = prefix.replace("https://DEMO_HOST", cfg.demoPublicBase);
  }
  return `${prefix}${videoId}${prov.urlSuffix ?? ""}`;
}

/** Private options: responseMatches from providers.json (exactly {type,value}); redactions reveal only matched fields. */
export function secretOptions(platform: Platform, cfg: Config = defaultConfig, prov: ProviderCfg = providers[platform]) {
  const headers: Record<string, string> = {};
  if (platform === "youtube") {
    if (!cfg.ytApiKey) throw new HttpError(503, "YT_API_KEY missing", "config");
    headers[prov.secretHeader ?? "x-goog-api-key"] = cfg.ytApiKey;
  }
  return {
    headers,
    responseMatches: prov.responseMatches.map(({ type, value }) => ({ type, value })),
    responseRedactions: prov.responseMatches.filter((m) => m.type === "regex").map((m) => ({ regex: m.value })),
  };
}

export type ProofResult = { proof: ProofJson; extracted: Extracted; cached: boolean };
export type GetOpts = {
  /** reuse the cached proof if it is at most this many seconds old (Infinity = any age) */
  maxAgeS?: number;
  /** dedupe namespace: register (/proof) and close (submit) proofs must never be shared */
  purpose?: "open" | "close";
};

export class ProofService {
  private client: any = null;
  private limit = pLimit(2); // max concurrent zkFetch
  private inflight = new Map<string, Promise<ProofResult>>();
  cache: ProofCache;
  fixtures: ProofCache | null;

  constructor(
    private cfg: Config = defaultConfig,
    private log = (m: string) => console.log(`[zkfetch] ${m}`),
  ) {
    this.cache = new ProofCache(join(cfg.dataDir, "cache"));
    this.fixtures = cfg.proofFixtureDir ? new ProofCache(cfg.proofFixtureDir) : null;
  }

  get available() {
    return Boolean(this.fixtures) || hasReclaim(this.cfg);
  }

  private finish(raw: ZkProof, cached: boolean): ProofResult {
    return { proof: toProofJson(raw), extracted: extractValues(raw), cached };
  }

  async get(platform: Platform, videoId: string, opts: GetOpts = {}): Promise<ProofResult> {
    if (!VIDEO_ID_RE[platform].test(videoId)) throw new HttpError(400, `invalid videoId for ${platform}`, "bad_request");

    if (this.fixtures) {
      const raw = this.fixtures.latest(platform, videoId);
      if (!raw) throw new HttpError(404, `no fixture for ${platform}/${videoId}`, "no_fixture");
      return this.finish(raw, true);
    }
    const maxAge = opts.maxAgeS ?? 0;
    if (maxAge > 0) {
      const raw = this.cache.latest(platform, videoId);
      if (raw && Date.now() / 1000 - raw.claimData.timestampS <= maxAge) return this.finish(raw, true);
    }
    if (!hasReclaim(this.cfg)) throw new HttpError(503, "reclaim credentials missing", "no_credentials");

    const key = `${opts.purpose ?? "open"}:${platform}:${videoId}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.fresh(platform, videoId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fresh(platform: Platform, videoId: string): Promise<ProofResult> {
    const url = proofUrl(platform, videoId, this.cfg);
    const raw = await this.limit(() => this.zkFetch(url, secretOptions(platform, this.cfg)));
    if (claimUrl(raw) !== url) throw new HttpError(502, `proof url mismatch: ${claimUrl(raw)}`, "proof_invalid");
    const attestor = attestorOf(raw);
    if (!attestor || !this.cfg.attestors.includes(attestor)) {
      this.log(`UNKNOWN ATTESTOR ${attestor} (configured: ${this.cfg.attestors.join(",")}) — set RECLAIM_ATTESTORS and set_attestors`);
      const dir = join(this.cfg.dataDir, "rejected");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${platform}-${videoId}-${raw.claimData.timestampS}.json`), JSON.stringify(raw, null, 2));
      throw new HttpError(502, `proof signed by unknown attestor ${attestor}`, "unknown_attestor");
    }
    this.cache.save(platform, videoId, raw);
    return this.finish(raw, false);
  }

  private async zkFetch(url: string, secret: ReturnType<typeof secretOptions>): Promise<ZkProof> {
    if (!this.client) {
      const { ReclaimClient } = await import("@reclaimprotocol/zk-fetch");
      this.client = new ReclaimClient(this.cfg.reclaimAppId, this.cfg.reclaimAppSecret);
    }
    let raw: ZkProof | undefined;
    try {
      // no public headers: they would be added to the signed parameters (docs/reclaim-notes.md §2.1)
      raw = await this.client.zkFetch(url, { method: "GET" }, secret);
    } catch (e: any) {
      throw new HttpError(502, `zkFetch failed: ${e?.message ?? e}`, "zkfetch_failed");
    }
    if (!raw) throw new HttpError(502, "zkFetch returned no proof", "zkfetch_failed");
    return raw;
  }
}
