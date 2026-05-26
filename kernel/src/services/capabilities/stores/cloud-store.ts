/**
 * Cloud Grants Store
 *
 * Cloud/server-side implementation of IGrantsStore for web.
 * Uses vector clocks for conflict detection with fail-secure resolution.
 *
 * Key principles:
 * - Vector clocks for conflict detection
 * - CRITICAL: Revocations always win (fail-secure)
 * - Concurrent grants: timestamp tiebreaker
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
import { scopeMatches } from '../scope';

import type { CloudGrant, CloudStoreOptions, VectorClock, VectorClockComparison } from '../types';

// =============================================================================
// Vector Clock Utilities
// =============================================================================

/**
 * Compare two vector clocks.
 *
 * Returns:
 * - 'before': a happened before b
 * - 'after': a happened after b
 * - 'concurrent': a and b are concurrent (conflict)
 * - 'equal': a and b are identical
 */
export function compareVectorClocks(a: VectorClock, b: VectorClock): VectorClockComparison {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  let aBeforeB = false;
  let bBeforeA = false;

  for (const key of allKeys) {
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;

    if (aVal < bVal) aBeforeB = true;
    if (bVal < aVal) bBeforeA = true;
  }

  if (aBeforeB && !bBeforeA) return 'before';
  if (bBeforeA && !aBeforeB) return 'after';
  if (aBeforeB && bBeforeA) return 'concurrent';
  return 'equal';
}

/**
 * Merge two vector clocks (take max of each component).
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };

  for (const [key, value] of Object.entries(b)) {
    result[key] = Math.max(result[key] ?? 0, value);
  }

  return result;
}

/**
 * Increment a vector clock for a specific node.
 */
export function incrementVectorClock(clock: VectorClock, nodeId: string): VectorClock {
  return {
    ...clock,
    [nodeId]: (clock[nodeId] ?? 0) + 1,
  };
}

// =============================================================================
// Cloud Grants Store
// =============================================================================

/**
 * Cloud-based implementation of IGrantsStore.
 *
 * Features:
 * - Vector clocks for conflict detection
 * - Fail-secure conflict resolution (revocations win)
 * - Periodic sync with remote server
 * - Tombstone-based deletion with retention
 */
export class CloudGrantsStore implements IGrantsStore {
  private readonly nodeId: string;
  private readonly syncFn?: (grants: readonly CloudGrant[]) => Promise<readonly CloudGrant[]>;
  private readonly syncInterval: number;
  private readonly tombstoneRetention: number;

  /** Local grants by app and capability */
  private grants = new Map<AppId, Map<CapabilityType, CloudGrant>>();

  /** Denials by app and capability */
  private denials = new Map<AppId, Map<CapabilityType, CapabilityDenial>>();

  /** Subscribers per app */
  private appSubscribers = new Map<AppId, Set<(event: GrantChangeEvent) => void>>();

  /** Global subscribers */
  private globalSubscribers = new Set<(event: GrantChangeEvent) => void>();

  /** Sync timer */
  private syncTimer?: ReturnType<typeof setInterval>;

  /** Whether a sync is in progress */
  private syncing = false;

  constructor(options: CloudStoreOptions) {
    this.nodeId = options.nodeId;
    this.syncFn = options.syncFn;
    this.syncInterval = options.syncInterval ?? 30_000;
    this.tombstoneRetention = options.tombstoneRetention ?? 7 * 24 * 60 * 60 * 1000; // 7 days

    // Start periodic sync if sync function provided
    if (this.syncFn) {
      this.startSync();
    }
  }

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

    // Check if tombstone
    if (grant.deleted) return false;

    // Check expiration
    if (grant.expiresAt && grant.expiresAt <= Date.now()) {
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
    return Array.from(appGrants.values()).filter((g) => !g.deleted);
  }

  getActiveGrants(appId: AppId): readonly CapabilityGrant[] {
    const appGrants = this.grants.get(appId);
    if (!appGrants) return [];

    const now = Date.now();
    const active: CapabilityGrant[] = [];

    for (const grant of appGrants.values()) {
      if (!grant.deleted && (!grant.expiresAt || grant.expiresAt > now)) {
        active.push(grant);
      }
    }

    return active;
  }

  getGrant(appId: AppId, capability: CapabilityType): CloudGrant | undefined {
    const grant = this.grants.get(appId)?.get(capability);
    if (!grant || grant.deleted) return undefined;
    return grant;
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

    const now = Date.now();
    let expiresAt = options?.expiresAt;
    if (!expiresAt && options?.duration) {
      expiresAt = now + options.duration;
    }

    // Get existing grant's vector clock if any
    const existing = appGrants.get(capability);
    const baseVectorClock = existing?.vectorClock ?? {};

    const grant: CloudGrant = {
      appId,
      capability,
      scope: options?.scope,
      grantedAt: now,
      grantedBy: options?.source ?? 'user',
      sessionOnly: options?.sessionOnly,
      expiresAt,
      userId: options?.userId ?? null,
      vectorClock: incrementVectorClock(baseVectorClock, this.nodeId),
      deleted: false,
    };

    appGrants.set(capability, grant);

    this.notifyChange({
      type: 'granted',
      appId,
      capability,
      grant,
      timestamp: now,
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

    const existing = appGrants.get(capability);
    if (!existing || existing.deleted) return false;

    // Create tombstone instead of deleting
    const tombstone: CloudGrant = {
      ...existing,
      vectorClock: incrementVectorClock(existing.vectorClock, this.nodeId),
      deleted: true,
      deletedAt: Date.now(),
    };

    appGrants.set(capability, tombstone);

    this.notifyChange({
      type: 'revoked',
      appId,
      capability,
      timestamp: Date.now(),
    });

    return true;
  }

  revokeAll(appId: AppId): number {
    const appGrants = this.grants.get(appId);
    if (!appGrants) return 0;

    let count = 0;
    const now = Date.now();

    for (const [capability, grant] of appGrants) {
      if (!grant.deleted) {
        // Create tombstone
        const tombstone: CloudGrant = {
          ...grant,
          vectorClock: incrementVectorClock(grant.vectorClock, this.nodeId),
          deleted: true,
          deletedAt: now,
        };
        appGrants.set(capability, tombstone);
        count++;

        this.notifyChange({
          type: 'revoked',
          appId,
          capability,
          timestamp: now,
        });
      }
    }

    return count;
  }

  deny(appId: AppId, capability: CapabilityType, reason?: string): void {
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
        if (!grant.deleted && grant.expiresAt && grant.expiresAt <= now) {
          // Create tombstone for expired grant
          const tombstone: CloudGrant = {
            ...grant,
            vectorClock: incrementVectorClock(grant.vectorClock, this.nodeId),
            deleted: true,
            deletedAt: now,
          };
          appGrants.set(capability, tombstone);
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
  // Sync Methods
  // ===========================================================================

  /**
   * Start periodic sync.
   */
  private startSync(): void {
    if (this.syncTimer) return;

    this.syncTimer = setInterval(() => {
      void this.sync();
    }, this.syncInterval);
  }

  /**
   * Stop periodic sync.
   */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * Manually trigger a sync.
   */
  async sync(): Promise<void> {
    if (this.syncing || !this.syncFn) return;

    try {
      this.syncing = true;

      // Collect all local grants (including tombstones)
      const localGrants: CloudGrant[] = [];
      for (const appGrants of this.grants.values()) {
        for (const grant of appGrants.values()) {
          localGrants.push(grant);
        }
      }

      // Send to server and get merged result
      const remoteGrants = await this.syncFn(localGrants);

      // Merge remote grants into local state
      for (const remoteGrant of remoteGrants) {
        this.mergeGrant(remoteGrant);
      }

      // Clean up old tombstones
      this.pruneTombstones();
    } catch (error) {
      console.error('[CloudGrantsStore] Sync error:', error);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Merge a remote grant into local state.
   *
   * Conflict resolution rules:
   * 1. Revocations always win (fail-secure)
   * 2. For concurrent grants, use timestamp as tiebreaker
   */
  private mergeGrant(remote: CloudGrant): void {
    let appGrants = this.grants.get(remote.appId);
    if (!appGrants) {
      appGrants = new Map();
      this.grants.set(remote.appId, appGrants);
    }

    const local = appGrants.get(remote.capability);

    if (!local) {
      // No local version, accept remote
      appGrants.set(remote.capability, remote);
      if (!remote.deleted) {
        this.notifyChange({
          type: 'granted',
          appId: remote.appId,
          capability: remote.capability,
          grant: remote,
          timestamp: Date.now(),
        });
      }
      return;
    }

    const comparison = compareVectorClocks(local.vectorClock, remote.vectorClock);

    switch (comparison) {
      case 'before':
        // Remote is newer, accept it
        appGrants.set(remote.capability, remote);
        this.notifyMergeChange(local, remote);
        break;

      case 'after':
        // Local is newer, keep it
        break;

      case 'equal':
        // Same version, no change needed
        break;

      case 'concurrent':
        // CRITICAL: Revocations always win (fail-secure)
        if (remote.deleted && !local.deleted) {
          // Remote is a revocation, accept it
          appGrants.set(remote.capability, remote);
          this.notifyChange({
            type: 'revoked',
            appId: remote.appId,
            capability: remote.capability,
            timestamp: Date.now(),
          });
        } else if (!remote.deleted && local.deleted) {
          // Local is a revocation, keep it (revocations win)
        } else if (!remote.deleted && !local.deleted) {
          // Both are grants - use timestamp as tiebreaker
          if (remote.grantedAt > local.grantedAt) {
            appGrants.set(remote.capability, remote);
            this.notifyChange({
              type: 'granted',
              appId: remote.appId,
              capability: remote.capability,
              grant: remote,
              timestamp: Date.now(),
            });
          }
        }
        // Both tombstones - merge vector clocks, keep most recent deletedAt
        else {
          const merged: CloudGrant = {
            ...remote,
            vectorClock: mergeVectorClocks(local.vectorClock, remote.vectorClock),
            deletedAt: Math.max(local.deletedAt ?? 0, remote.deletedAt ?? 0),
          };
          appGrants.set(remote.capability, merged);
        }
        break;
    }
  }

  /**
   * Notify about a merge-induced change.
   */
  private notifyMergeChange(local: CloudGrant, remote: CloudGrant): void {
    if (!local.deleted && remote.deleted) {
      // Grant became revoked
      this.notifyChange({
        type: 'revoked',
        appId: remote.appId,
        capability: remote.capability,
        timestamp: Date.now(),
      });
    } else if (local.deleted && !remote.deleted) {
      // Revocation became grant
      this.notifyChange({
        type: 'granted',
        appId: remote.appId,
        capability: remote.capability,
        grant: remote,
        timestamp: Date.now(),
      });
    }
    // Grant-to-grant changes: scope/expiry updates don't need notification
  }

  /**
   * Clean up old tombstones past retention period.
   */
  private pruneTombstones(): void {
    const cutoff = Date.now() - this.tombstoneRetention;

    for (const appGrants of this.grants.values()) {
      for (const [capability, grant] of appGrants) {
        if (grant.deleted && grant.deletedAt && grant.deletedAt < cutoff) {
          appGrants.delete(capability);
        }
      }
    }
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
          console.error('[CloudGrantsStore] Subscriber error:', error);
        }
      }
    }

    // Notify global subscribers
    for (const callback of this.globalSubscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error('[CloudGrantsStore] Global subscriber error:', error);
      }
    }
  }

  // ===========================================================================
  // Testing/Admin Helpers
  // ===========================================================================

  /**
   * Get all grants including tombstones (for debugging).
   */
  getAllGrantsIncludingTombstones(): readonly CloudGrant[] {
    const all: CloudGrant[] = [];
    for (const appGrants of this.grants.values()) {
      for (const grant of appGrants.values()) {
        all.push(grant);
      }
    }
    return all;
  }

  /**
   * Clear all data (for testing).
   */
  clear(): void {
    this.grants.clear();
    this.denials.clear();
  }

  /**
   * Dispose of the store.
   */
  dispose(): void {
    this.stopSync();
    this.appSubscribers.clear();
    this.globalSubscribers.clear();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new cloud grants store.
 */
export function createCloudGrantsStore(options: CloudStoreOptions): CloudGrantsStore {
  return new CloudGrantsStore(options);
}
