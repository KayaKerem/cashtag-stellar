// ZK identity (Anon Aadhaar, TEST mode) smoke on the E2E testnet instance, using the client like the web:
//   pnpm --filter @cliprail/client smoke:zk        (REFUND=1 also waits for refund_at and refunds the brand)
// Needs a verifier with the Aadhaar TEST prover pointed at the e2e instance, and humanity.set_aadhaar_config done.
// Flow: brand creates a require_humanity campaign; clipper1 proves as "alice" and joins; clipper2 tries "alice"
// again (expect NullifierUsed) and join (expect NotHuman); clipper2 proves as "bob" and joins.
// VERIFIER_URL defaults to the origin of E2E_DEMO_PREFIX; WRITE_TOKEN defaults to services/verifier/.env.simulated.
// Secrets come from `stellar keys show` and are never printed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, contract, rpc } from "@stellar/stellar-sdk";
import { CLIPRAIL_ERRORS, HUMANITY_ERRORS, refundAt, type CampaignParams } from "@cliprail/shared";
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
const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const passphrase = Networks.TESTNET;
const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8" }).trim();
function signerFor(id: string): Signer & { address: string } {
  const kp = Keypair.fromSecret(secretOf(id));
  const { signTransaction } = contract.basicNodeSigner(kp, passphrase);
  return { address: kp.publicKey(), getAddress: async () => kp.publicKey(), signTransaction: (xdr, o) => signTransaction(xdr, o) };
}
const addressOf = (id: string) => execFileSync("stellar", ["keys", "address", id], { encoding: "utf8" }).trim();

// ---- instrumentation: prove timing (fetch wrapper) + register_zk simulation (buildTx wrapper)
interface ProveStat {
  ms: number;
  cached?: boolean;
  status: number;
}
interface SimStat {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  minResourceFee: string;
  txFee: string;
  ok: boolean;
}
const probe = { prove: [] as ProveStat[], sim: [] as SimStat[] };

const timedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/humanity/aadhaar/prove")) return fetch(input, init);
  const t = performance.now();
  const res = await fetch(input, init);
  const ms = Math.round(performance.now() - t);
  const cached = await res
    .clone()
    .json()
    .then((j: { cached?: boolean }) => j.cached)
    .catch(() => undefined);
  probe.prove.push({ ms, cached, status: res.status });
  return res;
};

const buildTx = async (o: contract.AssembledTransactionOptions<unknown>) => {
  const tx = await contract.AssembledTransaction.build(o);
  try {
    const sim = tx.simulation as rpc.Api.SimulateTransactionResponse | undefined;
    if (sim && rpc.Api.isSimulationSuccess(sim)) {
      // stellar-sdk 17 XDR values are plain objects; older ones expose accessor methods
      const get = (o: any, k: string) => (typeof o?.[k] === "function" ? o[k]() : o?.[k]);
      const res = get((sim.transactionData as any).build(), "resources");
      probe.sim.push({
        ok: true,
        instructions: Number(get(res, "instructions")),
        readBytes: Number(get(res, "diskReadBytes") ?? get(res, "readBytes")),
        writeBytes: Number(get(res, "writeBytes")),
        minResourceFee: String(sim.minResourceFee),
        txFee: String(tx.built?.fee ?? ""),
      });
    } else probe.sim.push({ ok: false, instructions: 0, readBytes: 0, writeBytes: 0, minResourceFee: "", txFee: "" });
  } catch (e) {
    log(`(simulation stats unavailable: ${(e as Error).message})`);
  }
  return tx;
};

const apiFor = (signer: Signer): CliprailApi =>
  createApi("chain", {
    rpcUrl,
    networkPassphrase: passphrase,
    cliprailId: e2e.E2E_CLIPRAIL_ID,
    humanityId: e2e.E2E_HUMANITY_ID,
    verifierUrl,
    writeToken,
    usdcSac,
    signer,
    fetch: timedFetch,
    buildTx,
  });

const USDC = 10_000_000n;
const fmt = (x: bigint) => `${x / USDC}.${(x % USDC).toString().padStart(7, "0")} USDC`;
const xlm = (stroops: bigint | string) => `${(Number(stroops) / 1e7).toFixed(7)} XLM`;
const link = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const T0 = Date.now();
const nowS = () => Date.now() / 1000;
const log = (m: string) => console.log(`[+${String(Math.round((Date.now() - T0) / 1000)).padStart(3)}s] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const links: string[] = [];
const addLink = (label: string, h: string) => {
  links.push(`${label}: ${link(h)}`);
  return link(h);
};
const errText = (e: unknown) =>
  isCliprailError(e) ? `CliprailError code=${e.code} name=${e.errorName} source=${e.source} "${e.message}"` : String((e as Error)?.stack ?? e);

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
    const d = errText(e);
    results.push({ step: name, ok: false, detail: d });
    log(`FAIL ${name} — ${d}`);
    throw e;
  }
}
/** Step that must fail with the given contract error. */
async function expectFail(name: string, fn: () => Promise<unknown>, want: { source: string; code: number; name: string }) {
  let ok = false;
  let d: string;
  try {
    const r = await fn();
    d = `unexpected success: ${JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`;
  } catch (e) {
    d = errText(e);
    ok = isCliprailError(e) && e.source === want.source && e.code === want.code && e.errorName === want.name &&
      e.message === (want.source === "humanity" ? HUMANITY_ERRORS : CLIPRAIL_ERRORS)[want.code]?.message;
    if (ok) d = `got ${want.source} #${want.code} ${want.name} → "${(e as Error).message}"`;
  }
  results.push({ step: name, ok, detail: d });
  log(`${ok ? "PASS" : "FAIL"} ${name} — ${d}`);
}
function summary() {
  console.log("\n==== summary ====");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}${r.detail ? `\n      ${r.detail.split("\n")[0]}` : ""}`);
  if (links.length) console.log(`\n==== explorer links ====\n${links.join("\n")}`);
}

/** Fee actually charged for a sent transaction (from getTransaction's result XDR). */
async function feeCharged(hash: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const r = await server.getTransaction(hash);
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS || r.status === rpc.Api.GetTransactionStatus.FAILED) {
      const fc = (r.resultXdr as any).feeCharged;
      return xlm(BigInt(String(typeof fc === "function" ? fc.call(r.resultXdr) : fc)));
    }
    await sleep(1000);
  }
  return "n/a";
}

async function registerZk(label: string, api: CliprailApi, id: bigint, identity: string) {
  const p0 = probe.prove.length;
  const s0 = probe.sim.length;
  const r = await api.registerHumanZk(id, { identity });
  const pr = probe.prove[p0];
  const sim = probe.sim.slice(s0).at(-1);
  const fee = await feeCharged(r.txHash);
  return { ...r, pr, sim, fee, label };
}
const zkDetail = (r: Awaited<ReturnType<typeof registerZk>>) =>
  [
    addLink(`register_zk ${r.label}`, r.txHash),
    `nullifier=${r.nullifier}`,
    r.pr ? `prove=${r.pr.ms} ms${r.pr.cached ? " (cached)" : ""}` : "prove=n/a",
    r.sim ? `cpu=${r.sim.instructions.toLocaleString("en-US")} instr read=${r.sim.readBytes}B write=${r.sim.writeBytes}B minResourceFee=${xlm(r.sim.minResourceFee)} txFee=${xlm(r.sim.txFee)}` : "sim=n/a",
    `feeCharged=${r.fee}`,
  ].join(" ");

const brandS = signerFor("brand");
const c1S = signerFor("clipper1");
const c2S = signerFor("clipper2");
const arbiter = addressOf("arbiter");
const brand = apiFor(brandS);
const cl1 = apiFor(c1S);
const cl2 = apiFor(c2S);
log(`verifier ${verifierUrl} (token ${writeToken ? "set" : "missing"})\n  cliprail ${e2e.E2E_CLIPRAIL_ID}\n  humanity ${e2e.E2E_HUMANITY_ID}\n  usdc ${usdcSac}`);

let campaignId = 0n;
let params: CampaignParams | undefined;
try {
  await step("verifier /health", async () => {
    const h = (await (await fetch(`${verifierUrl}/health`)).json()) as { cliprailId: string; humanityId: string; attestorMode: string };
    if (h.cliprailId !== e2e.E2E_CLIPRAIL_ID) throw new Error(`verifier points at cliprail ${h.cliprailId}`);
    if (h.humanityId !== e2e.E2E_HUMANITY_ID) throw new Error(`verifier points at humanity ${h.humanityId}`);
    return h;
  }, (h) => `attestorMode=${h.attestorMode}`);

  // 1. brand creates a require_humanity campaign
  const created = await step("1 createCampaign (brand, require_humanity)", () =>
    brand.createCampaign({
      budget: 1n * USDC,
      rate_max_per_1k: 1n * USDC,
      cap_views_clip: 50_000n,
      cap_views_human: 100_000n,
      min_views: 1n,
      start: BigInt(Math.floor(nowS())) + 120n,
      epoch_len: 120n,
      epochs: 1,
      proof_window: 40n,
      dispute_window: 30n,
      arbiter_window: 20n,
      claim_grace: 120n,
      holdback_bps: 2000,
      bond: 1n * USDC,
      arbiter,
      platforms: ["demo"],
      require_humanity: true,
      title: "ZK smoke",
      brief_url: "https://example.com/zk-smoke",
    }), (r) => `id=${r.id} ${addLink("create_campaign", r.txHash)}`);
  campaignId = created.id;
  params = (await brand.getCampaign(campaignId)).params;
  if (!params.require_humanity) throw new Error("campaign has require_humanity=false");

  // 2. clipper1 proves as alice, joins
  await step("2a registerHumanZk clipper1 (alice)", () => registerZk("clipper1/alice", cl1, campaignId, "alice"), zkDetail);
  await step("2b isHuman clipper1", async () => {
    if (!(await cl1.isHuman(campaignId, c1S.address))) throw new Error("is_verified=false after register_zk");
    return true;
  }, () => "true");
  await step("2c join clipper1", () => cl1.join(campaignId), (r) => `code=${r.code} ${addLink("join clipper1", r.txHash)}`);

  // 3. clipper2 (same person, second wallet) → NullifierUsed; join → NotHuman
  await expectFail("3a registerHumanZk clipper2 (alice again) → NullifierUsed", () => cl2.registerHumanZk(campaignId, { identity: "alice" }), {
    source: "humanity",
    code: 2,
    name: "NullifierUsed",
  });
  await step("3b isHuman clipper2 = false", async () => {
    if (await cl2.isHuman(campaignId, c2S.address)) throw new Error("clipper2 unexpectedly verified");
    return false;
  }, () => "false");
  await expectFail("3c join clipper2 → NotHuman", () => cl2.join(campaignId), { source: "cliprail", code: 7, name: "NotHuman" });

  // 4. clipper2 proves as bob, joins
  await step("4a registerHumanZk clipper2 (bob)", () => registerZk("clipper2/bob", cl2, campaignId, "bob"), zkDetail);
  await step("4b isHuman clipper2", async () => {
    if (!(await cl2.isHuman(campaignId, c2S.address))) throw new Error("is_verified=false after register_zk");
    return true;
  }, () => "true");
  await step("4c join clipper2", () => cl2.join(campaignId), (r) => `code=${r.code} ${addLink("join clipper2", r.txHash)}`);
} catch {
  // recorded in results
}

// 5. measured cost
const okSims = probe.sim.filter((s) => s.ok);
if (okSims.length) {
  console.log("\n==== register_zk cost (simulation) ====");
  for (const s of okSims)
    console.log(`cpu=${s.instructions.toLocaleString("en-US")} instr  read=${s.readBytes}B  write=${s.writeBytes}B  minResourceFee=${xlm(s.minResourceFee)}  txFee=${xlm(s.txFee)}`);
}
if (probe.prove.length) console.log(`prove calls: ${probe.prove.map((p) => `${p.ms} ms${p.cached ? " (cached)" : ""} [HTTP ${p.status}]`).join(", ")}`);

if (campaignId && params) {
  const c = await brand.getCampaign(campaignId).catch(() => null);
  if (c) log(`campaign ${campaignId}: balance=${fmt(c.balance)} participants=${c.participants}`);
  if (process.env.REFUND === "1") {
    const ms = (Number(refundAt(params)) + 10) * 1000 - Date.now();
    if (ms > 0) log(`waiting ${Math.ceil(ms / 1000)} s for refund_at`);
    await sleep(ms);
    await step("refund (brand)", () => brand.refund(campaignId), (r) => `${fmt(r.amount)} ${addLink("refund", r.txHash)}`).catch(() => {});
  } else log(`refund_at=${refundAt(params)} (run with REFUND=1 to wait and refund)`);
}
summary();
process.exit(results.every((r) => r.ok) ? 0 : 1);
