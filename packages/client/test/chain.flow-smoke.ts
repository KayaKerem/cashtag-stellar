// Full-lifecycle smoke on the E2E testnet instance through the PUBLIC verifier, using the client exactly like the web:
//   pnpm --filter @cliprail/client smoke:flow        (REFUND=1 also waits for refund_at and refunds the brand)
// Needs a verifier in simulated-attestor mode with KEEPER=1 and DEMO_MODE=1, pointed at the e2e instance.
// PROOF_WINDOW (s, default 40) overrides the campaign proof window.
// VERIFIER_URL defaults to the origin of E2E_DEMO_PREFIX; WRITE_TOKEN defaults to services/verifier/.env.simulated.
// The keeper submits close proofs and settles; this script only registers, bumps demo views, and claims.
// Secrets come from `stellar keys show` and are never printed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, contract } from "@stellar/stellar-sdk";
import { contentEnd, proofEnd, refundAt, settleAt, type CampaignParams, type ClipView } from "@cliprail/shared";
import { createApi, isCliprailError, type CliprailApi, type Signer } from "@cliprail/client";

const readEnv = (rel: string): Record<string, string> => {
  const f = fileURLToPath(new URL(rel, import.meta.url));
  if (!existsSync(f)) return {};
  return Object.fromEntries(
    readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
};
const e2e = readEnv("../../../scripts/.accounts/e2e.env");
const accounts = readEnv("../../../scripts/.accounts/accounts.env");
const verifierUrl = (process.env.VERIFIER_URL || new URL(e2e.E2E_DEMO_PREFIX).origin).replace(/\/+$/, "");
const writeToken = process.env.WRITE_TOKEN || readEnv("../../../services/verifier/.env.simulated").WRITE_TOKEN || undefined;
const usdcSac = accounts.USDC_SAC || e2e.USDC_SAC;
const passphrase = Networks.TESTNET;

const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8" }).trim();
function signerFor(id: string): Signer & { address: string } {
  const kp = Keypair.fromSecret(secretOf(id));
  const { signTransaction } = contract.basicNodeSigner(kp, passphrase);
  return { address: kp.publicKey(), getAddress: async () => kp.publicKey(), signTransaction: (xdr, o) => signTransaction(xdr, o) };
}
const apiFor = (signer: Signer): CliprailApi =>
  createApi("chain", {
    rpcUrl: process.env.RPC_URL || "https://soroban-testnet.stellar.org",
    networkPassphrase: passphrase,
    cliprailId: e2e.E2E_CLIPRAIL_ID,
    humanityId: e2e.E2E_HUMANITY_ID,
    verifierUrl,
    writeToken,
    usdcSac,
    signer,
  });

const USDC = 10_000_000n;
const fmt = (x: bigint) => `${x / USDC}.${(x % USDC).toString().padStart(7, "0")} USDC`;
const link = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const T0 = Date.now();
const nowS = () => Date.now() / 1000;
const log = (m: string) => console.log(`[+${String(Math.round((Date.now() - T0) / 1000)).padStart(3)}s] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const sleepUntil = (tS: bigint | number, label: string) => {
  const ms = Number(tS) * 1000 - Date.now();
  if (ms > 0) log(`waiting ${Math.ceil(ms / 1000)} s for ${label}`);
  return sleep(ms);
};

type Result = { step: string; ok: boolean; detail: string };
const results: Result[] = [];
async function step<T>(name: string, fn: () => Promise<T>, detail: (r: T) => string = () => ""): Promise<T> {
  try {
    const r = await fn();
    const d = detail(r);
    results.push({ step: name, ok: true, detail: d });
    log(`PASS ${name}${d ? ` — ${d}` : ""}`);
    return r;
  } catch (e) {
    const d = isCliprailError(e) ? `CliprailError code=${e.code} name=${e.errorName} source=${e.source} "${e.message}"` : String((e as Error)?.stack ?? e);
    results.push({ step: name, ok: false, detail: d });
    log(`FAIL ${name} — ${d}`);
    throw e;
  }
}
function summary() {
  console.log("\n==== summary ====");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}${r.detail ? `\n      ${r.detail.split("\n")[0]}` : ""}`);
}

async function bump(id: string, body: { views?: number; delta?: number; desc?: string }) {
  const res = await fetch(`${verifierUrl}/demo/videos/${id}/bump`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(writeToken ? { authorization: `Bearer ${writeToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { views?: number; error?: string };
  if (!res.ok) throw new Error(`bump ${id}: HTTP ${res.status} ${data.error ?? ""}`);
  return data;
}

/** Polls getClips until every clip has proven views for epoch e (or the deadline passes). */
async function waitClose(api: CliprailApi, id: bigint, clipIds: bigint[], e: number, deadlineS: bigint): Promise<ClipView[]> {
  for (;;) {
    const clips = (await api.getClips(id)).filter((v) => clipIds.includes(v.clip.id));
    const done = clips.filter((v) => (v.epochs[e]?.views ?? 0n) > 0n);
    if (done.length === clipIds.length) return clips;
    if (nowS() > Number(deadlineS) + 10) {
      const missing = clipIds.filter((c) => !done.some((v) => v.clip.id === c));
      throw new Error(`keeper did not prove epoch ${e} for clip(s) ${missing.join(",")} before proof_end ${deadlineS}`);
    }
    await sleep(3000);
  }
}
async function waitSettled(api: CliprailApi, id: bigint, e: number, deadlineS: number) {
  for (;;) {
    const st = await api.getEpoch(id, e);
    if (st.settled) return st;
    if (nowS() > deadlineS) throw new Error(`keeper did not settle epoch ${e} by ${deadlineS}`);
    await sleep(3000);
  }
}

const brandS = signerFor("brand");
const c1S = signerFor("clipper1");
const c2S = signerFor("clipper2");
const arbiterS = signerFor("arbiter");
const brand = apiFor(brandS);
const cl1 = apiFor(c1S);
const cl2 = apiFor(c2S);
const clippers = [
  { name: "clipper1", s: c1S, api: cl1, delta0: 4000, delta1: 1000 },
  { name: "clipper2", s: c2S, api: cl2, delta0: 2000, delta1: 500 },
];
log(`verifier ${verifierUrl} (token ${writeToken ? "set" : "missing"})\n  cliprail ${e2e.E2E_CLIPRAIL_ID}\n  humanity ${e2e.E2E_HUMANITY_ID}\n  usdc ${usdcSac}`);

let campaignId = 0n;
let params: CampaignParams | undefined;
try {
  const health = await step("verifier /health", async () => {
    const h = (await (await fetch(`${verifierUrl}/health`)).json()) as { cliprailId: string; attestorMode: string };
    if (h.cliprailId !== e2e.E2E_CLIPRAIL_ID) throw new Error(`verifier points at ${h.cliprailId}`);
    return h;
  }, (h) => `attestorMode=${h.attestorMode}`);
  void health;

  const start = BigInt(Math.floor(nowS())) + 60n;
  const created = await step("createCampaign (brand)", () =>
    brand.createCampaign({
      budget: 5n * USDC,
      rate_max_per_1k: 1n * USDC,
      cap_views_clip: 50_000n,
      cap_views_human: 100_000n,
      min_views: 1n,
      start,
      epoch_len: 120n,
      epochs: 2,
      proof_window: BigInt(process.env.PROOF_WINDOW || 40),
      dispute_window: 30n,
      arbiter_window: 20n,
      claim_grace: 120n,
      holdback_bps: 2000,
      bond: 1n * USDC,
      arbiter: arbiterS.address,
      platforms: ["demo"],
      require_humanity: true,
      title: "Flow smoke",
      brief_url: "https://example.com/flow-smoke",
    }), (r) => `id=${r.id} ${link(r.txHash)}`);
  campaignId = created.id;
  const p = (params = (await brand.getCampaign(campaignId)).params);
  log(`timeline: start=${p.start} content_end0=${contentEnd(p, 0)} proof_end0=${proofEnd(p, 0)} settle0=${settleAt(p, 0)} content_end1=${contentEnd(p, 1)} proof_end1=${proofEnd(p, 1)} settle1=${settleAt(p, 1)} refund_at=${refundAt(p)}`);

  const tag = Date.now().toString(36);
  const clipIds: bigint[] = [];
  for (const [i, c] of clippers.entries()) {
    await step(`registerHuman ${c.name}`, () => c.api.registerHuman(campaignId), (r) => link(r.txHash));
    await step(`isHuman ${c.name}`, async () => {
      if (!(await c.api.isHuman(campaignId, c.s.address))) throw new Error("not verified after demo-register");
      return true;
    });
    const j = await step(`join ${c.name}`, () => c.api.join(campaignId), (r) => `code=${r.code} ${link(r.txHash)}`);
    const vid = `fs-${tag}-${i + 1}`;
    await step(`bump ${vid} views=100`, () => bump(vid, { views: 100, desc: `flow smoke ${j.code} #ad` }), (r) => `views=${r.views}`);
    const rc = await step(`registerClip ${c.name} (${vid})`, () => c.api.registerClip(campaignId, "demo", vid), (r) => `clipId=${r.clipId} ${link(r.txHash)}`);
    clipIds.push(rc.clipId);
    Object.assign(c, { vid, clipId: rc.clipId });
  }
  const cs = clippers as (typeof clippers[number] & { vid: string; clipId: bigint })[];

  // ---- epoch 0
  await sleepUntil(p.start + 10n, "epoch 0 content period");
  for (const c of cs) await step(`bump ${c.vid} +${c.delta0}`, () => bump(c.vid, { delta: c.delta0 }), (r) => `views=${r.views}`);
  await sleepUntil(contentEnd(p, 0), "content_end(0)");
  const v0 = await step("keeper close proofs e0 (poll getClips)", () => waitClose(brand, campaignId, clipIds, 0, proofEnd(p, 0)), (vs) =>
    vs.map((v) => `clip${v.clip.id}: views=${v.epochs[0]!.views} baseline=${v.epochs[0]!.baseline} weight=${v.epochs[0]!.weight}`).join("; "),
  );
  void v0;
  // epoch-1 views (the e0 close proofs are already on chain)
  for (const c of cs) await step(`bump ${c.vid} +${c.delta1}`, () => bump(c.vid, { delta: c.delta1 }), (r) => `views=${r.views}`);
  await sleepUntil(settleAt(p, 0), "settle_at(0)");
  const st0 = await step("keeper settle e0 (poll getEpoch)", () => waitSettled(brand, campaignId, 0, Number(settleAt(p, 0)) + 60), (s) =>
    `budget=${fmt(s.budget)} rate=${s.rate} total_weight=${s.total_weight} spent=${fmt(s.spent)} held_total=${fmt(s.held_total)}`,
  );
  void st0;
  for (const c of cs) await step(`claim e0 ${c.name}`, () => c.api.claim(campaignId, c.clipId, 0), (r) => `${fmt(r.amount)} ${link(r.txHash)}`);

  // ---- epoch 1 + holdback of epoch 0
  await sleepUntil(contentEnd(p, 1), "content_end(1)");
  await step("keeper close proofs e1 (poll getClips)", () => waitClose(brand, campaignId, clipIds, 1, proofEnd(p, 1)), (vs) =>
    vs.map((v) => `clip${v.clip.id}: views=${v.epochs[1]!.views} weight=${v.epochs[1]!.weight} e0.alive=${v.epochs[0]?.alive}`).join("; "),
  );
  await sleepUntil(Number(proofEnd(p, 1)) + 5, "proof_end(1) (holdback release)");
  for (const c of cs) await step(`claimHoldback e0 ${c.name}`, () => c.api.claimHoldback(campaignId, c.clipId, 0), (r) => `${fmt(r.amount)} ${link(r.txHash)}`);
  await sleepUntil(settleAt(p, 1), "settle_at(1)");
  await step("keeper settle e1 (poll getEpoch)", () => waitSettled(brand, campaignId, 1, Number(settleAt(p, 1)) + 60), (s) =>
    `budget=${fmt(s.budget)} rate=${s.rate} total_weight=${s.total_weight} spent=${fmt(s.spent)}`,
  );
  for (const c of cs) await step(`claim e1 ${c.name}`, () => c.api.claim(campaignId, c.clipId, 1), (r) => `${fmt(r.amount)} ${link(r.txHash)}`);
} catch {
  // recorded in results
}

if (campaignId && params) {
  const c = await brand.getCampaign(campaignId).catch(() => null);
  if (c) log(`campaign ${campaignId}: balance=${fmt(c.balance)} settled_epochs=${c.settled_epochs} clips=${c.clips} participants=${c.participants}`);
  if (process.env.REFUND === "1") {
    await sleepUntil(Number(refundAt(params)) + 10, "refund_at");
    await step("refund (brand)", () => brand.refund(campaignId), (r) => `${fmt(r.amount)} ${link(r.txHash)}`).catch(() => {});
  } else log(`refund_at=${refundAt(params)} (run with REFUND=1 to wait and refund)`);
}
summary();
process.exit(results.every((r) => r.ok) ? 0 : 1);
