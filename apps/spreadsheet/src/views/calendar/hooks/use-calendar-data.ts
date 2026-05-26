/**
 * useCalendarData Hook
 *
 * Fetches records from a table and transforms them into calendar events.
 * Handles subscriptions to table data changes via useSyncExternalStore.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { TableId } from '../../types';
import type { CalendarEvent } from '../config';

// =============================================================================
// Types
// =============================================================================

/**
 * Record data from the table.
 */
interface TableRecord {
  rowId: RowId;
  values: Map<ColId, CellValue>;
}

/**
 * Configuration for how to map table columns to calendar event properties.
 */
export interface CalendarDataConfig {
  /** Date column (required) */
  dateColumn: ColId;
  /** Title column (optional - defaults to first text-like column) */
  titleColumn?: ColId;
  /** Title column schema (optional - for rich rendering) */
  titleColumnSchema?: ColumnSchema;
  /** End date column (optional - for multi-day events) */
  endDateColumn?: ColId;
  /** Color by column (optional) */
  colorByColumn?: ColId;
}

export interface UseCalendarDataOptions {
  /** Workbook API for data access */
  workbook: Workbook | null;
  /** Table to fetch data from */
  tableId: TableId;
  /** Configuration for mapping columns to event properties */
  config: CalendarDataConfig;
}

export interface UseCalendarDataResult {
  /** Events derived from table records */
  events: CalendarEvent[];
  /** Is data loading? */
  isLoading: boolean;
  /** Error if data fetch failed */
  error: Error | null;
  /** Refresh data */
  refresh: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse a cell value as a Date.
 */
function parseDate(value: CellValue | undefined): Date | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) return value;

  if (typeof value === 'number') {
    // Excel serial date number
    // Excel dates are days since 1900-01-01 (with a leap year bug)
    const excelEpoch = new Date(1899, 11, 30).getTime();
    const date = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/**
 * Get a color for an event based on a column value.
 */
function getEventColor(value: CellValue | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;

  // If it's a select option with a color property
  if (typeof value === 'object' && value !== null && 'color' in value) {
    return (value as { color?: string }).color;
  }

  // Simple hash-based color for strings
  if (typeof value === 'string') {
    const colors = [
      '#3b82f6', // blue
      '#22c55e', // green
      '#f59e0b', // amber
      '#ef4444', // red
      '#8b5cf6', // purple
      '#06b6d4', // cyan
      '#ec4899', // pink
      '#84cc16', // lime
    ];
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  return undefined;
}

// =============================================================================
// Data Store
// =============================================================================

/**
 * Mock function to get records from a table.
 * TODO: Replace with actual workbook.records.query() call when data flows are wired.
 */
function getTableRecords(_workbook: Workbook, _tableId: TableId): TableRecord[] {
  // This would be replaced with actual workbook.records.query() call
  // For now, return empty array as placeholder
  return [];
}

/**
 * Create a store for table data that can be subscribed to.
 */
function createTableDataStore(workbook: Workbook, tableId: TableId) {
  const listeners = new Set<() => void>();
  let currentRecords: TableRecord[] = getTableRecords(workbook, tableId);

  // Subscribe to changes
  // TODO: Use actual Workbook event subscription when available
  // workbook.on('cellChanged', (event) => { ... });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return currentRecords;
    },
    refresh() {
      currentRecords = getTableRecords(workbook, tableId);
      listeners.forEach((l) => l());
    },
  };
}

// =============================================================================
// Transform Functions
// =============================================================================

/**
 * Transform table records into calendar events.
 * This is a pure function with no side effects.
 */
function transformRecordsToEvents(
  records: TableRecord[],
  config: CalendarDataConfig,
): CalendarEvent[] {
  const calendarEvents: CalendarEvent[] = [];

  for (const record of records) {
    // Get date value
    const dateValue = record.values.get(config.dateColumn);
    const startDate = parseDate(dateValue);

    if (!startDate) continue; // Skip records without valid dates

    // Get end date (if configured)
    let endDate = startDate;
    if (config.endDateColumn) {
      const endDateValue = record.values.get(config.endDateColumn);
      const parsedEndDate = parseDate(endDateValue);
      if (parsedEndDate && parsedEndDate >= startDate) {
        endDate = parsedEndDate;
      }
    }

    // Get title and preserve raw value for column renderer
    let title = 'Untitled';
    let titleValue: CellValue | undefined;
    if (config.titleColumn) {
      titleValue = record.values.get(config.titleColumn);
      if (titleValue !== null && titleValue !== undefined) {
        title = String(titleValue);
      }
    }

    // Get color (if configured)
    let color: string | undefined;
    if (config.colorByColumn) {
      const colorValue = record.values.get(config.colorByColumn);
      color = getEventColor(colorValue);
    }

    // Determine if multi-day
    const isMultiDay = startDate.toDateString() !== endDate.toDateString();

    calendarEvents.push({
      rowId: record.rowId,
      title,
      titleValue,
      titleColumn: config.titleColumnSchema,
      startDate,
      endDate,
      color,
      isMultiDay,
    });
  }

  return calendarEvents;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to get calendar events from table data.
 *
 * Uses useSyncExternalStore for proper React 18 concurrent rendering support.
 * Data transformation is done in a pure useMemo with no side effects.
 */
export function useCalendarData({
  workbook,
  tableId,
  config,
}: UseCalendarDataOptions): UseCalendarDataResult {
  // Create stable store reference
  const store = useMemo(() => {
    if (!workbook) return null;
    return createTableDataStore(workbook, tableId);
  }, [workbook, tableId]);

  // Subscribe to table data changes using useSyncExternalStore
  const records = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => []),
    store?.getSnapshot ?? (() => []),
  );

  // Transform records to events (pure computation, no side effects)
  const events = useMemo(() => {
    return transformRecordsToEvents(records, config);
  }, [records, config]);

  // Refresh callback
  const refresh = useCallback(() => {
    store?.refresh();
  }, [store]);

  // Since we're using useSyncExternalStore, loading is always false
  // (data is synchronous from the store snapshot)
  // Error handling would be done at the store level
  return {
    events,
    isLoading: false,
    error: null,
    refresh,
  };
}
