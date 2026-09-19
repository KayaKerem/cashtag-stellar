// Synthetic zkFetch-shaped proof signed with a local secp256k1 key, following ARCHITECTURE §8.2.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ZkProof } from "../src/proof.js";

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export const TEST_SK = Uint8Array.from(Buffer.from("11".repeat(32), "hex"));
export const addressOf = (pub65: Uint8Array) => "0x" + hex(keccak_256(pub65.slice(1)).slice(12));
export const TEST_ATTESTOR = addressOf(secp256k1.getPublicKey(TEST_SK, false));

export function claimDigest(parameters: string, context: string, owner: string, timestampS: number, epoch: number) {
  const identifier = "0x" + hex(keccak_256(enc(`http\n${parameters}\n${context}`)));
  const serialized = `${identifier}\n${owner}\n${timestampS}\n${epoch}`;
  const digest = keccak_256(enc(`\x19Ethereum Signed Message:\n${enc(serialized).length}${serialized}`));
  return { identifier, digest };
}

export function makeProof(opts: { url?: string; views?: string; desc?: string; timestampS?: number } = {}): ZkProof {
  const url = opts.url ?? "https://verifier.example/demo/videos/vid1";
  const views = opts.views ?? "1234";
  const desc = opts.desc ?? "watch this CR-ABC123";
  const parameters = JSON.stringify({
    body: "",
    method: "GET",
    responseMatches: [{ type: "regex", value: '"viewCount":\\s*"(?<views>\\d+)"' }],
    responseRedactions: [],
    url,
  });
  const context = JSON.stringify({ extractedParameters: { desc, views }, providerHash: "0xabc" });
  const owner = "0xAbCdEf0000000000000000000000000000000001";
  const timestampS = opts.timestampS ?? 1_760_000_000;
  const epoch = 1;
  const { identifier, digest } = claimDigest(parameters, context, owner.toLowerCase(), timestampS, epoch);
  const rec = secp256k1.sign(digest, TEST_SK, { prehash: false, format: "recovered" });
  // noble "recovered" = recovery ‖ r ‖ s
  const v = 27 + rec[0];
  const sig = "0x" + hex(rec.slice(1)) + v.toString(16);
  return {
    identifier,
    claimData: { provider: "http", parameters, context, owner: owner.toLowerCase(), timestampS, epoch, identifier },
    signatures: [sig],
    witnesses: [{ id: TEST_ATTESTOR, url: "wss://attestor.example" }],
    extractedParameterValues: { desc, views },
  };
}
