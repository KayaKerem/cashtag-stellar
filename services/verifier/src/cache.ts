// Proof cache: only the latest raw zkFetch proof per (platform, videoId): <platform>-<videoId>.json.
// PROOF_FIXTURE_DIR = replay mode (same file layout; <platform>-<videoId>-<ts>.json also accepted).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ZkProof } from "./proof.js";

export class ProofCache {
  constructor(private dir: string) {}

  save(platform: string, videoId: string, proof: ZkProof): string {
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${platform}-${videoId}.json`);
    writeFileSync(file, JSON.stringify(proof, null, 2));
    return file;
  }

  latest(platform: string, videoId: string): ZkProof | null {
    if (!existsSync(this.dir)) return null;
    const exact = `${platform}-${videoId}.json`;
    const prefix = `${platform}-${videoId}-`;
    const files = readdirSync(this.dir).filter(
      (f) => f === exact || (f.startsWith(prefix) && /^\d+\.json$/.test(f.slice(prefix.length))),
    );
    if (!files.length) return null;
    const proofs: ZkProof[] = files.map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")));
    return proofs.sort((a, b) => b.claimData.timestampS - a.claimData.timestampS)[0];
  }
}
