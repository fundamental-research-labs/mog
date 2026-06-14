/**
 * Sheet Tab Actions Hook
 *
 * Handles all sheet tab-related operations for the spreadsheet.
 * Extracted from Spreadsheet.tsx to improve maintainability and testability.
 *
 * Features:
 * - Select sheet
 * - Add new sheet
 * - Rename sheet
 * - Delete sheet
 * - Reorder sheets (drag-to-reorder)
 * - Copy sheet
 * - Tab colors
 * - Hide/unhide sheets
 *
 * Tab Strip Enhancement (
 *
 * Architecture:
 * - Reads: sync from `wb.mirror` (kernel state mirror — sheet ids, names,
 * ordering, visibility, tab color all live there).
 * - Writes: Workbook API renameSheet(), moveSheet(), copySheet(), addSheet(), removeSheet()
 * Worksheet API setTabColor (async)
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { SheetId } from '@mog-sdk/contracts/core';

import { useActiveSheetId, useDocumentContext, useUIStore, useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseSheetTabActionsOptions {
  /** Override active sheet ID (defaults to store's active sheet) */
  sheetId?: SheetId;
}

/**
 * Sheet information for the tab strip.
 * Extended to include tabColor and hidden status (Tab Strip).
 */
export interface SheetInfo {
  id: SheetId;
  name: string;
  /** Zero-based sheet index within the workbook */
  index: number;
  /** Tab color in hex format (e.g., "#4285f4"), undefined for default */
  tabColor?: string;
  /** Whether the sheet is hidden (default: false/visible) */
  hidden?: boolean;
}

export interface UseSheetTabActionsReturn {
  // Sheet list (visible sheets only)
  sheets: SheetInfo[];
  activeSheetId: SheetId;

  // Hidden sheets (for "Unhide" menu)
  hiddenSheets: SheetInfo[];

  // Core actions
  handleSelectSheet: (sheetId: SheetId) => void;
  handleAddSheet: () => void;
  handleRenameSheet: (sheetId: SheetId, newName: string) => Promise<boolean>;
  handleDeleteSheet: (sheetId: SheetId) => void;
  handleReorderSheets: (fromIndex: number, toIndex: number) => void;

  // Tab Strip enhancements
  handleCopySheet: (sheetId: SheetId) => void;
  handleSetTabColor: (sheetId: SheetId, color: string | null) => void;
  handleHideSheet: (sheetId: SheetId) => void;
  handleUnhideSheet: (sheetId: SheetId) => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useSheetTabActions(
  options: UseSheetTabActionsOptions = {},
): UseSheetTabActionsReturn {
  const wb = useWorkbook();
  const { importDurability } = useDocumentContext();
  const storeActiveSheetId = useActiveSheetId();
  const setActiveSheet = useUIStore((s) => s.setActiveSheet);
  const openDeleteSheetConfirmDialog = useUIStore((s) => s.openDeleteSheetConfirmDialog);
  const selectSheetRequestIdRef = useRef(0);

  // Allow override for testing or custom use cases
  const activeSheetId = options.sheetId ?? storeActiveSheetId;

  // ==========================================================================
  // Reactivity: Subscribe to sheet structure events via EventBus
  // ==========================================================================

  // Force re-render when sheet structure changes
  // The updateCounter is used as a useMemo dependency to force recalculation
  const [updateCounter, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    // Subscribe to all sheet structure events individually
    const events = [
      'sheet:created',
      'sheet:deleted',
      'sheet:renamed',
      'sheet:moved',
      'sheet:visibilityChanged',
      'sheet:colorChanged',
      'sheet:copied',
    ] as const;
    const unsubscribes = events.map((event) => wb.on(event, forceUpdate));

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [wb]);

  // ==========================================================================
  // Computed Values (sync from kernel state mirror)
  // ==========================================================================

  /**
   * Build the list of all sheets with full metadata directly from the mirror.
   *
   * The mirror exposes ordered sheet ids and per-sheet metadata
   * (name/order/hidden/tabColor) — populated by `MutationResultHandler`
   * BEFORE the structure events fire, so a re-render triggered by
   * `updateCounter` always sees post-mutation state.
   *
   * `updateCounter` is the dependency: any `sheet:created/deleted/renamed/
   * moved/visibilityChanged/colorChanged/copied` event flips the counter,
   * causing this `useMemo` to re-run and re-read from the mirror.
   */
  const allSheets = useMemo<SheetInfo[]>(() => {
    const ids = wb.mirror.getSheetIds();
    const out: SheetInfo[] = [];
    ids.forEach((id, index) => {
      const meta = wb.mirror.getSheetMeta(id);
      // Skip sheets the mirror has registered but not yet populated with a
      // name (extremely brief window during initial hydration). The next
      // event will retrigger the read.
      if (meta.name === null) return;
      out.push({
        id,
        name: meta.name,
        index,
        tabColor: meta.tabColor ?? undefined,
        hidden: meta.hidden,
      });
    });
    return out;
    // updateCounter is a manual cache-bust signal — every relevant sheet event
    // bumps it, forcing this memo to re-read from the mirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb, updateCounter]);

  /**
   * Get visible sheets only (for main tab strip).
   */
  const sheets = allSheets.filter((sheet) => !sheet.hidden);

  /**
   * Get hidden sheets (for "Unhide" submenu).
   */
  const hiddenSheets = allSheets.filter((sheet) => sheet.hidden);

  // ==========================================================================
  // Core Handlers
  // ==========================================================================

  /**
   * Select a sheet by ID and make it the active sheet.
   */
  const handleSelectSheet = useCallback(
    (sheetId: SheetId) => {
      const requestId = ++selectSheetRequestIdRef.current;

      void (async () => {
        if (importDurability?.isImportDurabilityPending) {
          const awaitMaterialized =
            importDurability.awaitMaterialized?.bind(importDurability) ??
            importDurability.awaitImportDurability.bind(importDurability);
          try {
            await awaitMaterialized(sheetId);
          } catch (error) {
            console.warn('[SheetTabActions] Failed to materialize sheet before activation:', error);
          }
        }

        if (requestId === selectSheetRequestIdRef.current) {
          setActiveSheet(sheetId);
        }
      })();
    },
    [importDurability, setActiveSheet],
  );

  /**
   * Add a new sheet with auto-generated name.
   * Names follow the pattern "Sheet1", "Sheet2", etc.
   */
  const handleAddSheet = useCallback(() => {
    // Don't pass a name — let the kernel generate a unique "SheetN" name
    // by checking existing sheet names at creation time. This avoids race
    // conditions where allSheets.length is stale (e.g., 0 on initial mount
    // before the async fetch completes), which would generate "Sheet1" and
    // collide with the existing first sheet, causing duplicate React keys.
    void wb.sheets.add();
  }, [wb]);

  /**
   * Rename an existing sheet via Workbook API.
   * Returns true on success, false if the name conflicts with an existing sheet.
   */
  const handleRenameSheet = useCallback(
    async (sheetId: SheetId, newName: string): Promise<boolean> => {
      const sheet = allSheets.find((s) => s.id === sheetId);
      if (!sheet) return false;
      try {
        await wb.sheets.rename(sheet.name, newName);
        return true;
      } catch {
        return false;
      }
    },
    [wb, allSheets],
  );

  /**
   * Delete a sheet by ID. Gates on Excel-parity emptiness rule:
   * - Empty sheet → remove immediately, no dialog.
   * - Non-empty sheet → open the confirm dialog; the dialog dispatches
   * CONFIRM_DELETE_SHEET, whose handler does the actual mutation.
   */
  const handleDeleteSheet = useCallback(
    (sheetId: SheetId) => {
      if (allSheets.length <= 1) return; // Can't delete last sheet

      void (async () => {
        // Sheet is "empty" when getDataBounds returns no bounds — no cells
        // contain values, formulas, or formatting in user-visible space.
        // ws.structure.getRowCount() returns 0 in that case.
        let isEmpty = false;
        const ws = wb.getSheetById(sheetId);
        try {
          isEmpty = (await ws.structure.getRowCount()) === 0;
        } catch {
          // Conservative on lookup failure: prompt rather than silently delete.
          isEmpty = false;
        }

        if (!isEmpty) {
          openDeleteSheetConfirmDialog(sheetId, ws.name);
          return;
        }

        await wb.sheets.remove(sheetId);
      })();
    },
    [wb, allSheets, openDeleteSheetConfirmDialog],
  );

  /**
   * Reorder sheets by moving from one index to another via Workbook API (fire-and-forget).
   * NOTE: wb.moveSheet takes a sheet name, not a sheet ID.
   */
  const handleReorderSheets = useCallback(
    (fromIndex: number, toIndex: number) => {
      const sheet = allSheets[fromIndex];
      if (sheet) {
        void wb.sheets.move(sheet.name, toIndex);
      }
    },
    [wb, allSheets],
  );

  // ==========================================================================
  // Tab Strip Enhancement Handlers
  // ==========================================================================

  /**
   * Copy a sheet with all its data via Workbook API.
   * The copy is named "SheetName (2)", "SheetName (3)", etc.
   */
  const handleCopySheet = useCallback(
    (sheetId: SheetId) => {
      const sheet = allSheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      // Generate copy name: "Sheet1" -> "Sheet1 (2)", "Sheet1 (2)" -> "Sheet1 (3)", etc.
      const baseName = sheet.name.replace(/\s*\(\d+\)$/, ''); // Remove existing (N) suffix
      let copyNumber = 2;
      let newName = `${baseName} (${copyNumber})`;

      // Find next available number
      const existingNames = new Set(allSheets.map((s) => s.name));
      while (existingNames.has(newName)) {
        copyNumber++;
        newName = `${baseName} (${copyNumber})`;
      }

      void wb.sheets.copy(sheetId, newName);
    },
    [wb, allSheets],
  );

  /**
   * Set the tab color for a sheet via Worksheet API (fire-and-forget).
   * @param sheetId - Sheet to modify
   * @param color - Hex color (e.g., "#4285f4") or null to clear
   */
  const handleSetTabColor = useCallback(
    (sheetId: SheetId, color: string | null) => {
      const ws = wb.getSheetById(sheetId);
      void ws.view.setTabColor(color);
    },
    [wb],
  );

  /**
   * Hide a sheet via Workbook API (fire-and-forget).
   * - Cannot hide the last visible sheet
   */
  const handleHideSheet = useCallback(
    (sheetId: SheetId) => {
      // Get visible sheets before hiding (from cached allSheets state)
      const visibleBefore = allSheets.filter((s) => !s.hidden);

      // Cannot hide the last visible sheet
      if (visibleBefore.length <= 1) return;

      void wb.sheets.hide(sheetId);
    },
    [wb, allSheets],
  );

  /**
   * Unhide a sheet via Workbook API (fire-and-forget).
   */
  const handleUnhideSheet = useCallback(
    (sheetId: SheetId) => {
      void wb.sheets.show(sheetId);
    },
    [wb],
  );

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // Sheet lists
    sheets,
    activeSheetId,
    hiddenSheets,

    // Core actions
    handleSelectSheet,
    handleAddSheet,
    handleRenameSheet,
    handleDeleteSheet,
    handleReorderSheets,

    // Tab Strip enhancements
    handleCopySheet,
    handleSetTabColor,
    handleHideSheet,
    handleUnhideSheet,
  };
}
