/**
 * Settings IPC.
 *
 * Same shape as the other handler modules: reject untrusted senders, validate
 * the request, and never let an exception escape as an unhandled rejection.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import {
  NOTO_SETTINGS_VERSION,
  SETTINGS_CHANNELS,
  type SettingsReplyV1,
  type SettingsResultV1,
  type SettingsWriteRequestV1,
} from '../../shared/settings/v1/contracts';
import {
  isSettingsRequestV1,
  isSettingsWriteRequestV1,
} from '../../shared/settings/v1/validate';
import { isTrustedRendererSender } from '../ipc/trusted-renderer';
import type { StructuredLogger } from '../logger';
import type { SettingsStore } from './settings-store';

export function registerSettingsHandlers(deps: {
  settings: SettingsStore;
  getWindow: () => BrowserWindow | null;
  logger: StructuredLogger;
  /** Called after a successful write, so main can react to a changed setting. */
  onChanged: (settings: SettingsReplyV1) => void;
}): void {
  const register = <TRequest extends { requestId: string }>(
    channel: string,
    validate: (value: unknown) => value is TRequest,
    operation: (request: TRequest) => Promise<SettingsReplyV1>,
  ) => {
    ipcMain.handle(channel, async (event, value: unknown): Promise<SettingsResultV1<SettingsReplyV1>> => {
      const candidateId = typeof value === 'object' && value !== null && 'requestId' in value
        ? String((value as { requestId: unknown }).requestId).slice(0, 96)
        : 'invalid';
      if (!isTrustedRendererSender(deps.getWindow(), event) || !validate(value)) {
        deps.logger.log('settings_ipc_rejected', { channel, requestId: candidateId });
        return {
          ok: false,
          requestId: candidateId,
          error: { code: 'BAD_REQUEST', message: 'Settings request validation failed.' },
        };
      }
      try {
        return { ok: true, requestId: value.requestId, value: await operation(value) };
      } catch (error) {
        deps.logger.log('settings_operation_failed', { channel, requestId: value.requestId });
        return {
          ok: false,
          requestId: value.requestId,
          error: {
            code: 'SETTINGS_FAILED',
            message: error instanceof Error ? error.message.slice(0, 2048) : 'The settings operation failed.',
          },
        };
      }
    });
  };

  register(SETTINGS_CHANNELS.read, isSettingsRequestV1, async () => ({
    version: NOTO_SETTINGS_VERSION,
    settings: await deps.settings.load(),
  }));

  register(SETTINGS_CHANNELS.write, isSettingsWriteRequestV1, async (request: SettingsWriteRequestV1) => {
    const reply: SettingsReplyV1 = {
      version: NOTO_SETTINGS_VERSION,
      settings: await deps.settings.update(request.patch),
    };
    deps.onChanged(reply);
    // Every window is told, so a setting changed in one is not stale in another.
    const window = deps.getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(SETTINGS_CHANNELS.changed, reply);
    }
    return reply;
  });
}
