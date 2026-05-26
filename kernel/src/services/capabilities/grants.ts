/**
 * Capability Grants - Grant storage and management interfaces
 *
 * This file defines:
 * - CapabilityGrant interface
 * - GrantOptions interface (scope, sessionOnly, expiresAt)
 * - IGrantsStore interface
 *
 */

import type { CapabilityType } from './cap-types';
import type { CapabilityScope } from './scope';

// =============================================================================
// App ID Type
// =============================================================================

/**
 * Opaque app identifier.
 */
export type AppId = string & { readonly __brand?: 'AppId' };

// =============================================================================
// Grant Types
// =============================================================================

/**
 * Source of a capability grant.
 *
 * - 'user': Granted via consent dialog
 * - 'auto': Auto-granted for first-party apps
 * - 'migration': Auto-granted during migration from non-capability system
 */
export type GrantSource = 'user' | 'auto' | 'migration';

/**
 * A capability grant to an app.
 *
 * Represents a single permission granted to an app, optionally
 * scoped to specific resources.
 */
export interface CapabilityGrant {
  /** The app this grant belongs to */
  readonly appId: AppId;

  /** The capability being granted */
  readonly capability: CapabilityType;

  /** Optional scope limiting access (e.g., "table:contacts,table:deals") */
  readonly scope?: CapabilityScope;

  /** Timestamp when granted (Unix ms) */
  readonly grantedAt: number;

  /** Who/what granted this capability */
  readonly grantedBy: GrantSource;

  /** Whether this is a session-only grant (not persisted) */
  readonly sessionOnly?: boolean;

  /** When this grant expires (Unix ms), for session-only grants */
  readonly expiresAt?: number;

  /**
   * User ID who granted this (for audit).
   * Null for auto/migration grants.
   */
  readonly userId?: string | null;
}

/**
 * Options for granting a capability.
 */
export interface GrantOptions {
  /** Scope to limit the grant to specific resources */
  readonly scope?: CapabilityScope;

  /** Make this a session-only grant (not persisted, expires on session end) */
  readonly sessionOnly?: boolean;

  /** Custom expiration timestamp (Unix ms) */
  readonly expiresAt?: number;

  /** Duration in ms (alternative to expiresAt) */
  readonly duration?: number;

  /** Source of the grant */
  readonly source?: GrantSource;

  /** User ID for audit trail */
  readonly userId?: string | null;
}

/**
 * A denied capability record.
 *
 * When a user explicitly denies a capability request, we record it
 * to avoid repeatedly asking (respects rate limiting).
 */
export interface CapabilityDenial {
  /** The app this denial belongs to */
  readonly appId: AppId;

  /** The capability that was denied */
  readonly capability: CapabilityType;

  /** Timestamp when denied (Unix ms) */
  readonly deniedAt: number;

  /** Reason for denial (if provided) */
  readonly reason?: string;
}

// =============================================================================
// Grants Store Interface
// =============================================================================

/**
 * Storage interface for capability grants.
 *
 * Implementations:
 * - MemoryGrantsStore: In-memory for tests
 * - SQLiteGrantsStore: Local SQLite for desktop
 * - CloudGrantsStore: Server-side for web (with conflict resolution)
 */
export interface IGrantsStore {
  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * Check if an app has a specific capability granted.
   *
   * @param appId - The app to check
   * @param capability - The capability to check for
   * @param scope - Optional scope to check (resource type and ID)
   * @returns True if the capability is granted (and not expired)
   */
  hasGrant(
    appId: AppId,
    capability: CapabilityType,
    scope?: {
      resourceType: string;
      resourceId: string;
    },
  ): boolean;

  /**
   * Get all grants for an app.
   *
   * @param appId - The app to get grants for
   * @returns Array of all grants for this app (including expired for audit)
   */
  getGrants(appId: AppId): readonly CapabilityGrant[];

  /**
   * Get active (non-expired) grants for an app.
   *
   * @param appId - The app to get grants for
   * @returns Array of active grants
   */
  getActiveGrants(appId: AppId): readonly CapabilityGrant[];

  /**
   * Get a specific grant.
   *
   * @param appId - The app ID
   * @param capability - The capability
   * @returns The grant if found, undefined otherwise
   */
  getGrant(appId: AppId, capability: CapabilityType): CapabilityGrant | undefined;

  /**
   * Check if a capability was explicitly denied.
   *
   * @param appId - The app to check
   * @param capability - The capability to check
   * @returns True if the capability was explicitly denied
   */
  isDenied(appId: AppId, capability: CapabilityType): boolean;

  /**
   * Get the denial record for a capability.
   *
   * @param appId - The app to check
   * @param capability - The capability to check
   * @returns The denial record if found
   */
  getDenial(appId: AppId, capability: CapabilityType): CapabilityDenial | undefined;

  // =========================================================================
  // Mutation Methods
  // =========================================================================

  /**
   * Grant a capability to an app.
   *
   * If the capability is already granted, this updates the existing grant
   * (e.g., extending scope or expiration).
   *
   * @param appId - The app to grant to
   * @param capability - The capability to grant
   * @param options - Grant options (scope, session, expiration)
   * @returns The created/updated grant
   */
  grant(appId: AppId, capability: CapabilityType, options?: GrantOptions): CapabilityGrant;

  /**
   * Grant multiple capabilities to an app.
   *
   * @param appId - The app to grant to
   * @param capabilities - The capabilities to grant
   * @param options - Shared grant options
   * @returns Array of created grants
   */
  grantBatch(
    appId: AppId,
    capabilities: readonly CapabilityType[],
    options?: GrantOptions,
  ): readonly CapabilityGrant[];

  /**
   * Revoke a capability from an app.
   *
   * @param appId - The app to revoke from
   * @param capability - The capability to revoke
   * @returns True if a grant was revoked
   */
  revoke(appId: AppId, capability: CapabilityType): boolean;

  /**
   * Revoke all capabilities from an app.
   *
   * @param appId - The app to revoke from
   * @returns Number of grants revoked
   */
  revokeAll(appId: AppId): number;

  /**
   * Record a capability denial.
   *
   * @param appId - The app that was denied
   * @param capability - The capability that was denied
   * @param reason - Optional reason for denial
   */
  deny(appId: AppId, capability: CapabilityType, reason?: string): void;

  /**
   * Clear a denial record (allow re-prompting).
   *
   * @param appId - The app ID
   * @param capability - The capability to clear denial for
   */
  clearDenial(appId: AppId, capability: CapabilityType): void;

  /**
   * Clean up expired grants.
   * Called periodically to remove stale session grants.
   *
   * @returns Number of grants cleaned up
   */
  cleanupExpired(): number;

  // =========================================================================
  // Subscription Methods
  // =========================================================================

  /**
   * Subscribe to grant changes for an app.
   *
   * @param appId - The app to watch
   * @param callback - Called when grants change
   * @returns Unsubscribe function
   */
  subscribe(appId: AppId, callback: (event: GrantChangeEvent) => void): () => void;

  /**
   * Subscribe to all grant changes (for admin UI).
   *
   * @param callback - Called when any grants change
   * @returns Unsubscribe function
   */
  subscribeAll(callback: (event: GrantChangeEvent) => void): () => void;
}

// =============================================================================
// Grant Change Events
// =============================================================================

/**
 * Event type for grant changes.
 */
export type GrantChangeType = 'granted' | 'revoked' | 'expired' | 'denied' | 'denial-cleared';

/**
 * Event emitted when grants change.
 */
export interface GrantChangeEvent {
  /** Type of change */
  readonly type: GrantChangeType;

  /** App affected */
  readonly appId: AppId;

  /** Capability affected */
  readonly capability: CapabilityType;

  /** The grant (for 'granted' events) */
  readonly grant?: CapabilityGrant;

  /** Timestamp of the event */
  readonly timestamp: number;
}

// =============================================================================
// Grant Utilities
// =============================================================================

/**
 * Check if a grant is expired.
 */
export function isGrantExpired(grant: CapabilityGrant): boolean {
  if (!grant.expiresAt) return false;
  return Date.now() >= grant.expiresAt;
}

/**
 * Check if a grant is session-only and about to expire.
 *
 * @param grant - The grant to check
 * @param warningMs - Warning threshold in ms (default: 60000 = 1 minute)
 * @returns True if expiring soon
 */
export function isGrantExpiringSoon(grant: CapabilityGrant, warningMs = 60_000): boolean {
  if (!grant.expiresAt) return false;
  const remaining = grant.expiresAt - Date.now();
  return remaining > 0 && remaining <= warningMs;
}

/**
 * Get the remaining time for a grant in milliseconds.
 * Returns Infinity for non-expiring grants, 0 for expired grants.
 */
export function getGrantRemainingTime(grant: CapabilityGrant): number {
  if (!grant.expiresAt) return Infinity;
  return Math.max(0, grant.expiresAt - Date.now());
}

/**
 * Create a grant with computed expiration.
 */
export function createGrant(
  appId: AppId,
  capability: CapabilityType,
  options?: GrantOptions,
): CapabilityGrant {
  const now = Date.now();
  let expiresAt = options?.expiresAt;

  if (!expiresAt && options?.duration) {
    expiresAt = now + options.duration;
  }

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

/**
 * Create an AppId from a string.
 */
export function appId(id: string): AppId {
  return id as AppId;
}
