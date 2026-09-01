export type ExperimentalRuntimeLedgerResult = 'accepted' | 'duplicate' | 'exhausted';

export class ExperimentalRuntimeRequestLedger {
  readonly #requestIds = new Set<string>();

  constructor(readonly capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096) {
      throw new Error('EXPERIMENTAL_RUNTIME_LEDGER_CAPACITY_INVALID');
    }
  }

  consume(requestId: string): ExperimentalRuntimeLedgerResult {
    if (this.#requestIds.has(requestId)) return 'duplicate';
    if (this.#requestIds.size >= this.capacity) return 'exhausted';
    this.#requestIds.add(requestId);
    return 'accepted';
  }

  get size(): number {
    return this.#requestIds.size;
  }
}

export class ExperimentalRuntimeHeartbeatLease {
  #lastHeartbeat: number;

  constructor(readonly graceMilliseconds: number, now: number) {
    if (!Number.isFinite(graceMilliseconds) || graceMilliseconds <= 0 || !Number.isFinite(now)) {
      throw new Error('EXPERIMENTAL_RUNTIME_HEARTBEAT_INVALID');
    }
    this.#lastHeartbeat = now;
  }

  heartbeat(now: number): void {
    if (!Number.isFinite(now) || now < this.#lastHeartbeat) {
      throw new Error('EXPERIMENTAL_RUNTIME_HEARTBEAT_INVALID');
    }
    this.#lastHeartbeat = now;
  }

  expired(now: number): boolean {
    return now - this.#lastHeartbeat > this.graceMilliseconds;
  }
}

export class ExperimentalRuntimeHeartbeatRateLimiter {
  #tokens: number;
  #lastRefill: number;

  constructor(
    readonly capacity: number,
    readonly refillMilliseconds: number,
    now: number,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 32
      || !Number.isFinite(refillMilliseconds) || refillMilliseconds < 250
      || !Number.isFinite(now)) {
      throw new Error('EXPERIMENTAL_RUNTIME_HEARTBEAT_RATE_LIMIT_INVALID');
    }
    this.#tokens = capacity;
    this.#lastRefill = now;
  }

  accept(now: number): boolean {
    if (!Number.isFinite(now) || now < this.#lastRefill) return false;
    const elapsed = now - this.#lastRefill;
    const refill = Math.floor(elapsed / this.refillMilliseconds);
    if (refill > 0) {
      this.#tokens = Math.min(this.capacity, this.#tokens + refill);
      this.#lastRefill += refill * this.refillMilliseconds;
    }
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}
