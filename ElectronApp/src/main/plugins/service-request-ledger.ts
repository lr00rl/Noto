import { randomBytes } from 'node:crypto';

interface LedgerOptions<T> {
  timeoutMs: number;
  token?: () => string;
  onTerminal?: (entry: LedgerTerminal<T>) => void;
}

export interface LedgerIdentity {
  rendererRequestId: string;
  grantId: string;
  registryGeneration: number;
  serviceGeneration: number;
}

export interface LedgerTerminal<T> extends LedgerIdentity {
  correlationId: string;
  state: 'completed' | 'cancelled' | 'timed-out' | 'failed';
  value?: T;
  error?: Error;
}

interface Pending<T> extends LedgerIdentity {
  correlationId: string;
  controller: AbortController;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export type SettleResult = 'accepted' | 'mismatched' | 'stale' | 'terminal';

export class ServiceRequestLedger<T> {
  private readonly byCorrelation = new Map<string, Pending<T>>();
  private readonly byRendererRequest = new Map<string, Pending<T>>();
  private readonly terminals = new Set<string>();
  private sequence = 0;
  private readonly token: () => string;

  constructor(private readonly options: LedgerOptions<T>) {
    this.token = options.token ?? (() => randomBytes(6).toString('base64url'));
  }
  get size(): number { return this.byCorrelation.size; }

  begin(identity: LedgerIdentity): { correlationId: string; promise: Promise<T>; signal: AbortSignal } {
    // yagni: G005 intentionally permits one pending filesystem read. Upgrade to a bounded
    // per-plugin queue when real plugins demonstrate concurrent read requirements.
    if (this.byCorrelation.size > 0) throw new Error('SERVICE_FAILED: a read request is already pending');
    if (this.byRendererRequest.has(identity.rendererRequestId) || this.terminals.has(`renderer:${identity.rendererRequestId}`)) {
      throw new Error('BAD_REQUEST: duplicate renderer service request ID');
    }
    const correlationId = `service-${identity.serviceGeneration}-${this.token()}${(++this.sequence).toString(36)}`;
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    const controller = new AbortController();
    const pending = { ...identity, correlationId, controller, resolve, reject, timeout: undefined as unknown as NodeJS.Timeout };
    pending.timeout = setTimeout(() => this.finish(pending, 'timed-out', undefined, new Error('TIMEOUT: service read timed out')), this.options.timeoutMs);
    this.byCorrelation.set(correlationId, pending);
    this.byRendererRequest.set(identity.rendererRequestId, pending);
    return { correlationId, promise, signal: controller.signal };
  }

  settle(correlationId: string, registryGeneration: number, serviceGeneration: number, value: T): SettleResult {
    const pending = this.byCorrelation.get(correlationId);
    if (!pending) return this.terminals.has(`correlation:${correlationId}`) ? 'terminal' : 'stale';
    if (pending.registryGeneration !== registryGeneration || pending.serviceGeneration !== serviceGeneration) return 'mismatched';
    this.finish(pending, 'completed', value);
    return 'accepted';
  }

  reject(correlationId: string, registryGeneration: number, serviceGeneration: number, error: Error): SettleResult {
    const pending = this.byCorrelation.get(correlationId);
    if (!pending) return this.terminals.has(`correlation:${correlationId}`) ? 'terminal' : 'stale';
    if (pending.registryGeneration !== registryGeneration || pending.serviceGeneration !== serviceGeneration) return 'mismatched';
    this.finish(pending, 'failed', undefined, error);
    return 'accepted';
  }

  cancel(rendererRequestId: string, registryGeneration: number, serviceGeneration: number): SettleResult {
    const pending = this.byRendererRequest.get(rendererRequestId);
    if (!pending) return this.terminals.has(`renderer:${rendererRequestId}`) ? 'terminal' : 'stale';
    if (pending.registryGeneration !== registryGeneration || pending.serviceGeneration !== serviceGeneration) return 'mismatched';
    this.finish(pending, 'cancelled', undefined, new Error('SERVICE_CANCELLED: service read cancelled'));
    return 'accepted';
  }

  cancelGrant(grantId: string, registryGeneration: number, serviceGeneration: number): number {
    let count = 0;
    for (const pending of [...this.byCorrelation.values()]) {
      if (pending.grantId !== grantId || pending.registryGeneration !== registryGeneration || pending.serviceGeneration !== serviceGeneration) continue;
      this.finish(pending, 'cancelled', undefined, new Error('SERVICE_CANCELLED: grant revoked'));
      count += 1;
    }
    return count;
  }

  failGeneration(registryGeneration: number, serviceGeneration: number, error: Error): void {
    for (const pending of [...this.byCorrelation.values()]) {
      if (pending.registryGeneration !== registryGeneration || pending.serviceGeneration !== serviceGeneration) continue;
      this.finish(pending, 'failed', undefined, error);
    }
  }

  cancelGeneration(registryGeneration: number, serviceGeneration: number): void {
    for (const pending of [...this.byCorrelation.values()]) {
      if (pending.registryGeneration !== registryGeneration || pending.serviceGeneration !== serviceGeneration) continue;
      this.finish(pending, 'cancelled', undefined, new Error('SERVICE_CANCELLED: service generation is stopping'));
    }
  }

  private finish(pending: Pending<T>, state: LedgerTerminal<T>['state'], value?: T, error?: Error): void {
    if (!this.byCorrelation.delete(pending.correlationId)) return;
    this.byRendererRequest.delete(pending.rendererRequestId);
    clearTimeout(pending.timeout);
    this.tombstone(`correlation:${pending.correlationId}`);
    this.tombstone(`renderer:${pending.rendererRequestId}`);
    pending.controller.abort();
    this.options.onTerminal?.({ ...pending, state, value, error });
    if (state === 'completed') pending.resolve(value as T);
    else pending.reject(error ?? new Error('SERVICE_FAILED: request failed'));
  }

  private tombstone(key: string): void {
    this.terminals.add(key);
    if (this.terminals.size <= 4_096) return;
    const oldest = this.terminals.values().next().value;
    if (typeof oldest === 'string') this.terminals.delete(oldest);
  }
}
