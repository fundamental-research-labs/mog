import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import { toDisposable } from '@mog/spreadsheet-utils/disposable';
import {
  expandCapabilities,
  getAllCapabilities,
  scopeMatches,
  type AppId,
  type AuditEventType,
  type CapabilityEventMap,
  type CapabilityGrant,
  type CapabilityScope,
  type CapabilityType,
  type GrantChangeEvent,
  type GrantOptions,
  type ICapabilityRegistry,
  type RegistryEvent,
} from '@mog-sdk/kernel/security';

import {
  createShellCapabilityAuditLog,
  type ShellCapabilityAuditLog,
  type ShellCapabilityAuditOptions,
} from './audit-log';

type CapabilityScopeQuery = { resourceType: string; resourceId: string };
type RegistryEventName = keyof CapabilityEventMap;
type RegistryEventHandler = (event: RegistryEvent) => void;
type GrantChangeHandler = (event: GrantChangeEvent) => void;

export interface ShellCapabilityRegistryOptions {
  readonly audit?: boolean | ShellCapabilityAuditOptions;
}

export interface ShellCapabilityRegistry extends ICapabilityRegistry {
  readonly auditLogger: ShellCapabilityAuditLog | null;
  dispose(): void;
}

export class InMemoryShellCapabilityRegistry implements ShellCapabilityRegistry {
  private readonly grants = new Map<AppId, Map<CapabilityType, CapabilityGrant>>();
  private readonly eventListeners: Record<RegistryEventName, Set<RegistryEventHandler>> = {
    'capability:granted': new Set(),
    'capability:revoked': new Set(),
  };
  private readonly appGrantListeners = new Map<AppId, Set<GrantChangeHandler>>();
  private readonly grantListeners = new Set<GrantChangeHandler>();
  private readonly permissive: boolean;
  private disposed = false;

  readonly auditLogger: ShellCapabilityAuditLog | null;

  constructor(options?: ShellCapabilityRegistryOptions & { readonly permissive?: boolean }) {
    this.permissive = options?.permissive ?? false;
    this.auditLogger = createAuditLogger(options?.audit);
  }

  on<K extends keyof CapabilityEventMap>(
    event: K,
    handler: (data: CapabilityEventMap[K]) => void,
  ): CallableDisposable {
    const wrapped: RegistryEventHandler = (data) => handler(data as CapabilityEventMap[K]);
    this.eventListeners[event].add(wrapped);
    return toDisposable(() => this.eventListeners[event].delete(wrapped));
  }

  once<K extends keyof CapabilityEventMap>(
    event: K,
    handler: (data: CapabilityEventMap[K]) => void,
  ): CallableDisposable {
    const disposable = this.on(event, (data) => {
      disposable.dispose();
      handler(data);
    });
    return disposable;
  }

  hasCapability(appId: AppId, capability: CapabilityType, scope?: CapabilityScopeQuery): boolean {
    if (this.permissive) {
      this.logAudit(appId, capability, 'check-passed', scope);
      return true;
    }

    if (this.hasActiveGrant(appId, capability, scope)) {
      this.logAudit(appId, capability, 'check-passed', scope);
      return true;
    }

    const activeGrants = this.getActiveGrants(appId);
    for (const grant of activeGrants) {
      if (
        expandCapabilities([grant.capability]).includes(capability) &&
        this.grantScopeMatches(grant, scope)
      ) {
        this.logAudit(appId, capability, 'check-passed', scope);
        return true;
      }
    }

    this.logAudit(appId, capability, 'check-failed', scope);
    return false;
  }

  getGrants(appId: AppId): readonly CapabilityGrant[] {
    return [...(this.grants.get(appId)?.values() ?? [])];
  }

  getEffectiveCapabilities(appId: AppId): CapabilityType[] {
    if (this.permissive) return getAllCapabilities();
    return expandCapabilities(this.getActiveGrants(appId).map((grant) => grant.capability));
  }

  grant(appId: AppId, capability: CapabilityType, options?: GrantOptions): void {
    this.grantExpanded(appId, expandCapabilities([capability]), options);
  }

  grantBatch(appId: AppId, capabilities: readonly CapabilityType[], options?: GrantOptions): void {
    this.grantExpanded(appId, expandCapabilities(capabilities), options);
  }

  revoke(appId: AppId, capability: CapabilityType): void {
    const toRevoke = new Set<CapabilityType>([capability]);
    for (const grant of this.getActiveGrants(appId)) {
      if (expandCapabilities([grant.capability]).includes(capability)) {
        toRevoke.add(grant.capability);
      }
    }

    for (const cap of toRevoke) {
      this.revokeDirect(appId, cap, 'revoked');
    }
  }

  revokeAll(appId: AppId): number {
    const activeGrants = this.getActiveGrants(appId);
    this.grants.delete(appId);

    for (const grant of activeGrants) {
      this.logAudit(appId, grant.capability, 'revoked-all');
      this.emitGrantChange({
        type: 'revoked',
        appId,
        capability: grant.capability,
        timestamp: Date.now(),
      });
      this.emitRegistryEvent('capability:revoked', {
        type: 'capability:revoked',
        appId,
        capability: grant.capability,
        timestamp: Date.now(),
      });
    }

    return activeGrants.length;
  }

  expandCapabilities(capabilities: readonly CapabilityType[]): CapabilityType[] {
    return expandCapabilities(capabilities);
  }

  isCapabilityScoped(appId: AppId, capability: CapabilityType): boolean {
    return this.grants.get(appId)?.get(capability)?.scope != null;
  }

  getCapabilityScope(appId: AppId, capability: CapabilityType): CapabilityScope | null {
    return this.grants.get(appId)?.get(capability)?.scope ?? null;
  }

  cleanupExpired(): number {
    let count = 0;
    const now = Date.now();

    for (const [appId, appGrants] of this.grants) {
      for (const [capability, grant] of appGrants) {
        if (grant.expiresAt !== undefined && grant.expiresAt <= now) {
          appGrants.delete(capability);
          count++;
          this.logAudit(appId, capability, 'expired');
          this.emitGrantChange({ type: 'expired', appId, capability, timestamp: now });
        }
      }
      if (appGrants.size === 0) this.grants.delete(appId);
    }

    return count;
  }

  subscribeToApp(appId: AppId, callback: GrantChangeHandler): () => void {
    let listeners = this.appGrantListeners.get(appId);
    if (!listeners) {
      listeners = new Set();
      this.appGrantListeners.set(appId, listeners);
    }
    listeners.add(callback);
    return () => listeners?.delete(callback);
  }

  subscribeToAll(callback: GrantChangeHandler): () => void {
    this.grantListeners.add(callback);
    return () => this.grantListeners.delete(callback);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.grants.clear();
    this.eventListeners['capability:granted'].clear();
    this.eventListeners['capability:revoked'].clear();
    this.appGrantListeners.clear();
    this.grantListeners.clear();
    this.auditLogger?.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  private grantExpanded(
    appId: AppId,
    capabilities: readonly CapabilityType[],
    options?: GrantOptions,
  ): void {
    let appGrants = this.grants.get(appId);
    if (!appGrants) {
      appGrants = new Map();
      this.grants.set(appId, appGrants);
    }

    for (const capability of capabilities) {
      const grant = createGrant(appId, capability, options);
      appGrants.set(capability, grant);
      this.logAudit(appId, capability, 'granted');
      this.emitGrantChange({
        type: 'granted',
        appId,
        capability,
        grant,
        timestamp: Date.now(),
      });
      this.emitRegistryEvent('capability:granted', {
        type: 'capability:granted',
        appId,
        capability,
        grant,
        timestamp: Date.now(),
      });
    }
  }

  private revokeDirect(
    appId: AppId,
    capability: CapabilityType,
    changeType: GrantChangeEvent['type'],
  ): boolean {
    const appGrants = this.grants.get(appId);
    if (!appGrants) return false;
    const hadGrant = appGrants.delete(capability);
    if (!hadGrant) return false;
    if (appGrants.size === 0) this.grants.delete(appId);

    this.logAudit(appId, capability, changeType === 'expired' ? 'expired' : 'revoked');
    this.emitGrantChange({ type: changeType, appId, capability, timestamp: Date.now() });
    if (changeType !== 'expired') {
      this.emitRegistryEvent('capability:revoked', {
        type: 'capability:revoked',
        appId,
        capability,
        timestamp: Date.now(),
      });
    }
    return true;
  }

  private getActiveGrants(appId: AppId): CapabilityGrant[] {
    const grants = this.grants.get(appId);
    if (!grants) return [];
    return [...grants.values()].filter((grant) => !isGrantExpired(grant));
  }

  private hasActiveGrant(
    appId: AppId,
    capability: CapabilityType,
    scope?: CapabilityScopeQuery,
  ): boolean {
    const grant = this.grants.get(appId)?.get(capability);
    if (!grant) return false;
    if (isGrantExpired(grant)) {
      this.revokeDirect(appId, capability, 'expired');
      return false;
    }
    return this.grantScopeMatches(grant, scope);
  }

  private grantScopeMatches(grant: CapabilityGrant, scope?: CapabilityScopeQuery): boolean {
    if (!scope) return true;
    if (!grant.scope) return true;
    return scopeMatches(grant.scope, scope.resourceType, scope.resourceId);
  }

  private emitRegistryEvent(event: RegistryEventName, data: RegistryEvent): void {
    for (const listener of this.eventListeners[event]) {
      listener(data);
    }
  }

  private emitGrantChange(event: GrantChangeEvent): void {
    const appListeners = this.appGrantListeners.get(event.appId);
    if (appListeners) {
      for (const listener of appListeners) listener(event);
    }
    for (const listener of this.grantListeners) listener(event);
  }

  private logAudit(
    appId: AppId,
    capability: CapabilityType,
    eventType: AuditEventType,
    scope?: CapabilityScopeQuery,
  ): void {
    this.auditLogger?.log({
      appId,
      capability,
      eventType,
      resourceType: scope?.resourceType,
      resourceId: scope?.resourceId,
    });
  }
}

function createGrant(
  appId: AppId,
  capability: CapabilityType,
  options?: GrantOptions,
): CapabilityGrant {
  const now = Date.now();
  const expiresAt =
    options?.expiresAt ?? (options?.duration !== undefined ? now + options.duration : undefined);

  return {
    appId,
    capability,
    scope: options?.scope,
    grantedAt: now,
    grantedBy: options?.source ?? 'user',
    sessionOnly: options?.sessionOnly,
    expiresAt,
    userId: options?.userId ?? null,
  };
}

function isGrantExpired(grant: CapabilityGrant): boolean {
  return grant.expiresAt !== undefined && Date.now() >= grant.expiresAt;
}

function createAuditLogger(
  audit: ShellCapabilityRegistryOptions['audit'] | undefined,
): ShellCapabilityAuditLog | null {
  if (audit === false) return null;
  return createShellCapabilityAuditLog(audit === true || audit === undefined ? undefined : audit);
}

export function createShellCapabilityRegistry(
  options?: ShellCapabilityRegistryOptions,
): ShellCapabilityRegistry {
  return new InMemoryShellCapabilityRegistry(options);
}

export function createPermissiveShellCapabilityRegistry(
  options?: ShellCapabilityRegistryOptions,
): ShellCapabilityRegistry {
  return new InMemoryShellCapabilityRegistry({ ...options, permissive: true });
}
