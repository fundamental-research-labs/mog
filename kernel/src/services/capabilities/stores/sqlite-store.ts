/**
 * SQLite Grants Store
 *
 * SQLite-based implementation of IGrantsStore for desktop (Tauri).
 * Provides persistent storage with proper locking for concurrent access.
 *
 * Schema:
 * - grants(app_id, capability, scope, granted_at, granted_by, expires_at, session_only, user_id)
 * - denials(app_id, capability, denied_at, reason)
 *
 * Note: This implementation uses a generic SQLite interface that can be
 * provided by Tauri's tauri-plugin-sql or better-sqlite3 in Node.js.
 *
 */

import { KernelError } from '../../../errors';
import type { CapabilityType } from '../cap-types';
import type {
  AppId,
  CapabilityDenial,
  CapabilityGrant,
  GrantChangeEvent,
  GrantOptions,
  GrantSource,
  IGrantsStore,
} from '../grants';
import type { CapabilityScope } from '../scope';
import { scopeMatches } from '../scope';

import type { SQLiteStoreOptions } from '../types';

// =============================================================================
// SQLite Interface
// =============================================================================

/**
 * Generic SQLite database interface.
 *
 * This can be implemented by:
 * - Tauri's tauri-plugin-sql
 * - better-sqlite3 in Node.js
 * - sql.js for browser testing
 */
export interface ISQLiteDatabase {
  /** Execute a query that returns rows */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute a statement that modifies data */
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;

  /** Execute multiple statements in a transaction */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Close the database connection */
  close(): Promise<void>;
}

// =============================================================================
// Row Types
// =============================================================================

interface GrantRow {
  app_id: string;
  capability: string;
  scope: string | null;
  granted_at: number;
  granted_by: string;
  expires_at: number | null;
  session_only: number;
  user_id: string | null;
}

interface DenialRow {
  app_id: string;
  capability: string;
  denied_at: number;
  reason: string | null;
}

// =============================================================================
// SQLite Grants Store
// =============================================================================

/**
 * SQLite-based implementation of IGrantsStore.
 *
 * Features:
 * - Persistent storage across app restarts
 * - WAL mode for better concurrent read performance
 * - Proper locking for concurrent access
 * - Automatic schema creation
 */
export class SQLiteGrantsStore implements IGrantsStore {
  private db: ISQLiteDatabase;
  private initialized = false;

  /** Subscribers per app */
  private appSubscribers = new Map<AppId, Set<(event: GrantChangeEvent) => void>>();

  /** Global subscribers */
  private globalSubscribers = new Set<(event: GrantChangeEvent) => void>();

  constructor(db: ISQLiteDatabase) {
    this.db = db;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the database schema.
   * Must be called before using the store.
   */
  async initialize(options?: SQLiteStoreOptions): Promise<void> {
    if (this.initialized) return;

    // Enable WAL mode for better concurrent read performance
    if (options?.walMode !== false) {
      await this.db.execute('PRAGMA journal_mode=WAL');
    }

    // Create grants table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS grants (
        app_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        scope TEXT,
        granted_at INTEGER NOT NULL,
        granted_by TEXT NOT NULL,
        expires_at INTEGER,
        session_only INTEGER NOT NULL DEFAULT 0,
        user_id TEXT,
        PRIMARY KEY (app_id, capability)
      )
    `);

    // Create index for app lookups
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_grants_app_id ON grants(app_id)
    `);

    // Create denials table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS denials (
        app_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        denied_at INTEGER NOT NULL,
        reason TEXT,
        PRIMARY KEY (app_id, capability)
      )
    `);

    this.initialized = true;
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  async hasGrantAsync(
    appId: AppId,
    capability: CapabilityType,
    scope?: { resourceType: string; resourceId: string },
  ): Promise<boolean> {
    const grant = await this.getGrantAsync(appId, capability);
    if (!grant) return false;

    // Check expiration
    if (grant.expiresAt && grant.expiresAt <= Date.now()) {
      await this.revokeAsync(appId, capability);
      return false;
    }

    // Check scope if provided
    if (scope && grant.scope) {
      return scopeMatches(grant.scope, scope.resourceType, scope.resourceId);
    }

    return true;
  }

  // Synchronous wrapper (throws if not initialized)
  hasGrant(
    _appId: AppId,
    _capability: CapabilityType,
    _scope?: { resourceType: string; resourceId: string },
  ): boolean {
    // For SQLite, we need to use synchronous access
    // This is a limitation - in practice, use hasGrantAsync
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use hasGrantAsync instead.',
    );
  }

  async getGrantsAsync(appId: AppId): Promise<readonly CapabilityGrant[]> {
    const rows = await this.db.query<GrantRow>('SELECT * FROM grants WHERE app_id = ?', [appId]);
    return rows.map(this.rowToGrant);
  }

  getGrants(_appId: AppId): readonly CapabilityGrant[] {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use getGrantsAsync instead.',
    );
  }

  async getActiveGrantsAsync(appId: AppId): Promise<readonly CapabilityGrant[]> {
    const now = Date.now();
    const rows = await this.db.query<GrantRow>(
      'SELECT * FROM grants WHERE app_id = ? AND (expires_at IS NULL OR expires_at > ?)',
      [appId, now],
    );
    return rows.map(this.rowToGrant);
  }

  getActiveGrants(_appId: AppId): readonly CapabilityGrant[] {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use getActiveGrantsAsync instead.',
    );
  }

  async getGrantAsync(
    appId: AppId,
    capability: CapabilityType,
  ): Promise<CapabilityGrant | undefined> {
    const rows = await this.db.query<GrantRow>(
      'SELECT * FROM grants WHERE app_id = ? AND capability = ?',
      [appId, capability],
    );
    return rows.length > 0 ? this.rowToGrant(rows[0]) : undefined;
  }

  getGrant(_appId: AppId, _capability: CapabilityType): CapabilityGrant | undefined {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use getGrantAsync instead.',
    );
  }

  async isDeniedAsync(appId: AppId, capability: CapabilityType): Promise<boolean> {
    const rows = await this.db.query<DenialRow>(
      'SELECT * FROM denials WHERE app_id = ? AND capability = ?',
      [appId, capability],
    );
    return rows.length > 0;
  }

  isDenied(_appId: AppId, _capability: CapabilityType): boolean {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use isDeniedAsync instead.',
    );
  }

  async getDenialAsync(
    appId: AppId,
    capability: CapabilityType,
  ): Promise<CapabilityDenial | undefined> {
    const rows = await this.db.query<DenialRow>(
      'SELECT * FROM denials WHERE app_id = ? AND capability = ?',
      [appId, capability],
    );
    return rows.length > 0 ? this.rowToDenial(rows[0]) : undefined;
  }

  getDenial(_appId: AppId, _capability: CapabilityType): CapabilityDenial | undefined {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use getDenialAsync instead.',
    );
  }

  // ===========================================================================
  // Mutation Methods
  // ===========================================================================

  async grantAsync(
    appId: AppId,
    capability: CapabilityType,
    options?: GrantOptions,
  ): Promise<CapabilityGrant> {
    // Clear any previous denial
    await this.clearDenialAsync(appId, capability);

    const now = Date.now();
    let expiresAt = options?.expiresAt;
    if (!expiresAt && options?.duration) {
      expiresAt = now + options.duration;
    }

    const grant: CapabilityGrant = {
      appId,
      capability,
      scope: options?.scope,
      grantedAt: now,
      grantedBy: options?.source ?? 'user',
      sessionOnly: options?.sessionOnly,
      expiresAt,
      userId: options?.userId ?? null,
    };

    await this.db.execute(
      `INSERT OR REPLACE INTO grants
       (app_id, capability, scope, granted_at, granted_by, expires_at, session_only, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appId,
        capability,
        grant.scope ?? null,
        grant.grantedAt,
        grant.grantedBy,
        grant.expiresAt ?? null,
        grant.sessionOnly ? 1 : 0,
        grant.userId ?? null,
      ],
    );

    this.notifyChange({
      type: 'granted',
      appId,
      capability,
      grant,
      timestamp: now,
    });

    return grant;
  }

  grant(_appId: AppId, _capability: CapabilityType, _options?: GrantOptions): CapabilityGrant {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use grantAsync instead.',
    );
  }

  async grantBatchAsync(
    appId: AppId,
    capabilities: readonly CapabilityType[],
    options?: GrantOptions,
  ): Promise<readonly CapabilityGrant[]> {
    return this.db.transaction(async () => {
      const grants: CapabilityGrant[] = [];
      for (const cap of capabilities) {
        const grant = await this.grantAsync(appId, cap, options);
        grants.push(grant);
      }
      return grants;
    });
  }

  grantBatch(
    _appId: AppId,
    _capabilities: readonly CapabilityType[],
    _options?: GrantOptions,
  ): readonly CapabilityGrant[] {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use grantBatchAsync instead.',
    );
  }

  async revokeAsync(appId: AppId, capability: CapabilityType): Promise<boolean> {
    const result = await this.db.execute('DELETE FROM grants WHERE app_id = ? AND capability = ?', [
      appId,
      capability,
    ]);

    const had = result.changes > 0;
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

  revoke(_appId: AppId, _capability: CapabilityType): boolean {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use revokeAsync instead.',
    );
  }

  async revokeAllAsync(appId: AppId): Promise<number> {
    // Get capabilities before deleting for notifications
    const grants = await this.getActiveGrantsAsync(appId);
    const capabilities = grants.map((g) => g.capability);

    const result = await this.db.execute('DELETE FROM grants WHERE app_id = ?', [appId]);

    // Notify for each revoked capability
    for (const capability of capabilities) {
      this.notifyChange({
        type: 'revoked',
        appId,
        capability,
        timestamp: Date.now(),
      });
    }

    return result.changes;
  }

  revokeAll(_appId: AppId): number {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use revokeAllAsync instead.',
    );
  }

  async denyAsync(appId: AppId, capability: CapabilityType, reason?: string): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO denials (app_id, capability, denied_at, reason)
       VALUES (?, ?, ?, ?)`,
      [appId, capability, Date.now(), reason ?? null],
    );

    this.notifyChange({
      type: 'denied',
      appId,
      capability,
      timestamp: Date.now(),
    });
  }

  deny(_appId: AppId, _capability: CapabilityType, _reason?: string): void {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use denyAsync instead.',
    );
  }

  async clearDenialAsync(appId: AppId, capability: CapabilityType): Promise<void> {
    const result = await this.db.execute(
      'DELETE FROM denials WHERE app_id = ? AND capability = ?',
      [appId, capability],
    );

    if (result.changes > 0) {
      this.notifyChange({
        type: 'denial-cleared',
        appId,
        capability,
        timestamp: Date.now(),
      });
    }
  }

  clearDenial(_appId: AppId, _capability: CapabilityType): void {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use clearDenialAsync instead.',
    );
  }

  async cleanupExpiredAsync(): Promise<number> {
    const now = Date.now();

    // Get expired grants for notifications
    const expiredRows = await this.db.query<GrantRow>(
      'SELECT * FROM grants WHERE expires_at IS NOT NULL AND expires_at <= ?',
      [now],
    );

    // Delete expired grants
    const result = await this.db.execute(
      'DELETE FROM grants WHERE expires_at IS NOT NULL AND expires_at <= ?',
      [now],
    );

    // Notify for each expired grant
    for (const row of expiredRows) {
      this.notifyChange({
        type: 'expired',
        appId: row.app_id as AppId,
        capability: row.capability as CapabilityType,
        timestamp: now,
      });
    }

    return result.changes;
  }

  cleanupExpired(): number {
    throw new KernelError(
      'OPERATION_FAILED',
      'SQLiteGrantsStore requires async access. Use cleanupExpiredAsync instead.',
    );
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
  // Lifecycle
  // ===========================================================================

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * Clear all session-only grants.
   * Should be called on app startup to clean up stale session grants.
   */
  async clearSessionGrants(): Promise<number> {
    const result = await this.db.execute('DELETE FROM grants WHERE session_only = 1');
    return result.changes;
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private rowToGrant(row: GrantRow): CapabilityGrant {
    return {
      appId: row.app_id as AppId,
      capability: row.capability as CapabilityType,
      scope: (row.scope as CapabilityScope) ?? undefined,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by as GrantSource,
      expiresAt: row.expires_at ?? undefined,
      sessionOnly: row.session_only === 1,
      userId: row.user_id,
    };
  }

  private rowToDenial(row: DenialRow): CapabilityDenial {
    return {
      appId: row.app_id as AppId,
      capability: row.capability as CapabilityType,
      deniedAt: row.denied_at,
      reason: row.reason ?? undefined,
    };
  }

  private notifyChange(event: GrantChangeEvent): void {
    // Notify app-specific subscribers
    const appSubs = this.appSubscribers.get(event.appId);
    if (appSubs) {
      for (const callback of appSubs) {
        try {
          callback(event);
        } catch (error) {
          console.error('[SQLiteGrantsStore] Subscriber error:', error);
        }
      }
    }

    // Notify global subscribers
    for (const callback of this.globalSubscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error('[SQLiteGrantsStore] Global subscriber error:', error);
      }
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new SQLite grants store.
 *
 * @param db - The SQLite database interface
 * @param options - Store options
 */
export async function createSQLiteGrantsStore(
  db: ISQLiteDatabase,
  options?: SQLiteStoreOptions,
): Promise<SQLiteGrantsStore> {
  const store = new SQLiteGrantsStore(db);
  await store.initialize(options);
  return store;
}
