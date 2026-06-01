/**
 * Draw Border Coordinator
 *
 * Wires the draw border machine state transitions to actual border mutations.
 * This coordinator subscribes to draw border machine state changes and
 * executes border operations when cells are drawn on.
 *
 * Architecture:
 * - Draw border machine owns state (mode, drawnCells, borderStyle)
 * - Coordinator executes side effects (applies/removes borders via setFormat)
 *
 * Flow:
 * 1. User activates draw border mode → machine transitions to drawingBorder/drawingBorderGrid/erasingBorder
 * 2. User clicks/drags on cells → MOUSE_DOWN/MOUSE_MOVE → machine updates drawnCells
 * 3. Coordinator detects drawnCells changes and applies borders immediately
 * 4. User releases → MOUSE_UP → machine clears drawnCells
 * 5. User deactivates → DEACTIVATE → machine returns to inactive
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import type { Worksheet } from '@mog-sdk/contracts/api';
import {
  sheetId as toSheetId,
  type CellBorders,
  type CellFormat,
  type SheetId,
} from '@mog-sdk/contracts/core';
import type { MutationResult } from '@mog-sdk/contracts/protection';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type {
  DrawBorderActor,
  DrawBorderState,
  DrawBorderStyle,
} from '../../machines/draw-border-machine';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by DrawBorderCoordinator.
 * Injected from SheetCoordinator.
 */
export interface DrawBorderCoordinatorDependencies {
  /** Draw border machine actor */
  drawBorderActor: DrawBorderActor;
  /** Worksheet for viewport reads */
  ws: Worksheet;
  /** Active sheet ID getter */
  getActiveSheetId: () => SheetId;
  /** Callback when cells change (for renderer invalidation) */
  onCellsChanged?: (sheetId: SheetId) => void;
  /** Mutation callbacks injected from coordinator layer. */
  mutations: {
    setFormat: (sheetId: SheetId, row: number, col: number, format: Partial<CellFormat>) => void;
    canEditCell: (sheetId: SheetId, row: number, col: number) => MutationResult;
  };
}

// =============================================================================
// Border Application Helpers
// =============================================================================

/**
 * Convert DrawBorderStyle to CellBorders format.
 * Draw border applies all four edges with the same style.
 */
function borderStyleToCellBorders(style: DrawBorderStyle): CellBorders {
  const border = {
    style: style.style,
    color: style.color,
  };
  return {
    top: border,
    bottom: border,
    left: border,
    right: border,
  };
}

/**
 * Convert DrawBorderStyle to grid-style CellBorders.
 * Grid mode applies all four edges to create a box around each cell.
 */
function borderStyleToGridBorders(style: DrawBorderStyle): CellBorders {
  const border = {
    style: style.style,
    color: style.color,
  };
  return {
    top: border,
    bottom: border,
    left: border,
    right: border,
  };
}

/**
 * Apply a border to a single cell.
 *
 * @param ws - Worksheet for viewport reads
 * @param sheetId - Sheet ID
 * @param row - Cell row
 * @param col - Cell column
 * @param borders - Border style to apply
 * @param mutations - Injected mutation callbacks
 */
function applyCellBorder(
  ws: Worksheet,
  sheetId: SheetId,
  row: number,
  col: number,
  borders: CellBorders,
  mutations: DrawBorderCoordinatorDependencies['mutations'],
): void {
  // Protection check - skip protected cells silently (Excel behavior)
  const check = mutations.canEditCell(sheetId, row, col);
  if (!check.success) return;

  const cellData = ws.viewport.getCellData(row, col);
  const existingFormat = (cellData?.format ?? {}) as CellFormat;
  mutations.setFormat(sheetId, row, col, {
    ...existingFormat,
    borders: {
      ...existingFormat.borders,
      ...borders,
    },
  });
}

/**
 * Remove all borders from a single cell.
 *
 * @param ws - Worksheet for viewport reads
 * @param sheetId - Sheet ID
 * @param row - Cell row
 * @param col - Cell column
 * @param mutations - Injected mutation callbacks
 */
function eraseCellBorder(
  ws: Worksheet,
  sheetId: SheetId,
  row: number,
  col: number,
  mutations: DrawBorderCoordinatorDependencies['mutations'],
): void {
  // Protection check - skip protected cells silently (Excel behavior)
  const check = mutations.canEditCell(sheetId, row, col);
  if (!check.success) return;

  const cellData = ws.viewport.getCellData(row, col);
  const existingFormat = cellData?.format ?? {};
  mutations.setFormat(sheetId, row, col, {
    ...existingFormat,
    borders: {},
  });
}

// =============================================================================
// Draw Border Coordinator
// =============================================================================

/**
 * DrawBorderCoordinator - Wires Draw Border Machine to Border Mutations
 *
 * Follows the coordinator pattern:
 * - Draw border machine owns state
 * - Coordinator owns execution
 *
 * Usage:
 * ```typescript
 * const drawBorderCoordinator = new DrawBorderCoordinator();
 * drawBorderCoordinator.setDependencies({ drawBorderActor, ws, ... });
 *
 * // Coordinator auto-subscribes and executes border operations
 *
 * // Clean up
 * drawBorderCoordinator.dispose();
 * ```
 */
export class DrawBorderCoordinator {
  /** Dependencies (injected) */
  private deps: DrawBorderCoordinatorDependencies | null = null;

  /** Subscription object for cleanup */
  private subscription: { unsubscribe: () => void } | null = null;

  /** Previous state for transition detection */
  private previousState: DrawBorderState | null = null;

  /** Previous drawn cells count for incremental processing */
  private previousDrawnCellsCount: number = 0;

  constructor() {
    // Dependencies injected via setDependencies()
  }

  // ===========================================================================
  // DEPENDENCY INJECTION
  // ===========================================================================

  /**
   * Set dependencies and start subscribing to draw border machine.
   * Call this from SheetCoordinator after actors are created.
   */
  setDependencies(deps: DrawBorderCoordinatorDependencies): void {
    // Clean up previous subscription if any
    this.dispose();

    this.deps = deps;
    this.previousState = deps.drawBorderActor.getSnapshot();
    this.previousDrawnCellsCount = 0;

    // Subscribe to draw border machine state changes
    this.subscription = deps.drawBorderActor.subscribe((state) => {
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
    this.previousDrawnCellsCount = 0;
  }

  // ===========================================================================
  // STATE CHANGE HANDLER
  // ===========================================================================

  /**
   * Handle draw border machine state changes.
   * Detects when new cells are added to drawnCells and applies borders.
   */
  private onStateChange(state: DrawBorderState): void {
    if (!this.deps || !this.previousState) {
      this.previousState = state;
      return;
    }

    const { context } = state;
    const { drawnCells, borderStyle, sheetId } = context;

    // Detect mode from state
    const isDrawingBorder = state.matches({ drawingBorder: 'active' });
    const isDrawingBorderGrid = state.matches({ drawingBorderGrid: 'active' });
    const isErasingBorder = state.matches({ erasingBorder: 'active' });

    // Check if we have new cells to process
    if (drawnCells.length > this.previousDrawnCellsCount) {
      // New cells were added - process only the new ones
      const newCells = drawnCells.slice(this.previousDrawnCellsCount);
      const targetSheetId = sheetId ? toSheetId(sheetId) : this.deps.getActiveSheetId();

      for (const cell of newCells) {
        if (isDrawingBorder && borderStyle) {
          // Draw border mode - apply border to cell edges
          this.applyDrawBorder(targetSheetId, cell, borderStyle);
        } else if (isDrawingBorderGrid && borderStyle) {
          // Draw border grid mode - apply grid borders
          this.applyGridBorder(targetSheetId, cell, borderStyle);
        } else if (isErasingBorder) {
          // Erase border mode - remove all borders
          this.eraseAllBorders(targetSheetId, cell);
        }
      }

      // Notify of changes for renderer invalidation
      if (newCells.length > 0 && this.deps.onCellsChanged) {
        this.deps.onCellsChanged(targetSheetId);
      }
    }

    // Update previous state tracking
    this.previousDrawnCellsCount = drawnCells.length;

    // Reset count when draw operation ends (mouse up)
    const wasActive =
      this.previousState.matches({ drawingBorder: 'active' }) ||
      this.previousState.matches({ drawingBorderGrid: 'active' }) ||
      this.previousState.matches({ erasingBorder: 'active' });
    const isNowIdle =
      state.matches({ drawingBorder: 'idle' }) ||
      state.matches({ drawingBorderGrid: 'idle' }) ||
      state.matches({ erasingBorder: 'idle' }) ||
      state.matches('inactive');

    if (wasActive && isNowIdle) {
      this.previousDrawnCellsCount = 0;
    }

    this.previousState = state;
  }

  // ===========================================================================
  // BORDER APPLICATION
  // ===========================================================================

  /**
   * Apply draw border to a cell.
   *
   * In draw border mode, we apply borders based on the direction of movement.
   * For simplicity, we apply all four edges when drawing on a cell.
   */
  private applyDrawBorder(sheetId: SheetId, cell: CellCoord, style: DrawBorderStyle): void {
    if (!this.deps) return;

    const borders = borderStyleToCellBorders(style);
    applyCellBorder(this.deps.ws, sheetId, cell.row, cell.col, borders, this.deps.mutations);
  }

  /**
   * Apply grid border to a cell.
   *
   * In grid mode, we apply all four edges to create a complete box.
   */
  private applyGridBorder(sheetId: SheetId, cell: CellCoord, style: DrawBorderStyle): void {
    if (!this.deps) return;

    const borders = borderStyleToGridBorders(style);
    applyCellBorder(this.deps.ws, sheetId, cell.row, cell.col, borders, this.deps.mutations);
  }

  /**
   * Erase all borders from a cell.
   */
  private eraseAllBorders(sheetId: SheetId, cell: CellCoord): void {
    if (!this.deps) return;

    eraseCellBorder(this.deps.ws, sheetId, cell.row, cell.col, this.deps.mutations);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new DrawBorderCoordinator instance.
 */
export function createDrawBorderCoordinator(): DrawBorderCoordinator {
  return new DrawBorderCoordinator();
}

// =============================================================================
// SETUP FUNCTION (for SheetCoordinator integration)
// =============================================================================

/**
 * Setup draw border coordination.
 *
 * This function is called by SheetCoordinator to set up the draw border
 * coordination feature. It creates the coordinator and returns a cleanup function.
 *
 * @param deps - Draw border coordinator dependencies
 * @returns Cleanup function to dispose the coordinator
 */
export function setupDrawBorderCoordination(deps: DrawBorderCoordinatorDependencies): () => void {
  const coordinator = createDrawBorderCoordinator();
  coordinator.setDependencies(deps);

  return () => {
    coordinator.dispose();
  };
}
