import { randomUUID } from 'node:crypto';
import type {
  RendererLeaseMaterialization,
  RendererLeaseRelease,
  RendererLeaseRequest,
  RendererTransportAck,
  RendererTransportRequest,
} from '../../shared/plugins/lifecycle';
import { PLUGIN_LIFECYCLE_VERSION } from '../../shared/plugins/lifecycle';
import { isRendererTransportAck, isRendererTransportRequest } from '../../shared/ipc/validate';
import type { RendererLeaseHost } from './plugin-registry';

interface RendererLeaseBridgeOptions {
  dispatch(request: RendererTransportRequest): void;
  bridgeSessionId?: string;
  timeoutMs?: number;
  diagnostic?: (code: string) => void;
}

interface LeaseIdentity {
  pluginId: string;
  leaseId: string;
  generation: number;
}

interface PendingRequest<T> extends LeaseIdentity {
  requestId: string;
  rendererSessionId: string;
  action: RendererTransportRequest['action'];
  resolve(value: T): void;
  reject(cause: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  removeAbort: () => void;
}

const DEFAULT_TIMEOUT_MS = 4_000;
export class RendererLeaseBridge implements RendererLeaseHost {
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private readonly leases = new Map<string, LeaseIdentity>();
  private readonly bridgeSessionId: string;
  private requestSequence = 0;
  private readonly timeoutMs: number;
  private rendererGone = true;
  private rendererSessionId: string | null = null;

  constructor(private readonly options: RendererLeaseBridgeOptions) {
    this.bridgeSessionId = options.bridgeSessionId ?? randomUUID();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  openLease(request: RendererLeaseRequest): Promise<RendererLeaseMaterialization> {
    if (request.signal.aborted) return Promise.reject(new Error('PLUGIN_GENERATION_ABORTED'));
    if (this.rendererGone || !this.rendererSessionId) {
      return Promise.reject(new Error('PLUGIN_RENDERER_DISPOSED'));
    }
    const identity = {
      pluginId: request.pluginId,
      leaseId: request.leaseId,
      generation: request.generation,
    };
    const existing = this.leases.get(request.leaseId);
    if (existing && !sameLease(existing, identity)) {
      return Promise.reject(new Error('PLUGIN_LEASE_MISMATCH'));
    }
    this.leases.set(request.leaseId, identity);
    return this.dispatch<RendererLeaseMaterialization>({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: this.nextRequestId(),
      rendererSessionId: this.requireRendererSession(),
      action: 'open',
      ...identity,
      settings: { ...request.settings },
    }, request.signal, (ack) => {
      if (!ack.ok || ack.action !== 'open') throw ackError(ack);
      return {
        leaseId: ack.leaseId,
        generation: ack.generation,
        registrations: ack.registrations,
      };
    }).catch((cause) => {
      if (!this.pendingForLease(request.leaseId)) this.leases.delete(request.leaseId);
      throw cause;
    });
  }

  closeLease(leaseId: string): Promise<RendererLeaseRelease> {
    const identity = this.leases.get(leaseId);
    if (!identity) {
      return Promise.reject(new Error('PLUGIN_LEASE_UNKNOWN'));
    }
    if (this.rendererGone) {
      this.leases.delete(leaseId);
      return Promise.resolve({ leaseId, complete: true, failures: [], registrations: 0 });
    }
    return this.dispatch<RendererLeaseRelease>({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: this.nextRequestId(),
      rendererSessionId: this.requireRendererSession(),
      action: 'close',
      ...identity,
    }, undefined, (ack) => {
      if (!ack.ok || ack.action !== 'close') throw ackError(ack);
      if (ack.complete) this.leases.delete(leaseId);
      return {
        leaseId: ack.leaseId,
        complete: ack.complete,
        failures: [...ack.failures],
        registrations: 0,
      };
    });
  }

  executeLeaseCommand(leaseId: string, commandId: string, signal: AbortSignal): Promise<boolean> {
    const identity = this.requireLease(leaseId);
    return this.dispatch<boolean>({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: this.nextRequestId(),
      rendererSessionId: this.requireRendererSession(),
      action: 'execute-command',
      ...identity,
      commandId,
    }, signal, (ack) => {
      if (!ack.ok || ack.action !== 'execute-command') throw ackError(ack);
      return ack.handled;
    });
  }

  updateLeaseSetting(
    leaseId: string,
    key: string,
    value: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const identity = this.requireLease(leaseId);
    return this.dispatch<void>({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: this.nextRequestId(),
      rendererSessionId: this.requireRendererSession(),
      action: 'update-setting',
      ...identity,
      key,
      value,
    }, signal, (ack) => {
      if (!ack.ok || ack.action !== 'update-setting') throw ackError(ack);
    });
  }

  acknowledge(value: unknown): boolean {
    if (!isRendererTransportAck(value)) return false;
    const pending = this.pending.get(value.requestId);
    if (!pending
      || pending.action !== value.action
      || pending.rendererSessionId !== value.rendererSessionId
      || pending.pluginId !== value.pluginId
      || pending.leaseId !== value.leaseId
      || pending.generation !== value.generation) return false;
    this.pending.delete(value.requestId);
    clearTimeout(pending.timeout);
    pending.removeAbort();
    pending.resolve(value);
    return true;
  }

  rendererDisposed(): void {
    this.rendererGone = true;
    this.rendererSessionId = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.removeAbort();
      pending.reject(new Error('PLUGIN_RENDERER_DISPOSED'));
    }
    this.pending.clear();
  }

  activeLeases(): readonly LeaseIdentity[] {
    return Object.freeze([...this.leases.values()].map((lease) => Object.freeze({ ...lease })));
  }

  rendererReady(rendererSessionId: string): readonly LeaseIdentity[] {
    if (this.rendererSessionId === rendererSessionId && !this.rendererGone) return [];
    const displaced = this.activeLeases();
    this.rendererDisposed();
    this.rendererSessionId = rendererSessionId;
    this.rendererGone = false;
    return displaced;
  }

  private dispatch<T>(
    request: RendererTransportRequest,
    signal: AbortSignal | undefined,
    map: (ack: RendererTransportAck) => T,
  ): Promise<T> {
    if (this.rendererGone) return Promise.reject(new Error('PLUGIN_RENDERER_DISPOSED'));
    const rendererSessionId = this.rendererSessionId;
    if (!rendererSessionId || request.rendererSessionId !== rendererSessionId) {
      return Promise.reject(new Error('PLUGIN_RENDERER_SESSION_STALE'));
    }
    if (!isRendererTransportRequest(request)) {
      return Promise.reject(new Error('PLUGIN_RENDERER_REQUEST_INVALID'));
    }
    if (this.pending.has(request.requestId)) return Promise.reject(new Error('PLUGIN_RENDERER_REQUEST_ID_REUSED'));
    if (signal?.aborted) return Promise.reject(new Error('PLUGIN_GENERATION_ABORTED'));

    return new Promise<RendererTransportAck>((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(request.requestId);
        if (!pending) return;
        this.pending.delete(request.requestId);
        clearTimeout(pending.timeout);
        pending.removeAbort();
        reject(new Error('PLUGIN_GENERATION_ABORTED'));
      };
      if (signal) signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => {
        const pending = this.pending.get(request.requestId);
        if (!pending) return;
        this.pending.delete(request.requestId);
        pending.removeAbort();
        this.options.diagnostic?.('PLUGIN_RENDERER_TIMEOUT');
        reject(new Error('PLUGIN_RENDERER_TIMEOUT'));
      }, this.timeoutMs);
      const pending: PendingRequest<RendererTransportAck> = {
        requestId: request.requestId,
        rendererSessionId,
        action: request.action,
        pluginId: request.pluginId,
        leaseId: request.leaseId,
        generation: request.generation,
        resolve,
        reject,
        timeout,
        removeAbort: () => signal?.removeEventListener('abort', abort),
      };
      this.pending.set(request.requestId, pending as PendingRequest<unknown>);
      try {
        this.options.dispatch(request);
      } catch (cause) {
        this.pending.delete(request.requestId);
        clearTimeout(timeout);
        pending.removeAbort();
        reject(cause instanceof Error ? cause : new Error('PLUGIN_RENDERER_DISPATCH_FAILED'));
      }
    }).then(map);
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `renderer:${this.bridgeSessionId}:${this.requestSequence}`;
  }

  private requireLease(leaseId: string): LeaseIdentity {
    const identity = this.leases.get(leaseId);
    if (!identity) throw new Error('PLUGIN_LEASE_UNKNOWN');
    return identity;
  }

  private requireRendererSession(): string {
    if (this.rendererGone || !this.rendererSessionId) throw new Error('PLUGIN_RENDERER_DISPOSED');
    return this.rendererSessionId;
  }

  private pendingForLease(leaseId: string): boolean {
    return [...this.pending.values()].some((pending) => pending.leaseId === leaseId);
  }
}

function sameLease(left: LeaseIdentity, right: LeaseIdentity): boolean {
  return left.pluginId === right.pluginId
    && left.leaseId === right.leaseId
    && left.generation === right.generation;
}

function ackError(ack: RendererTransportAck): Error {
  return new Error(ack.ok ? 'PLUGIN_RENDERER_ACK_MISMATCH' : ack.error);
}
