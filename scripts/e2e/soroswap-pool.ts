// Seeds a Soroswap (testnet) XLM ↔ test-USDC pool from the `brand` identity via router.add_liquidity,
// so campaigns can be funded with XLM (cliprail.create_campaign_with_swap). Creates the pair if missing.
//
//   pnpm --filter e2e run soroswap-pool                    # 2000 XLM + 400 USDC (skips if the pool has liquidity)
//   POOL_XLM=500 POOL_USDC=100 pnpm --filter e2e run soroswap-pool -- --add   # add more
//
// Secret keys come from the stellar CLI keystore and are never printed.
import { SOROSWAP_TESTNET, XLM_SAC_TESTNET, formatUsdc } from "@cliprail/shared";
import { accounts, contractLink, identity, invoke, ledgerNow, sv, txLink, usdcBalance, view } from "./lib.ts";

const ROUTER = process.env.SOROSWAP_ROUTER ?? SOROSWAP_TESTNET.router;
const FACTORY = process.env.SOROSWAP_FACTORY ?? SOROSWAP_TESTNET.factory;
const XLM = XLM_SAC_TESTNET;
const USDC = accounts.USDC_SAC;
const UNIT = 10_000_000n; // both XLM and USDC SACs use 7 decimals
const addMore = process.argv.includes("--add");

const amt = (s: string | undefined, d: string) => BigInt(Math.round(Number(s ?? d) * 1e7));

async function reserves(pair: string): Promise<[bigint, bigint, string, string]> {
  const [r0, r1] = (await view(pair, "get_reserves", [])) as [bigint, bigint];
  const t0 = String(await view(pair, "token_0", []));
  const t1 = String(await view(pair, "token_1", []));
  return [BigInt(r0), BigInt(r1), t0, t1];
}

async function main() {
  if (!USDC) throw new Error("USDC_SAC missing in scripts/.accounts/accounts.env");
  const brand = identity("brand");
  console.log(`router  ${ROUTER}  ${contractLink(ROUTER)}`);
  console.log(`factory ${FACTORY}`);
  console.log(`XLM SAC ${XLM}\nUSDC    ${USDC}`);
  console.log(`router.get_factory = ${await view(ROUTER, "get_factory", [])}`);

  const exists = Boolean(await view(FACTORY, "pair_exists", [sv.addr(XLM), sv.addr(USDC)]));
  if (exists) {
    const pair = String(await view(FACTORY, "get_pair", [sv.addr(XLM), sv.addr(USDC)]));
    const [r0, r1, t0] = await reserves(pair);
    console.log(`pair ${pair}  ${contractLink(pair)}  reserves ${t0 === XLM ? "XLM" : "USDC"}=${r0} / ${r1}`);
    if (r0 > 0n && r1 > 0n && !addMore) {
      console.log("pool already has liquidity; pass --add to add more");
      return;
    }
  }

  const xlmIn = amt(process.env.POOL_XLM, "2000");
  const usdcIn = amt(process.env.POOL_USDC, "400");
  const [xlmBal, usdcBal] = [await usdcBalance(XLM, brand.publicKey()), await usdcBalance(USDC, brand.publicKey())];
  console.log(`brand ${brand.publicKey()}: ${formatUsdc(xlmBal)} XLM, ${formatUsdc(usdcBal)} USDC`);
  if (xlmBal < xlmIn + 10n * UNIT || usdcBal < usdcIn) throw new Error("brand balance too low for the requested liquidity");

  const deadline = (await ledgerNow()).time + 600;
  console.log(`add_liquidity ${formatUsdc(xlmIn)} XLM + ${formatUsdc(usdcIn)} USDC …`);
  const r = await invoke(
    ROUTER,
    "add_liquidity",
    [
      sv.addr(XLM),
      sv.addr(USDC),
      sv.i128(xlmIn),
      sv.i128(usdcIn),
      sv.i128(0n), // first deposit sets the price; with an existing pool the router picks the optimal ratio
      sv.i128(0n),
      sv.addr(brand.publicKey()),
      sv.u64(deadline),
    ],
    brand,
  );
  if (!r.ok) throw new Error(`add_liquidity failed: ${r.error}`);
  const [a, b, lp] = r.value as [bigint, bigint, bigint];
  console.log(`  ok ${txLink(r.hash!)}`);
  console.log(`  deposited XLM=${formatUsdc(BigInt(a))} USDC=${formatUsdc(BigInt(b))} LP=${lp}`);

  const pair = String(await view(FACTORY, "get_pair", [sv.addr(XLM), sv.addr(USDC)]));
  const [r0, r1, t0] = await reserves(pair);
  const [rx, ru] = t0 === XLM ? [r0, r1] : [r1, r0];
  console.log(`pair ${pair}  ${contractLink(pair)}`);
  console.log(`  reserves: ${formatUsdc(rx)} XLM / ${formatUsdc(ru)} USDC (1 USDC ≈ ${(Number(rx) / Number(ru)).toFixed(3)} XLM)`);
  const quote = (await view(ROUTER, "router_get_amounts_in", [sv.i128(5n * UNIT), sv.vec([sv.addr(XLM), sv.addr(USDC)])])) as bigint[];
  console.log(`  quote: 5 USDC costs ${formatUsdc(BigInt(quote[0]))} XLM`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
