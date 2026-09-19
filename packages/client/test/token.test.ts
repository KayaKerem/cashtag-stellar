import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createChainApi } from "../src/chain";
import { toCliprailError, tokenError } from "../src/errors";
import { ensureTokenBalance, type TokenReader } from "../src/token";
import { runWrite, type TxLike } from "../src/tx";

const CLIPRAIL = "CC4SMPQWP56TUVAUAWMK4BLOONQPBLJAWDVNPE6HMZGEMG67WW4XR7T3";
const HUMANITY = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const USER = Keypair.random().publicKey();

/** Host error text as returned by a failed simulation where cliprail → SAC transfer fails. */
const hostError = (failing: string, n: number, data = '"escalating error to panic"') =>
  `HostError: Error(Contract, #${n})\n\nEvent log (newest first):\n` +
  `   0: [Diagnostic Event] contract:${CLIPRAIL}, topics:[error, Error(Contract, #${n})], data:"escalating error to panic"\n` +
  `   1: [Diagnostic Event] contract:${failing}, topics:[error, Error(Contract, #${n})], data:${data}\n` +
  `   2: [Diagnostic Event] contract:${CLIPRAIL}, topics:[fn_call, ${failing}, transfer], data:[${USER}, ${CLIPRAIL}, 100]`;

const ctx = { tokenIds: [USDC], ownIds: [CLIPRAIL, HUMANITY] };

describe("token (SAC) error mapping", () => {
  it("maps SAC #10 / #13 raised by the token to token codes, not cliprail names", () => {
    const bal = toCliprailError(new Error(hostError(USDC, 10, '["balance is not sufficient to spend", 0, 100]')), "cliprail", ctx);
    expect(bal).toMatchObject({ code: "insufficient_balance", source: "token", errorName: null });
    expect(bal.message).toMatch(/USDC bakiyesi yetersiz/);
    const tl = toCliprailError(new Error(hostError(USDC, 13)), "cliprail", ctx);
    expect(tl).toMatchObject({ code: "no_trustline", source: "token" });
    expect(tl.message).toBe("Hesabın USDC trustline'ı yok");
    expect(toCliprailError(hostError(USDC, 9), "cliprail", ctx)).toMatchObject({ code: "token_error", source: "token" });
  });

  it("an unknown (non-own) failing contract counts as the token", () => {
    const other = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
    expect(toCliprailError(hostError(other, 10), "cliprail", ctx)).toMatchObject({ source: "token" });
    expect(toCliprailError(hostError(other, 10), "cliprail", { tokenIds: [USDC] })).toMatchObject({ code: 10, source: "cliprail" });
  });

  it("keeps cliprail codes when cliprail itself failed", () => {
    const text =
      `HostError: Error(Contract, #10)\n\nEvent log (newest first):\n` +
      `   0: [Diagnostic Event] contract:${CLIPRAIL}, topics:[error, Error(Contract, #10)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"`;
    expect(toCliprailError(new Error(text), "cliprail", ctx)).toMatchObject({ code: 10, source: "cliprail", errorName: "VideoAlreadyRegistered" });
    expect(toCliprailError(new Error("HostError: Error(Contract, #13)"), "cliprail", ctx)).toMatchObject({ code: 13, source: "cliprail" });
  });

  it("falls back to SAC diagnostic strings without contract ids", () => {
    expect(tokenError("Error(Contract, #13) trustline entry is missing for account")).toMatchObject({ code: "no_trustline" });
    expect(tokenError("x")).toBeNull();
  });

  it("runWrite surfaces a simulated token failure without signing", async () => {
    const tx: TxLike<unknown> = { result: undefined, simulation: { error: hostError(USDC, 10) }, signAndSend: vi.fn() };
    await expect(runWrite(async () => tx, { delayMs: 0, errorContext: ctx })).rejects.toMatchObject({ code: "insufficient_balance", source: "token" });
    expect(tx.signAndSend).not.toHaveBeenCalled();
  });
});

describe("ensureTokenBalance", () => {
  const reader = (f: () => Promise<bigint>): TokenReader => ({ balance: vi.fn(f) });

  it("passes with enough balance", async () => {
    await expect(ensureTokenBalance(reader(async () => 100n), USDC, USER, 100n)).resolves.toBeUndefined();
  });

  it("insufficient balance → typed error with amounts", async () => {
    await expect(ensureTokenBalance(reader(async () => 25_000_000n), USDC, USER, 100_000_000n)).rejects.toMatchObject({
      code: "insufficient_balance",
      source: "token",
      message: "USDC bakiyesi yetersiz: gereken 10.00, mevcut 2.50",
    });
  });

  it("missing trustline (balance simulation fails with SAC #13) → no_trustline", async () => {
    const r = reader(async () => {
      throw new Error(
        `HostError: Error(Contract, #13)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:${USDC}, topics:[error, Error(Contract, #13)], data:["trustline entry is missing for account", ${USER}]`,
      );
    });
    await expect(ensureTokenBalance(r, USDC, USER, 1n)).rejects.toMatchObject({ code: "no_trustline", message: "Hesabın USDC trustline'ı yok" });
    await expect(ensureTokenBalance(reader(async () => { throw new Error("Error(Contract, #13)"); }), USDC, USER, 1n)).rejects.toMatchObject({ code: "no_trustline" });
  });

  it("inconclusive reads do not block; zero amounts skip the read", async () => {
    await expect(ensureTokenBalance(reader(async () => { throw new Error("fetch failed"); }), USDC, USER, 1n)).resolves.toBeUndefined();
    const r = reader(async () => 0n);
    await ensureTokenBalance(r, USDC, USER, 0n);
    expect(r.balance).not.toHaveBeenCalled();
  });
});

describe("createChainApi preflight", () => {
  const params = {
    budget: 100_000_000n, rate_max_per_1k: 1n, cap_views_clip: 1n, cap_views_human: 1n, min_views: 0n, start: 0n,
    epoch_len: 60n, epochs: 1, proof_window: 60n, dispute_window: 60n, arbiter_window: 60n, claim_grace: 60n,
    holdback_bps: 0, bond: 0n, arbiter: USER, platforms: ["demo" as const], require_humanity: false, title: "t", brief_url: "",
  };
  it("createCampaign fails before building/signing when the brand is short on USDC", async () => {
    const signer = { getAddress: vi.fn(async () => USER), signTransaction: vi.fn() };
    const tokenReader = { balance: vi.fn(async () => 5n) };
    const api = createChainApi({
      rpcUrl: "http://127.0.0.1:1", networkPassphrase: "Test SDF Network ; September 2015", cliprailId: CLIPRAIL,
      humanityId: HUMANITY, verifierUrl: "http://127.0.0.1:1", usdcSac: USDC, signer, tokenReader, retryDelayMs: 0,
    });
    await expect(api.createCampaign(params)).rejects.toMatchObject({ code: "insufficient_balance", source: "token" });
    expect(tokenReader.balance).toHaveBeenCalledWith(USDC, USER);
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });
});
