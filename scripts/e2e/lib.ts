// Chain helpers for the testnet e2e run: keystore access, invoke (simulate → assemble → sign →
// send → poll), ledger-time waits, token balances. Secret keys are read from the stellar CLI
// keystore at runtime and never printed.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ACCOUNTS_DIR = resolve(ROOT, "scripts/.accounts");
export const E2E_ENV = resolve(ACCOUNTS_DIR, "e2e.env");
export const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
export const PASSPHRASE = Networks.TESTNET;
export const server = new rpc.Server(RPC_URL);

export const txLink = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
export const contractLink = (c: string) => `https://stellar.expert/explorer/testnet/contract/${c}`;

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

export const accounts = readEnvFile(resolve(ACCOUNTS_DIR, "accounts.env"));

const kpCache = new Map<string, Keypair>();
/** Keypair for a stellar CLI identity (secret read from the keystore, never logged). */
export function identity(name: string): Keypair {
  let kp = kpCache.get(name);
  if (!kp) {
    const secret = execFileSync("stellar", ["keys", "show", name], { encoding: "utf8" }).trim();
    kp = Keypair.fromSecret(secret);
    kpCache.set(name, kp);
  }
  return kp;
}

// ------------------------------------------------------------------ ledger time

async function rawRpc<T>(method: string, params?: unknown): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = (await r.json()) as { result?: T; error?: unknown };
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j.result as T;
    } catch (e) {
      if (i >= 5) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Close time (unix s) and sequence of the latest closed ledger. */
export async function ledgerNow(): Promise<{ time: number; seq: number }> {
  const r = await rawRpc<{ sequence: number; closeTime: string }>("getLatestLedger");
  return { time: Number(r.closeTime), seq: r.sequence };
}

/**
 * Wait until the latest *closed* ledger has close time ≥ t. A tx sent right after that lands in a
 * later ledger (time > t), and simulation already sees env.ledger().timestamp() ≥ t.
 */
export async function waitLedgerTime(t: number, label = ""): Promise<number> {
  let last = -1;
  for (;;) {
    const { time } = await ledgerNow();
    if (time >= t) return time;
    if (time !== last) {
      process.stdout.write(`  … ${label} ledger t=${time}, target ${t} (${t - time}s)\n`);
      last = time;
    }
    await sleep(t - time > 8 ? 2000 : 300);
  }
}

// ------------------------------------------------------------------ invoke

export type InvokeResult = {
  ok: boolean;
  hash?: string;
  value?: unknown;
  error?: string;
  code?: number;
  /** fee charged on chain (stroops) */
  feeCharged?: number;
  /** simulated resources */
  instructions?: number;
  readBytes?: number;
  writeBytes?: number;
  minResourceFee?: number;
  ledger?: number;
};

export const contractCode = (s: string | undefined) => {
  const m = s?.match(/Error\(Contract, #(\d+)\)/);
  return m ? Number(m[1]) : undefined;
};

/** Simulate only (no tx is sent). */
export async function simulate(contractId: string, method: string, args: xdr.ScVal[], source: Keypair) {
  const acct = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  return { tx, sim };
}

export async function view(contractId: string, method: string, args: xdr.ScVal[], source?: Keypair): Promise<any> {
  const { sim } = await simulate(contractId, method, args, source ?? identity("admin"));
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error.split("\n")[0]}`);
  return sim.result ? scValToNative(sim.result.retval) : undefined;
}

/** Simulation-only negative check: returns contract error code (if any) and the raw message. */
export async function expectSimError(contractId: string, method: string, args: xdr.ScVal[], source: Keypair) {
  const { sim } = await simulate(contractId, method, args, source);
  if (rpc.Api.isSimulationError(sim)) return { ok: false, code: contractCode(sim.error), error: sim.error.split("\n")[0] };
  return { ok: true, value: sim.result ? scValToNative(sim.result.retval) : undefined };
}

/** XDR field accessor that works with both method-style (old) and property-style (new) XDR objects. */
function g(o: any, k: string): any {
  const v = o[k];
  const r = typeof v === "function" ? v.call(o) : v;
  return r && typeof r === "object" && typeof r.toBigInt === "function" ? r.toBigInt() : r;
}

export async function invoke(contractId: string, method: string, args: xdr.ScVal[], source: Keypair): Promise<InvokeResult> {
  const { tx, sim } = await simulate(contractId, method, args, source);
  if (rpc.Api.isSimulationError(sim)) {
    return { ok: false, error: sim.error.split("\n")[0], code: contractCode(sim.error) };
  }
  const res = g((sim as rpc.Api.SimulateTransactionSuccessResponse).transactionData.build(), "resources");
  const out: InvokeResult = {
    ok: false,
    instructions: Number(g(res, "instructions")),
    readBytes: Number(g(res, "diskReadBytes")),
    writeBytes: Number(g(res, "writeBytes")),
    minResourceFee: Number(sim.minResourceFee),
  };
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(source);
  let sent = await server.sendTransaction(prepared);
  for (let i = 0; sent.status === "TRY_AGAIN_LATER" && i < 10; i++) {
    await sleep(1000);
    sent = await server.sendTransaction(prepared);
  }
  out.hash = sent.hash;
  if (sent.status === "ERROR") {
    out.error = `send ERROR ${JSON.stringify(sent.errorResult ?? "")}`;
    return out;
  }
  let got: rpc.Api.GetTransactionResponse;
  for (let i = 0; ; i++) {
    got = await server.getTransaction(sent.hash);
    if (got.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break;
    if (i > 60) {
      out.error = "timeout waiting for tx";
      return out;
    }
    await sleep(1000);
  }
  if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    out.ok = true;
    out.ledger = got.ledger;
    out.feeCharged = Number(g(got.resultXdr, "feeCharged"));
    out.value = got.returnValue ? scValToNative(got.returnValue) : undefined;
  } else {
    out.ledger = (got as any).ledger;
    out.feeCharged = (got as any).resultXdr ? Number(g((got as any).resultXdr, "feeCharged")) : undefined;
    out.error = `tx FAILED (${got.status})`;
  }
  return out;
}

// ------------------------------------------------------------------ scval helpers

export const sv = {
  u32: (v: number) => nativeToScVal(v, { type: "u32" }),
  u64: (v: bigint | number) => nativeToScVal(BigInt(v), { type: "u64" }),
  i128: (v: bigint | number) => nativeToScVal(BigInt(v), { type: "i128" }),
  sym: (s: string) => nativeToScVal(s, { type: "symbol" }),
  str: (s: string) => nativeToScVal(s, { type: "string" }),
  bool: (b: boolean) => nativeToScVal(b),
  addr: (a: string) => new Address(a).toScVal(),
  bytes: (b: Buffer | Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b)),
  vec: (xs: xdr.ScVal[]) => xdr.ScVal.scvVec(xs),
};

export async function usdcBalance(sac: string, who: string): Promise<bigint> {
  return BigInt(await view(sac, "balance", [sv.addr(who)]));
}
