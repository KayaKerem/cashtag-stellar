// USDC (SAC) preflight: before a write that moves USDC from the user, read `balance(addr)` so a
// short balance / missing trustline surfaces as a clear error instead of an opaque host error.
import { Account, Address, BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import { SAC_ERROR_CODES, TOKEN_ERROR_MESSAGES, insufficientBalanceMessage, parseContractError } from "@cliprail/shared";
import { CliprailError, tokenError } from "./errors";

export interface TokenReader {
  /** SEP-41 `balance(addr)` via simulation; throws (with the host error text) on a failed simulation. */
  balance(token: string, addr: string): Promise<bigint>;
}

// Simulation source; never signs, need not exist.
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export function rpcTokenReader(o: { rpcUrl: string; networkPassphrase: string; allowHttp?: boolean }): TokenReader {
  const server = new rpc.Server(o.rpcUrl, { allowHttp: o.allowHttp ?? o.rpcUrl.startsWith("http://") });
  return {
    async balance(token, addr) {
      const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: o.networkPassphrase })
        .addOperation(new Contract(token).call("balance", new Address(addr).toScVal()))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      const rv = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
      if (!rv) throw new Error("balance: empty simulation result");
      return BigInt(scValToNative(rv) as bigint | number | string);
    },
  };
}

/**
 * Throws CliprailError(source "token") "no_trustline" / "insufficient_balance" when `addr` cannot
 * pay `needed` of `token`. Inconclusive reads (network, unexpected errors) do not block: the write
 * itself will report whatever goes wrong.
 */
export async function ensureTokenBalance(reader: TokenReader, token: string, addr: string, needed: bigint): Promise<void> {
  if (needed <= 0n) return;
  let have: bigint;
  try {
    have = await reader.balance(token, addr);
  } catch (e) {
    // a missing trustline makes the SAC balance() call itself fail (TrustlineMissingError, #13)
    // (only the token runs here, so a bare contract code is the SAC's)
    const bare = parseContractError(e);
    const code = tokenError(e, { tokenIds: [token] })?.code ?? (bare ? SAC_ERROR_CODES[bare.code] : undefined);
    if (code === "no_trustline") throw new CliprailError("no_trustline", "token", TOKEN_ERROR_MESSAGES.no_trustline, null, e);
    return;
  }
  if (have < needed)
    throw new CliprailError("insufficient_balance", "token", insufficientBalanceMessage(needed, have), null);
}
