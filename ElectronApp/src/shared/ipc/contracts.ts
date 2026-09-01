import type { NotoError } from '../errors';
import type {
  PluginLifecycleAction,
  PluginLifecycleReply,
  PluginLifecycleRequest,
  PluginSnapshotEvent,
  RendererTransportAck,
  RendererTransportRequest,
  RendererReadyMessage,
  PluginLifecycleSnapshot,
} from '../plugins/lifecycle';

export const IPC_VERSION = 1 as const;
export const IPC_CHANNELS = {
  service: 'noto:v1:service',
  diagnostics: 'noto:v1:diagnostics',
  pluginLifecycle: 'noto:v1:plugins:lifecycle',
  pluginSnapshots: 'noto:v1:plugins:snapshots',
  pluginRendererRequest: 'noto:v1:plugins:renderer-request',
  pluginRendererAck: 'noto:v1:plugins:renderer-ack',
  pluginRendererReady: 'noto:v1:plugins:renderer-ready',
} as const;

export interface RequestBase {
  version: typeof IPC_VERSION;
  requestId: string;
}

export type Result<T> =
  | { ok: true; requestId: string; value: T }
  | { ok: false; requestId: string; error: NotoError };

export type ServiceAction =
  | 'grant-read'
  | 'read-granted'
  | 'deny-probe'
  | 'revoke-grant'
  | 'cancel-request';

interface ServiceRequestBase extends RequestBase {
  generation: number;
}

export type ServiceRequest =
  | (ServiceRequestBase & { action: 'grant-read' })
  | (ServiceRequestBase & { action: 'read-granted' | 'deny-probe'; grantId: string })
  | (ServiceRequestBase & { action: 'revoke-grant'; grantId: string })
  | (ServiceRequestBase & { action: 'cancel-request'; targetRequestId: string });

export type ServiceReply =
  | { state: 'granted'; grantId: string; root: string; generation: number }
  | { state: 'read'; sha256: string; size: number; generation: number }
  | { state: 'revoked'; grantId: string; generation: number }
  | { state: 'cancelled'; targetRequestId: string; generation: number };

export type ServiceOperationReply = ServiceReply & {
  action: ServiceAction;
  snapshot: PluginLifecycleSnapshot;
};

export interface DiagnosticsRequest extends RequestBase {}

export interface DiagnosticsReply {
  renderer: {
    consoleErrors: number;
    consoleWarnings: number;
  };
  service: {
    denials: number;
    dispatched: number;
    failures: number;
    grants: number;
    received: number;
    generation: number | null;
    state: 'failed' | 'starting' | 'stopping' | 'stopped' | 'ready';
    permissionProbe: 'failed' | 'passed' | 'pending';
  };
}

export interface NotoDesktopApi {
  requestService(request: ServiceRequest): Promise<Result<ServiceOperationReply>>;
  diagnostics(request: DiagnosticsRequest): Promise<Result<DiagnosticsReply>>;
  plugins: NotoPluginsApi;
}

type LifecycleRequestFor<TAction extends PluginLifecycleAction> = Omit<
  Extract<PluginLifecycleRequest, { action: TAction }>,
  'action'
>;

export interface NotoPluginsApi {
  getSnapshots(request: LifecycleRequestFor<'get-snapshots'>): Promise<Result<PluginLifecycleReply>>;
  enable(request: LifecycleRequestFor<'enable'>): Promise<Result<PluginLifecycleReply>>;
  disable(request: LifecycleRequestFor<'disable'>): Promise<Result<PluginLifecycleReply>>;
  triggerStartup(request: LifecycleRequestFor<'trigger-startup'>): Promise<Result<PluginLifecycleReply>>;
  triggerEvent(request: LifecycleRequestFor<'trigger-event'>): Promise<Result<PluginLifecycleReply>>;
  triggerHotkey(request: LifecycleRequestFor<'trigger-hotkey'>): Promise<Result<PluginLifecycleReply>>;
  executeCommand(request: LifecycleRequestFor<'execute-command'>): Promise<Result<PluginLifecycleReply>>;
  setSetting(request: LifecycleRequestFor<'set-setting'>): Promise<Result<PluginLifecycleReply>>;
  replaceGeneration(request: LifecycleRequestFor<'replace-generation'>): Promise<Result<PluginLifecycleReply>>;
  rendererDisposed(request: LifecycleRequestFor<'renderer-disposed'>): Promise<Result<PluginLifecycleReply>>;
  onSnapshots(listener: (event: PluginSnapshotEvent) => void): () => void;
  onRendererRequest(listener: (request: RendererTransportRequest) => void): () => void;
  acknowledgeRenderer(ack: RendererTransportAck): void;
  rendererReady(message: RendererReadyMessage): void;
}
