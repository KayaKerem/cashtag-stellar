// Deploys a SEPARATE e2e instance of humanity + cliprail (the main deployment in
// scripts/.accounts/deploy.env is never touched) and configures it with the local test attestor.
// Output: scripts/.accounts/e2e.env. Re-run with --redeploy to replace an existing e2e instance.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, E2E_ENV, accounts, identity, invoke, readEnvFile, sv, contractLink, txLink } from "./lib.ts";
import { ATTESTOR_ADDRESS, OWNER, DEMO_PREFIX, DEMO_REQUIRED } from "./proofgen.ts";

const WASM = resolve(ROOT, "contracts/target/wasm32v1-none/release");
const redeploy = process.argv.includes("--redeploy");

function deploy(wasm: string, ctorArgs: string[]): string {
  // no --alias: the CLI aliases `humanity` / `cliprail` belong to the main deployment
  const out = execFileSync(
    "stellar",
    ["contract", "deploy", "--wasm", resolve(WASM, wasm), "--source-account", "admin", "--network", "testnet", "--", ...ctorArgs],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const id = out.trim().split("\n").pop()!.trim();
  if (!/^C[A-Z2-7]{55}$/.test(id)) throw new Error(`unexpected deploy output: ${out}`);
  return id;
}

async function main() {
  const prev = readEnvFile(E2E_ENV);
  if (prev.E2E_CLIPRAIL_ID && !redeploy) {
    console.log(`e2e instance exists (cliprail ${prev.E2E_CLIPRAIL_ID}); use --redeploy for a fresh one`);
    return;
  }
  for (const w of ["humanity.wasm", "cliprail.wasm"]) {
    if (!existsSync(resolve(WASM, w))) throw new Error(`${w} missing: cd contracts && stellar contract build`);
  }
  const admin = identity("admin");
  console.log("deploy humanity (e2e)…");
  const humanity = deploy("humanity.wasm", ["--admin", accounts.ADMIN, "--relayer", accounts.RELAYER]);
  console.log(`  humanity ${humanity}  ${contractLink(humanity)}`);
  console.log("deploy cliprail (e2e)…");
  const cliprail = deploy("cliprail.wasm", ["--admin", accounts.ADMIN, "--humanity", humanity]);
  console.log(`  cliprail ${cliprail}  ${contractLink(cliprail)}`);

  const save = (extra = "") =>
    writeFileSync(
      E2E_ENV,
      [
        `# e2e testnet instance (scripts/e2e/deploy.ts, ${new Date().toISOString()}); separate from deploy.env`,
        `E2E_CLIPRAIL_ID=${cliprail}`,
        `E2E_HUMANITY_ID=${humanity}`,
        `USDC_SAC=${accounts.USDC_SAC}`,
        `E2E_ATTESTOR=${ATTESTOR_ADDRESS}`,
        `E2E_OWNER=${OWNER}`,
        extra,
      ].join("\n") + "\n",
    );
  save();

  const steps: [string, any[]][] = [
    ["set_attestors", [sv.vec([sv.bytes(Buffer.from(ATTESTOR_ADDRESS.slice(2), "hex"))])]],
    ["set_owners", [sv.vec([sv.bytes(Buffer.from(OWNER, "utf8"))])]],
    [
      "set_platform",
      [
        sv.sym("demo"),
        sv.bytes(Buffer.from(DEMO_PREFIX, "utf8")),
        sv.bytes(Buffer.alloc(0)),
        sv.vec(DEMO_REQUIRED.map((r) => sv.bytes(Buffer.from(r, "utf8")))),
      ],
    ],
  ];
  const log: string[] = [];
  for (const [fn, args] of steps) {
    const r = await invoke(cliprail, fn, args, admin);
    if (!r.ok) throw new Error(`${fn} failed: ${r.error}`);
    console.log(`  ${fn} ok ${txLink(r.hash!)}`);
    log.push(`E2E_TX_${fn.toUpperCase()}=${r.hash}`);
  }
  save(log.join("\n"));
  console.log(`saved ${E2E_ENV}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
