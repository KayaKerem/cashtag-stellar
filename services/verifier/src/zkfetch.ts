// zkFetch wrapper: builds the provider request, generates a proof, checks url + attestor.
// ATTESTOR_MODE=simulated: no zkFetch; the response is fetched here and signed by the local
// simulated attestor (src/simulated.ts) with exactly the parameters zkFetch would have sent.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as defaultConfig, providers, hasReclaim, isSimulated, type Config, type Platform, type ProviderCfg } from "./config.js";
import { ProofCache } from "./cache.js";
import { pLimit } from "./limit.js";
import { attestorOf, claimUrl, extractValues, toProofJson, type Extracted, type ProofJson, type ZkProof } from "./proof.js";
import { addressOfSecret, extractFromBody, signClaim, zkFetchParams } from "./simulated.js";
import type { DemoStore } from "./demo.js";

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

export const DEFAULT_ATTESTOR_URL = "wss://attestor.reclaimprotocol.org/ws";
const ATTESTOR_FLAG_URL = "https://api.reclaimprotocol.org/api/feature-flags/get?featureFlagNames=zkFetchAttestorURL";

/** Attestor node zk-fetch would use: Reclaim's feature flag, falling back to the default node. */
export async function resolveAttestorUrl(fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchImpl(ATTESTOR_FLAG_URL, { headers: { "content-type": "application/json" } });
    if (!res.ok) return DEFAULT_ATTESTOR_URL;
    const flags = (await res.json()) as { name?: string; value?: string }[];
    return flags?.find((f) => f.name === "zkFetchAttestorURL")?.value || DEFAULT_ATTESTOR_URL;
  } catch {
    return DEFAULT_ATTESTOR_URL;
  }
}

/**
 * `@reclaimprotocol/tls` ships an empty crypto object that the caller has to fill in; zk-fetch does
 * it on import, but under a CJS/ESM split (tsx) that copy is not the one attestor-core reads from.
 * Installing it from here is idempotent and keeps both proof paths working.
 */
export async function ensureTlsCrypto(): Promise<void> {
  const tls: any = await import("@reclaimprotocol/tls");
  if (typeof tls.crypto?.randomBytes === "function") return;
  const { webcryptoCrypto } = (await import("@reclaimprotocol/tls/webcrypto")) as any;
  tls.setCryptoImplementation(webcryptoCrypto);
}

export class ProofService {
  private client: any = null;
  private attestorUrl = "";
  private limit = pLimit(2); // max concurrent zkFetch
  private inflight = new Map<string, Promise<ProofResult>>();
  cache: ProofCache;
  fixtures: ProofCache | null;

  constructor(
    private cfg: Config = defaultConfig,
    private log = (m: string) => console.log(`[zkfetch] ${m}`),
    /** simulated mode reads demo videos from this store instead of over HTTP */
    private demo: Pick<DemoStore, "youtubeShape"> | null = null,
    private fetchImpl: typeof fetch = fetch,
  ) {
    // simulated proofs never share a cache with real ones
    this.cache = new ProofCache(join(cfg.dataDir, isSimulated(cfg) ? "cache-simulated" : "cache"));
    this.fixtures = cfg.proofFixtureDir ? new ProofCache(cfg.proofFixtureDir) : null;
  }

  get available() {
    return Boolean(this.fixtures) || isSimulated(this.cfg) || hasReclaim(this.cfg);
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
    if (!isSimulated(this.cfg) && !hasReclaim(this.cfg)) throw new HttpError(503, "reclaim credentials missing", "no_credentials");

    const key = `${opts.purpose ?? "open"}:${platform}:${videoId}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.fresh(platform, videoId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fresh(platform: Platform, videoId: string): Promise<ProofResult> {
    const url = proofUrl(platform, videoId, this.cfg);
    const secret = secretOptions(platform, this.cfg);
    const raw = await this.limit(() => (isSimulated(this.cfg) ? this.simulate(platform, videoId, url, secret) : this.zkFetch(url, secret)));
    if (claimUrl(raw) !== url) throw new HttpError(502, `proof url mismatch: ${claimUrl(raw)}`, "proof_invalid");
    const attestor = attestorOf(raw);
    const trusted = isSimulated(this.cfg) ? [addressOfSecret(this.cfg.simAttestorSecret)] : this.cfg.attestors;
    if (!attestor || !trusted.includes(attestor)) {
      this.log(`UNKNOWN ATTESTOR ${attestor} (configured: ${this.cfg.attestors.join(",")}) — set RECLAIM_ATTESTORS and set_attestors`);
      const dir = join(this.cfg.dataDir, "rejected");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${platform}-${videoId}-${raw.claimData.timestampS}.json`), JSON.stringify(raw, null, 2));
      throw new HttpError(502, `proof signed by unknown attestor ${attestor}`, "unknown_attestor");
    }
    this.cache.save(platform, videoId, raw);
    return this.finish(raw, false);
  }

  /** Response body the attestor would see: demo videos straight from the store, anything else over HTTP. */
  private async responseBody(platform: Platform, videoId: string, url: string, headers: Record<string, string>): Promise<string> {
    if (platform === "demo" && this.demo) return JSON.stringify(this.demo.youtubeShape(videoId));
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers });
    } catch (e: any) {
      throw new HttpError(502, `fetch failed: ${e?.message ?? e}`, "zkfetch_failed");
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(502, `upstream HTTP ${res.status}`, "zkfetch_failed");
    return text;
  }

  /** Simulated attestor: same claim parameters as zkFetch (url, responseMatches, responseRedactions), signed locally. */
  private async simulate(platform: Platform, videoId: string, url: string, secret: ReturnType<typeof secretOptions>): Promise<ZkProof> {
    const body = await this.responseBody(platform, videoId, url, secret.headers);
    const extracted = extractFromBody(body, secret.responseMatches);
    if (!extracted || extracted.views === undefined)
      throw new HttpError(404, `no view count in the ${platform} response for ${videoId} (unknown video?)`, "no_match");
    return signClaim({
      params: zkFetchParams(url, secret.responseMatches, secret.responseRedactions),
      extracted,
      attestorSecret: this.cfg.simAttestorSecret,
      owner: addressOfSecret(this.cfg.simOwnerSecret),
      timestampS: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Same claim as zkFetch, made straight on the Reclaim attestor node. zk-fetch only adds its own
   * telemetry on top (and refuses to run when RECLAIM_APP_ID is not registered as a zkFetch app).
   * The app id never enters the claim: the owner is the address of RECLAIM_APP_SECRET either way.
   */
  private async attestorClaim(url: string, secret: ReturnType<typeof secretOptions>): Promise<ZkProof> {
    if (!this.attestorUrl) this.attestorUrl = this.cfg.reclaimAttestorUrl || (await resolveAttestorUrl(this.fetchImpl));
    await ensureTlsCrypto();
    const { createClaimOnAttestor } = await import("@reclaimprotocol/attestor-core");
    let claim: any;
    try {
      claim = await createClaimOnAttestor({
        name: "http",
        params: {
          method: "GET",
          url,
          responseMatches: secret.responseMatches,
          headers: undefined,
          geoLocation: undefined,
          responseRedactions: secret.responseRedactions,
          body: "",
          paramValues: undefined,
        } as any,
        secretParams: { cookieStr: "", headers: secret.headers },
        zkEngine: "stwo",
        ownerPrivateKey: this.cfg.reclaimAppSecret,
        client: { url: this.attestorUrl },
      } as any);
    } catch (e: any) {
      throw new HttpError(502, `attestor claim failed: ${e?.message ?? e}`, "zkfetch_failed");
    }
    if (claim?.error) throw new HttpError(502, `attestor claim error: ${claim.error.message ?? claim.error}`, "zkfetch_failed");
    if (!claim?.claim || !claim?.signatures) throw new HttpError(502, "attestor returned no claim", "zkfetch_failed");
    let extracted: Record<string, string> | undefined;
    try {
      extracted = JSON.parse(claim.claim.context || "{}")?.extractedParameters;
    } catch {
      /* extractValues falls back to the context */
    }
    // same shape zk-fetch's transformProof produces
    return {
      identifier: claim.claim.identifier,
      claimData: claim.claim,
      signatures: ["0x" + Buffer.from(claim.signatures.claimSignature).toString("hex")],
      extractedParameterValues: extracted,
      witnesses: [{ id: claim.signatures.attestorAddress, url: this.attestorUrl }],
    };
  }

  private async zkFetch(url: string, secret: ReturnType<typeof secretOptions>): Promise<ZkProof> {
    if (this.cfg.reclaimDirect) return this.attestorClaim(url, secret);
    await ensureTlsCrypto();
    if (!this.client) {
      const { ReclaimClient } = await import("@reclaimprotocol/zk-fetch");
      this.client = new ReclaimClient(this.cfg.reclaimAppId, this.cfg.reclaimAppSecret);
    }
    let raw: ZkProof | undefined;
    try {
      // no public headers: they would be added to the signed parameters
      raw = await this.client.zkFetch(url, { method: "GET" }, secret);
    } catch (e: any) {
      throw new HttpError(502, `zkFetch failed: ${e?.message ?? e}`, "zkfetch_failed");
    }
    if (!raw) throw new HttpError(502, "zkFetch returned no proof", "zkfetch_failed");
    return raw;
  }
}
