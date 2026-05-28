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

import { useCallback, useEffect, useRef, useState } from 'react';

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
  'light22',
  'light23',
  'light24',
  'light25',
  'light26',
  'light27',
  'light28',
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
  const normalized = style.trim();
  if ((TABLE_STYLE_PRESETS as readonly string[]).includes(normalized)) {
    return normalized as TableStylePreset;
  }
  const full = normalized.match(/^TableStyle(Light|Medium|Dark)(\d+)$/i);
  if (!full) return undefined;
  const preset = `${full[1].toLowerCase()}${full[2]}`;
  return (TABLE_STYLE_PRESETS as readonly string[]).includes(preset)
    ? (preset as TableStylePreset)
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
  showFilterButtons: boolean;

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

  /** Toggle filter buttons */
  toggleFilterButtons: () => void;

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
  const openConvertToRangeDialog = useUIStore((s) => s.openConvertToRangeDialog);

  // Read selectedTableId from UIStore - updated by TableSelectionCoordination
  // This is the ONLY subscription in this hook (no selection subscriptions)
  const selectedTableId = useUIStore((s) => s.tableDesign.selectedTableId);

  const [table, setTable] = useState<TableInfo | null>(null);
  const refreshGenerationRef = useRef(0);
  const refreshContextRef = useRef({
    wb,
    selectedTableId,
    activeSheetId,
    activeRow,
    activeCol,
  });
  refreshContextRef.current = { wb, selectedTableId, activeSheetId, activeRow, activeCol };

  const refreshSelectedTable = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    const context = { wb, selectedTableId, activeSheetId, activeRow, activeCol };
    const commitTable = (nextTable: TableInfo | null) => {
      const currentContext = refreshContextRef.current;
      if (generation !== refreshGenerationRef.current) return false;
      if (
        currentContext.wb !== context.wb ||
        currentContext.selectedTableId !== context.selectedTableId ||
        currentContext.activeSheetId !== context.activeSheetId ||
        currentContext.activeRow !== context.activeRow ||
        currentContext.activeCol !== context.activeCol
      ) {
        return false;
      }
      setTable(nextTable);
      return true;
    };

    if (!selectedTableId) {
      commitTable(null);
      return;
    }

    try {
      const wsForTable = wb.getSheetById(activeSheetId);
      const byName = await wsForTable.tables.get(selectedTableId);
      if (generation !== refreshGenerationRef.current) return;
      if (byName) {
        commitTable(byName);
        return;
      }
      const byCell = await wsForTable.tables.getAtCell(activeRow, activeCol);
      commitTable(byCell ?? null);
    } catch {
      commitTable(null);
    }
  }, [wb, selectedTableId, activeSheetId, activeRow, activeCol]);

  useEffect(() => {
    void refreshSelectedTable();

    return () => {
      refreshGenerationRef.current += 1;
    };
  }, [refreshSelectedTable]);

  useEffect(() => {
    if (!selectedTableId) return;
    const wsForTable = wb.getSheetById(activeSheetId);
    const refresh = () => {
      void refreshSelectedTable();
    };
    const clearIfDeleted = (event: { tableId?: string; sheetId?: string }) => {
      if (event.sheetId && event.sheetId !== activeSheetId) return;
      if (!event.tableId || event.tableId === selectedTableId || event.tableId === table?.name) {
        refreshGenerationRef.current += 1;
        setTable(null);
      }
    };
    const unsubs = [
      wsForTable.on('table:created', refresh),
      wsForTable.on('table:updated', refresh),
      wsForTable.on('table:resized', refresh),
      wsForTable.on('table:total-row-changed', refresh),
      wsForTable.on('table:converted-to-range', clearIfDeleted),
      wsForTable.on('table:deleted', clearIfDeleted),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [wb, activeSheetId, selectedTableId, table?.name, refreshSelectedTable]);

  // Extract style options from TableInfo (now directly available from Rust)
  const showBandedRows = table?.bandedRows ?? true;
  const showBandedColumns = table?.bandedColumns ?? false;
  const showFirstColumnHighlight = table?.emphasizeFirstColumn ?? false;
  const showLastColumnHighlight = table?.emphasizeLastColumn ?? false;
  const hasHeaderRow = table?.hasHeaderRow ?? true;
  const hasTotalRow = table?.hasTotalsRow ?? false;
  const showFilterButtons = table?.showFilterButtons ?? true;
  const stylePreset = normalizeTableStylePreset(table?.style);

  // === Actions ===

  const handleRenameTable = useCallback(
    async (newName: string) => {
      if (!table) return;
      await ws.tables.rename(table.name, newName);
      await refreshSelectedTable();
    },
    [ws, table, refreshSelectedTable],
  );

  const setStylePreset = useCallback(
    async (preset: TableStylePreset) => {
      if (!table) return;
      await ws.tables.setStylePreset(table.name, preset);
      await refreshSelectedTable();
    },
    [ws, table, refreshSelectedTable],
  );

  const toggleBandedRows = useCallback(() => {
    if (!table) return;
    void ws.tables.setShowBandedRows(table.name, !showBandedRows).then(refreshSelectedTable);
  }, [ws, table, showBandedRows, refreshSelectedTable]);

  const toggleBandedColumns = useCallback(() => {
    if (!table) return;
    void ws.tables
      .update(table.name, { bandedColumns: !showBandedColumns })
      .then(refreshSelectedTable);
  }, [ws, table, showBandedColumns, refreshSelectedTable]);

  const toggleFirstColumnHighlight = useCallback(() => {
    if (!table) return;
    void ws.tables
      .update(table.name, { emphasizeFirstColumn: !showFirstColumnHighlight })
      .then(refreshSelectedTable);
  }, [ws, table, showFirstColumnHighlight, refreshSelectedTable]);

  const toggleLastColumnHighlight = useCallback(() => {
    if (!table) return;
    void ws.tables
      .update(table.name, { emphasizeLastColumn: !showLastColumnHighlight })
      .then(refreshSelectedTable);
  }, [ws, table, showLastColumnHighlight, refreshSelectedTable]);

  const toggleHeaderRow = useCallback(() => {
    if (!table) return;
    void ws.tables.setShowHeaders(table.name, !table.hasHeaderRow).then(refreshSelectedTable);
  }, [ws, table, refreshSelectedTable]);

  const toggleTotalRow = useCallback(() => {
    if (!table) return;
    void ws.tables.setShowTotals(table.name, !table.hasTotalsRow).then(refreshSelectedTable);
  }, [ws, table, refreshSelectedTable]);

  const toggleFilterButtons = useCallback(() => {
    if (!table) return;
    void ws.tables.setShowFilterButton(table.name, !showFilterButtons).then(refreshSelectedTable);
  }, [ws, table, showFilterButtons, refreshSelectedTable]);

  const handleDeleteTable = useCallback(() => {
    if (!table) return;
    void ws.tables.remove(table.name);
  }, [ws, table]);

  const handleConvertToRange = useCallback(() => {
    if (!table) return;
    openConvertToRangeDialog(table.name);
  }, [table, openConvertToRangeDialog]);

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
    showFilterButtons,
    renameTable: handleRenameTable,
    setStylePreset,
    toggleBandedRows,
    toggleBandedColumns,
    toggleFirstColumnHighlight,
    toggleLastColumnHighlight,
    toggleHeaderRow,
    toggleTotalRow,
    toggleFilterButtons,
    deleteTable: handleDeleteTable,
    convertToRange: handleConvertToRange,
  };
}
