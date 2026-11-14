// Live status for GET /health: build version, uptime, RPC reachability and keeper liveness.
// The RPC probe is cached so /health stays cheap enough for an external uptime monitor.

export interface KeeperStatus {
  intervalMs: number;
  lastTickAt: number | null; // ms epoch of the last finished tick
  lastTickOk: boolean | null;
}

export interface HealthSnapshot {
  ok: boolean;
  version: string;
  uptimeS: number;
  rpc: { ok: boolean; latestLedger: number | null; error: string | null; checkedAt: number | null };
  keeper: (KeeperStatus & { enabled: true; stale: boolean }) | { enabled: false };
  aadhaar: { available: boolean };
}

export interface HealthDeps {
  version: string;
  latestLedger?: () => Promise<number>;
  keeper?: () => KeeperStatus;
  aadhaarAvailable?: () => boolean;
  now?: () => number;
  rpcCacheMs?: number;
}

/** A keeper is stale when no tick has finished within this many intervals (min 2 minutes). */
export const STALE_INTERVALS = 10;

export class Health {
  private started: number;
  private rpc: HealthSnapshot["rpc"] = { ok: false, latestLedger: null, error: "not checked yet", checkedAt: null };
  private inflight: Promise<void> | null = null;

  constructor(private d: HealthDeps) {
    this.started = this.now();
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now();
  }

  private async probeRpc() {
    if (!this.d.latestLedger) {
      this.rpc = { ok: true, latestLedger: null, error: null, checkedAt: this.now() };
      return;
    }
    try {
      const seq = await this.d.latestLedger();
      this.rpc = { ok: true, latestLedger: seq, error: null, checkedAt: this.now() };
    } catch (e: any) {
      // Public endpoint: expose a fixed code only; the details go to the server log.
      console.error(`[health] rpc probe failed: ${e?.message ?? e}`);
      this.rpc = { ok: false, latestLedger: null, error: "rpc_unreachable", checkedAt: this.now() };
    }
  }

  async snapshot(): Promise<HealthSnapshot> {
    const cacheMs = this.d.rpcCacheMs ?? 15_000;
    if (this.rpc.checkedAt === null || this.now() - this.rpc.checkedAt >= cacheMs) {
      this.inflight ??= this.probeRpc().finally(() => (this.inflight = null));
      await this.inflight;
    }
    const now = this.now();
    let keeper: HealthSnapshot["keeper"] = { enabled: false };
    if (this.d.keeper) {
      const k = this.d.keeper();
      const limit = Math.max(k.intervalMs * STALE_INTERVALS, 120_000);
      // Before the first tick, measure from process start.
      const stale = now - (k.lastTickAt ?? this.started) > limit;
      keeper = { enabled: true, ...k, stale };
    }
    const ok = this.rpc.ok && !(keeper.enabled && keeper.stale);
    return {
      ok,
      version: this.d.version,
      uptimeS: Math.floor((now - this.started) / 1000),
      rpc: { ...this.rpc },
      keeper,
      aadhaar: { available: this.d.aadhaarAvailable?.() ?? false },
    };
  }
}
