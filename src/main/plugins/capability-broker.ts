import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FILESYSTEM_PLUGIN_ID } from '../../shared/plugins/protocol';

export interface Grant {
  id: string;
  pluginId: typeof FILESYSTEM_PLUGIN_ID;
  registryGeneration: number;
  serviceGeneration: number;
  absoluteRoot: string;
  publicRoot: string;
}

export class CapabilityDeniedError extends Error {
  readonly code = 'CAPABILITY_DENIED';
  constructor(message: string) { super(`CAPABILITY_DENIED: ${message}`); }
}

export class CapabilityBroker {
  private readonly grants = new Map<string, Grant>();
  private readonly revoked = new Set<string>();
  readonly counters = { grants: 0, denials: 0 };
  get size(): number { return this.grants.size; }

  grantRead(absoluteRoot: string, registryGeneration = 1, serviceGeneration = 1): Grant {
    if (!isGeneration(registryGeneration) || !isGeneration(serviceGeneration)) return this.deny('Grant generation is invalid');
    // yagni: G005 intentionally permits one filesystem grant. Move to a per-plugin grant table
    // when installed plugins need concurrent independently scoped roots.
    if (this.grants.size > 0) return this.deny('A read capability is already active');
    const resolvedRoot = path.resolve(absoluteRoot);
    const grant: Grant = Object.freeze({
      id: `grant:${randomUUID()}`,
      pluginId: FILESYSTEM_PLUGIN_ID,
      registryGeneration,
      serviceGeneration,
      absoluteRoot: resolvedRoot,
      publicRoot: displayRoot(resolvedRoot),
    });
    this.grants.set(grant.id, grant);
    this.counters.grants += 1;
    return grant;
  }

  current(registryGeneration: number, serviceGeneration: number): Grant | null {
    for (const grant of this.grants.values()) {
      if (grant.registryGeneration === registryGeneration && grant.serviceGeneration === serviceGeneration) return grant;
    }
    return null;
  }

  authorizeRead(grantId: string | undefined, relativePath: string, registryGeneration?: number, serviceGeneration?: number): { absolutePath: string; grant: Grant } {
    const grant = grantId ? this.grants.get(grantId) : undefined;
    if (!grant || grant.pluginId !== FILESYSTEM_PLUGIN_ID
      || (registryGeneration !== undefined && grant.registryGeneration !== registryGeneration)
      || (serviceGeneration !== undefined && grant.serviceGeneration !== serviceGeneration)
      || path.isAbsolute(relativePath) || relativePath.length === 0 || relativePath.length > 512) {
      return this.deny('Read capability is missing or the requested path is invalid');
    }
    const absolutePath = path.resolve(grant.absoluteRoot, relativePath);
    const relative = path.relative(grant.absoluteRoot, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return this.deny('Requested path escapes the granted folder');
    return { absolutePath, grant };
  }

  revoke(grantId: string, registryGeneration?: number, serviceGeneration?: number): Grant | null {
    const grant = this.grants.get(grantId);
    if (!grant) return this.revoked.has(grantId) ? null : this.deny('Grant is unknown');
    if ((registryGeneration !== undefined && grant.registryGeneration !== registryGeneration)
      || (serviceGeneration !== undefined && grant.serviceGeneration !== serviceGeneration)) {
      throw new Error('PLUGIN_STALE: grant belongs to another generation');
    }
    this.grants.delete(grantId);
    this.revoked.add(grantId);
    return grant;
  }

  revokeGeneration(registryGeneration: number, serviceGeneration?: number): Grant[] {
    const revoked: Grant[] = [];
    for (const [grantId, grant] of this.grants) {
      if (grant.registryGeneration !== registryGeneration || (serviceGeneration !== undefined && grant.serviceGeneration !== serviceGeneration)) continue;
      this.grants.delete(grantId);
      this.revoked.add(grantId);
      revoked.push(grant);
    }
    return revoked;
  }

  private deny(message: string): never {
    this.counters.denials += 1;
    throw new CapabilityDeniedError(message);
  }
}

function isGeneration(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }

function displayRoot(absoluteRoot: string): string {
  return (path.basename(absoluteRoot)
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'folder').slice(0, 256);
}
