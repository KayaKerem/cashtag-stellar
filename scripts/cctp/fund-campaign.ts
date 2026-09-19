// End of the cross-chain path: the USDC that was just bridged in funds a real ClipRail campaign.
// The escrow is the ordinary create_campaign flow — the contract holds any SAC token, so bridged
// Circle USDC needs no contract change at all.
//
//   pnpm --filter cctp fund-campaign                     # budget from the last bridge run
//   pnpm --filter cctp fund-campaign -- --budget 5
//   pnpm --filter cctp fund-campaign -- --budget 5 --title "Arc → Stellar demo"
//   pnpm --filter cctp fund-campaign -- --cliprail C… --humanity C…   # another instance
//
// The target is the canonical demo instance from scripts/.accounts/e2e.env (E2E_CLIPRAIL_ID), NOT
// the older deployment recorded in deploy.env — that one predates the ZK and Soroswap work. Pass
// --cliprail / --humanity (or CLIPRAIL_ID / HUMANITY_ID in the environment) to target another one.
//
// The brand signs with the `brand` stellar CLI identity (override with --brand <identity>).
import { existsSync, readFileSync } from "node:fs";
import { TransactionBuilder, type Keypair } from "@stellar/stellar-sdk";
import { createChainApi, type Signer } from "@cliprail/client";
import { ACCOUNTS_DIR, BRIDGE_STATE, STELLAR, readEnvFile, stellarContractLink, stellarTxLink } from "./config.ts";
import { fmt6, fmt7, parseUsdc6, units6to7 } from "./cctp.ts";
import { PASSPHRASE, identity, usdcBalance } from "./stellar.ts";
import { resolve } from "node:path";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}

const accounts = readEnvFile(resolve(ACCOUNTS_DIR, "accounts.env"));
const e2e = readEnvFile(resolve(ACCOUNTS_DIR, "e2e.env"));
const deploy = readEnvFile(resolve(ACCOUNTS_DIR, "deploy.env"));

// e2e.env first on purpose: it holds the canonical demo instance. deploy.env is only a last resort
// for a checkout that has never run scripts/e2e/deploy.ts.
const CLIPRAIL = arg("cliprail") ?? process.env.CLIPRAIL_ID ?? e2e.E2E_CLIPRAIL_ID ?? deploy.CLIPRAIL_ID;
const HUMANITY = arg("humanity") ?? process.env.HUMANITY_ID ?? e2e.E2E_HUMANITY_ID ?? deploy.HUMANITY_ID;
const IS_DEMO_INSTANCE = CLIPRAIL === e2e.E2E_CLIPRAIL_ID;
const ARBITER = process.env.ARBITER ?? accounts.ARBITER;

/** The budget defaults to whatever the last bridge run moved. */
function lastBridged(): { amount6: bigint; chain: string; recipient: string } | undefined {
  if (!existsSync(BRIDGE_STATE)) return undefined;
  try {
    const s = JSON.parse(readFileSync(BRIDGE_STATE, "utf8")) as { amountUsdc6: string; chain: string; recipient: string };
    return { amount6: BigInt(s.amountUsdc6), chain: s.chain, recipient: s.recipient };
  } catch {
    return undefined;
  }
}

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

async function main() {
  if (!CLIPRAIL || !HUMANITY) {
    throw new Error(`no cliprail instance found: E2E_CLIPRAIL_ID missing from ${ACCOUNTS_DIR}/e2e.env — run pnpm --filter e2e deploy, or pass --cliprail C… --humanity C…`);
  }
  if (!ARBITER) throw new Error(`ARBITER not found in ${ACCOUNTS_DIR}/accounts.env — run pnpm accounts:setup first`);

  const prev = lastBridged();
  const budget6 = parseUsdc6(arg("budget") ?? (prev ? fmt6(prev.amount6) : "1"));
  const budget = units6to7(budget6); // the contract counts in 7-decimal Stellar subunits
  const brand = identity(arg("brand", "brand")!);
  const title = arg("title") ?? `Funded with USDC bridged from ${prev?.chain === "base" ? "Base Sepolia" : "Arc Testnet"} (CCTP V2)`;

  console.log("ClipRail campaign funded by cross-chain USDC");
  console.log(`  cliprail   ${CLIPRAIL}  ${IS_DEMO_INSTANCE ? "(demo instance, e2e.env)" : "(OVERRIDE — not the e2e demo instance)"}`);
  console.log(`             ${stellarContractLink(CLIPRAIL)}`);
  console.log(`  token      ${STELLAR.usdcSac} (Circle testnet USDC SAC)`);
  console.log(`  brand      ${brand.publicKey()}`);
  if (prev) {
    console.log(`  last bridge: ${fmt6(prev.amount6)} USDC from ${prev.chain} → ${prev.recipient}`);
    if (prev.recipient !== brand.publicKey()) console.log(`  note: the bridge paid ${prev.recipient}, which is not this brand account`);
  }

  const before = await usdcBalance(brand.publicKey());
  if (before === null) throw new Error(`brand ${brand.publicKey()} has no USDC trustline — bridge first (pnpm --filter cctp bridge)`);
  console.log(`  brand USDC before: ${fmt7(before)}`);
  if (before < budget) {
    throw new Error(`brand holds ${fmt7(before)} USDC but the budget is ${fmt7(budget)} — bridge more: pnpm --filter cctp bridge -- --amount ${fmt6(budget6)}`);
  }
  const escrowBefore = (await usdcBalance(CLIPRAIL, brand.publicKey())) ?? 0n;

  const api = createChainApi({
    rpcUrl: STELLAR.rpcUrl,
    networkPassphrase: PASSPHRASE,
    cliprailId: CLIPRAIL,
    humanityId: HUMANITY,
    verifierUrl: "http://127.0.0.1:1/", // create_campaign never calls the verifier
    usdcSac: STELLAR.usdcSac,
    signer: keypairSigner(brand),
  });

  const now = Math.floor(Date.now() / 1000);
  const r = await api.createCampaign({
    token: STELLAR.usdcSac,
    budget,
    rate_max_per_1k: 10_000_000n,
    cap_views_clip: 1_000_000_000n,
    cap_views_human: 1_000_000_000n,
    min_views: 1n,
    start: BigInt(now + 120),
    epoch_len: 600n,
    epochs: 2,
    proof_window: 180n,
    dispute_window: 60n,
    arbiter_window: 60n,
    claim_grace: 600n,
    holdback_bps: 2000,
    bond: 10_000_000n,
    arbiter: ARBITER,
    platforms: ["demo"],
    require_humanity: false,
    title,
    brief_url: "https://cliprail.invalid/brief/cctp",
  });

  console.log(`\ncreate_campaign ok → campaign #${r.id}`);
  console.log(`  ${stellarTxLink(r.txHash)}`);

  const c = await api.getCampaign(r.id);
  const after = (await usdcBalance(brand.publicKey())) ?? 0n;
  const escrowAfter = (await usdcBalance(CLIPRAIL, brand.publicKey())) ?? 0n;
  console.log(`  campaign.balance ${fmt7(c.balance)} USDC, brand ${c.brand}, title "${c.params.title}"`);
  console.log(`  brand USDC ${fmt7(before)} → ${fmt7(after)} (-${fmt7(before - after)}); escrow +${fmt7(escrowAfter - escrowBefore)}`);

  const ok = c.balance === budget && escrowAfter - escrowBefore === budget;
  console.log(ok ? `\nOK — USDC bridged from another chain is now escrowed in campaign #${r.id}` : "\nMISMATCH (see the numbers above)");
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
