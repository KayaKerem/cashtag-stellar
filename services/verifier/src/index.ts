import { serve } from "@hono/node-server";
import { join } from "node:path";
import { attestorAddress, config, hasReclaim, isSimulated, SERVICE_DIR } from "./config.js";
import { createApp } from "./app.js";
import { Chain } from "./chain.js";
import { DemoStore } from "./demo.js";
import { Keeper } from "./keeper.js";
import { Ops } from "./ops.js";
import { ProofService } from "./zkfetch.js";

const demo = new DemoStore(join(config.dataDir, "demo-state.json"), join(SERVICE_DIR, "fixtures/demo-state.json"));
const proofs = new ProofService(config, undefined, demo);
const chain = new Chain(config);
const ops = new Ops(config, proofs, chain);
const app = createApp({ cfg: config, demo, proofs, ops });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`verifier listening on :${info.port}`);
  console.log(
    `  cliprail=${config.cliprailId || "-"} humanity=${config.humanityId || "-"} relayer=${chain.relayer ?? "-"}` +
      ` reclaim=${hasReclaim(config) ? "yes" : "no"} fixtures=${config.proofFixtureDir || "-"}` +
      ` demoBase=${config.demoPublicBase || "-"} demoMode=${config.demoMode}`,
  );
  console.log(`  attestor=${config.attestorMode} ${attestorAddress(config) ?? "-"}`);
  if (isSimulated(config)) console.warn("  SIMULATED ATTESTOR: proofs are signed by a local test key (testnet demo only)");
});

if (config.keeper) {
  if (!config.cliprailId || !chain.relayer) console.warn("[keeper] disabled: CLIPRAIL_ID / RELAYER_SECRET missing");
  else new Keeper(ops, config.keeperIntervalMs).start();
}
