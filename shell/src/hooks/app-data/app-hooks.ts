/**
 * App Data Hooks - React Integration
 *
 * Reactive React hooks that wrap the App Kernel API for use in apps.
 * These hooks automatically re-render when data changes by subscribing to kernel events.
 *
 */

import type {
  AppColumnInfo,
  AppFilter,
  AppQueryOptions,
  AppRecord,
  AppTableId,
  AppTableInfo,
  RecordId,
} from '@mog-sdk/contracts/apps';
import type { IGatedAppKernelAPI } from '@mog-sdk/contracts/capabilities';
import { useEffect, useState } from 'react';

// =============================================================================
// F4.1: Main data hook - useRecords
// =============================================================================

/**
 * Hook to fetch and reactively track records from a table.
 *
 * Automatically re-renders when:
 * - Records are created, updated, or deleted in the table
 * - Any cell value in the table changes
 *
 * @param kernel - App Kernel API instance
 * @param tableId - Table to query
 * @param options - Query options (filter, sort, limit, offset)
 * @returns Array of records matching the query
 *
 * @example
 * ```tsx
 * const tasks = useRecords(kernel, tableId, {
 *   filter: { conditions: [{ field: 'Status', operator: 'equals', value: 'Done' }] },
 *   sort: [{ field: 'Priority', direction: 'desc' }],
 *   limit: 10
 * });
 * ```
 */
export function useRecords(
  kernel: IGatedAppKernelAPI,
  tableId: AppTableId,
  options?: AppQueryOptions,
): AppRecord[] {
  const [records, setRecords] = useState<AppRecord[]>([]);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch
    void (async () => {
      const data = await kernel.records!.list!(tableId, options);
      if (!cancelled) setRecords(data);
    })();

    // Subscribe to changes
    const unsubscribe = kernel.events!.onRecordChange(tableId, () => {
      void (async () => {
        const updated = await kernel.records!.list!(tableId, options);
        if (!cancelled) setRecords(updated);
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [kernel, tableId, JSON.stringify(options)]);

  return records;
}

// =============================================================================
// F4.2: Tables list - useTables
// =============================================================================

/**
 * Hook to fetch and reactively track all tables.
 *
 * Automatically re-renders when:
 * - Tables are created or deleted
 * - Table schemas change (columns added/removed/renamed)
 *
 * @param kernel - App Kernel API instance
 * @returns Array of all tables
 *
 * @example
 * ```tsx
 * const tables = useTables(kernel);
 * return (
 *   <ul>
 *     {tables.map(t => <li key={t.id}>{t.name}</li>)}
 *   </ul>
 * );
 * ```
 */
export function useTables(kernel: IGatedAppKernelAPI): AppTableInfo[] {
  const [tables, setTables] = useState<AppTableInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    const subs: (() => void)[] = [];

    void (async () => {
      // Initial fetch
      const data = await kernel.tables!.list!();
      if (cancelled) return;
      setTables(data);

      // Subscribe to schema changes for all tables
      // Note: We need to subscribe to each table individually since onSchemaChange
      // is table-specific. When a new table is created, we'll need to re-fetch.
      // For now, we'll refetch on any schema change as a simple implementation.
      for (const table of data) {
        if (cancelled) return;
        const unsub = kernel.events!.onSchemaChange(table.id, () => {
          void (async () => {
            const updated = await kernel.tables!.list!();
            if (!cancelled) setTables(updated);
          })();
        });
        subs.push(unsub);
      }
    })();

    // Cleanup all subscriptions
    return () => {
      cancelled = true;
      subs.forEach((unsub) => unsub());
    };
  }, [kernel]);

  return tables;
}

// =============================================================================
// F4.3: Columns for a table - useColumns
// =============================================================================

/**
 * Hook to fetch and reactively track columns for a table.
 *
 * Automatically re-renders when:
 * - Columns are added or removed
 * - Column names or types change
 *
 * @param kernel - App Kernel API instance
 * @param tableId - Table to query
 * @returns Array of columns in the table
 *
 * @example
 * ```tsx
 * const columns = useColumns(kernel, tableId);
 * return (
 *   <div>
 *     {columns.map(col => (
 *       <div key={col.id}>{col.name}: {col.type.kind}</div>
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useColumns(kernel: IGatedAppKernelAPI, tableId: AppTableId): AppColumnInfo[] {
  const [columns, setColumns] = useState<AppColumnInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch
    void (async () => {
      const data = await kernel.columns!.list!(tableId);
      if (!cancelled) setColumns(data);
    })();

    // Subscribe to schema changes
    const unsubscribe = kernel.events!.onSchemaChange(tableId, () => {
      void (async () => {
        const updated = await kernel.columns!.list!(tableId);
        if (!cancelled) setColumns(updated);
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [kernel, tableId]);

  return columns;
}

// =============================================================================
// F4.4: Single record - useRecord
// =============================================================================

/**
 * Hook to fetch and reactively track a single record.
 *
 * Automatically re-renders when:
 * - The record is updated
 * - Any field value in the record changes
 *
 * @param kernel - App Kernel API instance
 * @param tableId - Table containing the record
 * @param recordId - Record to fetch
 * @returns Record data or null if not found
 *
 * @example
 * ```tsx
 * const task = useRecord(kernel, tableId, recordId);
 * if (!task) return <div>Loading...</div>;
 * return <div>Task: {task.values['Title']}</div>;
 * ```
 */
export function useRecord(
  kernel: IGatedAppKernelAPI,
  tableId: AppTableId,
  recordId: RecordId,
): AppRecord | null {
  const [record, setRecord] = useState<AppRecord | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch
    void (async () => {
      const data = await kernel.records!.get!(tableId, recordId);
      if (!cancelled) setRecord(data);
    })();

    // Subscribe to changes for this specific record
    const unsubscribe = kernel.events!.onRecordChange(tableId, (event) => {
      // Only update if the change affects our record
      if (event.recordId === recordId) {
        if (event.type === 'deleted') {
          if (!cancelled) setRecord(null);
        } else {
          void (async () => {
            const updated = await kernel.records!.get!(tableId, recordId);
            if (!cancelled) setRecord(updated);
          })();
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [kernel, tableId, recordId]);

  return record;
}

// =============================================================================
// F4.5: Count with optional filter - useRecordCount
// =============================================================================

/**
 * Hook to count records in a table with optional filtering.
 *
 * Automatically re-renders when:
 * - Records are created or deleted
 * - Record values change in a way that affects the filter
 *
 * @param kernel - App Kernel API instance
 * @param tableId - Table to query
 * @param filter - Optional filter conditions
 * @returns Number of records matching the filter
 *
 * @example
 * ```tsx
 * // Count all records
 * const totalCount = useRecordCount(kernel, tableId);
 *
 * // Count filtered records
 * const doneCount = useRecordCount(kernel, tableId, {
 *   conditions: [{ field: 'Status', operator: 'equals', value: 'Done' }]
 * });
 * ```
 */
export function useRecordCount(
  kernel: IGatedAppKernelAPI,
  tableId: AppTableId,
  filter?: AppFilter,
): number {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const options = filter ? { filter } : undefined;

    // Initial count
    void (async () => {
      const records = await kernel.records!.list!(tableId, options);
      if (!cancelled) setCount(records.length);
    })();

    // Subscribe to changes
    const unsubscribe = kernel.events!.onRecordChange(tableId, () => {
      void (async () => {
        const updated = await kernel.records!.list!(tableId, options);
        if (!cancelled) setCount(updated.length);
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [kernel, tableId, JSON.stringify(filter)]);

  return count;
}

// =============================================================================
// F4.6: Related records (for relations) - useRelated
// =============================================================================

/**
 * Hook to fetch and reactively track related records via a relation column.
 *
 * Automatically re-renders when:
 * - The relation column value changes (links added/removed)
 * - Any of the related records are updated
 *
 * @param kernel - App Kernel API instance
 * @param tableId - Source table
 * @param recordId - Source record
 * @param relationColumn - Name or ID of the relation column
 * @returns Array of related records
 *
 * @example
 * ```tsx
 * // Get all tasks related to a project
 * const projectTasks = useRelated(kernel, projectTableId, projectId, 'Tasks');
 *
 * return (
 *   <div>
 *     <h3>Tasks ({projectTasks.length})</h3>
 *     {projectTasks.map(task => (
 *       <div key={task.id}>{task.values['Title']}</div>
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useRelated(
  kernel: IGatedAppKernelAPI,
  tableId: AppTableId,
  recordId: RecordId,
  relationColumn: string,
): AppRecord[] {
  const [relatedRecords, setRelatedRecords] = useState<AppRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    const subs: (() => void)[] = [];

    void (async () => {
      // Find the column ID from the name
      const columns = await kernel.columns!.list!(tableId);
      if (cancelled) return;

      const column = columns.find(
        (col) => col.name === relationColumn || col.id === relationColumn,
      );

      if (!column) {
        console.warn(`[useRelated] Column "${relationColumn}" not found in table ${tableId}`);
        setRelatedRecords([]);
        return;
      }

      // Initial fetch
      const data = await kernel.relations!.getRelated!(tableId, recordId, column.id);
      if (cancelled) return;
      setRelatedRecords(data);

      // Subscribe to changes in the source record (relation column might change)
      const unsubscribeSource = kernel.events!.onRecordChange(tableId, (event) => {
        if (event.recordId === recordId) {
          void (async () => {
            const updated = await kernel.relations!.getRelated!(tableId, recordId, column.id);
            if (!cancelled) setRelatedRecords(updated);
          })();
        }
      });
      subs.push(unsubscribeSource);

      // Subscribe to changes in the target table (related records might change)
      // First, we need to get the target table ID from the column type
      const targetTableId = column.type.targetTableId;

      if (targetTableId) {
        const unsubscribeTarget = kernel.events!.onRecordChange(targetTableId, () => {
          void (async () => {
            const updated = await kernel.relations!.getRelated!(tableId, recordId, column.id);
            if (!cancelled) setRelatedRecords(updated);
          })();
        });
        subs.push(unsubscribeTarget);
      }
    })();

    return () => {
      cancelled = true;
      subs.forEach((unsub) => unsub());
    };
  }, [kernel, tableId, recordId, relationColumn]);

  return relatedRecords;
}
