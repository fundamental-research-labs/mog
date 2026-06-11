/**
 * Context Menu Handler Hook
 *
 * Handles right-click context menu events on the spreadsheet grid.
 * Extracted from use-grid-mouse.ts as part of the modular composition refactoring.
 *
 * Key responsibilities:
 * 1. Classify click point (cell, row header, column header)
 * 2. Check if click is within current selection
 * 3. Update selection if clicking outside
 * 4. Invoke onContextMenu callback with target info
 *
 * @see use-grid-mouse.ts - Main hook that composes this handler
 */

import { useCallback } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { ISheetViewHitTest } from '@mog-sdk/sheet-view';
import type { ContextMenuOptions } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Selection interface subset needed for context menu handling.
 * Matches the interface from useSelection hook.
 */
export interface ContextMenuSelectionApi {
  /** All selected ranges (supports multi-selection) */
  ranges: CellRange[];
  /** Handle mouse down on a cell */
  onMouseDown: (cell: { row: number; col: number }, shiftKey: boolean, ctrlKey: boolean) => void;
  /** Handle mouse up */
  onMouseUp: () => void;
  /** Select entire column by clicking column header */
  selectColumn: (col: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean) => void;
  /** Select entire row by clicking row header */
  selectRow: (row: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean) => void;
}

/**
 * Callback for floating object context menu (shapes, charts, images).
 */
export type ObjectContextMenuCallback = (x: number, y: number, objectId: string) => void;

/**
 * Dependencies for the context menu handler hook.
 */
export interface UseContextMenuHandlerDeps {
  /** Active sheet ID for coordinate system calls */
  activeSheetId: string;
  /** Container element ref for calculating positions */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Function to get the SheetView hit-test capability (may return null if not initialized) */
  getHitTest: () => ISheetViewHitTest | null;
  /** Selection API for checking and updating selection state */
  selection: ContextMenuSelectionApi;
  /** Callback invoked when context menu should be shown for cells/headers */
  onContextMenu?: (options: ContextMenuOptions) => void;
  /** Callback invoked when context menu should be shown for floating objects (shapes, charts, images) */
  onObjectContextMenu?: ObjectContextMenuCallback;
}

/**
 * Return type for the context menu handler hook.
 */
export interface UseContextMenuHandlerReturn {
  /** Handler for context menu (right-click) events */
  handleContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get mouse position relative to container.
 */
function getRelativePosition(
  e: React.MouseEvent<HTMLDivElement>,
  container: HTMLDivElement,
): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

/**
 * Check if a cell is within any of the selection ranges.
 */
export function isCellInSelection(row: number, col: number, ranges: readonly CellRange[]): boolean {
  return ranges.some(
    (range) =>
      row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol,
  );
}

/**
 * Check if a column is within any of the selection ranges.
 */
export function isColumnInSelection(col: number, ranges: readonly CellRange[]): boolean {
  return ranges.some((range) => col >= range.startCol && col <= range.endCol);
}

/**
 * Check if a row is within any of the selection ranges.
 */
export function isRowInSelection(row: number, ranges: readonly CellRange[]): boolean {
  return ranges.some((range) => row >= range.startRow && row <= range.endRow);
}

/**
 * Determine if the current selection represents a multi-cell selection.
 */
export function isMultiCellSelection(ranges: readonly CellRange[]): boolean {
  if (ranges.length === 0) return false;
  const range = ranges[0];
  return range.startRow !== range.endRow || range.startCol !== range.endCol;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook that provides a stable handleContextMenu callback.
 *
 * This hook handles right-click events on the spreadsheet grid:
 * - Classifies the click target (cell, row header, column header)
 * - Updates selection if clicking outside current selection
 * - Invokes the onContextMenu callback with appropriate options
 *
 * @param deps - Dependencies including containerRef, coordinate system getter, selection, and callback
 * @returns Object containing the handleContextMenu callback
 *
 * @example
 * ```tsx
 * const { handleContextMenu } = useContextMenuHandler({
 * containerRef,
 * getHitTest,
 * selection,
 * onContextMenu: (options) => showContextMenu(options)
 * });
 *
 * return <div onContextMenu={handleContextMenu}>...</div>;
 * ```
 */
export function useContextMenuHandler(
  deps: UseContextMenuHandlerDeps,
): UseContextMenuHandlerReturn {
  const { activeSheetId, containerRef, getHitTest, selection, onContextMenu, onObjectContextMenu } =
    deps;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) {
        e.preventDefault();
        return;
      }

      const { x, y } = getRelativePosition(e, container);
      const hitTest = getHitTest();
      if (!hitTest) {
        e.preventDefault();
        return;
      }

      // Use SheetView hit testing to check floating objects FIRST (z-index priority).
      // Capability access is the stable contract for shell-hosted views.
      const hit = hitTest.atViewportPoint({ x, y });

      // Handle floating objects first - they render on top of cells.
      // Do NOT preventDefault() — let Radix ContextMenu open and render
      // the ObjectContextMenu content instead of CellContextMenu content.
      if (hit.type === 'floating-object') {
        if (onObjectContextMenu) {
          onObjectContextMenu(e.clientX, e.clientY, hit.objectId);
        } else {
          e.preventDefault();
        }
        return;
      }

      // For cell/header context menu, we need the callback
      if (!onContextMenu) {
        e.preventDefault();
        return;
      }

      let target: ContextMenuOptions['target'] = 'cell';
      let targetRow: number | undefined;
      let targetCol: number | undefined;

      switch (hit.type) {
        case 'cell': {
          targetRow = hit.row;
          targetCol = hit.col;

          // Check if clicked cell is within current selection
          const isInSelection = isCellInSelection(hit.row, hit.col, selection.ranges);

          if (isInSelection && selection.ranges.length > 0) {
            // If clicking inside selection, determine if it's a multi-cell selection
            target = isMultiCellSelection(selection.ranges) ? 'selection' : 'cell';
          } else {
            // Click outside selection - update selection to clicked cell
            selection.onMouseDown({ row: hit.row, col: hit.col }, false, false);
            selection.onMouseUp();
            target = 'cell';
          }
          break;
        }

        case 'column-header': {
          targetCol = hit.col;
          target = 'column-header';

          // Only keep the existing selection if it is already a full-column selection
          // that includes the right-clicked column. A single cell like A1 contains
          // column A, but should not satisfy a column-header context-menu target.
          const hasFullColumnSelection = selection.ranges.some((r) => r.isFullColumn);
          if (!hasFullColumnSelection || !isColumnInSelection(hit.col, selection.ranges)) {
            selection.selectColumn(hit.col, false, false);
          }
          break;
        }

        case 'column-resize-handle': {
          targetCol = hit.col;
          target = 'column-header';

          const hasFullColumnSelection = selection.ranges.some((r) => r.isFullColumn);
          if (!hasFullColumnSelection || !isColumnInSelection(hit.col, selection.ranges)) {
            selection.selectColumn(hit.col, false, false);
          }
          break;
        }

        case 'row-header': {
          targetRow = hit.row;
          target = 'row-header';

          // Only keep the existing selection if it is already a full-row selection
          // that includes the right-clicked row. A partial cell-range selection
          // (e.g. A1:B5 left by a chart insert) must be replaced with just the
          // right-clicked row so that INSERT_ROW_ABOVE inserts at the correct row
          // rather than at rows[0] of the partial selection.
          const hasFullRowSelection = selection.ranges.some((r) => r.isFullRow);
          if (!hasFullRowSelection || !isRowInSelection(hit.row, selection.ranges)) {
            selection.selectRow(hit.row, false, false);
          }
          break;
        }

        case 'row-resize-handle': {
          targetRow = hit.row;
          target = 'row-header';

          const hasFullRowSelection = selection.ranges.some((r) => r.isFullRow);
          if (!hasFullRowSelection || !isRowInSelection(hit.row, selection.ranges)) {
            selection.selectRow(hit.row, false, false);
          }
          break;
        }

        default:
          // No context menu for other areas (empty, frozen, etc.)
          // preventDefault() to suppress browser context menu and prevent Radix from opening
          e.preventDefault();
          return;
      }

      // Do NOT call e.preventDefault() here — let Radix ContextMenu handle
      // the native contextmenu event for positioning and opening the menu.
      // Radix's composeEventHandlers checks defaultPrevented before proceeding.

      onContextMenu({
        x: e.clientX,
        y: e.clientY,
        target,
        targetRow,
        targetCol,
      });
    },
    [activeSheetId, containerRef, getHitTest, selection, onContextMenu, onObjectContextMenu],
  );

  return { handleContextMenu };
}
