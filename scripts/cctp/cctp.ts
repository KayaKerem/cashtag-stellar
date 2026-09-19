// Pure CCTP encoding + the Iris attestation client. Nothing here touches a key or sends a tx,
// so every byte layout below is covered by test/cctp.test.ts.
//
// The hook-data layout is the part that must be exactly right: an inbound transfer to Stellar
// always mints to the CctpForwarder contract, and the real recipient rides along as UTF-8 strkey
// inside hookData. A wrong byte here strands the USDC with no recovery path.
import { StrKey } from "@stellar/stellar-sdk";
import { EVM_USDC_DECIMALS, IRIS_URL, STELLAR_USDC_DECIMALS } from "./config.ts";

export type Hex = `0x${string}`;

// ------------------------------------------------------------------ address encoding

/** A Stellar contract (`C…`) strkey as the 32 raw bytes CCTP puts in mintRecipient/destinationCaller. */
export function contractStrkeyToBytes32(strkey: string): Hex {
  if (!StrKey.isValidContract(strkey)) throw new Error(`not a contract strkey (C…): ${strkey}`);
  const raw = Buffer.from(StrKey.decodeContract(strkey));
  if (raw.length !== 32) throw new Error(`decoded contract id is ${raw.length} bytes, expected 32`);
  return `0x${raw.toString("hex")}`;
}

/** Inverse of contractStrkeyToBytes32; used to prove the round-trip in the dry run. */
export function bytes32ToContractStrkey(hex: string): string {
  const raw = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (raw.length !== 32) throw new Error(`expected 32 bytes, got ${raw.length}`);
  return StrKey.encodeContract(raw);
}

/** A Stellar account/contract/muxed strkey that may receive forwarded funds. */
export function isValidForwardRecipient(strkey: string): boolean {
  return StrKey.isValidEd25519PublicKey(strkey) || StrKey.isValidContract(strkey) || StrKey.isValidMed25519PublicKey(strkey);
}

// ------------------------------------------------------------------ hook data

/**
 * CctpForwarder hook data (Circle's layout):
 *   bytes  0–23  magic, Circle-reserved — all zero for Stellar-inbound transfers
 *   bytes 24–27  uint32 BE  hook version (0)
 *   bytes 28–31  uint32 BE  length L of the recipient strkey
 *   bytes 32..   the recipient strkey as UTF-8 (no trailing padding)
 */
export function buildCctpForwarderHookData(forwardRecipient: string): Hex {
  if (!isValidForwardRecipient(forwardRecipient)) throw new Error(`invalid forward recipient (expected G…/C…/M…): ${forwardRecipient}`);
  const recipient = Buffer.from(forwardRecipient, "utf8");
  const hook = Buffer.alloc(32 + recipient.length); // 0–23 stay zero
  hook.writeUInt32BE(0, 24);
  hook.writeUInt32BE(recipient.length, 28);
  recipient.copy(hook, 32);
  return `0x${hook.toString("hex")}`;
}

/** Reads back hook data built above (round-trip check; also handy when debugging a stuck transfer). */
export function parseCctpForwarderHookData(hex: string): { version: number; recipient: string; extra: Buffer } {
  const buf = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (buf.length < 32) throw new Error(`hook data too short: ${buf.length} bytes`);
  const magic = buf.subarray(0, 24);
  if (!magic.every((b) => b === 0)) throw new Error("hook magic is not the 24 zero bytes Stellar expects");
  const version = buf.readUInt32BE(24);
  const len = buf.readUInt32BE(28);
  if (buf.length < 32 + len) throw new Error(`hook data truncated: needs ${32 + len} bytes, has ${buf.length}`);
  return { version, recipient: buf.subarray(32, 32 + len).toString("utf8"), extra: buf.subarray(32 + len) };
}

// ------------------------------------------------------------------ amounts

/** "1.5" → 1500000 (6-decimal CCTP/EVM units). Parsed as a decimal string, never through a float. */
export function parseUsdc6(input: string): bigint {
  const m = input.trim().match(/^(\d+)(?:\.(\d{1,}))?$/);
  if (!m) throw new Error(`invalid USDC amount: ${input}`);
  const frac = (m[2] ?? "").slice(0, EVM_USDC_DECIMALS).padEnd(EVM_USDC_DECIMALS, "0");
  if ((m[2] ?? "").length > EVM_USDC_DECIMALS) throw new Error(`USDC has ${EVM_USDC_DECIMALS} decimals off Stellar: ${input}`);
  return BigInt(m[1]) * 10n ** BigInt(EVM_USDC_DECIMALS) + BigInt(frac || "0");
}

/** A 6-decimal CCTP amount as the 7-decimal amount Stellar mints (×10). */
export const units6to7 = (a: bigint) => a * 10n ** BigInt(STELLAR_USDC_DECIMALS - EVM_USDC_DECIMALS);

export function formatUnits(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / base}${frac ? `.${frac}` : ""}`;
}

export const fmt6 = (a: bigint) => formatUnits(a, EVM_USDC_DECIMALS);
export const fmt7 = (a: bigint) => formatUnits(a, STELLAR_USDC_DECIMALS);

/**
 * maxFee for a burn, from Iris's per-route fee schedule (`minimumFee` is in basis points).
 * Rounds up and adds a small cushion so a fee bump between quote and burn does not silently
 * demote a fast transfer to standard.
 */
export function maxFeeFromBps(amount: bigint, bps: number, cushionBps = 1): bigint {
  if (bps <= 0) return 0n;
  const scaled = BigInt(Math.ceil((bps + cushionBps) * 100)); // 1 bps = 100 units of 1e-6 per 1e6
  return (amount * scaled + 999_999n) / 1_000_000n;
}

// ------------------------------------------------------------------ Iris

export interface IrisMessage {
  status: string;
  message?: Hex;
  attestation?: Hex;
  eventNonce?: string;
  delayReason?: string | null;
  cctpVersion?: number;
  decodedMessage?: Record<string, unknown>;
}

export interface FeeQuote {
  finalityThreshold: number;
  minimumFee: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hex hashes are case-insensitive to Iris; base58 (Solana) signatures are NOT — only lowercase hex. */
export function normalizeTxHash(hash: string): string {
  return /^(0x)?[0-9a-fA-F]+$/.test(hash) ? hash.toLowerCase() : hash;
}

export async function fetchBurnFees(srcDomain: number, dstDomain: number, f: typeof fetch = fetch): Promise<FeeQuote[]> {
  const r = await f(`${IRIS_URL}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}`);
  if (!r.ok) throw new Error(`Iris fee lookup failed (${r.status}) for ${srcDomain}→${dstDomain}`);
  return (await r.json()) as FeeQuote[];
}

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onTick?: (status: string, elapsedMs: number, delayReason?: string | null) => void;
  fetch?: typeof fetch;
}

/** Polls Iris until the burn is attested. Transient 404s are normal for the first few seconds. */
export async function waitForAttestation(srcDomain: number, txHash: string, opts: PollOptions = {}): Promise<IrisMessage> {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const url = `${IRIS_URL}/v2/messages/${srcDomain}?transactionHash=${normalizeTxHash(txHash)}`;
  const started = Date.now();
  let lastStatus = "";
  for (;;) {
    let status = "pending_attestation";
    let msg: IrisMessage | undefined;
    try {
      const r = await f(url);
      if (r.status === 404) {
        status = "not_indexed_yet";
      } else if (!r.ok) {
        status = `http_${r.status}`;
      } else {
        const body = (await r.json()) as { messages?: IrisMessage[] };
        msg = body.messages?.[0];
        status = msg?.status ?? "empty";
      }
    } catch (e) {
      status = `network_error (${e instanceof Error ? e.message : String(e)})`;
    }
    if (status !== lastStatus) {
      opts.onTick?.(status, Date.now() - started, msg?.delayReason);
      lastStatus = status;
    }
    if (msg?.status === "complete" && msg.message && msg.attestation) return msg;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`attestation timed out after ${Math.round((Date.now() - started) / 1000)}s (last status: ${status}). Retry with: ${url}`);
    }
    await sleep(intervalMs);
  }
}
