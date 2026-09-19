// Soroswap swap funding: quote via router.router_get_amounts_in (simulation only) and the raw
// cliprail.create_campaign_with_swap call (not in the generated bindings; built like register_zk).
//
// create_campaign_with_swap(brand: Address, params: CampaignParams, token_in: Address,
//                           amount_in_max: i128, path: Vec<Address>, deadline: u64) -> Result<u64, Error>
import { Account, Address, BASE_FEE, Contract, TransactionBuilder, contract, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { CLIPRAIL_ERRORS, SOROSWAP_ERRORS, withSlippage, DEFAULT_SWAP_SLIPPAGE_BPS, type SwapQuote } from "@cliprail/shared";
import { CliprailError } from "./errors";

export interface SwapQuoter {
  /** router.router_get_amounts_in(amount_out, path) → input amount per hop (index 0 = what the payer spends). */
  amountsIn(router: string, amountOut: bigint, path: string[]): Promise<bigint[]>;
}

// Simulation source; never signs, need not exist.
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const CONTRACT_CODE_RE = /Error\(Contract, #(\d+)\)/;

/** Soroswap router failure (quote or swap) → CliprailError (source "swap"). */
export function soroswapError(err: unknown): CliprailError {
  const text = err instanceof Error ? err.message : String(err);
  const m = CONTRACT_CODE_RE.exec(text);
  const code = m ? Number(m[1]) : undefined;
  const known = code !== undefined ? SOROSWAP_ERRORS[code] : undefined;
  if (known) return new CliprailError(code!, "swap", known.message, known.name, err);
  return new CliprailError("swap_quote_failed", "swap", "Could not get a Soroswap quote (the pool or liquidity may be missing).", null, err);
}

export function rpcSwapQuoter(o: { rpcUrl: string; networkPassphrase: string; allowHttp?: boolean }): SwapQuoter {
  const server = new rpc.Server(o.rpcUrl, { allowHttp: o.allowHttp ?? o.rpcUrl.startsWith("http://") });
  return {
    async amountsIn(router, amountOut, path) {
      const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: o.networkPassphrase })
        .addOperation(
          new Contract(router).call(
            "router_get_amounts_in",
            nativeToScVal(amountOut, { type: "i128" }),
            xdr.ScVal.scvVec(path.map((a) => new Address(a).toScVal())),
          ),
        )
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      const rv = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
      if (!rv) throw new Error("router_get_amounts_in: empty simulation result");
      return (scValToNative(rv) as (bigint | number | string)[]).map((x) => BigInt(x));
    },
  };
}

/** Quote funding `amountOut` of `tokenOut` with `tokenIn` over the direct pair. */
export async function quoteSwap(
  quoter: SwapQuoter,
  router: string,
  amountOut: bigint,
  tokenIn: string,
  tokenOut: string,
  slippageBps: number = DEFAULT_SWAP_SLIPPAGE_BPS,
): Promise<SwapQuote> {
  if (amountOut <= 0n) throw new CliprailError(3, "cliprail", CLIPRAIL_ERRORS[3].message, CLIPRAIL_ERRORS[3].name);
  if (tokenIn === tokenOut) throw new CliprailError(37, "cliprail", CLIPRAIL_ERRORS[37].message, CLIPRAIL_ERRORS[37].name);
  const path = [tokenIn, tokenOut];
  let amounts: bigint[];
  try {
    amounts = await quoter.amountsIn(router, amountOut, path);
  } catch (e) {
    throw soroswapError(e);
  }
  const amountIn = amounts[0];
  if (amounts.length !== path.length || !(amountIn > 0n)) throw soroswapError(new Error(`unexpected quote ${amounts.join(",")}`));
  return { tokenIn, tokenOut, path, amountOut, amountIn, amountInMax: withSlippage(amountIn, slippageBps), router };
}

/** CLIPRAIL_ERRORS in the shape AssembledTransaction's `errorTypes` expects. */
export const cliprailErrorTypes = Object.fromEntries(Object.entries(CLIPRAIL_ERRORS).map(([k, v]) => [Number(k), { message: v.name }]));

/** Raw CampaignParams (bindings shape: bigint amounts/times, Symbol-string platforms). */
export interface RawCampaignParams {
  token: string;
  budget: bigint;
  rate_max_per_1k: bigint;
  cap_views_clip: bigint;
  cap_views_human: bigint;
  min_views: bigint;
  start: bigint;
  epoch_len: bigint;
  epochs: number;
  proof_window: bigint;
  dispute_window: bigint;
  arbiter_window: bigint;
  claim_grace: bigint;
  holdback_bps: number;
  bond: bigint;
  arbiter: string;
  platforms: string[];
  require_humanity: boolean;
  title: string;
  brief_url: string;
}

/** CampaignParams struct → ScMap (symbol keys sorted, contract field types). */
export function campaignParamsScVal(p: RawCampaignParams): xdr.ScVal {
  const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
  const u64 = (v: bigint) => nativeToScVal(v, { type: "u64" });
  const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
  const fields: Record<string, xdr.ScVal> = {
    token: new Address(p.token).toScVal(),
    budget: i128(p.budget),
    rate_max_per_1k: i128(p.rate_max_per_1k),
    cap_views_clip: u64(p.cap_views_clip),
    cap_views_human: u64(p.cap_views_human),
    min_views: u64(p.min_views),
    start: u64(p.start),
    epoch_len: u64(p.epoch_len),
    epochs: u32(p.epochs),
    proof_window: u64(p.proof_window),
    dispute_window: u64(p.dispute_window),
    arbiter_window: u64(p.arbiter_window),
    claim_grace: u64(p.claim_grace),
    holdback_bps: u32(p.holdback_bps),
    bond: i128(p.bond),
    arbiter: new Address(p.arbiter).toScVal(),
    platforms: xdr.ScVal.scvVec(p.platforms.map((x) => xdr.ScVal.scvSymbol(x))),
    require_humanity: xdr.ScVal.scvBool(p.require_humanity),
    title: xdr.ScVal.scvString(p.title),
    brief_url: xdr.ScVal.scvString(p.brief_url),
  };
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: fields[k] })),
  );
}

/** Arguments of create_campaign_with_swap, in contract order. */
export function swapFundArgs(
  brand: string,
  params: RawCampaignParams,
  tokenIn: string,
  amountInMax: bigint,
  path: string[],
  deadline: bigint,
): xdr.ScVal[] {
  if (amountInMax <= 0n) throw new Error("amountInMax must be > 0");
  return [
    new Address(brand).toScVal(),
    campaignParamsScVal(params),
    new Address(tokenIn).toScVal(),
    nativeToScVal(amountInMax, { type: "i128" }),
    xdr.ScVal.scvVec(path.map((a) => new Address(a).toScVal())),
    nativeToScVal(deadline, { type: "u64" }),
  ];
}

export function swapFundTxOptions(
  base: { rpcUrl: string; networkPassphrase: string; allowHttp?: boolean; contractId: string; publicKey: string; signTransaction: contract.ClientOptions["signTransaction"] },
  args: xdr.ScVal[],
): contract.AssembledTransactionOptions<unknown> {
  return {
    ...base,
    method: "create_campaign_with_swap",
    args,
    parseResultXdr: (v: xdr.ScVal) => scValToNative(v),
    errorTypes: cliprailErrorTypes,
  };
}
