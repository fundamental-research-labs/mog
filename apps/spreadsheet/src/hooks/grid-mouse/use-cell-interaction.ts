/**
 * Cell Interaction Hook
 *
 * Handles cell-specific click and double-click behaviors including:
 * - Checkbox toggle
 * - Validation dropdown opening
 * - Comment indicator click
 * - Double-click to edit
 * - Sparkline editing
 * - Word selection on double-click
 *
 * Replaced Properties, Comments, GridIndex → ViewportBuffer.
 * Migrated: getValueForEditing now uses public Worksheet API.
 *
 * NOTE: Filter button clicks are now handled by DOM overlays (FilterButtonOverlay)
 * which render invisible buttons over canvas filter buttons. This provides proper
 * Radix Popover integration without timing hacks.
 * @see components/canvas-overlays/FilterButtonOverlay.tsx
 *
 * ARCHITECTURE:
 * - ALL user interactions go through dispatch(), not direct UIStore calls
 * - Uses stable callback references (useCallback) for performance
 * - Delegates to helpers in ./helpers/click-detection for hit testing
 *
 */

import { useCallback, useMemo } from 'react';

import type { Worksheet } from '@mog-sdk/contracts/api';
import { DEFAULT_CELL_STYLE } from '@mog/spreadsheet-utils/cells/cell-style';
import type { SheetId } from '@mog-sdk/contracts/core';
import { displayString } from '@mog-sdk/contracts/core';

import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { getCellCanvasFont } from '@mog/grid-canvas';
import type { ISheetViewGeometry } from '@mog-sdk/sheet-view';
import { editorSelectors } from '../../selectors';
import type { SheetCoordinator } from '../../coordinator';
import { createSelectionCommands } from '../../coordinator/actor-access';
import type { SparklineManager } from '../../coordinator/sparklines/sparkline-manager';
import { useUIStore, useWorkbook } from '../../infra/context';
import { useEditorActions } from '../editing/use-editor-actions';
import { useActiveCell } from '../selection/use-active-cell';
import { useCoordinator } from '../shared/use-coordinator';
import { useDispatch } from '../toolbar/use-action-dependencies';

import { isClickOnCommentIndicator, isClickOnValidationDropdown } from './helpers/click-detection';
import { calculateCursorPosition } from './helpers/cursor-position';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for cell interaction handlers.
 */
export interface UseCellInteractionOptions {
  /** Active sheet ID */
  activeSheetId: SheetId;
  /** Coordinator for cell operations */
  coordinator: SheetCoordinator;
  /** Geometry capability for position calculations */
  getGeometry: () => ISheetViewGeometry | null;
  /** Container element ref for screen position calculations */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Sparkline manager for sparkline editing */
  sparklineManager?: SparklineManager;
  /** Callback for editing sparklines */
  onEditSparkline?: (sparklineId: string, row: number, col: number) => void;
  /**
   * Callback for comment indicator click.
   * Called when user clicks on the red comment indicator triangle.
   */
  onCommentIndicatorClick?: (
    cell: { row: number; col: number },
    screenPosition: { x: number; y: number },
  ) => void;
}

/**
 * Position info for sub-cell click detection.
 */
export interface CellClickPosition {
  /** X position relative to cell left */
  clickInCellX: number;
  /** Y position relative to cell top */
  clickInCellY: number;
  /** Cell width */
  cellWidth: number;
  /** Cell height */
  cellHeight: number;
}

export async function hasValidationDropdownItems(
  ws: Pick<Worksheet, 'validations'>,
  cell: CellCoord,
): Promise<boolean> {
  try {
    const dropdownItems = await ws.validations.getDropdownItems(cell.row, cell.col);
    return dropdownItems.length > 0;
  } catch {
    return false;
  }
}

/**
 * Return value from the useCellInteraction hook.
 */
export interface UseCellInteractionReturn {
  /**
   * Handle single click on a cell.
   * Processes checkbox toggle, validation dropdown, etc.
   *
   * @param cell - Cell coordinates
   * @param clickPosition - Position within cell and cell dimensions
   * @param screenPosition - Screen position for UI placement
   * @returns true if the click was handled (should not propagate)
   */
  handleCellClick: (
    cell: CellCoord,
    clickPosition: CellClickPosition,
    screenPosition: { x: number; y: number },
  ) => boolean;

  /**
   * Handle double click on a cell.
   * Starts edit mode, handles sparkline editing, word selection.
   *
   * @param cell - Cell coordinates
   * @param clickPosition - Position within cell and cell dimensions
   * @returns true if the double-click was handled
   */
  handleCellDoubleClick: (
    cell: CellCoord,
    clickPosition: CellClickPosition,
  ) => boolean | Promise<boolean>;

  /**
   * Handle checkbox cell toggle.
   * Single click on checkbox cell toggles the value.
   *
   * @param cell - Cell coordinates
   * @returns true if the cell was a checkbox and was toggled
   */
  handleCheckboxClick: (cell: CellCoord) => boolean;

  /**
   * Handle validation dropdown click.
   * Opens the validation picker for cells with list validation.
   *
   * @param cell - Cell coordinates
   * @param clickPosition - Position within cell and cell dimensions
   * @returns true if a validation dropdown was clicked
   */
  handleValidationDropdownClick: (
    cell: CellCoord,
    clickPosition: CellClickPosition,
  ) => boolean | Promise<boolean>;

  /**
   * Handle comment indicator click.
   * Opens the comment popover.
   *
   * @param cell - Cell coordinates
   * @param clickPosition - Position within cell
   * @param screenPosition - Screen position for popover placement
   * @returns true if a comment indicator was clicked
   */
  handleCommentIndicatorClick: (
    cell: CellCoord,
    clickPosition: CellClickPosition,
    screenPosition: { x: number; y: number },
  ) => boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for handling cell-specific interactions.
 *
 * Extracts cell click handling logic from useGridMouse to provide focused,
 * testable cell interaction handlers.
 *
 * NOTE: Filter button clicks are now handled by DOM overlays (FilterButtonOverlay)
 * which render invisible buttons over canvas filter buttons. This provides proper
 * Radix Popover integration without timing hacks.
 * @see components/canvas-overlays/FilterButtonOverlay.tsx
 *
 * @example
 * ```tsx
 * const cellInteraction = useCellInteraction({
 * activeSheetId,
 * coordinator,
 * getGeometry,
 * containerRef,
 * });
 *
 * // In mouse down handler:
 * if (hit.type === 'cell') {
 * const handled = cellInteraction.handleCellClick(cell, clickPosition, screenPosition);
 * if (handled) return;
 * // Continue with normal selection...
 * }
 * ```
 */
export function useCellInteraction(options: UseCellInteractionOptions): UseCellInteractionReturn {
  const {
    activeSheetId,
    coordinator,
    getGeometry,
    containerRef,
    sparklineManager,
    onEditSparkline,
    onCommentIndicatorClick,
  } = options;

  // Context and state hooks
  const wb = useWorkbook();
  const ws = wb.getSheetById(activeSheetId);
  const dispatch = useDispatch();
  const rootCoordinator = useCoordinator();

  // Performance optimization: Use useEditorActions for stable action references
  // instead of useEditor which subscribes to state and causes re-renders.
  // For state reads, use rootCoordinator.grid.access.actors.editor.getSnapshot() on-demand.
  const editorActions = useEditorActions();

  // Performance optimization: Use granular activeCell hook instead of full selection
  // This only re-renders when activeCell changes, not on every selection drag
  const { activeCell } = useActiveCell();

  // Get selection commands without subscribing to state
  // Commands are stable and don't cause re-renders
  const selectionCommands = useMemo(
    () => createSelectionCommands(rootCoordinator.grid.access.actors.selection),
    [rootCoordinator],
  );

  // UI state via UIStore
  const showProtectionAlert = useUIStore((s) => s.showProtectionAlert);

  // ============================================================================
  // Comment Indicator Click Handler
  // ============================================================================

  const handleCommentIndicatorClick = useCallback(
    (
      cell: CellCoord,
      clickPosition: CellClickPosition,
      _screenPosition: { x: number; y: number },
    ): boolean => {
      if (!onCommentIndicatorClick) return false;

      if (!ws.viewport.hasComment(cell.row, cell.col)) return false;

      const { clickInCellX, clickInCellY, cellWidth } = clickPosition;

      if (isClickOnCommentIndicator(clickInCellX, clickInCellY, cellWidth)) {
        const container = containerRef.current;
        if (!container) return false;

        const containerRect = container.getBoundingClientRect();
        const geom = getGeometry();
        if (!geom) return false;

        const cellRect = geom.getCellRect(cell);
        if (!cellRect) return false; // Cell not visible

        // Position at top-right corner of cell (where the indicator is)
        const indicatorX = containerRect.left + cellRect.x + cellRect.width;
        const indicatorY = containerRect.top + cellRect.y;

        onCommentIndicatorClick(cell, { x: indicatorX, y: indicatorY });
        return true;
      }

      return false;
    },
    [ws, activeSheetId, containerRef, getGeometry, onCommentIndicatorClick],
  );

  // ============================================================================
  // Checkbox Click Handler
  // ============================================================================

  const handleCheckboxClick = useCallback(
    (cell: CellCoord): boolean => {
      if (!coordinator.grid.isCheckboxCell(activeSheetId, cell.row, cell.col)) {
        return false;
      }

      const toggled = coordinator.grid.toggleCheckbox(cell, activeSheetId);
      if (toggled) {
        // Set selection to the toggled cell
        selectionCommands.setSelection(
          [{ startRow: cell.row, startCol: cell.col, endRow: cell.row, endCol: cell.col }],
          cell,
        );
        return true;
      }

      return false;
    },
    [activeSheetId, coordinator, selectionCommands],
  );

  // ============================================================================
  // Validation Dropdown Click Handler
  // ============================================================================

  const handleValidationDropdownClick = useCallback(
    async (cell: CellCoord, clickPosition: CellClickPosition): Promise<boolean> => {
      // Only check if clicking on the active cell (dropdown indicator is only shown there)
      if (activeCell.row !== cell.row || activeCell.col !== cell.col) {
        return false;
      }

      const { clickInCellX, clickInCellY, cellWidth, cellHeight } = clickPosition;

      if (!isClickOnValidationDropdown(clickInCellX, clickInCellY, cellWidth, cellHeight)) {
        return false;
      }

      if (!(await hasValidationDropdownItems(ws, cell))) {
        return false;
      }

      // Clicked on the dropdown arrow
      // Performance: On-demand state read via coordinator instead of subscribing to editor state
      const editorState = rootCoordinator.grid.access.actors.editor.getSnapshot();
      const isEditing = editorSelectors.isEditing(editorState);
      const isDropdownCell =
        editorSelectors.editorType(editorState) === 'dropdown' ||
        editorSelectors.editorType(editorState) === 'date';
      const isPickerOpen = editorSelectors.isPickerOpen(editorState);

      if (isEditing) {
        // Already editing - toggle picker if it's a dropdown cell
        if (isDropdownCell) {
          if (isPickerOpen) {
            editorActions.closePicker();
          } else {
            // Route through dispatch system
            dispatch('OPEN_CELL_PICKER');
          }
          return true;
        }
      } else {
        // Not editing - start editing first
        // Use ViewportBuffer.editText (sync) instead of Cells.getValueForEditing
        const vpCell = ws.viewport.getCellData(cell.row, cell.col);
        const editValue =
          vpCell?.editText ?? (vpCell?.displayText ? displayString(vpCell.displayText) : '') ?? '';
        const result = await editorActions.startEditing(
          cell,
          activeSheetId,
          editValue,
          'typing',
          undefined,
          true,
        );
        if (result.success) {
          return true;
        }
        // If start editing failed (protected cell), show alert
        if (!result.success && result.reason?.includes('protected')) {
          showProtectionAlert(result.reason);
        }
      }

      return false;
    },
    [ws, activeSheetId, activeCell, rootCoordinator, editorActions, dispatch, showProtectionAlert],
  );

  // ============================================================================
  // Main Cell Click Handler
  // ============================================================================

  const handleCellClick = useCallback(
    (
      cell: CellCoord,
      clickPosition: CellClickPosition,
      screenPosition: { x: number; y: number },
    ): boolean => {
      // NOTE: Filter button clicks are now handled by DOM overlays (FilterButtonOverlay)
      // which render invisible buttons over canvas filter buttons. This provides proper
      // Radix Popover integration without timing hacks.
      // @see components/canvas-overlays/FilterButtonOverlay.tsx

      // 1. Check comment indicator click
      if (handleCommentIndicatorClick(cell, clickPosition, screenPosition)) {
        return true;
      }

      // 2. Check checkbox toggle
      if (handleCheckboxClick(cell)) {
        return true;
      }

      // 3. Check validation dropdown click (async - fire and forget)
      void handleValidationDropdownClick(cell, clickPosition);

      // Not handled - allow normal click processing
      return false;
    },
    [handleCommentIndicatorClick, handleCheckboxClick, handleValidationDropdownClick],
  );

  // ============================================================================
  // Cell Double-Click Handler
  // ============================================================================

  // Helper to handle mouse down with merged region lookup
  const handleSelectionMouseDown = useCallback(
    (cell: CellCoord, shiftKey: boolean, ctrlKey: boolean) => {
      // Machine resolves merges via ctx.getMergedRegionAt; hook stops
      // pre-resolving.
      selectionCommands.mouseDown(cell, shiftKey, ctrlKey);
    },
    [selectionCommands],
  );

  const handleCellDoubleClick = useCallback(
    async (cell: CellCoord, clickPosition: CellClickPosition): Promise<boolean> => {
      // 1. Check for sparkline - open edit dialog instead of cell editor
      if (sparklineManager && onEditSparkline) {
        const sparkline = sparklineManager.getSparklineAtCell(activeSheetId, cell.row, cell.col);
        if (sparkline) {
          handleSelectionMouseDown(cell, false, false);
          selectionCommands.mouseUp();
          onEditSparkline(sparkline.id, cell.row, cell.col);
          return true;
        }
      }

      // 2. If already in edit mode, select word at cursor position
      // Performance: On-demand state read via coordinator instead of subscribing to editor state
      const editorState = rootCoordinator.grid.access.actors.editor.getSnapshot();
      const isEditing = editorSelectors.isEditing(editorState);

      if (isEditing) {
        const displayText = editorSelectors.value(editorState);

        if (displayText.length > 0) {
          const geomWord = getGeometry();
          if (geomWord) {
            const { clickInCellX } = clickPosition;

            // Click position relative to cell content (after padding)
            const clickXAfterPadding = clickInCellX - DEFAULT_CELL_STYLE.padding;

            // Get cell format for font measurement
            const vpCellForFont = ws.viewport.getCellData(cell.row, cell.col);
            const format = vpCellForFont?.format ?? undefined;
            const font = getCellCanvasFont(format);

            const cursorPos = calculateCursorPosition(clickXAfterPadding, displayText, font);

            // Find word boundaries
            const start = findPrevWordBoundary(displayText, cursorPos);
            const end = findNextWordBoundary(displayText, cursorPos);

            // Select the word by setting cursor to start, then selecting to end
            editorActions.setCursor(start);
            // Extend selection to end position
            for (let i = start; i < end; i++) {
              editorActions.selectRight();
            }
          }
        }
        return true;
      }

      // 3. Not already editing - start edit mode at cursor position
      handleSelectionMouseDown(cell, false, false);
      selectionCommands.mouseUp();

      // Get value for editing: use editText from ViewportBuffer if available,
      // but for formula cells without editText, fall back to getValueForEditing()
      // so the formula string (e.g. "=A1+B1") is used instead of the display value.
      const vpCell2 = ws.viewport.getCellData(cell.row, cell.col);
      const editValueHint =
        vpCell2?.editText ??
        (!vpCell2?.hasFormula && vpCell2?.displayText
          ? displayString(vpCell2.displayText)
          : undefined);

      // Calculate cursor position from click coordinates
      let cursorPosition: number | undefined;
      const geomCursor = getGeometry();
      if (geomCursor && editValueHint !== undefined && editValueHint.length > 0) {
        const { clickInCellX } = clickPosition;

        // Click position relative to cell content (after padding)
        const clickXAfterPadding = clickInCellX - DEFAULT_CELL_STYLE.padding;

        // Get cell format for font measurement
        const vpCellForFont2 = ws.viewport.getCellData(cell.row, cell.col);
        const format = vpCellForFont2?.format ?? undefined;
        const font = getCellCanvasFont(format);

        cursorPosition = calculateCursorPosition(clickXAfterPadding, editValueHint, font);
      }

      // Start editing in Edit Mode (double-click behavior)
      const result = await editorActions.startEditing(
        cell,
        activeSheetId,
        editValueHint,
        'doubleClick', // Edit Mode: arrows move cursor
        cursorPosition,
      );

      if (!result.success && result.reason?.includes('protected')) {
        showProtectionAlert(result.reason);
      }

      return true;
    },
    [
      activeSheetId,
      ws,
      sparklineManager,
      onEditSparkline,
      handleSelectionMouseDown,
      selectionCommands,
      rootCoordinator,
      editorActions,
      getGeometry,
      showProtectionAlert,
    ],
  );

  // ============================================================================
  // Return Handlers
  // ============================================================================

  return {
    handleCellClick,
    handleCellDoubleClick,
    handleCheckboxClick,
    handleValidationDropdownClick,
    handleCommentIndicatorClick,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find the previous word boundary from a position.
 * Used for word selection on double-click.
 */
function findPrevWordBoundary(text: string, pos: number): number {
  if (pos <= 0) return 0;
  let p = pos - 1;
  const wordCharPattern = /[\w]/;
  // Skip whitespace/non-word
  while (p > 0 && !wordCharPattern.test(text[p])) {
    p--;
  }
  // Skip word characters
  while (p > 0 && wordCharPattern.test(text[p - 1])) {
    p--;
  }
  return p;
}

/**
 * Find the next word boundary from a position.
 * Used for word selection on double-click.
 */
function findNextWordBoundary(text: string, pos: number): number {
  const len = text.length;
  if (pos >= len) return len;
  let p = pos;
  const wordCharPattern = /[\w]/;
  // Skip word characters
  while (p < len && wordCharPattern.test(text[p])) {
    p++;
  }
  // Skip whitespace/non-word
  while (p < len && !wordCharPattern.test(text[p])) {
    p++;
  }
  return p;
}
