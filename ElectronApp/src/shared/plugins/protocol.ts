import { hasExactKeys, isRecord } from '../ipc/validate';

export const SERVICE_PROTOCOL_VERSION = 1 as const;
export const FILESYSTEM_PLUGIN_ID = 'dev.lr00rl.noto.filesystem-proof' as const;
const correlationPattern = /^service-[1-9][0-9]*-[a-zA-Z0-9_-]{6,32}$/;
const grantPattern = /^grant:[a-f0-9-]{36}$/;
const hashPattern = /^[a-f0-9]{64}$/;

export interface ServiceInitializeMessage {
  version: typeof SERVICE_PROTOCOL_VERSION;
  type: 'initialize';
  generation: number;
}

export interface ServiceReadMessage {
  version: typeof SERVICE_PROTOCOL_VERSION;
  type: 'read';
  pluginId: typeof FILESYSTEM_PLUGIN_ID;
  correlationId: string;
  generation: number;
  grantId: string;
  absolutePath: string;
}

export type ServiceReplyMessage =
  | { version: 1; type: 'ready'; generation: number; pid: number; permissionOutsideDenied: boolean }
  | { version: 1; type: 'read-result'; generation: number; correlationId: string; ok: true; sha256: string; size: number; received: number }
  | { version: 1; type: 'read-result'; generation: number; correlationId: string; ok: false; code: 'SERVICE_FAILED'; message: string; received: number };

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1_000_000;
}

function isCounter(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000;
}

export function isServiceInitializeMessage(value: unknown): value is ServiceInitializeMessage {
  return isRecord(value)
    && hasExactKeys(value, ['version', 'type', 'generation'])
    && value.version === SERVICE_PROTOCOL_VERSION
    && value.type === 'initialize'
    && isGeneration(value.generation);
}

export function isServiceReadMessage(value: unknown): value is ServiceReadMessage {
  return isRecord(value)
    && hasExactKeys(value, [
      'version', 'type', 'pluginId', 'correlationId', 'generation', 'grantId', 'absolutePath',
    ])
    && value.version === SERVICE_PROTOCOL_VERSION
    && value.type === 'read'
    && value.pluginId === FILESYSTEM_PLUGIN_ID
    && typeof value.correlationId === 'string' && correlationPattern.test(value.correlationId)
    && isGeneration(value.generation)
    && typeof value.grantId === 'string' && grantPattern.test(value.grantId)
    && typeof value.absolutePath === 'string'
    && value.absolutePath.length > 0
    && value.absolutePath.length <= 4_096;
}

export function isServiceReplyMessage(value: unknown): value is ServiceReplyMessage {
  if (!isRecord(value) || value.version !== SERVICE_PROTOCOL_VERSION || !isGeneration(value.generation)) return false;
  if (value.type === 'ready') {
    return hasExactKeys(value, ['version', 'type', 'generation', 'pid', 'permissionOutsideDenied'])
      && Number.isSafeInteger(value.pid) && Number(value.pid) > 0
      && typeof value.permissionOutsideDenied === 'boolean';
  }
  if (value.type !== 'read-result'
    || typeof value.correlationId !== 'string'
    || !correlationPattern.test(value.correlationId)
    || typeof value.ok !== 'boolean'
    || !isCounter(value.received)) return false;
  if (value.ok) {
    return hasExactKeys(value, [
      'version', 'type', 'generation', 'correlationId', 'ok', 'sha256', 'size', 'received',
    ])
      && typeof value.sha256 === 'string' && hashPattern.test(value.sha256)
      && isCounter(value.size);
  }
  return hasExactKeys(value, [
    'version', 'type', 'generation', 'correlationId', 'ok', 'code', 'message', 'received',
  ])
    && value.code === 'SERVICE_FAILED'
    && typeof value.message === 'string'
    && value.message.length > 0
    && value.message.length <= 512;
}

