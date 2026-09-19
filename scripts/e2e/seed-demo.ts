// Seeds a recordable ClipRail demo on testnet: 1–3 staggered campaigns with demo parameters
// (docs/ARCHITECTURE.md §6), humanity + join + demo videos + clip registrations, then prints a
// local-time timeline of what happens next and what to click in the web UI (docs/DEMO.md).
//
//   pnpm --filter e2e seed -- --mode real  [--campaigns 2] [--stagger 240] [--drive] [--live]
//   pnpm --filter e2e seed -- --mode local [--campaigns 1] [--drive]
//
// --mode real   main deployment (deploy.env). Opening proofs come from the verifier's POST /proof
//               (real Reclaim zkFetch); humanity via /humanity/demo-register; views via
//               /demo/videos/:id/bump. Needs the verifier running with Reclaim credentials,
//               DEMO_MODE=1 and (for the lifecycle) KEEPER=1.
// --mode local  e2e instance (e2e.env) with the local SIMULATED ATTESTOR (proofgen.ts). No HTTP;
//               the script itself is the keeper when --drive is given.
// --drive       bumps demo views on schedule (c1 +5000, c2 +3000, c3 +9000 before content_end(0);
//               c1 +3000 before content_end(1)). local: also submits proofs, challenges the bot
//               clip, finalizes, settles, claims, claims holdback and refunds.
// --live        (real only) the LAST campaign leaves clipper1 unregistered/unjoined so humanity →
//               join → register can be done on screen; its demo video is pre-created with the
//               (deterministic) participant code.
// --no-bot      skip clipper3's "bot" clip.
// Other flags: --lead <s> (first start = now + lead, default 60), --verifier <url>, --web <url>.
// Secret keys are read from the stellar CLI keystore and never printed.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Address, type xdr } from "@stellar/stellar-sdk";
import {
  ROOT,
  ACCOUNTS_DIR,
  E2E_ENV,
  accounts,
  identity,
  invoke,
  expectSimError,
  view,
  ledgerNow,
  readEnvFile,
  sleep,
  sv,
  txLink,
  contractLink,
  type InvokeResult,
} from "./lib.ts";
import { makeProof } from "./proofgen.ts";
import { baseBudget, clipWeight, participantWeight, rateFor, payFor, splitPay, holdbackShare } from "@cliprail/shared";
import { structToScVal, reclaimProofToScVal } from "../../services/verifier/src/scval.ts";
import type { ProofJson } from "../../services/verifier/src/proof.ts";

// ------------------------------------------------------------------ args

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const MODE_ARG = arg("mode");
if (MODE_ARG !== "real" && MODE_ARG !== "local") {
  console.error("usage: seed-demo.ts --mode real|local [--campaigns N] [--stagger s] [--lead s] [--drive] [--live] [--no-bot]");
  process.exit(64);
}
const MODE: "real" | "local" = MODE_ARG;
const N = Number(arg("campaigns") ?? 2);
const STAGGER = Number(arg("stagger") ?? 240);
const LEAD = Number(arg("lead") ?? 60);
const DRIVE = flag("drive");
const LIVE = flag("live");
const BOT = !flag("no-bot");
if (!Number.isInteger(N) || N < 1 || N > 3) throw new Error("--campaigns must be 1..3");
if (!(STAGGER >= 0) || !(LEAD >= 0)) throw new Error("--stagger / --lead must be ≥ 0");
if (LIVE && MODE === "local") throw new Error("--live needs --mode real (the web register flow uses real Reclaim proofs)");

const verifierEnv = readEnvFile(resolve(ROOT, "services/verifier/.env"));
const VERIFIER = (arg("verifier") || process.env.VERIFIER_URL || "http://localhost:8787").replace(/\/$/, "");
const WEB = (arg("web") || process.env.WEB_URL || "http://localhost:3000").replace(/\/$/, "");
const WRITE_TOKEN = process.env.WRITE_TOKEN ?? verifierEnv.WRITE_TOKEN ?? "";

const env = MODE === "real" ? readEnvFile(resolve(ACCOUNTS_DIR, "deploy.env")) : readEnvFile(E2E_ENV);
const CLIPRAIL = MODE === "real" ? env.CLIPRAIL_ID : env.E2E_CLIPRAIL_ID;
const HUMANITY = MODE === "real" ? env.HUMANITY_ID : env.E2E_HUMANITY_ID;
const USDC = accounts.USDC_SAC;
if (!CLIPRAIL || !HUMANITY) {
  console.error(MODE === "real" ? "deploy.env missing: run scripts/deploy.sh" : "e2e.env missing: pnpm --filter e2e deploy");
  process.exit(1);
}

// ------------------------------------------------------------------ demo parameters (ARCHITECTURE §6)

const P = {
  budget: 200_000_000n, // 20 USDC
  epochs: 2,
  rate_max_per_1k: 10_000_000n, // 1 USDC / 1k views
  cap_views_clip: 50_000n,
  cap_views_human: 100_000n,
  min_views: 100n,
  epoch_len: 300,
  proof_window: 90,
  dispute_window: 90,
  arbiter_window: 60,
  claim_grace: 300,
  holdback_bps: 2000,
  bond: 50_000_000n, // 5 USDC
};
const INITIAL_VIEWS = { c1: 1200, c2: 800, c3: 300 };
const BUMP_E0 = { c1: 5000, c2: 3000, c3: 9000 };
const BUMP_E1_C1 = 3000;

const T = (start: number) => {
  const contentEnd = (e: number) => start + (e + 1) * P.epoch_len;
  const proofEnd = (e: number) => contentEnd(e) + P.proof_window;
  const challengeEnd = (e: number) => proofEnd(e) + P.dispute_window / 2;
  const disputeEnd = (e: number) => proofEnd(e) + P.dispute_window;
  const settleAt = (e: number) => disputeEnd(e) + P.arbiter_window;
  const refundAt = settleAt(P.epochs - 1) + P.claim_grace;
  return { start, contentEnd, proofEnd, challengeEnd, disputeEnd, settleAt, refundAt };
};
type Timeline = ReturnType<typeof T>;

// ------------------------------------------------------------------ helpers

const KEYS = ["c1", "c2", "c3"] as const;
type K = (typeof KEYS)[number];
const NAME: Record<K, string> = { c1: "clipper1", c2: "clipper2", c3: "clipper3" };
const ADDR: Record<K, string> = { c1: accounts.CLIPPER1, c2: accounts.CLIPPER2, c3: accounts.CLIPPER3 };

const clock = (unix: number) => new Date(unix * 1000).toLocaleTimeString("tr-TR", { hour12: false });
const nowStr = () => clock(Date.now() / 1000);
const usdc = (x: bigint) => `${x < 0n ? "-" : ""}${(Number(x < 0n ? -x : x) / 1e7).toFixed(2)}`;
const fmt = (v: unknown) => (typeof v === "bigint" ? v.toString() : typeof v === "object" ? JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) : String(v));

/** Same nullifier scheme as the verifier's /humanity/demo-register (services/verifier/src/ops.ts). */
const demoNullifier = (cid: bigint, wallet: string) => createHash("sha256").update(`demo${cid}${wallet}`, "utf8").digest();

/** Participant code exactly like contracts/cliprail/src/lib.rs participant_code(). */
function participantCode(cid: bigint, who: string): string {
  const pre = Buffer.alloc(8);
  pre.writeBigUInt64BE(cid);
  const h = createHash("sha256").update(Buffer.concat([pre, new Address(who).toScVal().toXDR()])).digest();
  let n = h.readUInt32BE(0) % 2_176_782_336;
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out = A[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return `CR-${out}`;
}

// one in-flight tx per source account (avoids txBadSeq when campaigns overlap)
const locks = new Map<string, Promise<unknown>>();
function withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
  const prev = locks.get(key) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  locks.set(key, p.catch(() => undefined));
  return p;
}

type TxRow = { campaign: string; label: string; hash: string; ok: boolean };
const txRows: TxRow[] = [];
let failures = 0;

/**
 * invoke with retries: transient failures (footprint ExceededLimit when a parallel tx took the
 * same counter key, bad seq, send ERROR) are re-simulated and re-sent. Contract errors are final.
 */
async function send(tag: string, label: string, contract: string, method: string, args: xdr.ScVal[], signer: string, opts: { quietFail?: boolean } = {}): Promise<InvokeResult> {
  return withLock(signer, async () => {
    let r: InvokeResult = { ok: false };
    for (let attempt = 1; attempt <= 4; attempt++) {
      r = await invoke(contract, method, args, identity(signer));
      if (r.ok || r.code !== undefined || r.error === "timeout waiting for tx") break;
      console.log(`${nowStr()} [${tag}] retry ${attempt}/3 ${label}: ${r.error}`);
      await sleep(1500 * attempt);
    }
    const res = r.ok ? `ok${r.value !== undefined ? ` → ${fmt(r.value)}` : ""}` : `FAILED ${r.code !== undefined ? `#${r.code}` : ""} ${r.error ?? ""}`;
    console.log(`${nowStr()} [${tag}] ${label}: ${res}${r.hash ? `  ${txLink(r.hash)}` : ""}`);
    if (r.hash) txRows.push({ campaign: tag, label, hash: r.hash, ok: r.ok });
    if (!r.ok && !opts.quietFail) failures++;
    return r;
  });
}

/** Wait (quietly) until the latest closed ledger has close time ≥ t. */
async function until(t: number, tag: string, what: string) {
  const { time } = await ledgerNow();
  if (time >= t) return;
  console.log(`${nowStr()} [${tag}] waiting for ${what} (${clock(t)}, ${t - time}s)`);
  for (;;) {
    const { time: now } = await ledgerNow();
    if (now >= t) return;
    await sleep(t - now > 10 ? 3000 : 400);
  }
}

// ------------------------------------------------------------------ verifier HTTP (real mode)

async function http<T = any>(method: "GET" | "POST", path: string, body?: unknown, auth = false): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth && WRITE_TOKEN) headers.authorization = `Bearer ${WRITE_TOKEN}`;
  const r = await fetch(VERIFIER + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any;
  try {
    json = await r.json();
  } catch {
    json = {};
  }
  return { status: r.status, json };
}

async function bump(tag: string, id: string, body: { views?: number; delta?: number; desc?: string }) {
  const r = await http("POST", `/demo/videos/${id}/bump`, body, true);
  if (r.status !== 200) throw new Error(`bump ${id}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  console.log(`${nowStr()} [${tag}] demo video ${id}: views=${r.json.views}${body.desc !== undefined ? ` desc="${r.json.desc}"` : ""}`);
}

/** Opening proof from the verifier (real zkFetch). Waits out the per-IP rate limit. */
async function realProof(id: string): Promise<ProofJson> {
  for (let i = 0; ; i++) {
    const r = await http("POST", "/proof", { platform: "demo", videoId: id });
    if (r.status === 200) return r.json.proof as ProofJson;
    if (r.status === 429 && i < 8) {
      console.log(`${nowStr()} /proof rate-limited, retrying in 20s…`);
      await sleep(20_000);
      continue;
    }
    throw new Error(`/proof ${id}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  }
}

async function preflightReal() {
  let h: { status: number; json: any };
  try {
    h = await http("GET", "/health");
  } catch (e: any) {
    fail(`verifier not reachable at ${VERIFIER} (${e?.cause?.code ?? e?.message}). Start it: pnpm --filter verifier dev  (KEEPER=1 DEMO_MODE=1)`);
  }
  if (h!.status !== 200) fail(`verifier /health → HTTP ${h!.status}`);
  if (h!.json.cliprailId && h!.json.cliprailId !== CLIPRAIL)
    fail(`verifier points at cliprail ${h!.json.cliprailId}, deploy.env has ${CLIPRAIL}. Fix CLIPRAIL_ID in services/verifier/.env`);
  // probe: demo video + one real zkFetch (the only way to know Reclaim works end to end)
  const probe = `seed-probe`;
  const b = await http("POST", `/demo/videos/${probe}/bump`, { views: 1, desc: "seed probe" }, true);
  if (b.status === 401) fail("verifier requires WRITE_TOKEN: export WRITE_TOKEN=… (same value as services/verifier/.env)");
  if (b.status !== 200) fail(`demo bump failed: HTTP ${b.status} ${JSON.stringify(b.json)}`);
  console.log(`probing Reclaim zkFetch via ${VERIFIER}/proof …`);
  const r = await http("POST", "/proof", { platform: "demo", videoId: probe });
  if (r.status === 503)
    fail("Reclaim credentials missing on the verifier (RECLAIM_APP_ID / RECLAIM_APP_SECRET). Real mode is unavailable → use the fallback: --mode local (simulated attestor), see docs/DEMO.md");
  if (r.status !== 200) fail(`/proof probe failed: HTTP ${r.status} ${JSON.stringify(r.json)}. Check DEMO_PUBLIC_BASE / tunnel / RECLAIM_ATTESTORS (docs/DEMO.md)`);
  console.log(`  ok: real zkTLS proof (views=${r.json.extracted?.views})\n`);
}

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

// ------------------------------------------------------------------ per-campaign state

type Camp = {
  k: number; // 0-based index
  tag: string;
  cid: bigint;
  createHash: string;
  tl: Timeline;
  live: boolean; // clipper1 left for on-screen flow
  clippers: K[]; // clippers the script registers
  vids: Partial<Record<K, string>>;
  liveVid?: string;
  codes: Partial<Record<K, string>>;
  clipIds: Partial<Record<K, bigint>>;
  views: Record<string, number>; // local-mode demo state (video id → views)
  desc: Record<string, string>;
};

// ------------------------------------------------------------------ main

async function main() {
  const RUN = Math.floor(Date.now() / 1000).toString(36).slice(-6);
  console.log(`ClipRail demo seed — mode ${MODE.toUpperCase()}${MODE === "local" ? " (SIMULATED ATTESTOR: proofs signed locally by a test key, not Reclaim)" : " (real Reclaim zkTLS via verifier)"}`);
  console.log(`cliprail ${CLIPRAIL}\nhumanity ${HUMANITY}\nrun id ${RUN}, campaigns ${N}, stagger ${STAGGER}s${DRIVE ? ", drive" : ""}${LIVE ? ", live" : ""}\n`);
  if (MODE === "real") await preflightReal();

  const who = { brand: accounts.BRAND, arbiter: accounts.ARBITER };
  const l0 = await ledgerNow();
  const camps: Camp[] = [];

  // 1. campaigns (sequential: create_campaign writes Campaign(CampaignCount+1))
  for (let k = 0; k < N; k++) {
    const tl = T(l0.time + LEAD + k * STAGGER);
    const tag = `C${k + 1}`;
    const params = structToScVal({
      token: sv.addr(USDC),
      budget: sv.i128(P.budget),
      rate_max_per_1k: sv.i128(P.rate_max_per_1k),
      cap_views_clip: sv.u64(P.cap_views_clip),
      cap_views_human: sv.u64(P.cap_views_human),
      min_views: sv.u64(P.min_views),
      start: sv.u64(tl.start),
      epoch_len: sv.u64(P.epoch_len),
      epochs: sv.u32(P.epochs),
      proof_window: sv.u64(P.proof_window),
      dispute_window: sv.u64(P.dispute_window),
      arbiter_window: sv.u64(P.arbiter_window),
      claim_grace: sv.u64(P.claim_grace),
      holdback_bps: sv.u32(P.holdback_bps),
      bond: sv.i128(P.bond),
      arbiter: sv.addr(who.arbiter),
      platforms: sv.vec(MODE === "real" ? [sv.sym("demo"), sv.sym("youtube")] : [sv.sym("demo")]),
      require_humanity: sv.bool(true),
      title: sv.str(`ClipRail demo ${RUN} #${k + 1}${MODE === "local" ? " (simulated attestor)" : ""}`),
      brief_url: sv.str(`${WEB}/c`),
    });
    const r = await send(tag, `brand create_campaign (20 USDC, start ${clock(tl.start)})`, CLIPRAIL, "create_campaign", [sv.addr(who.brand), params], "brand");
    if (!r.ok) fail("create_campaign failed (brand USDC balance / trustline?)");
    const live = LIVE && k === N - 1;
    const clippers: K[] = (BOT ? KEYS : (["c1", "c2"] as K[])).filter((c) => !(live && c === "c1"));
    camps.push({ k, tag, cid: BigInt(r.value as bigint), createHash: r.hash!, tl, live, clippers, vids: {}, codes: {}, clipIds: {}, views: {}, desc: {} });
  }

  // 2. humanity (relayer)
  for (const c of camps) {
    for (const k of c.clippers) {
      if (MODE === "real") {
        const r = await http("POST", "/humanity/demo-register", { campaignId: c.cid.toString(), wallet: ADDR[k] }, true);
        if (r.status !== 200) fail(`/humanity/demo-register ${NAME[k]}: HTTP ${r.status} ${JSON.stringify(r.json)} (DEMO_MODE=1? WRITE_TOKEN?)`);
        console.log(`${nowStr()} [${c.tag}] humanity ${NAME[k]} (verifier relayer)  ${txLink(r.json.txHash)}`);
        txRows.push({ campaign: c.tag, label: `humanity.register ${NAME[k]}`, hash: r.json.txHash, ok: true });
      } else {
        const r = await send(c.tag, `relayer humanity.register ${NAME[k]}`, HUMANITY, "register", [sv.u64(c.cid), sv.bytes(demoNullifier(c.cid, ADDR[k])), sv.addr(ADDR[k])], "relayer");
        if (!r.ok) fail("humanity.register failed");
      }
    }
  }

  // 3. join (parallel per campaign, each clipper is its own source)
  for (const c of camps) {
    await Promise.all(
      c.clippers.map(async (k) => {
        const r = await send(c.tag, `${NAME[k]} join`, CLIPRAIL, "join", [sv.u64(c.cid), sv.addr(ADDR[k])], NAME[k]);
        if (!r.ok) fail(`join ${NAME[k]} failed`);
        c.codes[k] = String(r.value);
        const exp = participantCode(c.cid, ADDR[k]);
        if (exp !== c.codes[k]) console.log(`  WARNING: local participant code ${exp} ≠ chain ${c.codes[k]}`);
      }),
    );
    if (c.live) c.codes.c1 = participantCode(c.cid, ADDR.c1); // precomputed; clipper1 joins on screen
  }

  // 4. demo videos (unique per run: VideoIndex is global)
  const descOf = (code: string, k: K) => `ClipRail demo clip by ${NAME[k]}. Join with code ${code} #ad`;
  for (const c of camps) {
    const all: K[] = c.live ? ["c1", ...c.clippers] : c.clippers;
    for (const k of all) {
      const id = c.live && k === "c1" ? `d${RUN}-${c.k + 1}live` : `d${RUN}-${c.k + 1}${k === "c1" ? "a" : k === "c2" ? "b" : "c"}`;
      if (c.live && k === "c1") c.liveVid = id;
      else c.vids[k] = id;
      const desc = descOf(c.codes[k]!, k);
      c.views[id] = INITIAL_VIEWS[k];
      c.desc[id] = desc;
      if (MODE === "real") await bump(c.tag, id, { views: INITIAL_VIEWS[k], desc });
    }
  }

  // 5. register_clip (sequential: Clip(ClipCount+1) collides when parallel)
  for (const c of camps) {
    for (const k of c.clippers) {
      const id = c.vids[k]!;
      let proof: xdr.ScVal;
      if (MODE === "real") proof = reclaimProofToScVal(await realProof(id));
      else proof = makeProof(id, c.views[id], c.desc[id], (await ledgerNow()).time, `cliprail:${c.cid}:register`).scval;
      const r = await send(c.tag, `${NAME[k]} register_clip demo/${id} (baseline ${c.views[id]})${k === "c3" ? " [bot clip]" : ""}`, CLIPRAIL, "register_clip", [sv.u64(c.cid), sv.addr(ADDR[k]), sv.sym("demo"), sv.str(id), proof], NAME[k]);
      if (!r.ok) fail(`register_clip ${NAME[k]} failed${r.code === 10 ? " (VideoAlreadyRegistered → re-run, new ids)" : ""}`);
      c.clipIds[k] = BigInt(r.value as bigint);
    }
  }

  // 6. attack check (simulation only): join without humanity
  {
    const c = camps[0];
    const r = await expectSimError(CLIPRAIL, "join", [sv.u64(c.cid), sv.addr(who.arbiter)], identity("arbiter"));
    console.log(`${nowStr()} [${c.tag}] attack (simulation): join without humanity (arbiter wallet) → ${r.ok ? "UNEXPECTED ok" : `error #${r.code} ${r.code === 7 ? "NotHuman" : r.error}`}`);
  }

  printTimeline(camps);
  writeFileSync(
    resolve(ACCOUNTS_DIR, `demo-seed-${MODE}.json`),
    JSON.stringify(
      {
        mode: MODE,
        run: RUN,
        cliprail: CLIPRAIL,
        humanity: HUMANITY,
        campaigns: camps.map((c) => ({ id: c.cid.toString(), createTx: c.createHash, start: c.tl.start, codes: c.codes, videos: c.vids, liveVideo: c.liveVid, clipIds: Object.fromEntries(Object.entries(c.clipIds).map(([k, v]) => [k, v!.toString()])) })),
      },
      null,
      2,
    ),
  );

  if (DRIVE) {
    console.log(`\n=== DRIVE (${MODE === "real" ? "view bumps only; the verifier keeper does proofs/finalize/settle" : "script acts as keeper, simulated attestor"}) ===\n`);
    const results = await Promise.all(camps.map((c) => (MODE === "real" ? driveReal(c) : driveLocal(c))));
    if (MODE === "local") {
      console.log("\n=== RESULT (local, simulated attestor) ===");
      for (const r of results) if (r) console.log(r);
    }
  }

  console.log("\n=== TX SUMMARY ===");
  for (const r of txRows) console.log(`[${r.campaign}] ${r.ok ? "ok  " : "FAIL"} ${r.label}  ${txLink(r.hash)}`);
  console.log(`\n${failures ? `${failures} step(s) FAILED` : "all steps ok"}`);
  if (failures) process.exit(1);
}

// ------------------------------------------------------------------ timeline

function printTimeline(camps: Camp[]) {
  console.log(`\n=== TIMELINE (local time; ${MODE === "local" ? "SIMULATED ATTESTOR — the web register flow does not work on this instance" : "keeper must run with KEEPER=1"}) ===`);
  console.log(`contract: ${contractLink(CLIPRAIL)}`);
  for (const c of camps) {
    const t = c.tl;
    const page = `${WEB}/c/${c.cid}`;
    const bot = c.clipIds.c3 !== undefined ? `clip #${c.clipIds.c3} (clipper3, ${c.vids.c3})` : "(no bot clip; --no-bot)";
    const lines: [number, string][] = [
      [Date.now() / 1000, `seeded. Open ${page} — rules card + create tx ${txLink(c.createHash)}`],
      [t.start, `epoch 0 content phase starts (join/register open until ${clock(t.contentEnd(P.epochs - 1))})`],
    ];
    if (c.live)
      lines.push([
        t.start + 15,
        `ON SCREEN (clipper1 wallet): ${page}/join → "insan doğrulaması" → Katıl → code ${c.codes.c1}; then ${page}/register → platform demo, id ${c.liveVid} (its description already contains ${c.codes.c1} #ad). Optional: YouTube clip with the code in its description.`,
      ]);
    lines.push(
      [t.start + Math.floor(P.epoch_len * 0.4), `views rise (${DRIVE ? "auto bump" : "bump manually"}): c1 +${BUMP_E0.c1}, c2 +${BUMP_E0.c2}, c3 +${BUMP_E0.c3}${MODE === "real" ? ` — show ${VERIFIER}/demo/videos/<id>` : ""}`],
      [t.contentEnd(0), `content_end(0): closing proofs (${MODE === "real" ? "keeper, ~+6s" : "script"}) → weights + rate estimate appear on ${page}`],
      [t.proofEnd(0), `CHALLENGE WINDOW until ${clock(t.challengeEnd(0))} (45 s!): brand wallet on ${page} → itiraz ${bot}, bond 5 USDC`],
      [t.challengeEnd(0), `response window: clipper3 does NOT respond (if it did, arbiter resolves at ${WEB}/arbiter between ${clock(t.disputeEnd(0))}–${clock(t.settleAt(0))})`],
      [t.disputeEnd(0), `dispute_end(0): finalize_dispute (${MODE === "real" ? "keeper" : "script"}) → bot clip excluded, W drops, others' rate rises`],
      [t.settleAt(0), `settle_at(0): settle_epoch 0 → clipper1/clipper2 claim epoch 0 (80% now, 20% holdback) on ${page}`],
      [t.contentEnd(1), `content_end(1): epoch-1 closing proof for clipper1 (${DRIVE ? `+${BUMP_E1_C1} views auto` : "bump views first"})${MODE === "real" && DRIVE ? "; clipper2's code removed = 'video deleted' → no epoch-1 proof" : ""}`],
      [t.proofEnd(1) + 1, `holdback of epoch 0 released to survivors → clipper1 "holdback claim" on ${page}`],
      [t.settleAt(1), `settle_at(1): settle epoch 1 → clipper1 claims epoch 1 (last epoch, no holdback)`],
      [t.refundAt, `refund_at: brand wallet → refund remaining budget on ${page}`],
    );
    console.log(`\n[${c.tag}] campaign #${c.cid}  ${page}`);
    console.log(`  create tx: ${txLink(c.createHash)}`);
    console.log(`  codes: ${Object.entries(c.codes).map(([k, v]) => `${NAME[k as K]} ${v}`).join(", ")}`);
    console.log(`  clips: ${Object.entries(c.clipIds).map(([k, v]) => `#${v} ${NAME[k as K]} demo/${c.vids[k as K]}`).join(", ") || "-"}`);
    if (MODE === "local" && DRIVE) console.log("  (local --drive: challenge, claims, holdback and refund are sent by this script; the web only shows them)");
    for (const [ts, s] of lines) console.log(`  ${clock(ts)}  ${s}`);
  }
}

// ------------------------------------------------------------------ drive

async function driveReal(c: Camp) {
  const t = c.tl;
  const e0 = Object.entries(BUMP_E0) as [K, number][];
  await until(t.start + Math.floor(P.epoch_len * 0.4), c.tag, "epoch-0 view bump");
  for (const [k, d] of e0) {
    const id = k === "c1" && c.live ? c.liveVid : c.vids[k];
    if (id) await bump(c.tag, id, { delta: d });
  }
  await until(t.contentEnd(0) + P.proof_window, c.tag, "end of epoch-0 proof window");
  if (c.vids.c2) await bump(c.tag, c.vids.c2, { desc: "clip removed" }); // clipper2 "deletes" → loses holdback
  await until(t.start + P.epoch_len + Math.floor(P.epoch_len * 0.4), c.tag, "epoch-1 view bump");
  const id1 = c.live ? c.liveVid : c.vids.c1;
  if (id1) await bump(c.tag, id1, { delta: BUMP_E1_C1 });
  console.log(`${nowStr()} [${c.tag}] drive done; keeper settles at ${clock(t.settleAt(1))}, refund from ${clock(t.refundAt)}`);
  return "";
}

async function driveLocal(c: Camp): Promise<string> {
  const t = c.tl;
  const cid = sv.u64(c.cid);
  const proofFor = async (k: K, e: number) => {
    const id = c.vids[k]!;
    return makeProof(id, c.views[id], c.desc[id], (await ledgerNow()).time, `cliprail:${c.cid}:e${e}`);
  };

  await until(t.start + Math.floor(P.epoch_len * 0.4), c.tag, "epoch-0 view bump");
  for (const k of c.clippers) {
    c.views[c.vids[k]!] += BUMP_E0[k];
    console.log(`${nowStr()} [${c.tag}] demo video ${c.vids[k]} views=${c.views[c.vids[k]!]} (local)`);
  }

  // epoch 0 closing proofs
  await until(t.contentEnd(0), c.tag, "content_end(0)");
  const pr0: Partial<Record<K, ReturnType<typeof makeProof>>> = {};
  await Promise.all(
    c.clippers.map(async (k) => {
      pr0[k] = await proofFor(k, 0);
      await send(c.tag, `${NAME[k]} submit_proof e0 (views ${c.views[c.vids[k]!]})`, CLIPRAIL, "submit_proof", [cid, sv.u64(c.clipIds[k]!), sv.u32(0), pr0[k]!.scval], NAME[k]);
    }),
  );
  const rep = await expectSimError(CLIPRAIL, "submit_proof", [cid, sv.u64(c.clipIds.c1!), sv.u32(0), pr0.c1!.scval], identity("clipper1"));
  console.log(`${nowStr()} [${c.tag}] attack (simulation): replay clipper1 e0 proof → ${rep.ok ? "UNEXPECTED ok" : `error #${rep.code} ${rep.code === 19 ? "ProofReused" : rep.error}`}`);

  // challenge the bot clip; unanswered → challenger wins at dispute_end
  let disputeId: bigint | undefined;
  if (c.clipIds.c3 !== undefined) {
    await until(t.proofEnd(0), c.tag, "challenge window");
    const r = await send(c.tag, "brand challenge clipper3 e0 (bond 5 USDC)", CLIPRAIL, "challenge", [cid, sv.u64(c.clipIds.c3), sv.u32(0), sv.addr(accounts.BRAND), sv.str("views look botted")], "brand");
    if (r.ok) disputeId = BigInt(r.value as bigint);
    await until(t.disputeEnd(0), c.tag, "dispute_end(0)");
    if (disputeId !== undefined) await send(c.tag, "finalize_dispute (unanswered → clip excluded)", CLIPRAIL, "finalize_dispute", [sv.u64(disputeId)], "admin");
  }

  await until(t.settleAt(0), c.tag, "settle_at(0)");
  await send(c.tag, "settle_epoch 0", CLIPRAIL, "settle_epoch", [cid, sv.u32(0)], "admin");
  const st0 = await view(CLIPRAIL, "get_epoch", [cid, sv.u32(0)]);
  const claimed: Record<string, bigint> = {};
  await Promise.all(
    (["c1", "c2"] as K[]).map(async (k) => {
      const r = await send(c.tag, `${NAME[k]} claim e0`, CLIPRAIL, "claim", [cid, sv.u64(c.clipIds[k]!), sv.u32(0)], NAME[k]);
      claimed[`${k}.e0`] = r.ok ? BigInt(r.value as bigint) : -1n;
    }),
  );

  // epoch 1: only clipper1 keeps its clip alive
  await until(t.start + P.epoch_len + Math.floor(P.epoch_len * 0.4), c.tag, "epoch-1 view bump");
  c.views[c.vids.c1!] += BUMP_E1_C1;
  console.log(`${nowStr()} [${c.tag}] demo video ${c.vids.c1} views=${c.views[c.vids.c1!]} (local); clipper2 "deleted" its clip`);
  await until(t.contentEnd(1), c.tag, "content_end(1)");
  await send(c.tag, `clipper1 submit_proof e1 (views ${c.views[c.vids.c1!]})`, CLIPRAIL, "submit_proof", [cid, sv.u64(c.clipIds.c1!), sv.u32(1), (await proofFor("c1", 1)).scval], "clipper1");

  await until(t.proofEnd(1) + 1, c.tag, "holdback release (after proof_end(1))");
  {
    const r = await send(c.tag, "clipper1 claim_holdback e0", CLIPRAIL, "claim_holdback", [cid, sv.u64(c.clipIds.c1!), sv.u32(0)], "clipper1");
    claimed["c1.hb"] = r.ok ? BigInt(r.value as bigint) : -1n;
  }

  await until(t.settleAt(1), c.tag, "settle_at(1)");
  await send(c.tag, "settle_epoch 1", CLIPRAIL, "settle_epoch", [cid, sv.u32(1)], "admin");
  {
    const r = await send(c.tag, "clipper1 claim e1", CLIPRAIL, "claim", [cid, sv.u64(c.clipIds.c1!), sv.u32(1)], "clipper1");
    claimed["c1.e1"] = r.ok ? BigInt(r.value as bigint) : -1n;
  }

  await until(t.refundAt, c.tag, "refund_at");
  {
    const r = await send(c.tag, "brand refund", CLIPRAIL, "refund", [cid], "brand");
    claimed.refund = r.ok ? BigInt(r.value as bigint) : -1n;
  }

  // expected (packages/shared/src/payout.ts)
  const cp = { budget: P.budget, epochs: P.epochs, rate_max_per_1k: P.rate_max_per_1k, holdback_bps: P.holdback_bps, cap_views_clip: P.cap_views_clip, cap_views_human: P.cap_views_human, min_views: P.min_views };
  const w = (k: K) => clipWeight(cp, BigInt(INITIAL_VIEWS[k]), BigInt(INITIAL_VIEWS[k] + BUMP_E0[k]));
  const W0 = participantWeight(cp, w("c1")) + participantWeight(cp, w("c2")) + (c.clipIds.c3 !== undefined && disputeId === undefined ? w("c3") : 0n);
  const b0 = baseBudget(cp, 0);
  const r0 = rateFor(cp, b0, W0);
  const spent0 = (r0 * W0) / 1000n;
  const p0 = { c1: splitPay(cp, 0, payFor(r0, w("c1"), w("c1"), w("c1"))), c2: splitPay(cp, 0, payFor(r0, w("c2"), w("c2"), w("c2"))) };
  const hb = holdbackShare(p0.c1.held, { held_total: BigInt(st0.held_total), held_survived: p0.c1.held });
  const w1 = clipWeight(cp, BigInt(INITIAL_VIEWS.c1 + BUMP_E0.c1), BigInt(INITIAL_VIEWS.c1 + BUMP_E0.c1 + BUMP_E1_C1));
  const b1 = baseBudget(cp, 1) + (b0 - spent0);
  const pay1 = splitPay(cp, 1, payFor(rateFor(cp, b1, w1), w1, w1, w1)).pay;
  const refund = P.budget - p0.c1.immediate - p0.c2.immediate - hb - pay1;
  const exp: Record<string, bigint> = { "c1.e0": p0.c1.immediate, "c2.e0": p0.c2.immediate, "c1.hb": hb, "c1.e1": pay1, refund };
  const lines = Object.entries(exp).map(([k, v]) => {
    const ok = claimed[k] === v;
    if (!ok) failures++;
    return `  ${ok ? "ok  " : "FAIL"} ${k.padEnd(7)} ${usdc(claimed[k] ?? -1n)} USDC (expected ${usdc(v)})`;
  });
  return `[${c.tag}] campaign #${c.cid}: epoch 0 W=${st0.total_weight} rate=${st0.rate}\n${lines.join("\n")}`;
}

main().catch((e) => {
  console.error("ABORT:", e);
  process.exit(2);
});
