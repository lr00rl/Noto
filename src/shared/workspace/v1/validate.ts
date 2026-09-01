/**
 * Workspace message validation.
 *
 * Same discipline as the other contract families: every message crossing the
 * process boundary is parsed here, in shared code, so main and renderer cannot
 * drift into disagreeing about what a valid message is.
 */

import { WORKSPACE_MENU_COMMANDS } from './contracts';
import type {
  RecentFileV1,
  WorkspaceIndexEntryV1,
  WorkspaceIndexReplyV1,
  WorkspaceRevealReplyV1,
  WorkspaceRevealRequestV1,
  WorkspaceRevealTargetV1,
  WorkspaceDocumentEventV1,
  WorkspaceMenuCommandV1,
  WorkspaceMenuEventV1,
  WorkspaceOpenPathRequestV1,
  WorkspaceOpenReplyV1,
  WorkspaceRecentReplyV1,
  WorkspaceRequestV1,
  WorkspaceResultV1,
  WorkspaceSaveAsReplyV1,
  WorkspaceTabRequestV1,
  WorkspaceTabV1,
  WorkspaceTabsEventV1,
  WorkspaceClosedEventV1,
  WorkspaceEntryV1,
  WorkspaceFolderEventV1,
  WorkspaceFolderReplyV1,
  WorkspaceFolderRequestV1,
} from './contracts';
import { isFileTruthOpenReplyV1 } from '../../file-truth/v1/validate';

const requestId = /^[A-Za-z0-9._:-]{1,96}$/;
const menuCommands: readonly WorkspaceMenuCommandV1[] = WORKSPACE_MENU_COMMANDS;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));

export function isWorkspaceRequestV1(value: unknown): value is WorkspaceRequestV1 {
  return record(value) && exact(value, ['version', 'requestId'])
    && value.version === 1 && typeof value.requestId === 'string' && requestId.test(value.requestId);
}

export function isWorkspaceOpenPathRequestV1(value: unknown): value is WorkspaceOpenPathRequestV1 {
  return record(value) && exact(value, ['version', 'requestId', 'path'])
    && value.version === 1 && typeof value.requestId === 'string' && requestId.test(value.requestId)
    && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096;
}

/** Activate and close share a shape, so they share a validator. */
export function isWorkspaceTabRequestV1(value: unknown): value is WorkspaceTabRequestV1 {
  return record(value) && exact(value, ['version', 'requestId', 'path'])
    && value.version === 1 && typeof value.requestId === 'string' && requestId.test(value.requestId)
    && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096;
}

function isTab(value: unknown): value is WorkspaceTabV1 {
  return record(value) && exact(value, ['path', 'name', 'documentId', 'active'])
    && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096
    && typeof value.name === 'string' && value.name.length <= 512
    && typeof value.documentId === 'string' && value.documentId.startsWith('noto-doc-v3:')
    && typeof value.active === 'boolean';
}

export function isWorkspaceTabsEventV1(value: unknown): value is WorkspaceTabsEventV1 {
  return record(value) && exact(value, ['version', 'tabs']) && value.version === 1
    && Array.isArray(value.tabs) && value.tabs.length <= 64 && value.tabs.every(isTab);
}

export function isWorkspaceClosedEventV1(value: unknown): value is WorkspaceClosedEventV1 {
  return record(value) && exact(value, ['version']) && value.version === 1;
}

export const isWorkspaceTabsResultV1 = (value: unknown, id: string): value is WorkspaceResultV1<WorkspaceTabsEventV1> =>
  isResult(value, id, isWorkspaceTabsEventV1);

export function isWorkspaceFolderRequestV1(value: unknown): value is WorkspaceFolderRequestV1 {
  return record(value) && exact(value, ['version', 'requestId', 'path'])
    && value.version === 1 && typeof value.requestId === 'string' && requestId.test(value.requestId)
    && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096;
}

function isEntry(value: unknown): value is WorkspaceEntryV1 {
  return record(value) && exact(value, ['name', 'path', 'kind'])
    && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 512
    && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096
    && (value.kind === 'file' || value.kind === 'directory');
}

function isFolderReply(value: unknown): value is WorkspaceFolderReplyV1 {
  return record(value) && exact(value, ['version', 'entries']) && value.version === 1
    && Array.isArray(value.entries) && value.entries.length <= 4096 && value.entries.every(isEntry);
}

export function isWorkspaceFolderEventV1(value: unknown): value is WorkspaceFolderEventV1 {
  return record(value) && exact(value, ['version', 'root', 'name']) && value.version === 1
    && (value.root === null || (typeof value.root === 'string' && value.root.length <= 4096))
    && (value.name === null || (typeof value.name === 'string' && value.name.length <= 512));
}

export const isWorkspaceFolderResultV1 = (value: unknown, id: string): value is WorkspaceResultV1<WorkspaceFolderEventV1> =>
  isResult(value, id, isWorkspaceFolderEventV1);

export const isWorkspaceListResultV1 = (value: unknown, id: string): value is WorkspaceResultV1<WorkspaceFolderReplyV1> =>
  isResult(value, id, isFolderReply);

function isRecentFile(value: unknown): value is RecentFileV1 {
  return record(value) && exact(value, ['path', 'name', 'openedAt'])
    && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096
    && typeof value.name === 'string' && value.name.length <= 512
    && Number.isSafeInteger(value.openedAt) && Number(value.openedAt) >= 0;
}

function isResult<T>(value: unknown, expectedRequestId: string,
  validateValue: (candidate: unknown) => candidate is T): value is WorkspaceResultV1<T> {
  if (!record(value) || value.requestId !== expectedRequestId || typeof value.ok !== 'boolean') return false;
  if (value.ok) return exact(value, ['ok', 'requestId', 'value']) && validateValue(value.value);
  return exact(value, ['ok', 'requestId', 'error']) && record(value.error)
    && exact(value.error, ['code', 'message'])
    && ['BAD_REQUEST', 'WORKSPACE_FAILED'].includes(String(value.error.code))
    && typeof value.error.message === 'string' && value.error.message.length > 0
    && value.error.message.length <= 2048;
}

function isOpenReply(value: unknown): value is WorkspaceOpenReplyV1 {
  return record(value) && exact(value, ['version', 'opened']) && value.version === 1
    && (value.opened === null || isFileTruthOpenReplyV1(value.opened));
}

function isSaveAsReply(value: unknown): value is WorkspaceSaveAsReplyV1 {
  return record(value) && exact(value, ['version', 'path']) && value.version === 1
    && (value.path === null || (typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096));
}

function isRecentReply(value: unknown): value is WorkspaceRecentReplyV1 {
  return record(value) && exact(value, ['version', 'files']) && value.version === 1
    && Array.isArray(value.files) && value.files.length <= 64 && value.files.every(isRecentFile);
}

export const isWorkspaceOpenResultV1 = (value: unknown, id: string): value is WorkspaceResultV1<WorkspaceOpenReplyV1> =>
  isResult(value, id, isOpenReply);

export const isWorkspaceSaveAsResultV1 = (value: unknown, id: string): value is WorkspaceResultV1<WorkspaceSaveAsReplyV1> =>
  isResult(value, id, isSaveAsReply);

export const isWorkspaceRecentResultV1 = (value: unknown, id: string): value is WorkspaceResultV1<WorkspaceRecentReplyV1> =>
  isResult(value, id, isRecentReply);

export function isWorkspaceDocumentEventV1(value: unknown): value is WorkspaceDocumentEventV1 {
  return record(value) && exact(value, ['version', 'opened']) && value.version === 1
    && isFileTruthOpenReplyV1(value.opened);
}

export function isWorkspaceMenuEventV1(value: unknown): value is WorkspaceMenuEventV1 {
  return record(value) && exact(value, ['version', 'command']) && value.version === 1
    && menuCommands.includes(value.command as WorkspaceMenuCommandV1);
}

function isIndexEntryV1(value: unknown): value is WorkspaceIndexEntryV1 {
  return record(value) && exact(value, ['path', 'name', 'relativePath'])
    && typeof value.path === 'string' && value.path.length > 0
    && typeof value.name === 'string'
    && typeof value.relativePath === 'string';
}

export function isWorkspaceIndexReplyV1(value: unknown): value is WorkspaceIndexReplyV1 {
  return record(value) && exact(value, ['version', 'root', 'entries', 'truncated'])
    && value.version === 1
    && (value.root === null || typeof value.root === 'string')
    && typeof value.truncated === 'boolean'
    && Array.isArray(value.entries) && value.entries.every(isIndexEntryV1);
}

export function isWorkspaceIndexResultV1(
  value: unknown,
  expectedRequestId: string,
): value is WorkspaceResultV1<WorkspaceIndexReplyV1> {
  if (!record(value) || value.requestId !== expectedRequestId) return false;
  if (value.ok === true) return isWorkspaceIndexReplyV1(value.value);
  return value.ok === false && record(value.error)
    && typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

const revealTargets: readonly WorkspaceRevealTargetV1[] = ['folder', 'document'];

export function isWorkspaceRevealRequestV1(value: unknown): value is WorkspaceRevealRequestV1 {
  return record(value) && exact(value, ['version', 'requestId', 'target'])
    && value.version === 1
    && typeof value.requestId === 'string' && requestId.test(value.requestId)
    && revealTargets.includes(value.target as WorkspaceRevealTargetV1);
}

export function isWorkspaceRevealReplyV1(value: unknown): value is WorkspaceRevealReplyV1 {
  return record(value) && exact(value, ['version', 'revealed'])
    && value.version === 1 && typeof value.revealed === 'boolean';
}

export const isWorkspaceRevealResultV1 = (
  value: unknown, id: string,
): value is WorkspaceResultV1<WorkspaceRevealReplyV1> => isResult(value, id, isWorkspaceRevealReplyV1);
