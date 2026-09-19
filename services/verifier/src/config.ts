import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const SERVICE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(SERVICE_DIR, "../..");

// .env first; then local fallbacks written by scripts/ (never override explicit env).
dotenv.config({ path: resolve(SERVICE_DIR, ".env"), quiet: true });
for (const f of ["deploy.env", "accounts.env", "secrets.env"]) {
  const p = resolve(REPO_ROOT, "scripts/.accounts", f);
  if (existsSync(p)) dotenv.config({ path: p, quiet: true });
}

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
  proofFixtureDir: str("PROOF_FIXTURE_DIR") ? resolve(SERVICE_DIR, str("PROOF_FIXTURE_DIR")) : "",
};

export type Config = typeof config;

export const providers: Record<Platform, ProviderCfg> = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "config/providers.json"), "utf8"),
);

export const hasReclaim = (c: Config = config) => Boolean(c.reclaimAppId && c.reclaimAppSecret);
