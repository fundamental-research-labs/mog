/**
 * Capability Registry
 *
 * Central registry for managing capability grants. This is the main
 * entry point for the capability system in the kernel.
 *
 * Key behaviors:
 * - hasCapability checks direct grants AND implied capabilities
 * - grant automatically grants all dependencies
 * - revoke also revokes capabilities that depend on the revoked one
 * - Emits events for UI reactivity
 *
 */

import type { CapabilityType } from './cap-types';
import type { AppId, CapabilityGrant, GrantOptions, IGrantsStore } from './grants';
import { isGrantExpired } from './grants';
import type { CapabilityScope } from './scope';
import { scopeMatches } from './scope';
import { CAPABILITY_IMPLIES, expandWithDependencies, getCapabilitiesImplying } from './taxonomy';

import type { ICapabilityAuditLog, ICapabilityRegistry, RegistryEvent } from './types';

import { TypedEventEmitter } from '../primitives';

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event map for CapabilityRegistry.
 * Each key is an event name; each value is the payload type.
 */
export type CapabilityEvents = {
  'capability:granted': RegistryEvent;
  'capability:revoked': RegistryEvent;
};

// =============================================================================
// Capability Registry
// =============================================================================

/**
 * Capability Registry - manages capability grants for apps.
 *
 * This is the main interface for checking, granting, and revoking capabilities.
 * It handles dependency expansion (grant write -> also grant read) and
 * cascading revocation (revoke read -> also revoke write).
 *
 * Extends TypedEventEmitter for typed, error-isolated event subscriptions.
 * Consumers use `registry.on('capability:granted', handler)` which returns
 * an IDisposable (call `.dispose()` to unsubscribe).
 */
export class CapabilityRegistry
  extends TypedEventEmitter<CapabilityEvents>
  implements ICapabilityRegistry
{
  private readonly store: IGrantsStore;
  private readonly auditLogger?: ICapabilityAuditLog;

  constructor(store: IGrantsStore, auditLogger?: ICapabilityAuditLog) {
    super();
    this.store = store;
    this.auditLogger = auditLogger;
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Check if an app has a specific capability.
   *
   * This checks:
   * 1. Direct grants for the capability
   * 2. Implied capabilities (e.g., if app has 'cells:write', it also has 'cells:read')
   * 3. Scope matching if a scope is provided
   * 4. Expiration status
   *
   * @param appId - The app to check
   * @param capability - The capability to check for
   * @param scope - Optional scope to check (resource type and ID)
   * @returns True if the app has the capability (and it's not expired)
   */
  hasCapability(
    appId: AppId,
    capability: CapabilityType,
    scope?: { resourceType: string; resourceId: string },
  ): boolean {
    // First, check for direct grant
    if (this.hasDirectGrant(appId, capability, scope)) {
      this.logAudit(appId, capability, 'check-passed', scope);
      return true;
    }

    // Check for implied capabilities
    // If the app has a capability that implies this one, they have it
    const impliers = this.getCapabilitiesImplyingTransitive(capability);
    for (const implier of impliers) {
      if (this.hasDirectGrant(appId, implier, scope)) {
        this.logAudit(appId, capability, 'check-passed', scope);
        return true;
      }
    }

    this.logAudit(appId, capability, 'check-failed', scope);
    return false;
  }

  /**
   * Check if an app has a direct grant for a capability.
   */
  private hasDirectGrant(
    appId: AppId,
    capability: CapabilityType,
    scope?: { resourceType: string; resourceId: string },
  ): boolean {
    const grant = this.store.getGrant(appId, capability);
    if (!grant) return false;

    // Check expiration
    if (isGrantExpired(grant)) {
      // Clean up expired grant
      this.store.revoke(appId, capability);
      this.logAudit(appId, capability, 'expired');
      return false;
    }

    // Check scope if provided
    if (scope && grant.scope) {
      return scopeMatches(grant.scope, scope.resourceType, scope.resourceId);
    }

    // If scope is requested but grant has no scope, it's unrestricted
    return true;
  }

  /**
   * Get all capabilities that transitively imply the given capability.
   *
   * For example, if 'tables:writeAll' implies 'tables:readAll' which implies 'tables:read',
   * then getCapabilitiesImplyingTransitive('tables:read') returns
   * ['tables:readAll', 'tables:writeAll', 'tables:write', ...]
   */
  private getCapabilitiesImplyingTransitive(capability: CapabilityType): CapabilityType[] {
    const result = new Set<CapabilityType>();
    const queue = [capability];
    const visited = new Set<CapabilityType>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const impliers = getCapabilitiesImplying(current);
      for (const implier of impliers) {
        if (!result.has(implier)) {
          result.add(implier);
          queue.push(implier);
        }
      }
    }

    return Array.from(result);
  }

  /**
   * Get all grants for an app.
   */
  getGrants(appId: AppId): readonly CapabilityGrant[] {
    return this.store.getActiveGrants(appId);
  }

  /**
   * Get the effective capabilities for an app, including implied ones.
   *
   * For example, if an app has 'cells:write', this returns
   * ['cells:write', 'cells:read'] since write implies read.
   */
  getEffectiveCapabilities(appId: AppId): CapabilityType[] {
    const grants = this.store.getActiveGrants(appId);
    const directCapabilities = grants.map((g) => g.capability);
    return expandWithDependencies(directCapabilities);
  }

  // ===========================================================================
  // Mutation Methods
  // ===========================================================================

  /**
   * Grant a capability to an app.
   *
   * This automatically grants all dependencies. For example, granting 'cells:write'
   * will also grant 'cells:read' since write implies read.
   *
   * @param appId - The app to grant to
   * @param capability - The capability to grant
   * @param options - Grant options (scope, session, expiration)
   */
  grant(appId: AppId, capability: CapabilityType, options?: GrantOptions): void {
    // Expand to include all dependencies
    const capabilities = expandWithDependencies([capability]);

    // Grant each capability
    for (const cap of capabilities) {
      const grant = this.store.grant(appId, cap, options);
      this.logAudit(appId, cap, 'granted');
      this.emit('capability:granted', {
        type: 'capability:granted',
        appId,
        capability: cap,
        grant,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Grant multiple capabilities to an app.
   *
   * Dependencies are automatically expanded.
   */
  grantBatch(appId: AppId, capabilities: readonly CapabilityType[], options?: GrantOptions): void {
    // Expand all capabilities with their dependencies
    const expanded = expandWithDependencies(capabilities);

    // Grant each capability
    for (const cap of expanded) {
      const grant = this.store.grant(appId, cap, options);
      this.logAudit(appId, cap, 'granted');
      this.emit('capability:granted', {
        type: 'capability:granted',
        appId,
        capability: cap,
        grant,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Revoke a capability from an app.
   *
   * This also revokes capabilities that depend on the revoked one.
   * For example, revoking 'cells:read' will also revoke 'cells:write'
   * since write depends on read.
   *
   * @param appId - The app to revoke from
   * @param capability - The capability to revoke
   */
  revoke(appId: AppId, capability: CapabilityType): void {
    // Get all capabilities that depend on this one (must be revoked too)
    const toRevoke = this.getCapabilitiesRequiring(capability);
    toRevoke.unshift(capability);

    // Revoke each capability
    for (const cap of toRevoke) {
      const had = this.store.revoke(appId, cap);
      if (had) {
        this.logAudit(appId, cap, 'revoked');
        this.emit('capability:revoked', {
          type: 'capability:revoked',
          appId,
          capability: cap,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Get all capabilities that require (depend on) the given capability.
   *
   * For example, 'cells:write' requires 'cells:read', so if we revoke 'cells:read',
   * we must also revoke 'cells:write'.
   */
  private getCapabilitiesRequiring(capability: CapabilityType): CapabilityType[] {
    const result: CapabilityType[] = [];
    const visited = new Set<CapabilityType>();
    const queue = [capability];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Find capabilities that have this one in their implies list
      for (const [cap, implied] of Object.entries(CAPABILITY_IMPLIES)) {
        if (implied && implied.includes(current) && !visited.has(cap as CapabilityType)) {
          result.push(cap as CapabilityType);
          queue.push(cap as CapabilityType);
        }
      }
    }

    return result;
  }

  /**
   * Revoke all capabilities from an app.
   *
   * @param appId - The app to revoke from
   * @returns Number of grants revoked
   */
  revokeAll(appId: AppId): number {
    // Get current grants before revoking
    const grants = this.store.getActiveGrants(appId);
    const count = this.store.revokeAll(appId);

    // Emit events and log for each revoked grant
    for (const grant of grants) {
      this.logAudit(appId, grant.capability, 'revoked-all');
      this.emit('capability:revoked', {
        type: 'capability:revoked',
        appId,
        capability: grant.capability,
        timestamp: Date.now(),
      });
    }

    return count;
  }

  // ===========================================================================
  // Dependency Expansion
  // ===========================================================================

  /**
   * Expand a set of capabilities to include all implied dependencies.
   *
   * This is useful for showing users what capabilities they're actually granting.
   *
   * @param capabilities - The capabilities to expand
   * @returns Expanded capabilities including all dependencies
   */
  expandCapabilities(capabilities: readonly CapabilityType[]): CapabilityType[] {
    return expandWithDependencies(capabilities);
  }

  // ===========================================================================
  // Scoping
  // ===========================================================================

  /**
   * Check if a capability grant is scoped.
   */
  isCapabilityScoped(appId: AppId, capability: CapabilityType): boolean {
    const grant = this.store.getGrant(appId, capability);
    return grant?.scope != null;
  }

  /**
   * Get the scope for a capability grant.
   */
  getCapabilityScope(appId: AppId, capability: CapabilityType): CapabilityScope | null {
    const grant = this.store.getGrant(appId, capability);
    return grant?.scope ?? null;
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Clean up expired grants.
   *
   * This should be called periodically (e.g., every minute).
   *
   * @returns Number of grants cleaned up
   */
  cleanupExpired(): number {
    return this.store.cleanupExpired();
  }

  // ===========================================================================
  // Store Subscriptions (Passthrough)
  // ===========================================================================

  /**
   * Subscribe to grant changes for an app.
   *
   * This is a passthrough to the underlying store.
   */
  subscribeToApp(appId: AppId, callback: Parameters<IGrantsStore['subscribe']>[1]): () => void {
    return this.store.subscribe(appId, callback);
  }

  /**
   * Subscribe to all grant changes.
   *
   * This is a passthrough to the underlying store.
   */
  subscribeToAll(callback: Parameters<IGrantsStore['subscribeAll']>[0]): () => void {
    return this.store.subscribeAll(callback);
  }

  // ===========================================================================
  // Audit Logging
  // ===========================================================================

  /**
   * Log an audit entry.
   */
  private logAudit(
    appId: AppId,
    capability: CapabilityType,
    eventType: 'granted' | 'revoked' | 'revoked-all' | 'expired' | 'check-passed' | 'check-failed',
    scope?: { resourceType: string; resourceId: string },
  ): void {
    if (!this.auditLogger) return;

    this.auditLogger.log({
      appId,
      capability,
      eventType,
      resourceType: scope?.resourceType,
      resourceId: scope?.resourceId,
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Dispose of the registry, clearing all event handlers.
   */
  protected _dispose(): void {
    super._dispose();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new capability registry instance.
 */
export function createCapabilityRegistry(
  store: IGrantsStore,
  auditLogger?: ICapabilityAuditLog,
): ICapabilityRegistry {
  return new CapabilityRegistry(store, auditLogger);
}
