// Soroban access: read-only simulation + relayer-signed invocations (serialized to avoid seq clashes).
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

/** Turn a simulation/submit failure into an HttpError with a contract error code if present. */
export function chainError(msg: string, names: Record<number, string> = {}): HttpError {
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  if (m) {
    const n = Number(m[1]);
    return new HttpError(409, `contract error #${n} ${names[n] ?? ""}`.trim(), `contract_${n}`);
  }
  return new HttpError(502, msg.slice(0, 500), "chain_error");
}

// Any account works as simulation source; it never signs.
const SIM_SOURCE = Keypair.random().publicKey();

export class Chain {
  server: rpc.Server;
  private queue: Promise<unknown> = Promise.resolve();
  private kp: Keypair | null;

  constructor(private cfg: Config = defaultConfig) {
    this.server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
    this.kp = cfg.relayerSecret ? Keypair.fromSecret(cfg.relayerSecret) : null;
  }

  private errNames(id: string) {
    return id === this.cfg.cliprailId ? CONTRACT_ERRORS : id === this.cfg.humanityId ? HUMANITY_ERRORS : {};
  }

  get relayer() {
    return this.kp?.publicKey() ?? null;
  }

  /** Read-only call via simulation; returns native JS value (u64 -> bigint, enums -> [name]). */
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
    if (rpc.Api.isSimulationError(sim)) throw chainError(sim.error, this.errNames(contractId));
    const rv = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return rv ? scValToNative(rv) : undefined;
  }

  /** Relayer-signed invocation: build -> simulate/assemble -> sign -> send -> poll. */
  invoke(contractId: string, method: string, args: xdr.ScVal[]): Promise<{ txHash: string; result: any }> {
    const run = async () => {
      if (!this.kp) throw new HttpError(503, "RELAYER_SECRET missing", "config");
      if (!contractId) throw new HttpError(503, "contract id not configured", "config");
      const account = await this.server.getAccount(this.kp.publicKey());
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.cfg.networkPassphrase })
        .addOperation(new Contract(contractId).call(method, ...args))
        .setTimeout(60)
        .build();
      let prepared;
      try {
        prepared = await this.server.prepareTransaction(tx);
      } catch (e: any) {
        throw chainError(String(e?.message ?? e), this.errNames(contractId));
      }
      prepared.sign(this.kp);
      const sent = await this.server.sendTransaction(prepared);
      if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER")
        throw new HttpError(502, `send failed: ${sent.status} ${sent.errorResult?.toXDR("base64") ?? ""}`, "send_failed");
      const got = await this.server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
      if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS)
        throw new HttpError(502, `tx ${sent.hash} ${got.status}`, "tx_failed");
      const rv = (got as rpc.Api.GetSuccessfulTransactionResponse).returnValue;
      return { txHash: sent.hash, result: rv ? scValToNative(rv) : undefined };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
