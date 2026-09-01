import { describe, expect, it, vi } from 'vitest';
import { ServiceRequestLedger } from '../../src/main/plugins/service-request-ledger';

const identity = (rendererRequestId: string, registryGeneration = 2, serviceGeneration = 7) => ({
  rendererRequestId,
  grantId: 'grant:00000000-0000-4000-8000-000000000000',
  registryGeneration,
  serviceGeneration,
});

describe('host-owned service request correlation', () => {
  it('uses both generations and rejects duplicate renderer IDs', async () => {
    const ledger = new ServiceRequestLedger<string>({ timeoutMs: 1_000, token: () => 'abc123' });
    const pending = ledger.begin(identity('renderer:1'));
    expect(() => ledger.begin(identity('renderer:1'))).toThrow(/already pending|BAD_REQUEST/);
    expect(ledger.settle(pending.correlationId, 1, 7, 'wrong registry')).toBe('mismatched');
    expect(ledger.settle(pending.correlationId, 2, 8, 'wrong service')).toBe('mismatched');
    expect(ledger.settle(pending.correlationId, 2, 7, 'accepted')).toBe('accepted');
    await expect(pending.promise).resolves.toBe('accepted');
    expect(ledger.settle(pending.correlationId, 2, 7, 'late')).toBe('terminal');
  });

  it('makes cancel terminal before a late service success', async () => {
    const terminal = vi.fn();
    const ledger = new ServiceRequestLedger<string>({ timeoutMs: 1_000, onTerminal: terminal });
    const pending = ledger.begin(identity('renderer:cancel'));
    expect(ledger.cancel('renderer:cancel', 2, 7)).toBe('accepted');
    await expect(pending.promise).rejects.toThrow(/SERVICE_CANCELLED/);
    expect(terminal).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
    expect(ledger.settle(pending.correlationId, 2, 7, 'late')).toBe('terminal');
    expect(ledger.cancel('renderer:cancel', 2, 7)).toBe('terminal');
  });

  it('makes timeout terminal before a late service success', async () => {
    const ledger = new ServiceRequestLedger<string>({ timeoutMs: 5, token: () => 'timeout1' });
    const pending = ledger.begin(identity('renderer:timeout', 4, 9));
    await expect(pending.promise).rejects.toThrow(/TIMEOUT/);
    expect(ledger.settle(pending.correlationId, 4, 9, 'late')).toBe('terminal');
    expect(() => ledger.begin(identity('renderer:timeout', 4, 9))).toThrow(/BAD_REQUEST/);
  });
});
