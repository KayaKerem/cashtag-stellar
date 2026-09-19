import {
  normalizeClipView,
  normalizeDispute,
  normalizeEpochState,
  normalizeOption,
  type Campaign,
  type CampaignParams,
  type CampaignParamsInput,
  type CliprailApi,
  type ClipView,
  type Participant,
  type Platform,
} from "@cliprail/shared";
import { Client as CliprailClient, type CampaignParams as RawParams } from "cliprail-client";
import { Client as HumanityClient } from "humanity-client";
import { toCliprailError, type ErrorContext } from "./errors";
import { postJson } from "./http";
import { proofJsonToReclaimProof, type ProofJson } from "./proof";
import { ensureTokenBalance, rpcTokenReader, type TokenReader } from "./token";
import { mapLimit, runWrite, simulatedResult, unwrapResult, type TxLike } from "./tx";

/** Wallet signer; @creit.tech/stellar-wallets-kit and Freighter both fit (see README). */
export interface Signer {
  getAddress(): Promise<string>;
  signTransaction(xdr: string, opts: { networkPassphrase: string; address?: string }): Promise<{ signedTxXdr: string }>;
}

export interface ChainApiOptions {
  rpcUrl: string;
  networkPassphrase: string;
  cliprailId: string;
  humanityId: string;
  verifierUrl: string;
  /** Verifier bearer token (public/demo only). */
  writeToken?: string;
  /** Default `token` for createCampaign (testnet USDC SAC). */
  usdcSac?: string;
  signer: Signer;
  /** USDC balance/trustline preflight before createCampaign / challenge (default: on). */
  preflight?: boolean;
  /** Override the SAC balance reader (tests). */
  tokenReader?: TokenReader;
  /** Pause between write retries (ms). */
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

const big = (x: unknown) => (typeof x === "bigint" ? x : BigInt(x as number | string));

export function normalizeCampaign(raw: any): Campaign {
  const p = raw.params;
  const params: CampaignParams = {
    token: String(p.token),
    budget: big(p.budget),
    rate_max_per_1k: big(p.rate_max_per_1k),
    cap_views_clip: big(p.cap_views_clip),
    cap_views_human: big(p.cap_views_human),
    min_views: big(p.min_views),
    start: big(p.start),
    epoch_len: big(p.epoch_len),
    epochs: Number(p.epochs),
    proof_window: big(p.proof_window),
    dispute_window: big(p.dispute_window),
    arbiter_window: big(p.arbiter_window),
    claim_grace: big(p.claim_grace),
    holdback_bps: Number(p.holdback_bps),
    bond: big(p.bond),
    arbiter: String(p.arbiter),
    platforms: (p.platforms as unknown[]).map(String),
    require_humanity: Boolean(p.require_humanity),
    title: String(p.title),
    brief_url: String(p.brief_url),
  };
  return {
    id: big(raw.id),
    brand: String(raw.brand),
    params,
    balance: big(raw.balance),
    settled_epochs: Number(raw.settled_epochs),
    refunded: Boolean(raw.refunded),
    participants: Number(raw.participants),
    clips: Number(raw.clips),
  };
}

export function normalizeParticipant(raw: any): Participant | null {
  const p = normalizeOption<any>(raw);
  return p === null ? null : { address: String(p.address), code: String(p.code), joined_at: big(p.joined_at) };
}

/** CampaignParamsInput → bindings struct (i128/u64 as bigint, platforms as Symbol strings). */
export function toRawParams(p: CampaignParamsInput, defaultToken?: string): RawParams {
  const token = p.token ?? defaultToken;
  if (!token) throw new Error("createCampaign: token missing (pass usdcSac option)");
  return {
    token,
    budget: big(p.budget),
    rate_max_per_1k: big(p.rate_max_per_1k),
    cap_views_clip: big(p.cap_views_clip),
    cap_views_human: big(p.cap_views_human),
    min_views: big(p.min_views),
    start: big(p.start),
    epoch_len: big(p.epoch_len),
    epochs: Number(p.epochs),
    proof_window: big(p.proof_window),
    dispute_window: big(p.dispute_window),
    arbiter_window: big(p.arbiter_window),
    claim_grace: big(p.claim_grace),
    holdback_bps: Number(p.holdback_bps),
    bond: big(p.bond),
    arbiter: p.arbiter,
    platforms: [...p.platforms],
    require_humanity: p.require_humanity,
    title: p.title,
    brief_url: p.brief_url,
  };
}

export function createChainApi(opts: ChainApiOptions): CliprailApi {
  const base = {
    rpcUrl: opts.rpcUrl,
    networkPassphrase: opts.networkPassphrase,
    allowHttp: opts.rpcUrl.startsWith("http://"),
  };
  // Reads: simulation only, no source account needed.
  const reader = new CliprailClient({ ...base, contractId: opts.cliprailId });
  const humanity = new HumanityClient({ ...base, contractId: opts.humanityId });
  const signTransaction = (xdr: string, o?: { networkPassphrase?: string; address?: string }) =>
    opts.signer.signTransaction(xdr, { networkPassphrase: o?.networkPassphrase ?? opts.networkPassphrase, address: o?.address });
  const writer = (publicKey: string) => new CliprailClient({ ...base, contractId: opts.cliprailId, publicKey, signTransaction });

  const read = async <T>(p: Promise<{ result: unknown; simulation?: unknown }>, source: "cliprail" | "humanity" = "cliprail"): Promise<T> => {
    try {
      return unwrapResult<T>(simulatedResult(await p), source);
    } catch (e) {
      throw toCliprailError(e, source);
    }
  };

  const tokenReader = opts.tokenReader ?? rpcTokenReader(base);
  const ownIds = [opts.cliprailId, opts.humanityId];
  const me = async () => {
    try {
      return await opts.signer.getAddress();
    } catch (e) {
      throw toCliprailError(e);
    }
  };
  /** Before a write that pulls `amount` of `token` from the signer. */
  const preflight = async (token: string, from: string, amount: bigint) => {
    if (opts.preflight !== false) await ensureTokenBalance(tokenReader, token, from, amount);
  };

  const write = async <T>(
    build: (c: CliprailClient, me: string) => Promise<TxLike<unknown>>,
    o: { from?: string; tokenIds?: string[] } = {},
  ) => {
    const addr = o.from ?? (await me());
    const c = writer(addr);
    // token (SAC) failures carry Error(Contract, #N) too; tell them apart from cliprail codes
    const errorContext: ErrorContext = { tokenIds: [...(o.tokenIds ?? []), opts.usdcSac ?? ""], ownIds };
    return runWrite<T>(() => build(c, addr), { retries: 2, delayMs: opts.retryDelayMs ?? 1000, errorContext });
  };

  const verifier = <T>(path: string, body: unknown) =>
    postJson<T>(opts.verifierUrl, path, body, { token: opts.writeToken, fetch: opts.fetch });

  const getCampaign = async (id: bigint) => normalizeCampaign(await read(reader.get_campaign({ id })));

  return {
    async listCampaigns() {
      const n = Number(await read<bigint>(reader.campaign_count()));
      const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));
      return mapLimit(ids, 6, getCampaign);
    },
    getCampaign,
    async getEpoch(id, e) {
      return normalizeEpochState(await read(reader.get_epoch({ id, e })));
    },
    async getClips(id) {
      return (await read<unknown[]>(reader.get_clips({ campaign_id: id }))).map(normalizeClipView) as ClipView[];
    },
    async getParticipant(id, addr) {
      return normalizeParticipant(await read(reader.get_participant({ id, addr })));
    },
    async isHuman(id, addr) {
      return Boolean(await read(humanity.is_verified({ campaign_id: id, wallet: addr }), "humanity"));
    },
    async listDisputes(id) {
      return (await read<unknown[]>(reader.list_disputes({ campaign_id: id }))).map(normalizeDispute);
    },

    async createCampaign(p) {
      const params = toRawParams(p, opts.usdcSac);
      const from = await me();
      await preflight(params.token, from, params.budget);
      const r = await write<bigint>((c, brand) => c.create_campaign({ brand, params }), { from, tokenIds: [params.token] });
      return { id: big(r.result), txHash: r.txHash };
    },
    async registerHuman(id) {
      const wallet = await opts.signer.getAddress();
      const r = await verifier<{ txHash: string }>("/humanity/demo-register", { campaignId: id, wallet });
      return { txHash: r.txHash };
    },
    async join(id) {
      const r = await write<string>((c, participant) => c.join({ campaign_id: id, participant }));
      return { code: String(r.result), txHash: r.txHash };
    },
    async registerClip(id, platform: Platform, videoId) {
      const { proof } = await verifier<{ proof: ProofJson }>("/proof", { platform, videoId });
      const rp = proofJsonToReclaimProof(proof);
      const r = await write<bigint>((c, participant) =>
        c.register_clip({ campaign_id: id, participant, platform, video_id: videoId, proof: rp }),
      );
      return { clipId: big(r.result), txHash: r.txHash };
    },
    async submitClose(id, clipId, e) {
      const r = await verifier<{ txHash: string }>("/proof/submit", { campaignId: id, clipId, epoch: e });
      return { txHash: r.txHash };
    },
    async challenge(id, clipId, e, evidence) {
      const from = await me();
      const { params } = await getCampaign(id);
      await preflight(params.token, from, params.bond);
      const r = await write<bigint>(
        (c, challenger) => c.challenge({ campaign_id: id, clip_id: clipId, epoch: e, challenger, evidence }),
        { from, tokenIds: [params.token] },
      );
      return { disputeId: big(r.result), txHash: r.txHash };
    },
    async respond(disputeId) {
      return { txHash: (await write((c) => c.respond({ dispute_id: disputeId }))).txHash };
    },
    async resolve(disputeId, clipperWins) {
      return { txHash: (await write((c) => c.resolve({ dispute_id: disputeId, clipper_wins: clipperWins }))).txHash };
    },
    async finalizeDispute(disputeId) {
      return { txHash: (await write((c) => c.finalize_dispute({ dispute_id: disputeId }))).txHash };
    },
    async settleEpoch(id, e) {
      return { txHash: (await write((c) => c.settle_epoch({ campaign_id: id, epoch: e }))).txHash };
    },
    async claim(id, clipId, e) {
      const r = await write<bigint>((c) => c.claim({ campaign_id: id, clip_id: clipId, epoch: e }));
      return { amount: big(r.result), txHash: r.txHash };
    },
    async claimHoldback(id, clipId, e) {
      const r = await write<bigint>((c) => c.claim_holdback({ campaign_id: id, clip_id: clipId, epoch: e }));
      return { amount: big(r.result), txHash: r.txHash };
    },
    async refund(id) {
      const r = await write<bigint>((c) => c.refund({ campaign_id: id }));
      return { amount: big(r.result), txHash: r.txHash };
    },
  };
}
