/**
 * Both sides of the asset boundary check the same messages here.
 *
 * Same discipline as the workspace and settings validators: the key set is
 * exact, so a message carrying anything extra is refused rather than having the
 * extra quietly ignored. The bytes are the one field that is large, and the
 * ceiling is checked here as well as in main, because a request that is going
 * to be refused should not be copied across the boundary first.
 */

import {
  MAX_ASSET_BYTES,
  NOTO_ASSETS_VERSION,
  type AssetRequestV1,
  type AssetResultV1,
  type AssetTestUploadReplyV1,
  type AssetWriteReplyV1,
  type AssetWriteRequestV1,
} from './contracts';

const requestId = /^[A-Za-z0-9._:-]{1,96}$/;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

export function isAssetRequestV1(value: unknown): value is AssetRequestV1 {
  return record(value) && exact(value, ['version', 'requestId'])
    && value.version === NOTO_ASSETS_VERSION
    && typeof value.requestId === 'string' && requestId.test(value.requestId);
}

export function isAssetWriteRequestV1(value: unknown): value is AssetWriteRequestV1 {
  if (!record(value) || !exact(value, ['version', 'requestId', 'bytes'])) return false;
  if (value.version !== NOTO_ASSETS_VERSION) return false;
  if (typeof value.requestId !== 'string' || !requestId.test(value.requestId)) return false;
  // Structured clone hands a Uint8Array across as a Uint8Array, so anything
  // else is a message that was not built by the preload.
  if (!(value.bytes instanceof Uint8Array)) return false;
  return value.bytes.byteLength > 0 && value.bytes.byteLength <= MAX_ASSET_BYTES;
}

const UPLOAD_FAILURES = new Set(['unreachable', 'refused', 'bad-reply']);

function isUploadNote(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.ok === true) return Object.keys(value).length === 1;
  return value.ok === false
    && typeof value.reason === 'string' && UPLOAD_FAILURES.has(value.reason)
    && (value.detail === undefined || (typeof value.detail === 'string' && value.detail.length <= 400))
    && Object.keys(value).every((key) => ['ok', 'reason', 'detail'].includes(key));
}

export function isAssetTestUploadReplyV1(value: unknown): value is AssetTestUploadReplyV1 {
  if (!record(value) || value.version !== NOTO_ASSETS_VERSION) return false;
  if (value.ok === true) {
    return exact(value, ['version', 'ok', 'url']) && typeof value.url === 'string' && value.url.startsWith('https://');
  }
  return value.ok === false && typeof value.reason === 'string' && UPLOAD_FAILURES.has(value.reason)
    && (value.detail === undefined || typeof value.detail === 'string')
    && Object.keys(value).every((key) => ['version', 'ok', 'reason', 'detail'].includes(key));
}

export function isAssetTestUploadResultV1(
  value: unknown,
  expectedRequestId: string,
): value is AssetResultV1<AssetTestUploadReplyV1> {
  if (!record(value) || value.requestId !== expectedRequestId) return false;
  if (value.ok === true) return isAssetTestUploadReplyV1(value.value);
  return value.ok === false && record(value.error)
    && typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

const REFUSALS = new Set([
  'no-document', 'unsupported-type', 'too-large', 'outside-root', 'cancelled', 'write-failed',
]);

export function isAssetWriteReplyV1(value: unknown): value is AssetWriteReplyV1 {
  if (!record(value) || value.version !== NOTO_ASSETS_VERSION) return false;
  if (value.written === true) {
    return exact(value, ['version', 'written', 'reference', 'url', 'alt', 'upload'])
      && typeof value.reference === 'string' && value.reference.length > 0
      && typeof value.url === 'string' && typeof value.alt === 'string'
      && (value.upload === null || isUploadNote(value.upload));
  }
  return value.written === false && exact(value, ['version', 'written', 'reason'])
    && typeof value.reason === 'string' && REFUSALS.has(value.reason);
}

export function isAssetResultV1(
  value: unknown,
  expectedRequestId: string,
): value is AssetResultV1<AssetWriteReplyV1> {
  if (!record(value) || value.requestId !== expectedRequestId) return false;
  if (value.ok === true) return isAssetWriteReplyV1(value.value);
  return value.ok === false && record(value.error)
    && typeof value.error.code === 'string' && typeof value.error.message === 'string';
}
