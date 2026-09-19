// Read-only smoke test against the E2E testnet instance: `pnpm --filter @cliprail/client smoke`.
// Signer = Keypair from SMOKE_SECRET (fallback: `stellar keys show brand`). The secret is never printed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, contract } from "@stellar/stellar-sdk";
import { createChainApi } from "../src";

const envFile = fileURLToPath(new URL("../../../scripts/.accounts/e2e.env", import.meta.url));
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const secret = process.env.SMOKE_SECRET || execFileSync("stellar", ["keys", "show", "brand"], { encoding: "utf8" }).trim();
const kp = Keypair.fromSecret(secret);
const passphrase = Networks.TESTNET;
const { signTransaction } = contract.basicNodeSigner(kp, passphrase);

const api = createChainApi({
  rpcUrl: process.env.RPC_URL || "https://soroban-testnet.stellar.org",
  networkPassphrase: passphrase,
  cliprailId: env.E2E_CLIPRAIL_ID ?? env.CLIPRAIL_ID,
  humanityId: env.E2E_HUMANITY_ID ?? env.HUMANITY_ID,
  verifierUrl: "http://localhost:8787",
  usdcSac: env.USDC_SAC,
  signer: { getAddress: async () => kp.publicKey(), signTransaction: (xdr, o) => signTransaction(xdr, o) },
});

const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

console.log(`cliprail ${env.E2E_CLIPRAIL_ID}  signer ${kp.publicKey()}`);
const t = Date.now();
const cs = await api.listCampaigns();
console.log(`campaign_count=${cs.length} (${Date.now() - t} ms)`);
for (const c of cs) {
  console.log(`#${c.id} "${c.params.title}" epochs=${c.params.epochs} budget=${c.params.budget} balance=${c.balance} participants=${c.participants} clips=${c.clips} settled=${c.settled_epochs}`);
}
const last = cs.at(-1);
if (last) {
  const clips = await api.getClips(last.id);
  console.log(`get_clips(${last.id}): ${clips.length}`);
  for (const v of clips.slice(0, 3)) console.log("  ", j({ clip: v.clip, epochs: v.epochs }));
  console.log(`get_epoch(${last.id},0):`, j(await api.getEpoch(last.id, 0)));
  console.log(`list_disputes(${last.id}): ${(await api.listDisputes(last.id)).length}`);
  const owner = clips[0]?.clip.owner ?? kp.publicKey();
  console.log(`get_participant(${last.id}, ${owner.slice(0, 6)}…):`, j(await api.getParticipant(last.id, owner)));
  console.log(`is_human(${last.id}, ${owner.slice(0, 6)}…):`, await api.isHuman(last.id, owner));
}
try {
  await api.getCampaign(9999n);
} catch (e: any) {
  console.log(`get_campaign(9999) → ${e.name} code=${e.code} "${e.message}"`);
}
console.log("smoke ok");
