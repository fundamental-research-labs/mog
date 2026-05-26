/**
 * Mode Action Handlers - Selection mode toggles and corner rotation.
 *
 * Handlers for:
 * - F8: Toggle Extend Selection Mode
 * - Shift+F8: Toggle Add to Selection Mode
 * - Ctrl+.: Rotate Selection Corner
 * - End: Activate End Mode
 *
 * Excel Parity 2.5 & 2.6
 *
 */

import {
  getUIStore,
  handled,
  hasMultiCellSelection,
  normalizeRange,
  type ActionHandler,
  type CellCoord,
  type CellRange,
} from './helpers';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a hash of the selection ranges for detecting selection changes.
 */
export function getSelectionHash(ranges: CellRange[]): string {
  return ranges.map((r) => `${r.startRow},${r.startCol},${r.endRow},${r.endCol}`).join('|');
}

/**
 * Corner positions for rotation.
 * Clockwise order: topLeft -> topRight -> bottomRight -> bottomLeft -> topLeft
 */
type CornerPosition = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

/**
 * Get the cell at a specific corner of a range.
 */
export function getCornerCell(range: CellRange, corner: CornerPosition): CellCoord {
  const normalized = normalizeRange(range);
  switch (corner) {
    case 'topLeft':
      return { row: normalized.startRow, col: normalized.startCol };
    case 'topRight':
      return { row: normalized.startRow, col: normalized.endCol };
    case 'bottomRight':
      return { row: normalized.endRow, col: normalized.endCol };
    case 'bottomLeft':
      return { row: normalized.endRow, col: normalized.startCol };
  }
}

// =============================================================================
// F8/Shift+F8 Selection Modes
// =============================================================================

/**
 * TOGGLE_EXTEND_SELECTION_MODE - F8 toggle.
 *
 * Excel Parity 2.6: arrow keys extend selection without Shift; status bar
 * shows "EXT". The selection machine owns the flag (`ctx.modes.extend`)
 * and enforces the extend-vs-additive mutual exclusion.
 *
 */
export const TOGGLE_EXTEND_SELECTION_MODE: ActionHandler = (deps) => {
  const modes = deps.accessors.selection.getModes();
  deps.commands.selection.setMode('extend', !modes.extend);
  return handled();
};

/**
 * TOGGLE_ADD_TO_SELECTION - Shift+F8 toggle.
 *
 * Excel commit-and-continue behavior:
 * - First press (additive off): enter additive mode, opening a fresh
 * `pendingRange` at the active cell.
 * - Second press (additive on): commit the current `pendingRange` into
 * `committedRanges` and open a new single-cell `pendingRange` at the active
 * cell. `modes.additive` stays true. Esc remains the explicit ADD-mode exit.
 *
 * The selection machine owns the flag (`ctx.modes.additive`) and enforces
 * extend-vs-additive mutual exclusion via the SET_MODE handler.
 *
 */
export const TOGGLE_ADD_TO_SELECTION: ActionHandler = (deps) => {
  const modes = deps.accessors.selection.getModes();
  if (modes.additive) {
    // Second press: commit pending range and start a new pending at activeCell.
    deps.commands.selection.commitPending();
  } else {
    // First press: enter additive mode (fresh pendingRange at activeCell).
    deps.commands.selection.setMode('additive', true);
  }
  return handled();
};

// =============================================================================
// Corner Rotation
// =============================================================================

/**
 * ROTATE_SELECTION_CORNER - Ctrl+. corner rotation
 *
 * Excel Parity 2.5:
 * - In a multi-cell selection, cycles active cell through the four corners
 * - Order: topLeft -> topRight -> bottomRight -> bottomLeft -> topLeft
 * - Single cell selection: no-op
 * - Multi-range selection: rotates within the primary (first) range
 *
 * State is managed by UIStore's CornerRotationSlice.
 * Tests must mock UIStore with the CornerRotationSlice interface.
 *
 * @see engine/src/state/ui-store/slices/corner-rotation.ts
 */
export const ROTATE_SELECTION_CORNER: ActionHandler = (deps) => {
  const ranges = deps.accessors.selection.getRanges();

  // Single cell selection: no-op
  if (!hasMultiCellSelection(ranges)) {
    return handled();
  }

  // Get UIStore - required for corner rotation state management
  const uiStore = getUIStore(deps);
  if (!uiStore?.getState().advanceCorner) {
    // UIStore with CornerRotationSlice is required for corner rotation
    // Tests must mock UIStore properly - see selection-mode-features.test.ts
    return handled();
  }

  // Get primary range (first range in selection)
  const primaryRange = ranges[0];

  // Get selection hash to track if selection changed
  const selectionHash = getSelectionHash(ranges);

  // Corner rotation order
  const corners: CornerPosition[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

  // Use UIStore slice to manage corner rotation state
  uiStore.getState().advanceCorner(selectionHash);
  const cornerIndex = uiStore.getState().getCornerIndex(selectionHash);

  const nextCorner = corners[cornerIndex];
  const nextCell = getCornerCell(primaryRange, nextCorner);

  // Update selection with new active cell (keep ranges unchanged)
  deps.commands.selection.setSelection(ranges, nextCell);

  return handled();
};

// =============================================================================
// End Mode
// =============================================================================

/**
 * ACTIVATE_END_MODE - End key handler.
 *
 * Excel End Mode behavior: pressing End sets `ctx.modes.end = true`
 * (status bar shows "End"). The next arrow / Home key navigates to a data
 * boundary (the keyboard coordinator routes ArrowKey under End to
 * MOVE_TO_EDGE_*; Home under End to MOVE_TO_LAST_USED_CELL). End mode
 * auto-deactivates after navigation.
 *
 */
export const ACTIVATE_END_MODE: ActionHandler = (deps) => {
  deps.commands.selection.setMode('end', true);
  return handled();
};
