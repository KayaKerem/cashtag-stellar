import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DEFAULT_SIM_ATTESTOR_SECRET, DEFAULT_SIM_OWNER_SECRET, addressOfSecret } from "./simulated.js";

export const SERVICE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(SERVICE_DIR, "../..");

// ENV_FILE (default .env, relative to the service dir) first; then local fallbacks written by
// scripts/ (never override explicit env). ENV_FILE=.env.simulated runs against the e2e instance.
dotenv.config({ path: resolve(SERVICE_DIR, (process.env.ENV_FILE ?? "").trim() || ".env"), quiet: true });
for (const f of ["deploy.env", "accounts.env", "secrets.env"]) {
  const p = resolve(REPO_ROOT, "scripts/.accounts", f);
  if (existsSync(p)) dotenv.config({ path: p, quiet: true });
}

export type AttestorMode = "reclaim" | "simulated";

export type Platform = "youtube" | "demo";
export const PLATFORMS: Platform[] = ["youtube", "demo"];

export interface ProviderCfg {
  urlPrefix: string;
  urlSuffix: string;
  secretHeader?: string;
  responseMatches: { type: "regex" | "contains"; value: string }[];
}

const env = process.env;
const str = (k: string, d = "") => (env[k] ?? d).trim();

function attestorMode(): AttestorMode {
  const m = str("ATTESTOR_MODE", "reclaim").toLowerCase() || "reclaim";
  if (m !== "reclaim" && m !== "simulated") throw new Error(`ATTESTOR_MODE must be reclaim|simulated (got "${m}")`);
  return m as AttestorMode;
}

export const config = {
  reclaimAppId: str("RECLAIM_APP_ID"),
  reclaimAppSecret: str("RECLAIM_APP_SECRET"),
  ytApiKey: str("YT_API_KEY"),
  relayerSecret: str("RELAYER_SECRET"),
  rpcUrl: str("RPC_URL", "https://soroban-testnet.stellar.org"),
  networkPassphrase: str("NETWORK_PASSPHRASE", "Test SDF Network ; September 2015"),
  cliprailId: str("CLIPRAIL_ID"),
  humanityId: str("HUMANITY_ID"),
  demoPublicBase: str("DEMO_PUBLIC_BASE").replace(/\/+$/, ""),
  demoMode: str("DEMO_MODE") === "1",
  keeper: str("KEEPER") === "1",
  keeperIntervalMs: Number(str("KEEPER_INTERVAL_MS", "5000")),
  port: Number(str("PORT", "8787")),
  corsOrigin: str("CORS_ORIGIN", "*"),
  dataDir: resolve(SERVICE_DIR, str("DATA_DIR", ".data")),
  writeToken: str("WRITE_TOKEN"),
  attestors: str("RECLAIM_ATTESTORS", "0x244897572368eadf65bfbc5aec98d8e5443a9072")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
  /** reclaim = zkFetch through Reclaim; simulated = local test attestor (testnet demos without Reclaim credentials) */
  attestorMode: attestorMode(),
  simAttestorSecret: str("SIM_ATTESTOR_SECRET") || DEFAULT_SIM_ATTESTOR_SECRET,
  simOwnerSecret: str("SIM_OWNER_SECRET") || DEFAULT_SIM_OWNER_SECRET,
  proofFixtureDir: str("PROOF_FIXTURE_DIR") ? resolve(SERVICE_DIR, str("PROOF_FIXTURE_DIR")) : "",
  /** Anon Aadhaar v2 artifacts (aadhaar-verifier.wasm, circuit_final.zkey, vkey.json); empty → /humanity/aadhaar/prove 503 */
  aadhaarArtifactsDir: str("AADHAAR_ARTIFACTS_DIR") ? resolve(SERVICE_DIR, str("AADHAAR_ARTIFACTS_DIR")) : "",
  /** UIDAI test QR + anon-aadhaar TEST key used to build demo identities */
  aadhaarTestDataDir: resolve(SERVICE_DIR, str("AADHAAR_TEST_DATA_DIR") || resolve(REPO_ROOT, "fixtures/aadhaar")),
};

export type Config = typeof config;

export const providers: Record<Platform, ProviderCfg> = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "config/providers.json"), "utf8"),
);

export const hasReclaim = (c: Config = config) => Boolean(c.reclaimAppId && c.reclaimAppSecret);
export const isSimulated = (c: Config = config) => c.attestorMode === "simulated";
/** Address whose signatures /proof returns: the simulated key, or the first configured Reclaim attestor. */
export const attestorAddress = (c: Config = config) => (isSimulated(c) ? addressOfSecret(c.simAttestorSecret) : (c.attestors[0] ?? null));
