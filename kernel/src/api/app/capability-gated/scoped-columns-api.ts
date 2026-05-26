/**
 * Scoped Columns API
 *
 * Creates a capability-gated wrapper around IAppColumnsAPI that enforces
 * table-level scoping for column operations.
 */

import type {
  AppColumnId,
  AppColumnSchema,
  AppTableId,
  IAppColumnsAPI,
  IAppTablesAPI,
} from '@mog-sdk/contracts/apps';
import { CapabilityDeniedError } from '../../../errors/capability';

import { createScopedAccessChecker } from './scoped-access-checker';
import type { ScopedAPIContext } from './types';

/**
 * Create a scoped columns API that enforces capability restrictions.
 *
 * @param fullApi - The full unrestricted columns API
 * @param tablesApi - The tables API for resolving table names
 * @param context - The scoped API context
 * @param managedTableIds - Optional set of table IDs from manifest.managedTables
 * @returns A columns API with only the methods the app has capabilities for
 */
export function createScopedColumnsAPI(
  fullApi: IAppColumnsAPI,
  tablesApi: IAppTablesAPI,
  context: ScopedAPIContext,
  managedTableIds?: ReadonlySet<string>,
): Partial<IAppColumnsAPI> | undefined {
  const checker = createScopedAccessChecker({ context, tablesApi, managedTableIds });
  const hasSchema = context.hasCapability('columns:schema');

  // Columns require at least tables:read
  if (!checker.hasRead) {
    return undefined;
  }

  /**
   * Assert schema access to a table.
   */
  async function assertSchemaAccess(tableId: AppTableId, operation: string): Promise<void> {
    if (!hasSchema) {
      throw new CapabilityDeniedError(context.appId, 'columns:schema', {
        operation,
      });
    }
    await checker.assertReadAccess(tableId);
  }

  const api: Partial<IAppColumnsAPI> = {};

  // Read methods
  api.get = async (tableId: AppTableId, columnId: AppColumnId) => {
    await checker.assertReadAccess(tableId);
    return fullApi.get(tableId, columnId);
  };

  api.findByName = async (tableId: AppTableId, name: string) => {
    await checker.assertReadAccess(tableId);
    return fullApi.findByName(tableId, name);
  };

  api.list = async (tableId: AppTableId) => {
    await checker.assertReadAccess(tableId);
    return fullApi.list(tableId);
  };

  // Schema modification methods (require columns:schema)
  if (hasSchema) {
    api.create = async (
      tableId: AppTableId,
      schema: AppColumnSchema,
      options?: { index?: number },
    ) => {
      await assertSchemaAccess(tableId, 'columns.create');
      return fullApi.create(tableId, schema, options);
    };

    api.update = async (
      tableId: AppTableId,
      columnId: AppColumnId,
      updates: Partial<AppColumnSchema>,
    ) => {
      await assertSchemaAccess(tableId, 'columns.update');
      return fullApi.update(tableId, columnId, updates);
    };

    api.rename = async (tableId: AppTableId, columnId: AppColumnId, newName: string) => {
      await assertSchemaAccess(tableId, 'columns.rename');
      return fullApi.rename(tableId, columnId, newName);
    };

    api.delete = async (tableId: AppTableId, columnId: AppColumnId) => {
      await assertSchemaAccess(tableId, 'columns.delete');
      return fullApi.delete(tableId, columnId);
    };
  }

  return api;
}
