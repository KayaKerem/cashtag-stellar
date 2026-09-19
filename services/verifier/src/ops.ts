// Business operations shared by HTTP routes and the keeper.
import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import type { Config, Platform } from "./config.js";
import { Chain } from "./chain.js";
import { HttpError, ProofService } from "./zkfetch.js";
import { address, bytesN, reclaimProofToScVal, u32, u64 } from "./scval.js";

/** nullifier = sha256(utf8("demo" ‖ decimal(campaignId) ‖ wallet)) */
export const demoNullifier = (campaignId: bigint, wallet: string) =>
  createHash("sha256").update(`demo${campaignId.toString()}${wallet}`, "utf8").digest();

export class Ops {
  constructor(
    public cfg: Config,
    public proofs: ProofService,
    public chain: Chain,
  ) {}

  /** Fresh close proof for a registered clip, sent by the relayer via submit_proof. */
  async submitClose(campaignId: bigint, clipId: bigint, epoch: number) {
    const clip = await this.chain.read(this.cfg.cliprailId, "get_clip", [u64(clipId)]);
    if (!clip) throw new HttpError(404, "clip not found", "contract_11");
    if (BigInt(clip.campaign_id) !== campaignId) throw new HttpError(400, "clip does not belong to campaign", "bad_request");
    const platform = String(clip.platform) as Platform;
    const { proof, extracted } = await this.proofs.get(platform, String(clip.video_id));
    const { txHash } = await this.chain.invoke(this.cfg.cliprailId, "submit_proof", [
      u64(campaignId),
      u64(clipId),
      u32(epoch),
      reclaimProofToScVal(proof),
    ]);
    return { txHash, views: extracted.views };
  }

  async demoRegister(campaignId: bigint, wallet: string) {
    if (!StrKey.isValidEd25519PublicKey(wallet) && !StrKey.isValidContract(wallet))
      throw new HttpError(400, "invalid wallet address", "bad_request");
    const { txHash } = await this.chain.invoke(this.cfg.humanityId, "register", [
      u64(campaignId),
      bytesN(demoNullifier(campaignId, wallet)),
      address(wallet),
    ]);
    return { txHash };
  }
}
