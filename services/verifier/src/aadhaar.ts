// Anon Aadhaar (v2) Groth16 proof generation for humanity.register_zk — DEMO / TEST MODE.
//
// The QR data is the official UIDAI *test* QR re-signed with the anon-aadhaar TEST key at the
// current time, so the proof's pubkeyHash is the TEST key hash. Production does not use this: the
// user proves in their own browser from their real Aadhaar QR and the server never sees identity.
//
// Frozen convention (must match the humanity contract):
//   nullifierSeed = keccak256(utf8("cliprail:" + decimal(campaignId))) >> 3
//   signalHash    = keccak256(raw 32-byte ed25519 key of wallet) >> 3   (SDK hash("0x" + hex(pk32)))
//   public signals: [pubkeyHash, nullifier, timestamp, ageAbove18, gender, pinCode, state, nullifierSeed, signalHash]
//   Soroban bytes: G1 = be32(x)‖be32(y); G2 = be32(x.c1)‖be32(x.c0)‖be32(y.c1)‖be32(y.c0)
import { createHash, createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { StrKey } from "@stellar/stellar-sdk";
import { HttpError } from "./zkfetch.js";

export const AADHAAR_SIGNAL_NAMES = [
  "pubkeyHash",
  "nullifier",
  "timestamp",
  "ageAbove18",
  "gender",
  "pinCode",
  "state",
  "nullifierSeed",
  "signalHash",
] as const;

/** anon-aadhaar TEST (UIDAI test data) public key hash — what the demo contract config expects. */
export const TEST_PUBKEY_HASH = "15134874015316324267425466444584014077184337590635665158241104437045239495873";

export const AADHAAR_CACHE_MS = 10 * 60_000;
export const AADHAAR_TIMEOUT_MS = 120_000;
export const IDENTITY_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---------- convention ----------

const toBig = (b: Uint8Array) => BigInt("0x" + Buffer.from(b).toString("hex"));

export function nullifierSeed(campaignId: bigint): bigint {
  return toBig(keccak_256(new TextEncoder().encode(`cliprail:${campaignId.toString()}`))) >> 3n;
}

/** Raw 32-byte ed25519 key of a G... address (throws on anything else). */
export function walletKey(wallet: string): Uint8Array {
  if (!StrKey.isValidEd25519PublicKey(wallet)) throw new HttpError(400, "wallet must be a G... account address", "bad_request");
  return StrKey.decodeEd25519PublicKey(wallet);
}

/** Signal passed to the SDK: "0x" + hex(pk32). */
export const walletSignal = (wallet: string) => "0x" + Buffer.from(walletKey(wallet)).toString("hex");

export const signalHash = (wallet: string): bigint => toBig(keccak_256(walletKey(wallet))) >> 3n;

// ---------- Groth16 → Soroban bytes ----------

export interface SnarkProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}
export interface SorobanProof {
  a: string;
  b: string;
  c: string;
}

const be32 = (d: string | bigint) => BigInt(d).toString(16).padStart(64, "0");
export const g1Hex = (p: string[]) => be32(p[0]) + be32(p[1]);
export const g2Hex = (p: string[][]) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]);
export const toSorobanProof = (p: SnarkProof): SorobanProof => ({ a: g1Hex(p.pi_a), b: g2Hex(p.pi_b), c: g1Hex(p.pi_c) });

// ---------- SDK / snarkjs (CJS, loaded lazily) ----------

interface AadhaarCore {
  generateArgs(o: {
    qrData: string;
    certificateFile: string;
    nullifierSeed: bigint;
    signal?: string;
    fieldsToRevealArray?: string[];
  }): Promise<Record<string, { value: unknown }>>;
  createCustomV2TestData(o: { signedData: Uint8Array }): Uint8Array;
  convertBigIntToByteArray(b: bigint): Uint8Array;
  decompressByteArray(b: Uint8Array): Uint8Array;
  rawDataToCompressedQR(b: Uint8Array): bigint;
  extractPhoto(d: number[], len: number): { begin: number; dataLength: number };
  replaceBytesBetween(a: Uint8Array, w: Uint8Array, start: number, end: number): Uint8Array;
  returnFullId(d: Uint8Array): Record<string, string>;
}
interface SnarkJs {
  groth16: {
    fullProve(input: unknown, wasm: string, zkey: string): Promise<{ proof: SnarkProof; publicSignals: string[] }>;
    verify(vk: unknown, pub: string[], proof: SnarkProof): Promise<boolean>;
  };
}
const req = createRequire(import.meta.url);
let _core: AadhaarCore | undefined;
let _snark: SnarkJs | undefined;
const core = () => (_core ??= req("@anon-aadhaar/core") as AadhaarCore);
export const snarkjs = () => (_snark ??= req("snarkjs") as SnarkJs);

// ---------- test QR data ----------

export interface TestData {
  /** UIDAI test QR (V1, decimal string) — fixtures/aadhaar/uidai_test_qr_v1.txt */
  qrV1: string;
  /** anon-aadhaar TEST private key / certificate (PEM) */
  privateKeyPem: string;
  certificatePem: string;
}

export function loadTestData(dir: string): TestData {
  return {
    qrV1: readFileSync(join(dir, "uidai_test_qr_v1.txt"), "utf8").trim(),
    privateKeyPem: readFileSync(join(dir, "testPrivateKey.pem"), "utf8"),
    certificatePem: readFileSync(join(dir, "testCertificate.pem"), "utf8"),
  };
}

/** Deterministic photo bytes per identity: sha256("cliprail-demo-photo:<identity>:<n>") stream. */
export function identityPhoto(identity: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let off = 0, n = 0; off < len; off += 32, n++) {
    const h = createHash("sha256").update(`cliprail-demo-photo:${identity}:${n}`).digest();
    out.set(h.subarray(0, Math.min(32, len - off)), off);
  }
  return out;
}

/**
 * Fresh V2 test QR for a demo identity, signed with the TEST key at the current time.
 * The photo (the nullifier's input) is derived from `identity`: same identity → same nullifier.
 */
export function buildTestQr(td: TestData, identity: string): { qrData: string; fields: Record<string, string> } {
  const c = core();
  const dec = c.decompressByteArray(c.convertBigIntToByteArray(BigInt(td.qrV1)));
  let signed: Uint8Array = dec.slice(0, dec.length - 256);
  const { begin, dataLength } = c.extractPhoto(Array.from(signed), signed.length);
  const photoLength = dataLength - begin;
  signed = c.replaceBytesBetween(signed, identityPhoto(identity, photoLength - 1), begin + 1, begin + photoLength - 1);
  const toSign = c.createCustomV2TestData({ signedData: signed });
  const sig = createSign("sha256").update(Buffer.from(toSign)).sign({ key: td.privateKeyPem });
  const qr = c.rawDataToCompressedQR(new Uint8Array(Buffer.concat([Buffer.from(toSign), sig])));
  return { qrData: qr.toString(), fields: c.returnFullId(toSign) };
}

export async function circuitInput(td: TestData, campaignId: bigint, wallet: string, identity: string) {
  const { qrData } = buildTestQr(td, identity);
  const args = await core().generateArgs({
    qrData,
    certificateFile: td.certificatePem,
    nullifierSeed: nullifierSeed(campaignId),
    signal: walletSignal(wallet),
    fieldsToRevealArray: ["revealAgeAbove18"],
  });
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v.value]));
}

// ---------- prover service ----------

export interface ProveReq {
  campaignId: bigint;
  wallet: string;
  identity: string;
}
export interface ProveResult {
  proof: SorobanProof;
  nullifier: string;
  timestamp: string;
  ageAbove18: string;
  gender: string;
  pinCode: string;
  state: string;
  mode: "test";
  identity: string;
  /** all 9 public signals, decimal, contract order */
  publicSignals: string[];
}

export type FullProve = (input: Record<string, unknown>) => Promise<{ proof: SnarkProof; publicSignals: string[] }>;

export function artifactsAvailable(dir: string): boolean {
  return Boolean(dir) && existsSync(join(dir, "aadhaar-verifier.wasm")) && existsSync(join(dir, "circuit_final.zkey"));
}

/** Default identity: one per wallet (so every wallet is a distinct demo human unless `identity` is given). */
export const defaultIdentity = (wallet: string) => `wallet-${wallet}`;

export function resultFromSignals(proof: SnarkProof, publicSignals: string[], identity: string): ProveResult {
  const s = Object.fromEntries(AADHAAR_SIGNAL_NAMES.map((n, i) => [n, publicSignals[i]])) as Record<string, string>;
  return {
    proof: toSorobanProof(proof),
    nullifier: s.nullifier,
    timestamp: s.timestamp,
    ageAbove18: s.ageAbove18,
    gender: s.gender,
    pinCode: s.pinCode,
    state: s.state,
    mode: "test",
    identity,
    publicSignals,
  };
}

/**
 * Single-flight prover: at most one snarkjs job at a time (≈30 s, ≈3.7 GB RAM), others queue.
 * Results are cached per (campaignId, wallet, identity) for 10 min; concurrent identical
 * requests share one job.
 */
export class AadhaarProver {
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, { at: number; p: Promise<ProveResult> }>();
  private td?: TestData;
  private vk?: unknown;

  constructor(
    private opts: {
      artifactsDir: string;
      testDataDir: string;
      fullProve?: FullProve;
      now?: () => number;
      cacheMs?: number;
      timeoutMs?: number;
      /** verify each fresh proof against vkey.json before returning it (default true) */
      selfVerify?: boolean;
    },
  ) {}

  get available(): boolean {
    return artifactsAvailable(this.opts.artifactsDir) || Boolean(this.opts.fullProve);
  }

  private now = () => (this.opts.now ?? Date.now)();

  private fullProve: FullProve = async (input) => {
    if (this.opts.fullProve) return this.opts.fullProve(input);
    const d = this.opts.artifactsDir;
    return snarkjs().groth16.fullProve(input, join(d, "aadhaar-verifier.wasm"), join(d, "circuit_final.zkey"));
  };

  private async verify(proof: SnarkProof, pub: string[]) {
    if (this.opts.selfVerify === false || this.opts.fullProve) return;
    if (this.vk === undefined) {
      const p = [join(this.opts.artifactsDir, "vkey.json"), join(this.opts.testDataDir, "vkey.json")].find(existsSync);
      this.vk = p ? JSON.parse(readFileSync(p, "utf8")) : null;
    }
    if (this.vk && !(await snarkjs().groth16.verify(this.vk, pub, proof))) throw new Error("generated Aadhaar proof failed local verification");
  }

  private async run({ campaignId, wallet, identity }: ProveReq): Promise<ProveResult> {
    this.td ??= loadTestData(this.opts.testDataDir);
    const input = await circuitInput(this.td, campaignId, wallet, identity);
    const t0 = Date.now();
    const { proof, publicSignals } = await this.fullProve(input);
    await this.verify(proof, publicSignals);
    console.log(`[aadhaar] proved campaign=${campaignId} wallet=${wallet} identity=${identity} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return resultFromSignals(proof, publicSignals, identity);
  }

  /** Serialize jobs: each waits for the previous one to settle. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(fn, fn);
    this.queue = job.catch(() => undefined);
    return job;
  }

  async prove(r: ProveReq): Promise<ProveResult & { cached: boolean }> {
    if (!this.available) throw new HttpError(503, "Aadhaar proving artifacts missing (AADHAAR_ARTIFACTS_DIR)", "aadhaar_unavailable");
    walletKey(r.wallet);
    if (!IDENTITY_RE.test(r.identity)) throw new HttpError(400, "identity must match [A-Za-z0-9_-]{1,64}", "bad_request");
    const key = `${r.campaignId}|${r.wallet}|${r.identity}`;
    const now = this.now();
    for (const [k, v] of this.cache) if (now - v.at > (this.opts.cacheMs ?? AADHAAR_CACHE_MS)) this.cache.delete(k);
    const hit = this.cache.get(key);
    let cached = Boolean(hit);
    let p = hit?.p;
    if (!p) {
      p = this.enqueue(() => this.run(r));
      this.cache.set(key, { at: now, p });
      p.catch(() => this.cache.get(key)?.p === p && this.cache.delete(key));
    }
    const timeoutMs = this.opts.timeoutMs ?? AADHAAR_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new HttpError(504, `Aadhaar proving timed out after ${timeoutMs / 1000}s`, "timeout")), timeoutMs);
    });
    try {
      const res = await Promise.race([p, timeout]);
      return { ...res, cached };
    } finally {
      clearTimeout(timer);
    }
  }
}
