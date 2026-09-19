// Keeper: per campaign, (a) sends close proofs in the proof window, (b) finalizes expired disputes,
// (c) settles epochs. Idempotent (chain state is the source of truth), errors are logged and retried.
import { u32, u64 } from "./scval.js";
import type { Ops } from "./ops.js";
import { contentEnd, disputeEnd, proofEnd, refundAt, settleAt, type TimelineParams } from "./timeline.js";

const SLACK = 6; // s: ledger time lags wall clock a little
const PROOF_MARGIN = 30; // s: don't start a proof this close to proof_end
const MAX_SUBMIT_ATTEMPTS = 2; // protects the zkFetch quota

const tag = (v: unknown) => (Array.isArray(v) ? String(v[0]) : String(v)); // enum -> "Name"

export class Keeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inflight = new Set<string>();
  private attempts = new Map<string, number>();
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
    const msg = String(e?.message ?? e);
    if (this.lastErr.get(key) !== msg) this.log(`${key} failed: ${msg}`);
    this.lastErr.set(key, msg);
  }

  /** Runs `fn` once at a time per key; never throws. */
  private async act(key: string, fn: () => Promise<{ txHash: string }>) {
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const { txHash } = await fn();
      this.lastErr.delete(key);
      this.log(`${key} ok tx=${txHash}`);
      return true;
    } catch (e) {
      this.fail(key, e);
      return false;
    } finally {
      this.inflight.delete(key);
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
    if (c.refunded || now > refundAt(p) + 60) return;

    // (a) close proofs
    for (let e = 0; e < epochs; e++) {
      if (now < contentEnd(p, e) + SLACK || now > proofEnd(p, e) - PROOF_MARGIN) continue;
      const views: any[] = await chain.read(cfg.cliprailId, "get_clips", [u64(id)]);
      for (const { clip, epochs: ce } of views ?? []) {
        if (Number(clip.first_epoch) > e || Number(clip.registered_at) >= contentEnd(p, e)) continue;
        const st = ce?.[e];
        if (st && tag(st.status) === "Excluded") continue;
        const key = `submit c${id} clip${clip.id} e${e}`;
        const n = this.attempts.get(key) ?? 0;
        if (n >= MAX_SUBMIT_ATTEMPTS || this.inflight.has(key)) continue;
        this.attempts.set(key, n + 1);
        // detached: proofs take 5–30 s; other actions shouldn't wait
        void this.act(key, () => this.ops.submitClose(id, BigInt(clip.id), e)).then((ok) => {
          if (ok) this.attempts.set(key, MAX_SUBMIT_ATTEMPTS);
        });
      }
    }

    // (b) expired disputes
    const disputes: any[] = (await chain.read(cfg.cliprailId, "list_disputes", [u64(id)])) ?? [];
    for (const d of disputes) {
      const st = tag(d.status);
      const e = Number(d.epoch);
      const due = (st === "Open" && now >= disputeEnd(p, e) + SLACK) || (st === "Responded" && now >= settleAt(p, e) + SLACK);
      if (due)
        await this.act(`finalize dispute ${d.id}`, () => chain.invoke(cfg.cliprailId, "finalize_dispute", [u64(d.id)]));
    }

    // (c) settle next epoch in order
    const e = Number(c.settled_epochs);
    if (e < epochs && now >= settleAt(p, e) + SLACK) {
      const open = disputes.some((d) => Number(d.epoch) === e && ["Open", "Responded"].includes(tag(d.status)));
      if (!open)
        await this.act(`settle c${id} e${e}`, () => chain.invoke(cfg.cliprailId, "settle_epoch", [u64(id), u32(e)]));
    }
  }
}
