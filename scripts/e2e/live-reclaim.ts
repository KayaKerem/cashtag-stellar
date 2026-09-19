// LIVE Reclaim zkFetch check against the e2e testnet instance.
// Uses exactly two zkFetch calls (quota is ~100/month):
//   1) POST /proof        -> register_clip (opening proof)
//   2) POST /proof/submit -> submit_proof  (closing proof)
// Needs a verifier in ATTESTOR_MODE=reclaim (default http://127.0.0.1:8899, VERIFIER_URL) and the
// public demo host (the tunnel) serving the demo video that the attestor fetches: demo bumps go to
// DEMO_ADMIN_URL (default http://127.0.0.1:8787), whose store is behind DEMO_PUBLIC_BASE.
//   pnpm --filter e2e tsx live-reclaim.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import canonicalize from "canonicalize";
import {
  ROOT,
  E2E_ENV,
  accounts,
  identity,
  invoke,
  view,
  ledgerNow,
  waitLedgerTime,
  readEnvFile,
  sv,
  txLink,
} from "./lib.ts";
import { structToScVal, reclaimProofToScVal } from "../../services/verifier/src/scval.ts";
import type { ProofJson } from "../../services/verifier/src/proof.ts";

const env = readEnvFile(E2E_ENV);
const CLIPRAIL = env.E2E_CLIPRAIL_ID;
const HUMANITY = env.E2E_HUMANITY_ID;
const USDC = accounts.USDC_SAC || env.USDC_SAC;
const SIM_ATTESTOR = env.E2E_ATTESTOR;
const SIM_OWNER = env.E2E_OWNER;
const REQUIRED: string[] = JSON.parse(readFileSync(resolve(ROOT, "fixtures/required-substrings.json"), "utf8")).demo.required;
const CACHE_DIR = process.env.RECLAIM_CACHE_DIR || resolve(ROOT, "services/verifier/.data/reclaim-test/cache");

const VERIFIER = (process.env.VERIFIER_URL || "http://127.0.0.1:8899").replace(/\/+$/, "");
const DEMO_ADMIN = (process.env.DEMO_ADMIN_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const TOKEN = process.env.WRITE_TOKEN || readEnvFile(resolve(ROOT, "services/verifier/.env.simulated")).WRITE_TOKEN || "";
const OUT = process.env.OUT_DIR || resolve(ROOT, "fixtures/reclaim");

const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const authz: Record<string, string> = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};

async function post<T>(base: string, path: string, body: unknown, auth = false): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? authz : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`POST ${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const P = {
  budget: 50_000_000n, // 5 USDC
  epochs: 1,
  rate_max_per_1k: 10_000_000n,
  cap_views_clip: 1_000_000_000n,
  cap_views_human: 1_000_000_000n,
  min_views: 1n,
  epoch_len: 240,
  proof_window: 180,
  dispute_window: 20,
  arbiter_window: 10,
  claim_grace: 240,
  holdback_bps: 2000,
  bond: 10_000_000n,
};

async function main() {
  if (!CLIPRAIL || !HUMANITY) throw new Error("scripts/.accounts/e2e.env missing");
  const health = (await (await fetch(`${VERIFIER}/health`)).json()) as { attestorMode: string; cliprailId: string };
  log(`verifier ${VERIFIER} attestorMode=${health.attestorMode} cliprail=${health.cliprailId}`);
  if (health.attestorMode !== "reclaim") throw new Error("verifier is not in reclaim mode");
  if (health.cliprailId !== CLIPRAIL) throw new Error("verifier points at another cliprail instance");

  const who = { brand: accounts.BRAND, c1: accounts.CLIPPER1, arbiter: accounts.ARBITER };
  const l0 = await ledgerNow();
  const START = l0.time + 50;
  const contentEnd0 = START + P.epoch_len;
  const proofEnd0 = contentEnd0 + P.proof_window;
  log(`ledger t=${l0.time} start=${START} content_end0=${contentEnd0} proof_end0=${proofEnd0}`);

  const params = structToScVal({
    token: sv.addr(USDC),
    budget: sv.i128(P.budget),
    rate_max_per_1k: sv.i128(P.rate_max_per_1k),
    cap_views_clip: sv.u64(P.cap_views_clip),
    cap_views_human: sv.u64(P.cap_views_human),
    min_views: sv.u64(P.min_views),
    start: sv.u64(START),
    epoch_len: sv.u64(P.epoch_len),
    epochs: sv.u32(P.epochs),
    proof_window: sv.u64(P.proof_window),
    dispute_window: sv.u64(P.dispute_window),
    arbiter_window: sv.u64(P.arbiter_window),
    claim_grace: sv.u64(P.claim_grace),
    holdback_bps: sv.u32(P.holdback_bps),
    bond: sv.i128(P.bond),
    arbiter: sv.addr(who.arbiter),
    platforms: sv.vec([sv.sym("demo")]),
    require_humanity: sv.bool(true),
    title: sv.str("Live Reclaim check"),
    brief_url: sv.str("https://e2e.invalid/live-reclaim"),
  });

  const rc = await invoke(CLIPRAIL, "create_campaign", [sv.addr(who.brand), params], identity("brand"));
  if (!rc.ok) throw new Error(`create_campaign failed: ${rc.error}`);
  const cid = BigInt(rc.value as bigint);
  log(`create_campaign id=${cid} ${txLink(rc.hash!)}`);

  const nullifier = createHash("sha256").update(`cliprail-live-reclaim:${cid}:${START}`).digest();
  const rh = await invoke(HUMANITY, "register", [sv.u64(cid), sv.bytes(nullifier), sv.addr(who.c1)], identity("relayer"));
  if (!rh.ok) throw new Error(`humanity.register failed: ${rh.error}`);
  log(`humanity.register ${txLink(rh.hash!)}`);

  const rj = await invoke(CLIPRAIL, "join", [sv.u64(cid), sv.addr(who.c1)], identity("clipper1"));
  if (!rj.ok) throw new Error(`join failed: ${rj.error}`);
  const code = String(rj.value);
  log(`join code=${code} ${txLink(rj.hash!)}`);

  // demo video behind the PUBLIC base (the attestor fetches it over the tunnel)
  const vid = `live-${Date.now().toString(36)}`;
  const desc = `Live Reclaim demo. Join the campaign: ${code} #ad`;
  const b1 = await post<{ views: number }>(DEMO_ADMIN, `/demo/videos/${vid}/bump`, { views: 1200, desc }, true);
  log(`bump ${vid} views=${b1.views}`);

  // ---------------- zkFetch #1: opening proof
  log("zkFetch #1 (opening proof) …");
  const t1 = Date.now();
  const r1 = await post<{ proof: ProofJson; extracted: { views: string; desc: string }; cached: boolean }>(
    VERIFIER,
    "/proof",
    { platform: "demo", videoId: vid },
  );
  log(`/proof ok in ${((Date.now() - t1) / 1000).toFixed(1)}s cached=${r1.cached} views=${r1.extracted.views}`);

  // raw zkFetch proof as the verifier cached it (fixture + byte-level report)
  const rawPath = resolve(CACHE_DIR, `demo-${vid}.json`);
  if (!existsSync(rawPath)) throw new Error(`raw proof not found at ${rawPath}`);
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));
  const liveAttestor = String(raw.witnesses?.[0]?.id ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(liveAttestor)) throw new Error("no witness address in the raw proof");

  const parameters = Buffer.from(r1.proof.parameters, "hex").toString("utf8");
  const context = Buffer.from(r1.proof.context, "hex").toString("utf8");
  const owner = Buffer.from(r1.proof.owner, "hex").toString("utf8");
  const expectedUrl = `${env.E2E_DEMO_PREFIX}${vid}`;
  const report = {
    videoId: vid,
    campaignId: cid.toString(),
    code,
    attestor: liveAttestor,
    owner,
    ownerIsAppId: owner === (process.env.RECLAIM_APP_ID ?? "").toLowerCase() || undefined,
    epoch: r1.proof.epoch,
    timestampS: r1.proof.timestampS,
    recoveryId: r1.proof.recoveryId,
    identifier: raw.identifier ?? raw.claimData?.identifier,
    provider: raw.claimData?.provider,
    parameters,
    parametersUnchanged: parameters === raw.claimData.parameters,
    rawContext: raw.claimData.context,
    context,
    contextAlreadyCanonical: raw.claimData.context === canonicalize(JSON.parse(raw.claimData.context)),
    parametersKeys: Object.keys(JSON.parse(parameters)),
    expectedUrl,
    urlNeedle: `"url":"${expectedUrl}"`,
    urlNeedleFound: parameters.includes(`"url":"${expectedUrl}"`),
    requiredFound: REQUIRED.map((r) => ({ required: r, found: parameters.includes(r) })),
    codeInContext: context.includes(code),
    signatureCount: raw.signatures?.length,
    witnesses: raw.witnesses,
    parametersBytes: Buffer.byteLength(parameters, "utf8"),
    contextBytes: Buffer.byteLength(context, "utf8"),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "demo-live-proof.json"), JSON.stringify(raw, null, 2) + "\n");
  writeFileSync(resolve(OUT, "demo-live-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("---- proof report ----");
  console.log(JSON.stringify(report, null, 2));
  console.log("----------------------");
  if (!report.urlNeedleFound) throw new Error("url needle not found in parameters");
  if (report.requiredFound.some((r) => !r.found)) throw new Error("required substring missing from parameters");

  // ---------------- on-chain config: live + simulated attestor/owner
  const attestors = [liveAttestor, SIM_ATTESTOR.toLowerCase()].filter((v, i, a) => a.indexOf(v) === i);
  const owners = [owner.toLowerCase(), SIM_OWNER.toLowerCase()].filter((v, i, a) => a.indexOf(v) === i);
  log(`set_attestors ${attestors.join(", ")}`);
  const ra = await invoke(
    CLIPRAIL,
    "set_attestors",
    [sv.vec(attestors.map((a) => sv.bytes(Buffer.from(a.slice(2), "hex"))))],
    identity("admin"),
  );
  if (!ra.ok) throw new Error(`set_attestors failed: ${ra.error}`);
  log(`set_attestors ok ${txLink(ra.hash!)}`);
  log(`set_owners ${owners.join(", ")}`);
  const ro = await invoke(CLIPRAIL, "set_owners", [sv.vec(owners.map((o) => sv.bytes(Buffer.from(o, "utf8"))))], identity("admin"));
  if (!ro.ok) throw new Error(`set_owners failed: ${ro.error}`);
  log(`set_owners ok ${txLink(ro.hash!)}`);

  // remember the live pair so a redeploy (deploy.ts) keeps configuring both modes
  const lines = readFileSync(E2E_ENV, "utf8").split("\n").filter((l) => !/^E2E_(ATTESTOR|OWNER)_LIVE=/.test(l));
  const keep = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  writeFileSync(E2E_ENV, [...keep, `E2E_ATTESTOR_LIVE=${liveAttestor}`, `E2E_OWNER_LIVE=${owner.toLowerCase()}`, ""].join("\n"));

  // ---------------- register_clip with the LIVE opening proof
  const rr = await invoke(
    CLIPRAIL,
    "register_clip",
    [sv.u64(cid), sv.addr(who.c1), sv.sym("demo"), sv.str(vid), reclaimProofToScVal(r1.proof)],
    identity("clipper1"),
  );
  if (!rr.ok) throw new Error(`register_clip failed: ${rr.error} (code ${rr.code})`);
  const clipId = BigInt(rr.value as bigint);
  log(`register_clip clipId=${clipId} baseline=${r1.extracted.views} ${txLink(rr.hash!)}`);

  // more views for the closing proof
  await waitLedgerTime(START + 20, "content period");
  const b2 = await post<{ views: number }>(DEMO_ADMIN, `/demo/videos/${vid}/bump`, { delta: 4000 }, true);
  log(`bump ${vid} views=${b2.views}`);

  // ---------------- zkFetch #2: closing proof via /proof/submit
  await waitLedgerTime(contentEnd0 + 8, "content_end(0)");
  log("zkFetch #2 (closing proof via /proof/submit) …");
  const t2 = Date.now();
  const r2 = await post<{ txHash: string; views: string }>(
    VERIFIER,
    "/proof/submit",
    { campaignId: cid.toString(), clipId: clipId.toString(), epoch: 0 },
    true,
  );
  log(`submit_proof ok views=${r2.views} in ${((Date.now() - t2) / 1000).toFixed(1)}s ${txLink(r2.txHash)}`);

  const ce = await view(CLIPRAIL, "get_clip_epoch", [sv.u64(clipId), sv.u32(0)]);
  log(`clip_epoch(0) = ${JSON.stringify(ce, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);

  console.log("\n==== LIVE RECLAIM SUMMARY ====");
  console.log(`campaign      ${cid}`);
  console.log(`clip          ${clipId} (demo/${vid})`);
  console.log(`attestor      ${liveAttestor}`);
  console.log(`owner         ${owner}`);
  console.log(`create        ${txLink(rc.hash!)}`);
  console.log(`set_attestors ${txLink(ra.hash!)}`);
  console.log(`set_owners    ${txLink(ro.hash!)}`);
  console.log(`register_clip ${txLink(rr.hash!)}`);
  console.log(`submit_proof  ${txLink(r2.txHash)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
