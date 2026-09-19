// In-memory CliprailApi for offline UI work. Phase guards and payout math come from @cliprail/shared,
// so the mock follows the same timeline as the contract; the clock runs in real time (× speed).
import {
  CLIPRAIL_ERRORS,
  canChallenge,
  canClaim,
  canClaimHoldback,
  canJoin,
  canRefund,
  canRespond,
  canResolve,
  canSettle,
  canSubmitProof,
  clipWeight,
  currentEpoch,
  disputeEnd,
  epochBudget,
  heldOf,
  holdbackShare,
  participantWeight,
  payFor,
  rateFor,
  settleAt,
  type Campaign,
  type CampaignParams,
  type CliprailApi,
  type Clip,
  type ClipEpoch,
  type Dispute,
  type EpochState,
  type Participant,
} from "@cliprail/shared";
import { CliprailError } from "./errors";

export const MOCK_ACCOUNTS = {
  brand: "GCSGHUFTYKX43X37ISY5BFETSRBGFYPZ4KTRFJSLOWNZK5DYEQNGFKCS",
  arbiter: "GDH2Z5OKYIMU7ON3ALKOU6LUVH3F7KBQQ4IUUOM7KUV54VCZGPRT54RP",
  clipper1: "GCV77O3T74VBDPL5TGCXVDYCASS2YAEFIQIHI4LUWRTWN4QAKX4OMGPD",
  clipper2: "GC3FT4YTU5ASQBZU6XHGD5RR2ZJSXWJACRUAT5KO7U4K7NJ4ORPBEMLW",
  clipper3: "GCUADPRYBBDRWZ4DBS5G3KQ6UY3XC5BAG6GXS4OYNLE4T7LPFPGDLOVJ",
} as const;
const USDC_SAC = "CCRCO347GR4FVCZACMTXZWE4EKTICARZXRRTS4R4HZZYK7R7E65UX45E";
const USDC = 10_000_000n;

export interface MockApiOptions {
  /** Connected wallet; a function lets the UI switch accounts. Default: clipper1. */
  address?: string | (() => string);
  /** Write latency (ms). Default 800; reads take a quarter of it. */
  latencyMs?: number;
  /** Clock speed multiplier (e.g. 10 = ten seconds per real second). Default 1. */
  speed?: number;
  /** Unix seconds at creation. Default: Date.now(). */
  now?: bigint;
  /** registerHumanZk extra latency (ms), simulating proof generation. Default 3000. */
  zkLatencyMs?: number;
  /** Seed demo data. Default true. */
  seed?: boolean;
}

export interface MockApi extends CliprailApi {
  /** Current mock ledger time (unix seconds). */
  now(): bigint;
  /** Jump the clock forward. */
  advance(seconds: number | bigint): void;
}

interface ClipRec {
  clip: Clip;
  epochs: (ClipEpoch | null)[];
  held: bigint[];
  pay: bigint[];
}

const err = (code: number) => new CliprailError(code, "cliprail", CLIPRAIL_ERRORS[code].message, CLIPRAIL_ERRORS[code].name);
/** Deterministic fake nullifier (decimal, < 2^253) per (campaign, identity). */
function mockNullifier(id: bigint, identity: string): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of `${id}:${identity}`) h = ((h ^ BigInt(ch.codePointAt(0)!)) * 0x100000001b3n) & ((1n << 64n) - 1n);
  let x = h;
  for (let i = 0; i < 3; i++) x = (x << 64n) | ((x * 0x9e3779b97f4a7c15n + BigInt(i)) & ((1n << 64n) - 1n));
  return (x >> 3n).toString();
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const clone = <T>(v: T): T => structuredClone(v);

export function createMockApi(opts: MockApiOptions = {}): MockApi {
  const latency = opts.latencyMs ?? 800;
  const speed = opts.speed ?? 1;
  const t0 = Date.now();
  const base = opts.now ?? BigInt(Math.floor(t0 / 1000));
  let offset = 0n;
  const now = () => base + offset + BigInt(Math.floor(((Date.now() - t0) * speed) / 1000));
  const me = () => (typeof opts.address === "function" ? opts.address() : (opts.address ?? MOCK_ACCOUNTS.clipper1));

  let rnd = 0x2f6b3a1d;
  const rand = (lo: number, hi: number) => {
    rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
    return lo + (rnd % (hi - lo + 1));
  };
  const txHash = () => Array.from({ length: 64 }, () => "0123456789abcdef"[rand(0, 15)]).join("");

  const campaigns = new Map<bigint, Campaign>();
  const participants = new Map<string, Participant>(); // `${cid}:${addr}`
  const humans = new Set<string>(); // `${cid}:${addr}`
  const clips: ClipRec[] = [];
  const epochs = new Map<string, EpochState>(); // `${cid}:${e}`
  const disputes: Dispute[] = [];

  const camp = (id: bigint) => campaigns.get(id) ?? (() => { throw err(4); })();
  const clipRec = (id: bigint) => clips.find((c) => c.clip.id === id) ?? (() => { throw err(11); })();
  const epochOf = (cid: bigint, e: number): EpochState => {
    const p = camp(cid).params;
    if (e < 0 || e >= p.epochs) throw err(22);
    const k = `${cid}:${e}`;
    let st = epochs.get(k);
    if (!st) epochs.set(k, (st = { total_weight: 0n, open_disputes: 0, settled: false, budget: 0n, rate: 0n, spent: 0n, held_total: 0n, held_survived: 0n }));
    return st;
  };

  /** Per-participant raw/weight for epoch e (Excluded clips don't count). */
  function weights(cid: bigint, e: number) {
    const p = camp(cid).params;
    const raw = new Map<string, bigint>();
    for (const r of clips) {
      const ce = r.clip.campaign_id === cid ? r.epochs[e] : null;
      if (ce && ce.status !== "Excluded") raw.set(r.clip.owner, (raw.get(r.clip.owner) ?? 0n) + ce.weight);
    }
    const out = new Map<string, { raw: bigint; weight: bigint }>();
    let total = 0n;
    for (const [a, r] of raw) {
      const w = participantWeight(p, r);
      out.set(a, { raw: r, weight: w });
      total += w;
    }
    return { per: out, total };
  }
  const refreshTotal = (cid: bigint, e: number) => (epochOf(cid, e).total_weight = weights(cid, e).total);

  // ---- state transitions (shared by seeding and the api)

  function createCampaignS(brand: string, params: CampaignParams): bigint {
    if (params.epochs < 1 || params.budget <= 0n || params.epoch_len <= 0n || params.holdback_bps > 10_000 || params.platforms.length === 0)
      throw err(3);
    const id = BigInt(campaigns.size + 1);
    campaigns.set(id, { id, brand, params: clone(params), balance: params.budget, settled_epochs: 0, refunded: false, participants: 0, clips: 0 });
    return id;
  }
  function joinS(cid: bigint, addr: string, t: bigint): string {
    const c = camp(cid);
    if (!canJoin(c.params, t)) throw err(8);
    if (c.params.require_humanity && !humans.has(`${cid}:${addr}`)) throw err(7);
    if (participants.has(`${cid}:${addr}`)) throw err(6);
    const code = "CR-" + Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[rand(0, 31)]).join("");
    participants.set(`${cid}:${addr}`, { address: addr, code, joined_at: t });
    c.participants++;
    return code;
  }
  function registerClipS(cid: bigint, addr: string, platform: string, videoId: string, t: bigint): bigint {
    const c = camp(cid);
    if (!participants.has(`${cid}:${addr}`)) throw err(5);
    if (!canJoin(c.params, t)) throw err(8);
    if (!c.params.platforms.includes(platform)) throw err(9);
    if (clips.some((r) => r.clip.campaign_id === cid && r.clip.platform === platform && r.clip.video_id === videoId)) throw err(10);
    const id = BigInt(clips.length + 1);
    const baseline = BigInt(rand(100, 3000));
    const n = c.params.epochs;
    clips.push({
      clip: { id, campaign_id: cid, owner: addr, platform, video_id: videoId, baseline, hwm: baseline, registered_at: t, first_epoch: currentEpoch(c.params, t) },
      epochs: Array(n).fill(null),
      held: Array(n).fill(0n),
      pay: Array(n).fill(0n),
    });
    c.clips++;
    return id;
  }
  function submitCloseS(cid: bigint, clipId: bigint, e: number, t: bigint, views?: bigint) {
    const c = camp(cid);
    const r = clipRec(clipId);
    if (r.clip.campaign_id !== cid) throw err(11);
    epochOf(cid, e);
    if (!canSubmitProof(c.params, e, t)) throw err(8);
    if (e < r.clip.first_epoch) throw err(21);
    const v = views ?? r.clip.hwm + BigInt(rand(400, 9000));
    if (v > r.clip.hwm) r.clip.hwm = v;
    const prev = r.epochs[e]; // re-proof within the window keeps the highest count
    const baseline = prev?.baseline ?? (e > 0 && r.epochs[e - 1] ? r.epochs[e - 1]!.views : r.clip.baseline);
    const best = prev && prev.views > v ? prev.views : v;
    r.epochs[e] = {
      baseline, views: best, weight: clipWeight(c.params, baseline, best),
      status: prev?.status ?? "Active", claimed: false, alive: false, holdback_claimed: false,
    };
    if (e > 0 && r.epochs[e - 1]) r.epochs[e - 1]!.alive = true;
    refreshTotal(cid, e);
  }
  function challengeS(cid: bigint, clipId: bigint, e: number, who: string, evidence: string, t: bigint): bigint {
    const c = camp(cid);
    const r = clipRec(clipId);
    if (!canChallenge(c.params, e, t)) throw err(8);
    const ce = r.epochs[e];
    if (!ce) throw err(11);
    if (ce.status !== "Active") throw err(27);
    ce.status = "Challenged";
    epochOf(cid, e).open_disputes++;
    const id = BigInt(disputes.length + 1);
    disputes.push({ id, campaign_id: cid, clip_id: clipId, epoch: e, challenger: who, evidence, status: "Open", opened_at: t });
    return id;
  }
  const disputeOf = (id: bigint) => disputes.find((d) => d.id === id) ?? (() => { throw err(28); })();
  function closeDispute(d: Dispute, clipperWins: boolean) {
    d.status = clipperWins ? "ClipperWon" : "ChallengerWon";
    clipRec(d.clip_id).epochs[d.epoch]!.status = clipperWins ? "Active" : "Excluded";
    epochOf(d.campaign_id, d.epoch).open_disputes--;
    refreshTotal(d.campaign_id, d.epoch);
  }
  function settleS(cid: bigint, e: number, t: bigint) {
    const c = camp(cid);
    const st = epochOf(cid, e);
    if (st.settled) throw err(23);
    if (!canSettle(c.params, e, t)) throw err(21);
    if (st.open_disputes > 0) throw err(24);
    const prev = e > 0 ? epochOf(cid, e - 1) : null;
    if (prev && !prev.settled) throw err(34);
    const { per, total } = weights(cid, e);
    st.total_weight = total;
    st.budget = epochBudget(c.params, e, prev);
    st.rate = rateFor(c.params, st.budget, total);
    st.spent = 0n;
    st.held_total = 0n;
    for (const r of clips) {
      const ce = r.clip.campaign_id === cid ? r.epochs[e] : null;
      if (!ce || ce.status === "Excluded") continue;
      const pw = per.get(r.clip.owner)!;
      r.pay[e] = payFor(st.rate, pw.weight, pw.raw, ce.weight);
      r.held[e] = heldOf(c.params, e, r.pay[e]);
      st.spent += r.pay[e];
      st.held_total += r.held[e];
    }
    st.settled = true;
    c.settled_epochs++;
  }
  function claimS(cid: bigint, clipId: bigint, e: number, who: string, t: bigint): bigint {
    const c = camp(cid);
    const r = clipRec(clipId);
    if (r.clip.owner !== who) throw err(30);
    if (!epochOf(cid, e).settled) throw err(21);
    if (!canClaim(c.params, t)) throw err(8);
    const ce = r.epochs[e];
    if (!ce) throw err(26);
    if (ce.status === "Excluded") throw err(31);
    if (ce.claimed) throw err(25);
    const amount = r.pay[e] - r.held[e];
    if (amount <= 0n) throw err(26);
    ce.claimed = true;
    c.balance -= amount;
    return amount;
  }

  // ---- seed: 2 campaigns, 3 participants, clips, one open dispute

  if (opts.seed !== false) {
    const t = now();
    const A = MOCK_ACCOUNTS;
    const common = {
      token: USDC_SAC, rate_max_per_1k: 2n * USDC, cap_views_clip: 50_000n, cap_views_human: 100_000n, min_views: 100n,
      epoch_len: 600n, proof_window: 120n, dispute_window: 120n, arbiter_window: 60n, claim_grace: 600n,
      holdback_bps: 2000, bond: 5n * USDC, arbiter: A.arbiter,
    };
    // #1: epoch 0 in its challenge window (one open dispute), epoch 1 content.
    const s1 = t - 740n;
    const c1 = createCampaignS(A.brand, {
      ...common, budget: 3000n * USDC, start: s1, epochs: 3, platforms: ["youtube", "demo"], require_humanity: true,
      title: "Yaz koleksiyonu klipleri", brief_url: "https://example.com/brief/yaz",
    });
    for (const a of [A.clipper1, A.clipper2, A.clipper3]) {
      humans.add(`${c1}:${a}`);
      joinS(c1, a, s1 + 30n);
    }
    const k1 = registerClipS(c1, A.clipper1, "youtube", "dQw4w9WgXcQ", s1 + 60n);
    const k2 = registerClipS(c1, A.clipper2, "demo", "demo-kedi-01", s1 + 90n);
    const k3 = registerClipS(c1, A.clipper3, "demo", "demo-kahve-07", s1 + 120n);
    registerClipS(c1, A.clipper1, "demo", "demo-sahil-03", s1 + 650n);
    submitCloseS(c1, k1, 0, s1 + 610n, clips[0].clip.baseline + 11_000n);
    submitCloseS(c1, k2, 0, s1 + 615n);
    submitCloseS(c1, k3, 0, s1 + 620n, clips[2].clip.baseline + 48_000n);
    challengeS(c1, k3, 0, A.clipper1, "İzlenmeler bot trafiği gibi görünüyor: https://example.com/kanit", s1 + 730n);

    // #2: epoch 0 settled (claimable), epoch 1 content.
    const s2 = t - 1000n;
    const c2 = createCampaignS(A.brand, {
      ...common, budget: 1000n * USDC, start: s2, epochs: 2, platforms: ["demo"], require_humanity: false,
      title: "Uygulama lansmanı", brief_url: "https://example.com/brief/lansman",
    });
    joinS(c2, A.clipper1, s2 + 10n);
    joinS(c2, A.clipper2, s2 + 20n);
    const k5 = registerClipS(c2, A.clipper1, "demo", "demo-lansman-01", s2 + 40n);
    const k6 = registerClipS(c2, A.clipper2, "demo", "demo-lansman-02", s2 + 50n);
    submitCloseS(c2, k5, 0, s2 + 630n);
    submitCloseS(c2, k6, 0, s2 + 640n);
    settleS(c2, 0, s2 + 900n);
  }

  // ---- api

  const read = async <T>(f: () => T): Promise<T> => {
    await sleep(latency / 4);
    return clone(f());
  };
  const zkNullifiers = new Set<string>();
  const zkLatency = opts.zkLatencyMs ?? 3000;
  const write = async <T extends object>(f: (t: bigint, who: string) => T): Promise<T & { txHash: string }> => {
    await sleep(latency);
    return { ...f(now(), me()), txHash: txHash() };
  };

  return {
    now,
    advance: (s) => void (offset += BigInt(s)),

    listCampaigns: () => read(() => [...campaigns.values()]),
    getCampaign: (id) => read(() => camp(id)),
    getEpoch: (id, e) =>
      read(() => {
        const st = { ...epochOf(id, e) };
        if (st.settled) // survived = held of clips that stayed alive into e+1
          st.held_survived = clips.reduce((s, r) => (r.clip.campaign_id === id && r.epochs[e]?.alive ? s + r.held[e] : s), 0n);
        return st;
      }),
    getClips: (id) => read(() => clips.filter((r) => r.clip.campaign_id === id).map(({ clip, epochs }) => ({ clip, epochs }))),
    getParticipant: (id, addr) => read(() => participants.get(`${id}:${addr}`) ?? null),
    isHuman: (id, addr) => read(() => humans.has(`${id}:${addr}`)),
    listDisputes: (id) => read(() => disputes.filter((d) => d.campaign_id === id)),

    createCampaign: (p) =>
      write((_t, who) => ({ id: createCampaignS(who, { ...p, token: p.token ?? USDC_SAC, platforms: [...p.platforms] }) })),
    registerHuman: (id) =>
      write((_t, who) => {
        camp(id);
        if (humans.has(`${id}:${who}`)) throw new CliprailError(3, "humanity", "Bu cüzdan zaten doğrulanmış.", "WalletRegistered");
        humans.add(`${id}:${who}`);
        return {};
      }),
    registerHumanZk: async (id, o) => {
      await sleep(zkLatency); // proving takes a while on the real verifier
      return write((_t, who) => {
        camp(id);
        const nullifier = mockNullifier(id, o?.identity ?? `wallet-${who}`);
        if (humans.has(`${id}:${who}`)) throw new CliprailError(3, "humanity", "Bu cüzdan zaten doğrulanmış.", "WalletRegistered");
        if (zkNullifiers.has(`${id}:${nullifier}`)) throw new CliprailError(2, "humanity", "Bu kimlik bu kampanyada zaten kullanıldı.", "NullifierUsed");
        zkNullifiers.add(`${id}:${nullifier}`);
        humans.add(`${id}:${who}`);
        return { nullifier };
      });
    },
    join: (id) => write((t, who) => ({ code: joinS(id, who, t) })),
    registerClip: (id, platform, videoId) => write((t, who) => ({ clipId: registerClipS(id, who, platform, videoId, t) })),
    submitClose: (id, clipId, e) => write((t) => (submitCloseS(id, clipId, e, t), {})),
    challenge: (id, clipId, e, evidence) => write((t, who) => ({ disputeId: challengeS(id, clipId, e, who, evidence, t) })),
    respond: (disputeId) =>
      write((t, who) => {
        const d = disputeOf(disputeId);
        const r = clipRec(d.clip_id);
        if (r.clip.owner !== who) throw err(30);
        if (d.status !== "Open" || !canRespond(camp(d.campaign_id).params, d.epoch, t)) throw err(8);
        d.status = "Responded";
        r.epochs[d.epoch]!.status = "Responded";
        return {};
      }),
    resolve: (disputeId, clipperWins) =>
      write((t, who) => {
        const d = disputeOf(disputeId);
        const p = camp(d.campaign_id).params;
        if (who !== p.arbiter) throw err(29);
        if (d.status !== "Responded" || !canResolve(p, d.epoch, t)) throw err(8);
        closeDispute(d, clipperWins);
        return {};
      }),
    finalizeDispute: (disputeId) =>
      write((t) => {
        const d = disputeOf(disputeId);
        const p = camp(d.campaign_id).params;
        // no response by dispute_end → challenger wins; arbiter silent until settle_at → clipper wins
        if (d.status === "Open" && t >= disputeEnd(p, d.epoch)) closeDispute(d, false);
        else if (d.status === "Responded" && t >= settleAt(p, d.epoch)) closeDispute(d, true);
        else throw err(8);
        return {};
      }),
    settleEpoch: (id, e) => write((t) => (settleS(id, e, t), {})),
    claim: (id, clipId, e) => write((t, who) => ({ amount: claimS(id, clipId, e, who, t) })),
    claimHoldback: (id, clipId, e) =>
      write((t, who) => {
        const c = camp(id);
        const r = clipRec(clipId);
        if (r.clip.owner !== who) throw err(30);
        const st = epochOf(id, e);
        if (!st.settled) throw err(21);
        if (!canClaimHoldback(c.params, e, t)) throw err(8);
        const ce = r.epochs[e];
        if (!ce || !ce.alive || r.held[e] === 0n) throw err(26);
        if (ce.holdback_claimed) throw err(25);
        const survived = clips.reduce((s, x) => (x.clip.campaign_id === id && x.epochs[e]?.alive ? s + x.held[e] : s), 0n);
        const amount = holdbackShare(r.held[e], { held_total: st.held_total, held_survived: survived });
        ce.holdback_claimed = true;
        c.balance -= amount;
        return { amount };
      }),
    refund: (id) =>
      write((t) => {
        const c = camp(id);
        if (c.refunded) throw err(33);
        if (!canRefund(c.params, t)) throw err(32);
        const amount = c.balance;
        c.balance = 0n;
        c.refunded = true;
        return { amount };
      }),
  };
}
