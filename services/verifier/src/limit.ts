// Tiny concurrency limiter and per-key token bucket.

export function pLimit(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** `capacity` tokens per key, refilled continuously at capacity / windowMs. */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private capacity: number,
    private windowMs: number,
    private maxKeys = 10_000,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) * this.capacity) / this.windowMs);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    // Re-insert so Map order is least-recently-used first; evict the oldest keys over the cap
    // (a wholesale clear would let an attacker reset everyone's limit by rotating keys).
    this.buckets.delete(key);
    this.buckets.set(key, b);
    while (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    return ok;
  }
}
