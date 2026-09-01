import { describe, expect, it, vi } from 'vitest';
import { ExperimentalRuntimeCleanup } from '../../src/main/plugins/experimental-runtime-cleanup';
import {
  ExperimentalRuntimeHeartbeatLease,
  ExperimentalRuntimeHeartbeatRateLimiter,
  ExperimentalRuntimeRequestLedger,
} from '../../src/main/plugins/experimental-runtime-ledger';

describe('experimental runtime ownership primitives', () => {
  it('keeps more than five hours of idempotent heartbeats outside the tombstone ledger', () => {
    vi.useFakeTimers();
    try {
      const ledger = new ExperimentalRuntimeRequestLedger(8);
      const heartbeat = new ExperimentalRuntimeHeartbeatLease(5_000, Date.now());
      const rateLimiter = new ExperimentalRuntimeHeartbeatRateLimiter(4, 1_000, Date.now());
      for (let index = 0; index < 9_001; index += 1) {
        vi.advanceTimersByTime(2_000);
        expect(rateLimiter.accept(Date.now())).toBe(true);
        heartbeat.heartbeat(Date.now());
        expect(heartbeat.expired(Date.now())).toBe(false);
      }
      expect(Date.now()).toBeGreaterThan(5 * 60 * 60 * 1_000);
      expect(ledger.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate limits only the flooding runtime and leaves a healthy limiter usable', () => {
    const now = Date.now();
    const flooding = new ExperimentalRuntimeHeartbeatRateLimiter(4, 1_000, now);
    const healthy = new ExperimentalRuntimeHeartbeatRateLimiter(4, 1_000, now);
    expect([0, 1, 2, 3].map(() => flooding.accept(now))).toEqual([true, true, true, true]);
    expect(flooding.accept(now)).toBe(false);
    expect(healthy.accept(now)).toBe(true);
    expect(healthy.accept(now + 2_000)).toBe(true);
  });

  it('contains ledger exhaustion to the malicious runtime', () => {
    const malicious = new ExperimentalRuntimeRequestLedger(2);
    const healthy = new ExperimentalRuntimeRequestLedger(2);
    expect(malicious.consume('malicious:1')).toBe('accepted');
    expect(malicious.consume('malicious:2')).toBe('accepted');
    expect(malicious.consume('malicious:3')).toBe('exhausted');
    expect(healthy.consume('healthy:1')).toBe('accepted');
    expect(healthy.size).toBe(1);
  });

  it('retains ownership after a cleanup fault and converges on retry', async () => {
    const cleanup = new ExperimentalRuntimeCleanup();
    let clearAttempts = 0;
    let releases = 0;
    const operations = {
      destroyWindow: vi.fn(async () => undefined),
      unhandleProtocol: vi.fn(async () => undefined),
      clearSession: vi.fn(async () => {
        clearAttempts += 1;
        if (clearAttempts === 1) throw new Error('fault');
      }),
      releaseOwnership: vi.fn(async () => { releases += 1; }),
    };

    const first = await cleanup.close(operations);
    expect(first).toEqual({
      state: 'cleanup-failed',
      receipts: {
        windowDestroyed: true,
        protocolUnhandled: true,
        sessionCleared: false,
        ownershipReleased: false,
      },
    });
    expect(cleanup.state).toBe('cleanup-failed');
    expect(releases).toBe(0);

    const retry = await cleanup.close(operations);
    expect(retry.state).toBe('closed');
    expect(retry.receipts).toEqual({
      windowDestroyed: true,
      protocolUnhandled: true,
      sessionCleared: true,
      ownershipReleased: true,
    });
    expect(operations.destroyWindow).toHaveBeenCalledTimes(1);
    expect(operations.unhandleProtocol).toHaveBeenCalledTimes(1);
    expect(operations.clearSession).toHaveBeenCalledTimes(2);
    expect(releases).toBe(1);
  });

  it.each(['window', 'protocol'] as const)(
    'retains ownership when the first %s cleanup attempt fails',
    async (faultStep) => {
      const cleanup = new ExperimentalRuntimeCleanup();
      let faulted = false;
      let releases = 0;
      const failOnce = async (step: typeof faultStep) => {
        if (step === faultStep && !faulted) {
          faulted = true;
          throw new Error('fault');
        }
      };
      const operations = {
        destroyWindow: () => failOnce('window'),
        unhandleProtocol: () => failOnce('protocol'),
        clearSession: async () => undefined,
        releaseOwnership: async () => { releases += 1; },
      };

      const first = await cleanup.close(operations);
      expect(first.state).toBe('cleanup-failed');
      expect(first.receipts.ownershipReleased).toBe(false);
      expect(releases).toBe(0);
      const retry = await cleanup.close(operations);
      expect(retry.state).toBe('closed');
      expect(Object.values(retry.receipts).every(Boolean)).toBe(true);
      expect(releases).toBe(1);
    },
  );
});
