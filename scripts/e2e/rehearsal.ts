// Testnet rehearsal of one full campaign lifecycle against the HOSTED stack (Deliverable 3).
// Test tokens only, team accounts, no real funds.
//
// This script plays the users (brand and clipper) through @cliprail/client, the same client the
// dashboard uses. Everything else runs on the hosted verifier, with nothing on this machine:
//   - the Anon Aadhaar humanity proof (TEST mode, UIDAI test data)
//   - the opening Reclaim proof (live attestor) for register_clip
//   - closing proofs (submit_proof), settle_epoch and refund timing: the keeper
//
//   VERIFIER_URL=https://91.99.152.134.sslip.io WRITE_TOKEN=… pnpm --filter e2e rehearsal
//
// Optional: SSH=deploy@host to collect the keeper's tx hashes from the container log,
// HUMANITY_MODE=demo to use the relayer demo registration instead of the Aadhaar proof.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApi, type Signer } from "@cliprail/client";
import { formatUsdc } from "@cliprail/shared";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { ACCOUNTS_DIR, PASSPHRASE, RPC_URL, accounts, identity, ledgerNow, waitLedgerTime, readEnvFile, txLink, contractLink, usdcBalance } from "./lib.ts";

const dep = readEnvFile(resolve(ACCOUNTS_DIR, "deploy.env"));
const CLIPRAIL = process.env.CLIPRAIL_ID || dep.CLIPRAIL_ID;
const HUMANITY = process.env.HUMANITY_ID || dep.HUMANITY_ID;
const USDC = process.env.USDC_SAC || accounts.USDC_SAC || dep.USDC_SAC;
const VERIFIER = (process.env.VERIFIER_URL || "https://91.99.152.134.sslip.io").replace(/\/+$/, "");
const TOKEN = process.env.WRITE_TOKEN || "";
const SSH = process.env.SSH || "";
const HUMANITY_MODE = process.env.HUMANITY_MODE || "aadhaar";
const OUT = process.env.OUT_FILE || resolve(ACCOUNTS_DIR, "rehearsal.md");

const P = {
  budget: 100_000_000n, // 10 test USDC
  epochs: 2,
  rate_max_per_1k: 10_000_000n, // 1 test USDC per 1k views
  cap_views_clip: 1_000_000_000n,
  cap_views_human: 1_000_000_000n,
  min_views: 1n,
  epoch_len: 180,
  proof_window: 100,
  dispute_window: 20,
  arbiter_window: 10,
  claim_grace: 180, // contract: claim_grace >= epoch_len
  holdback_bps: 2000,
  bond: 10_000_000n,
};
// timeline (contracts/cliprail/src/epoch.rs)
const T = (start: number) => {
  const contentEnd = (e: number) => start + (e + 1) * P.epoch_len;
  const proofEnd = (e: number) => contentEnd(e) + P.proof_window;
  const disputeEnd = (e: number) => proofEnd(e) + P.dispute_window;
  const settleAt = (e: number) => disputeEnd(e) + P.arbiter_window;
  return { contentEnd, proofEnd, settleAt, refundAt: settleAt(P.epochs - 1) + P.claim_grace };
};

const t0 = Date.now();
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} +${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s ${m}`);
const steps: { step: string; by: string; result: string; tx?: string }[] = [];
const record = (step: string, by: string, result: string, tx?: string) => {
  steps.push({ step, by, result, tx });
  log(`${step}: ${result}${tx ? `\n${" ".repeat(16)}${txLink(tx)}` : ""}`);
};
const usdc = (v: bigint) => formatUsdc(v);

function signer(kp: Keypair): Signer {
  return {
    getAddress: async () => kp.publicKey(),
    signTransaction: async (xdr, o) => {
      const tx = TransactionBuilder.fromXDR(xdr, o.networkPassphrase);
      tx.sign(kp);
      return { signedTxXdr: tx.toXDR() };
    },
  };
}
const apiFor = (kp: Keypair) =>
  createApi("chain", {
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    cliprailId: CLIPRAIL,
    humanityId: HUMANITY,
    usdcSac: USDC,
    verifierUrl: VERIFIER,
    writeToken: TOKEN,
    signer: signer(kp),
  });

async function bump(vid: string, body: Record<string, unknown>) {
  const r = await fetch(`${VERIFIER}/demo/videos/${encodeURIComponent(vid)}/bump`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`demo bump ${r.status}: ${await r.text()}`);
  return (await r.json()) as { views: number };
}

/** Polls until `check` is true; the keeper (not this script) moves the chain forward. */
async function until(label: string, check: () => Promise<boolean>, timeoutS = 120) {
  const end = Date.now() + timeoutS * 1000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function keeperTx(pattern: RegExp): string | undefined {
  if (!SSH) return undefined;
  const out = execFileSync("ssh", [SSH, "docker logs --since 1h deploy-verifier-1 2>&1 | grep '^\\[keeper\\]'"], { encoding: "utf8" });
  const line = out.split("\n").filter((l) => pattern.test(l)).pop();
  return line?.match(/tx=([0-9a-f]{64})/)?.[1];
}

const provenViews = async (api: ReturnType<typeof apiFor>, cid: bigint, clipId: bigint, e: number) =>
  (await api.getClips(cid)).find((v) => v.clip.id === clipId)?.epochs[e]?.views ?? 0n;

async function main() {
  if (!CLIPRAIL || !HUMANITY || !USDC) throw new Error("contract IDs missing (scripts/.accounts/deploy.env)");
  if (!TOKEN) throw new Error("WRITE_TOKEN is required (verifier write token)");

  const health = (await (await fetch(`${VERIFIER}/health`)).json()) as any;
  log(`verifier ${VERIFIER}: ok=${health.ok} attestorMode=${health.attestorMode} network=${health.network}`);
  if (!health.ok || health.attestorMode !== "reclaim") throw new Error("hosted verifier is not healthy / not in reclaim mode");
  if (health.cliprailId !== CLIPRAIL) throw new Error(`verifier points at ${health.cliprailId}, not ${CLIPRAIL}`);

  const kp = { brand: identity("brand"), clipper: identity("clipper1") };
  const brand = apiFor(kp.brand);
  const clipper = apiFor(kp.clipper);
  const addr = { brand: kp.brand.publicKey(), clipper: kp.clipper.publicKey() };
  const bal0 = { brand: await usdcBalance(USDC, addr.brand), clipper: await usdcBalance(USDC, addr.clipper) };
  log(`balances: brand ${usdc(bal0.brand)}, clipper ${usdc(bal0.clipper)} test USDC`);

  const [arbiter] = await brand.listArbiters();
  if (!arbiter) throw new Error("no curated arbiter on the contract");

  // 1. fund
  const l0 = await ledgerNow();
  const START = l0.time + (HUMANITY_MODE === "aadhaar" ? 200 : 60);
  const tl = T(START);
  log(`start=${START} content_end0=${tl.contentEnd(0)} settle0=${tl.settleAt(0)} settle1=${tl.settleAt(1)} refund=${tl.refundAt}`);
  const c = await brand.createCampaign({
    budget: P.budget,
    rate_max_per_1k: P.rate_max_per_1k,
    cap_views_clip: P.cap_views_clip,
    cap_views_human: P.cap_views_human,
    min_views: P.min_views,
    start: BigInt(START),
    epoch_len: BigInt(P.epoch_len),
    epochs: P.epochs,
    proof_window: BigInt(P.proof_window),
    dispute_window: BigInt(P.dispute_window),
    arbiter_window: BigInt(P.arbiter_window),
    claim_grace: BigInt(P.claim_grace),
    holdback_bps: P.holdback_bps,
    bond: P.bond,
    arbiter,
    platforms: ["demo"],
    require_humanity: true,
    title: "Testnet rehearsal",
    brief_url: "https://github.com/KayaKerem/cashtag-stellar/blob/main/RUNBOOK.md",
  } as any);
  const cid = c.id;
  record("Fund campaign (create_campaign, budget escrowed)", "brand", `campaign ${cid}, ${usdc(P.budget)} test USDC`, c.txHash);

  // 2. creator registration
  if (HUMANITY_MODE === "aadhaar") {
    const t = Date.now();
    const h = await clipper.registerHumanZk(cid, { identity: `rehearsal-${cid}-${START}` });
    record("Proof of humanity (Anon Aadhaar, TEST data, proved on the hosted prover)", "clipper", `nullifier ${h.nullifier.slice(0, 12)}…, ${Math.round((Date.now() - t) / 1000)} s`, h.txHash);
  } else {
    const h = await clipper.registerHuman(cid);
    record("Proof of humanity (demo relayer registration)", "clipper", "registered", h.txHash);
  }
  const j = await clipper.join(cid);
  record("Join campaign", "clipper", `code ${j.code}`, j.txHash);

  const vid = `rehearsal-${Date.now().toString(36)}`;
  await bump(vid, { views: 1200, desc: `Testnet rehearsal clip. Join: ${j.code} #ad` });
  await waitLedgerTime(START + 2, "campaign start");
  const t1 = Date.now();
  const rc = await clipper.registerClip(cid, "demo", vid);
  record("Register clip (opening proof from the live Reclaim attestor)", "clipper", `clip ${rc.clipId}, baseline 1200 views, proof ${Math.round((Date.now() - t1) / 1000)} s`, rc.txHash);

  // 3. epoch 0: views grow, the keeper submits the closing proof and settles
  await bump(vid, { delta: 4000 });
  log("demo views 1200 → 5200; waiting for the keeper's epoch-0 closing proof");
  await until("epoch 0 closing proof", async () => (await provenViews(clipper, cid, rc.clipId, 0)) > 0n, tl.proofEnd(0) - START);
  record("Closing proof epoch 0 (keeper, live Reclaim)", "hosted keeper", "5200 views", keeperTx(new RegExp(`submit c${cid} clip${rc.clipId} e0 ok`)));

  await bump(vid, { delta: 3000 });
  await waitLedgerTime(tl.settleAt(0), "settle_at(0)");
  await until("epoch 0 settle", async () => (await brand.getEpoch(cid, 0)).settled);
  const e0 = await brand.getEpoch(cid, 0);
  record("Settle epoch 0 (keeper)", "hosted keeper", `rate ${usdc(e0.rate)} test USDC per 1k views, spent ${usdc(e0.spent)}, held back ${usdc(e0.held_total)}`, keeperTx(new RegExp(`settle c${cid} e0 ok`)));
  const cl0 = await clipper.claim(cid, rc.clipId, 0);
  record("Payout epoch 0 (claim)", "clipper", `${usdc(cl0.amount)} test USDC`, cl0.txHash);

  // 4. epoch 1: second closing proof releases the epoch-0 holdback
  log("demo views 5200 → 8200; waiting for the keeper's epoch-1 closing proof");
  await until("epoch 1 closing proof", async () => (await provenViews(clipper, cid, rc.clipId, 1)) > 0n, tl.proofEnd(1) - (await ledgerNow()).time + 30);
  record("Closing proof epoch 1 (keeper, live Reclaim)", "hosted keeper", "8200 views", keeperTx(new RegExp(`submit c${cid} clip${rc.clipId} e1 ok`)));
  await waitLedgerTime(tl.proofEnd(1), "proof_end(1)");
  const hb = await clipper.claimHoldback(cid, rc.clipId, 0);
  record("Holdback release epoch 0 (claim_holdback)", "clipper", `${usdc(hb.amount)} test USDC`, hb.txHash);

  await waitLedgerTime(tl.settleAt(1), "settle_at(1)");
  await until("epoch 1 settle", async () => (await brand.getEpoch(cid, 1)).settled);
  const e1 = await brand.getEpoch(cid, 1);
  record("Settle epoch 1 (keeper)", "hosted keeper", `rate ${usdc(e1.rate)} test USDC per 1k views, spent ${usdc(e1.spent)}`, keeperTx(new RegExp(`settle c${cid} e1 ok`)));
  const cl1 = await clipper.claim(cid, rc.clipId, 1);
  record("Payout epoch 1 (claim, last epoch, no holdback)", "clipper", `${usdc(cl1.amount)} test USDC`, cl1.txHash);

  // 5. refund of the unspent budget
  await waitLedgerTime(tl.refundAt, "refund_at");
  const rf = await brand.refund(cid);
  record("Refund unspent budget", "brand", `${usdc(rf.amount)} test USDC`, rf.txHash);

  const paid = cl0.amount + hb.amount + cl1.amount;
  const bal1 = { brand: await usdcBalance(USDC, addr.brand), clipper: await usdcBalance(USDC, addr.clipper) };
  const conserved = paid + rf.amount === P.budget;
  const balancesOk = bal1.clipper - bal0.clipper === paid && bal0.brand - bal1.brand === P.budget - rf.amount;
  log(`paid ${usdc(paid)} + refund ${usdc(rf.amount)} = ${usdc(paid + rf.amount)} of ${usdc(P.budget)} → ${conserved ? "conserved" : "MISMATCH"}; balances ${balancesOk ? "match" : "MISMATCH"}`);

  // report
  const md = [
    `# Testnet rehearsal, campaign ${cid}`,
    "",
    `Run ${new Date(t0).toISOString()}. Stellar testnet, test USDC, team accounts. No real funds.`,
    "",
    `- cliprail [${CLIPRAIL}](${contractLink(CLIPRAIL)}), humanity [${HUMANITY}](${contractLink(HUMANITY)})`,
    `- hosted verifier ${VERIFIER} (attestor mode \`${health.attestorMode}\`), clip \`demo/${vid}\``,
    "",
    "| # | Step | By | Result | Tx |",
    "|---|---|---|---|---|",
    ...steps.map((s, i) => `| ${i + 1} | ${s.step} | ${s.by} | ${s.result} | ${s.tx ? `[${s.tx.slice(0, 8)}…](${txLink(s.tx)})` : "n/a"} |`),
    "",
    `Paid to the clipper ${usdc(paid)} + refunded ${usdc(rf.amount)} = ${usdc(paid + rf.amount)} of the ${usdc(P.budget)} budget (${conserved ? "conserved" : "MISMATCH"}). Wallet deltas ${balancesOk ? "match" : "DO NOT match"}.`,
    "",
  ].join("\n");
  mkdirSync(resolve(OUT, ".."), { recursive: true });
  writeFileSync(OUT, md);
  console.log(`\n${md}\nreport: ${OUT}`);
  if (!conserved || !balancesOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
