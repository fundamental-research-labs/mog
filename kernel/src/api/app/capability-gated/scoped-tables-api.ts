/**
 * Scoped Tables API
 *
 * Creates a capability-gated wrapper around IAppTablesAPI that enforces
 * table-level scoping. Apps only see and access tables within their granted scope.
 */

import type {
  AppTableId,
  AppTableInfo,
  AppTableSchema,
  IAppTablesAPI,
} from '@mog-sdk/contracts/apps';
import { CapabilityDeniedError, CapabilityScopeError } from '../../../errors/capability';
import type { CapabilityScope } from '../../../services/capabilities/scope';

import { createScopedAccessChecker } from './scoped-access-checker';
import type { ScopedAPIContext } from './types';

/**
 * Create a scoped tables API that enforces capability restrictions.
 *
 * @param fullApi - The full unrestricted tables API
 * @param context - The scoped API context
 * @param managedTableIds - Optional set of table IDs from manifest.managedTables
 * @returns A tables API with only the methods the app has capabilities for
 */
export function createScopedTablesAPI(
  fullApi: IAppTablesAPI,
  context: ScopedAPIContext,
  managedTableIds?: ReadonlySet<string>,
): Partial<IAppTablesAPI> | undefined {
  // Pass fullApi as tablesApi since for tables API we use itself for lookups
  const checker = createScopedAccessChecker({ context, tablesApi: fullApi, managedTableIds });
  const hasCreate = context.hasCapability('tables:create');
  const hasDelete = context.hasCapability('tables:delete');
  const hasSchema = context.hasCapability('columns:schema');

  // If no table capabilities, return undefined
  if (!checker.hasRead && !checker.hasWrite && !hasCreate && !hasDelete && !hasSchema) {
    return undefined;
  }

  /**
   * Assert read access to a table (sync, takes resolved AppTableInfo).
   * Used in tables API where we already have the table info.
   */
  function assertReadAccessSync(tableInfo: AppTableInfo | null): void {
    if (!tableInfo) return;
    if (!checker.hasRead) {
      throw new CapabilityDeniedError(context.appId, 'tables:read', {
        operation: 'get',
      });
    }
    if (!checker.isTableInReadScope(tableInfo.name)) {
      throw new CapabilityScopeError(
        context.appId,
        'tables:read',
        'table',
        tableInfo.name,
        checker.readScope as CapabilityScope,
      );
    }
  }

  /**
   * Assert write access to a table (sync, takes resolved AppTableInfo).
   */
  function assertWriteAccessSync(tableInfo: AppTableInfo | null, operation: string): void {
    if (!tableInfo) return;
    if (!checker.hasWrite) {
      throw new CapabilityDeniedError(context.appId, 'tables:write', {
        operation,
      });
    }
    if (!checker.isTableInWriteScope(tableInfo.name)) {
      throw new CapabilityScopeError(
        context.appId,
        'tables:write',
        'table',
        tableInfo.name,
        checker.writeScope as CapabilityScope,
      );
    }
  }

  const api: Partial<IAppTablesAPI> = {};

  // Read methods
  if (checker.hasRead) {
    api.get = async (tableId: AppTableId) => {
      // Check ID-based access first
      if (!checker.isTableAccessibleById(tableId)) {
        return null;
      }
      const table = await fullApi.get(tableId);
      // If managedTableIds is provided, ID check is sufficient
      // Otherwise, check name-based scope
      if (table && !managedTableIds && !checker.isTableInReadScope(table.name)) {
        return null;
      }
      return table;
    };

    api.findByName = async (name: string) => {
      // If managedTableIds is provided, we need to check by ID
      if (managedTableIds) {
        const table = await fullApi.findByName(name);
        if (table && !checker.isTableAccessibleById(table.id)) {
          return null;
        }
        return table;
      }
      // Otherwise use name-based scope checking
      if (!checker.isTableInReadScope(name)) {
        return null;
      }
      return await fullApi.findByName(name);
    };

    api.list = async () => {
      const allTables = await fullApi.list();
      // Filter based on managedTableIds or name-based scope
      if (managedTableIds) {
        return allTables.filter((t) => checker.isTableAccessibleById(t.id));
      }
      return allTables.filter((t) => checker.isTableInReadScope(t.name));
    };
  }

  // Write methods (require tables:write for rename)
  if (checker.hasWrite && checker.hasRead) {
    api.rename = async (tableId: AppTableId, newName: string) => {
      const table = await fullApi.get(tableId);
      assertWriteAccessSync(table, 'rename');
      // Also check if new name would be in scope
      if (!checker.isTableInWriteScope(newName)) {
        throw new CapabilityScopeError(
          context.appId,
          'tables:write',
          'table',
          newName,
          checker.writeScope as CapabilityScope,
        );
      }
      await fullApi.rename(tableId, newName);
    };
  }

  // Create method
  if (hasCreate) {
    api.create = async (
      schema: AppTableSchema,
      options?: { sheetId?: string; startCell?: string },
    ) => {
      // Check if table name is in write scope (if scoped)
      if (checker.writeScope && !checker.isTableInWriteScope(schema.name)) {
        throw new CapabilityScopeError(
          context.appId,
          'tables:create',
          'table',
          schema.name,
          checker.writeScope,
        );
      }
      return await fullApi.create(schema, options);
    };
  }

  // Delete method
  if (hasDelete && checker.hasRead) {
    api.delete = async (tableId: AppTableId) => {
      const table = await fullApi.get(tableId);
      if (!table) return;
      assertReadAccessSync(table);
      // Delete scope follows write scope
      if (checker.writeScope && !checker.isTableInWriteScope(table.name)) {
        throw new CapabilityScopeError(
          context.appId,
          'tables:delete',
          'table',
          table.name,
          checker.writeScope,
        );
      }
      await fullApi.delete(tableId);
    };
  }

  return api;
}
