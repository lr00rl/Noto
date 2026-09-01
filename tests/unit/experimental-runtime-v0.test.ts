import { describe, expect, it } from 'vitest';
import {
  experimentalRuntimeProbePassed,
  isExperimentalRuntimeIdentityV0,
  isExperimentalRuntimeProbeEnvelopeV0,
  type ExperimentalRuntimeProbeV0,
} from '../../src/shared/plugins/experimental-runtime-v0';
import { ExperimentalPluginPidRegistry } from '../../src/main/plugins/experimental-plugin-pid-registry';
import { matchExperimentalPluginProtocolRequest } from '../../src/main/protocol/register-experimental-plugin-protocol';

const token = 'a'.repeat(64);
const probe = (abortObserved = false): ExperimentalRuntimeProbeV0 => ({
  globalsUnavailable: true,
  nodeImportBlocked: true,
  rawIpcUnavailable: true,
  popupBlocked: true,
  navigationDenied: true,
  downloadDenied: true,
  workerBlocked: true,
  externalFetchBlocked: true,
  relativeFetchBlocked: true,
  externalModuleBlocked: true,
  relativeModuleBlocked: true,
  dataModuleBlocked: true,
  blobModuleBlocked: true,
  queryModuleBlocked: true,
  fragmentModuleBlocked: true,
  evalBlocked: true,
  functionConstructorBlocked: true,
  signalIsRealmLocal: true,
  abortObserved,
});

describe('experimental runtime v0 contracts', () => {
  it('accepts only exact bounded identity and probe envelopes', () => {
    const identity = { version: 0, requestId: 'ready:12345678', sessionToken: token, runtimeGeneration: 1 };
    expect(isExperimentalRuntimeIdentityV0(identity)).toBe(true);
    expect(isExperimentalRuntimeIdentityV0({ ...identity, pluginId: 'spoofed' })).toBe(false);
    expect(isExperimentalRuntimeIdentityV0({ ...identity, runtimeGeneration: 2.5 })).toBe(false);
    expect(isExperimentalRuntimeProbeEnvelopeV0({ ...identity, probe: probe() })).toBe(true);
    expect(isExperimentalRuntimeProbeEnvelopeV0({ ...identity, probe: { ...probe(), message: 'leak' } })).toBe(false);
    expect(experimentalRuntimeProbePassed(probe())).toBe(true);
    expect(experimentalRuntimeProbePassed(probe(), true)).toBe(false);
    expect(experimentalRuntimeProbePassed(probe(true), true)).toBe(true);
  });

  it('serves only the three exact opaque-token URLs', () => {
    expect(matchExperimentalPluginProtocolRequest(`noto-plugin://${token}/`, token)).toBe('index.html');
    expect(matchExperimentalPluginProtocolRequest(`noto-plugin://${token}/bootstrap.js`, token)).toBe('bootstrap.js');
    expect(matchExperimentalPluginProtocolRequest(`noto-plugin://${token}/entry.mjs`, token)).toBe('entry.mjs');
    for (const url of [
      `noto-plugin://${token}/entry.mjs?x=1`,
      `noto-plugin://${token}/entry.mjs#x`,
      `noto-plugin://${token}/other.mjs`,
      `noto-plugin://${'b'.repeat(64)}/entry.mjs`,
      `noto-plugin://${token}/../entry.mjs`,
    ]) expect(matchExperimentalPluginProtocolRequest(url, token)).toBeNull();
  });

  it('rejects editor and concurrently live plugin PID collisions but permits historical reuse', () => {
    const registry = new ExperimentalPluginPidRegistry(() => 101);
    expect(registry.register('a:1', 101)).toEqual({ ok: false, collision: 'editor' });
    expect(registry.register('a:1', 202)).toEqual({ ok: true });
    expect(registry.register('b:1', 202)).toEqual({ ok: false, collision: 'plugin' });
    registry.release('a:1');
    expect(registry.register('b:1', 202)).toEqual({ ok: true });
    expect(registry.entries()).toEqual([{ runtimeKey: 'b:1', pid: 202 }]);
  });
});

