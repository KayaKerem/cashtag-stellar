// Circle CCTP V2 testnet registry: EVM source chains, the Stellar destination, Iris endpoints.
// Every address here is verified against Circle's contract reference; the EVM CCTP V2 contracts
// share one address across all EVM testnets.
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ACCOUNTS_DIR = resolve(ROOT, "scripts/.accounts");

/** KEY=value reader for the generated files under scripts/.accounts. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
/** Gitignored (see .gitignore: scripts/.accounts); holds the demo EVM private key. */
export const EVM_ENV = resolve(ACCOUNTS_DIR, "cctp.env");
export const BRIDGE_STATE = resolve(ACCOUNTS_DIR, "cctp-bridge.json");

// ------------------------------------------------------------------ domains

export const DOMAIN = { ethereum: 0, solana: 5, base: 6, arc: 26, stellar: 27 } as const;

// ------------------------------------------------------------------ EVM side

/** CCTP V2 on every EVM testnet (same addresses on all of them). */
export const EVM_TOKEN_MESSENGER_V2 = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;
export const EVM_MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;

export type ChainKey = "arc" | "base";

export interface EvmChain {
  key: ChainKey;
  name: string;
  chainId: number;
  domain: number;
  rpcUrl: string;
  usdc: `0x${string}`;
  /** EIP-3091 explorer root, or undefined when the chain has none. */
  explorer?: string;
  /** Native gas token symbol (Arc pays gas in USDC). */
  gasSymbol: string;
  /** Decimals of the native gas balance as the EVM reports it. */
  gasDecimals: number;
  notes: string;
}

export const CHAINS: Record<ChainKey, EvmChain> = {
  arc: {
    key: "arc",
    name: "Arc Testnet",
    chainId: 5042002,
    domain: DOMAIN.arc,
    rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    usdc: "0x3600000000000000000000000000000000000000",
    explorer: process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app",
    gasSymbol: "USDC",
    gasDecimals: 18,
    notes: "Circle's own L1: gas is paid in USDC, attestation takes seconds, Arc→Stellar fee is 0 bps.",
  },
  base: {
    key: "base",
    name: "Base Sepolia",
    chainId: 84532,
    domain: DOMAIN.base,
    rpcUrl: process.env.BASE_RPC_URL ?? "https://sepolia.base.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org",
    gasSymbol: "ETH",
    gasDecimals: 18,
    notes: "Fallback source chain; needs Sepolia ETH for gas and charges a small fast-transfer fee.",
  },
};

// ------------------------------------------------------------------ Stellar side

export const STELLAR = {
  domain: DOMAIN.stellar,
  tokenMessengerMinter: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
  messageTransmitter: "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
  /** Inbound transfers MUST target this contract; the real recipient travels in hookData. */
  cctpForwarder: "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  usdcSac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  usdcAsset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  rpcUrl: process.env.RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org",
} as const;

// ------------------------------------------------------------------ Iris (attestation service)

export const IRIS_URL = process.env.IRIS_URL ?? "https://iris-api-sandbox.circle.com";

// ------------------------------------------------------------------ decimals

/** CCTP message amounts (and EVM USDC) are 6-decimal; Stellar USDC is 7-decimal. */
export const EVM_USDC_DECIMALS = 6;
export const STELLAR_USDC_DECIMALS = 7;

/** Finality tiers understood by CCTP V2. */
export const FINALITY = { fast: 1000, standard: 2000 } as const;

// ------------------------------------------------------------------ explorer links

export const evmTxLink = (c: EvmChain, hash: string) => (c.explorer ? `${c.explorer}/tx/${hash}` : `${c.name} tx ${hash} (no public explorer)`);
export const stellarTxLink = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const stellarContractLink = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;
export const stellarAccountLink = (g: string) => `https://stellar.expert/explorer/testnet/account/${g}`;
