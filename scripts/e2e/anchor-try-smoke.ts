// TRY anchor smoke test (testnet, SEP-1/10/12/38/6 on the TR mock anchor):
//   brand    : Circle USDC trustline → deposit 5000 TRY → USDC
//   clipper1 : trustline → deposit 500 TRY → withdraw 5 USDC → TRY (simulated bank payout)
//   clipper2, clipper3, arbiter : trustline → deposit 500 TRY (USDC for bonds / claims)
// then prints every identity's Circle USDC balance.
//
//   pnpm --filter e2e anchor-try-smoke
//   ANCHOR_HOME_DOMAIN=tr-mock-anchor.fly.dev ANCHOR_TRY_ONLY=brand,clipper1 pnpm --filter e2e anchor-try-smoke
import { TransactionBuilder, type Keypair } from "@stellar/stellar-sdk";
import {
  anchorAsset,
  anchorDepositTRY,
  anchorWithdrawToTRY,
  assetBalance,
  discoverAnchor,
  ensureTrustline,
  type AnchorTransaction,
} from "@cliprail/client";
import { ANCHOR_RAMP_STEP_LABELS, TR_ANCHOR_HOME_DOMAIN, formatTry, formatTryRate } from "@cliprail/shared";
import { identity, txLink } from "./lib";

const HOME = process.env.ANCHOR_HOME_DOMAIN ?? TR_ANCHOR_HOME_DOMAIN;
const ONLY = new Set((process.env.ANCHOR_TRY_ONLY ?? "").split(",").filter(Boolean));
const IDS = ["brand", "clipper1", "clipper2", "clipper3", "arbiter"] as const;

const PLAN: Record<(typeof IDS)[number], { depositTRY: string; withdrawUSDC?: string }> = {
  brand: { depositTRY: process.env.BRAND_DEPOSIT_TRY ?? "5000" },
  clipper1: { depositTRY: "500", withdrawUSDC: process.env.CLIPPER1_WITHDRAW_USDC ?? "5" },
  clipper2: { depositTRY: "500" },
  clipper3: { depositTRY: "500" },
  arbiter: { depositTRY: "500" },
};

const log = (...a: unknown[]) => console.log(...a);
const summary: string[] = [];

const keypairSigner = (kp: Keypair) => ({
  getAddress: async () => kp.publicKey(),
  signTransaction: async (xdr: string, o: { networkPassphrase: string }) => {
    const tx = TransactionBuilder.fromXDR(xdr, o.networkPassphrase);
    tx.sign(kp);
    return { signedTxXdr: tx.toXDR() };
  },
});

const show = (tx: AnchorTransaction) => log(`    [${new Date().toISOString().slice(11, 19)}] ${tx.status} (${tx.statusLabel})`);

async function main() {
  log(`anchor: ${HOME}`);
  const anchor = await discoverAnchor(HOME);
  log(`  TRANSFER_SERVER ${anchor.transferServer}\n  KYC_SERVER ${anchor.kycServer}\n  ANCHOR_QUOTE_SERVER ${anchor.quoteServer}`);
  const asset = anchorAsset(anchor, "USDC");
  log(`  asset USDC:${asset.getIssuer()}  SAC ${asset.contractId(anchor.networkPassphrase)}`);

  let failed = false;
  for (const who of IDS) {
    if (ONLY.size && !ONLY.has(who)) continue;
    const kp = identity(who);
    const account = kp.publicKey();
    const signer = keypairSigner(kp);
    const plan = PLAN[who];
    log(`\n== ${who} ${account}`);
    try {
      const tl = await ensureTrustline(asset, account, signer);
      log(tl.created ? `  trustline added: ${txLink(tl.txHash!)}` : "  trustline present");

      log(`  deposit ${formatTry(plan.depositTRY)} →`);
      const d = await anchorDepositTRY({
        signer,
        account,
        amountTRY: plan.depositTRY,
        anchor,
        onStep: (s) => log(`    · ${ANCHOR_RAMP_STEP_LABELS[s]}`),
        onUpdate: show,
      });
      log(`  deposit ${d.id} ${d.status}: ${d.amountTRY} TRY → ${d.usdcReceived} USDC (${d.tryPerUsdc ? formatTryRate(d.tryPerUsdc) : "?"}; fee ${d.feeTRY} TRY)`);
      log(`    bank ${d.bankName} IBAN ${d.iban} ref ${d.reference}`);
      log(`    USDC payment: ${d.txLink}`);
      summary.push(`${who.padEnd(9)} deposit  ${d.amountTRY} TRY → ${d.usdcReceived} USDC  ${d.txLink}`);

      if (plan.withdrawUSDC) {
        log(`  withdraw ${plan.withdrawUSDC} USDC →`);
        const w = await anchorWithdrawToTRY({
          signer,
          account,
          amountUSDC: plan.withdrawUSDC,
          anchor,
          onStep: (s) => log(`    · ${ANCHOR_RAMP_STEP_LABELS[s]}`),
          onUpdate: show,
        });
        log(`  withdraw ${w.id} ${w.status}: ${w.amountUSDC} USDC → ${formatTry(w.tryPaidOut)} (${w.tryPerUsdc ? formatTryRate(w.tryPerUsdc) : "?"})`);
        log(`    TRY paid to ${w.iban} ref ${w.payoutReference}`);
        log(`    USDC payment to anchor: ${w.txLink}`);
        summary.push(`${who.padEnd(9)} withdraw ${w.amountUSDC} USDC → ${w.tryPaidOut} TRY (IBAN ${w.iban})  ${w.txLink}`);
      }
    } catch (e) {
      failed = true;
      log(`  FAILED: ${(e as Error)?.message ?? e}`);
      summary.push(`${who.padEnd(9)} FAILED ${(e as Error)?.message ?? e}`);
    }
  }

  log(`\nSummary:`);
  for (const s of summary) log(`  ${s}`);
  log(`\nCircle USDC balances:`);
  for (const who of IDS) {
    const account = identity(who).publicKey();
    const bal = await assetBalance(asset, account).catch((e) => `error: ${(e as Error).message}`);
    log(`  ${who.padEnd(9)} ${account}  ${bal ?? "no trustline"}`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error("anchor-try-smoke failed:", e?.message ?? e);
  process.exit(1);
});
