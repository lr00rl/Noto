import { contextBridge, ipcRenderer } from 'electron';
import {
  EXPERIMENTAL_RUNTIME_CHANNELS,
  EXPERIMENTAL_RUNTIME_VERSION,
  isExperimentalRuntimeIdentityV0,
  isExperimentalRuntimeProbeV0,
  type ExperimentalRuntimeAbortEnvelopeV0,
  type ExperimentalRuntimeProbeV0,
} from '../shared/plugins/experimental-runtime-v0';

const argument = (name: string): string => {
  const prefix = `--${name}=`;
  const value = process.argv.find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error('EXPERIMENTAL_RUNTIME_IDENTITY_MISSING');
  return value;
};

const sessionToken = argument('noto-plugin-session');
const runtimeGeneration = Number(argument('noto-plugin-generation'));
if (!/^[a-f0-9]{64}$/.test(sessionToken) || !Number.isSafeInteger(runtimeGeneration) || runtimeGeneration <= 0) {
  throw new Error('EXPERIMENTAL_RUNTIME_IDENTITY_INVALID');
}

const envelope = (requestId: string) => ({
  version: EXPERIMENTAL_RUNTIME_VERSION,
  requestId,
  sessionToken,
  runtimeGeneration,
});

const invoke = async (channel: string, payload: unknown): Promise<{ accepted: true }> => {
  const reply = await ipcRenderer.invoke(channel, payload);
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)
    || Object.keys(reply).length !== 1 || (reply as Record<string, unknown>).accepted !== true) {
    throw new Error('EXPERIMENTAL_RUNTIME_REPLY_INVALID');
  }
  return { accepted: true };
};

const api = Object.freeze({
  ready: (requestId: string) => invoke(EXPERIMENTAL_RUNTIME_CHANNELS.ready, envelope(requestId)),
  probe: (requestId: string, probe: ExperimentalRuntimeProbeV0) => {
    if (!isExperimentalRuntimeProbeV0(probe)) throw new Error('EXPERIMENTAL_RUNTIME_PROBE_INVALID');
    return invoke(EXPERIMENTAL_RUNTIME_CHANNELS.probe, { ...envelope(requestId), probe });
  },
  heartbeat: (requestId: string) => invoke(EXPERIMENTAL_RUNTIME_CHANNELS.heartbeat, envelope(requestId)),
  onAbort: (handler: (event: ExperimentalRuntimeAbortEnvelopeV0) => void): (() => void) => {
    if (typeof handler !== 'function') throw new Error('EXPERIMENTAL_RUNTIME_ABORT_HANDLER_INVALID');
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!isExperimentalRuntimeIdentityV0(value)) return;
      if (value.sessionToken !== sessionToken || value.runtimeGeneration !== runtimeGeneration) return;
      handler(Object.freeze({ ...value }));
    };
    ipcRenderer.on(EXPERIMENTAL_RUNTIME_CHANNELS.abort, listener);
    return () => ipcRenderer.removeListener(EXPERIMENTAL_RUNTIME_CHANNELS.abort, listener);
  },
  acknowledgeAbort: (requestId: string) => invoke(EXPERIMENTAL_RUNTIME_CHANNELS.abortAck, envelope(requestId)),
});

contextBridge.exposeInMainWorld('notoPluginRuntime', api);

