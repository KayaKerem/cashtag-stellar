// Business operations shared by HTTP routes and the keeper.
import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import type { Config, Platform } from "./config.js";
import type { Chain } from "./chain.js";
import { HttpError, type ProofResult, type ProofService } from "./zkfetch.js";
import { address, bytesN, reclaimProofToScVal, u32, u64 } from "./scval.js";
import { contentEnd, proofEnd, settleAt, type TimelineParams } from "./timeline.js";

export const SLACK = 6; // s: ledger time lags wall clock a little
export const PROOF_MARGIN = 30; // s: don't start a fresh zkFetch this close to proof_end

/** Permanent submit_proof failures: retrying (even with a new proof) cannot help. */
const PERMANENT = new Set([4, 5, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 22, 27, 31, 35].map((n) => `contract_${n}`));
/** Proof itself is unusable -> fetch a new one next time. */
const REFETCH = new Set(["contract_19", "contract_20"]);

export const tag = (v: unknown) => (Array.isArray(v) ? String(v[0]) : String(v)); // enum -> "Name"
const E = (code: number, msg: string) => new HttpError(409, msg, `contract_${code}`);

/** nullifier = sha256(utf8("demo" ‖ decimal(campaignId) ‖ wallet)) */
export const demoNullifier = (campaignId: bigint, wallet: string) =>
  createHash("sha256").update(`demo${campaignId.toString()}${wallet}`, "utf8").digest();

export interface PrecheckInput {
  campaign: { id: unknown; settled_epochs: unknown; refunded?: boolean; params: TimelineParams };
  clip: { campaign_id: unknown; first_epoch: unknown };
  clipEpoch: { status: unknown; views: unknown } | null | undefined;
  disputes: { epoch: unknown; status: unknown }[];
  campaignId: bigint;
  epoch: number;
  now: number;
  haveProof: boolean;
}

/** Mirrors submit_proof's checks so we never burn a zkFetch on a doomed call. Throws HttpError (codes = contract codes). */
export function closePrecheck(x: PrecheckInput) {
  const { campaign: c, clip, epoch: e, now } = x;
  const p = c.params;
  if (BigInt(clip.campaign_id as any) !== x.campaignId) throw E(11, "clip does not belong to campaign");
  if (e >= Number(p.epochs) || e < Number(clip.first_epoch)) throw E(22, "epoch out of range for this clip");
  const ce = contentEnd(p, e);
  if (now < ce + SLACK) throw E(21, `proof window opens at ${ce} (in ${Math.ceil(ce + SLACK - now)} s)`);
  const pe = proofEnd(p, e);
  if (now >= pe - (x.haveProof ? SLACK : PROOF_MARGIN)) throw E(8, `proof window closed (proof_end ${pe})`);
  const st = x.clipEpoch ? tag(x.clipEpoch.status) : "Active";
  if (st === "Excluded") throw E(31, "clip excluded for this epoch");
  if (st !== "Active") throw E(27, "clip epoch is disputed");
  for (let k = Number(c.settled_epochs); k < e; k++) {
    const open = x.disputes.some((d) => Number(d.epoch) === k && ["Open", "Responded"].includes(tag(d.status)));
    if (open || now < settleAt(p, k) + SLACK) throw E(34, `epoch ${k} not settleable yet`);
  }
}

export const MAX_FETCHES = 2; // zkFetch attempts per (clip, epoch): protects the quota

type Job = {
  proofEnd: number;
  fetches?: number;
  proof?: ProofResult;
  running?: Promise<{ txHash: string; views: string }>;
  done?: { txHash: string; views: string };
  failed?: HttpError;
};

export class Ops {
  /** Shared (clipId, epoch) registry for HTTP + keeper. */
  jobs = new Map<string, Job>();

  constructor(
    public cfg: Config,
    public proofs: Pick<ProofService, "get">,
    public chain: Pick<Chain, "read" | "invoke">,
    private now = () => Date.now() / 1000,
  ) {}

  jobState(clipId: bigint, e: number) {
    return this.jobs.get(`${clipId}:${e}`);
  }

  prune() {
    const t = this.now();
    for (const [k, j] of this.jobs) if (!j.running && t > j.proofEnd + 120) this.jobs.delete(k);
  }

  /** Close proof for (clip, epoch): prechecks on-chain, fetches (or reuses) the proof, sends submit_proof. */
  submitClose(campaignId: bigint, clipId: bigint, e: number): Promise<{ txHash: string; views: string }> {
    const key = `${clipId}:${e}`;
    const job = this.jobs.get(key);
    if (job?.done) return Promise.resolve(job.done);
    if (job?.failed) return Promise.reject(job.failed);
    if (job?.running) return job.running;

    const run = async () => {
      const id = this.cfg.cliprailId;
      const [campaign, clip, clipEpoch, disputes] = await Promise.all([
        this.chain.read(id, "get_campaign", [u64(campaignId)]),
        this.chain.read(id, "get_clip", [u64(clipId)]),
        this.chain.read(id, "get_clip_epoch", [u64(clipId), u32(e)]),
        this.chain.read(id, "list_disputes", [u64(campaignId)]),
      ]);
      const j = this.jobs.get(key)!; // registered below before the first await resolves
      j.proofEnd = proofEnd(campaign.params, e);
      closePrecheck({ campaign, clip, clipEpoch, disputes: disputes ?? [], campaignId, epoch: e, now: this.now(), haveProof: !!j.proof });
      if (!j.proof) {
        if ((j.fetches ?? 0) >= MAX_FETCHES) throw new HttpError(429, "zkFetch attempts exhausted for this clip/epoch", "fetch_limit");
        j.fetches = (j.fetches ?? 0) + 1;
      }
      j.proof ??= await this.proofs.get(String(clip.platform) as Platform, String(clip.video_id), { purpose: "close" });
      try {
        const { txHash } = await this.chain.invoke(id, "submit_proof", [u64(campaignId), u64(clipId), u32(e), reclaimProofToScVal(j.proof.proof)]);
        j.done = { txHash, views: j.proof.extracted.views };
        return j.done;
      } catch (err: any) {
        if (REFETCH.has(err?.code)) j.proof = undefined;
        if (PERMANENT.has(err?.code)) j.failed = err;
        throw err;
      }
    };
    const p = run().finally(() => {
      const j = this.jobs.get(key);
      if (j) j.running = undefined;
    });
    // register before awaiting so concurrent callers share it
    const j = this.jobs.get(key) ?? { proofEnd: Number.MAX_SAFE_INTEGER };
    j.running = p;
    this.jobs.set(key, j);
    return p;
  }

  async demoRegister(campaignId: bigint, wallet: string) {
    if (!StrKey.isValidEd25519PublicKey(wallet) && !StrKey.isValidContract(wallet))
      throw new HttpError(400, "invalid wallet address", "bad_request");
    const { txHash } = await this.chain.invoke(this.cfg.humanityId, "register", [
      u64(campaignId),
      bytesN(demoNullifier(campaignId, wallet)),
      address(wallet),
    ]);
    return { txHash };
  }
}
