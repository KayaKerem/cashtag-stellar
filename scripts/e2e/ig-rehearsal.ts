// Testnet rehearsal of an Instagram campaign against the HOSTED stack.
// Test tokens only, team accounts, no real funds.
//
// The organiser (brand) approves two participants, each submits an Instagram post, the organiser
// confirms likes and comments, the hosted keeper closes and settles, and the pool is split by
// engagement (likes + comments). Shortcodes are placeholders: the engagement is what the organiser
// confirms, so no Instagram request is made.
//
//   pnpm --filter e2e ig-rehearsal          (optional: SSH=deploy@host for the keeper's tx hashes)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApi, type Signer } from "@cliprail/client";
import { formatUsdc } from "@cliprail/shared";
import { Keypair, TransactionBuilder, hash } from "@stellar/stellar-sdk";
import { ACCOUNTS_DIR, PASSPHRASE, RPC_URL, accounts, identity, ledgerNow, waitLedgerTime, readEnvFile, txLink, contractLink, usdcBalance } from "./lib.ts";

const dep = readEnvFile(resolve(ACCOUNTS_DIR, "deploy.env"));
const CLIPRAIL = process.env.CLIPRAIL_ID || dep.CLIPRAIL_ID;
const HUMANITY = process.env.HUMANITY_ID || dep.HUMANITY_ID;
const USDC = process.env.USDC_SAC || accounts.USDC_SAC || dep.USDC_SAC;
const VERIFIER = (process.env.VERIFIER_URL || "https://91.99.152.134.sslip.io").replace(/\/+$/, "");
const SSH = process.env.SSH || "";
const OUT = process.env.OUT_FILE || resolve(ACCOUNTS_DIR, "ig-rehearsal.md");

const P = {
  budget: 100_000_000n, // 10 test USDC reward pool
  epochs: 1,
  rate_max_per_1k: 1_000_000_000n, // 100 test USDC per 1k engagement: the pool, not the rate, is the limit
  epoch_len: 180,
  proof_window: 120,
  dispute_window: 20,
  arbiter_window: 10,
  claim_grace: 180,
  bond: 10_000_000n,
};
const ENGAGEMENT = [
  { who: "clipper1", likes: 120, comments: 8 },
  { who: "clipper2", likes: 60, comments: 4 },
];

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
  createApi("chain", { rpcUrl: RPC_URL, networkPassphrase: PASSPHRASE, cliprailId: CLIPRAIL, humanityId: HUMANITY, usdcSac: USDC, verifierUrl: VERIFIER, signer: signer(kp) } as any);

/** POST a wallet-signed (SEP-53) action to the verifier, as the dashboard does. */
async function signedPost(kp: Keypair, path: string, fields: Record<string, unknown>) {
  const message = JSON.stringify({ ...fields, ts: Math.floor(Date.now() / 1000) });
  const sig = kp.sign(hash(Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message)])));
  const r = await fetch(`${VERIFIER}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature: Buffer.from(sig).toString("base64"), address: kp.publicKey() }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status}: ${j.error ?? ""}`);
  return j;
}

async function until(label: string, check: () => Promise<boolean>, timeoutS = 180) {
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
  return out.split("\n").filter((l) => pattern.test(l)).pop()?.match(/tx=([0-9a-f]{64})/)?.[1];
}

async function main() {
  const health = (await (await fetch(`${VERIFIER}/health`)).json()) as any;
  log(`verifier ${VERIFIER}: ok=${health.ok} attestorMode=${health.attestorMode} version=${health.version}`);
  if (!health.ok || health.cliprailId !== CLIPRAIL) throw new Error("hosted verifier not healthy or on another contract");

  const brandKp = identity("brand");
  const brand = apiFor(brandKp);
  const people = ENGAGEMENT.map((e) => ({ ...e, kp: identity(e.who), api: apiFor(identity(e.who)) }));
  const bal0 = await Promise.all(people.map((p) => usdcBalance(USDC, p.kp.publicKey())));
  const brandBal0 = await usdcBalance(USDC, brandKp.publicKey());
  const [arbiter] = await brand.listArbiters();
  if (!arbiter) throw new Error("no curated arbiter on the contract");

  // 1. organiser funds the reward pool
  const START = (await ledgerNow()).time + 90;
  const contentEnd = START + P.epoch_len;
  const proofEnd = contentEnd + P.proof_window;
  const settleAt = proofEnd + P.dispute_window + P.arbiter_window;
  const refundAt = settleAt + P.claim_grace;
  const c = await brand.createCampaign({
    budget: P.budget, rate_max_per_1k: P.rate_max_per_1k, cap_views_clip: 1_000_000_000n, cap_views_human: 1_000_000_000n, min_views: 1n,
    start: BigInt(START), epoch_len: BigInt(P.epoch_len), epochs: P.epochs, proof_window: BigInt(P.proof_window),
    dispute_window: BigInt(P.dispute_window), arbiter_window: BigInt(P.arbiter_window), claim_grace: BigInt(P.claim_grace),
    holdback_bps: 0, bond: P.bond, arbiter, platforms: ["instagram"], require_humanity: true,
    title: "Instagram pilot rehearsal", brief_url: "https://github.com/KayaKerem/cashtag-stellar/blob/main/RUNBOOK.md",
  } as any);
  const cid = c.id;
  record("Fund the reward pool (create_campaign, platform instagram)", "organiser", `campaign ${cid}, ${usdc(P.budget)} test USDC`, c.txHash);

  // 2. organiser approves participants; open self-registration is refused
  const open = await fetch(`${VERIFIER}/humanity/demo-register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: String(cid), wallet: people[0].kp.publicKey() }) });
  log(`open demo-register on an Instagram campaign -> ${open.status} (expected 401/403)`);
  for (const p of people) {
    const r = await signedPost(brandKp, "/ig/participants/approve", { action: "cashtag:ig-approve-participant", campaignId: String(cid), wallet: p.kp.publicKey() });
    record(`Approve participant ${p.who}`, "organiser (signed)", "registered for this campaign", r.txHash);
  }

  // 3. participants join, submit their post, register it as a clip (opening proof from the live attestor)
  const clips: bigint[] = [];
  for (const p of people) {
    const j = await p.api.join(cid);
    record(`Join (${p.who})`, p.who, `code ${j.code}`, j.txHash);
    (p as any).code = `CashtagIg${Date.now().toString(36)}${p.who.slice(-1)}`;
  }
  await waitLedgerTime(START + 2, "campaign start");
  for (const p of people) {
    const code = (p as any).code as string;
    await signedPost(p.kp, "/ig/submit", { action: "cashtag:ig-submit", campaignId: String(cid), post: `https://www.instagram.com/p/${code}/` });
    const t = Date.now();
    const rc = await p.api.registerClip(cid, "instagram" as any, code);
    clips.push(rc.clipId);
    record(`Register Instagram post (${p.who})`, p.who, `clip ${rc.clipId}, post ${code}, baseline 0, proof ${Math.round((Date.now() - t) / 1000)} s`, rc.txHash);
  }

  // 4. after the campaign, the organiser confirms engagement; the keeper closes and settles
  await waitLedgerTime(contentEnd, "content_end");
  for (const p of people) {
    await signedPost(brandKp, "/ig/approve", { action: "cashtag:ig-approve", campaignId: String(cid), post: (p as any).code, likes: p.likes, comments: p.comments });
    log(`organiser confirmed ${p.who}: ${p.likes} likes + ${p.comments} comments = ${p.likes + p.comments}`);
  }
  for (const [i, p] of people.entries()) {
    await until(`closing proof ${p.who}`, async () => ((await brand.getClips(cid)).find((v) => v.clip.id === clips[i])?.epochs[0]?.views ?? 0n) > 0n, proofEnd - (await ledgerNow()).time + 30);
    record(`Closing proof (${p.who}, keeper, live Reclaim)`, "hosted keeper", `engagement ${p.likes + p.comments}`, keeperTx(new RegExp(`submit c${cid} clip${clips[i]} e0 ok`)));
  }
  await waitLedgerTime(settleAt, "settle_at");
  await until("settle", async () => (await brand.getEpoch(cid, 0)).settled);
  const e0 = await brand.getEpoch(cid, 0);
  record("Settle (keeper)", "hosted keeper", `total engagement ${e0.total_weight}, spent ${usdc(e0.spent)}`, keeperTx(new RegExp(`settle c${cid} e0 ok`)));

  // 5. payouts, split by engagement
  const paid: bigint[] = [];
  for (const [i, p] of people.entries()) {
    const cl = await p.api.claim(cid, clips[i], 0);
    paid.push(cl.amount);
    record(`Payout (${p.who})`, p.who, `${usdc(cl.amount)} test USDC`, cl.txHash);
  }
  await waitLedgerTime(refundAt, "refund_at");
  const rf = await brand.refund(cid).catch((e: any) => ({ amount: 0n, txHash: undefined, err: e }));
  record("Refund of the remainder", "organiser", `${usdc(rf.amount)} test USDC`, rf.txHash);

  const total = paid.reduce((a, b) => a + b, 0n);
  const w = people.map((p) => BigInt(p.likes + p.comments));
  const ratioOk = paid[0] * w[1] - paid[1] * w[0] <= w[0] + w[1] && paid[1] * w[0] - paid[0] * w[1] <= w[0] + w[1];
  const conserved = total + rf.amount === P.budget;
  const bal1 = await Promise.all(people.map((p) => usdcBalance(USDC, p.kp.publicKey())));
  const balancesOk = people.every((_, i) => bal1[i] - bal0[i] === paid[i]) && brandBal0 - (await usdcBalance(USDC, brandKp.publicKey())) === P.budget - rf.amount;
  log(`paid ${paid.map(usdc).join(" + ")} + refund ${usdc(rf.amount)}; split by engagement ${ratioOk ? "ok" : "WRONG"}; conserved ${conserved}; balances ${balancesOk ? "match" : "MISMATCH"}`);

  const md = [
    `# Instagram campaign rehearsal, campaign ${cid}`,
    "",
    `Run ${new Date(t0).toISOString()}. Stellar testnet, test USDC, team accounts. No real funds.`,
    "",
    `- cliprail [${CLIPRAIL}](${contractLink(CLIPRAIL)}), humanity [${HUMANITY}](${contractLink(HUMANITY)}), verifier ${VERIFIER} (${health.version})`,
    `- engagement confirmed by the organiser: ${people.map((p) => `${p.who} ${p.likes} likes + ${p.comments} comments`).join(", ")}`,
    "",
    "| # | Step | By | Result | Tx |",
    "|---|---|---|---|---|",
    ...steps.map((s, i) => `| ${i + 1} | ${s.step} | ${s.by} | ${s.result} | ${s.tx ? `[${s.tx.slice(0, 8)}…](${txLink(s.tx)})` : "n/a"} |`),
    "",
    `Paid ${paid.map(usdc).join(" + ")} = ${usdc(total)} test USDC by engagement (${ratioOk ? "proportional" : "NOT proportional"}), refunded ${usdc(rf.amount)}; ${conserved ? "budget conserved" : "MISMATCH"}; wallet deltas ${balancesOk ? "match" : "DO NOT match"}.`,
    "",
  ].join("\n");
  mkdirSync(resolve(OUT, ".."), { recursive: true });
  writeFileSync(OUT, md);
  console.log(`\n${md}\nreport: ${OUT}`);
  if (!ratioOk || !conserved || !balancesOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
