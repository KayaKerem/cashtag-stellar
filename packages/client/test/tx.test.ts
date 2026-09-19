import { describe, expect, it, vi } from "vitest";
import { CliprailError, errorFromName, toCliprailError } from "../src/errors";
import { postJson } from "../src/http";
import { isRetryable, mapLimit, runWrite, type TxLike } from "../src/tx";

const ok = <T>(v: T) => ({ isOk: () => true, isErr: () => false, unwrap: () => v, unwrapErr: () => undefined });
const bad = (name: string) => ({ isOk: () => false, isErr: () => true, unwrap: () => { throw new Error(name); }, unwrapErr: () => ({ message: name }) });

/** Fake AssembledTransaction: `sim` = simulated result (or throw), `send` = what signAndSend does. */
function fakeTx(sim: unknown, send: () => Promise<unknown> | unknown, hash = "h".repeat(64)): TxLike<unknown> {
  return {
    get result() {
      if (sim instanceof Error) throw sim;
      return sim;
    },
    signAndSend: vi.fn(async () => ({ result: await send(), sendTransactionResponse: { hash } })),
  };
}

describe("error mapping", () => {
  it("parses host errors, bindings Err names and verifier codes", () => {
    const a = toCliprailError(new Error("HostError: Error(Contract, #19)\n..."));
    expect(a).toMatchObject({ code: 19, source: "cliprail", errorName: "ProofReused" });
    expect(a.message).toMatch(/daha önce kullanılmış/);
    expect(errorFromName("WrongPhase")).toMatchObject({ code: 8 });
    expect(errorFromName("NullifierUsed", "humanity")).toMatchObject({ code: 2, source: "humanity" });
    expect(toCliprailError(new Error("User declined access"))).toMatchObject({ code: "wallet_rejected", source: "wallet" });
    expect(toCliprailError("weird")).toMatchObject({ code: "unknown" });
  });

  it("maps verifier HTTP errors", async () => {
    const f = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await expect(postJson("http://v", "/proof", {}, { fetch: f(409, { error: "x", code: "contract_17" }) })).rejects.toMatchObject({ code: 17, errorName: "CodeNotFound" });
    await expect(postJson("http://v", "/x", {}, { fetch: f(409, { error: "x", code: "humanity_3" }) })).rejects.toMatchObject({ code: 3, source: "humanity" });
    await expect(postJson("http://v", "/x", {}, { fetch: f(401, { error: "no", code: "unauthorized" }) })).rejects.toMatchObject({ code: "unauthorized", source: "verifier" });
  });

  it("sends bigint ids as strings with the bearer token", async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response('{"txHash":"t"}'));
    await postJson("http://v/", "/proof/submit", { campaignId: 2n }, { token: "tok", fetch: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://v/proof/submit");
    expect(init.body).toBe('{"campaignId":"2"}');
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
});

describe("runWrite", () => {
  it("returns hash and unwrapped result", async () => {
    const r = await runWrite<bigint>(async () => fakeTx(ok(7n), () => ok(7n)), { delayMs: 0 });
    expect(r).toEqual({ txHash: "h".repeat(64), result: 7n });
  });

  it("fails fast on a simulated contract error without signing", async () => {
    const tx = fakeTx(bad("AlreadyJoined"), () => ok(""));
    const build = vi.fn(async () => tx);
    await expect(runWrite(build, { delayMs: 0 })).rejects.toMatchObject({ code: 6, errorName: "AlreadyJoined" });
    expect(build).toHaveBeenCalledTimes(1);
    expect(tx.signAndSend).not.toHaveBeenCalled();

    // non-Result functions: failed simulation surfaces via `simulation.error`
    const t2 = { ...fakeTx({ isOk: () => false, isErr: () => true, unwrap: () => 0, unwrapErr: () => ({ message: "" }) }, () => 0), simulation: { error: "HostError: Error(Contract, #4)\n..." } };
    await expect(runWrite(async () => t2, { delayMs: 0 })).rejects.toMatchObject({ code: 4, errorName: "CampaignNotFound" });
  });

  it("re-simulates on transient errors, at most 2 retries", async () => {
    let n = 0;
    const build = vi.fn(async () =>
      fakeTx(ok(1n), () => {
        if (n++ < 2) throw new Error(n === 1 ? "tx_bad_seq" : "status TRY_AGAIN_LATER");
        return ok(5n);
      }),
    );
    await expect(runWrite(build, { delayMs: 0 })).resolves.toMatchObject({ result: 5n });
    expect(build).toHaveBeenCalledTimes(3);

    const always = vi.fn(async () => fakeTx(new Error("simulation: ExceededLimit"), () => ok(0)));
    await expect(runWrite(always, { delayMs: 0 })).rejects.toBeInstanceOf(CliprailError);
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("does not retry contract errors or wallet rejection", async () => {
    for (const e of ["Error(Contract, #8) footprint", "User rejected the request"]) {
      const build = vi.fn(async () => fakeTx(ok(0), () => { throw new Error(e); }));
      await expect(runWrite(build, { delayMs: 0 })).rejects.toBeInstanceOf(CliprailError);
      expect(build).toHaveBeenCalledTimes(1);
    }
    expect(isRetryable(new Error("outer", { cause: new Error("footprint mismatch") }))).toBe(true);
  });
});

it("mapLimit keeps order and caps concurrency", async () => {
  let live = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (x) => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return x * 2;
  });
  expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  expect(peak).toBe(3);
});
