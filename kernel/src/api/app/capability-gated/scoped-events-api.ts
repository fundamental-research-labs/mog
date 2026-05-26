/**
 * Scoped Events API
 *
 * Creates a capability-gated wrapper around IAppEventsAPI that filters
 * events based on the app's read capabilities. Apps only receive events
 * for resources they have permission to read.
 */

import type {
  AppCellValue,
  AppColumnId,
  AppTableId,
  IAppEventsAPI,
  IAppTablesAPI,
  RecordChangeEvent,
  RecordChangeHandler,
  RecordId,
  TableSchemaChangeEvent,
  TableSchemaChangeHandler,
  Unsubscribe,
} from '@mog-sdk/contracts/apps';

import { createScopedAccessChecker } from './scoped-access-checker';
import type { ScopedAPIContext } from './types';

/**
 * Create a scoped events API that filters events by capability.
 *
 * CRITICAL: Apps only receive events for resources they can read.
 * An app with tables:read scoped to "contacts" will NOT receive
 * events for the "orders" table.
 *
 * @param fullApi - The full unrestricted events API
 * @param tablesApi - The tables API for resolving table names
 * @param context - The scoped API context
 * @param managedTableIds - Optional set of table IDs from manifest.managedTables
 * @returns An events API that filters events by capability, or undefined
 */
export function createScopedEventsAPI(
  fullApi: IAppEventsAPI,
  tablesApi: IAppTablesAPI,
  context: ScopedAPIContext,
  managedTableIds?: ReadonlySet<string>,
): IAppEventsAPI | undefined {
  // Events require events:subscribe capability
  if (!context.hasCapability('events:subscribe')) {
    return undefined;
  }

  // Also need at least tables:read to receive any useful events
  if (!context.hasCapability('tables:read')) {
    return undefined;
  }

  const checker = createScopedAccessChecker({ context, tablesApi, managedTableIds });

  return {
    onRecordChange(tableId: AppTableId, handler: RecordChangeHandler): Unsubscribe {
      // Sync fast-path: if using ID-based access and table not accessible
      if (managedTableIds && !checker.isTableAccessibleById(tableId)) {
        return () => {};
      }

      // For name-based scoping, we can't check synchronously since tablesApi.get is async.
      // Subscribe and filter events at delivery time.
      const wrappedHandler: RecordChangeHandler = (event: RecordChangeEvent) => {
        void (async () => {
          if (managedTableIds) {
            if (!checker.isTableAccessibleById(event.tableId)) return;
          } else {
            const tableName = await checker.getTableName(event.tableId);
            if (tableName && !checker.isTableInReadScope(tableName)) return;
          }
          handler(event);
        })();
      };

      return fullApi.onRecordChange(tableId, wrappedHandler);
    },

    onSchemaChange(tableId: AppTableId, handler: TableSchemaChangeHandler): Unsubscribe {
      // Sync fast-path: if using ID-based access and table not accessible
      if (managedTableIds && !checker.isTableAccessibleById(tableId)) {
        return () => {};
      }

      // For name-based scoping, subscribe and filter events at delivery time.
      const wrappedHandler: TableSchemaChangeHandler = (event: TableSchemaChangeEvent) => {
        void (async () => {
          if (managedTableIds) {
            if (!checker.isTableAccessibleById(event.tableId)) return;
          } else {
            const tableName = await checker.getTableName(event.tableId);
            if (tableName && !checker.isTableInReadScope(tableName)) return;
          }
          handler(event);
        })();
      };

      return fullApi.onSchemaChange(tableId, wrappedHandler);
    },

    onRecordFieldChange(
      tableId: AppTableId,
      recordId: RecordId,
      handler: (fieldId: AppColumnId, value: AppCellValue) => void,
    ): Unsubscribe {
      // Sync fast-path: if using ID-based access and table not accessible
      if (managedTableIds && !checker.isTableAccessibleById(tableId)) {
        return () => {};
      }

      // For name-based scoping, subscribe and filter events at delivery time.
      const wrappedHandler = (fieldId: AppColumnId, value: AppCellValue) => {
        void (async () => {
          if (managedTableIds) {
            if (!checker.isTableAccessibleById(tableId)) return;
          } else {
            const tableName = await checker.getTableName(tableId);
            if (tableName && !checker.isTableInReadScope(tableName)) return;
          }
          handler(fieldId, value);
        })();
      };

      return fullApi.onRecordFieldChange(tableId, recordId, wrappedHandler);
    },
  };
}
