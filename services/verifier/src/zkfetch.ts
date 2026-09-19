// zkFetch wrapper: builds the provider request, generates a proof, sanity-checks it off-chain.
import { config as defaultConfig, providers, hasReclaim, type Config, type Platform, type ProviderCfg } from "./config.js";
import { ProofCache } from "./cache.js";
import { claimUrl, extractValues, toProofJson, type Extracted, type ProofJson, type ZkProof } from "./proof.js";
import { join } from "node:path";

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

/** Private options: responseMatches from providers.json; redactions reveal only the matched fields. */
export function secretOptions(platform: Platform, cfg: Config = defaultConfig, prov: ProviderCfg = providers[platform]) {
  const headers: Record<string, string> = {};
  if (platform === "youtube") {
    if (!cfg.ytApiKey) throw new HttpError(503, "YT_API_KEY missing", "config");
    headers[prov.secretHeader ?? "x-goog-api-key"] = cfg.ytApiKey;
  }
  return {
    headers,
    responseMatches: prov.responseMatches,
    responseRedactions: prov.responseMatches.filter((m) => m.type === "regex").map((m) => ({ regex: m.value })),
  };
}

export type ProofResult = { proof: ProofJson; extracted: Extracted; cached: boolean; raw: ZkProof };

export class ProofService {
  private client: any = null;
  cache: ProofCache;
  fixtures: ProofCache | null;

  constructor(private cfg: Config = defaultConfig) {
    this.cache = new ProofCache(join(cfg.dataDir, "cache"));
    this.fixtures = cfg.proofFixtureDir ? new ProofCache(cfg.proofFixtureDir) : null;
  }

  get available() {
    return Boolean(this.fixtures) || hasReclaim(this.cfg);
  }

  private finish(raw: ZkProof, cached: boolean): ProofResult {
    return { proof: toProofJson(raw), extracted: extractValues(raw), cached, raw };
  }

  async get(platform: Platform, videoId: string, opts: { preferCached?: boolean } = {}): Promise<ProofResult> {
    if (!VIDEO_ID_RE[platform].test(videoId)) throw new HttpError(400, `invalid videoId for ${platform}`, "bad_request");

    if (this.fixtures) {
      const raw = this.fixtures.latest(platform, videoId);
      if (!raw) throw new HttpError(404, `no fixture for ${platform}/${videoId}`, "no_fixture");
      return this.finish(raw, true);
    }
    if (opts.preferCached) {
      const raw = this.cache.latest(platform, videoId);
      if (raw) return this.finish(raw, true);
    }
    if (!hasReclaim(this.cfg)) throw new HttpError(503, "reclaim credentials missing", "no_credentials");

    const url = proofUrl(platform, videoId, this.cfg);
    const raw = await this.zkFetch(url, secretOptions(platform, this.cfg));
    if (claimUrl(raw) !== url) throw new HttpError(502, "proof url mismatch", "proof_invalid");
    await this.verify(raw);
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
      raw = await this.client.zkFetch(url, { method: "GET", headers: { accept: "application/json" } }, secret);
    } catch (e: any) {
      throw new HttpError(502, `zkFetch failed: ${e?.message ?? e}`, "zkfetch_failed");
    }
    if (!raw) throw new HttpError(502, "zkFetch returned no proof", "zkfetch_failed");
    return raw;
  }

  /** Off-chain sanity check (signature/witness); content is checked on-chain. */
  private async verify(raw: ZkProof) {
    const { verifyProof } = await import("@reclaimprotocol/js-sdk");
    const res: any = await verifyProof(raw as any, { dangerouslyDisableContentValidation: true } as any);
    const ok = typeof res === "boolean" ? res : res?.isVerified;
    if (!ok) throw new HttpError(502, `proof failed off-chain verification: ${res?.error?.message ?? ""}`, "proof_invalid");
  }
}
