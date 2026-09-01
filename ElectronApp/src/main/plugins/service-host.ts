import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  MessageChannelMain,
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
} from 'electron';
import type { ServiceReply, ServiceRequest } from '../../shared/ipc/contracts';
import type { PluginCapabilitySnapshot } from '../../shared/plugins/lifecycle';
import {
  FILESYSTEM_PLUGIN_ID,
  SERVICE_PROTOCOL_VERSION,
  isServiceReplyMessage,
  type ServiceInitializeMessage,
  type ServiceReadMessage,
} from '../../shared/plugins/protocol';
import { summarizeUntrustedText, type StructuredLogger } from '../logger';
import { CapabilityBroker, CapabilityDeniedError } from './capability-broker';
import { ServiceRequestLedger } from './service-request-ledger';

interface ExitWaiter {
  child: UtilityProcess;
  generation: number;
  promise: Promise<number>;
  resolve: (code: number) => void;
}

type ServiceState = 'failed' | 'starting' | 'stopping' | 'stopped' | 'ready';

interface ReadinessLease {
  child: UtilityProcess;
  port: MessagePortMain;
  activeGeneration: number;
  readyGeneration: number;
  state: 'ready';
}

type PathResolver = (candidate: string) => Promise<string>;

export type ServiceHostEvent =
  | { type: 'capability'; registryGeneration: number; serviceGeneration: number; capability: PluginCapabilitySnapshot }
  | { type: 'unexpected-exit'; registryGeneration: number; serviceGeneration: number; detail: string };

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isPermissionCompatibilityReply(value: unknown): boolean {
  return isServiceReplyMessage(value)
    && value.type === 'ready'
    && value.permissionOutsideDenied === false;
}

export class ServiceHost {
  private child: UtilityProcess | null = null;
  private port: MessagePortMain | null = null;
  private generationCounter = 0;
  private activeGeneration: number | null = null;
  private exitWaiter: ExitWaiter | null = null;
  private readonly stoppingGenerations = new Set<number>();
  private readonly rendererRequestIds = new Set<string>();
  private readonly ledger: ServiceRequestLedger<ServiceReply>;
  private capability: PluginCapabilitySnapshot = { grant: null, request: null, restartRequired: false };
  private eventSink: (event: ServiceHostEvent) => void = () => undefined;
  private activeRegistryGeneration: number | null = null;
  private readyLease: ReadinessLease | null = null;
  readonly counters = { dispatched: 0, failures: 0, received: 0 };
  state: ServiceState = 'stopped';
  permissionProbe: 'failed' | 'passed' | 'pending' = 'pending';
  readyGeneration: number | null = null;

  constructor(
    private readonly serviceModulePath: string,
    private readonly initialPath: string | null,
    private readonly broker: CapabilityBroker,
    private readonly logger: StructuredLogger,
    private readonly resolvePath: PathResolver = realpath,
  ) {
    this.ledger = new ServiceRequestLedger<ServiceReply>({
      timeoutMs: 2_000,
      onTerminal: (terminal) => {
        const request = this.capability.request;
        if (!request || request.requestId !== terminal.rendererRequestId
          || request.generation !== terminal.registryGeneration) return;
        const detail = terminal.state === 'completed'
          ? 'Read completed'
          : sanitizeDetail(terminal.error?.message ?? 'Service request failed');
        this.capability = {
          ...this.capability,
          request: { ...request, state: terminal.state, detail },
        };
        this.emitCapability(terminal.registryGeneration, terminal.serviceGeneration);
      },
    });
  }

  setEventSink(sink: (event: ServiceHostEvent) => void): void { this.eventSink = sink; }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get brokerCounters(): Readonly<{ grants: number; denials: number }> {
    return this.broker.counters;
  }

  async activate(signal: AbortSignal, registryGeneration: number): Promise<number> {
    if (signal.aborted) throw new Error('PLUGIN_GENERATION_ABORTED');
    if (!Number.isSafeInteger(registryGeneration) || registryGeneration <= 0) {
      throw new Error('PLUGIN_GENERATION_INVALID');
    }
    if (this.activeRegistryGeneration !== null
      && this.activeRegistryGeneration !== registryGeneration) {
      throw new Error('PLUGIN_GENERATION_STALE');
    }
    this.activeRegistryGeneration = registryGeneration;
    const abort = () => { void this.deactivate(registryGeneration).catch(() => undefined); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await this.start();
      if (signal.aborted) {
        await this.deactivate(registryGeneration).catch(() => undefined);
        throw new Error('PLUGIN_GENERATION_ABORTED');
      }
      if (this.readyGeneration === null) throw new Error('SERVICE_FAILED: service is not ready');
      return this.readyGeneration;
    } catch (cause) {
      if (this.activeRegistryGeneration === registryGeneration) {
        this.activeRegistryGeneration = null;
      }
      throw cause;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  deactivate(registryGeneration: number): Promise<void> {
    if (this.activeRegistryGeneration !== null
      && this.activeRegistryGeneration !== registryGeneration) {
      return Promise.reject(new Error('PLUGIN_GENERATION_STALE'));
    }
    return this.stop().finally(() => {
      if (this.activeRegistryGeneration === registryGeneration) this.activeRegistryGeneration = null;
    });
  }

  async start(useNodePermissions = this.permissionProbe !== 'failed'): Promise<void> {
    if (this.state === 'ready') return;
    if (this.child || this.state === 'starting') {
      throw new Error('SERVICE_FAILED: a prior service generation is still running');
    }
    if (!this.initialPath) {
      this.state = 'failed';
      this.counters.failures += 1;
      throw new Error('SERVICE_FAILED: no fixture path is available');
    }

    const generation = ++this.generationCounter;
    this.activeGeneration = generation;
    this.clearReadiness();
    this.state = 'starting';
    const root = path.dirname(await this.resolvePath(this.initialPath));
    if (this.state !== 'starting' || this.activeGeneration !== generation) {
      throw new Error('SERVICE_STOPPED: service generation was invalidated during startup');
    }
    const channel = new MessageChannelMain();
    const port = channel.port2;
    this.port = port;
    port.start();

    const child = utilityProcess.fork(this.serviceModulePath, [], {
      cwd: root,
      env: {
        HOME: process.env.HOME ?? '',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
      },
      execArgv: useNodePermissions ? [
        '--permission',
        `--allow-fs-read=${root}`,
        `--allow-fs-read=${this.serviceModulePath}`,
      ] : [],
      stdio: 'pipe',
      serviceName: 'Noto Fixture Reader',
      respondToAuthRequestsFromMainProcess: false,
      allowLoadingUnsignedLibraries: false,
    });
    this.child = child;

    let resolveExit!: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => { resolveExit = resolve; });
    this.exitWaiter = { child, generation, promise: exitPromise, resolve: resolveExit };

    child.stdout?.on('data', (chunk) => this.captureServiceLog('stdout', chunk, generation));
    child.stderr?.on('data', (chunk) => this.captureServiceLog('stderr', chunk, generation));
    child.on('error', () => {
      this.failGeneration(generation, new Error('SERVICE_FAILED: utility process emitted an error'));
    });
    child.on('exit', (code) => {
      resolveExit(code);
      const intentional = this.stoppingGenerations.delete(generation);
      if (this.child === child && this.activeGeneration === generation) {
        const registryGeneration = this.activeRegistryGeneration;
        this.clearReadiness(registryGeneration, generation);
        if (registryGeneration !== null) {
          this.ledger.failGeneration(registryGeneration, generation, new Error('SERVICE_FAILED: service process exited'));
        }
        this.port?.close();
        this.port = null;
        this.child = null;
        this.activeGeneration = null;
        this.exitWaiter = null;
        if (intentional) {
          this.state = 'stopped';
          this.logger.log('service_stopped', { code, generation });
        } else {
          this.state = 'failed';
          this.counters.failures += 1;
          this.logger.log('service_failed', { code, generation, reason: 'unexpected-exit' });
          if (registryGeneration !== null) {
            this.activeRegistryGeneration = null;
            this.eventSink({
              type: 'unexpected-exit',
              registryGeneration,
              serviceGeneration: generation,
              detail: 'SERVICE_FAILED: utility process exited',
            });
          }
        }
      } else {
        this.logger.log('service_stale_exit_ignored', { code, generation });
      }
    });

    let resolveHandshake!: () => void;
    let rejectHandshake!: (error: Error) => void;
    const handshake = new Promise<void>((resolve, reject) => {
      resolveHandshake = resolve;
      rejectHandshake = reject;
    });
    let permissionCompatibilityFallback = false;
    const handshakeTimeout = setTimeout(() => {
      rejectHandshake(new Error('TIMEOUT: service handshake timed out'));
    }, 4_000);

    port.on('message', (event) => {
      const message = event.data;
      if (!isServiceReplyMessage(message)) {
        this.logger.log('service_reply_rejected', { generation, reason: 'malformed' });
        rejectHandshake(new Error('SERVICE_FAILED: invalid service reply'));
        this.failGeneration(generation, new Error('SERVICE_FAILED: invalid service reply'));
        return;
      }
      if (message.generation !== generation || generation !== this.activeGeneration) {
        this.logger.log('service_reply_rejected', {
          generation: message.generation,
          expectedGeneration: this.activeGeneration,
          reason: 'stale-generation',
        });
        return;
      }
      if (message.type === 'ready') {
        if (this.state !== 'starting' || this.child !== child || this.port !== port) {
          this.logger.log('service_reply_rejected', { generation, reason: 'generation-not-starting' });
          return;
        }
        if (useNodePermissions && message.permissionOutsideDenied !== true) {
          permissionCompatibilityFallback = isPermissionCompatibilityReply(message);
          rejectHandshake(new Error('SERVICE_FAILED: Node permission probe did not deny outside read'));
          return;
        }
        if (useNodePermissions) this.permissionProbe = 'passed';
        this.state = 'ready';
        this.readyGeneration = generation;
        this.readyLease = {
          child,
          port,
          activeGeneration: generation,
          readyGeneration: generation,
          state: 'ready',
        };
        this.logger.log('service_ready', {
          generation,
          pid: message.pid,
          permissionOutsideDenied: message.permissionOutsideDenied,
          permissionProbe: this.permissionProbe,
        });
        resolveHandshake();
        return;
      }

      this.counters.received = message.received;
      const registryGeneration = this.activeRegistryGeneration;
      if (registryGeneration === null) return;
      const outcome = message.ok
        ? this.ledger.settle(message.correlationId, registryGeneration, generation, {
          state: 'read',
          sha256: message.sha256,
          size: message.size,
          generation: registryGeneration,
        })
        : this.ledger.reject(
          message.correlationId,
          registryGeneration,
          generation,
          new Error('SERVICE_FAILED: service read failed'),
        );
      if (outcome !== 'accepted') {
        this.logger.log('service_reply_rejected', {
          generation,
          reason: outcome === 'mismatched' ? 'generation-mismatch' : 'stale-correlation',
        });
      }
    });

    child.once('spawn', () => {
      const initialize: ServiceInitializeMessage = {
        version: SERVICE_PROTOCOL_VERSION,
        type: 'initialize',
        generation,
      };
      child.postMessage(initialize, [channel.port1]);
    });
    void exitPromise.then((code) => {
      if (this.readyGeneration !== generation) {
        rejectHandshake(new Error(`SERVICE_FAILED: service exited during handshake with code ${code}`));
      }
    });

    try {
      await handshake;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('SERVICE_FAILED: handshake failed');
      if (useNodePermissions && permissionCompatibilityFallback) {
        this.permissionProbe = 'failed';
        this.logger.log('node_permission_probe_failed', { code: 'SERVICE_FAILED', generation });
        await this.stop();
        await this.start(false);
        return;
      }
      this.failGeneration(generation, failure);
      await this.stop().catch(() => undefined);
      throw failure;
    } finally {
      clearTimeout(handshakeTimeout);
    }
  }

  async stop(timeoutMs = 3_000): Promise<void> {
    const child = this.child;
    const generation = this.activeGeneration;
    const exitWaiter = this.exitWaiter;
    if (!child || generation === null) {
      this.state = 'stopped';
      this.clearReadiness();
      this.port?.close();
      this.port = null;
      this.child = null;
      this.activeGeneration = null;
      this.exitWaiter = null;
      return;
    }
    if (!exitWaiter || exitWaiter.child !== child || exitWaiter.generation !== generation) {
      this.state = 'failed';
      this.clearReadiness();
      this.counters.failures += 1;
      throw new Error('SERVICE_FAILED: service exit tracking is unavailable');
    }
    this.state = 'stopping';
    const registryGeneration = this.activeRegistryGeneration;
    this.clearReadiness(registryGeneration, generation);
    if (registryGeneration !== null) {
      this.ledger.cancelGeneration(registryGeneration, generation);
    }
    this.stoppingGenerations.add(generation);
    child.kill();
    const result = await Promise.race([
      exitWaiter.promise.then(() => 'exited' as const),
      delay(timeoutMs).then(() => 'timeout' as const),
    ]);
    if (result !== 'exited') {
      this.stoppingGenerations.delete(generation);
      this.state = 'failed';
      this.counters.failures += 1;
      this.logger.log('service_stop_failed', { code: 'TIMEOUT', generation });
      throw new Error('TIMEOUT: service generation did not exit');
    }
  }

  async request(request: ServiceRequest): Promise<ServiceReply> {
    const registryGeneration = request.generation;
    if (this.activeRegistryGeneration === null || registryGeneration !== this.activeRegistryGeneration) {
      throw new Error('CAPABILITY_DENIED: filesystem plugin lifecycle is not active');
    }
    this.claimRendererRequestId(request.requestId);
    if (!this.initialPath) throw new Error('SERVICE_FAILED: no fixture path is available');
    const lease = this.captureReadinessLease();
    const serviceGeneration = lease.readyGeneration;
    const root = path.dirname(await this.resolvePath(this.initialPath));
    this.assertLiveReadinessLease(lease);
    if (request.action === 'grant-read') {
      const grant = this.broker.grantRead(root, registryGeneration, serviceGeneration);
      this.capability = {
        grant: { id: grant.id, generation: registryGeneration, root: grant.publicRoot, state: 'active' },
        request: null,
        restartRequired: false,
      };
      this.emitCapability(registryGeneration, serviceGeneration);
      this.logger.log('capability_granted', { pluginId: FILESYSTEM_PLUGIN_ID, generation: registryGeneration });
      return { state: 'granted', grantId: grant.id, root: grant.publicRoot, generation: registryGeneration };
    }

    if (request.action === 'revoke-grant') {
      const revoked = this.broker.revoke(request.grantId, registryGeneration, serviceGeneration);
      if (!revoked && this.capability.grant?.id !== request.grantId) throw new Error('PLUGIN_STALE: grant is not current');
      const grant = this.capability.grant;
      if (grant?.id === request.grantId) {
        this.capability = { ...this.capability, grant: { ...grant, state: 'revoking' } };
        this.emitCapability(registryGeneration, serviceGeneration);
      }
      this.ledger.cancelGrant(request.grantId, registryGeneration, serviceGeneration);
      if (grant?.id === request.grantId) {
        this.capability = { ...this.capability, grant: { ...grant, state: 'revoked' } };
        this.emitCapability(registryGeneration, serviceGeneration);
      }
      return { state: 'revoked', grantId: request.grantId, generation: registryGeneration };
    }

    if (request.action === 'cancel-request') {
      const current = this.capability.request;
      if (current?.requestId === request.targetRequestId && current.state === 'pending') {
        this.capability = { ...this.capability, request: { ...current, state: 'cancelling', detail: 'Cancellation pending' } };
        this.emitCapability(registryGeneration, serviceGeneration);
      }
      const outcome = this.ledger.cancel(request.targetRequestId, registryGeneration, serviceGeneration);
      if (outcome !== 'accepted') throw new Error('PLUGIN_STALE: service request is not current');
      return { state: 'cancelled', targetRequestId: request.targetRequestId, generation: registryGeneration };
    }

    const grantId = request.grantId;
    const relativePath = request.action === 'deny-probe'
      ? path.join('..', 'denied-outside-grant.md')
      : path.basename(this.initialPath);
    let authorized;
    try {
      authorized = this.broker.authorizeRead(grantId, relativePath, registryGeneration, serviceGeneration);
    } catch (error) {
      this.capability = {
        ...this.capability,
        request: {
          requestId: request.requestId,
          generation: registryGeneration,
          action: request.action,
          state: 'failed',
          detail: 'Capability denied',
        },
      };
      this.emitCapability(registryGeneration, serviceGeneration);
      if (error instanceof CapabilityDeniedError) {
        this.logger.log('capability_denied', {
          pluginId: FILESYSTEM_PLUGIN_ID,
          requestId: request.requestId,
          relativePath,
          dispatched: false,
          generation: registryGeneration,
        });
      }
      throw error;
    }
    const resolvedTarget = await this.resolvePath(authorized.absolutePath);
    const relative = path.relative(authorized.grant.absoluteRoot, resolvedTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      this.broker.authorizeRead(undefined, relativePath, registryGeneration, serviceGeneration);
    }

    this.assertLiveReadinessLease(lease);
    const pending = this.ledger.begin({
      rendererRequestId: request.requestId,
      grantId,
      registryGeneration,
      serviceGeneration,
    });
    this.capability = {
      ...this.capability,
      request: {
        requestId: request.requestId,
        generation: registryGeneration,
        action: request.action,
        state: 'pending',
        detail: 'Read pending',
      },
    };
    this.emitCapability(registryGeneration, serviceGeneration);
    const message: ServiceReadMessage = {
      version: SERVICE_PROTOCOL_VERSION,
      type: 'read',
      pluginId: FILESYSTEM_PLUGIN_ID,
      correlationId: pending.correlationId,
      generation: serviceGeneration,
      grantId: authorized.grant.id,
      absolutePath: resolvedTarget,
    };
    this.counters.dispatched += 1;
    this.logger.log('service_request_dispatched', { generation: registryGeneration, operation: 'read' });
    lease.port.postMessage(message);
    return pending.promise;
  }

  private captureReadinessLease(): ReadinessLease {
    const lease = this.readyLease;
    if (!lease) throw new Error('SERVICE_STOPPED: service is not ready');
    this.assertLiveReadinessLease(lease);
    return lease;
  }

  private assertLiveReadinessLease(lease: ReadinessLease): void {
    if (this.readyLease !== lease
      || this.state !== lease.state
      || this.child !== lease.child
      || this.port !== lease.port
      || this.activeGeneration !== lease.activeGeneration
      || this.readyGeneration !== lease.readyGeneration
      || lease.activeGeneration !== lease.readyGeneration) {
      throw new Error('SERVICE_STOPPED: service readiness lease expired');
    }
  }

  private clearReadiness(registryGeneration = this.activeRegistryGeneration, serviceGeneration = this.activeGeneration): void {
    if (registryGeneration !== null && serviceGeneration !== null) {
      const grant = this.capability.grant;
      this.broker.revokeGeneration(registryGeneration, serviceGeneration);
      if (grant && grant.generation === registryGeneration && grant.state !== 'revoked') {
        this.capability = { ...this.capability, grant: { ...grant, state: 'revoked' } };
        this.emitCapability(registryGeneration, serviceGeneration);
      }
    }
    this.readyGeneration = null;
    this.readyLease = null;
  }

  private claimRendererRequestId(requestId: string): void {
    if (this.rendererRequestIds.has(requestId)) {
      throw new Error('BAD_REQUEST: duplicate renderer service request ID');
    }
    this.rendererRequestIds.add(requestId);
    if (this.rendererRequestIds.size <= 2_048) return;
    const oldest = this.rendererRequestIds.values().next().value;
    if (typeof oldest === 'string') this.rendererRequestIds.delete(oldest);
  }

  private captureServiceLog(stream: 'stdout' | 'stderr', chunk: unknown, generation: number): void {
    const summary = summarizeUntrustedText(chunk);
    if (summary.bytes === 0) return;
    this.logger.log('service_output', { stream, generation, ...summary });
  }

  private failGeneration(generation: number, error: Error): void {
    if (generation !== this.activeGeneration) return;
    const registryGeneration = this.activeRegistryGeneration;
    this.state = 'failed';
    this.clearReadiness(registryGeneration, generation);
    this.counters.failures += 1;
    this.logger.log('service_failed', { code: error.message.split(':', 1)[0], generation });
    if (registryGeneration !== null) this.ledger.failGeneration(registryGeneration, generation, error);
  }

  private emitCapability(registryGeneration: number, serviceGeneration: number): void {
    this.eventSink({
      type: 'capability',
      registryGeneration,
      serviceGeneration,
      capability: Object.freeze({
        grant: this.capability.grant ? Object.freeze({ ...this.capability.grant }) : null,
        request: this.capability.request ? Object.freeze({ ...this.capability.request }) : null,
        restartRequired: this.capability.restartRequired,
      }),
    });
  }
}

function sanitizeDetail(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 512);
}
