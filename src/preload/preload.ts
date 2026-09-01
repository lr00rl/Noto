import { contextBridge, ipcRenderer } from 'electron';
import type {
  DiagnosticsReply,
  DiagnosticsRequest,
  NotoPluginsApi,
  NotoDesktopApi,
  Result,
  ServiceOperationReply,
  ServiceRequest,
} from '../shared/ipc/contracts';
import { IPC_CHANNELS } from '../shared/ipc/contracts';
import {
  SETTINGS_CHANNELS,
  type NotoSettingsApiV1,
  type SettingsReplyV1,
  type SettingsRequestV1,
  type SettingsResultV1,
  type SettingsWriteRequestV1,
} from '../shared/settings/v1/contracts';
import {
  isSettingsReplyV1,
  isSettingsRequestV1,
  isSettingsResultV1,
  isThemeCssResultV1,
  isSettingsWriteRequestV1,
} from '../shared/settings/v1/validate';
import type {
  FileTruthBootstrapReplyV1,
  FileTruthRequestV1,
  FileTruthResultV1,
  FileTruthDiagnosticsV1,
  FileTruthOpenReplyV1,
  FileTruthSaveOutcomeV1,
  FileTruthSaveCopyRequestV1,
  FileTruthSaveRequestV1,
  NotoFileTruthApiV1,
} from '../shared/file-truth/v1/contracts';
import { FILE_TRUTH_CHANNELS } from '../shared/file-truth/v1/contracts';
import {
  isDiagnosticsRequest,
  isDiagnosticsResult,
  isPluginLifecycleRequest,
  isPluginLifecycleResult,
  isPluginSnapshotEvent,
  isServiceRequest,
  isServiceResult,
  isRendererTransportAck,
  isRendererTransportRequest,
  isRendererReadyMessage,
} from '../shared/ipc/validate';
import type {
  PluginLifecycleAction,
  PluginLifecycleReply,
  PluginLifecycleRequest,
  RendererReadyMessage,
  RendererTransportAck,
} from '../shared/plugins/lifecycle';
import {
  isFileTruthBootstrapResultV1,
  isFileTruthDiagnosticsResultV1,
  isFileTruthOpenResultV1,
  isFileTruthRequestV1,
  isFileTruthSaveCopyRequestV1,
  isFileTruthSaveRequestV1,
  isFileTruthSaveResultV1,
} from '../shared/file-truth/v1/validate';
import type {
  NotoWorkspaceApiV1,
  WorkspaceDocumentEventV1,
  WorkspaceMenuEventV1,
  WorkspaceOpenPathRequestV1,
  WorkspaceTabRequestV1,
  WorkspaceTabsEventV1,
  WorkspaceClosedEventV1,
  WorkspaceFolderRequestV1,
  WorkspaceFolderEventV1,
  WorkspaceFolderReplyV1,
  WorkspaceOpenReplyV1,
  WorkspaceRecentReplyV1,
  WorkspaceRequestV1,
  WorkspaceResultV1,
  WorkspaceSaveAsReplyV1,
} from '../shared/workspace/v1/contracts';
import { WORKSPACE_CHANNELS } from '../shared/workspace/v1/contracts';
import {
  isWorkspaceDocumentEventV1,
  isWorkspaceMenuEventV1,
  isWorkspaceOpenPathRequestV1,
  isWorkspaceTabRequestV1,
  isWorkspaceTabsEventV1,
  isWorkspaceTabsResultV1,
  isWorkspaceClosedEventV1,
  isWorkspaceFolderRequestV1,
  isWorkspaceFolderEventV1,
  isWorkspaceFolderResultV1,
  isWorkspaceListResultV1,
  isWorkspaceOpenResultV1,
  isWorkspaceRecentResultV1,
  isWorkspaceRequestV1,
  isWorkspaceSaveAsResultV1,
} from '../shared/workspace/v1/validate';

function rejected<T>(requestId: string, message: string): Result<T> {
  return { ok: false, requestId, error: { code: 'BAD_REQUEST', message } };
}

async function invoke<T>(
  channel: string,
  request: unknown,
  requestId: string,
  validate: (value: unknown, expectedRequestId: string) => value is Result<T>,
): Promise<Result<T>> {
  const value: unknown = await ipcRenderer.invoke(channel, request);
  if (!validate(value, requestId)) {
    return rejected(requestId, 'Main returned an invalid protocol response');
  }
  return value;
}

async function invokePlugin(
  request: PluginLifecycleRequest,
): Promise<Result<PluginLifecycleReply>> {
  if (!isPluginLifecycleRequest(request)) {
    return rejected('invalid', 'Invalid plugin lifecycle request');
  }
  const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginLifecycle, request);
  return isPluginLifecycleResult(value, request.requestId, request.action)
    ? value
    : rejected(request.requestId, 'Main returned an invalid plugin lifecycle response');
}

const lifecycleRequest = <TAction extends PluginLifecycleAction>(
  action: TAction,
  request: object,
): PluginLifecycleRequest => ({ ...request, action }) as PluginLifecycleRequest;

const pluginsApi: NotoPluginsApi = Object.freeze({
  getSnapshots: (request: Parameters<NotoPluginsApi['getSnapshots']>[0]) =>
    invokePlugin(lifecycleRequest('get-snapshots', request)),
  enable: (request: Parameters<NotoPluginsApi['enable']>[0]) =>
    invokePlugin(lifecycleRequest('enable', request)),
  disable: (request: Parameters<NotoPluginsApi['disable']>[0]) =>
    invokePlugin(lifecycleRequest('disable', request)),
  triggerStartup: (request: Parameters<NotoPluginsApi['triggerStartup']>[0]) =>
    invokePlugin(lifecycleRequest('trigger-startup', request)),
  triggerEvent: (request: Parameters<NotoPluginsApi['triggerEvent']>[0]) =>
    invokePlugin(lifecycleRequest('trigger-event', request)),
  triggerHotkey: (request: Parameters<NotoPluginsApi['triggerHotkey']>[0]) =>
    invokePlugin(lifecycleRequest('trigger-hotkey', request)),
  executeCommand: (request: Parameters<NotoPluginsApi['executeCommand']>[0]) =>
    invokePlugin(lifecycleRequest('execute-command', request)),
  setSetting: (request: Parameters<NotoPluginsApi['setSetting']>[0]) =>
    invokePlugin(lifecycleRequest('set-setting', request)),
  replaceGeneration: (request: Parameters<NotoPluginsApi['replaceGeneration']>[0]) =>
    invokePlugin(lifecycleRequest('replace-generation', request)),
  rendererDisposed: (request: Parameters<NotoPluginsApi['rendererDisposed']>[0]) =>
    invokePlugin(lifecycleRequest('renderer-disposed', request)),
  onSnapshots: (listener: Parameters<NotoPluginsApi['onSnapshots']>[0]) => {
    const receive = (_event: unknown, value: unknown) => {
      if (isPluginSnapshotEvent(value)) listener(value);
    };
    ipcRenderer.on(IPC_CHANNELS.pluginSnapshots, receive);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.pluginSnapshots, receive); };
  },
  onRendererRequest: (listener: Parameters<NotoPluginsApi['onRendererRequest']>[0]) => {
    const receive = (_event: unknown, value: unknown) => {
      if (isRendererTransportRequest(value)) listener(value);
    };
    ipcRenderer.on(IPC_CHANNELS.pluginRendererRequest, receive);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.pluginRendererRequest, receive); };
  },
  acknowledgeRenderer: (ack: RendererTransportAck) => {
    if (!isRendererTransportAck(ack)) return;
    ipcRenderer.send(IPC_CHANNELS.pluginRendererAck, ack);
  },
  rendererReady: (message: RendererReadyMessage) => {
    if (!isRendererReadyMessage(message)) return;
    ipcRenderer.send(IPC_CHANNELS.pluginRendererReady, message);
  },
});

const api: NotoDesktopApi = Object.freeze({
  requestService: (request: ServiceRequest): Promise<Result<ServiceOperationReply>> =>
    isServiceRequest(request)
      ? invoke(IPC_CHANNELS.service, request, request.requestId, isServiceResult)
      : Promise.resolve(rejected('invalid', 'Invalid service request')),
  diagnostics: (request: DiagnosticsRequest): Promise<Result<DiagnosticsReply>> =>
    isDiagnosticsRequest(request)
      ? invoke(IPC_CHANNELS.diagnostics, request, request.requestId, isDiagnosticsResult)
      : Promise.resolve(rejected('invalid', 'Invalid diagnostics request')),
  plugins: pluginsApi,
});

contextBridge.exposeInMainWorld('notoDesktop', api);

function rejectedFileTruth<T>(requestId: string, message: string): FileTruthResultV1<T> {
  return { ok: false, requestId, error: { code: 'BAD_REQUEST', message } };
}

async function invokeFileTruth<T>(channel: string, request: unknown, requestId: string,
  validate: (value: unknown, expectedRequestId: string) => value is FileTruthResultV1<T>): Promise<FileTruthResultV1<T>> {
  const value: unknown = await ipcRenderer.invoke(channel, request);
  return validate(value, requestId) ? value : rejectedFileTruth(requestId, 'Main returned an invalid file-truth v1 response');
}

const fileTruthApi: NotoFileTruthApiV1 = Object.freeze({
  bootstrap: (request: FileTruthRequestV1) => isFileTruthRequestV1(request)
    ? invokeFileTruth<FileTruthBootstrapReplyV1>(FILE_TRUTH_CHANNELS.bootstrap, request, request.requestId, isFileTruthBootstrapResultV1)
    : Promise.resolve(rejectedFileTruth<FileTruthBootstrapReplyV1>('invalid', 'Invalid file-truth bootstrap request')),
  open: (request: FileTruthRequestV1) => isFileTruthRequestV1(request)
    ? invokeFileTruth<FileTruthOpenReplyV1>(FILE_TRUTH_CHANNELS.open, request, request.requestId, isFileTruthOpenResultV1)
    : Promise.resolve(rejectedFileTruth<FileTruthOpenReplyV1>('invalid', 'Invalid file-truth open request')),
  save: (request: FileTruthSaveRequestV1) => isFileTruthSaveRequestV1(request)
    ? invokeFileTruth<FileTruthSaveOutcomeV1>(FILE_TRUTH_CHANNELS.save, request, request.requestId, isFileTruthSaveResultV1)
    : Promise.resolve(rejectedFileTruth<FileTruthSaveOutcomeV1>('invalid', 'Invalid file-truth save request')),
  saveCopy: (request: FileTruthSaveCopyRequestV1) => isFileTruthSaveCopyRequestV1(request)
    ? invokeFileTruth<FileTruthSaveOutcomeV1>(FILE_TRUTH_CHANNELS.saveCopy, request, request.requestId, isFileTruthSaveResultV1)
    : Promise.resolve(rejectedFileTruth<FileTruthSaveOutcomeV1>('invalid', 'Invalid file-truth save-copy request')),
  recover: (request: FileTruthRequestV1) => isFileTruthRequestV1(request)
    ? invokeFileTruth<FileTruthSaveOutcomeV1>(FILE_TRUTH_CHANNELS.recover, request, request.requestId, isFileTruthSaveResultV1)
    : Promise.resolve(rejectedFileTruth<FileTruthSaveOutcomeV1>('invalid', 'Invalid file-truth recovery request')),
  diagnostics: (request: FileTruthRequestV1) => isFileTruthRequestV1(request)
    ? invokeFileTruth<FileTruthDiagnosticsV1>(FILE_TRUTH_CHANNELS.diagnostics, request, request.requestId, isFileTruthDiagnosticsResultV1)
    : Promise.resolve(rejectedFileTruth<FileTruthDiagnosticsV1>('invalid', 'Invalid file-truth diagnostics request')),
});

contextBridge.exposeInMainWorld('notoFileTruth', fileTruthApi);

function rejectedWorkspace<T>(requestId: string, message: string): WorkspaceResultV1<T> {
  return { ok: false, requestId, error: { code: 'BAD_REQUEST', message } };
}

async function invokeWorkspace<T>(channel: string, request: unknown, requestId: string,
  validate: (value: unknown, expectedRequestId: string) => value is WorkspaceResultV1<T>): Promise<WorkspaceResultV1<T>> {
  const value: unknown = await ipcRenderer.invoke(channel, request);
  return validate(value, requestId) ? value : rejectedWorkspace(requestId, 'Main returned an invalid workspace response');
}

/**
 * Push channels validate before invoking the listener, so a malformed message
 * from a compromised main process cannot reach renderer state.
 */
function subscribe<T>(channel: string, guard: (value: unknown) => value is T, listener: (event: T) => void): () => void {
  const handler = (_event: unknown, value: unknown) => {
    if (guard(value)) listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

function rejectedSettings(requestId: string, message: string): SettingsResultV1<SettingsReplyV1> {
  return { ok: false, requestId, error: { code: 'BAD_REQUEST', message } };
}

async function invokeSettings(channel: string, request: unknown, requestId: string): Promise<SettingsResultV1<SettingsReplyV1>> {
  const value: unknown = await ipcRenderer.invoke(channel, request);
  return isSettingsResultV1(value, requestId)
    ? value
    : rejectedSettings(requestId, 'Main returned an invalid settings response');
}

const workspaceApi: NotoWorkspaceApiV1 = Object.freeze({
  openDialog: (request: WorkspaceRequestV1) => isWorkspaceRequestV1(request)
    ? invokeWorkspace<WorkspaceOpenReplyV1>(WORKSPACE_CHANNELS.openDialog, request, request.requestId, isWorkspaceOpenResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceOpenReplyV1>('invalid', 'Invalid workspace open request')),
  openPath: (request: WorkspaceOpenPathRequestV1) => isWorkspaceOpenPathRequestV1(request)
    ? invokeWorkspace<WorkspaceOpenReplyV1>(WORKSPACE_CHANNELS.openPath, request, request.requestId, isWorkspaceOpenResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceOpenReplyV1>('invalid', 'Invalid workspace open-path request')),
  saveAsDialog: (request: WorkspaceRequestV1) => isWorkspaceRequestV1(request)
    ? invokeWorkspace<WorkspaceSaveAsReplyV1>(WORKSPACE_CHANNELS.saveAsDialog, request, request.requestId, isWorkspaceSaveAsResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceSaveAsReplyV1>('invalid', 'Invalid workspace save-as request')),
  recent: (request: WorkspaceRequestV1) => isWorkspaceRequestV1(request)
    ? invokeWorkspace<WorkspaceRecentReplyV1>(WORKSPACE_CHANNELS.recent, request, request.requestId, isWorkspaceRecentResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceRecentReplyV1>('invalid', 'Invalid workspace recent request')),
  activateTab: (request: WorkspaceTabRequestV1) => isWorkspaceTabRequestV1(request)
    ? invokeWorkspace<WorkspaceOpenReplyV1>(WORKSPACE_CHANNELS.activateTab, request, request.requestId, isWorkspaceOpenResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceOpenReplyV1>('invalid', 'Invalid workspace activate-tab request')),
  closeTab: (request: WorkspaceTabRequestV1) => isWorkspaceTabRequestV1(request)
    ? invokeWorkspace<WorkspaceTabsEventV1>(WORKSPACE_CHANNELS.closeTab, request, request.requestId, isWorkspaceTabsResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceTabsEventV1>('invalid', 'Invalid workspace close-tab request')),
  openFolder: (request: WorkspaceRequestV1) => isWorkspaceRequestV1(request)
    ? invokeWorkspace<WorkspaceFolderEventV1>(WORKSPACE_CHANNELS.openFolder, request, request.requestId, isWorkspaceFolderResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceFolderEventV1>('invalid', 'Invalid workspace open-folder request')),
  listFolder: (request: WorkspaceFolderRequestV1) => isWorkspaceFolderRequestV1(request)
    ? invokeWorkspace<WorkspaceFolderReplyV1>(WORKSPACE_CHANNELS.listFolder, request, request.requestId, isWorkspaceListResultV1)
    : Promise.resolve(rejectedWorkspace<WorkspaceFolderReplyV1>('invalid', 'Invalid workspace list-folder request')),
  onFolderChanged: (listener: (event: WorkspaceFolderEventV1) => void) =>
    subscribe(WORKSPACE_CHANNELS.folderChanged, isWorkspaceFolderEventV1, listener),
  onDocumentOpened: (listener: (event: WorkspaceDocumentEventV1) => void) =>
    subscribe(WORKSPACE_CHANNELS.documentOpened, isWorkspaceDocumentEventV1, listener),
  onDocumentClosed: (listener: (event: WorkspaceClosedEventV1) => void) =>
    subscribe(WORKSPACE_CHANNELS.documentClosed, isWorkspaceClosedEventV1, listener),
  onTabsChanged: (listener: (event: WorkspaceTabsEventV1) => void) =>
    subscribe(WORKSPACE_CHANNELS.tabsChanged, isWorkspaceTabsEventV1, listener),
  onMenuCommand: (listener: (event: WorkspaceMenuEventV1) => void) =>
    subscribe(WORKSPACE_CHANNELS.menuCommand, isWorkspaceMenuEventV1, listener),
});

const settingsApi: NotoSettingsApiV1 = Object.freeze({
  read: (request: SettingsRequestV1) => isSettingsRequestV1(request)
    ? invokeSettings(SETTINGS_CHANNELS.read, request, request.requestId)
    : Promise.resolve(rejectedSettings('invalid', 'Invalid settings read request')),
  write: (request: SettingsWriteRequestV1) => isSettingsWriteRequestV1(request)
    ? invokeSettings(SETTINGS_CHANNELS.write, request, request.requestId)
    : Promise.resolve(rejectedSettings('invalid', 'Invalid settings write request')),
  readThemeCss: async (request: SettingsRequestV1) => {
    if (!isSettingsRequestV1(request)) {
      return { ok: false as const, requestId: 'invalid',
        error: { code: 'BAD_REQUEST', message: 'Invalid theme stylesheet request' } };
    }
    const value: unknown = await ipcRenderer.invoke(SETTINGS_CHANNELS.themeCss, request);
    return isThemeCssResultV1(value, request.requestId)
      ? value
      : { ok: false as const, requestId: request.requestId,
        error: { code: 'BAD_REQUEST', message: 'Main returned an invalid theme stylesheet response' } };
  },
  onChanged: (listener: (event: SettingsReplyV1) => void) =>
    subscribe(SETTINGS_CHANNELS.changed, isSettingsReplyV1, listener),
});

contextBridge.exposeInMainWorld('notoWorkspace', workspaceApi);
contextBridge.exposeInMainWorld('notoSettings', settingsApi);

/**
 * The user's home directory, used only to shorten a displayed path to a leading
 * tilde in the status bar.
 *
 * It is a string the window already effectively knows from any file it has
 * open, so showing it reveals nothing, and it never reaches the document. The
 * platform itself is not exposed here: bootstrap already reports it, validated,
 * and one source for it is enough.
 */
contextBridge.exposeInMainWorld('notoPlatform', Object.freeze({
  home: process.env.HOME ?? process.env.USERPROFILE ?? '',
}));
