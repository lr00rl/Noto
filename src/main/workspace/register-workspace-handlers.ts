/**
 * Workspace IPC.
 *
 * Same shape as the other handler modules: reject untrusted senders, validate
 * the request, and never let an exception escape as an unhandled rejection.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import {
  NOTO_WORKSPACE_VERSION,
  WORKSPACE_CHANNELS,
  type WorkspaceOpenPathRequestV1,
  type WorkspaceRequestV1,
  type WorkspaceResultV1,
  type WorkspaceTabRequestV1,
  type WorkspaceFolderRequestV1,
  type RecentFileV1,
  type WorkspaceOpenExternalRequestV1,
  type WorkspaceRevealRequestV1,
  type WorkspaceContentRequestV1,
} from '../../shared/workspace/v1/contracts';
import {
  isWorkspaceOpenPathRequestV1,
  isWorkspaceRequestV1,
  isWorkspaceTabRequestV1,
  isWorkspaceFolderRequestV1,
  isWorkspaceOpenExternalRequestV1,
  isWorkspaceRevealRequestV1,
  isWorkspaceContentRequestV1,
} from '../../shared/workspace/v1/validate';
import { isTrustedRendererSender } from '../ipc/trusted-renderer';
import type { StructuredLogger } from '../logger';
import type { RecentFiles } from './recent-files';
import type { WorkspaceSession } from './session';

export function registerWorkspaceHandlers(deps: {
  session: WorkspaceSession;
  recent: RecentFiles;
  getWindow: () => BrowserWindow | null;
  logger: StructuredLogger;
  onRecentChanged: () => void;
  /** The folders opened before, read at call time so the list is current. */
  recentFolders: () => Promise<readonly RecentFileV1[]>;
}): void {
  const register = <TRequest extends { requestId: string }, TReply>(
    channel: string,
    validate: (value: unknown) => value is TRequest,
    operation: (request: TRequest) => Promise<TReply> | TReply,
  ) => {
    ipcMain.handle(channel, async (event, value: unknown): Promise<WorkspaceResultV1<TReply>> => {
      const candidateId = typeof value === 'object' && value !== null && 'requestId' in value
        ? String((value as { requestId: unknown }).requestId).slice(0, 96)
        : 'invalid';
      if (!isTrustedRendererSender(deps.getWindow(), event) || !validate(value)) {
        deps.logger.log('workspace_ipc_rejected', { channel, requestId: candidateId });
        return { ok: false, requestId: candidateId, error: { code: 'BAD_REQUEST', message: 'Workspace request validation failed.' } };
      }
      try {
        return { ok: true, requestId: value.requestId, value: await operation(value) };
      } catch (error) {
        deps.logger.log('workspace_operation_failed', { channel, requestId: value.requestId });
        return {
          ok: false,
          requestId: value.requestId,
          error: {
            code: 'WORKSPACE_FAILED',
            message: error instanceof Error ? error.message.slice(0, 2048) : 'The workspace operation failed.',
          },
        };
      }
    });
  };

  register(WORKSPACE_CHANNELS.openFolder, isWorkspaceRequestV1,
    () => deps.session.openFolderWithDialog());

  register(WORKSPACE_CHANNELS.listFolder, isWorkspaceFolderRequestV1,
    (request: WorkspaceFolderRequestV1) => deps.session.listFolder(request.path));

  register(WORKSPACE_CHANNELS.fileIndex, isWorkspaceRequestV1,
    () => deps.session.fileIndex());

  register(WORKSPACE_CHANNELS.recentFolders, isWorkspaceRequestV1,
    async () => ({ version: NOTO_WORKSPACE_VERSION, files: await deps.recentFolders() } as const));

  register(WORKSPACE_CHANNELS.openRecentFolder, isWorkspaceOpenPathRequestV1,
    (request: WorkspaceOpenPathRequestV1) => deps.session.openFolderPath(request.path));

  register(WORKSPACE_CHANNELS.folder, isWorkspaceRequestV1,
    () => deps.session.currentFolder());

  register(WORKSPACE_CHANNELS.reveal, isWorkspaceRevealRequestV1,
    (request: WorkspaceRevealRequestV1) => deps.session.reveal(request.target));

  register(WORKSPACE_CHANNELS.openExternal, isWorkspaceOpenExternalRequestV1,
    (request: WorkspaceOpenExternalRequestV1) => deps.session.openExternal(request.url));

  register(WORKSPACE_CHANNELS.searchContent, isWorkspaceContentRequestV1,
    (request: WorkspaceContentRequestV1) => deps.session.searchContent(request.query));

  register(WORKSPACE_CHANNELS.activateTab, isWorkspaceTabRequestV1,
    (request: WorkspaceTabRequestV1) => {
      const opened = deps.session.activate(request.path);
      // A tab that is not open is not an error worth failing the call over; the
      // renderer's list was simply a moment out of date.
      return { version: NOTO_WORKSPACE_VERSION, opened } as const;
    });

  register(WORKSPACE_CHANNELS.closeTab, isWorkspaceTabRequestV1,
    (request: WorkspaceTabRequestV1) => {
      deps.session.close(request.path);
      return { version: NOTO_WORKSPACE_VERSION, tabs: deps.session.tabs() } as const;
    });

  register(WORKSPACE_CHANNELS.openDialog, isWorkspaceRequestV1, async () => {
    const opened = await deps.session.openWithDialog();
    if (opened) deps.onRecentChanged();
    return { version: NOTO_WORKSPACE_VERSION, opened } as const;
  });

  register(WORKSPACE_CHANNELS.openPath, isWorkspaceOpenPathRequestV1,
    async (request: WorkspaceOpenPathRequestV1) => {
      const opened = await deps.session.openPath(request.path);
      deps.onRecentChanged();
      return { version: NOTO_WORKSPACE_VERSION, opened } as const;
    });

  register(WORKSPACE_CHANNELS.saveAsDialog, isWorkspaceRequestV1, async () => ({
    version: NOTO_WORKSPACE_VERSION,
    path: await deps.session.saveAsWithDialog(),
  } as const));

  register(WORKSPACE_CHANNELS.recent, isWorkspaceRequestV1, async (_request: WorkspaceRequestV1) => {
    await deps.recent.load();
    return { version: NOTO_WORKSPACE_VERSION, files: deps.recent.list() } as const;
  });
}
