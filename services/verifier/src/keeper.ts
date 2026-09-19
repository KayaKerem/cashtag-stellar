// Keeper, per campaign and tick, in this order:
//   1) finalize expired disputes  2) settle due epochs (in order)  3) close proofs in the proof window.
// Chain state is the source of truth; close-proof dedupe/retry lives in Ops.jobs (shared with /proof/submit).
import { u32, u64 } from "./scval.js";
import { MAX_FETCHES, PROOF_MARGIN, SLACK, tag, type Ops } from "./ops.js";
import { contentEnd, disputeEnd, proofEnd, refundAt, settleAt, type TimelineParams } from "./timeline.js";

export class Keeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = new Set<string>();
  private lastErr = new Map<string, string>();

  constructor(
    private ops: Ops,
    private intervalMs = 5000,
    private log = (msg: string) => console.log(`[keeper] ${msg}`),
  ) {}

  start() {
    this.log(`started (every ${this.intervalMs} ms)`);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private fail(key: string, e: any) {
    const msg = `${e?.code ?? ""} ${e?.message ?? e}`.trim();
    if (this.lastErr.get(key) !== msg) this.log(`${key} failed: ${msg}`);
    this.lastErr.set(key, msg);
  }

  /** One run at a time per key; logs tx hash; never throws. */
  private async act(key: string, fn: () => Promise<{ txHash: string }>) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try {
      const { txHash } = await fn();
      this.lastErr.delete(key);
      this.log(`${key} ok tx=${txHash}`);
    } catch (e) {
      this.fail(key, e);
    } finally {
      this.busy.delete(key);
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const { chain, cfg } = this.ops;
      const count = Number(await chain.read(cfg.cliprailId, "campaign_count"));
      for (let id = 1; id <= count; id++) {
        try {
          await this.campaign(BigInt(id));
        } catch (e) {
          this.fail(`campaign ${id}`, e);
        }
      }
      this.ops.prune();
      if (this.lastErr.size > 1000) this.lastErr.clear();
    } catch (e) {
      this.fail("tick", e);
    } finally {
      this.running = false;
    }
  }

  private async campaign(id: bigint) {
    const { chain, cfg } = this.ops;
    const c = await chain.read(cfg.cliprailId, "get_campaign", [u64(id)]);
    const p: TimelineParams = c.params;
    const epochs = Number(p.epochs);
    const now = Date.now() / 1000;
    if (c.refunded || now >= refundAt(p)) return; // finished

    // 1) expired disputes
    const disputes: any[] = (await chain.read(cfg.cliprailId, "list_disputes", [u64(id)])) ?? [];
    for (const d of disputes) {
      const st = tag(d.status);
      const e = Number(d.epoch);
      if ((st === "Open" && now >= disputeEnd(p, e) + SLACK) || (st === "Responded" && now >= settleAt(p, e) + SLACK)) {
        await this.act(`finalize dispute ${d.id}`, async () => {
          const r = await chain.invoke(cfg.cliprailId, "finalize_dispute", [u64(d.id)]);
          d.status = ["Finalized"]; // don't block the settle below in this tick
          return r;
        });
      }
    }

    // 2) settle due epochs, in order
    for (let e = Number(c.settled_epochs); e < epochs && now >= settleAt(p, e) + SLACK; e++) {
      const open = disputes.some((d) => Number(d.epoch) === e && ["Open", "Responded"].includes(tag(d.status)));
      if (open) break;
      let ok = false;
      await this.act(`settle c${id} e${e}`, async () => {
        const r = await chain.invoke(cfg.cliprailId, "settle_epoch", [u64(id), u32(e)]);
        ok = true;
        return r;
      });
      if (!ok) break;
    }

    // 3) close proofs (only epochs whose proof window is open)
    const live: number[] = [];
    for (let e = 0; e < epochs; e++) if (now >= contentEnd(p, e) + SLACK && now < proofEnd(p, e)) live.push(e);
    if (!live.length) return;
    const views: any[] = (await chain.read(cfg.cliprailId, "get_clips", [u64(id)])) ?? [];
    for (const e of live) {
      for (const { clip, epochs: ce } of views) {
        const clipId = BigInt(clip.id);
        if (Number(clip.first_epoch) > e) continue;
        const st = ce?.[e];
        if (st && (tag(st.status) !== "Active" || BigInt(st.views) > 0n)) continue; // excluded/disputed/already proven
        const job = this.ops.jobState(clipId, e);
        if (job?.done || job?.failed || job?.running) continue;
        // a fresh zkFetch needs PROOF_MARGIN; a kept proof may be re-sent until proof_end
        if (!job?.proof && (now >= proofEnd(p, e) - PROOF_MARGIN || (job?.fetches ?? 0) >= MAX_FETCHES)) continue;
        void this.act(`submit c${id} clip${clipId} e${e}`, () => this.ops.submitClose(id, clipId, e));
      }
    }
  }
}
