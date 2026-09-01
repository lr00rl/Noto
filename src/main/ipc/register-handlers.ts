import { ipcMain, type BrowserWindow } from 'electron';
import { NOTO_ERROR_CODES, type NotoErrorCode } from '../../shared/errors';
import type {
  DiagnosticsReply,
  Result,
  ServiceOperationReply,
} from '../../shared/ipc/contracts';
import { IPC_CHANNELS } from '../../shared/ipc/contracts';
import {
  isDiagnosticsRequest,
  isDiagnosticsResult,
  isPluginLifecycleRequest,
  isPluginLifecycleResult,
  isServiceRequest,
  isServiceResult,
  isRendererTransportAck,
  isRendererReadyMessage,
} from '../../shared/ipc/validate';
import {
  PLUGIN_LIFECYCLE_VERSION,
  type PluginLifecycleReply,
  type PluginLifecycleRequest,
} from '../../shared/plugins/lifecycle';
import type { StructuredLogger } from '../logger';
import type { ServiceHost } from '../plugins/service-host';
import type { PluginRegistry } from '../plugins/plugin-registry';
import type { RendererLeaseBridge } from '../plugins/renderer-lease-bridge';
import type { RendererConsoleState } from '../windows/create-editor-window';
import { isTrustedRendererSender } from './trusted-renderer';

interface HandlerDependencies {
  getWindow: () => BrowserWindow | null;
  logger: StructuredLogger;
  rendererConsole: RendererConsoleState;
  pluginRegistry: PluginRegistry;
  rendererLeaseBridge: RendererLeaseBridge;
  serviceHost: ServiceHost;
}

function errorCode(error: unknown, fallback: NotoErrorCode): NotoErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  const candidate = message.split(':', 1)[0] as NotoErrorCode;
  return NOTO_ERROR_CODES.includes(candidate) ? candidate : fallback;
}

function pluginErrorCode(error: unknown): NotoErrorCode {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.startsWith('PLUGIN_UNKNOWN')) return 'PLUGIN_UNKNOWN';
  if (detail.startsWith('PLUGIN_NOT_HYDRATED')) return 'PLUGIN_NOT_HYDRATED';
  if (detail.includes('RENDERER_DISPOSED')) return 'PLUGIN_RENDERER_DISPOSED';
  if (detail.includes('CLEANUP') || detail.includes('SHUTDOWN_FAILED')) return 'PLUGIN_CLEANUP_FAILED';
  if (detail.includes('STALE') || detail.includes('LEASE_')) return 'PLUGIN_STALE';
  if (detail.includes('GENERATION')) return 'PLUGIN_GENERATION_FAILED';
  return 'PLUGIN_FAILED';
}

function failed<T>(requestId: string, error: unknown, fallback: NotoErrorCode): Result<T> {
  if (fallback === 'PLUGIN_FAILED') {
    const code = pluginErrorCode(error);
    return { ok: false, requestId, error: { code, message: `${code}: Plugin lifecycle request failed` } };
  }
  const code = errorCode(error, fallback);
  return { ok: false, requestId, error: { code, message: publicErrorMessage(code) } };
}

function publicErrorMessage(code: NotoErrorCode): string {
  switch (code) {
    case 'CAPABILITY_DENIED': return 'CAPABILITY_DENIED: The requested access is not granted.';
    case 'SERVICE_CANCELLED': return 'SERVICE_CANCELLED: The service request was cancelled.';
    case 'TIMEOUT': return 'TIMEOUT: The service request timed out.';
    case 'PLUGIN_STALE': return 'PLUGIN_STALE: The plugin generation or request is no longer current.';
    case 'BAD_REQUEST': return 'BAD_REQUEST: The request is invalid or was already used.';
    default: return `${code}: The operation failed.`;
  }
}

function accepted<T>(requestId: string, value: T): Result<T> {
  return { ok: true, requestId, value };
}

export function registerIpcHandlers(deps: HandlerDependencies): void {
  const handle = <TRequest, TReply>(
    channel: string,
    validateRequest: (value: unknown) => value is TRequest,
    validateResult: (
      value: unknown,
      requestId: string,
      request: TRequest,
    ) => value is Result<TReply>,
    fallbackCode: NotoErrorCode,
    operation: (request: TRequest) => Promise<TReply> | TReply,
  ): void => {
    ipcMain.handle(channel, async (event, value: unknown) => {
      const requestId = typeof value === 'object' && value !== null && 'requestId' in value
        ? String((value as { requestId: unknown }).requestId).slice(0, 96)
        : 'invalid';
      if (!isTrustedRendererSender(deps.getWindow(), event)) {
        deps.logger.log('ipc_sender_rejected', { channel });
        return failed(requestId, new Error('IPC_SENDER_REJECTED: sender frame or origin did not match'), fallbackCode);
      }
      if (!validateRequest(value)) {
        deps.logger.log('ipc_request_rejected', { channel, requestId });
        return failed(requestId, new Error('BAD_REQUEST: runtime validation failed'), fallbackCode);
      }
      try {
        const result = accepted(requestId, await operation(value));
        if (!validateResult(result, requestId, value)) {
          deps.logger.log('ipc_reply_rejected', { channel, requestId, code: fallbackCode });
          return failed(requestId, new Error(`${fallbackCode}: main produced an invalid reply`), fallbackCode);
        }
        return result;
      } catch (error) {
        const code = errorCode(error, fallbackCode);
        deps.logger.log('ipc_operation_failed', { channel, requestId, code });
        return failed(requestId, error, fallbackCode);
      }
    });
  };

  ipcMain.on(IPC_CHANNELS.pluginRendererAck, (event, value: unknown) => {
    if (!isTrustedRendererSender(deps.getWindow(), event)) {
      deps.logger.log('ipc_sender_rejected', { channel: IPC_CHANNELS.pluginRendererAck });
      return;
    }
    if (!isRendererTransportAck(value) || !deps.rendererLeaseBridge.acknowledge(value)) {
      deps.logger.log('plugin_renderer_ack_rejected', { reason: 'malformed-stale-or-duplicate' });
    }
  });
  ipcMain.on(IPC_CHANNELS.pluginRendererReady, (event, value: unknown) => {
    if (!isTrustedRendererSender(deps.getWindow(), event) || !isRendererReadyMessage(value)) {
      deps.logger.log('ipc_sender_rejected', { channel: IPC_CHANNELS.pluginRendererReady });
      return;
    }
    const displaced = deps.rendererLeaseBridge.rendererReady(value.rendererSessionId);
    for (const lease of displaced) {
      void deps.pluginRegistry.rendererDisposed(lease.pluginId, lease.leaseId, lease.generation)
        .catch((error) => deps.logger.log('plugin_renderer_disposal_failed', {
          code: pluginErrorCode(error),
        }));
    }
  });

  handle(IPC_CHANNELS.service, isServiceRequest, isServiceResult, 'SERVICE_FAILED', async (request): Promise<ServiceOperationReply> => {
    const outcome = await deps.pluginRegistry.performServiceOperation(request);
    return { ...outcome.reply, action: request.action, snapshot: outcome.snapshot };
  });
  handle(IPC_CHANNELS.diagnostics, isDiagnosticsRequest, isDiagnosticsResult, 'SERVICE_FAILED', (): DiagnosticsReply => ({
    renderer: {
      consoleErrors: deps.rendererConsole.errors,
      consoleWarnings: deps.rendererConsole.warnings,
    },
    service: {
      denials: deps.serviceHost.brokerCounters.denials,
      dispatched: deps.serviceHost.counters.dispatched,
      failures: deps.serviceHost.counters.failures,
      grants: deps.serviceHost.brokerCounters.grants,
      received: deps.serviceHost.counters.received,
      generation: deps.serviceHost.readyGeneration,
      state: deps.serviceHost.state,
      permissionProbe: deps.serviceHost.permissionProbe,
    },
  }));

  handle(
    IPC_CHANNELS.pluginLifecycle,
    isPluginLifecycleRequest,
    (result, requestId, request) => isPluginLifecycleResult(
      result,
      requestId,
      request.action,
    ),
    'PLUGIN_FAILED',
    async (request: PluginLifecycleRequest): Promise<PluginLifecycleReply> => {
      let handled: boolean | null = null;
      switch (request.action) {
        case 'get-snapshots':
          break;
        case 'enable':
          await deps.pluginRegistry.enable(request.pluginId);
          break;
        case 'disable':
          await deps.pluginRegistry.disable(request.pluginId);
          break;
        case 'trigger-startup':
          await deps.pluginRegistry.triggerStartup();
          break;
        case 'trigger-event':
          await deps.pluginRegistry.triggerEvent(request.event);
          break;
        case 'trigger-hotkey':
          handled = await deps.pluginRegistry.triggerHotkey(request.keys);
          break;
        case 'execute-command':
          handled = await deps.pluginRegistry.executeCommand(request.pluginId, request.commandId);
          break;
        case 'set-setting':
          await deps.pluginRegistry.setSetting(request.pluginId, request.key, request.value);
          break;
        case 'replace-generation':
          await deps.pluginRegistry.replaceGeneration(request.pluginId, request.reason);
          break;
        case 'renderer-disposed':
          await deps.pluginRegistry.rendererDisposed(
            request.pluginId,
            request.leaseId,
            request.generation,
          );
          break;
      }
      return {
        version: PLUGIN_LIFECYCLE_VERSION,
        action: request.action,
        snapshots: deps.pluginRegistry.getSnapshots(),
        handled,
      };
    },
  );
}
