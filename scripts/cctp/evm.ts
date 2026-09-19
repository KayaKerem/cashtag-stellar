// EVM side of the bridge: the demo account, viem clients, and the CCTP V2 burn.
// The private key lives in scripts/.accounts/cctp.env (gitignored, chmod 600) and is never printed.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, formatUnits, http, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ACCOUNTS_DIR, CHAINS, EVM_ENV, EVM_TOKEN_MESSENGER_V2, readEnvFile, type ChainKey, type EvmChain } from "./config.ts";

export const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** CCTP V2 TokenMessengerV2 — only the entry point this script needs. */
export const TOKEN_MESSENGER_V2_ABI = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// ------------------------------------------------------------------ account file

const KEY_VAR = "CCTP_EVM_PRIVATE_KEY";

/** The demo EVM account, or undefined when no key file exists yet. */
export function loadEvmAccount(): PrivateKeyAccount | undefined {
  const pk = process.env[KEY_VAR]?.trim() || readEnvFile(EVM_ENV)[KEY_VAR];
  if (!pk) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error(`${KEY_VAR} in ${EVM_ENV} is not a 32-byte hex key`);
  return privateKeyToAccount(pk as Hex);
}

export function requireEvmAccount(): PrivateKeyAccount {
  const a = loadEvmAccount();
  if (!a) throw new Error(`no demo EVM account yet — run: pnpm --filter cctp keygen   (writes ${EVM_ENV})`);
  return a;
}

/** Creates the demo account if it does not exist. Returns the address and whether it is new. */
export function ensureEvmAccount(): { address: Address; created: boolean } {
  const existing = loadEvmAccount();
  if (existing) return { address: existing.address, created: false };
  mkdirSync(ACCOUNTS_DIR, { recursive: true });
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  writeFileSync(
    EVM_ENV,
    [
      "# Demo EVM account for the CCTP bridge (scripts/cctp). Testnet only — never reuse on mainnet.",
      "# This directory is gitignored (.gitignore: scripts/.accounts).",
      `${KEY_VAR}=${pk}`,
      `CCTP_EVM_ADDRESS=${account.address}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(EVM_ENV, 0o600);
  return { address: account.address, created: true };
}

// ------------------------------------------------------------------ clients

export function resolveChain(key: string): EvmChain {
  const c = CHAINS[key as ChainKey];
  if (!c) throw new Error(`unknown --chain "${key}" (expected: ${Object.keys(CHAINS).join(" | ")})`);
  return c;
}

export function viemChain(c: EvmChain) {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: c.gasSymbol, symbol: c.gasSymbol, decimals: c.gasDecimals },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    ...(c.explorer ? { blockExplorers: { default: { name: "explorer", url: c.explorer } } } : {}),
  });
}

export function publicClientFor(c: EvmChain): PublicClient {
  return createPublicClient({ chain: viemChain(c), transport: http(c.rpcUrl, { retryCount: 4, retryDelay: 800, timeout: 30_000 }) }) as PublicClient;
}

export function walletClientFor(c: EvmChain, account: PrivateKeyAccount): WalletClient {
  return createWalletClient({ account, chain: viemChain(c), transport: http(c.rpcUrl, { retryCount: 4, retryDelay: 800, timeout: 30_000 }) });
}

// ------------------------------------------------------------------ preflight

export interface EvmFunds {
  usdc: bigint;
  usdcDecimals: number;
  gas: bigint;
  /** Rough gas cost of approve + burn at the current gas price. */
  estGasCost: bigint;
}

export async function readFunds(pc: PublicClient, c: EvmChain, address: Address): Promise<EvmFunds> {
  const [usdc, usdcDecimals, gas, gasPrice] = await Promise.all([
    pc.readContract({ address: c.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
    pc.readContract({ address: c.usdc, abi: ERC20_ABI, functionName: "decimals" }),
    pc.getBalance({ address }),
    pc.getGasPrice(),
  ]);
  return { usdc, usdcDecimals: Number(usdcDecimals), gas, estGasCost: gasPrice * 400_000n };
}

/** Throws a message a human can act on (which faucet, which chain) instead of a raw revert. */
export function assertFunded(c: EvmChain, address: Address, funds: EvmFunds, amount: bigint) {
  const have = formatUnits(funds.usdc, funds.usdcDecimals);
  if (funds.usdc < amount) {
    throw new Error(
      `not enough USDC on ${c.name}: have ${have}, need ${formatUnits(amount, funds.usdcDecimals)}.\n` +
        `  Fund ${address} at https://faucet.circle.com (pick "${c.name}").`,
    );
  }
  if (funds.gas === 0n) {
    throw new Error(
      `no ${c.gasSymbol} for gas on ${c.name} (address ${address}).\n` +
        (c.key === "arc"
          ? "  Arc pays gas in USDC — the same faucet claim covers it, so wait for the claim to land."
          : "  Get Base Sepolia ETH from a Sepolia faucet (e.g. https://www.alchemy.com/faucets/base-sepolia)."),
    );
  }
  if (funds.gas < funds.estGasCost) {
    console.warn(`  warning: ${c.gasSymbol} balance ${formatUnits(funds.gas, c.gasDecimals)} is close to the estimated gas cost ${formatUnits(funds.estGasCost, c.gasDecimals)}`);
  }
}

export { formatUnits as formatEvmUnits };
export { EVM_TOKEN_MESSENGER_V2 };
