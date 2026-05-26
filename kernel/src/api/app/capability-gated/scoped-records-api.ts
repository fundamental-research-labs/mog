/**
 * Scoped Records API
 *
 * Creates a capability-gated wrapper around IAppRecordsAPI that enforces
 * table-level scoping for record operations.
 */

import type {
  AppCellValue,
  AppQueryOptions,
  AppTableId,
  IAppRecordsAPI,
  IAppTablesAPI,
  RecordId,
} from '@mog-sdk/contracts/apps';

import { createScopedAccessChecker } from './scoped-access-checker';
import type { ScopedAPIContext } from './types';

/**
 * Create a scoped records API that enforces capability restrictions.
 *
 * @param fullApi - The full unrestricted records API
 * @param tablesApi - The tables API for resolving table names
 * @param context - The scoped API context
 * @param managedTableIds - Optional set of table IDs from manifest.managedTables
 * @returns A records API with only the methods the app has capabilities for
 */
export function createScopedRecordsAPI(
  fullApi: IAppRecordsAPI,
  tablesApi: IAppTablesAPI,
  context: ScopedAPIContext,
  managedTableIds?: ReadonlySet<string>,
): Partial<IAppRecordsAPI> | undefined {
  const checker = createScopedAccessChecker({ context, tablesApi, managedTableIds });

  // Records require at least tables:read
  if (!checker.hasRead) {
    return undefined;
  }

  const api: Partial<IAppRecordsAPI> = {};

  // Read methods (always available if tables:read is granted)
  api.get = async (tableId: AppTableId, recordId: RecordId) => {
    await checker.assertReadAccess(tableId);
    return fullApi.get(tableId, recordId);
  };

  api.list = async (tableId: AppTableId, options?: AppQueryOptions) => {
    await checker.assertReadAccess(tableId);
    return fullApi.list(tableId, options);
  };

  // Write methods (require tables:write)
  if (checker.hasWrite) {
    api.create = async (tableId: AppTableId, values: Record<string, AppCellValue>) => {
      await checker.assertWriteAccess(tableId, 'records.create');
      return fullApi.create(tableId, values);
    };

    api.update = async (
      tableId: AppTableId,
      recordId: RecordId,
      values: Record<string, AppCellValue>,
    ) => {
      await checker.assertWriteAccess(tableId, 'records.update');
      return fullApi.update(tableId, recordId, values);
    };

    api.delete = async (tableId: AppTableId, recordId: RecordId) => {
      await checker.assertWriteAccess(tableId, 'records.delete');
      await fullApi.delete(tableId, recordId);
    };

    api.createBatch = async (tableId: AppTableId, records: Record<string, AppCellValue>[]) => {
      await checker.assertWriteAccess(tableId, 'records.createBatch');
      return fullApi.createBatch(tableId, records);
    };

    api.updateBatch = async (
      tableId: AppTableId,
      updates: Array<{ id: RecordId; values: Record<string, AppCellValue> }>,
    ) => {
      await checker.assertWriteAccess(tableId, 'records.updateBatch');
      return fullApi.updateBatch(tableId, updates);
    };

    api.deleteBatch = async (tableId: AppTableId, recordIds: RecordId[]) => {
      await checker.assertWriteAccess(tableId, 'records.deleteBatch');
      await fullApi.deleteBatch(tableId, recordIds);
    };
  }

  return api;
}
