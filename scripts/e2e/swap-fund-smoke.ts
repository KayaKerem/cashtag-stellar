// Testnet proof of the Soroswap integration: the brand funds a campaign with XLM. The e2e cliprail
// instance swaps XLM → campaign token through the Soroswap router (swap_tokens_for_exact_tokens)
// and escrows exactly `budget`, in one brand-signed tx built by @cliprail/client
// (quoteSwapFunding + createCampaignWithSwap).
//
//   pnpm --filter e2e run swap-fund-smoke                       # Circle testnet USDC, 5 USDC budget
//   USDC_SAC=<our test USDC SAC> pnpm --filter e2e run swap-fund-smoke
//   SWAP_BUDGET=2.5 SWAP_SLIPPAGE_BPS=200 pnpm --filter e2e run swap-fund-smoke
//
// A G-account needs a trustline for the campaign token (the swap output lands on the brand first);
// the script adds it when missing. Secrets come from the stellar CLI keystore and are never printed.
import { Asset, BASE_FEE, Horizon, Operation, TransactionBuilder, scValToNative, type Keypair } from "@stellar/stellar-sdk";
import { createChainApi, type Signer } from "@cliprail/client";
import { CIRCLE_USDC_TESTNET_ASSET, CIRCLE_USDC_TESTNET_SAC, SOROSWAP_TESTNET, XLM_SAC_TESTNET, formatUsdc } from "@cliprail/shared";
import { E2E_ENV, PASSPHRASE, RPC_URL, accounts, contractLink, identity, ledgerNow, readEnvFile, server, txLink, usdcBalance, view, sv } from "./lib.ts";

const e2e = readEnvFile(E2E_ENV);
const CLIPRAIL = e2e.E2E_CLIPRAIL_ID;
const HUMANITY = e2e.E2E_HUMANITY_ID;
const TOKEN = process.env.USDC_SAC || CIRCLE_USDC_TESTNET_SAC;
const TOKEN_ASSET =
  process.env.USDC_ASSET || (TOKEN === CIRCLE_USDC_TESTNET_SAC ? CIRCLE_USDC_TESTNET_ASSET : TOKEN === accounts.USDC_SAC ? accounts.USDC_ASSET : "");
const TOKEN_IN = process.env.SWAP_TOKEN_IN || XLM_SAC_TESTNET;
const BUDGET = BigInt(Math.round(Number(process.env.SWAP_BUDGET ?? "5") * 1e7));
const SLIPPAGE = Number(process.env.SWAP_SLIPPAGE_BPS ?? "100");
const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

function keypairSigner(kp: Keypair): Signer {
  return {
    getAddress: async () => kp.publicKey(),
    async signTransaction(txXdr, o) {
      const tx = TransactionBuilder.fromXDR(txXdr, o.networkPassphrase);
      tx.sign(kp);
      return { signedTxXdr: tx.toXDR() };
    },
  };
}

async function ensureTrustline(kp: Keypair, assetStr: string) {
  const [code, issuer] = assetStr.split(":");
  const horizon = new Horizon.Server(HORIZON);
  const acct = await horizon.loadAccount(kp.publicKey());
  if (acct.balances.some((b: any) => b.asset_code === code && b.asset_issuer === issuer)) return;
  console.log(`  adding trustline ${code}:${issuer.slice(0, 6)}… for the brand`);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(code, issuer) }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const r = await horizon.submitTransaction(tx);
  console.log(`  trustline ok ${txLink(r.hash)}`);
}

async function main() {
  if (!CLIPRAIL || !HUMANITY) throw new Error(`E2E_CLIPRAIL_ID / E2E_HUMANITY_ID missing in ${E2E_ENV}`);
  const router = String(await view(CLIPRAIL, "router", []));
  console.log(`cliprail(e2e) ${CLIPRAIL}\nrouter ${router}${router === SOROSWAP_TESTNET.router ? " (Soroswap testnet)" : ""}`);
  console.log(`campaign token ${TOKEN}\ntoken_in ${TOKEN_IN}${TOKEN_IN === XLM_SAC_TESTNET ? " (native XLM)" : ""}`);

  const brand = identity("brand");
  if (TOKEN_ASSET) await ensureTrustline(brand, TOKEN_ASSET);

  const api = createChainApi({
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    cliprailId: CLIPRAIL,
    humanityId: HUMANITY,
    verifierUrl: "http://127.0.0.1:1/", // not used here
    usdcSac: TOKEN,
    signer: keypairSigner(brand),
    soroswapRouter: router,
  });

  const quote = await api.quoteSwapFunding(BUDGET, TOKEN_IN, TOKEN);
  console.log(
    `quote (router_get_amounts_in): ${formatUsdc(BUDGET)} campaign token ← ${formatUsdc(quote.amountIn)} token_in (max ${formatUsdc(quote.amountInMax)} at ${SLIPPAGE} bps)`,
  );

  const who = brand.publicKey();
  const before = { in: await usdcBalance(TOKEN_IN, who), out: await usdcBalance(TOKEN, who), escrow: await usdcBalance(TOKEN, CLIPRAIL) };

  const now = (await ledgerNow()).time;
  const r = await api.createCampaignWithSwap(
    {
      token: TOKEN,
      budget: BUDGET,
      rate_max_per_1k: 10_000_000n,
      cap_views_clip: 1_000_000_000n,
      cap_views_human: 1_000_000_000n,
      min_views: 1n,
      start: BigInt(now + 120),
      epoch_len: 60n,
      epochs: 2,
      proof_window: 20n,
      dispute_window: 20n,
      arbiter_window: 10n,
      claim_grace: 60n,
      holdback_bps: 2000,
      bond: 10_000_000n,
      arbiter: accounts.ARBITER,
      platforms: ["demo"],
      require_humanity: true,
      title: "Funded with XLM via Soroswap",
      brief_url: "https://e2e.invalid/brief/soroswap",
    },
    { tokenIn: TOKEN_IN, slippageBps: SLIPPAGE },
  );
  console.log(`create_campaign_with_swap ok → campaign #${r.id}\n  ${txLink(r.txHash)}`);

  const after = { in: await usdcBalance(TOKEN_IN, who), out: await usdcBalance(TOKEN, who), escrow: await usdcBalance(TOKEN, CLIPRAIL) };
  const c = await api.getCampaign(r.id);
  const got = await server.getTransaction(r.txHash);
  const rx = (got as any).resultXdr;
  const fc = rx ? (typeof rx.feeCharged === "function" ? rx.feeCharged() : rx.feeCharged) : 0;
  const fee = BigInt(fc?.toString?.() ?? 0);
  const spentIn = before.in - after.in - (TOKEN_IN === XLM_SAC_TESTNET ? fee : 0n);
  console.log(`  token_in spent by the swap: ${formatUsdc(spentIn)}${TOKEN_IN === XLM_SAC_TESTNET ? ` XLM (+ ${formatUsdc(fee)} XLM tx fee)` : ""}; max was ${formatUsdc(r.amountInMax)}`);
  console.log(`  brand campaign-token balance change: ${formatUsdc(after.out - before.out)} (swap output passed straight into escrow)`);
  console.log(`  escrow: +${formatUsdc(after.escrow - before.escrow)}; campaign.balance = ${formatUsdc(c.balance)}; brand = ${c.brand}`);

  // ("swapfund", id) → [token_in, amount_in]
  const ev = await server.getEvents({
    startLedger: got.status === "SUCCESS" ? (got as any).ledger : (await ledgerNow()).seq - 5,
    filters: [{ type: "contract", contractIds: [CLIPRAIL], topics: [[sv.sym("swapfund").toXDR("base64"), "*"]] }],
  });
  const mine = ev.events.find((e) => e.txHash === r.txHash);
  if (mine) {
    const [tin, amt] = scValToNative(mine.value) as [string, bigint];
    console.log(`  event ("swapfund", ${r.id}) → [${tin}, ${formatUsdc(BigInt(amt))}]`);
  }

  const ok = c.balance === BUDGET && after.escrow - before.escrow === BUDGET && after.out === before.out && spentIn > 0n && spentIn <= r.amountInMax;
  console.log(ok ? "OK: campaign funded with XLM through Soroswap" : "MISMATCH (see numbers above)");
  console.log(`contract ${contractLink(CLIPRAIL)}`);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
