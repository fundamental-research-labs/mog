/**
 * Formula Range Drag Hook
 *
 * Handles drag operations on formula range boxes during formula editing.
 * Allows users to drag formula references (e.g., A1:B10) to modify the range.
 *
 * This hook extracts the formula range drag logic from use-grid-mouse.ts
 * as part of the refactoring effort (
 *
 * Performance: Uses getter function for editor state instead of subscribing
 * to editor state changes, preventing re-renders during formula editing.
 *
 */

import { useCallback, useRef } from 'react';

import type { FormulaRangeHitResult } from '@mog/grid-renderer';
import { calculateDraggedRange, getHandleCursor, hitTestFormulaRanges } from '@mog/grid-renderer';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';
import { extractFormulaRanges } from '../../domain/editor/formula-range-parser';

// =============================================================================
// Types
// =============================================================================

/**
 * State tracked during a formula range drag operation.
 */
export interface FormulaRangeDragState {
  /** The hit test result that initiated the drag */
  hitResult: FormulaRangeHitResult;
  /** Original range coordinates (before drag started) */
  originalRange: CellRange;
  /** Current calculated range (during drag) */
  currentRange: CellRange;
}

/**
 * Editor state needed for formula range drag.
 */
export interface FormulaEditorState {
  /** Whether currently editing a formula */
  isFormulaEditing: boolean;
  /** Current editor value */
  value: string;
  /** Origin sheet for the formula being edited */
  sheetId?: SheetId | string | null;
}

/**
 * Options for the useFormulaRangeDrag hook.
 */
export interface UseFormulaRangeDragOptions {
  /** Active sheet ID for coordinate system calls */
  activeSheetId: SheetId;
  /**
   * Getter function for editor state (on-demand read).
   * Performance: Using a getter instead of subscribing to editor state
   * prevents re-renders during formula editing.
   */
  getEditorState: () => FormulaEditorState;
  /**
   * Getter function for the active sheet name.
   * Used to filter out cross-sheet range boxes that do not belong to the
   * currently visible sheet — prevents them from consuming clicks intended
   * to add new sheet references.
   */
  getActiveSheetName: () => string;
  /** Function to dispatch formula range update */
  onUpdateFormulaRange: (rangeIndex: number, startCellId: string, endCellId: string) => void;
  /** Geometry capability for coordinate queries and dimension reads */
  getGeometry: () => ISheetViewGeometry | null;
  /** Viewport capability for scroll position */
  getViewport: () => ISheetViewViewport | null;
  /** Function to convert row/col to cell ID */
  getCellIdAtPosition: (row: number, col: number) => Promise<string | null> | string | null;
  /** Container element ref for cursor management */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Return value from the useFormulaRangeDrag hook.
 */
export interface UseFormulaRangeDragReturn {
  /** Ref holding current drag state (null when not dragging) */
  formulaRangeDragRef: React.MutableRefObject<FormulaRangeDragState | null>;
  /** Check if a point hits a formula range and start dragging if so */
  tryStartFormulaRangeDrag: (x: number, y: number) => boolean;
  /** Update the drag position during mouse move */
  moveFormulaRangeDrag: (x: number, y: number) => void;
  /** Complete the drag operation and update the formula */
  endFormulaRangeDrag: () => void;
  /** Check if a formula range drag is currently in progress */
  isFormulaRangeDragging: () => boolean;
  /** Get current drag state (null if not dragging) */
  getCurrentDragState: () => FormulaRangeDragState | null;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for handling formula range box drag operations.
 *
 * When editing a formula, users can drag the colored range boxes to modify
 * the cell references in the formula. This hook manages:
 * - Hit testing to detect clicks on range boxes
 * - Tracking drag state (original range, current position)
 * - Calculating new range during drag
 * - Updating the formula when drag completes
 *
 * @example
 * ```tsx
 * const {
 * formulaRangeDragRef,
 * tryStartFormulaRangeDrag,
 * moveFormulaRangeDrag,
 * endFormulaRangeDrag,
 * isFormulaRangeDragging
 * } = useFormulaRangeDrag({
 * editor,
 * onUpdateFormulaRange: (index, startId, endId) => {
 * dispatch('UPDATE_FORMULA_RANGE', { rangeIndex: index, startCellId: startId, endCellId: endId });
 * },
 * getGeometry,
 * getViewport,
 * getCellIdAtPosition,
 * containerRef
 * });
 *
 * // In mouse down handler:
 * if (tryStartFormulaRangeDrag(x, y)) {
 * return; // Drag started, don't process as cell click
 * }
 *
 * // In mouse move handler:
 * if (isFormulaRangeDragging()) {
 * moveFormulaRangeDrag(x, y);
 * return;
 * }
 *
 * // In mouse up handler:
 * if (isFormulaRangeDragging()) {
 * endFormulaRangeDrag;
 * return;
 * }
 * ```
 */
export function useFormulaRangeDrag(
  options: UseFormulaRangeDragOptions,
): UseFormulaRangeDragReturn {
  const {
    activeSheetId,
    getEditorState,
    getActiveSheetName,
    onUpdateFormulaRange,
    getGeometry,
    getViewport,
    getCellIdAtPosition,
    containerRef,
  } = options;

  // Drag state ref - using ref instead of state to avoid re-renders during drag
  const formulaRangeDragRef = useRef<FormulaRangeDragState | null>(null);

  /**
   * Check if a formula range drag is currently in progress.
   */
  const isFormulaRangeDragging = useCallback((): boolean => {
    return formulaRangeDragRef.current !== null;
  }, []);

  /**
   * Get current drag state.
   */
  const getCurrentDragState = useCallback((): FormulaRangeDragState | null => {
    return formulaRangeDragRef.current;
  }, []);

  /**
   * Try to start a formula range drag at the given position.
   * Returns true if a drag was started, false otherwise.
   *
   * This should be called from the mouse down handler to check if the
   * click is on a formula range box (and its handles).
   */
  const tryStartFormulaRangeDrag = useCallback(
    (x: number, y: number): boolean => {
      // Only check during formula editing
      // Performance: On-demand read via getter instead of subscribing to editor state
      const editorState = getEditorState();
      if (!editorState.isFormulaEditing || !editorState.value.startsWith('=')) {
        return false;
      }

      const geometry = getGeometry();
      const viewport = getViewport();
      if (!geometry || !viewport) {
        return false;
      }

      const positionDims = geometry.getPositionDimensions();
      const scrollPos = viewport.getScrollPosition();

      // Parse formula to get ranges
      const parsedRanges = extractFormulaRanges(editorState.value);
      if (parsedRanges.length === 0) {
        return false;
      }

      // Filter to only include ranges that belong to the currently active sheet.
      // Cross-sheet range boxes (e.g. Sheet2!A1 visible on Sheet3) must not
      // intercept clicks that are meant to add a new sheet reference — the hit
      // coordinates overlap with same-named cells on every sheet, so without
      // this filter the first cross-sheet box consumes the click.
      const activeSheetName = getActiveSheetName();
      const activeSheetRanges = parsedRanges.filter((ref) => {
        const bangIndex = ref.text.indexOf('!');
        if (bangIndex === -1) {
          // No sheet prefix belongs to the formula's origin sheet, not whichever
          // sheet is currently visible while building a cross-sheet formula.
          return !editorState.sheetId || editorState.sheetId === activeSheetId;
        }
        const refSheetName = ref.text.slice(0, bangIndex).replace(/^'|'$/g, '');
        return refSheetName.toLowerCase() === activeSheetName.toLowerCase();
      });

      if (activeSheetRanges.length === 0) {
        return false;
      }

      // Convert to hit test format
      const formulaRanges = activeSheetRanges.map((ref) => ({
        range: ref.range,
        color: ref.color,
        index: ref.index,
      }));

      // Convert viewport coordinates (includes header offsets) to layer space
      // (data area only) to match the coordinate space used by rangeToPixelBounds
      // in the hit test, which now produces region-local UNZOOMED coords via
      // the canonical helper composition.
      const cellAreaOffset = geometry.getCellAreaOffset();
      const layerPt = { x: x - cellAreaOffset.x, y: y - cellAreaOffset.y };

      // Synthesize a region for the hit test. The hit-test point is in layer
      // space (canvas minus headers); we want region-local coords with the
      // same origin, so bounds is zero. Frozen-pane awareness for formula
      // range drag would require iterating over actual rendered regions —
      // that is tracked separately. For now this preserves prior behavior
      // (main pane only) while routing through the canonical formula.
      const hitTestRegion = {
        id: 'formula-range-hit-test',
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: scrollPos.x, y: scrollPos.y },
        zoom: 1,
        metadata: undefined,
      } as const;
      const formulaRangeHit = hitTestFormulaRanges(
        layerPt,
        formulaRanges,
        hitTestRegion,
        positionDims,
      );

      if (!formulaRangeHit) {
        return false;
      }

      // Start drag - store state in ref
      formulaRangeDragRef.current = {
        hitResult: formulaRangeHit,
        originalRange: { ...formulaRangeHit.range },
        currentRange: { ...formulaRangeHit.range },
      };

      // Update cursor for the handle type
      const container = containerRef.current;
      if (container) {
        container.style.cursor = getHandleCursor(formulaRangeHit.handleType);
      }

      return true;
    },
    [activeSheetId, getEditorState, getActiveSheetName, getGeometry, getViewport, containerRef],
  );

  /**
   * Update the drag position during mouse move.
   * Calculates the new range based on the current mouse position.
   */
  const moveFormulaRangeDrag = useCallback(
    (x: number, y: number): void => {
      const dragState = formulaRangeDragRef.current;
      if (!dragState) {
        return;
      }

      const geometry = getGeometry();
      if (!geometry) {
        return;
      }

      // Convert viewport position to cell
      const cell = geometry.fromViewportPoint({ x, y });
      if (!cell) {
        return;
      }

      // Calculate the new range based on which handle is being dragged
      const newRange = calculateDraggedRange(
        dragState.originalRange,
        dragState.hitResult.handleType,
        cell,
      );

      // Update current range (for visual feedback)
      // Note: dragState is from the same ref, so this is safe
      dragState.currentRange = newRange;

      // Keep the cursor consistent during drag
      const container = containerRef.current;
      if (container) {
        container.style.cursor = getHandleCursor(dragState.hitResult.handleType);
      }
    },
    [getGeometry, containerRef],
  );

  /**
   * Complete the drag operation and update the formula.
   * Called from mouse up handler.
   */
  const endFormulaRangeDrag = useCallback((): void => {
    const dragState = formulaRangeDragRef.current;
    if (!dragState) {
      return;
    }

    const { hitResult, currentRange, originalRange } = dragState;

    // Only update if the range actually changed
    const rangeChanged =
      currentRange.startRow !== originalRange.startRow ||
      currentRange.startCol !== originalRange.startCol ||
      currentRange.endRow !== originalRange.endRow ||
      currentRange.endCol !== originalRange.endCol;

    if (rangeChanged) {
      // Convert range to CellIds for stable references (may be async)
      void (async () => {
        const startCellId = await getCellIdAtPosition(currentRange.startRow, currentRange.startCol);
        const endCellId = await getCellIdAtPosition(currentRange.endRow, currentRange.endCol);

        if (startCellId && endCellId) {
          onUpdateFormulaRange(hitResult.rangeIndex, startCellId, endCellId);
        }
      })();
    }

    // Reset drag state
    formulaRangeDragRef.current = null;

    // Reset cursor
    const container = containerRef.current;
    if (container) {
      container.style.cursor = '';
    }
  }, [getCellIdAtPosition, onUpdateFormulaRange, containerRef]);

  return {
    formulaRangeDragRef,
    tryStartFormulaRangeDrag,
    moveFormulaRangeDrag,
    endFormulaRangeDrag,
    isFormulaRangeDragging,
    getCurrentDragState,
  };
}
