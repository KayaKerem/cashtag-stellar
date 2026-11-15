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

describe("Chain keys (TM-15)", () => {
  const args = [nativeToScVal(1n, { type: "u64" })];
  function setup(relayer: Keypair, keeper?: Keypair) {
    const chain = new Chain({ ...config, relayerSecret: relayer.secret(), keeperSecret: keeper?.secret() ?? "", cliprailId: CONTRACT });
    const sent: { source: string; seq: string; signer: string }[] = [];
    (chain as any).server = {
      getAccount: vi.fn(async (a: string) => new Account(a, a === relayer.publicKey() ? "100" : "500")),
      prepareTransaction: vi.fn(async (tx: any) => tx),
      sendTransaction: vi.fn(async (tx: any) => {
        const d = tx.signatures[0];
        const raw = typeof d.signature === "function" ? d.signature() : d.signature.value;
        const sig = [relayer, keeper].find((kp) => kp?.verify(tx.hash(), Buffer.from(raw)))?.publicKey() ?? "unknown";
        sent.push({ source: tx.source, seq: tx.sequence, signer: sig });
        return { status: "PENDING", hash: `h${sent.length}` };
      }),
      pollTransaction: vi.fn(async () => ({ status: "SUCCESS" })),
    };
    return { chain, sent };
  }
  const hint = (kp: Keypair) => kp.publicKey();

  it("signs keeper calls with KEEPER_SECRET and relayer calls with RELAYER_SECRET, each on its own sequence", async () => {
    const r = Keypair.random();
    const k = Keypair.random();
    const { chain, sent } = setup(r, k);
    expect(chain.relayer).toBe(r.publicKey());
    expect(chain.keeper).toBe(k.publicKey());
    await Promise.all([
      chain.invoke(CONTRACT, "settle_epoch", args, "keeper"),
      chain.invoke(CONTRACT, "register", args, "relayer"),
      chain.invoke(CONTRACT, "submit_proof", args, "keeper"),
    ]);
    const byKeeper = sent.filter((s) => s.source === k.publicKey());
    const byRelayer = sent.filter((s) => s.source === r.publicKey());
    expect(byKeeper.map((s) => s.seq)).toEqual(["501", "502"]);
    expect(byKeeper.every((s) => s.signer === hint(k))).toBe(true);
    expect(byRelayer).toEqual([{ source: r.publicKey(), seq: "101", signer: hint(r) }]);
  });

  it("falls back to the relayer key (one shared sequence) when KEEPER_SECRET is not set", async () => {
    const r = Keypair.random();
    const { chain, sent } = setup(r);
    expect(chain.keeper).toBe(r.publicKey());
    await Promise.all([chain.invoke(CONTRACT, "settle_epoch", args, "keeper"), chain.invoke(CONTRACT, "register", args)]);
    expect(sent.map((s) => s.seq)).toEqual(["101", "102"]);
  });
});
