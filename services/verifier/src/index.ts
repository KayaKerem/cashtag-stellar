import { serve } from "@hono/node-server";
import { join } from "node:path";
import { attestorAddress, config, hasReclaim, isSimulated, SERVICE_DIR, unsafeConfig } from "./config.js";
import { createApp } from "./app.js";
import { Chain } from "./chain.js";
import { DemoStore } from "./demo.js";
import { IgStore } from "./instagram.js";
import { Keeper } from "./keeper.js";
import { Ops } from "./ops.js";
import { ProofService } from "./zkfetch.js";
import { AadhaarProver } from "./aadhaar.js";
import { Health } from "./health.js";

const unsafe = unsafeConfig(config);
for (const u of unsafe) console.warn(`[config] UNSAFE: ${u}`);
if (config.production && unsafe.length) {
  console.error("[config] refusing to start in production with unsafe settings");
  process.exit(1);
}

const demo = new DemoStore(join(config.dataDir, "demo-state.json"), join(SERVICE_DIR, "fixtures/demo-state.json"));
const ig = new IgStore(join(config.dataDir, "instagram-state.json"));
const proofs = new ProofService(config, undefined, demo, undefined, ig);
const chain = new Chain(config);
const ops = new Ops(config, proofs, chain);
const aadhaar = new AadhaarProver({
  artifactsDir: config.aadhaarArtifactsDir,
  testDataDir: config.aadhaarTestDataDir,
  maxQueue: config.aadhaarMaxQueue,
});
const keeper =
  config.keeper && config.cliprailId && chain.keeper ? new Keeper(ops, config.keeperIntervalMs, undefined, (code) => ig.isApproved(code)) : null;
const health = new Health({
  version: process.env.GIT_SHA || "dev",
  latestLedger: async () => (await chain.server.getLatestLedger()).sequence,
  keeper: keeper ? () => keeper.status() : undefined,
  aadhaarAvailable: () => aadhaar.available,
});
const app = createApp({ cfg: config, demo, proofs, ops, aadhaar, health, ig });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`verifier listening on :${info.port}`);
  console.log(
    `  cliprail=${config.cliprailId || "-"} humanity=${config.humanityId || "-"} relayer=${chain.relayer ?? "-"} keeper=${chain.keeper ?? "-"}` +
      ` reclaim=${hasReclaim(config) ? "yes" : "no"} fixtures=${config.proofFixtureDir || "-"}` +
      ` demoBase=${config.demoPublicBase || "-"} demoMode=${config.demoMode}`,
  );
  console.log(`  attestor=${config.attestorMode} ${attestorAddress(config) ?? "-"}`);
  console.log(`  aadhaar=${aadhaar.available ? `TEST mode (${config.aadhaarArtifactsDir})` : "disabled (AADHAAR_ARTIFACTS_DIR missing)"}`);
  if (isSimulated(config)) console.warn("  SIMULATED ATTESTOR: proofs are signed by a local test key (testnet demo only)");
});

if (config.keeper) {
  if (!config.cliprailId || !chain.keeper) console.warn("[keeper] disabled: CLIPRAIL_ID / KEEPER_SECRET (or RELAYER_SECRET) missing");
  else keeper!.start();
}
