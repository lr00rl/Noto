export const EXPERIMENTAL_RUNTIME_VERSION = 0 as const;

export const EXPERIMENTAL_RUNTIME_CHANNELS = Object.freeze({
  ready: 'noto:experimental-runtime:ready',
  probe: 'noto:experimental-runtime:probe',
  heartbeat: 'noto:experimental-runtime:heartbeat',
  abort: 'noto:experimental-runtime:abort',
  abortAck: 'noto:experimental-runtime:abort-ack',
});

export interface ExperimentalRuntimeIdentityV0 {
  version: typeof EXPERIMENTAL_RUNTIME_VERSION;
  requestId: string;
  sessionToken: string;
  runtimeGeneration: number;
}

export interface ExperimentalRuntimeProbeV0 {
  globalsUnavailable: boolean;
  nodeImportBlocked: boolean;
  rawIpcUnavailable: boolean;
  popupBlocked: boolean;
  navigationDenied: boolean;
  downloadDenied: boolean;
  workerBlocked: boolean;
  externalFetchBlocked: boolean;
  relativeFetchBlocked: boolean;
  externalModuleBlocked: boolean;
  relativeModuleBlocked: boolean;
  dataModuleBlocked: boolean;
  blobModuleBlocked: boolean;
  queryModuleBlocked: boolean;
  fragmentModuleBlocked: boolean;
  evalBlocked: boolean;
  functionConstructorBlocked: boolean;
  signalIsRealmLocal: boolean;
  abortObserved: boolean;
}

export interface ExperimentalRuntimeProbeEnvelopeV0 extends ExperimentalRuntimeIdentityV0 {
  probe: ExperimentalRuntimeProbeV0;
}

export interface ExperimentalRuntimeAbortEnvelopeV0 extends ExperimentalRuntimeIdentityV0 {}

export interface ExperimentalRuntimeAcceptedV0 {
  accepted: true;
}

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
};

export function isExperimentalRuntimeIdentityV0(value: unknown): value is ExperimentalRuntimeIdentityV0 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['version', 'requestId', 'sessionToken', 'runtimeGeneration'])
    && record.version === EXPERIMENTAL_RUNTIME_VERSION
    && typeof record.requestId === 'string'
    && record.requestId.length >= 8
    && record.requestId.length <= 128
    && /^[a-zA-Z0-9:._-]+$/.test(record.requestId)
    && typeof record.sessionToken === 'string'
    && /^[a-f0-9]{64}$/.test(record.sessionToken)
    && Number.isSafeInteger(record.runtimeGeneration)
    && Number(record.runtimeGeneration) > 0;
}

const probeKeys = [
  'globalsUnavailable', 'nodeImportBlocked', 'rawIpcUnavailable', 'popupBlocked',
  'navigationDenied', 'downloadDenied', 'workerBlocked', 'externalFetchBlocked',
  'relativeFetchBlocked', 'externalModuleBlocked', 'relativeModuleBlocked',
  'dataModuleBlocked', 'blobModuleBlocked', 'queryModuleBlocked', 'fragmentModuleBlocked', 'evalBlocked',
  'functionConstructorBlocked', 'signalIsRealmLocal', 'abortObserved',
] as const;

export function isExperimentalRuntimeProbeV0(value: unknown): value is ExperimentalRuntimeProbeV0 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, probeKeys) && probeKeys.every((key) => typeof record[key] === 'boolean');
}

export function isExperimentalRuntimeProbeEnvelopeV0(value: unknown): value is ExperimentalRuntimeProbeEnvelopeV0 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['version', 'requestId', 'sessionToken', 'runtimeGeneration', 'probe'])) return false;
  const { probe, ...identity } = record;
  return isExperimentalRuntimeIdentityV0(identity) && isExperimentalRuntimeProbeV0(probe);
}

export const experimentalRuntimeProbePassed = (
  probe: ExperimentalRuntimeProbeV0,
  requireAbort = false,
): boolean => Object.entries(probe).every(([key, value]) =>
  key === 'abortObserved' && !requireAbort ? true : value);
