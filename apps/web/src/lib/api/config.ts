export type ApiMode = "mock" | "chain";

export const API_MODE: ApiMode = process.env.NEXT_PUBLIC_API_MODE === "chain" ? "chain" : "mock";

export const CHAIN_CONFIG = {
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  cliprailId: process.env.NEXT_PUBLIC_CLIPRAIL_ID ?? "",
  humanityId: process.env.NEXT_PUBLIC_HUMANITY_ID ?? "",
  usdcSac: process.env.NEXT_PUBLIC_USDC_SAC ?? "",
  verifierUrl: process.env.NEXT_PUBLIC_VERIFIER_URL ?? "http://localhost:8787",
  // Token-protected verifier writes go through our server-side proxy (app/api/verifier), which holds WRITE_TOKEN.
  writeUrl: "/api/verifier",
};
