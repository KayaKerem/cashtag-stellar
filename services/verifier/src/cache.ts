// Proof cache: every fresh zkFetch proof is stored as <platform>-<videoId>-<ts>.json (raw zkFetch proof).
// PROOF_FIXTURE_DIR = replay mode: proofs are read from that dir instead of calling zkFetch.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ZkProof } from "./proof.js";

export class ProofCache {
  constructor(private dir: string) {}

  save(platform: string, videoId: string, proof: ZkProof): string {
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${platform}-${videoId}-${proof.claimData.timestampS}.json`);
    writeFileSync(file, JSON.stringify(proof, null, 2));
    return file;
  }

  /** Newest cached proof for platform+videoId (by timestamp in the file name), or null. */
  latest(platform: string, videoId: string): ZkProof | null {
    if (!existsSync(this.dir)) return null;
    const prefix = `${platform}-${videoId}-`;
    const exact = `${platform}-${videoId}.json`;
    const files = readdirSync(this.dir).filter(
      (f) => f === exact || (f.startsWith(prefix) && /^\d+\.json$/.test(f.slice(prefix.length))),
    );
    if (!files.length) return null;
    const ts = (f: string) => (f === exact ? 0 : Number(f.slice(prefix.length, -5)));
    files.sort((a, b) => ts(b) - ts(a));
    return JSON.parse(readFileSync(join(this.dir, files[0]), "utf8"));
  }
}
