import type {
  ExperimentalRuntimeAbortEnvelopeV0,
  ExperimentalRuntimeProbeV0,
} from '../../shared/plugins/experimental-runtime-v0';

interface RuntimeBridge {
  ready(requestId: string): Promise<{ accepted: true }>;
  probe(requestId: string, probe: ExperimentalRuntimeProbeV0): Promise<{ accepted: true }>;
  heartbeat(requestId: string): Promise<{ accepted: true }>;
  onAbort(handler: (event: ExperimentalRuntimeAbortEnvelopeV0) => void): () => void;
  acknowledgeAbort(requestId: string): Promise<{ accepted: true }>;
}

declare global {
  interface Window { notoPluginRuntime: RuntimeBridge }
}

const requestId = (kind: string): string => `${kind}:${crypto.randomUUID()}`;
const bridge = window.notoPluginRuntime;
const controller = new AbortController();

const emptyProbe = (): ExperimentalRuntimeProbeV0 => ({
  globalsUnavailable: false,
  nodeImportBlocked: false,
  rawIpcUnavailable: false,
  popupBlocked: false,
  navigationDenied: false,
  downloadDenied: false,
  workerBlocked: false,
  externalFetchBlocked: false,
  relativeFetchBlocked: false,
  externalModuleBlocked: false,
  relativeModuleBlocked: false,
  dataModuleBlocked: false,
  blobModuleBlocked: false,
  queryModuleBlocked: false,
  fragmentModuleBlocked: false,
  evalBlocked: false,
  functionConstructorBlocked: false,
  signalIsRealmLocal: false,
  abortObserved: false,
});

const abortUnsubscribe = bridge.onAbort(async (event) => {
  controller.abort();
  await bridge.acknowledgeAbort(event.requestId);
});

try {
  const entryUrl = new URL('./entry.mjs', location.href).href;
  const plugin = await import(/* @vite-ignore */ entryUrl) as {
    activate(api: {
      signal: AbortSignal;
      heartbeat: () => Promise<void>;
      reportProbe: (probe: ExperimentalRuntimeProbeV0) => Promise<void>;
    }): Promise<ExperimentalRuntimeProbeV0>;
  };
  if (!plugin || typeof plugin.activate !== 'function') throw new Error('EXPERIMENTAL_RUNTIME_ACTIVATE_MISSING');
  const probe = await plugin.activate({
    signal: controller.signal,
    heartbeat: async () => { await bridge.heartbeat(requestId('plugin-heartbeat')); },
    reportProbe: async (nextProbe: ExperimentalRuntimeProbeV0) => {
      await bridge.probe(requestId('probe-update'), nextProbe);
    },
  });
  await bridge.probe(requestId('probe'), { ...emptyProbe(), ...probe });
  await bridge.ready(requestId('ready'));
  setInterval(() => { void bridge.heartbeat(requestId('heartbeat')); }, 2_000);
} catch {
  abortUnsubscribe();
  throw new Error('EXPERIMENTAL_RUNTIME_BOOTSTRAP_FAILED');
}
