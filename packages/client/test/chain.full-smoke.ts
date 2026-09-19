// Full product lifecycle smoke on the E2E testnet instance, through the same client the web uses:
//   pnpm --filter @cliprail/client smoke:full        (REFUND=1 also waits for refund_at and refunds the brand)
// 1. brand funds a require_humanity campaign with XLM → Circle USDC via Soroswap (create_campaign_with_swap)
// 2. clipper1 / clipper2 register with an Anon Aadhaar ZK proof (fresh demo identities per run) and join
// 3. demo videos carry the join codes; keeper submits close proofs + settles; clippers claim e0, holdback, e1
// 4. clipper1 off-ramps its earnings to TRY through the SEP-6 anchor (tr-mock-anchor)
// 5. REFUND=1: brand refunds the remainder after refund_at
// Needs a verifier (simulated attestor, KEEPER=1, DEMO_MODE=1, Aadhaar TEST prover) pointed at the e2e instance.
// VERIFIER_URL defaults to the origin of E2E_DEMO_PREFIX; WRITE_TOKEN defaults to services/verifier/.env.simulated.
// Secrets come from `stellar keys show` and are never printed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, contract } from "@stellar/stellar-sdk";
import {
  CIRCLE_USDC_TESTNET_SAC,
  SOROSWAP_TESTNET,
  TR_ANCHOR_HOME_DOMAIN,
  XLM_SAC_TESTNET,
  contentEnd,
  proofEnd,
  refundAt,
  settleAt,
  type CampaignParams,
  type ClipView,
} from "@cliprail/shared";
import { checkAmount, createApi, createTryRamp, isCliprailError, type CliprailApi, type Signer } from "@cliprail/client";

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
const verifierUrl = (process.env.VERIFIER_URL || new URL(e2e.E2E_DEMO_PREFIX).origin).replace(/\/+$/, "");
const writeToken = process.env.WRITE_TOKEN || readEnv("../../../services/verifier/.env.simulated").WRITE_TOKEN || undefined;
const usdcSac = process.env.USDC_SAC || CIRCLE_USDC_TESTNET_SAC;
const router = e2e.E2E_ROUTER || SOROSWAP_TESTNET.router;
const anchorDomain = process.env.ANCHOR_HOME_DOMAIN || TR_ANCHOR_HOME_DOMAIN;
const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const passphrase = Networks.TESTNET;

const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8" }).trim();
const addressOf = (id: string) => execFileSync("stellar", ["keys", "address", id], { encoding: "utf8" }).trim();
function signerFor(id: string): Signer & { address: string } {
  const kp = Keypair.fromSecret(secretOf(id));
  const { signTransaction } = contract.basicNodeSigner(kp, passphrase);
  return { address: kp.publicKey(), getAddress: async () => kp.publicKey(), signTransaction: (xdr, o) => signTransaction(xdr, o) };
}
const apiFor = (signer: Signer): CliprailApi =>
  createApi("chain", {
    rpcUrl,
    networkPassphrase: passphrase,
    cliprailId: e2e.E2E_CLIPRAIL_ID,
    humanityId: e2e.E2E_HUMANITY_ID,
    verifierUrl,
    writeToken,
    usdcSac,
    soroswapRouter: router,
    signer,
  });

const USDC = 10_000_000n;
const dec7 = (x: bigint) => `${x / USDC}.${(x % USDC).toString().padStart(7, "0")}`;
const fmt = (x: bigint) => `${dec7(x)} USDC`;
const fmtXlm = (x: bigint) => `${dec7(x)} XLM`;
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

type Result = { step: string; ok: boolean; detail: string; tx?: string };
const results: Result[] = [];
async function step<T>(name: string, fn: () => Promise<T>, detail: (r: T) => string = () => "", tx?: (r: T) => string | undefined): Promise<T> {
  try {
    const r = await fn();
    const d = detail(r);
    const h = tx?.(r);
    results.push({ step: name, ok: true, detail: d, tx: h });
    log(`PASS ${name}${d ? ` — ${d}` : ""}${h ? ` ${link(h)}` : ""}`);
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
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}${r.detail ? `\n      ${r.detail.split("\n")[0]}` : ""}${r.tx ? `\n      ${link(r.tx)}` : ""}`);
  console.log("\n==== summary table (markdown) ====");
  console.log("| # | Step | Result | Detail | Tx |\n|---|---|---|---|---|");
  results.forEach((r, i) => {
    const d = r.detail.split("\n")[0].replace(/\|/g, "\\|").slice(0, 160);
    console.log(`| ${i + 1} | ${r.step} | ${r.ok ? "PASS" : "FAIL"} | ${d} | ${r.tx ? `[${r.tx.slice(0, 8)}…](${link(r.tx)})` : ""} |`);
  });
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

/** Anchor's advertised withdraw-exchange min (SEP-6 /info), if any. */
async function anchorWithdrawMin(): Promise<number | undefined> {
  try {
    const info = (await (await fetch(`https://${anchorDomain}/sep6/info`)).json()) as Record<string, Record<string, { min_amount?: number }>>;
    const v = info["withdraw-exchange"]?.USDC?.min_amount ?? info.withdraw?.USDC?.min_amount;
    return typeof v === "number" ? v : undefined;
  } catch {
    return undefined;
  }
}

const brandS = signerFor("brand");
const c1S = signerFor("clipper1");
const c2S = signerFor("clipper2");
const arbiter = addressOf("arbiter");
const brand = apiFor(brandS);
const runId = Date.now().toString(36);
const clippers = [
  { name: "clipper1", identity: `alice-${runId}`, s: c1S, api: apiFor(c1S), delta0: 4000, delta1: 1000, earned: 0n },
  { name: "clipper2", identity: `bob-${runId}`, s: c2S, api: apiFor(c2S), delta0: 2000, delta1: 500, earned: 0n },
];
log(
  `run ${runId} verifier ${verifierUrl} (token ${writeToken ? "set" : "missing"})\n  cliprail ${e2e.E2E_CLIPRAIL_ID}\n  humanity ${e2e.E2E_HUMANITY_ID}\n  usdc ${usdcSac}\n  router ${router}\n  anchor ${anchorDomain}`,
);

let campaignId = 0n;
let params: CampaignParams | undefined;
let swapInfo = "";
let rampInfo = "";
try {
  await step("0 verifier /health", async () => {
    const h = (await (await fetch(`${verifierUrl}/health`)).json()) as { cliprailId: string; humanityId: string; attestorMode: string };
    if (h.cliprailId !== e2e.E2E_CLIPRAIL_ID) throw new Error(`verifier points at cliprail ${h.cliprailId}`);
    if (h.humanityId !== e2e.E2E_HUMANITY_ID) throw new Error(`verifier points at humanity ${h.humanityId}`);
    return h;
  }, (h) => `attestorMode=${h.attestorMode}`);

  // ---- 1. campaign funded with XLM via Soroswap
  const budget = 5n * USDC;
  const quote = await step("1a quoteSwapFunding XLM → 5 USDC", () => brand.quoteSwapFunding(budget, XLM_SAC_TESTNET, usdcSac), (q) =>
    `amountIn=${fmtXlm(q.amountIn)} amountInMax=${fmtXlm(q.amountInMax)}`,
  );
  void quote;
  const created = await step(
    "1b createCampaignWithSwap (brand, XLM → USDC escrow)",
    () =>
      brand.createCampaignWithSwap(
        {
          token: usdcSac,
          budget,
          rate_max_per_1k: 1n * USDC,
          cap_views_clip: 50_000n,
          cap_views_human: 100_000n,
          min_views: 1n,
          start: BigInt(Math.floor(nowS())) + 90n,
          epoch_len: 120n,
          epochs: 2,
          proof_window: BigInt(process.env.PROOF_WINDOW || 40),
          dispute_window: 30n,
          arbiter_window: 20n,
          claim_grace: 120n,
          holdback_bps: 2000,
          bond: 1n * USDC,
          arbiter,
          platforms: ["demo"],
          require_humanity: true,
          title: `Full smoke ${runId}`,
          brief_url: "https://example.com/full-smoke",
        },
        { tokenIn: XLM_SAC_TESTNET },
      ),
    (r) => `id=${r.id} quote=${fmtXlm(r.quote.amountIn)} max=${fmtXlm(r.amountInMax)} → ${fmt(budget)}`,
    (r) => r.txHash,
  );
  campaignId = created.id;
  swapInfo = `~${fmtXlm(created.quote.amountIn)} → ${fmt(budget)}`;
  const p = (params = (await brand.getCampaign(campaignId)).params);
  await step("1c campaign escrow check", async () => {
    const c = await brand.getCampaign(campaignId);
    if (c.balance !== budget) throw new Error(`balance ${fmt(c.balance)} != budget`);
    if (c.params.token !== usdcSac) throw new Error(`token ${c.params.token}`);
    if (!c.params.require_humanity) throw new Error("require_humanity=false");
    return c;
  }, (c) => `balance=${fmt(c.balance)} token=Circle USDC require_humanity=true`);
  log(`timeline: start=${p.start} content_end0=${contentEnd(p, 0)} proof_end0=${proofEnd(p, 0)} settle0=${settleAt(p, 0)} content_end1=${contentEnd(p, 1)} proof_end1=${proofEnd(p, 1)} settle1=${settleAt(p, 1)} refund_at=${refundAt(p)}`);

  // ---- 2. ZK humanity + join, 3a. demo videos + registerClip
  const clipIds: bigint[] = [];
  for (const [i, c] of clippers.entries()) {
    await step(`2 registerHumanZk ${c.name} (${c.identity})`, () => c.api.registerHumanZk(campaignId, { identity: c.identity }), (r) =>
      `nullifier=${r.nullifier.slice(0, 18)}…`, (r) => r.txHash);
    await step(`2 isHuman ${c.name}`, async () => {
      if (!(await c.api.isHuman(campaignId, c.s.address))) throw new Error("is_verified=false after register_zk");
      return true;
    }, () => "true");
    const j = await step(`2 join ${c.name}`, () => c.api.join(campaignId), (r) => `code=${r.code}`, (r) => r.txHash);
    const vid = `full-${runId}-${i + 1}`;
    await step(`3 demo video ${vid} (code in desc, views=100)`, () => bump(vid, { views: 100, desc: `full smoke ${j.code} #ad` }), (r) => `views=${r.views}`);
    const rc = await step(`3 registerClip ${c.name}`, () => c.api.registerClip(campaignId, "demo", vid), (r) => `clipId=${r.clipId}`, (r) => r.txHash);
    clipIds.push(rc.clipId);
    Object.assign(c, { vid, clipId: rc.clipId });
  }
  const cs = clippers as (typeof clippers[number] & { vid: string; clipId: bigint })[];

  // ---- epoch 0
  await sleepUntil(p.start + 10n, "epoch 0 content period");
  for (const c of cs) await step(`3 bump ${c.vid} +${c.delta0}`, () => bump(c.vid, { delta: c.delta0 }), (r) => `views=${r.views}`);
  await sleepUntil(contentEnd(p, 0), "content_end(0)");
  await step("3 keeper close proofs e0", () => waitClose(brand, campaignId, clipIds, 0, proofEnd(p, 0)), (vs) =>
    vs.map((v) => `clip${v.clip.id}: views=${v.epochs[0]!.views} weight=${v.epochs[0]!.weight}`).join("; "),
  );
  for (const c of cs) await step(`3 bump ${c.vid} +${c.delta1}`, () => bump(c.vid, { delta: c.delta1 }), (r) => `views=${r.views}`);
  await sleepUntil(settleAt(p, 0), "settle_at(0)");
  await step("3 keeper settle e0", () => waitSettled(brand, campaignId, 0, Number(settleAt(p, 0)) + 60), (s) =>
    `budget=${fmt(s.budget)} spent=${fmt(s.spent)} held=${fmt(s.held_total)}`,
  );
  for (const c of cs)
    await step(`3 claim e0 ${c.name}`, async () => {
      const r = await c.api.claim(campaignId, c.clipId, 0);
      c.earned += r.amount;
      return r;
    }, (r) => fmt(r.amount), (r) => r.txHash);

  // ---- epoch 1 + holdback of epoch 0
  await sleepUntil(contentEnd(p, 1), "content_end(1)");
  await step("3 keeper close proofs e1", () => waitClose(brand, campaignId, clipIds, 1, proofEnd(p, 1)), (vs) =>
    vs.map((v) => `clip${v.clip.id}: views=${v.epochs[1]!.views} weight=${v.epochs[1]!.weight}`).join("; "),
  );
  await sleepUntil(Number(proofEnd(p, 1)) + 5, "proof_end(1) (holdback release)");
  for (const c of cs)
    await step(`3 claimHoldback e0 ${c.name}`, async () => {
      const r = await c.api.claimHoldback(campaignId, c.clipId, 0);
      c.earned += r.amount;
      return r;
    }, (r) => fmt(r.amount), (r) => r.txHash);
  await sleepUntil(settleAt(p, 1), "settle_at(1)");
  await step("3 keeper settle e1", () => waitSettled(brand, campaignId, 1, Number(settleAt(p, 1)) + 60), (s) =>
    `budget=${fmt(s.budget)} spent=${fmt(s.spent)}`,
  );
  for (const c of cs)
    await step(`3 claim e1 ${c.name}`, async () => {
      const r = await c.api.claim(campaignId, c.clipId, 1);
      c.earned += r.amount;
      return r;
    }, (r) => fmt(r.amount), (r) => r.txHash);
  for (const c of cs) log(`${c.name} earned ${fmt(c.earned)}`);

  // ---- 4. clipper1 off-ramps its earnings to TRY (SEP-10 → SEP-12 → SEP-38 → SEP-6 withdraw-exchange)
  const c1 = cs[0];
  const min = await anchorWithdrawMin();
  let amount = c1.earned;
  let note = "earnings";
  if (min !== undefined && Number(dec7(amount)) < min) {
    amount = BigInt(Math.round(min * 1e7));
    note = `anchor min ${min} > earnings ${dec7(c1.earned)}; withdrew the min from balance`;
  }
  const amountUSDC = checkAmount(dec7(amount).replace(/\.?0+$/, ""), 7);
  const ramp = createTryRamp("chain", { homeDomain: anchorDomain, signer: c1S, networkPassphrase: passphrase });
  const w = await step(`4 withdrawToTRY clipper1 (${amountUSDC} USDC, ${note})`, () =>
    ramp.withdrawToTRY({ account: c1S.address, amountUSDC, onStep: (s) => log(`  ramp: ${s}`) }), (r) =>
    `${r.amountUSDC} USDC → ${r.tryPaidOut} TL (status=${r.status}${r.tryPerUsdc ? `, ${r.tryPerUsdc.toFixed(2)} TL/USDC` : ""}${r.payoutReference ? `, ref ${r.payoutReference}` : ""})`,
  (r) => r.paymentTxHash);
  rampInfo = `${w.amountUSDC} USDC → ${w.tryPaidOut} TL`;
} catch {
  // recorded in results
}

if (campaignId && params) {
  const c = await brand.getCampaign(campaignId).catch(() => null);
  if (c) log(`campaign ${campaignId}: balance=${fmt(c.balance)} settled_epochs=${c.settled_epochs} clips=${c.clips} participants=${c.participants}`);
  if (process.env.REFUND === "1") {
    await sleepUntil(Number(refundAt(params)) + 10, "refund_at");
    await step("5 refund (brand)", () => brand.refund(campaignId), (r) => fmt(r.amount), (r) => r.txHash).catch(() => {});
  } else log(`refund_at=${refundAt(params)} (run with REFUND=1 to wait and refund)`);
}
summary();
console.log(`\ncampaign=${campaignId} swap: ${swapInfo || "n/a"} | earned: ${clippers.map((c) => `${c.name} ${fmt(c.earned)}`).join(", ")} | ramp: ${rampInfo || "n/a"}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
