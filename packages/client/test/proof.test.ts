import { describe, expect, it } from "vitest";
import { Client } from "cliprail-client";
import { proofJsonToReclaimProof, type ProofJson } from "../src/proof";
// Reference encoder used by the verifier/keeper (stellar-sdk 17).
import { reclaimProofToScVal } from "../../../services/verifier/src/scval";

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
const pj: ProofJson = {
  parameters: hex('{"method":"GET","url":"https://www.googleapis.com/youtube/v3/videos?id=abc"}'),
  context: hex('{"extractedParameters":{"views":"1234"},"providerHash":"0x01"}'),
  owner: hex("0xc76daa73f2dcea9d6ac089e008f95b57eba9e6e3"),
  timestampS: 1_758_300_000,
  epoch: 1,
  signature: "ab".repeat(32) + "cd".repeat(32),
  recoveryId: 1,
};

describe("proofJsonToReclaimProof", () => {
  it("maps hex fields to bytes and numbers to u64/u32", () => {
    const rp = proofJsonToReclaimProof(pj);
    expect(Buffer.from(rp.parameters).toString("hex")).toBe(pj.parameters);
    expect(Buffer.from(rp.context).toString("hex")).toBe(pj.context);
    expect(Buffer.from(rp.owner).toString("utf8")).toBe("0xc76daa73f2dcea9d6ac089e008f95b57eba9e6e3");
    expect(rp.signature.length).toBe(64);
    expect(rp.timestamp_s).toBe(1_758_300_000n);
    expect(rp.epoch).toBe(1);
    expect(rp.recovery_id).toBe(1);
  });

  it("encodes to the same ScVal as the verifier", () => {
    const c = new Client({ contractId: "CC4SMPQWP56TUVAUAWMK4BLOONQPBLJAWDVNPE6HMZGEMG67WW4XR7T3", rpcUrl: "https://soroban-testnet.stellar.org", networkPassphrase: "Test SDF Network ; September 2015" });
    const args = c.spec.funcArgsToScVals("register_clip", {
      campaign_id: 1n,
      participant: "GCV77O3T74VBDPL5TGCXVDYCASS2YAEFIQIHI4LUWRTWN4QAKX4OMGPD",
      platform: "youtube",
      video_id: "abc",
      proof: proofJsonToReclaimProof(pj),
    });
    expect(args[4].toXDR("base64")).toBe(reclaimProofToScVal(pj).toXDR("base64"));
  });

  it("rejects malformed input", () => {
    expect(() => proofJsonToReclaimProof({ ...pj, signature: "ab" })).toThrow(/signature/);
    expect(() => proofJsonToReclaimProof({ ...pj, recoveryId: 27 })).toThrow(/recoveryId/);
    expect(() => proofJsonToReclaimProof({ ...pj, context: "xyz" })).toThrow(/context/);
  });
});
