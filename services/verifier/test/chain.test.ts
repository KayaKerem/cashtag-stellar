import { describe, expect, it, vi } from "vitest";
import { Account, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { config } from "../src/config.js";
import { Chain, isBadSeq } from "../src/chain.js";

const CONTRACT = "CC4SMPQWP56TUVAUAWMK4BLOONQPBLJAWDVNPE6HMZGEMG67WW4XR7T3";

describe("Chain.invoke sequence numbers", () => {
  it("does not reuse a sequence while RPC still reports the old one", async () => {
    const kp = Keypair.random();
    const chain = new Chain({ ...config, relayerSecret: kp.secret(), cliprailId: CONTRACT });
    const seqs: string[] = [];
    let status: "PENDING" | "ERROR" = "PENDING";
    (chain as any).server = {
      getAccount: vi.fn(async () => new Account(kp.publicKey(), "100")), // lags: never sees our pending txs
      prepareTransaction: vi.fn(async (tx: any) => tx),
      sendTransaction: vi.fn(async (tx: any) => {
        seqs.push(tx.sequence);
        return { status, hash: `h${seqs.length}` };
      }),
      pollTransaction: vi.fn(async () => ({ status: "SUCCESS" })),
    };
    const args = [nativeToScVal(1n, { type: "u64" })];
    await Promise.all([chain.invoke(CONTRACT, "m", args), chain.invoke(CONTRACT, "m", args)]);
    expect(seqs).toEqual(["101", "102"]);
    status = "ERROR";
    await expect(chain.invoke(CONTRACT, "m", args)).rejects.toMatchObject({ code: "send_failed" });
    status = "PENDING";
    await chain.invoke(CONTRACT, "m", args); // resynced from RPC after the failed send
    expect(seqs).toEqual(["101", "102", "103", "101"]);
  });
});

// The txBadSeq result we saw in the wild right after a restart.
const BAD_SEQ_B64 = "AAAAAAAQDJ7////7AAAAAA==";

describe("Chain.invoke txBadSeq recovery", () => {
  const args = [nativeToScVal(1n, { type: "u64" })];
  function setup(rpcSeqs: string[], badSends: number) {
    const kp = Keypair.random();
    const chain = new Chain({ ...config, relayerSecret: kp.secret(), cliprailId: CONTRACT });
    const sent: { seq: string; signed: boolean }[] = [];
    let reads = 0;
    const server = {
      getAccount: vi.fn(async () => new Account(kp.publicKey(), rpcSeqs[Math.min(reads++, rpcSeqs.length - 1)])),
      prepareTransaction: vi.fn(async (tx: any) => tx),
      sendTransaction: vi.fn(async (tx: any) => {
        sent.push({ seq: tx.sequence, signed: tx.signatures.length === 1 });
        if (sent.length <= badSends)
          return { status: "ERROR", errorResult: xdr.TransactionResult.fromXDR(BAD_SEQ_B64, "base64") };
        return { status: "PENDING", hash: `h${sent.length}` };
      }),
      pollTransaction: vi.fn(async () => ({ status: "SUCCESS" })),
    };
    (chain as any).server = server;
    return { chain, server, sent };
  }

  it("decodes txBadSeq from the error result XDR", () => {
    expect(isBadSeq(BAD_SEQ_B64)).toBe(true);
    expect(isBadSeq(xdr.TransactionResult.fromXDR(BAD_SEQ_B64, "base64"))).toBe(true);
    expect(isBadSeq(undefined)).toBe(false);
    expect(isBadSeq("garbage")).toBe(false);
  });

  it("re-reads the sequence and resends with a fresh, re-signed tx", async () => {
    // RPC catches up between attempts
    const { chain, server, sent } = setup(["100", "101"], 1);
    const r = await chain.invoke(CONTRACT, "m", args);
    expect(r.txHash).toBe("h2");
    expect(sent).toEqual([{ seq: "101", signed: true }, { seq: "102", signed: true }]);
    expect(server.getAccount).toHaveBeenCalledTimes(2);
    await chain.invoke(CONTRACT, "m", args); // tracked after the successful retry
    expect(sent.at(-1)!.seq).toBe("103");
  });

  it("steps past a pending tx when RPC still lags (post-restart)", async () => {
    const { chain, sent } = setup(["100"], 1);
    await chain.invoke(CONTRACT, "m", args);
    expect(sent.map((s) => s.seq)).toEqual(["101", "102"]);
  });

  it("gives up after 2 retries with send_failed", async () => {
    const { chain, sent } = setup(["100"], 10);
    await expect(chain.invoke(CONTRACT, "m", args)).rejects.toMatchObject({ code: "send_failed" });
    expect(sent).toHaveLength(3);
  });

  it("does not retry other send errors", async () => {
    const { chain, server } = setup(["100"], 0);
    server.sendTransaction.mockResolvedValueOnce({ status: "ERROR", errorResult: undefined } as any);
    await expect(chain.invoke(CONTRACT, "m", args)).rejects.toMatchObject({ code: "send_failed" });
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });
});
