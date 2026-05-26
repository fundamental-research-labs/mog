/**
 * Capability Registry Types
 *
 * Internal types for the capability registry service.
 *
 */

import type { CallableDisposable, IDisposable } from '@mog-sdk/contracts/core';

import type { CapabilityType } from './cap-types';
import type { AppId, CapabilityGrant, GrantChangeEvent, GrantOptions } from './grants';
import type { CapabilityScope } from './scope';

export type CapabilityAuditMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly CapabilityAuditMetadataValue[]
  | { readonly [key: string]: CapabilityAuditMetadataValue };

// =============================================================================
// Audit Log Types
// =============================================================================

/**
 * Audit event types for capability operations.
 */
export type AuditEventType =
  | 'granted' // Capability granted to app
  | 'revoked' // Capability revoked from app
  | 'revoked-all' // All capabilities revoked from app
  | 'used' // Capability successfully used
  | 'denied' // Access attempt without capability
  | 'expired' // Session-only capability expired
  | 'check-passed' // Capability check passed
  | 'check-failed' // Capability check failed
  | 'auto-granted' // First-party auto-grant
  | 'auto-granted-migration'; // Migration auto-grant

/**
 * A capability audit log entry.
 */
export interface CapabilityAuditEntry {
  /** Unique ID for this entry */
  readonly id: string;

  /** The app involved */
  readonly appId: AppId;

  /** The capability involved */
  readonly capability: CapabilityType;

  /** Type of event */
  readonly eventType: AuditEventType;

  /** Timestamp (Unix ms) */
  readonly timestamp: number;

  /** Optional operation that triggered this (for 'used' events) */
  readonly operation?: string;

  /** Optional resource scope (for scoped capabilities) */
  readonly resourceType?: string;
  readonly resourceId?: string;

  /** Additional context/metadata */
  readonly metadata?: Record<string, CapabilityAuditMetadataValue>;
}

/**
 * Audit log interface.
 *
 * Implementations should handle retention (time-based + hard cap).
 */
export interface ICapabilityAuditLog {
  /**
   * Log an audit event.
   */
  log(entry: Omit<CapabilityAuditEntry, 'id' | 'timestamp'>): void;

  /**
   * Get audit entries for an app.
   */
  getEntries(
    appId: AppId,
    options?: {
      limit?: number;
      offset?: number;
      eventTypes?: AuditEventType[];
      since?: number;
    },
  ): readonly CapabilityAuditEntry[];

  /**
   * Get all audit entries (for admin UI).
   */
  getAllEntries(options?: {
    limit?: number;
    offset?: number;
    eventTypes?: AuditEventType[];
    since?: number;
  }): readonly CapabilityAuditEntry[];

  /**
   * Clear entries older than a given timestamp.
   */
  prune(olderThan: number): number;

  /**
   * Clear all entries.
   */
  clear(): void;
}

// =============================================================================
// Registry Event Types
// =============================================================================

/**
 * Events emitted by the capability registry.
 */
export type RegistryEventType = 'capability:granted' | 'capability:revoked';

/**
 * Event data for capability registry events.
 */
export interface RegistryEvent {
  readonly type: RegistryEventType;
  readonly appId: AppId;
  readonly capability: CapabilityType;
  readonly grant?: CapabilityGrant;
  readonly timestamp: number;
}

/**
 * Event handler type.
 */
export type RegistryEventHandler = (event: RegistryEvent) => void;

// =============================================================================
// Vector Clock Types (for Cloud Store)
// =============================================================================

/**
 * Vector clock for conflict resolution in distributed systems.
 *
 * Maps device/node IDs to their logical timestamps.
 */
export type VectorClock = Record<string, number>;

/**
 * Comparison result for vector clocks.
 */
export type VectorClockComparison = 'before' | 'after' | 'concurrent' | 'equal';

/**
 * A grant with vector clock for cloud sync.
 */
export interface CloudGrant extends CapabilityGrant {
  /** Vector clock for conflict resolution */
  readonly vectorClock: VectorClock;

  /** Whether this is a tombstone (revocation marker) */
  readonly deleted?: boolean;

  /** Deletion timestamp (for tombstones) */
  readonly deletedAt?: number;
}

// =============================================================================
// Store Options
// =============================================================================

/**
 * Options for SQLite store.
 */
export interface SQLiteStoreOptions {
  /** Path to the SQLite database file */
  readonly dbPath: string;

  /** Whether to enable WAL mode (default: true) */
  readonly walMode?: boolean;
}

/**
 * Options for cloud store.
 */
export interface CloudStoreOptions {
  /** Local device/node ID for vector clocks */
  readonly nodeId: string;

  /** Function to sync with remote server */
  readonly syncFn?: (grants: readonly CloudGrant[]) => Promise<readonly CloudGrant[]>;

  /** Sync interval in ms (default: 30000) */
  readonly syncInterval?: number;

  /** Tombstone retention period in ms (default: 7 days) */
  readonly tombstoneRetention?: number;
}

// =============================================================================
// Capability Registry Interface
// =============================================================================

/**
 * Events emitted by the capability registry.
 *
 * Defined here so the interface can reference it without circular imports.
 * The concrete CapabilityEvents type in registry.ts should match this shape.
 */
export type CapabilityEventMap = {
  'capability:granted': RegistryEvent;
  'capability:revoked': RegistryEvent;
};

/**
 * Public interface for the capability registry.
 *
 * Manages capability grants for apps including dependency expansion,
 * cascading revocation, scope checking, and event emission.
 */
export interface ICapabilityRegistry extends IDisposable {
  // ---------------------------------------------------------------------------
  // Event Subscription (from TypedEventEmitter)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to a named event. Returns CallableDisposable for unsubscription.
   */
  on<K extends keyof CapabilityEventMap>(
    event: K,
    handler: (data: CapabilityEventMap[K]) => void,
  ): CallableDisposable;

  /**
   * Subscribe to the next occurrence of a named event only.
   * Automatically unsubscribes after first fire.
   */
  once<K extends keyof CapabilityEventMap>(
    event: K,
    handler: (data: CapabilityEventMap[K]) => void,
  ): CallableDisposable;

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  /**
   * Check if an app has a specific capability.
   *
   * Checks direct grants, implied capabilities, scope matching, and expiration.
   */
  hasCapability(
    appId: AppId,
    capability: CapabilityType,
    scope?: { resourceType: string; resourceId: string },
  ): boolean;

  /**
   * Get all grants for an app.
   */
  getGrants(appId: AppId): readonly CapabilityGrant[];

  /**
   * Get the effective capabilities for an app, including implied ones.
   */
  getEffectiveCapabilities(appId: AppId): CapabilityType[];

  // ---------------------------------------------------------------------------
  // Mutation Methods
  // ---------------------------------------------------------------------------

  /**
   * Grant a capability to an app. Automatically grants all dependencies.
   */
  grant(appId: AppId, capability: CapabilityType, options?: GrantOptions): void;

  /**
   * Grant multiple capabilities to an app. Dependencies are automatically expanded.
   */
  grantBatch(appId: AppId, capabilities: readonly CapabilityType[], options?: GrantOptions): void;

  /**
   * Revoke a capability from an app. Also revokes capabilities that depend on it.
   */
  revoke(appId: AppId, capability: CapabilityType): void;

  /**
   * Revoke all capabilities from an app.
   *
   * @returns Number of grants revoked
   */
  revokeAll(appId: AppId): number;

  // ---------------------------------------------------------------------------
  // Dependency Expansion
  // ---------------------------------------------------------------------------

  /**
   * Expand a set of capabilities to include all implied dependencies.
   */
  expandCapabilities(capabilities: readonly CapabilityType[]): CapabilityType[];

  // ---------------------------------------------------------------------------
  // Scoping
  // ---------------------------------------------------------------------------

  /**
   * Check if a capability grant is scoped.
   */
  isCapabilityScoped(appId: AppId, capability: CapabilityType): boolean;

  /**
   * Get the scope for a capability grant.
   */
  getCapabilityScope(appId: AppId, capability: CapabilityType): CapabilityScope | null;

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Clean up expired grants. Should be called periodically.
   *
   * @returns Number of grants cleaned up
   */
  cleanupExpired(): number;

  // ---------------------------------------------------------------------------
  // Store Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to grant changes for an app.
   */
  subscribeToApp(appId: AppId, callback: (event: GrantChangeEvent) => void): () => void;

  /**
   * Subscribe to all grant changes.
   */
  subscribeToAll(callback: (event: GrantChangeEvent) => void): () => void;
}
