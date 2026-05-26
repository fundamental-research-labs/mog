/**
 * Scoped Access Checker
 *
 * Shared utility for table-level access checking across all scoped APIs
 * (tables, records, columns, events). Eliminates duplicated boilerplate
 * for getTableName, isTableAccessible, assertReadAccess, assertWriteAccess.
 */

import type { AppTableId, IAppTablesAPI } from '@mog-sdk/contracts/apps';
import { CapabilityDeniedError, CapabilityScopeError } from '../../../errors/capability';
import type { CapabilityType } from '../../../services/capabilities/cap-types';
import type { CapabilityScope } from '../../../services/capabilities/scope';
import { scopeMatches } from '../../../services/capabilities/scope';

import type { ScopedAPIContext } from './types';

/**
 * Options for creating a scoped access checker.
 */
export interface ScopedAccessCheckerOptions {
  /** The scoped API context */
  readonly context: ScopedAPIContext;
  /** The tables API for resolving table names from IDs */
  readonly tablesApi: IAppTablesAPI;
  /** Optional set of table IDs from manifest.managedTables */
  readonly managedTableIds?: ReadonlySet<string>;
}

/**
 * A reusable access checker for table-scoped APIs.
 *
 * Handles both ID-based access (managedTableIds) and name-based scope checking,
 * with sync and async variants depending on whether a table lookup is needed.
 */
export interface ScopedAccessChecker {
  /** Get table name from ID (async - requires table lookup) */
  getTableName(tableId: AppTableId): Promise<string | null>;

  /**
   * Check if a table is accessible by ID (sync).
   * When managedTableIds is provided, only those tables are accessible.
   * When not provided, returns true (caller must use name-based scope checks).
   */
  isTableAccessibleById(tableId: string): boolean;

  /**
   * Check if a table is accessible (async).
   * When managedTableIds is provided, checks ID.
   * Otherwise falls back to name-based scope checking.
   */
  isTableAccessible(tableId: AppTableId, forWrite?: boolean): Promise<boolean>;

  /** Check if a table name is within the app's read scope */
  isTableInReadScope(tableName: string): boolean;

  /** Check if a table name is within the app's write scope */
  isTableInWriteScope(tableName: string): boolean;

  /** Assert read access to a table (async - resolves table name if needed) */
  assertReadAccess(tableId: AppTableId): Promise<void>;

  /** Assert write access to a table (async) */
  assertWriteAccess(tableId: AppTableId, operation: string): Promise<void>;

  /** The read scope (null = unscoped/full access) */
  readonly readScope: CapabilityScope | null;

  /** The write scope (null = unscoped/full access) */
  readonly writeScope: CapabilityScope | null;

  /** Whether the app has tables:read */
  readonly hasRead: boolean;

  /** Whether the app has tables:write */
  readonly hasWrite: boolean;
}

/**
 * Create a scoped access checker for table-level operations.
 *
 * This consolidates the duplicated access-checking logic from
 * scoped-tables-api, scoped-records-api, scoped-columns-api, and scoped-events-api.
 */
export function createScopedAccessChecker(
  options: ScopedAccessCheckerOptions,
): ScopedAccessChecker {
  const { context, tablesApi, managedTableIds } = options;

  const hasRead = context.hasCapability('tables:read');
  const hasWrite = context.hasCapability('tables:write');
  const readScope = context.getScope('tables:read');
  const writeScope = context.getScope('tables:write');

  async function getTableName(tableId: AppTableId): Promise<string | null> {
    const table = await tablesApi.get(tableId);
    return table?.name ?? null;
  }

  function isTableAccessibleById(tableId: string): boolean {
    if (managedTableIds) {
      return managedTableIds.has(tableId);
    }
    return true; // Will be checked by name-based scope methods
  }

  function isTableInReadScope(tableName: string): boolean {
    if (!readScope) return true;
    return scopeMatches(readScope, 'table', tableName);
  }

  function isTableInWriteScope(tableName: string): boolean {
    if (!writeScope) return true;
    return scopeMatches(writeScope, 'table', tableName);
  }

  async function isTableAccessible(
    tableId: AppTableId,
    forWrite: boolean = false,
  ): Promise<boolean> {
    if (managedTableIds) {
      return managedTableIds.has(tableId);
    }
    const tableName = await getTableName(tableId);
    if (!tableName) return false;
    return forWrite ? isTableInWriteScope(tableName) : isTableInReadScope(tableName);
  }

  async function assertReadAccess(tableId: AppTableId): Promise<void> {
    if (!(await isTableAccessible(tableId, false))) {
      const tableName = await getTableName(tableId);
      if (tableName) {
        throw new CapabilityScopeError(
          context.appId,
          'tables:read',
          'table',
          tableName,
          readScope as CapabilityScope,
        );
      }
      // If no table name, table doesn't exist - let the underlying API handle it
    }
  }

  async function assertWriteAccess(tableId: AppTableId, operation: string): Promise<void> {
    if (!hasWrite) {
      throw new CapabilityDeniedError(context.appId, 'tables:write', {
        operation,
      });
    }

    if (!(await isTableAccessible(tableId, true))) {
      const tableName = await getTableName(tableId);
      if (tableName) {
        throw new CapabilityScopeError(
          context.appId,
          'tables:write',
          'table',
          tableName,
          writeScope as CapabilityScope,
        );
      }
    }
  }

  return {
    getTableName,
    isTableAccessibleById,
    isTableAccessible,
    isTableInReadScope,
    isTableInWriteScope,
    assertReadAccess,
    assertWriteAccess,
    readScope,
    writeScope,
    hasRead,
    hasWrite,
  };
}
