// Circle CCTP V2: burn USDC on an EVM testnet, have Circle attest it, mint native USDC on Stellar.
//
//   pnpm --filter cctp bridge -- --amount 1 --chain arc --fast
//   pnpm --filter cctp bridge -- --amount 5 --recipient G… --chain base
//   pnpm --filter cctp bridge -- --resume 0x<burn tx hash> --chain arc   # attest + mint only
//
// Flags
//   --amount <usdc>      amount to bridge, in USDC (6 decimals off Stellar). Default 1.
//   --recipient <G…|C…>  who receives the USDC on Stellar. Default: the `brand` CLI identity.
//   --chain arc|base     source chain. Default arc (0 bps fee, seconds of latency, gas in USDC).
//   --fast               request Fast finality (1000) instead of Standard (2000).
//   --yes                add the recipient's USDC trustline without asking, if we hold its key.
//   --resume <0x…>       skip the burn and finish an earlier one (attestation + Stellar mint).
//
// Inbound transfers must mint to the CctpForwarder contract — a G… account cannot be a CCTP
// mintRecipient. The real recipient travels as UTF-8 strkey inside hookData, and anyone may then
// call mint_and_forward on Stellar to complete the transfer atomically.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { formatUnits } from "viem";
import { BRIDGE_STATE, FINALITY, STELLAR, evmTxLink, stellarAccountLink, stellarContractLink, stellarTxLink } from "./config.ts";
import {
  buildCctpForwarderHookData,
  contractStrkeyToBytes32,
  fetchBurnFees,
  fmt6,
  fmt7,
  isValidForwardRecipient,
  maxFeeFromBps,
  parseCctpForwarderHookData,
  parseUsdc6,
  units6to7,
  waitForAttestation,
} from "./cctp.ts";
import {
  EVM_TOKEN_MESSENGER_V2,
  ERC20_ABI,
  TOKEN_MESSENGER_V2_ABI,
  assertFunded,
  publicClientFor,
  readFunds,
  requireEvmAccount,
  resolveChain,
  viemChain,
  walletClientFor,
} from "./evm.ts";
import { addUsdcTrustline, identity, identityNameFor, invoke, scBytes, stellarSource, usdcBalance, usdcTrustline } from "./stellar.ts";

// ------------------------------------------------------------------ args

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const AMOUNT = parseUsdc6(arg("amount", "1")!);
const CHAIN = resolveChain(arg("chain", "arc")!);
const FAST = flag("fast");
const AUTO_YES = flag("yes");
const RESUME = arg("resume");

const t0 = Date.now();
const step = (n: string) => console.log(`\n── ${n}  (+${Math.round((Date.now() - t0) / 1000)}s)`);

async function confirm(question: string): Promise<boolean> {
  if (AUTO_YES) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

// ------------------------------------------------------------------ recipient

async function resolveRecipient(): Promise<string> {
  const given = arg("recipient");
  if (given) {
    if (!isValidForwardRecipient(given)) throw new Error(`--recipient is not a valid Stellar address: ${given}`);
    return given;
  }
  return identity("brand").publicKey();
}

/** A G… recipient needs a USDC trustline before anything can land; offer to add it if we can sign. */
async function ensureRecipientCanReceive(recipient: string): Promise<void> {
  if (!recipient.startsWith("G")) return;
  const t = await usdcTrustline(recipient);
  if (!t.funded) {
    throw new Error(`recipient ${recipient} does not exist on testnet. Fund it first: https://lab.stellar.org/account/fund`);
  }
  if (t.exists) {
    console.log(`  trustline ok — recipient holds ${fmt7(t.balance)} USDC`);
    return;
  }
  const name = identityNameFor(recipient);
  console.log(`  recipient ${recipient} has NO USDC trustline (${STELLAR.usdcAsset})`);
  if (!name) {
    throw new Error(
      `cannot add the trustline: only ${recipient} can sign a changeTrust and its key is not in the stellar CLI keystore.\n` +
        `  Ask the owner to run:  stellar tx new change-trust --source <key> --line ${STELLAR.usdcAsset} --network testnet`,
    );
  }
  if (!(await confirm(`  add the USDC trustline now using the "${name}" identity?`))) {
    throw new Error("aborted: recipient has no USDC trustline, so a bridged mint would fail");
  }
  const hash = await addUsdcTrustline(identity(name));
  console.log(`  trustline added  ${stellarTxLink(hash)}`);
}

// ------------------------------------------------------------------ burn

async function burn(recipient: string, hookData: `0x${string}`, fwd32: `0x${string}`): Promise<`0x${string}`> {
  const account = requireEvmAccount();
  const pc = publicClientFor(CHAIN);
  const wc = walletClientFor(CHAIN, account);

  const chainId = await pc.getChainId();
  if (chainId !== CHAIN.chainId) throw new Error(`${CHAIN.rpcUrl} reports chainId ${chainId}, expected ${CHAIN.chainId} for ${CHAIN.name}`);

  const funds = await readFunds(pc, CHAIN, account.address);
  console.log(`  source ${account.address} on ${CHAIN.name} (chainId ${chainId})`);
  console.log(`  balances: ${formatUnits(funds.usdc, funds.usdcDecimals)} USDC, ${formatUnits(funds.gas, CHAIN.gasDecimals)} ${CHAIN.gasSymbol} for gas`);
  assertFunded(CHAIN, account.address, funds, AMOUNT);

  const threshold = FAST ? FINALITY.fast : FINALITY.standard;
  const fees = await fetchBurnFees(CHAIN.domain, STELLAR.domain).catch(() => []);
  const quoted = fees.find((f) => f.finalityThreshold === threshold);
  const maxFee = maxFeeFromBps(AMOUNT, quoted?.minimumFee ?? 0);
  console.log(`  route ${CHAIN.name} (domain ${CHAIN.domain}) → Stellar (domain ${STELLAR.domain}), ${FAST ? "fast" : "standard"} finality (${threshold})`);
  console.log(`  fee schedule: ${fees.map((f) => `${f.finalityThreshold}=${f.minimumFee}bps`).join(", ") || "unavailable"} → maxFee ${fmt6(maxFee)} USDC`);

  const allowance = await pc.readContract({ address: CHAIN.usdc, abi: ERC20_ABI, functionName: "allowance", args: [account.address, EVM_TOKEN_MESSENGER_V2] });
  if (allowance < AMOUNT) {
    const approveHash = await wc.writeContract({
      account,
      chain: viemChain(CHAIN),
      address: CHAIN.usdc,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [EVM_TOKEN_MESSENGER_V2, AMOUNT],
    });
    console.log(`  approve ${fmt6(AMOUNT)} USDC → TokenMessengerV2\n    ${evmTxLink(CHAIN, approveHash)}`);
    const r = await pc.waitForTransactionReceipt({ hash: approveHash, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`approve reverted (${evmTxLink(CHAIN, approveHash)})`);
  } else {
    console.log(`  allowance already covers the burn (${fmt6(allowance)} USDC)`);
  }

  // Simulate first: a revert here is cheap, a stranded transfer is not.
  const { request } = await pc.simulateContract({
    account,
    address: EVM_TOKEN_MESSENGER_V2,
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: "depositForBurnWithHook",
    args: [AMOUNT, STELLAR.domain, fwd32, CHAIN.usdc, fwd32, maxFee, threshold, hookData],
  });
  const burnHash = await wc.writeContract(request);
  console.log(`  depositForBurnWithHook ${fmt6(AMOUNT)} USDC → ${recipient}\n    ${evmTxLink(CHAIN, burnHash)}`);
  const receipt = await pc.waitForTransactionReceipt({ hash: burnHash, timeout: 300_000 });
  if (receipt.status !== "success") throw new Error(`burn reverted (${evmTxLink(CHAIN, burnHash)})`);
  console.log(`  burned in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);
  return burnHash;
}

// ------------------------------------------------------------------ main

async function main() {
  const recipient = await resolveRecipient();
  const fwd32 = contractStrkeyToBytes32(STELLAR.cctpForwarder);
  const hookData = buildCctpForwarderHookData(recipient);

  console.log(`CCTP V2  ${CHAIN.name} → Stellar testnet`);
  console.log(`  amount        ${fmt6(AMOUNT)} USDC — burns ${AMOUNT} (6dp) and mints ${units6to7(AMOUNT)} (7dp on Stellar)`);
  console.log(`  recipient     ${recipient}`);
  console.log(`  mintRecipient ${STELLAR.cctpForwarder} (CctpForwarder)`);
  console.log(`  destCaller    same contract — a G… account can never be a CCTP mintRecipient`);
  console.log(`  hookData      ${hookData.slice(0, 26)}…${hookData.slice(-8)} (${(hookData.length - 2) / 2} bytes)`);
  // paranoia: read our own encoding back before anything is burned
  const parsed = parseCctpForwarderHookData(hookData);
  if (parsed.recipient !== recipient || parsed.version !== 0) throw new Error("hook data round-trip failed — refusing to burn");

  step("1/4  recipient trustline");
  await ensureRecipientCanReceive(recipient);
  const before = (await usdcBalance(recipient)) ?? 0n;
  console.log(`  balance before: ${fmt7(before)} USDC`);

  step("2/4  burn on the source chain");
  const burnHash = RESUME ? (RESUME as `0x${string}`) : await burn(recipient, hookData, fwd32);
  if (RESUME) console.log(`  resuming burn ${evmTxLink(CHAIN, burnHash)}`);

  step("3/4  Circle attestation (Iris)");
  const attested = await waitForAttestation(CHAIN.domain, burnHash, {
    onTick: (status, ms, reason) => console.log(`  ${status}${reason ? ` (${reason})` : ""} … ${Math.round(ms / 1000)}s`),
  });
  console.log(`  attested: message ${attested.message!.length / 2 - 1} bytes, attestation ${attested.attestation!.length / 2 - 1} bytes, nonce ${attested.eventNonce ?? "?"}`);

  step("4/4  mint on Stellar (CctpForwarder.mint_and_forward)");
  const { kp: feePayer, label } = stellarSource();
  console.log(`  fee payer ${feePayer.publicKey()} — ${label}`);
  const r = await invoke(STELLAR.cctpForwarder, "mint_and_forward", [scBytes(attested.message!), scBytes(attested.attestation!)], feePayer);
  if (!r.ok) {
    throw new Error(
      `mint_and_forward failed: ${r.error}\n` +
        `  The attestation stays valid — rerun with:  pnpm --filter cctp bridge -- --resume ${burnHash} --chain ${CHAIN.key} --recipient ${recipient}`,
    );
  }
  console.log(`  minted  ${stellarTxLink(r.hash!)}`);

  const after = (await usdcBalance(recipient)) ?? 0n;
  const delta = after - before;
  console.log(`\n  recipient balance: ${fmt7(before)} → ${fmt7(after)} USDC  (+${fmt7(delta)})`);
  console.log(`  forwarder ${stellarContractLink(STELLAR.cctpForwarder)}`);
  console.log(`  recipient ${recipient.startsWith("G") ? stellarAccountLink(recipient) : stellarContractLink(recipient)}`);

  const expected = units6to7(AMOUNT);
  writeFileSync(
    BRIDGE_STATE,
    JSON.stringify({ at: new Date().toISOString(), chain: CHAIN.key, amountUsdc6: AMOUNT.toString(), recipient, burnHash, stellarTx: r.hash, delta7: delta.toString() }, null, 2) + "\n",
  );

  if (delta <= 0n) throw new Error("the recipient's USDC balance did not increase — check the mint tx above");
  if (delta !== expected) console.log(`  note: expected +${fmt7(expected)} but saw +${fmt7(delta)} (a CCTP fee or a concurrent payment explains the gap)`);
  console.log(`\nOK — ${fmt6(AMOUNT)} USDC moved ${CHAIN.name} → Stellar in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`Next: pnpm --filter cctp fund-campaign -- --budget ${fmt6(AMOUNT)}`);
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
