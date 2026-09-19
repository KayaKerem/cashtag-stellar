// Write smoke test on the E2E testnet instance: `pnpm --filter @cliprail/client smoke:write`.
// brand: createCampaign → read back; clipper1: join → getParticipant → challenge(nonexistent clip) → typed error.
// REFUND=1 waits for refund_at and refunds the brand. Secrets come from `stellar keys show` and are never printed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, contract } from "@stellar/stellar-sdk";
import { refundAt } from "@cliprail/shared";
import { createChainApi, isCliprailError, type Signer } from "../src";

const envFile = fileURLToPath(new URL("../../../scripts/.accounts/e2e.env", import.meta.url));
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const passphrase = Networks.TESTNET;
const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8" }).trim();
const addressOf = (id: string) => execFileSync("stellar", ["keys", "address", id], { encoding: "utf8" }).trim();

function signerFor(id: string): Signer & { address: string } {
  const kp = Keypair.fromSecret(secretOf(id));
  const { signTransaction } = contract.basicNodeSigner(kp, passphrase);
  return { address: kp.publicKey(), getAddress: async () => kp.publicKey(), signTransaction: (xdr, o) => signTransaction(xdr, o) };
}

const apiFor = (signer: Signer) =>
  createChainApi({
    rpcUrl: process.env.RPC_URL || "https://soroban-testnet.stellar.org",
    networkPassphrase: passphrase,
    cliprailId: env.E2E_CLIPRAIL_ID,
    humanityId: env.E2E_HUMANITY_ID,
    verifierUrl: "http://localhost:8787",
    usdcSac: env.USDC_SAC,
    signer,
  });

const link = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const USDC = 10_000_000n;

const brandS = signerFor("brand");
const clipperS = signerFor("clipper1");
const brand = apiFor(brandS);
const clipper = apiFor(clipperS);
console.log(`cliprail ${env.E2E_CLIPRAIL_ID}\nbrand ${brandS.address}\nclipper1 ${clipperS.address}`);

const now = BigInt(Math.floor(Date.now() / 1000));
const created = await brand.createCampaign({
  budget: 1n * USDC,
  rate_max_per_1k: 1n * USDC,
  cap_views_clip: 50_000n,
  cap_views_human: 100_000n,
  min_views: 1n,
  start: now + 120n,
  epoch_len: 120n,
  epochs: 1,
  proof_window: 30n,
  dispute_window: 30n,
  arbiter_window: 20n,
  claim_grace: 120n,
  holdback_bps: 0,
  bond: 1n * USDC,
  arbiter: addressOf("arbiter"),
  platforms: ["demo"],
  require_humanity: false,
  title: "Client write smoke",
  brief_url: "https://example.com/smoke",
});
console.log(`createCampaign → id=${created.id} (${typeof created.id})\n  ${link(created.txHash)}`);

const c = await brand.getCampaign(created.id);
console.log(`getCampaign → brand=${c.brand === brandS.address} title="${c.params.title}" balance=${c.balance} platforms=${c.params.platforms} token=${c.params.token}`);
const ra = refundAt(c.params);
console.log(`refund_at=${ra} (${new Date(Number(ra) * 1000).toISOString()})`);

const j = await clipper.join(created.id);
console.log(`join → code=${j.code} (${typeof j.code})\n  ${link(j.txHash)}`);
const p = await clipper.getParticipant(created.id, clipperS.address);
console.log(`getParticipant → ${JSON.stringify(p, (_k, x) => (typeof x === "bigint" ? x.toString() : x))}`);
if (p?.code !== j.code) throw new Error("participant code mismatch");

try {
  await clipper.challenge(created.id, 999_999n, 0, "smoke");
  throw new Error("challenge unexpectedly succeeded");
} catch (e) {
  if (!isCliprailError(e)) throw e;
  console.log(`challenge(nonexistent clip) → CliprailError code=${e.code} name=${e.errorName} source=${e.source} "${e.message}"`);
}

if (process.env.REFUND === "1") {
  const wait = Number(ra) * 1000 - Date.now() + 10_000;
  console.log(`waiting ${Math.ceil(wait / 1000)} s for refund_at…`);
  await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  const r = await brand.refund(created.id);
  console.log(`refund → amount=${r.amount} (${typeof r.amount})\n  ${link(r.txHash)}`);
}
console.log("write smoke ok");
