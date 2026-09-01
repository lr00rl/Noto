import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CapabilityBroker, CapabilityDeniedError } from '../../src/main/plugins/capability-broker';

describe('main-owned capability broker', () => {
  it('authorizes one relative path inside a granted root', () => {
    const broker = new CapabilityBroker();
    const grant = broker.grantRead('/tmp/noto-g001');
    const authorized = broker.authorizeRead(grant.id, 'fixture.md');
    expect(authorized.absolutePath).toBe(path.resolve('/tmp/noto-g001/fixture.md'));
    expect(broker.counters).toEqual({ grants: 1, denials: 0 });
  });

  it('denies traversal before any caller can dispatch to the service', () => {
    const broker = new CapabilityBroker();
    const grant = broker.grantRead('/tmp/noto-g001');
    expect(() => broker.authorizeRead(grant.id, '../denied.md')).toThrow(CapabilityDeniedError);
    expect(broker.counters).toEqual({ grants: 1, denials: 1 });
  });

  it('denies missing grants and absolute paths', () => {
    const broker = new CapabilityBroker();
    expect(() => broker.authorizeRead(undefined, 'fixture.md')).toThrow(/missing/);
    const grant = broker.grantRead('/tmp/noto-g001');
    expect(() => broker.authorizeRead(grant.id, '/etc/hosts')).toThrow(/invalid/);
  });

  it('binds grants to a generation and revokes them terminally', () => {
    const broker = new CapabilityBroker();
    const grant = broker.grantRead('/tmp/noto-g001', 7);

    expect(broker.authorizeRead(grant.id, 'fixture.md', 7, 1).grant.registryGeneration).toBe(7);
    expect(() => broker.authorizeRead(grant.id, 'fixture.md', 8, 1)).toThrow(CapabilityDeniedError);
    expect(broker.revoke(grant.id, 7, 1)?.id).toBe(grant.id);
    expect(broker.revoke(grant.id, 7, 1)).toBeNull();
    expect(() => broker.authorizeRead(grant.id, 'fixture.md', 7, 1)).toThrow(CapabilityDeniedError);
  });
});
