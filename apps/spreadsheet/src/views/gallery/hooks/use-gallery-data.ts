/**
 * useGalleryData Hook
 *
 * Fetches and transforms table data for gallery display.
 * Uses useSyncExternalStore for proper React 18 concurrent rendering support.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { TableId } from '../../types';
import type { CardField } from '../components/GalleryCard';

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
 * Record data for gallery display.
 */
export interface GalleryRecord {
  /** Row ID */
  id: RowId;
  /** Title (from titleColumn) */
  title: string;
  /** Cover image URL (from coverImageColumn, if present) */
  coverImageUrl?: string | null;
  /** Additional fields to display */
  fields: CardField[];
}

/**
 * Configuration for how to map table columns to gallery card properties.
 */
export interface GalleryDataConfig {
  /** Title column (required) */
  titleColumn: ColId;
  /** Cover image column (optional) */
  coverImageColumn?: ColId;
  /** Additional fields to display on cards */
  cardFields: ColId[];
}

/**
 * Options for useGalleryData hook.
 */
export interface UseGalleryDataOptions {
  /** Workbook API for data access */
  workbook: Workbook | null;
  /** Table to fetch data from */
  tableId: TableId;
  /** Configuration for mapping columns to card properties */
  config: GalleryDataConfig;
}

/**
 * Return type for useGalleryData hook.
 */
export interface UseGalleryDataResult {
  /** Records to display */
  records: GalleryRecord[];
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
  /** Refresh data */
  refresh: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extracts string value from a cell value (for URLs, titles, etc.).
 */
function extractStringValue(value: CellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'object' &&
    'type' in value &&
    (value as { type: string }).type === 'error'
  ) {
    return '';
  }
  return String(value);
}

// =============================================================================
// Data Store
// =============================================================================

/**
 * Mock function to get records from a table.
 * TODO: Replace with actual workbook.records.query() when wired up.
 */
function getTableRecords(_tableId: TableId): TableRecord[] {
  // This would be replaced with actual workbook.records.query() call
  // For now, return empty array as placeholder
  return [];
}

/**
 * Mock function to get column metadata.
 * TODO: Replace with actual Worksheet API when available.
 */
function getColumnSchema(_tableId: TableId, colId: ColId): ColumnSchema {
  // This would be replaced with actual Worksheet API call
  return {
    id: colId,
    name: colId,
    kind: 'text',
  };
}

/**
 * Create a store for table data that can be subscribed to.
 */
function createTableDataStore(_workbook: Workbook, tableId: TableId) {
  const listeners = new Set<() => void>();
  let currentRecords: TableRecord[] = getTableRecords(tableId);

  // Subscribe to changes
  // TODO: Use actual workbook event subscription when available
  // workbook.on('tableChanged', () => { ... });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return currentRecords;
    },
    refresh() {
      currentRecords = getTableRecords(tableId);
      listeners.forEach((l) => l());
    },
  };
}

// =============================================================================
// Transform Functions
// =============================================================================

/**
 * Transform table records into gallery records.
 * This is a pure function with no side effects.
 */
function transformRecordsToGalleryRecords(
  tableId: TableId,
  records: TableRecord[],
  config: GalleryDataConfig,
): GalleryRecord[] {
  return records.map((record) => {
    // Get title
    const titleValue = record.values.get(config.titleColumn);
    const title = extractStringValue(titleValue) || 'Untitled';

    // Get cover image URL
    let coverImageUrl: string | null = null;
    if (config.coverImageColumn) {
      const coverValue = record.values.get(config.coverImageColumn);
      coverImageUrl = extractStringValue(coverValue) || null;
    }

    // Get additional fields
    const fields: CardField[] = config.cardFields.map((colId) => {
      const column = getColumnSchema(tableId, colId);
      return {
        colId,
        name: column.name,
        value: record.values.get(colId) ?? null,
        column,
      };
    });

    return {
      id: record.rowId,
      title,
      coverImageUrl,
      fields,
    };
  });
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to fetch and transform data for gallery display.
 *
 * Uses useSyncExternalStore for proper React 18 concurrent rendering support.
 * Data transformation is done in a pure useMemo with no side effects.
 */
export function useGalleryData({
  workbook,
  tableId,
  config,
}: UseGalleryDataOptions): UseGalleryDataResult {
  // Create stable store reference
  const store = useMemo(() => {
    if (!workbook) return null;
    return createTableDataStore(workbook, tableId);
  }, [workbook, tableId]);

  // Subscribe to table data changes using useSyncExternalStore
  const tableRecords = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => []),
    store?.getSnapshot ?? (() => []),
  );

  // Transform records to gallery format (pure computation, no side effects)
  const records = useMemo(() => {
    return transformRecordsToGalleryRecords(tableId, tableRecords, config);
  }, [tableId, tableRecords, config]);

  // Refresh callback
  const refresh = useCallback(() => {
    store?.refresh();
  }, [store]);

  // Since we're using useSyncExternalStore, loading is always false
  // (data is synchronous from the store snapshot)
  // Error handling would be done at the store level
  return {
    records,
    loading: false,
    error: null,
    refresh,
  };
}
