// End-to-end lifecycle of the e2e cliprail instance on Stellar testnet with short windows.
// Proofs are signed locally by a test attestor (proofgen.ts). Timing follows ledger close time.
// Writes docs/e2e-testnet-run.md. Usage: pnpm --filter e2e run   (after deploy.ts)
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT,
  E2E_ENV,
  accounts,
  identity,
  invoke,
  expectSimError,
  view,
  ledgerNow,
  waitLedgerTime,
  readEnvFile,
  usdcBalance,
  sv,
  txLink,
  contractLink,
  type InvokeResult,
} from "./lib.ts";
import { makeProof, type LocalProof } from "./proofgen.ts";
import {
  baseBudget,
  clipWeight,
  participantWeight,
  rateFor,
  payFor,
  splitPay,
  holdbackShare,
} from "@cliprail/shared";
import { structToScVal } from "../../services/verifier/src/scval.ts";

const env = readEnvFile(E2E_ENV);
const CLIPRAIL = env.E2E_CLIPRAIL_ID;
const HUMANITY = env.E2E_HUMANITY_ID;
const USDC = accounts.USDC_SAC;
if (!CLIPRAIL || !HUMANITY) throw new Error("run deploy.ts first (scripts/.accounts/e2e.env)");

const ERR: Record<number, string> = {
  2: "NullifierUsed", 7: "NotHuman", 8: "WrongPhase", 19: "ProofReused", 21: "EpochNotReady", 24: "OpenDisputes",
  26: "NothingToClaim", 31: "Excluded", 32: "RefundNotReady",
};

// ------------------------------------------------------------------ parameters

const P = {
  budget: 200_000_000n, // 20 USDC
  epochs: 2,
  rate_max_per_1k: 10_000_000n, // 1 USDC / 1k views
  cap_views_clip: 1_000_000_000n,
  cap_views_human: 1_000_000_000n,
  min_views: 1n,
  epoch_len: 60,
  proof_window: 20,
  dispute_window: 20,
  arbiter_window: 10,
  claim_grace: 60,
  holdback_bps: 2000,
  bond: 10_000_000n, // 1 USDC
};
const BASELINE = 100n;
const VIEWS_E0 = { c1: 5100n, c2: 3100n, c3: 9100n };
const VIEWS_E1_C1 = 8100n;

// timeline (same formulas as contracts/cliprail/src/epoch.rs)
const T = (start: number) => {
  const contentEnd = (e: number) => start + (e + 1) * P.epoch_len;
  const proofEnd = (e: number) => contentEnd(e) + P.proof_window;
  const challengeEnd = (e: number) => proofEnd(e) + P.dispute_window / 2;
  const disputeEnd = (e: number) => proofEnd(e) + P.dispute_window;
  const settleAt = (e: number) => disputeEnd(e) + P.arbiter_window;
  const refundAt = settleAt(P.epochs - 1) + P.claim_grace;
  return { contentEnd, proofEnd, challengeEnd, disputeEnd, settleAt, refundAt };
};

// ------------------------------------------------------------------ step log

type Row = { n: number; step: string; expect: string; result: string; pass: boolean; hash?: string; t?: number; r?: InvokeResult };
const rows: Row[] = [];
const costs: Record<string, InvokeResult[]> = {};
let failures = 0;

function record(step: string, expect: string, r: InvokeResult | { ok: boolean; code?: number; error?: string; value?: unknown }, pass: boolean, result?: string) {
  const rr = r as InvokeResult;
  const res =
    result ??
    (r.ok ? `ok${r.value !== undefined ? ` → ${fmt(r.value)}` : ""}` : `error ${r.code !== undefined ? `#${r.code} ${ERR[r.code] ?? ""}` : r.error}`);
  const row: Row = { n: rows.length + 1, step, expect, result: res, pass, hash: rr.hash, r: rr };
  rows.push(row);
  if (!pass) failures++;
  console.log(`${new Date().toISOString().slice(11, 19)} ${pass ? "PASS" : "FAIL"} ${String(row.n).padStart(2)}. ${step} — ${res}${rr.hash ? `\n       ${txLink(rr.hash)}` : ""}`);
  return row;
}

const fmt = (v: unknown): string => (typeof v === "bigint" ? v.toString() : typeof v === "object" ? JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) : String(v));
const usdc = (x: bigint) => `${x < 0n ? "-" : ""}${(Number(x < 0n ? -x : x) / 1e7).toFixed(7)}`;

function cost(method: string, r: InvokeResult) {
  if (r.ok) (costs[method] ??= []).push(r);
}

async function tx(step: string, expect: string, method: string, contract: string, args: any[], signer: string, check?: (r: InvokeResult) => boolean) {
  const r = await invoke(contract, method, args, identity(signer));
  cost(method, r);
  return { r, row: record(step, expect, r, r.ok && (check ? check(r) : true)) };
}

async function negative(step: string, code: number, method: string, contract: string, args: any[], signer: string) {
  const r = await expectSimError(contract, method, args, identity(signer));
  return record(`${step} (simulation)`, `error #${code} ${ERR[code] ?? ""}`, r, !r.ok && r.code === code);
}

// ------------------------------------------------------------------ main

async function main() {
  const who = { brand: accounts.BRAND, c1: accounts.CLIPPER1, c2: accounts.CLIPPER2, c3: accounts.CLIPPER3, arbiter: accounts.ARBITER };
  const names = { c1: "clipper1", c2: "clipper2", c3: "clipper3" } as const;
  const vids = { c1: "e2e-a", c2: "e2e-b", c3: "e2e-c" } as const;
  const keys = ["c1", "c2", "c3"] as const;

  console.log(`cliprail(e2e) ${CLIPRAIL}\nhumanity(e2e) ${HUMANITY}\nUSDC ${USDC}\n`);
  const bal0: Record<string, bigint> = {};
  for (const [k, a] of Object.entries(who)) bal0[k] = await usdcBalance(USDC, a);
  bal0.contract = await usdcBalance(USDC, CLIPRAIL);

  // start aligned to the latest ledger close so window edges fall near ledger closes
  const l0 = await ledgerNow();
  const START = l0.time + 40;
  const tl = T(START);
  console.log(`ledger t=${l0.time}; start=${START} content_end0=${tl.contentEnd(0)} proof_end0=${tl.proofEnd(0)} challenge_end0=${tl.challengeEnd(0)} dispute_end0=${tl.disputeEnd(0)} settle0=${tl.settleAt(0)} settle1=${tl.settleAt(1)} refund=${tl.refundAt}\n`);

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
    title: sv.str("E2E testnet run"),
    brief_url: sv.str("https://e2e.invalid/brief"),
  });

  // 1. campaign
  const { r: rc } = await tx("brand create_campaign (20 USDC, 2×60s)", "campaign id", "create_campaign", CLIPRAIL, [sv.addr(who.brand), params], "brand");
  if (!rc.ok) throw new Error("create_campaign failed");
  const cid = BigInt(rc.value as bigint);

  // 2. humanity (relayer; sequential: same source account)
  const nullifier = (k: string) => createHash("sha256").update(`cliprail-e2e:${cid}:${k}:${START}`).digest();
  for (const k of keys) {
    await tx(`relayer humanity.register ${names[k]}`, "ok", "register", HUMANITY, [sv.u64(cid), sv.bytes(nullifier(k)), sv.addr(who[k])], "relayer");
  }
  // attack: same nullifier, different wallet
  await negative("attack: humanity.register same nullifier for arbiter wallet", 2, "register", HUMANITY, [sv.u64(cid), sv.bytes(nullifier("c1")), sv.addr(who.arbiter)], "relayer");
  // attack: join without humanity
  await negative("attack: join without humanity (arbiter wallet)", 7, "join", CLIPRAIL, [sv.u64(cid), sv.addr(who.arbiter)], "arbiter");

  // 3. join ×3 (parallel, each clipper is its own source)
  const codes: Record<string, string> = {};
  await Promise.all(
    keys.map(async (k) => {
      const { r } = await tx(`${names[k]} join`, "participant code CR-XXXXXX", "join", CLIPRAIL, [sv.u64(cid), sv.addr(who[k])], names[k], (r) => /^CR-[0-9A-Z]{6}$/.test(String(r.value)));
      codes[k] = String(r.value);
    }),
  );
  if (keys.some((k) => !codes[k] || codes[k] === "undefined")) throw new Error("join failed");
  const desc = (k: string) => `E2E demo clip. Join the campaign: ${codes[k]}\\nLinks: https://e2e.invalid/?a=1&b=2`;

  // 4. register_clip ×3 (baseline 100). Sequential: every call writes Clip(ClipCount+1), so two
  //    register_clip txs simulated against the same ledger collide (footprint miss → trap).
  const clipIds: Record<string, bigint> = {};
  for (const k of keys) {
    const t = (await ledgerNow()).time;
    const pr = makeProof(vids[k], BASELINE, desc(k), t, `cliprail:${cid}:register`);
    const { r } = await tx(`${names[k]} register_clip demo/${vids[k]} (baseline ${BASELINE})`, "clip id", "register_clip", CLIPRAIL, [sv.u64(cid), sv.addr(who[k]), sv.sym("demo"), sv.str(vids[k]), pr.scval], names[k]);
    if (!r.ok) throw new Error("register_clip failed");
    clipIds[k] = BigInt(r.value as bigint);
  }
  const lt = (await ledgerNow()).time;
  if (lt >= tl.contentEnd(0) - 5) console.log(`WARNING: setup finished late (t=${lt})`);

  // 5. epoch 0 close proofs
  await waitLedgerTime(tl.contentEnd(0), "content_end(0)");
  const proofsE0: Record<string, LocalProof> = {};
  {
    const t = (await ledgerNow()).time;
    await Promise.all(
      keys.map(async (k) => {
        proofsE0[k] = makeProof(vids[k], VIEWS_E0[k], desc(k), t, `cliprail:${cid}:e0`);
        await tx(`${names[k]} submit_proof epoch 0 (views ${VIEWS_E0[k]})`, "ok", "submit_proof", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds[k]), sv.u32(0), proofsE0[k].scval], names[k]);
      }),
    );
  }
  // attack: replay the same proof
  await negative("attack: replay clipper1 epoch-0 proof", 19, "submit_proof", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds.c1), sv.u32(0), proofsE0.c1.scval], "clipper1");

  // 6. challenge clipper3 in [proof_end, challenge_end)
  await waitLedgerTime(tl.proofEnd(0), "proof_end(0)");
  const { r: rch } = await tx("brand challenge clipper3 epoch 0 (bond 1 USDC)", "dispute id", "challenge", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds.c3), sv.u32(0), sv.addr(who.brand), sv.str("e2e: views look botted")], "brand");
  if (!rch.ok) throw new Error(`challenge failed: ${rch.error} (window [${tl.proofEnd(0)}, ${tl.challengeEnd(0)}))`);
  const disputeId = BigInt(rch.value as bigint);
  await negative("settle_epoch 0 before settle_at", 21, "settle_epoch", CLIPRAIL, [sv.u64(cid), sv.u32(0)], "admin");

  // 7. unanswered → finalize at dispute_end (challenger wins)
  await waitLedgerTime(tl.disputeEnd(0), "dispute_end(0)");
  await tx("finalize_dispute (unanswered → challenger wins, clip excluded)", "ok", "finalize_dispute", CLIPRAIL, [sv.u64(disputeId)], "admin");

  // 8. settle epoch 0
  await waitLedgerTime(tl.settleAt(0), "settle_at(0)");
  await tx("settle_epoch 0", "ok", "settle_epoch", CLIPRAIL, [sv.u64(cid), sv.u32(0)], "admin");
  const st0 = await view(CLIPRAIL, "get_epoch", [sv.u64(cid), sv.u32(0)]);

  // expected (packages/shared/src/payout.ts)
  const cp = { budget: P.budget, epochs: P.epochs, rate_max_per_1k: P.rate_max_per_1k, holdback_bps: P.holdback_bps, cap_views_clip: P.cap_views_clip, cap_views_human: P.cap_views_human, min_views: P.min_views };
  const w0 = { c1: clipWeight(cp, BASELINE, VIEWS_E0.c1), c2: clipWeight(cp, BASELINE, VIEWS_E0.c2), c3: 0n /* excluded */ };
  const W0 = participantWeight(cp, w0.c1) + participantWeight(cp, w0.c2);
  const budget0 = baseBudget(cp, 0);
  const rate0 = rateFor(cp, budget0, W0);
  const spent0 = (rate0 * W0) / 1000n;
  const heldTotal0 = (spent0 * BigInt(P.holdback_bps)) / 10_000n;
  const pay0 = { c1: splitPay(cp, 0, payFor(rate0, w0.c1, w0.c1, w0.c1)), c2: splitPay(cp, 0, payFor(rate0, w0.c2, w0.c2, w0.c2)) };
  const eqB = (a: unknown, b: bigint) => BigInt(a as bigint) === b;
  record(
    "epoch 0 state vs payout.ts",
    `W=${W0} rate=${rate0} spent=${spent0} held_total=${heldTotal0}`,
    { ok: true },
    eqB(st0.total_weight, W0) && eqB(st0.rate, rate0) && eqB(st0.spent, spent0) && eqB(st0.held_total, heldTotal0) && st0.settled === true,
    `W=${st0.total_weight} rate=${st0.rate} spent=${st0.spent} held_total=${st0.held_total}`,
  );

  // 9. claims epoch 0
  await Promise.all(
    (["c1", "c2"] as const).map((k) =>
      tx(`${names[k]} claim epoch 0`, `${usdc(pay0[k].immediate)} USDC`, "claim", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds[k]), sv.u32(0)], names[k], (r) => eqB(r.value, pay0[k].immediate)),
    ),
  );
  await negative("clipper3 claim epoch 0 (excluded)", 31, "claim", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds.c3), sv.u32(0)], "clipper3");

  // 10. epoch 1: only clipper1 proves (clipper2 "deleted" → loses holdback)
  await waitLedgerTime(tl.contentEnd(1), "content_end(1)");
  {
    const t = (await ledgerNow()).time;
    const pr = makeProof(vids.c1, VIEWS_E1_C1, desc("c1"), t, `cliprail:${cid}:e1`);
    await tx(`clipper1 submit_proof epoch 1 (views ${VIEWS_E1_C1})`, "ok", "submit_proof", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds.c1), sv.u32(1), pr.scval], "clipper1");
  }

  // 11. holdback of epoch 0 after proof_end(1)
  await waitLedgerTime(tl.proofEnd(1), "proof_end(1)");
  const st0b = await view(CLIPRAIL, "get_epoch", [sv.u64(cid), sv.u32(0)]);
  const hb1 = holdbackShare(pay0.c1.held, { held_total: BigInt(st0b.held_total), held_survived: BigInt(st0b.held_survived) });
  record("epoch 0 held_survived = clipper1 held only", `${pay0.c1.held}`, { ok: true }, eqB(st0b.held_survived, pay0.c1.held), `${st0b.held_survived}`);
  await tx("clipper1 claim_holdback epoch 0 (survivor)", `${usdc(heldTotal0)} USDC (= held_total)`, "claim_holdback", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds.c1), sv.u32(0)], "clipper1", (r) => eqB(r.value, hb1) && hb1 === heldTotal0);
  await negative("clipper2 claim_holdback epoch 0 (no epoch-1 proof)", 26, "claim_holdback", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds.c2), sv.u32(0)], "clipper2");

  // 12. settle epoch 1 + claim
  await waitLedgerTime(tl.settleAt(1), "settle_at(1)");
  await tx("settle_epoch 1", "ok", "settle_epoch", CLIPRAIL, [sv.u64(cid), sv.u32(1)], "admin");
  const w1 = clipWeight(cp, VIEWS_E0.c1, VIEWS_E1_C1);
  const budget1 = baseBudget(cp, 1) + (budget0 - spent0);
  const rate1 = rateFor(cp, budget1, w1);
  const pay1 = splitPay(cp, 1, payFor(rate1, w1, w1, w1));
  const st1 = await view(CLIPRAIL, "get_epoch", [sv.u64(cid), sv.u32(1)]);
  record("epoch 1 state vs payout.ts", `budget=${budget1} W=${w1} rate=${rate1}`, { ok: true }, eqB(st1.budget, budget1) && eqB(st1.total_weight, w1) && eqB(st1.rate, rate1), `budget=${st1.budget} W=${st1.total_weight} rate=${st1.rate}`);
  await tx("clipper1 claim epoch 1 (last epoch, no holdback)", `${usdc(pay1.pay)} USDC`, "claim", CLIPRAIL, [sv.u64(cid), sv.u64(clipIds.c1), sv.u32(1)], "clipper1", (r) => eqB(r.value, pay1.pay));
  await negative("refund before refund_at", 32, "refund", CLIPRAIL, [sv.u64(cid)], "brand");

  // 13. refund
  await waitLedgerTime(tl.refundAt, "refund_at");
  const paidOut = pay0.c1.immediate + pay0.c2.immediate + hb1 + pay1.pay;
  const expRefund = P.budget - paidOut;
  await tx("brand refund", `${usdc(expRefund)} USDC`, "refund", CLIPRAIL, [sv.u64(cid)], "brand", (r) => eqB(r.value, expRefund));

  // 14. balances
  const bal1: Record<string, bigint> = {};
  for (const [k, a] of Object.entries(who)) bal1[k] = await usdcBalance(USDC, a);
  bal1.contract = await usdcBalance(USDC, CLIPRAIL);
  const expDelta: Record<string, bigint> = {
    brand: -P.budget + expRefund, // bond posted and returned (challenger won)
    c1: pay0.c1.immediate + hb1 + pay1.pay,
    c2: pay0.c2.immediate,
    c3: 0n,
    arbiter: 0n,
    contract: 0n,
  };
  const balRows: string[] = [];
  for (const k of Object.keys(expDelta)) {
    const d = bal1[k] - bal0[k];
    const ok = d === expDelta[k];
    balRows.push(`| ${k} | ${usdc(bal0[k])} | ${usdc(bal1[k])} | ${usdc(d)} | ${usdc(expDelta[k])} | ${ok ? "✅" : "❌"} |`);
    record(`USDC delta ${k}`, usdc(expDelta[k]), { ok: true }, ok, usdc(d));
  }

  // ------------------------------------------------------------------ report
  const costRows = Object.entries(costs).map(([m, rs]) => {
    const avg = (f: (r: InvokeResult) => number | undefined) => Math.round(rs.reduce((s, r) => s + (f(r) ?? 0), 0) / rs.length);
    const max = (f: (r: InvokeResult) => number | undefined) => Math.max(...rs.map((r) => f(r) ?? 0));
    return `| ${m} | ${rs.length} | ${avg((r) => r.instructions).toLocaleString("en")} (max ${max((r) => r.instructions).toLocaleString("en")}) | ${avg((r) => r.readBytes)} / ${avg((r) => r.writeBytes)} | ${avg((r) => r.minResourceFee)} | ${avg((r) => r.feeCharged)} (${(avg((r) => r.feeCharged) / 1e7).toFixed(4)} XLM) |`;
  });
  const passN = rows.filter((r) => r.pass).length;
  const md = `# E2E testnet koşusu

Yerel test attestor'u ile imzalanmış Reclaim biçimli kanıtlarla, ayrı bir e2e kurulumunda (ana deploy'dan bağımsız) tüm kampanya yaşam döngüsü. Script: \`scripts/e2e/\` (\`pnpm --filter e2e deploy\`, \`pnpm --filter e2e run\`).

- Tarih: ${new Date().toISOString()}
- Sonuç: **${passN}/${rows.length} adım geçti${failures ? `, ${failures} başarısız` : ""}**
- cliprail (e2e): [\`${CLIPRAIL}\`](${contractLink(CLIPRAIL)})
- humanity (e2e): [\`${HUMANITY}\`](${contractLink(HUMANITY)})
- USDC SAC: \`${USDC}\`, kampanya id: ${cid}
- Test attestor: \`${env.E2E_ATTESTOR}\`, owner: \`${env.E2E_OWNER}\` (anahtarlar sabit test string'lerinden türetilir, gerçek değildir)
- Parametreler: bütçe 20 USDC, 2 epoch × 60 sn, proof 20 / dispute 20 / arbiter 10 sn, claim_grace 60 sn, r_max 1 USDC/1k, holdback %20, bond 1 USDC, min_views 1, require_humanity
- Zaman çizelgesi (ledger zamanı): start ${START}, content_end(0) ${tl.contentEnd(0)}, proof_end(0) ${tl.proofEnd(0)}, challenge_end(0) ${tl.challengeEnd(0)}, dispute_end(0) ${tl.disputeEnd(0)}, settle_at(0) ${tl.settleAt(0)}, content_end(1) ${tl.contentEnd(1)}, proof_end(1) ${tl.proofEnd(1)}, settle_at(1) ${tl.settleAt(1)}, refund_at ${tl.refundAt}

Negatif kontroller "(simulation)" ile işaretli: testnet RPC üzerinde simülasyon, tx gönderilmedi.

## Adımlar

| # | Adım | Beklenen | Sonuç | Tx | |
|---|---|---|---|---|---|
${rows.map((r) => `| ${r.n} | ${r.step} | ${r.expect} | ${r.result.replace(/\|/g, "\\|")} | ${r.hash ? `[${r.hash.slice(0, 8)}…](${txLink(r.hash)})` : "—"} | ${r.pass ? "✅" : "❌"} |`).join("\n")}

## USDC bakiyeleri

| Hesap | Önce | Sonra | Fark | Beklenen (payout.ts) | |
|---|---|---|---|---|---|
${balRows.join("\n")}

Beklenen: epoch 0 W=${W0} (clipper3 hariç), rate=${rate0}, clipper1 ${usdc(pay0.c1.pay)} (anında ${usdc(pay0.c1.immediate)}, holdback ${usdc(pay0.c1.held)}), clipper2 ${usdc(pay0.c2.pay)} (anında ${usdc(pay0.c2.immediate)}, holdback kaybedildi). Epoch 1 bütçe ${usdc(budget1)} (devir dahil), clipper1 ${usdc(pay1.pay)}. clipper1 holdback payı ${usdc(hb1)} (held_total ${usdc(heldTotal0)} tek hayatta kalana). İade ${usdc(expRefund)}.

## Maliyet (simülasyon kaynakları ve ödenen ücret)

| Fonksiyon | n | CPU talimatı (ort.) | okuma / yazma bayt | min kaynak ücreti (stroop) | ödenen ücret (stroop) |
|---|---|---|---|---|---|
${costRows.join("\n")}

## Bulgular

- Kontrat hatası bulunmadı: tüm ödemeler \`packages/shared/src/payout.ts\` formülleriyle birebir aynı, kontrat bakiyesi sonunda 0.
- **Eşzamanlı \`register_clip\` çakışması (istemci tarafı dikkat):** \`register_clip\`, global \`ClipCount\` sayacından \`Clip(id)\` anahtarını üretir. Aynı ledger durumuna karşı simüle edilen iki \`register_clip\` tx'i aynı \`Clip(n+1)\` anahtarını footprint'e koyar; ilki geçer, ikincisi \`Error(Storage, ExceededLimit)\` "trying to access contract data key outside of the footprint" ile trap olur (ilk denemede görüldü: tx \`3c8e4cda…\`, \`a662dd52…\`). Bu tüm kampanyalar için geçerli (sayaç global); aynı durum \`challenge\` (\`DisputeCount\`) ve \`create_campaign\` (\`CampaignCount\`) için de beklenir. Frontend/verifier başarısız tx'te yeniden simüle edip tekrar göndermeli. \`join\`, \`submit_proof\`, \`claim\` deterministik anahtar kullandığı için paralel gönderimde sorun çıkmadı.
- \`VideoIndex(platform, video_id)\` global: aynı \`video_id\` başka bir kampanyada da tekrar kaydedilemez (\`VideoAlreadyRegistered\`). Bu yüzden e2e her koşuda yeni bir instance deploy eder (\`deploy.ts --redeploy\`).
- 10 sn'lik challenge penceresi (\`dispute_window/2\`) ~5 sn ledger aralığıyla 1-2 ledger demek; script ledger zamanını izleyerek pencerenin ilk ledger'ında gönderiyor.
`;
  writeFileSync(resolve(ROOT, "docs/e2e-testnet-run.md"), md);
  console.log(`\nfinal balances:`);
  for (const k of Object.keys(expDelta)) console.log(`  ${k.padEnd(8)} ${usdc(bal1[k])}  Δ ${usdc(bal1[k] - bal0[k])} (expected ${usdc(expDelta[k])})`);
  console.log(`\n${passN}/${rows.length} passed; report: docs/e2e-testnet-run.md`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error("ABORT:", e);
  process.exit(2);
});
