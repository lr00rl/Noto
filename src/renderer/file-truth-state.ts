import type { FileTruthSavedV1, FileTruthSaveOutcomeV1 } from '../shared/file-truth/v1/contracts';

export type FileTruthUiState = 'Opened' | 'Unsaved changes' | 'Saving' | 'Saved' | 'External conflict' | 'Save failed' | 'Recovery needed' | 'Recovery failed' | 'Cleanup failed' | 'Stale editor revision' | 'Changed on disk' | 'File removed';

export function presentFileTruthOutcome(outcome: FileTruthSaveOutcomeV1): { state: FileTruthUiState; dirty: boolean } {
  switch (outcome.status) {
    case 'saved': return { state: 'Saved', dirty: false };
    case 'copy-saved': return { state: 'Unsaved changes', dirty: true };
    case 'external-conflict': return { state: 'External conflict', dirty: true };
    case 'stale-editor-revision': return { state: 'Stale editor revision', dirty: true };
    case 'recovery-needed': return { state: 'Recovery needed', dirty: true };
    case 'recovery-failed': return { state: 'Recovery failed', dirty: true };
    case 'cleanup-failed': return { state: 'Cleanup failed', dirty: true };
    default: return { state: 'Save failed', dirty: true };
  }
}

export function savedSnapshotLeavesDirty(capturedEditorRevision: number, currentEditorRevision: number): boolean {
  return currentEditorRevision !== capturedEditorRevision;
}

export function acceptedSaveOutcome(outcome: FileTruthSaveOutcomeV1): FileTruthSavedV1 | null {
  if (outcome.status === 'saved') return outcome;
  if (outcome.status === 'cleanup-failed' && outcome.primary.status === 'saved') return outcome.primary;
  return null;
}

export function outcomeHasRecoveryEvidence(outcome: FileTruthSaveOutcomeV1): boolean {
  if (outcome.status === 'cleanup-failed') return true;
  return 'recovery' in outcome && (outcome.recovery !== null || outcome.residuePaths.length > 0);
}

export function actionableFileTruthMessage(value: unknown, fallback: string): string {
  let raw = fallback;
  if (typeof value === 'string') raw = value;
  else if (value instanceof Error) raw = value.message;
  const sanitized = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 2_048);
  return sanitized || fallback;
}

export function fileTruthActions(state: FileTruthUiState, editorDirty: boolean,
  recoveryBarrier = ['Recovery needed', 'Recovery failed', 'Cleanup failed'].includes(state)):
  readonly ('retry-save' | 'retry-recovery' | 'save-copy' | 'reload')[] {
  const actions: Array<'retry-save' | 'retry-recovery' | 'save-copy' | 'reload'> = [];
  if (recoveryBarrier) {
    actions.push('retry-recovery');
    if (editorDirty) actions.push('save-copy');
    return actions;
  }
  if (editorDirty && state === 'Save failed') {
    actions.push('retry-save', 'save-copy');
  } else if (editorDirty && ['External conflict', 'Stale editor revision'].includes(state)) {
    // Reload first, because a conflict means the file on disk is ahead and
    // taking it is usually what the reader wants. Saving a copy keeps their
    // version when it is not.
    if (state === 'External conflict') actions.push('reload');
    actions.push('save-copy');
  } else if (state === 'Changed on disk') {
    // Offered whether or not the buffer is dirty: a clean buffer that was not
    // reloaded silently still needs a way to take the new version.
    actions.push('reload');
    if (editorDirty) actions.push('save-copy');
  }
  return actions;
}
