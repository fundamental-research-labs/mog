/**
 * Scoped Relations API
 *
 * Creates a capability-gated wrapper around IAppRelationsAPI that enforces
 * table-level scoping for relation operations.
 */

import type { AppTableId, IAppRelationsAPI, IAppTablesAPI } from '@mog-sdk/contracts/apps';
import { CapabilityDeniedError, CapabilityScopeError } from '../../../errors/capability';
import type { CapabilityScope } from '../../../services/capabilities/scope';
import { scopeMatches } from '../../../services/capabilities/scope';

import type { ScopedAPIContext } from './types';

/**
 * Create a scoped relations API that enforces capability restrictions.
 *
 * @param fullApi - The full unrestricted relations API
 * @param tablesApi - The tables API for resolving table names
 * @param context - The scoped API context
 * @param managedTableIds - Optional set of table IDs from manifest.managedTables
 * @returns A relations API with only the methods the app has capabilities for
 */
export function createScopedRelationsAPI(
  fullApi: IAppRelationsAPI,
  tablesApi: IAppTablesAPI,
  context: ScopedAPIContext,
  managedTableIds?: ReadonlySet<string>,
): Partial<IAppRelationsAPI> | undefined {
  const hasRead = context.hasCapability('tables:read');
  const hasWrite = context.hasCapability('tables:write');

  // Relations require at least tables:read
  if (!hasRead) {
    return undefined;
  }

  // Get scopes
  const readScope = context.getScope('tables:read');
  const writeScope = context.getScope('tables:write');

  /**
   * Get table name from ID.
   */
  async function getTableName(tableId: AppTableId): Promise<string | null> {
    const table = await tablesApi.get(tableId);
    return table?.name ?? null;
  }

  /**
   * Check if a table is accessible.
   * When managedTableIds is provided, checks ID first.
   * Otherwise falls back to name-based scope checking.
   */
  async function isTableAccessible(
    tableId: AppTableId,
    forWrite: boolean = false,
  ): Promise<boolean> {
    if (managedTableIds) {
      return managedTableIds.has(tableId);
    }
    // Fall back to name-based checking
    const tableName = await getTableName(tableId);
    if (!tableName) return false;
    return forWrite ? isTableInWriteScope(tableName) : isTableInReadScope(tableName);
  }

  /**
   * Check if a table is within the app's read scope.
   * This is used when managedTableIds is NOT provided.
   */
  function isTableInReadScope(tableName: string): boolean {
    if (!readScope) return true;
    return scopeMatches(readScope, 'table', tableName);
  }

  /**
   * Check if a table is within the app's write scope.
   * This is used when managedTableIds is NOT provided.
   */
  function isTableInWriteScope(tableName: string): boolean {
    if (!writeScope) return true;
    return scopeMatches(writeScope, 'table', tableName);
  }

  /**
   * Assert read access to a table.
   */
  async function assertReadAccess(tableId: AppTableId, _operation?: string): Promise<void> {
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
    }
  }

  /**
   * Assert write access to a table.
   */
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

  const api: Partial<IAppRelationsAPI> = {};

  // Read methods
  api.getRelated = async (tableId, recordId, relationColumnId) => {
    await assertReadAccess(tableId, 'relations.getRelated');

    // Get related records
    const related = await fullApi.getRelated(tableId, recordId, relationColumnId);

    // Filter to only records in tables the app can read
    const accessChecks = await Promise.all(
      related.map((record) => isTableAccessible(record.tableId, false)),
    );
    return related.filter((_, i) => accessChecks[i]);
  };

  api.getBacklinks = async (tableId, recordId, options?) => {
    await assertReadAccess(tableId, 'relations.getBacklinks');

    // Get backlinks
    const backlinks = await fullApi.getBacklinks(tableId, recordId, options);

    // Filter to only records in tables the app can read
    const accessChecks = await Promise.all(
      backlinks.map((record) => isTableAccessible(record.tableId, false)),
    );
    return backlinks.filter((_, i) => accessChecks[i]);
  };

  // Write methods
  if (hasWrite) {
    api.link = async (sourceTableId, sourceRecordId, relationColumnId, targetRecordId) => {
      await assertWriteAccess(sourceTableId, 'relations.link');
      await fullApi.link(sourceTableId, sourceRecordId, relationColumnId, targetRecordId);
    };

    api.unlink = async (sourceTableId, sourceRecordId, relationColumnId, targetRecordId) => {
      await assertWriteAccess(sourceTableId, 'relations.unlink');
      await fullApi.unlink(sourceTableId, sourceRecordId, relationColumnId, targetRecordId);
    };
  }

  return api;
}
