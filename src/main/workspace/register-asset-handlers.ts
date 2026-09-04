/**
 * Asset IPC.
 *
 * The same shape as the other handler modules: refuse an untrusted sender,
 * validate the request, and never let an exception escape as an unhandled
 * rejection. The only unusual part is that the reply says why it refused, and
 * the renderer shows that reason, because "nothing happened when I pasted" is
 * the failure this feature has to avoid above all others.
 */

import { dialog, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { uploadThroughPicGo } from './picgo-upload';
import {
  ASSET_CHANNELS,
  IMAGE_EXTENSIONS,
  MAX_ASSET_BYTES,
  NOTO_ASSETS_VERSION,
  type AssetRequestV1,
  type AssetResultV1,
  type AssetTestUploadReplyV1,
  type AssetWriteReplyV1,
  type AssetWriteRequestV1,
} from '../../shared/assets/v1/contracts';
import { isAssetRequestV1, isAssetWriteRequestV1 } from '../../shared/assets/v1/validate';
import type { NotoSettingsV1 } from '../../shared/settings/v1/contracts';
import { isTrustedRendererSender } from '../ipc/trusted-renderer';
import type { StructuredLogger } from '../logger';
import { writeAsset } from './asset-store';
import type { WorkspaceSession } from './session';

export function registerAssetHandlers(deps: {
  session: WorkspaceSession;
  settings: () => NotoSettingsV1;
  getWindow: () => BrowserWindow | null;
  logger: StructuredLogger;
}): void {
  const write = (bytes: Uint8Array): Promise<AssetWriteReplyV1> => writeAsset(bytes, {
    documentPath: deps.session.currentPath,
    roots: deps.session.imageRoots(),
    settings: deps.settings(),
    realpath,
    now: () => new Date(),
    upload: (absolutePath) => uploadThroughPicGo(absolutePath, { fetch }),
  });

  const register = <TRequest extends { requestId: string }, TReply>(
    channel: string,
    validate: (value: unknown) => value is TRequest,
    operation: (request: TRequest) => Promise<TReply>,
    describe: (reply: TReply) => string,
  ) => {
    ipcMain.handle(channel, async (event, value: unknown): Promise<AssetResultV1<TReply>> => {
      const candidateId = typeof value === 'object' && value !== null && 'requestId' in value
        ? String((value as { requestId: unknown }).requestId).slice(0, 96)
        : 'invalid';
      if (!isTrustedRendererSender(deps.getWindow(), event) || !validate(value)) {
        deps.logger.log('asset_ipc_rejected', { channel, requestId: candidateId });
        return { ok: false, requestId: candidateId, error: { code: 'BAD_REQUEST', message: 'Asset request validation failed.' } };
      }
      try {
        const reply = await operation(value);
        // The outcome, never the path: a refusal often names a folder outside
        // the vault and that folder is the reader's business, not the log's.
        deps.logger.log('asset_operation', { channel, outcome: describe(reply) });
        return { ok: true, requestId: value.requestId, value: reply };
      } catch (error) {
        deps.logger.log('asset_operation_failed', { channel, requestId: value.requestId });
        return {
          ok: false,
          requestId: value.requestId,
          error: {
            code: 'ASSET_FAILED',
            message: error instanceof Error ? error.message.slice(0, 2048) : 'The asset operation failed.',
          },
        };
      }
    });
  };

  const describeWrite = (reply: AssetWriteReplyV1) => (reply.written
    ? (reply.upload === null ? 'written' : reply.upload.ok ? 'uploaded' : `kept:${reply.upload.reason}`)
    : reply.reason);

  register(ASSET_CHANNELS.write, isAssetWriteRequestV1,
    (request: AssetWriteRequestV1) => write(request.bytes), describeWrite);

  /*
   * A test upload, for the button in the preferences pane.
   *
   * One pixel, written to a temporary file because PicGo takes paths, sent the
   * same way a pasted picture is, and removed again. The reply is the address
   * or the reason, which is the whole point of a button called Test.
   */
  register(ASSET_CHANNELS.testUpload, isAssetRequestV1, async (_request: AssetRequestV1): Promise<AssetTestUploadReplyV1> => {
    const scratch = path.join(tmpdir(), `noto-upload-test-${randomUUID()}.png`);
    try {
      await writeFile(scratch, Buffer.from(ONE_PIXEL_PNG, 'base64'));
      const outcome = await uploadThroughPicGo(scratch, { fetch, timeoutMs: 20_000 });
      return outcome.uploaded
        ? { version: NOTO_ASSETS_VERSION, ok: true, url: outcome.url }
        : { version: NOTO_ASSETS_VERSION, ok: false, reason: outcome.reason, detail: outcome.detail };
    } finally {
      await rm(scratch, { force: true }).catch(() => {});
    }
  }, (reply) => (reply.ok ? 'uploaded' : reply.reason));

  register(ASSET_CHANNELS.pick, isAssetRequestV1, async (_request: AssetRequestV1) => {
    if (!deps.session.currentPath) {
      return { version: NOTO_ASSETS_VERSION, written: false, reason: 'no-document' } as const;
    }
    const window = deps.getWindow();
    const options = {
      title: 'Insert Image',
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS].map((dot) => dot.slice(1)) }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { version: NOTO_ASSETS_VERSION, written: false, reason: 'cancelled' } as const;
    }
    let bytes: Uint8Array;
    try {
      bytes = await readFile(result.filePaths[0]);
    } catch {
      return { version: NOTO_ASSETS_VERSION, written: false, reason: 'write-failed' } as const;
    }
    // A picked file goes through the same ceiling and the same sniff as a
    // paste. The dialog filtered by name, and a name is not what a file is.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
      return { version: NOTO_ASSETS_VERSION, written: false, reason: 'too-large' } as const;
    }
    return write(bytes);
  }, describeWrite);
}

/** A 1x1 transparent PNG, the smallest picture a bucket will accept. */
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
