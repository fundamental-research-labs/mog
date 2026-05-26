/**
 * Table Selection Hook
 *
 * Provides table configuration and actions for the Table Design ribbon tab.
 * The Table Design tab is shown when selectedTableId is non-null.
 *
 * PERFORMANCE: This hook NO LONGER subscribes to selection state.
 * Instead, it reads selectedTableId from UIStore, which is updated by
 * the TableSelectionCoordination module in the coordinator.
 * This prevents ToolbarContainer re-renders on every selection change.
 *
 * Architecture (
 * - Reads: UIStore.tableDesign.selectedTableId (set by coordinator)
 * - Writes: Worksheet API (ws.tables.rename, ws.tables.update, ws.tables.setStylePreset, ws.tables.remove)
 *
 * @see engine/src/state/coordinator/features/table/table-selection-coordination.ts
 */

import { useCallback, useEffect, useState } from 'react';

import type { TableInfo } from '@mog-sdk/contracts/api';
import type { TableStylePreset } from '@mog-sdk/contracts/tables';

import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { useActiveCell } from './use-active-cell';

// =============================================================================
// Types
// =============================================================================

const TABLE_STYLE_PRESETS = [
  'none',
  'light1',
  'light2',
  'light3',
  'light4',
  'light5',
  'light6',
  'light7',
  'light8',
  'light9',
  'light10',
  'light11',
  'light12',
  'light13',
  'light14',
  'light15',
  'light16',
  'light17',
  'light18',
  'light19',
  'light20',
  'light21',
  'medium1',
  'medium2',
  'medium3',
  'medium4',
  'medium5',
  'medium6',
  'medium7',
  'medium8',
  'medium9',
  'medium10',
  'medium11',
  'medium12',
  'medium13',
  'medium14',
  'medium15',
  'medium16',
  'medium17',
  'medium18',
  'medium19',
  'medium20',
  'medium21',
  'medium22',
  'medium23',
  'medium24',
  'medium25',
  'medium26',
  'medium27',
  'medium28',
  'dark1',
  'dark2',
  'dark3',
  'dark4',
  'dark5',
  'dark6',
  'dark7',
  'dark8',
  'dark9',
  'dark10',
  'dark11',
] as const satisfies readonly TableStylePreset[];

function normalizeTableStylePreset(style: string | undefined): TableStylePreset | undefined {
  if (!style) return undefined;
  return (TABLE_STYLE_PRESETS as readonly string[]).includes(style)
    ? (style as TableStylePreset)
    : undefined;
}

export interface UseTableSelectionReturn {
  /** Whether the current selection is inside a table */
  isInTable: boolean;

  /** The table info if selection is in a table, otherwise null */
  table: TableInfo | null;

  /** Table name (for display) */
  tableName: string | null;

  /** Table style preset */
  stylePreset: TableStylePreset | undefined;

  /** Style option toggles */
  showBandedRows: boolean;
  showBandedColumns: boolean;
  showFirstColumnHighlight: boolean;
  showLastColumnHighlight: boolean;
  hasHeaderRow: boolean;
  hasTotalRow: boolean;

  // === Actions ===

  /** Rename the table */
  renameTable: (newName: string) => void;

  /** Set the style preset */
  setStylePreset: (preset: TableStylePreset) => void;

  /** Toggle banded rows */
  toggleBandedRows: () => void;

  /** Toggle banded columns */
  toggleBandedColumns: () => void;

  /** Toggle first column highlight */
  toggleFirstColumnHighlight: () => void;

  /** Toggle last column highlight */
  toggleLastColumnHighlight: () => void;

  /** Toggle header row */
  toggleHeaderRow: () => void;

  /** Toggle total row */
  toggleTotalRow: () => void;

  /** Delete the table (keep data) */
  deleteTable: () => void;

  /** Convert table to range */
  convertToRange: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for table selection detection and manipulation.
 *
 * PERFORMANCE: This hook reads selectedTableId from UIStore, which is updated
 * by the TableSelectionCoordination module. It does NOT subscribe to selection
 * state directly, preventing unnecessary re-renders during selection changes.
 *
 * Usage:
 * ```tsx
 * const { isInTable, table, renameTable, setStylePreset } = useTableSelection();
 *
 * // Show Table Design tab when in table
 * if (isInTable) {
 * // Render TableDesignRibbon
 * }
 * ```
 */
export function useTableSelection(): UseTableSelectionReturn {
  const activeSheetId = useActiveSheetId();
  const { row: activeRow, col: activeCol } = useActiveCell();
  const wb = useWorkbook();
  const ws = wb.getSheetById(activeSheetId);

  // Read selectedTableId from UIStore - updated by TableSelectionCoordination
  // This is the ONLY subscription in this hook (no selection subscriptions)
  const selectedTableId = useUIStore((s) => s.tableDesign.selectedTableId);

  const [table, setTable] = useState<TableInfo | null>(null);

  useEffect(() => {
    if (!selectedTableId) {
      setTable(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const wsForTable = wb.getSheetById(activeSheetId);
        const result = await wsForTable.tables.getAtCell(activeRow, activeCol);
        if (!cancelled) {
          setTable(result ?? null);
        }
      } catch {
        if (!cancelled) {
          setTable(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wb, selectedTableId, activeSheetId, activeRow, activeCol]);

  // Extract style options from TableInfo (now directly available from Rust)
  const showBandedRows = table?.bandedRows ?? true;
  const showBandedColumns = table?.bandedColumns ?? false;
  const showFirstColumnHighlight = table?.emphasizeFirstColumn ?? false;
  const showLastColumnHighlight = table?.emphasizeLastColumn ?? false;
  const hasHeaderRow = table?.hasHeaderRow ?? true;
  const hasTotalRow = table?.hasTotalsRow ?? false;
  const stylePreset = normalizeTableStylePreset(table?.style);

  // === Actions ===

  const handleRenameTable = useCallback(
    (newName: string) => {
      if (!table) return;
      void ws.tables.rename(table.name, newName);
    },
    [ws, table],
  );

  const setStylePreset = useCallback(
    (preset: TableStylePreset) => {
      if (!table) return;
      void ws.tables.setStylePreset(table.name, preset);
    },
    [ws, table],
  );

  const toggleBandedRows = useCallback(() => {
    if (!table) return;
    void ws.tables.setShowBandedRows(table.name, !showBandedRows);
  }, [ws, table, showBandedRows]);

  const toggleBandedColumns = useCallback(() => {
    if (!table) return;
    void ws.tables.update(table.name, { bandedColumns: !showBandedColumns });
  }, [ws, table, showBandedColumns]);

  const toggleFirstColumnHighlight = useCallback(() => {
    if (!table) return;
    void ws.tables.update(table.name, { emphasizeFirstColumn: !showFirstColumnHighlight });
  }, [ws, table, showFirstColumnHighlight]);

  const toggleLastColumnHighlight = useCallback(() => {
    if (!table) return;
    void ws.tables.update(table.name, { emphasizeLastColumn: !showLastColumnHighlight });
  }, [ws, table, showLastColumnHighlight]);

  const toggleHeaderRow = useCallback(() => {
    if (!table) return;
    void ws.tables.setShowHeaders(table.name, !table.hasHeaderRow);
  }, [ws, table]);

  const toggleTotalRow = useCallback(() => {
    if (!table) return;
    void ws.tables.setShowTotals(table.name, !table.hasTotalsRow);
  }, [ws, table]);

  const handleDeleteTable = useCallback(() => {
    if (!table) return;
    void ws.tables.remove(table.name);
  }, [ws, table]);

  const handleConvertToRange = useCallback(() => {
    if (!table) return;
    // TODO: need ws.convertToRange(tableName) — using deleteTable as workaround
    // (deleteTable does not convert structured refs to A1, unlike the proper convertToRange)
    void ws.tables.remove(table.name);
  }, [ws, table]);

  return {
    isInTable: table !== null,
    table,
    tableName: table?.name ?? null,
    stylePreset,
    showBandedRows,
    showBandedColumns,
    showFirstColumnHighlight,
    showLastColumnHighlight,
    hasHeaderRow,
    hasTotalRow,
    renameTable: handleRenameTable,
    setStylePreset,
    toggleBandedRows,
    toggleBandedColumns,
    toggleFirstColumnHighlight,
    toggleLastColumnHighlight,
    toggleHeaderRow,
    toggleTotalRow,
    deleteTable: handleDeleteTable,
    convertToRange: handleConvertToRange,
  };
}
