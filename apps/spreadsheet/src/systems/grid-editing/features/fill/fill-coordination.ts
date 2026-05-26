/**
 * Fill Coordinator
 *
 * Wires the fill handle drag operation to the fill executor.
 * This coordinator subscribes to selection machine state transitions and
 * executes fill operations when the fill handle drag ends.
 *
 * Architecture:
 * - Selection machine owns state (fillSourceRange, fillHandleEnd, draggingFillHandle)
 * - Coordinator executes side effects (calls executeFill, updates selection)
 *
 * Flow (Left-click drag):
 * 1. User drags fill handle → selection machine tracks fillSourceRange, fillHandleEnd
 * 2. User releases → END_FILL_HANDLE_DRAG → transition to idle
 * 3. Coordinator detects transition, reads fillSourceRange/fillHandleEnd
 * 4. Coordinator calls executeFillViaWorksheet() (compute + apply via Worksheet API)
 * 5. Coordinator updates selection to include filled range
 * 6. Coordinator sends CLEAR_FILL_CONTEXT to clean up machine state
 *
 * Flow (Right-click drag -):
 * 1. User right-drags fill handle → selection machine tracks fillSourceRange, fillHandleEnd
 * 2. User releases → END_RIGHT_FILL_HANDLE_DRAG → transition to idle
 * 3. Coordinator detects transition, shows fill context menu
 * 4. User selects fill option from menu → execute fill with that option
 * 5. Coordinator sends CLEAR_FILL_CONTEXT to clean up machine state
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { StoreApi } from 'zustand';

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import {
  computeFillDirection,
  computeTargetRange,
  expandRange,
  type CellRange,
  type FillOptions,
  type FillResult,
} from '../../../../domain/fill';
import { executeFillViaWorksheet } from '../../../../actions/handlers/fill/types';

import type { SelectionActor, SelectionState } from '../../../shared/actor-types';
import type { GridEditingUIStore } from '../../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by FillCoordinator.
 * Injected from SheetCoordinator.
 */
export interface FillCoordinatorDependencies {
  /** Selection machine actor */
  selectionActor: SelectionActor;
  /** Workbook for unified API access */
  workbook?: WorkbookInternal;
  /** Active sheet ID getter */
  getActiveSheetId: () => SheetId;
  /**
   * Get selected sheet IDs for multi-sheet fill.
   * Returns array of sheet IDs where first is the active sheet.
   * If not provided, defaults to single active sheet.
   */
  getSelectedSheetIds?: () => SheetId[];
  /** Check if Ctrl key is pressed (for copy mode vs fill mode) */
  isCtrlPressed?: () => boolean;
  /** UI Store for showing autofill options button and fill context menu */
  uiStore?: StoreApi<GridEditingUIStore>;
  /** Get last mouse position for context menu placement */
  getLastMousePosition?: () => { x: number; y: number } | null;
  /** When true, fill operations are blocked (read-only mode). */
  readOnly?: boolean;
}

/**
 * Result from a fill handle operation.
 * Stored for fill options menu functionality.
 */
export interface LastFillInfo {
  sourceRange: CellRange;
  targetRange: CellRange;
  sheetId: SheetId;
  options: FillOptions;
  result: FillResult;
}

// =============================================================================
// Fill Coordinator
// =============================================================================

/**
 * FillCoordinator - Wires Fill Handle to Fill Executor
 *
 * Follows the coordinator pattern:
 * - Selection machine owns state
 * - Coordinator owns execution
 *
 * Usage:
 * ```typescript
 * const fillCoordinator = new FillCoordinator();
 * fillCoordinator.setDependencies({ selectionActor, workbook, ... });
 *
 * // Coordinator auto-subscribes and executes fills
 *
 * // Clean up
 * fillCoordinator.dispose();
 * ```
 */
export class FillCoordinator {
  /** Dependencies (injected) */
  private deps: FillCoordinatorDependencies | null = null;

  /** Subscription object for cleanup */
  private subscription: { unsubscribe: () => void } | null = null;

  /** Previous selection state for transition detection */
  private previousState: SelectionState | null = null;

  /** Last fill info for fill options menu */
  private lastFillInfo: LastFillInfo | null = null;

  constructor() {
    // Dependencies injected via setDependencies()
  }

  // ===========================================================================
  // DEPENDENCY INJECTION
  // ===========================================================================

  /**
   * Set dependencies and start subscribing to selection machine.
   * Call this from SheetCoordinator after actors are created.
   */
  setDependencies(deps: FillCoordinatorDependencies): void {
    // Clean up previous subscription if any
    this.dispose();

    this.deps = deps;
    this.previousState = deps.selectionActor.getSnapshot();

    // Subscribe to selection machine state changes
    this.subscription = deps.selectionActor.subscribe((state) => {
      this.onStateChange(state);
    });
  }

  /**
   * Check if dependencies are set.
   */
  hasDependencies(): boolean {
    return this.deps !== null;
  }

  /**
   * Clean up subscription.
   */
  dispose(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.previousState = null;
  }

  // ===========================================================================
  // STATE CHANGE HANDLER
  // ===========================================================================

  /**
   * Handle selection machine state changes.
   * Detects transitions from draggingFillHandle to idle and executes fill.
   * Also detects right-drag fill handle for context menu.
   */
  private onStateChange(state: SelectionState): void {
    if (!this.deps || !this.previousState) {
      this.previousState = state;
      return;
    }

    const isNowIdle = state.matches('idle');

    // Detect transition from draggingFillHandle to idle (left-click drag)
    const wasDraggingFillHandle = this.previousState.matches('draggingFillHandle');
    if (wasDraggingFillHandle && isNowIdle) {
      // Fill handle drag ended - execute fill
      this.executeFillOperation(state);
    }

    // Detect transition from rightDraggingFillHandle to idle (right-click drag)
    const wasRightDraggingFillHandle = this.previousState.matches('rightDraggingFillHandle');
    if (wasRightDraggingFillHandle && isNowIdle) {
      // Right-click fill handle drag ended - show context menu
      this.showFillContextMenu(state);
    }

    this.previousState = state;
  }

  // ===========================================================================
  // FILL EXECUTION
  // ===========================================================================

  /**
   * Execute the fill operation based on current state context.
   *
   * This is called when the selection machine transitions from
   * draggingFillHandle to idle (user released mouse).
   *
   * When multiple sheets are selected, fill is applied
   * to all selected sheets at the same relative positions.
   */
  private async executeFillOperation(state: SelectionState): Promise<void> {
    if (!this.deps) return;

    // Read-only mode: block fill operations from human UI drag
    if (this.deps.readOnly) {
      this.clearFillContext();
      return;
    }

    const { fillSourceRange, fillHandleEnd } = state.context;

    // Validate we have the required context
    if (!fillSourceRange || !fillHandleEnd) {
      console.log('[FillCoordinator] No fillSourceRange or fillHandleEnd — aborting');
      return;
    }

    console.log('[FillCoordinator] executeFillOperation called', {
      fillSourceRange,
      fillHandleEnd,
    });

    // Check if fill handle moved
    if (
      fillHandleEnd.row === fillSourceRange.endRow &&
      fillHandleEnd.col === fillSourceRange.endCol
    ) {
      console.log('[FillCoordinator] Fill handle did not move — aborting');
      this.clearFillContext();
      return;
    }

    const workbook = this.deps.workbook;
    if (!workbook) {
      console.log('[FillCoordinator] No workbook — aborting');
      this.clearFillContext();
      return;
    }

    const activeSheetId = this.deps.getActiveSheetId();
    const ws = workbook.getSheetById(activeSheetId);

    // Compute fill direction and target range
    const direction = computeFillDirection(fillSourceRange, fillHandleEnd);
    const targetRange = computeTargetRange(fillSourceRange, fillHandleEnd);

    console.log('[FillCoordinator] Fill geometry', {
      direction,
      targetRange,
      activeSheetId,
    });

    // Check for empty/invalid target range
    if (!targetRange || isEmptyRange(targetRange)) {
      console.log('[FillCoordinator] Empty/invalid target range — aborting');
      this.clearFillContext();
      return;
    }

    // Check for Ctrl key - determines copy mode vs series fill
    const ctrlPressed = this.deps.isCtrlPressed?.() ?? false;

    // Build fill options
    const fillOptions: FillOptions = {
      direction,
      fillType: 'all',
      seriesType: ctrlPressed ? 'copy' : 'auto',
      includeFormulas: true,
      includeValues: true,
      includeFormats: true,
      smartFill: !ctrlPressed,
    };

    try {
      console.log('[FillCoordinator] Calling executeFillViaWorksheet…', { fillOptions });
      // Execute fill via Worksheet API (same as double-click fill)
      const result = await executeFillViaWorksheet(
        ws,
        fillSourceRange,
        targetRange,
        activeSheetId,
        fillOptions,
        workbook,
      );

      console.log('[FillCoordinator] executeFillViaWorksheet returned', {
        success: result.success,
        valueUpdates: result.updates.valueUpdates.length,
        formulaUpdates: result.updates.formulaUpdates.length,
        formatUpdates: result.updates.formatUpdates.length,
        errors: result.updates.errors,
      });

      if (result.success) {
        // Update selection to include filled range
        const expandedRange = expandRange(fillSourceRange, fillHandleEnd);
        this.deps.selectionActor.send({
          type: 'SET_SELECTION',
          ranges: [expandedRange],
          activeCell: state.context.activeCell,
        });

        // Store fill info for fill options menu
        this.lastFillInfo = {
          sourceRange: fillSourceRange,
          targetRange,
          sheetId: activeSheetId,
          options: fillOptions,
          result: {
            success: true,
            filledCells: result.updates.filledCellIds,
            overwrittenCells: result.updates.overwrittenCellIds,
            pattern: result.updates.pattern,
            errors: result.updates.errors,
          },
        };

        // Show autofill options button
        this.showAutofillOptionsButton(fillSourceRange, targetRange, activeSheetId, fillOptions);
      }
    } catch (err) {
      console.error('[FillCoordinator] Fill operation failed:', err);
    }

    // Clear fill context from machine
    this.clearFillContext();
  }

  /**
   * Send CLEAR_FILL_CONTEXT to selection machine.
   */
  private clearFillContext(): void {
    if (!this.deps) return;
    this.deps.selectionActor.send({ type: 'CLEAR_FILL_CONTEXT' });
  }

  /**
   * Show the autofill options button after a fill operation.
   * AutoFill Options Button
   */
  private showAutofillOptionsButton(
    sourceRange: CellRange,
    targetRange: CellRange,
    sheetId: SheetId,
    options: FillOptions,
  ): void {
    if (!this.deps?.uiStore) return;

    this.deps.uiStore.getState().showAutofillOptionsButton({
      sourceRange,
      targetRange,
      sheetId,
      originalOptions: options,
    });
  }

  // ===========================================================================
  // FILL CONTEXT MENU (Right-Click Drag Fill)
  // ===========================================================================

  /**
   * Show the fill context menu after right-click drag fill handle release.
   * Right-Click Drag Fill Context Menu
   *
   * This shows a context menu with fill options instead of executing fill immediately.
   */
  private async showFillContextMenu(state: SelectionState): Promise<void> {
    if (!this.deps?.uiStore) {
      // No UI store - can't show menu, just clear context
      this.clearFillContext();
      return;
    }

    // Read-only mode: block fill context menu
    if (this.deps.readOnly) {
      this.clearFillContext();
      return;
    }

    const { fillSourceRange, fillHandleEnd } = state.context;

    // Validate we have the required context
    if (!fillSourceRange || !fillHandleEnd) {
      // No fill context - may have been cancelled via Escape
      return;
    }

    // Check if fill handle moved (source range != target)
    const sourceEndRow = fillSourceRange.endRow;
    const sourceEndCol = fillSourceRange.endCol;
    if (fillHandleEnd.row === sourceEndRow && fillHandleEnd.col === sourceEndCol) {
      // User clicked but didn't drag - no fill needed, show regular context menu instead
      this.clearFillContext();
      return;
    }

    const sheetId = this.deps.getActiveSheetId();

    // Compute fill direction from geometry
    const direction = computeFillDirection(fillSourceRange, fillHandleEnd);

    // Compute target range (excludes source range)
    const targetRange = computeTargetRange(fillSourceRange, fillHandleEnd);

    // Check if we have a valid target range
    if (!targetRange || isEmptyRange(targetRange)) {
      // Invalid target range - clear and return
      this.clearFillContext();
      return;
    }

    // Get mouse position for context menu placement
    const mousePosition = this.deps.getLastMousePosition?.() ?? { x: 100, y: 100 };

    // Detect if source range contains date values
    const hasDateValues = await this.detectDateValues(fillSourceRange, sheetId);

    // Convert target range corners to CellIds for stable reference
    const { topLeftCellId, bottomRightCellId } = await this.getTargetCellIds(targetRange, sheetId);

    if (!topLeftCellId || !bottomRightCellId) {
      // Could not get CellIds - abort
      this.clearFillContext();
      return;
    }

    // Show the fill context menu
    this.deps.uiStore.getState().showFillContextMenu({
      position: mousePosition,
      sourceRange: fillSourceRange,
      targetCorners: {
        topLeft: topLeftCellId,
        bottomRight: bottomRightCellId,
      },
      direction,
      hasDateValues,
    });

    // NOTE: We do NOT clear fill context here - it's needed for menu actions.
    // The menu action handlers will clear it after executing fill.
  }

  /**
   * Detect if a range contains date values.
   * Used to show date-specific fill options in context menu.
   */
  private async detectDateValues(range: CellRange, sheetId: SheetId): Promise<boolean> {
    if (!this.deps?.workbook) return false;

    try {
      const ws = this.deps.workbook.getSheetById(sheetId);
      const rangeData = await ws.getRange(
        range.startRow,
        range.startCol,
        range.endRow,
        range.endCol,
      );

      for (const row of rangeData) {
        for (const cell of row) {
          // Check for date serial number (Excel dates are typically in range 1-2958465)
          const value = cell.value;
          if (typeof value === 'number' && value >= 1 && value <= 2958465) {
            // Check number format from cell format
            const numberFormat = cell.format?.numberFormat;
            if (numberFormat && isDateFormat(numberFormat)) {
              return true;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[FillCoordinator] detectDateValues failed:', err);
    }

    return false;
  }

  /**
   * Get CellIds for target range corners.
   * Used for stable reference in fill context menu.
   */
  private async getTargetCellIds(
    targetRange: CellRange,
    sheetId: SheetId,
  ): Promise<{ topLeftCellId: CellId | null; bottomRightCellId: CellId | null }> {
    if (!this.deps?.workbook) {
      return { topLeftCellId: null, bottomRightCellId: null };
    }

    const ws = this.deps.workbook.getSheetById(sheetId);
    const topLeftCellId = toCellId(
      await ws._internal.getOrCreateCellId(targetRange.startRow, targetRange.startCol),
    );
    const bottomRightCellId = toCellId(
      await ws._internal.getOrCreateCellId(targetRange.endRow, targetRange.endCol),
    );

    return { topLeftCellId, bottomRightCellId };
  }

  // ===========================================================================
  // FILL OPTIONS (for Fill Options Menu
  // ===========================================================================

  /**
   * Get the last fill info for fill options menu.
   */
  getLastFillInfo(): LastFillInfo | null {
    return this.lastFillInfo;
  }

  /**
   * Re-execute fill with different options (called from fill options menu).
   *
   * This executes a NEW fill operation (not an undo/redo).
   * The user can Ctrl+Z to undo both fills if needed.
   *
   * Uses executeFillViaWorksheet for compute + apply.
   */
  async refillWithOptions(newOptions: Partial<FillOptions>): Promise<FillResult | null> {
    if (!this.deps || !this.lastFillInfo) return null;
    if (this.deps.readOnly) return null;

    const workbook = this.deps.workbook;
    if (!workbook) return null;

    const { sourceRange, targetRange, sheetId } = this.lastFillInfo;
    const ws = workbook.getSheetById(sheetId);

    const mergedOptions: FillOptions = {
      ...this.lastFillInfo.options,
      ...newOptions,
    };

    try {
      const result = await executeFillViaWorksheet(
        ws,
        sourceRange,
        targetRange,
        sheetId,
        mergedOptions,
        workbook,
      );

      if (!result.success) return null;

      const fillResult: FillResult = {
        success: true,
        filledCells: result.updates.filledCellIds,
        overwrittenCells: result.updates.overwrittenCellIds,
        pattern: result.updates.pattern,
        errors: result.updates.errors,
      };

      this.lastFillInfo = {
        ...this.lastFillInfo,
        options: mergedOptions,
        result: fillResult,
      };

      return fillResult;
    } catch (err) {
      console.error('[FillCoordinator] Refill failed:', err);
      return null;
    }
  }

  /**
   * Clear last fill info (e.g., when selection changes).
   */
  clearLastFillInfo(): void {
    this.lastFillInfo = null;
  }

  // ===========================================================================
  // LARGE FILL CONFIRMATION
  // ===========================================================================

  // Large fill confirmation methods removed — executeFillViaWorksheet handles
  // the full pipeline internally, and large fill confirmation can be re-added
  // as a pre-check in executeFillOperation if needed.
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a range is empty (no cells to fill).
 */
function isEmptyRange(range: CellRange): boolean {
  return (
    range.startRow > range.endRow ||
    range.startCol > range.endCol ||
    (range.startRow === range.endRow && range.startCol === range.endCol && range.startRow < 0)
  );
}

/**
 * Check if a number format code is a date format.
 * Used to detect date values for showing date-specific fill options.
 */
function isDateFormat(format: string): boolean {
  // Common date format indicators
  const dateIndicators = ['d', 'm', 'y', 'h', 's', 'AM', 'PM', '/'];
  const formatLower = format.toLowerCase();

  // Check for date/time format patterns
  // Common formats: "m/d/yyyy", "dd-mmm-yy", "h:mm:ss", etc.
  return dateIndicators.some((indicator) => formatLower.includes(indicator.toLowerCase()));
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new FillCoordinator instance.
 */
export function createFillCoordinator(): FillCoordinator {
  return new FillCoordinator();
}
