/**
 * useAppTable Hook - Simplify app table access with bindings
 *
 * This hook provides a convenient API for apps to work with their bound tables,
 * handling column mapping automatically. It supports both the new bindings system
 * and legacy direct table lookup for backward compatibility.
 *
 */

import type {
  AppCellValue,
  AppColumnId,
  AppRecord,
  AppTableId,
  AppTableInfo,
  RecordId,
  ResolvedBindings,
} from '@mog-sdk/contracts/apps';
import type { IGatedAppKernelAPI } from '@mog-sdk/contracts/capabilities';
import { useEffect, useMemo, useState } from 'react';

/**
 * Result from useAppTable hook
 */
export interface UseAppTableResult {
  /** Table ID (null if not found/bound) */
  tableId: AppTableId | null;

  /** Table info (null if not found/bound) */
  table: AppTableInfo | null;

  /** Whether the table is managed (auto-created by the app) */
  isManaged: boolean;

  /** Get actual column ID from logical name */
  getColumnId: (logicalColumnName: string) => AppColumnId | null;

  /** Get value from a record using logical column name */
  getValue: (record: AppRecord, logicalColumnName: string) => AppCellValue | null;

  /**
   * Set value on a record using logical column name.
   * Note: This is a fire-and-forget operation. Use within kernel.undoGroup() for batching.
   */
  setValue: (recordId: string, logicalColumnName: string, value: AppCellValue) => void;
}

/**
 * Hook for apps to work with their bound tables.
 *
 * Handles column mapping automatically, allowing apps to use logical column names
 * (like "Title", "Value", "Stage") while the system resolves them to actual column IDs.
 *
 * @param kernel - App Kernel API instance
 * @param bindings - Resolved bindings from AppProps (can be undefined for backward compat)
 * @param logicalTableName - The app's logical table name (e.g., "Deals", "Contacts")
 * @returns Table binding result with helpers for column access
 *
 * @example
 * ```tsx
 * function CRMApp({ kernel, bindings }: AppProps) {
 *   const dealsTable = useAppTable(kernel, bindings, 'Deals');
 *
 *   if (!dealsTable.tableId) {
 *     return <div>Deals table not found.</div>;
 *   }
 *
 *   const deals = useRecords(kernel, dealsTable.tableId);
 *
 *   // Read values using logical column names
 *   const title = dealsTable.getValue(deals[0], 'Title');
 *
 *   // Update values using logical column names
 *   dealsTable.setValue(deals[0].id, 'Stage', 'won');
 * }
 * ```
 */
export function useAppTable(
  kernel: IGatedAppKernelAPI,
  bindings: ResolvedBindings | undefined,
  logicalTableName: string,
): UseAppTableResult {
  return useMemo(() => {
    const tableBinding = bindings?.tables[logicalTableName];

    // If bindings exist and have this table, use them
    if (tableBinding) {
      return {
        tableId: tableBinding.tableId,
        table: tableBinding.table,
        isManaged: tableBinding.isManaged,

        getColumnId: (logicalColumnName: string): AppColumnId | null => {
          return tableBinding.columns[logicalColumnName] ?? null;
        },

        getValue: (record: AppRecord, logicalColumnName: string): AppCellValue | null => {
          const colId = tableBinding.columns[logicalColumnName];
          if (!colId) return null;
          // Try by column ID first, then fall back to logical name in values object
          return record.valuesByColumnId?.[colId] ?? record.values[logicalColumnName] ?? null;
        },

        setValue: (recordId: string, logicalColumnName: string, value: AppCellValue): void => {
          const colId = tableBinding.columns[logicalColumnName];
          if (colId) {
            // Use the update method with the column ID as key
            kernel.records!.update!(tableBinding.tableId, recordId as RecordId, { [colId]: value });
          }
        },
      };
    }

    // No bindings - return empty result
    // The app should handle this by either showing an error or using legacy lookup
    return {
      tableId: null,
      table: null,
      isManaged: false,
      getColumnId: () => null,
      getValue: () => null,
      setValue: () => {},
    };
  }, [kernel, bindings, logicalTableName]);
}

/**
 * Hook for legacy table lookup (backward compatibility).
 *
 * This is for apps that need to work without bindings during the transition period.
 * Apps should prefer useAppTable with bindings when available.
 *
 * @param kernel - App Kernel API instance
 * @param tableName - Table name to look up
 * @returns Table info or null if not found
 */
export function useLegacyTableLookup(
  kernel: IGatedAppKernelAPI,
  tableName: string,
): AppTableInfo | null {
  const [table, setTable] = useState<AppTableInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await kernel.tables!.findByName!(tableName);
      if (!cancelled) setTable(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [kernel, tableName]);

  return table;
}

/**
 * Utility to get a value from a record using either logical column name
 * (when bindings are available) or direct column name (legacy mode).
 *
 * @param record - The record to read from
 * @param columnName - Column name to read
 * @returns The cell value or null
 */
export function getRecordValue(record: AppRecord, columnName: string): AppCellValue | null {
  // First try the values object (keyed by column name)
  if (columnName in record.values) {
    return record.values[columnName];
  }
  // Then try valuesByColumnId (keyed by column ID)
  // Cast columnName to AppColumnId to access the branded type
  if (record.valuesByColumnId && columnName in record.valuesByColumnId) {
    return record.valuesByColumnId[columnName as AppColumnId];
  }
  return null;
}
