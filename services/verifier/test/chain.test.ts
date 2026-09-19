import { describe, expect, it, vi } from "vitest";
import { Account, Keypair, nativeToScVal } from "@stellar/stellar-sdk";
import { config } from "../src/config.js";
import { Chain } from "../src/chain.js";

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
