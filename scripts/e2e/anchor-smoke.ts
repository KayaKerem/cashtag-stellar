// Anchor smoke test (testnet): SEP-1 discovery → SEP-10 auth → trustline → SEP-24 deposit →
// SEP-24 withdraw (+ Stellar payment to the anchor). Anchor-agnostic; the interactive form is
// filled over HTTP only for the SDF test anchor (its reference UI talks to a small business
// server). For any other anchor the popup URL is printed and the script waits for a human.
//
//   pnpm --filter e2e anchor-smoke
//   ANCHOR_HOME_DOMAIN=testanchor.stellar.org ANCHOR_ASSET_CODE=SRT ANCHOR_ACCOUNT=clipper1 \
//   ANCHOR_DEPOSIT_AMOUNT=5 ANCHOR_WITHDRAW_AMOUNT=3 pnpm --filter e2e anchor-smoke
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  DEFAULT_ANCHOR_ASSET_CODE,
  DEFAULT_ANCHOR_HOME_DOMAIN,
  anchorAsset,
  assetBalance,
  completeWithdrawPayment,
  discoverAnchor,
  ensureTrustline,
  sep10Auth,
  startInteractive,
  waitForTransaction,
  type AnchorInfo,
  type AnchorTransaction,
} from "@cliprail/client";
import { identity, txLink } from "./lib";

const HOME = process.env.ANCHOR_HOME_DOMAIN ?? DEFAULT_ANCHOR_HOME_DOMAIN;
const CODE = process.env.ANCHOR_ASSET_CODE ?? DEFAULT_ANCHOR_ASSET_CODE;
const ISSUER = process.env.ANCHOR_ASSET_ISSUER || undefined;
const WHO = process.env.ANCHOR_ACCOUNT ?? "clipper1";
const DEPOSIT_AMOUNT = process.env.ANCHOR_DEPOSIT_AMOUNT ?? "5";
const WITHDRAW_AMOUNT = process.env.ANCHOR_WITHDRAW_AMOUNT ?? "3";
const SKIP = new Set((process.env.ANCHOR_SKIP ?? "").split(",").filter(Boolean)); // "deposit", "withdraw"
const TIMEOUT_MS = Number(process.env.ANCHOR_TIMEOUT_MS ?? 180_000);

/** Business server behind the SEP-24 reference UI (anchor-platform), per home domain. */
const REFERENCE_SERVERS: Record<string, string> = {
  "testanchor.stellar.org": "https://anchor-reference-server-testanchor.stellar.org",
};
const REF_SERVER = process.env.ANCHOR_REF_SERVER ?? REFERENCE_SERVERS[HOME];

const log = (...a: unknown[]) => console.log(...a);
const hashes: { label: string; hash: string }[] = [];
const noteTx = (label: string, hash: string | null | undefined) => {
  if (!hash) return;
  hashes.push({ label, hash });
  log(`  ${label}: ${hash}\n    ${txLink(hash)}`);
};

/** Wallet signer backed by a local keypair (same interface as the web wallet). */
const keypairSigner = (kp: Keypair) => ({
  getAddress: async () => kp.publicKey(),
  signTransaction: async (xdr: string, o: { networkPassphrase: string }) => {
    const tx = TransactionBuilder.fromXDR(xdr, o.networkPassphrase);
    tx.sign(kp);
    return { signedTxXdr: tx.toXDR() };
  },
});

/**
 * Fill the anchor-platform reference UI's KYC form over HTTP (what the popup does on "Submit"):
 * POST /start (interactive JWT from the URL) → session; POST /submit with the form fields.
 */
async function autofillReferenceForm(url: string, kind: "deposit" | "withdraw", amount: string): Promise<boolean> {
  if (!REF_SERVER) return false;
  const token = new URL(url).searchParams.get("token");
  if (!token) return false;
  const start = await fetch(`${REF_SERVER}/start`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const { sessionId } = (await start.json().catch(() => ({}))) as { sessionId?: string };
  if (!start.ok || !sessionId) throw new Error(`reference form /start failed: HTTP ${start.status}`);
  const fields: Record<string, string> = { amount, name: "Test", surname: "Kullanici", email: "test@example.com" };
  if (kind === "withdraw") Object.assign(fields, { bank: "Test Bank", account: "TR000000000000000000000000" });
  const sub = await fetch(`${REF_SERVER}/submit`, {
    method: "POST",
    headers: { authorization: `Bearer ${sessionId}`, "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!sub.ok) throw new Error(`reference form /submit failed: HTTP ${sub.status} ${await sub.text()}`);
  return true;
}

const show = (tx: AnchorTransaction) =>
  log(
    `  [${new Date().toISOString().slice(11, 19)}] ${tx.status} (${tx.statusLabel})` +
      (tx.amountIn ? ` in=${tx.amountIn}` : "") +
      (tx.amountOut ? ` out=${tx.amountOut}` : "") +
      (tx.amountFee ? ` fee=${tx.amountFee}` : "") +
      (tx.message ? ` msg=${tx.message.split("\n")[0].slice(0, 120)}` : ""),
  );

async function interactive(
  anchor: AnchorInfo,
  jwt: string,
  account: string,
  kind: "deposit" | "withdraw",
  amount: string,
): Promise<{ id: string; filled: boolean }> {
  const { id, url } = await startInteractive({ anchor, jwt, kind, assetCode: CODE, assetIssuer: ISSUER, account, amount, lang: "tr" });
  log(`  id: ${id}\n  interactive URL (open in a browser popup):\n    ${url}`);
  const filled = await autofillReferenceForm(url, kind, amount);
  log(filled ? "  form filled over HTTP (reference UI)" : "  >>> HUMAN STEP: open the URL above and complete the anchor form; waiting ...");
  return { id, filled };
}

async function main() {
  const kp = identity(WHO);
  const account = kp.publicKey();
  const signer = keypairSigner(kp);
  log(`account ${WHO}: ${account}`);

  log(`\n[1] SEP-1 discover ${HOME}`);
  const anchor = await discoverAnchor(HOME);
  log(`  WEB_AUTH_ENDPOINT        ${anchor.webAuthEndpoint}`);
  log(`  TRANSFER_SERVER_SEP0024  ${anchor.transferServerSep24}`);
  log(`  SIGNING_KEY              ${anchor.signingKey}`);
  log(`  currencies               ${anchor.currencies.map((c) => c.code).join(", ")}`);
  log(`  sep24 deposit            ${Object.entries(anchor.sep24?.deposit ?? {}).filter(([, v]) => v.enabled).map(([k]) => k).join(", ")}`);
  log(`  sep24 withdraw           ${Object.entries(anchor.sep24?.withdraw ?? {}).filter(([, v]) => v.enabled).map(([k]) => k).join(", ")}`);
  const asset = anchorAsset(anchor, CODE, ISSUER);
  log(`  asset ${asset.getCode()}:${asset.getIssuer?.() ?? ""}  SAC ${asset.contractId(anchor.networkPassphrase)}`);

  log(`\n[2] SEP-10 auth`);
  let jwt = await sep10Auth({ anchor, account, signer });
  log(`  JWT ok (${jwt.length} chars)`);

  log(`\n[3] trustline ${CODE}`);
  const tl = await ensureTrustline(asset, account, signer);
  if (tl.created) noteTx("changeTrust", tl.txHash);
  else log("  already present");
  log(`  balance ${CODE}: ${await assetBalance(asset, account)}`);

  let depositOk = SKIP.has("deposit");
  if (!SKIP.has("deposit")) {
    log(`\n[4] SEP-24 DEPOSIT ${DEPOSIT_AMOUNT} ${CODE}`);
    const { id } = await interactive(anchor, jwt, account, "deposit", DEPOSIT_AMOUNT);
    const tx = await waitForTransaction({ anchor, jwt, id, timeoutMs: TIMEOUT_MS, intervalMs: 4000, onUpdate: show });
    noteTx("anchor deposit payment", tx.stellarTransactionId);
    depositOk = tx.status === "completed";
    log(`  deposit ${tx.status}; balance ${CODE}: ${await assetBalance(asset, account)}`);
  }

  let withdrawOk = SKIP.has("withdraw");
  if (!SKIP.has("withdraw")) {
    log(`\n[5] SEP-24 WITHDRAW ${WITHDRAW_AMOUNT} ${CODE}`);
    jwt = await sep10Auth({ anchor, account, signer }); // fresh token for the second leg
    const { id } = await interactive(anchor, jwt, account, "withdraw", WITHDRAW_AMOUNT);
    let tx = await waitForTransaction({
      anchor,
      jwt,
      id,
      until: ["pending_user_transfer_start"],
      timeoutMs: TIMEOUT_MS,
      intervalMs: 3000,
      onUpdate: show,
    });
    if (tx.needsUserPayment) {
      log(`  paying ${tx.amountIn ?? WITHDRAW_AMOUNT} ${CODE} → ${tx.withdrawAnchorAccount} memo(${tx.withdrawMemoType})=${tx.withdrawMemo}`);
      const hash = await completeWithdrawPayment({ tx, asset, account, signer, amount: tx.amountIn ?? WITHDRAW_AMOUNT });
      noteTx("withdraw payment to anchor", hash);
      try {
        tx = await waitForTransaction({ anchor, jwt, id, timeoutMs: TIMEOUT_MS, intervalMs: 4000, onUpdate: show });
      } catch (e) {
        log(`  still in progress after ${TIMEOUT_MS / 1000}s: ${(e as Error).message}`);
        tx = await waitForTransaction({ anchor, jwt, id, until: [tx.status], timeoutMs: 1, onUpdate: show });
      }
    }
    withdrawOk = tx.status === "completed" || ["pending_anchor", "pending_external", "pending_user_transfer_complete"].includes(tx.status);
    log(`  withdraw ${tx.status}; balance ${CODE}: ${await assetBalance(asset, account)}`);
  }

  log(`\nTransactions:`);
  for (const h of hashes) log(`  ${h.label.padEnd(28)} ${txLink(h.hash)}`);
  log(`\nresult: deposit ${depositOk ? "OK" : "NOT COMPLETED"}, withdraw ${withdrawOk ? "OK" : "NOT COMPLETED"}`);
  if (!depositOk || !withdrawOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error("anchor-smoke failed:", e?.message ?? e);
  process.exit(1);
});
