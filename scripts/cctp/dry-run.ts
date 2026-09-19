// Everything the bridge does except spending money: RPC reachability, contract specs, the Iris fee
// schedule, hook-data encoding, and the state of the demo accounts.
//
//   pnpm --filter cctp dry-run
//   pnpm --filter cctp dry-run -- --recipient G…
//
// Exits non-zero if a required check fails; funding gaps are reported as TODO, not failure.
import { execFileSync } from "node:child_process";
import { BASE_FEE, Contract, StrKey, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import { formatUnits } from "viem";
import { CHAINS, EVM_ENV, EVM_TOKEN_MESSENGER_V2, STELLAR, evmTxLink, type EvmChain } from "./config.ts";
import { buildCctpForwarderHookData, bytes32ToContractStrkey, contractStrkeyToBytes32, fetchBurnFees, fmt7, parseCctpForwarderHookData, parseUsdc6, units6to7 } from "./cctp.ts";
import { ERC20_ABI, loadEvmAccount, publicClientFor, readFunds } from "./evm.ts";
import { PASSPHRASE, identity, server, stellarSource, usdcTrustline } from "./stellar.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return fallback;
}

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const todo = (m: string) => console.log(`  todo  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

async function checkEvm(c: EvmChain) {
  console.log(`\n${c.name}  (domain ${c.domain}, chainId ${c.chainId})`);
  console.log(`  ${c.notes}`);
  const pc = publicClientFor(c);
  try {
    const [chainId, block, gasPrice] = await Promise.all([pc.getChainId(), pc.getBlockNumber(), pc.getGasPrice()]);
    chainId === c.chainId ? ok(`RPC ${c.rpcUrl} — block ${block}, gas ${formatUnits(gasPrice, 9)} gwei`) : bad(`RPC reports chainId ${chainId}, expected ${c.chainId}`);
  } catch (e) {
    bad(`RPC ${c.rpcUrl} unreachable: ${e instanceof Error ? e.message : e}`);
    return;
  }
  try {
    const [symbol, decimals, code] = await Promise.all([
      pc.readContract({ address: c.usdc, abi: ERC20_ABI, functionName: "symbol" }),
      pc.readContract({ address: c.usdc, abi: ERC20_ABI, functionName: "decimals" }),
      pc.getCode({ address: EVM_TOKEN_MESSENGER_V2 }),
    ]);
    symbol === "USDC" && Number(decimals) === 6 ? ok(`USDC ${c.usdc} — ${symbol}, ${decimals} decimals`) : bad(`USDC at ${c.usdc} looks wrong: ${symbol} / ${decimals} decimals`);
    code && code.length > 2 ? ok(`TokenMessengerV2 ${EVM_TOKEN_MESSENGER_V2} deployed (${(code.length - 2) / 2} bytes)`) : bad(`TokenMessengerV2 has no code on ${c.name}`);
  } catch (e) {
    bad(`contract reads failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const fees = await fetchBurnFees(c.domain, STELLAR.domain);
    ok(`Iris fee schedule ${c.domain}→27: ${fees.map((f) => `${f.finalityThreshold === 1000 ? "fast" : "standard"} ${f.minimumFee} bps`).join(", ")}`);
  } catch (e) {
    bad(`Iris fee lookup failed: ${e instanceof Error ? e.message : e}`);
  }
  const account = loadEvmAccount();
  if (!account) return todo(`no demo EVM account yet — run: pnpm --filter cctp keygen`);
  try {
    const funds = await readFunds(pc, c, account.address);
    const line = `${account.address}: ${formatUnits(funds.usdc, funds.usdcDecimals)} USDC, ${formatUnits(funds.gas, c.gasDecimals)} ${c.gasSymbol}`;
    funds.usdc > 0n ? ok(line) : todo(`${line} — claim testnet USDC at https://faucet.circle.com ("${c.name}")`);
  } catch (e) {
    bad(`balance read failed: ${e instanceof Error ? e.message : e}`);
  }
  if (c.explorer) ok(`explorer ${evmTxLink(c, "0x…")}`);
  else todo(`${c.name} has no public explorer configured — tx hashes are printed raw`);
}

/** Reads a SAC view function by simulation (no tx is submitted). */
async function sacView(contractId: string, method: string, source: string) {
  const acct = await server.getAccount(source);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error.split("\n")[0]);
  return sim.result ? scValToNative(sim.result.retval) : undefined;
}

async function checkStellar() {
  console.log(`\nStellar testnet  (domain ${STELLAR.domain})`);
  try {
    const l = await server.getLatestLedger();
    ok(`RPC ${STELLAR.rpcUrl} — ledger ${l.sequence}`);
  } catch (e) {
    bad(`RPC ${STELLAR.rpcUrl} unreachable: ${e instanceof Error ? e.message : e}`);
    return;
  }

  // contract specs, straight off the network
  for (const [label, id, needs] of [
    ["CctpForwarder", STELLAR.cctpForwarder, ["mint_and_forward", "get_message_transmitter", "get_token_messenger_minter"]],
    ["MessageTransmitter", STELLAR.messageTransmitter, ["receive_message"]],
    ["TokenMessengerMinter", STELLAR.tokenMessengerMinter, ["deposit_for_burn"]],
  ] as const) {
    try {
      const spec = execFileSync("stellar", ["contract", "info", "interface", "--network", "testnet", "--id", id], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const missing = needs.filter((fn) => !spec.includes(`fn ${fn}(`));
      missing.length === 0 ? ok(`${label} ${id} — ${needs.join(", ")}`) : bad(`${label} ${id} is missing ${missing.join(", ")}`);
    } catch (e) {
      bad(`${label} ${id}: could not read the contract spec (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    }
  }

  // the forwarder must point at the message transmitter / token messenger we expect
  try {
    const src = stellarSource().kp.publicKey();
    const [mt, tmm] = await Promise.all([
      sacView(STELLAR.cctpForwarder, "get_message_transmitter", src),
      sacView(STELLAR.cctpForwarder, "get_token_messenger_minter", src),
    ]);
    String(mt) === STELLAR.messageTransmitter && String(tmm) === STELLAR.tokenMessengerMinter
      ? ok("CctpForwarder is wired to the expected MessageTransmitter + TokenMessengerMinter")
      : bad(`CctpForwarder points elsewhere: transmitter ${mt}, messenger ${tmm}`);
    const paused = await sacView(STELLAR.cctpForwarder, "paused", src);
    paused === false ? ok("CctpForwarder is not paused") : bad(`CctpForwarder paused = ${paused}`);
  } catch (e) {
    bad(`CctpForwarder view calls failed: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const src = stellarSource().kp.publicKey();
    const decimals = await sacView(STELLAR.usdcSac, "decimals", src);
    Number(decimals) === 7 ? ok(`USDC SAC ${STELLAR.usdcSac} — 7 decimals (${STELLAR.usdcAsset})`) : bad(`USDC SAC reports ${decimals} decimals, expected 7`);
  } catch (e) {
    bad(`USDC SAC read failed: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const { kp, label } = stellarSource();
    const a = await server.getAccount(kp.publicKey());
    ok(`mint fee payer ${kp.publicKey()} — ${label}, sequence ${a.sequenceNumber()}`);
  } catch (e) {
    bad(`mint fee payer unusable: ${e instanceof Error ? e.message : e}`);
  }
}

async function checkRecipient() {
  console.log("\nRecipient");
  let recipient: string;
  try {
    recipient = arg("recipient") ?? identity("brand").publicKey();
  } catch (e) {
    return bad(`no recipient: ${e instanceof Error ? e.message : e}`);
  }
  console.log(`  ${recipient}`);
  if (!recipient.startsWith("G")) return ok("contract recipient — no trustline needed");
  try {
    const t = await usdcTrustline(recipient);
    if (!t.funded) bad("account does not exist on testnet — fund it at https://lab.stellar.org/account/fund");
    else if (t.exists) ok(`USDC trustline present, balance ${fmt7(t.balance)}`);
    else todo(`no USDC trustline yet — the bridge offers to add it (or pass --yes)`);
  } catch (e) {
    bad(`trustline lookup failed: ${e instanceof Error ? e.message : e}`);
  }
}

function checkEncoding() {
  console.log("\nEncoding (the part that strands funds when wrong)");
  const fwd32 = contractStrkeyToBytes32(STELLAR.cctpForwarder);
  bytes32ToContractStrkey(fwd32) === STELLAR.cctpForwarder
    ? ok(`StrKey round-trip: ${STELLAR.cctpForwarder} ↔ ${fwd32}`)
    : bad("StrKey decode/encode round-trip failed");

  const sample = "GCSGHUFTYKX43X37ISY5BFETSRBGFYPZ4KTRFJSLOWNZK5DYEQNGFKCS";
  const hook = buildCctpForwarderHookData(sample);
  const hex = hook.slice(2);
  const magicZero = hex.slice(0, 48) === "0".repeat(48);
  const version = hex.slice(48, 56) === "00000000";
  const len = parseInt(hex.slice(56, 64), 16) === 56;
  const parsed = parseCctpForwarderHookData(hook);
  magicZero && version && len && parsed.recipient === sample && hex.length / 2 === 88
    ? ok(`hook data: 24 zero bytes + version 0 + len 56 + strkey = 88 bytes, parses back to the recipient`)
    : bad(`hook data layout wrong (magic ${magicZero}, version ${version}, len ${len}, recipient ${parsed.recipient})`);

  const a = parseUsdc6("1");
  const b = parseUsdc6("0.123456");
  a === 1_000_000n && b === 123_456n && units6to7(a) === 10_000_000n
    ? ok(`decimals: 1 USDC burns as ${a} (6dp subunits, EVM) and mints ${units6to7(a)} (7dp subunits, Stellar)`)
    : bad(`decimal conversion wrong: ${a}, ${b}, ${units6to7(a)}`);

  StrKey.isValidContract(STELLAR.cctpForwarder) && StrKey.isValidEd25519PublicKey(sample) ? ok("strkey validators agree") : bad("strkey validation failed");
}

async function main() {
  console.log("CCTP V2 dry run — no funds move\n");
  console.log(`key file: ${EVM_ENV}`);
  checkEncoding();
  for (const c of Object.values(CHAINS)) await checkEvm(c);
  await checkStellar();
  await checkRecipient();
  console.log(failures === 0 ? "\nAll required checks passed." : `\n${failures} check(s) failed.`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
