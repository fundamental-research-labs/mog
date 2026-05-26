/**
 * useKanbanData Hook
 *
 * Subscribes to table data and groups records by the configured column.
 * Returns Kanban columns with their cards for rendering.
 *
 * Architecture:
 * - Uses Kernel Records API for data fetching (Records.query)
 * - Subscribes to cell change events via ctx.eventBus for reactivity
 * - Groups records by the configured column for Kanban display
 */

import type { TableRecord as WorkbookTableRecord, Workbook } from '@mog-sdk/contracts/api';
import { toColId, toRowId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import { useEffect, useMemo, useState } from 'react';
import type { TableId } from '../../types';
import type { KanbanViewConfig } from '../config';
import {
  groupRecordsByColumn,
  type KanbanColumn,
  type KanbanSelectOption,
} from '../utils/card-grouping';

// =============================================================================
// Types and Helpers
// =============================================================================

/**
 * Record data from the table.
 */
interface TableRecord {
  rowId: RowId;
  values: Map<ColId, CellValue>;
}

function toKanbanRecord(record: WorkbookTableRecord): TableRecord {
  const values = new Map<ColId, CellValue>();
  for (const [fieldId, value] of Object.entries(record.values)) {
    values.set(toColId(fieldId), value);
  }

  return {
    rowId: toRowId(record.rowId),
    values,
  };
}

/**
 * Get records from a table via Workbook Records API (async).
 *
 * @param wb - Workbook instance for data access
 * @param tableId - Table to query
 * @returns Promise of array of table records with values as Map
 */
async function getTableRecords(wb: Workbook, tableId: TableId): Promise<TableRecord[]> {
  const kernelRecords = await wb.records.query(tableId);

  // Convert values from object to Map for the hook interface
  return kernelRecords.map(toKanbanRecord);
}

/**
 * Get select options for a column from its schema.
 *
 * For Kanban views, columns are typically grouped by a "select" or "status" column.
 * The options define the possible values (columns in Kanban).
 *
 * TODO: Wire to schema system when column type definitions are available.
 * For now, we derive options from the actual values in the data.
 *
 * @param ctx - Store context
 * @param tableId - Table containing the column
 * @param colId - Column to get options for
 * @param records - Current records to derive options from
 * @returns Array of select options with id, label, and optional color
 */
function getSelectOptions(
  _wb: Workbook,
  _tableId: TableId,
  colId: ColId,
  records: TableRecord[],
): KanbanSelectOption[] {
  // Derive unique values from the data
  const uniqueValues = new Set<string>();
  for (const record of records) {
    const value = record.values.get(colId);
    if (value !== null && value !== undefined && value !== '') {
      uniqueValues.add(String(value));
    }
  }

  // Convert to options format
  return Array.from(uniqueValues).map((value) => ({
    value,
    label: value,
    // color could be derived from schema when available
  }));
}

/**
 * Hook to get Kanban columns with grouped cards.
 *
 * Uses async Records.query() and subscribes to events for reactivity.
 *
 * @param ctx - Store context for data access
 * @param config - Kanban view configuration
 * @returns Array of Kanban columns with their cards
 */
export function useKanbanData(
  wb: Workbook | null,
  config: KanbanViewConfig | null,
): KanbanColumn[] {
  const [records, setRecords] = useState<TableRecord[]>([]);

  // Fetch records and subscribe to events
  useEffect(() => {
    if (!wb || !config?.tableId) {
      setRecords([]);
      return;
    }

    const tableId = config.tableId;

    // Initial fetch
    const fetchRecords = () => {
      void getTableRecords(wb, tableId).then(setRecords);
    };
    fetchRecords();

    // Subscribe to data change events via Workbook.on()
    const unsubCell = wb.on('cell:changed', fetchRecords);
    const unsubBatch = wb.on('cells:batch-changed', fetchRecords);
    const unsubTable = wb.on('table:updated', (event: any) => {
      if (event.tableId === tableId) {
        fetchRecords();
      }
    });

    return () => {
      unsubCell();
      unsubBatch();
      unsubTable();
    };
  }, [wb, config?.tableId]);

  // Get select options for the groupBy column
  // Derive from data when schema is not available
  const selectOptions = useMemo(() => {
    if (!wb || !config?.tableId || !config?.groupByColumn) return [];
    return getSelectOptions(wb, config.tableId, config.groupByColumn, records);
  }, [wb, config?.tableId, config?.groupByColumn, records]);

  // Group records into columns
  const columns = useMemo(() => {
    if (!config) return [];

    return groupRecordsByColumn({
      records,
      groupByColumn: config.groupByColumn,
      cardTitleColumn: config.cardTitleColumn,
      cardFields: config.cardFields,
      cardColorColumn: config.cardColorColumn,
      selectOptions,
      showEmptyGroups: config.showEmptyGroups,
      columnOrder: config.columnOrder,
      wipLimits: config.wipLimits,
      collapsedColumns: config.collapsedColumns,
    });
  }, [records, config, selectOptions]);

  return columns;
}

/**
 * Hook to get a single record by ID.
 *
 * @param ctx - Store context
 * @param tableId - Table identifier
 * @param rowId - Row identifier
 * @returns TableRecord or null if not found
 */
export function useKanbanRecord(
  wb: Workbook | null,
  tableId: TableId | undefined,
  rowId: RowId | null,
): TableRecord | null {
  const [record, setRecord] = useState<TableRecord | null>(null);

  useEffect(() => {
    if (!wb || !tableId || !rowId) {
      setRecord(null);
      return;
    }

    void wb.records.get(tableId, rowId).then((result) => {
      if (!result) {
        setRecord(null);
      } else {
        setRecord(toKanbanRecord(result));
      }
    });
  }, [wb, tableId, rowId]);

  return record;
}
