/**
 * In-Memory Grants Store
 *
 * Simple Map-based implementation of IGrantsStore for testing.
 * Not suitable for production use - grants are lost on restart.
 *
 */

import type { CapabilityType } from '../cap-types';
import type {
  AppId,
  CapabilityDenial,
  CapabilityGrant,
  GrantChangeEvent,
  GrantOptions,
  IGrantsStore,
} from '../grants';
import { createGrant, isGrantExpired } from '../grants';
import { scopeMatches } from '../scope';

// =============================================================================
// Memory Grants Store
// =============================================================================

/**
 * In-memory implementation of IGrantsStore.
 *
 * Uses nested Maps for O(1) lookups:
 * - grants: Map<AppId, Map<CapabilityType, CapabilityGrant>>
 * - denials: Map<AppId, Map<CapabilityType, CapabilityDenial>>
 */
export class MemoryGrantsStore implements IGrantsStore {
  /** Grants by app and capability */
  private grants = new Map<AppId, Map<CapabilityType, CapabilityGrant>>();

  /** Denials by app and capability */
  private denials = new Map<AppId, Map<CapabilityType, CapabilityDenial>>();

  /** Subscribers per app */
  private appSubscribers = new Map<AppId, Set<(event: GrantChangeEvent) => void>>();

  /** Global subscribers */
  private globalSubscribers = new Set<(event: GrantChangeEvent) => void>();

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  hasGrant(
    appId: AppId,
    capability: CapabilityType,
    scope?: { resourceType: string; resourceId: string },
  ): boolean {
    const grant = this.getGrant(appId, capability);
    if (!grant) return false;

    // Check expiration
    if (isGrantExpired(grant)) {
      // Clean up expired grant
      this.revoke(appId, capability);
      return false;
    }

    // Check scope if provided
    if (scope && grant.scope) {
      return scopeMatches(grant.scope, scope.resourceType, scope.resourceId);
    }

    return true;
  }

  getGrants(appId: AppId): readonly CapabilityGrant[] {
    const appGrants = this.grants.get(appId);
    if (!appGrants) return [];
    return Array.from(appGrants.values());
  }

  getActiveGrants(appId: AppId): readonly CapabilityGrant[] {
    const appGrants = this.grants.get(appId);
    if (!appGrants) return [];

    const now = Date.now();
    const active: CapabilityGrant[] = [];

    for (const grant of appGrants.values()) {
      if (!grant.expiresAt || grant.expiresAt > now) {
        active.push(grant);
      }
    }

    return active;
  }

  getGrant(appId: AppId, capability: CapabilityType): CapabilityGrant | undefined {
    return this.grants.get(appId)?.get(capability);
  }

  isDenied(appId: AppId, capability: CapabilityType): boolean {
    return this.denials.get(appId)?.has(capability) ?? false;
  }

  getDenial(appId: AppId, capability: CapabilityType): CapabilityDenial | undefined {
    return this.denials.get(appId)?.get(capability);
  }

  // ===========================================================================
  // Mutation Methods
  // ===========================================================================

  grant(appId: AppId, capability: CapabilityType, options?: GrantOptions): CapabilityGrant {
    // Clear any previous denial
    this.clearDenial(appId, capability);

    // Get or create app grants map
    let appGrants = this.grants.get(appId);
    if (!appGrants) {
      appGrants = new Map();
      this.grants.set(appId, appGrants);
    }

    // Create the grant
    const grant = createGrant(appId, capability, options);
    appGrants.set(capability, grant);

    // Notify subscribers
    this.notifyChange({
      type: 'granted',
      appId,
      capability,
      grant,
      timestamp: Date.now(),
    });

    return grant;
  }

  grantBatch(
    appId: AppId,
    capabilities: readonly CapabilityType[],
    options?: GrantOptions,
  ): readonly CapabilityGrant[] {
    return capabilities.map((cap) => this.grant(appId, cap, options));
  }

  revoke(appId: AppId, capability: CapabilityType): boolean {
    const appGrants = this.grants.get(appId);
    if (!appGrants) return false;

    const had = appGrants.delete(capability);
    if (had) {
      this.notifyChange({
        type: 'revoked',
        appId,
        capability,
        timestamp: Date.now(),
      });
    }

    return had;
  }

  revokeAll(appId: AppId): number {
    const appGrants = this.grants.get(appId);
    if (!appGrants) return 0;

    const count = appGrants.size;
    const capabilities = Array.from(appGrants.keys());

    appGrants.clear();

    // Notify for each revoked capability
    for (const capability of capabilities) {
      this.notifyChange({
        type: 'revoked',
        appId,
        capability,
        timestamp: Date.now(),
      });
    }

    return count;
  }

  deny(appId: AppId, capability: CapabilityType, reason?: string): void {
    // Get or create app denials map
    let appDenials = this.denials.get(appId);
    if (!appDenials) {
      appDenials = new Map();
      this.denials.set(appId, appDenials);
    }

    const denial: CapabilityDenial = {
      appId,
      capability,
      deniedAt: Date.now(),
      reason,
    };

    appDenials.set(capability, denial);

    this.notifyChange({
      type: 'denied',
      appId,
      capability,
      timestamp: Date.now(),
    });
  }

  clearDenial(appId: AppId, capability: CapabilityType): void {
    const appDenials = this.denials.get(appId);
    if (!appDenials) return;

    const had = appDenials.delete(capability);
    if (had) {
      this.notifyChange({
        type: 'denial-cleared',
        appId,
        capability,
        timestamp: Date.now(),
      });
    }
  }

  cleanupExpired(): number {
    let count = 0;
    const now = Date.now();

    for (const [appId, appGrants] of this.grants) {
      for (const [capability, grant] of appGrants) {
        if (grant.expiresAt && grant.expiresAt <= now) {
          appGrants.delete(capability);
          count++;

          this.notifyChange({
            type: 'expired',
            appId,
            capability,
            timestamp: now,
          });
        }
      }
    }

    return count;
  }

  // ===========================================================================
  // Subscription Methods
  // ===========================================================================

  subscribe(appId: AppId, callback: (event: GrantChangeEvent) => void): () => void {
    let appSubs = this.appSubscribers.get(appId);
    if (!appSubs) {
      appSubs = new Set();
      this.appSubscribers.set(appId, appSubs);
    }

    appSubs.add(callback);

    return () => {
      appSubs?.delete(callback);
    };
  }

  subscribeAll(callback: (event: GrantChangeEvent) => void): () => void {
    this.globalSubscribers.add(callback);

    return () => {
      this.globalSubscribers.delete(callback);
    };
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private notifyChange(event: GrantChangeEvent): void {
    // Notify app-specific subscribers
    const appSubs = this.appSubscribers.get(event.appId);
    if (appSubs) {
      for (const callback of appSubs) {
        try {
          callback(event);
        } catch (error) {
          console.error('[MemoryGrantsStore] Subscriber error:', error);
        }
      }
    }

    // Notify global subscribers
    for (const callback of this.globalSubscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error('[MemoryGrantsStore] Global subscriber error:', error);
      }
    }
  }

  // ===========================================================================
  // Testing Helpers
  // ===========================================================================

  /**
   * Clear all grants and denials (for testing).
   */
  clear(): void {
    this.grants.clear();
    this.denials.clear();
  }

  /**
   * Get total grant count (for testing).
   */
  getGrantCount(): number {
    let count = 0;
    for (const appGrants of this.grants.values()) {
      count += appGrants.size;
    }
    return count;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new in-memory grants store.
 */
export function createMemoryGrantsStore(): MemoryGrantsStore {
  return new MemoryGrantsStore();
}
