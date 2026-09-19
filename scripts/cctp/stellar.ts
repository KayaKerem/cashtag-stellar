// Stellar side of the bridge: keystore access, contract invocation, USDC balances and trustlines.
// Secret keys are read from the stellar CLI keystore at runtime and are never logged.
import { execFileSync } from "node:child_process";
import {
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { STELLAR } from "./config.ts";

export const PASSPHRASE = Networks.TESTNET;
export const server = new rpc.Server(STELLAR.rpcUrl);
export const horizon = new Horizon.Server(STELLAR.horizonUrl);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ keys

const kpCache = new Map<string, Keypair>();

/** Keypair for a stellar CLI identity. The secret never leaves this process. */
export function identity(name: string): Keypair {
  const hit = kpCache.get(name);
  if (hit) return hit;
  let secret: string;
  try {
    secret = execFileSync("stellar", ["keys", "show", name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    throw new Error(`stellar CLI identity "${name}" not found. Create it with: stellar keys generate ${name} --network testnet --fund`);
  }
  const kp = Keypair.fromSecret(secret);
  kpCache.set(name, kp);
  return kp;
}

const SECRET_RE = /^S[A-Z2-7]{55}$/;

/**
 * Fee payer for the Stellar-side mint. `CCTP_STELLAR_SOURCE` may be either a CLI identity name or a
 * raw S… secret; the default is the `relayer` identity. Nothing about the key is printed.
 */
export function stellarSource(): { kp: Keypair; label: string } {
  const v = process.env.CCTP_STELLAR_SOURCE?.trim();
  if (!v) return { kp: identity("relayer"), label: "relayer (stellar CLI identity)" };
  if (SECRET_RE.test(v)) return { kp: Keypair.fromSecret(v), label: "CCTP_STELLAR_SOURCE (raw secret)" };
  return { kp: identity(v), label: `${v} (stellar CLI identity)` };
}

/** Name of the CLI identity that owns `publicKey`, if the keystore has one. */
export function identityNameFor(publicKey: string): string | undefined {
  let names: string[];
  try {
    names = execFileSync("stellar", ["keys", "ls"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return undefined;
  }
  for (const n of names) {
    try {
      const pk = execFileSync("stellar", ["keys", "public-key", n], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      if (pk === publicKey) return n;
    } catch {
      /* identity may need a password; skip it */
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ invoke

export interface InvokeResult {
  ok: boolean;
  hash?: string;
  value?: unknown;
  error?: string;
  ledger?: number;
}

/** Simulate → assemble → sign → send → poll. Returns rather than throws, so callers can explain. */
export async function invoke(contractId: string, method: string, args: xdr.ScVal[], source: Keypair, timeoutSecs = 120): Promise<InvokeResult> {
  const acct = await server.getAccount(source.publicKey());
  const built = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 1000), networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(timeoutSecs)
    .build();

  const sim = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) return { ok: false, error: sim.error };

  const tx = rpc.assembleTransaction(built, sim).build();
  tx.sign(source);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") return { ok: false, error: JSON.stringify(sent.errorResult ?? sent) };

  const deadline = Date.now() + timeoutSecs * 1000;
  for (;;) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const retval = (got as { returnValue?: xdr.ScVal }).returnValue;
      return { ok: true, hash: sent.hash, value: retval ? scValToNative(retval) : undefined, ledger: (got as { ledger?: number }).ledger };
    }
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      return { ok: false, hash: sent.hash, error: JSON.stringify((got as { resultXdr?: unknown }).resultXdr ?? got.status) };
    }
    if (Date.now() > deadline) return { ok: false, hash: sent.hash, error: "timed out waiting for the tx to close" };
    await sleep(1000);
  }
}

export const scBytes = (hex: string) => nativeToScVal(Buffer.from(hex.replace(/^0x/, ""), "hex"), { type: "bytes" });

// ------------------------------------------------------------------ balances and trustlines

/**
 * SAC balance in 7-decimal subunits, via simulation (works for both G… and C… holders).
 * `sourceAccount` only pays for the (never submitted) simulation; it defaults to the fee payer.
 */
export async function sacBalance(sac: string, holder: string, sourceAccount?: string): Promise<bigint> {
  const source = sourceAccount ?? stellarSource().kp.publicKey();
  const acct = await server.getAccount(source);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(sac).call("balance", nativeToScVal(holder, { type: "address" })))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`balance(${holder}): ${sim.error.split("\n")[0]}`);
  return BigInt(sim.result ? (scValToNative(sim.result.retval) as bigint) : 0n);
}

export interface TrustlineStatus {
  exists: boolean;
  /** 7-decimal subunits; 0 when there is no trustline. */
  balance: bigint;
  funded: boolean;
}

/** Trustline + balance for the Circle testnet USDC asset on a G… account (via Horizon). */
export async function usdcTrustline(account: string): Promise<TrustlineStatus> {
  const [code, issuer] = STELLAR.usdcAsset.split(":");
  try {
    const acct = await horizon.loadAccount(account);
    const line = acct.balances.find((b) => "asset_code" in b && b.asset_code === code && b.asset_issuer === issuer) as
      | { balance: string }
      | undefined;
    if (!line) return { exists: false, balance: 0n, funded: true };
    return { exists: true, balance: BigInt(line.balance.replace(".", "")), funded: true };
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return { exists: false, balance: 0n, funded: false };
    throw e;
  }
}

/** Adds the USDC trustline with the recipient's own key (only the recipient can sign a changeTrust). */
export async function addUsdcTrustline(kp: Keypair): Promise<string> {
  const [code, issuer] = STELLAR.usdcAsset.split(":");
  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(code, issuer) }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const r = await horizon.submitTransaction(tx);
  return r.hash;
}

/** USDC held by any Stellar address, in 7-decimal subunits; null when a G… account has no trustline. */
export async function usdcBalance(address: string, sourceAccount?: string): Promise<bigint | null> {
  if (StrKey.isValidEd25519PublicKey(address)) {
    const t = await usdcTrustline(address);
    return t.exists ? t.balance : null;
  }
  return sacBalance(STELLAR.usdcSac, address, sourceAccount);
}
