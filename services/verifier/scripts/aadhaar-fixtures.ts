// Regenerates fixtures/aadhaar/<name>/{proof_soroban,proof_snarkjs,meta}.json with fresh TEST QR data.
//   AADHAAR_ARTIFACTS_DIR=.data/aadhaar-artifacts pnpm --filter verifier aadhaar:fixtures [outDir]
// Wallets: CLIPPER1 / CLIPPER2 env, else `stellar keys address clipper1|clipper2`.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config, REPO_ROOT } from "../src/config.js";
import {
  AADHAAR_SIGNAL_NAMES,
  AadhaarProver,
  TEST_PUBKEY_HASH,
  buildTestQr,
  loadTestData,
  nullifierSeed,
  signalHash,
  snarkjs,
  walletSignal,
  type SnarkProof,
} from "../src/aadhaar.js";

const fxDir = join(REPO_ROOT, "fixtures/aadhaar");
const outDir = resolve(process.argv[2] ?? fxDir);
const addr = (alias: string) =>
  process.env[alias.toUpperCase()] || execFileSync("stellar", ["keys", "address", alias], { encoding: "utf8" }).trim();

if (!config.aadhaarArtifactsDir) throw new Error("AADHAAR_ARTIFACTS_DIR missing");
let last: { proof: SnarkProof; publicSignals: string[] } | undefined;
const art = config.aadhaarArtifactsDir;
const prover = new AadhaarProver({
  artifactsDir: art,
  testDataDir: fxDir,
  fullProve: async (input) => (last = await snarkjs().groth16.fullProve(input, join(art, "aadhaar-verifier.wasm"), join(art, "circuit_final.zkey"))),
});

const cases = [
  { name: "alice_clipper1_c1", alias: "clipper1", identity: "alice" },
  { name: "bob_clipper2_c1", alias: "clipper2", identity: "bob" },
  { name: "alice_clipper2_c1_sybil", alias: "clipper2", identity: "alice" },
];

for (const c of cases) {
  const wallet = addr(c.alias);
  const t0 = Date.now();
  const r = await prover.prove({ campaignId: 1n, wallet, identity: c.identity });
  const secs = (Date.now() - t0) / 1000;
  const { proof, publicSignals } = last!;
  const signals = Object.fromEntries(AADHAAR_SIGNAL_NAMES.map((n, i) => [n, publicSignals[i]]));
  const id = buildTestQr(loadTestData(fxDir), c.identity).fields;
  const dir = join(outDir, c.name);
  mkdirSync(dir, { recursive: true });
  const w = (f: string, v: unknown) => writeFileSync(join(dir, f), JSON.stringify(v, null, 2) + "\n");
  w("proof_soroban.json", { ...r.proof, public_signals: publicSignals, public_signals_named: signals });
  w("proof_snarkjs.json", { proof, publicSignals });
  w("meta.json", {
    campaign_id: 1,
    wallet,
    wallet_alias: c.alias,
    nullifier: r.nullifier,
    timestamp: r.timestamp,
    timestamp_iso: new Date(Number(r.timestamp) * 1000).toISOString(),
    signals,
    nullifier_seed: nullifierSeed(1n).toString(),
    nullifier_seed_preimage: "cliprail:1",
    signal: walletSignal(wallet),
    signal_hash: signalHash(wallet).toString(),
    test_identity: {
      identity: c.identity,
      name: id.Name,
      dob: id.DOB,
      gender: id.Gender,
      pincode: id.PinCode,
      state: id.State,
      photo: `sha256("cliprail-demo-photo:${c.identity}:<n>") stream`,
    },
    uidai_key: "TEST (anon-aadhaar testPrivateKey.pem / testCertificate.pem)",
    pubkey_hash_matches_test: signals.pubkeyHash === TEST_PUBKEY_HASH,
    revealed: ["ageAbove18"],
    prove_seconds: secs,
    generated_at: new Date().toISOString(),
  });
  console.log(`${c.name}: ${secs}s nullifier=${r.nullifier} ts=${r.timestamp}`);
}
process.exit(0);
