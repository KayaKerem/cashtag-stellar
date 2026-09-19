// Points the e2e instance's `demo` platform at a public verifier: url_prefix = <base>/demo/videos/.
// Needed for the web flow with ATTESTOR_MODE=simulated (the verifier's DEMO_PUBLIC_BASE must be the
// same <base>). Only ever touches the e2e instance (e2e.env), never the main deployment.
//
//   pnpm --filter e2e set-demo-host -- https://verifier.example.com [--dry-run]
//
// The new prefix is recorded as E2E_DEMO_PREFIX in e2e.env so proofgen.ts (run.ts, seed --mode local)
// keeps signing matching URLs. Admin secret comes from the stellar CLI keystore and is never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACCOUNTS_DIR, E2E_ENV, ROOT, expectSimError, identity, invoke, readEnvFile, sv, txLink } from "./lib.ts";

const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const base = args.find((a) => !a.startsWith("--"));

function usage(msg: string): never {
  console.error(`${msg}\nusage: pnpm --filter e2e set-demo-host -- <public base URL, e.g. https://verifier.example.com> [--dry-run]`);
  process.exit(2);
}

async function main() {
  if (!base) usage("missing base URL");
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    usage(`invalid URL: ${base}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") usage("base URL must be http(s)");
  if (u.search || u.hash) usage("base URL must not have a query or fragment");
  const prefix = `${base.replace(/\/+$/, "")}/demo/videos/`;

  const e2e = readEnvFile(E2E_ENV);
  const cliprail = e2e.E2E_CLIPRAIL_ID;
  if (!cliprail) throw new Error(`E2E_CLIPRAIL_ID missing in ${E2E_ENV} (run: pnpm --filter e2e deploy)`);
  const mainId = readEnvFile(resolve(ACCOUNTS_DIR, "deploy.env")).CLIPRAIL_ID;
  if (cliprail === mainId) throw new Error("e2e.env points at the main deployment; refusing");

  const REQ = JSON.parse(readFileSync(resolve(ROOT, "fixtures/required-substrings.json"), "utf8"));
  const required: string[] = REQ.demo.required;
  const fnArgs = [
    sv.sym("demo"),
    sv.bytes(Buffer.from(prefix, "utf8")),
    sv.bytes(Buffer.alloc(0)),
    sv.vec(required.map((r) => sv.bytes(Buffer.from(r, "utf8")))),
  ];
  console.log(`e2e cliprail ${cliprail}`);
  console.log(`  demo url_prefix: ${e2e.E2E_DEMO_PREFIX ?? "(deploy default)"} -> ${prefix}`);

  const admin = identity("admin");
  if (dryRun) {
    const r = await expectSimError(cliprail, "set_platform", fnArgs, admin);
    console.log(r.ok ? "  dry run: simulation ok, nothing sent" : `  dry run: simulation failed: ${r.error}`);
    if (!r.ok) process.exit(1);
    return;
  }
  const r = await invoke(cliprail, "set_platform", fnArgs, admin);
  if (!r.ok) throw new Error(`set_platform failed: ${r.error}`);
  console.log(`  set_platform ok ${txLink(r.hash!)}`);

  const lines = readFileSync(E2E_ENV, "utf8").split("\n").filter((l) => l && !/^E2E_(DEMO_PREFIX|TX_SET_DEMO_HOST)=/.test(l));
  lines.push(`E2E_DEMO_PREFIX=${prefix}`, `E2E_TX_SET_DEMO_HOST=${r.hash}`);
  writeFileSync(E2E_ENV, lines.join("\n") + "\n");
  console.log(`  recorded E2E_DEMO_PREFIX in ${E2E_ENV}`);
  console.log(`  verifier: DEMO_PUBLIC_BASE=${base.replace(/\/+$/, "")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
