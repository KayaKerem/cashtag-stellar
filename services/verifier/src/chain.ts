// Soroban access: read-only simulation + relayer-signed invocations.
// Build/sign/send is serialized (sequence numbers); polling happens outside the lock.
import { BASE_FEE, Contract, Keypair, TransactionBuilder, rpc, scValToNative, xdr, Account } from "@stellar/stellar-sdk";
import { config as defaultConfig, type Config } from "./config.js";
import { HttpError } from "./zkfetch.js";

export const CONTRACT_ERRORS: Record<number, string> = Object.fromEntries(
  `AlreadyInitialized NotInitialized InvalidParams CampaignNotFound NotJoined AlreadyJoined NotHuman WrongPhase
   PlatformNotAllowed VideoAlreadyRegistered ClipNotFound BadSignature UnknownAttestor UnknownOwner UrlMismatch
   MatchMismatch CodeNotFound ViewsParseError ProofReused ProofExpired EpochNotReady EpochOutOfRange AlreadySettled
   OpenDisputes AlreadyClaimed NothingToClaim AlreadyDisputed DisputeNotFound NotArbiter NotClipOwner Excluded
   RefundNotReady AlreadyRefunded PrevEpochNotSettled ProofTooLarge`
    .split(/\s+/)
    .filter(Boolean)
    .map((name, i) => [i + 1, name]),
);
export const HUMANITY_ERRORS: Record<number, string> = { 1: "AlreadyInitialized", 2: "NullifierUsed", 3: "WalletRegistered" };

type ErrSpace = { names: Record<number, string>; prefix: string };
const CLIPRAIL_SPACE: ErrSpace = { names: CONTRACT_ERRORS, prefix: "contract" };
const HUMANITY_SPACE: ErrSpace = { names: HUMANITY_ERRORS, prefix: "humanity" };

/** Simulation/submit failure -> HttpError; cliprail errors "contract_<n>", humanity "humanity_<n>". */
export function chainError(msg: string, space: ErrSpace = CLIPRAIL_SPACE): HttpError {
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  if (m) {
    const n = Number(m[1]);
    return new HttpError(409, `contract error #${n} ${space.names[n] ?? ""}`.trim(), `${space.prefix}_${n}`);
  }
  return new HttpError(502, msg.slice(0, 500), "chain_error");
}

/** Extra sends after a txBadSeq rejection. */
export const BAD_SEQ_RETRIES = 2;

/** `sendTransaction` errorResult (xdr.TransactionResult or its base64) is txBadSeq. */
export function isBadSeq(errorResult: unknown): boolean {
  if (!errorResult) return false;
  try {
    const r =
      typeof errorResult === "string"
        ? xdr.TransactionResult.fromXDR(errorResult, "base64")
        : (errorResult as xdr.TransactionResult);
    // stellar-sdk 17: `result` is a tagged union ({ type: "txBadSeq" })
    const res = (r as unknown as { result: unknown }).result as { type?: string } | (() => { switch(): { name: string } });
    const tag = typeof res === "function" ? res().switch().name : res?.type;
    return tag === "txBadSeq";
  } catch {
    return false;
  }
}

// Any account works as simulation source; it never signs.
const SIM_SOURCE = Keypair.random().publicKey();

export class Chain {
  server: rpc.Server;
  private queue: Promise<unknown> = Promise.resolve();
  /** Last sequence number we sent: RPC's getAccount lags behind a pending tx, so back-to-back sends would reuse it. */
  private lastSeq: bigint | null = null;
  private kp: Keypair | null;

  constructor(private cfg: Config = defaultConfig) {
    this.server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
    this.kp = cfg.relayerSecret ? Keypair.fromSecret(cfg.relayerSecret) : null;
  }

  private space(id: string): ErrSpace {
    return id === this.cfg.humanityId ? HUMANITY_SPACE : id === this.cfg.cliprailId ? CLIPRAIL_SPACE : { names: {}, prefix: "contract" };
  }

  get relayer() {
    return this.kp?.publicKey() ?? null;
  }

  /** Read-only call via simulation; returns native JS value (u64 -> bigint, enums -> [name], Option None -> null/undefined). */
  async read(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<any> {
    if (!contractId) throw new HttpError(503, "contract id not configured", "config");
    const tx = new TransactionBuilder(new Account(this.kp?.publicKey() ?? SIM_SOURCE, "0"), {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw chainError(sim.error, this.space(contractId));
    const rv = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return rv ? scValToNative(rv) : undefined;
  }

  /**
   * Serialized part: build -> simulate/assemble -> sign -> send. Returns the tx hash.
   * On txBadSeq the sequence is re-read from RPC and the tx rebuilt + re-signed (up to
   * BAD_SEQ_RETRIES more sends), still inside the lock.
   */
  private send(contractId: string, method: string, args: xdr.ScVal[]): Promise<string> {
    const run = async () => {
      if (!this.kp) throw new HttpError(503, "RELAYER_SECRET missing", "config");
      if (!contractId) throw new HttpError(503, "contract id not configured", "config");
      const kp = this.kp;
      /** Sequence (account seq before the tx) of the previous attempt that failed with txBadSeq. */
      let badBase: bigint | null = null;
      for (let attempt = 0; ; attempt++) {
        let base = BigInt((await this.server.getAccount(kp.publicKey())).sequenceNumber());
        if (this.lastSeq !== null && base < this.lastSeq) base = this.lastSeq;
        // RPC still reports the base that just failed: a tx we sent earlier (e.g. before a
        // restart) is pending and consumed the next number, so step past it.
        if (badBase !== null && base <= badBase) base = badBase + 1n;
        const tx = new TransactionBuilder(new Account(kp.publicKey(), base.toString()), {
          fee: BASE_FEE,
          networkPassphrase: this.cfg.networkPassphrase,
        })
          .addOperation(new Contract(contractId).call(method, ...args))
          .setTimeout(60)
          .build();
        let prepared;
        try {
          prepared = await this.server.prepareTransaction(tx);
        } catch (e: any) {
          throw chainError(String(e?.message ?? e), this.space(contractId));
        }
        prepared.sign(kp);
        const sent = await this.server.sendTransaction(prepared);
        if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
          this.lastSeq = null; // resync from RPC next time
          if (isBadSeq(sent.errorResult) && attempt < BAD_SEQ_RETRIES) {
            badBase = base;
            continue;
          }
          throw new HttpError(502, `send failed: ${sent.status} ${sent.errorResult?.toXDR("base64") ?? ""}`, "send_failed");
        }
        this.lastSeq = BigInt(prepared.sequence);
        return sent.hash;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Relayer-signed invocation; polling runs outside the send lock. */
  async invoke(contractId: string, method: string, args: xdr.ScVal[]): Promise<{ txHash: string; result: any }> {
    const hash = await this.send(contractId, method, args);
    const got = await this.server.pollTransaction(hash, { attempts: 30, sleepStrategy: () => 1000 });
    if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new HttpError(502, `tx ${hash} ${got.status}`, "tx_failed");
    const rv = (got as rpc.Api.GetSuccessfulTransactionResponse).returnValue;
    return { txHash: hash, result: rv ? scValToNative(rv) : undefined };
  }
}
