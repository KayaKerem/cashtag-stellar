// Creates (once) the demo EVM account used to burn USDC on Arc / Base Sepolia.
//
//   pnpm --filter cctp keygen
//
// The private key is written to scripts/.accounts/cctp.env with mode 600. That directory is
// gitignored, and the key is never printed — only the address, which is what the faucet needs.
import { EVM_ENV } from "./config.ts";
import { ensureEvmAccount } from "./evm.ts";

const { address, created } = ensureEvmAccount();

console.log(created ? "new demo EVM account created" : "demo EVM account already exists");
console.log(`address: ${address}`);
console.log(`key file: ${EVM_ENV} (mode 600, gitignored — never commit or print it)`);
console.log("");
console.log("Next: claim testnet USDC for this address at https://faucet.circle.com");
console.log('  pick "Arc Testnet" (gas is paid in USDC there, so one claim covers both)');
