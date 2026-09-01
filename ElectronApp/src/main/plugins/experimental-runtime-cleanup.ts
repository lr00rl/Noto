export type ExperimentalRuntimeCleanupState = 'live' | 'closing' | 'cleanup-failed' | 'closed';

export interface ExperimentalRuntimeCleanupReceipts {
  windowDestroyed: boolean;
  protocolUnhandled: boolean;
  sessionCleared: boolean;
  ownershipReleased: boolean;
}

export interface ExperimentalRuntimeCleanupOperations {
  destroyWindow(): Promise<void>;
  unhandleProtocol(): Promise<void>;
  clearSession(): Promise<void>;
  releaseOwnership(): Promise<void>;
}

export interface ExperimentalRuntimeCleanupResult {
  state: 'cleanup-failed' | 'closed';
  receipts: ExperimentalRuntimeCleanupReceipts;
}

export class ExperimentalRuntimeCleanup {
  state: ExperimentalRuntimeCleanupState = 'live';
  readonly receipts: ExperimentalRuntimeCleanupReceipts = {
    windowDestroyed: false,
    protocolUnhandled: false,
    sessionCleared: false,
    ownershipReleased: false,
  };
  #active: Promise<ExperimentalRuntimeCleanupResult> | null = null;

  close(operations: ExperimentalRuntimeCleanupOperations): Promise<ExperimentalRuntimeCleanupResult> {
    if (this.state === 'closed') return Promise.resolve({ state: 'closed', receipts: { ...this.receipts } });
    if (this.#active) return this.#active;
    this.state = 'closing';
    this.#active = this.#run(operations).finally(() => { this.#active = null; });
    return this.#active;
  }

  async #run(operations: ExperimentalRuntimeCleanupOperations): Promise<ExperimentalRuntimeCleanupResult> {
    try {
      if (!this.receipts.windowDestroyed) {
        await operations.destroyWindow();
        this.receipts.windowDestroyed = true;
      }
      if (!this.receipts.protocolUnhandled) {
        await operations.unhandleProtocol();
        this.receipts.protocolUnhandled = true;
      }
      if (!this.receipts.sessionCleared) {
        await operations.clearSession();
        this.receipts.sessionCleared = true;
      }
      if (!this.receipts.ownershipReleased) {
        await operations.releaseOwnership();
        this.receipts.ownershipReleased = true;
      }
      this.state = 'closed';
      return { state: 'closed', receipts: { ...this.receipts } };
    } catch {
      this.state = 'cleanup-failed';
      return { state: 'cleanup-failed', receipts: { ...this.receipts } };
    }
  }
}

