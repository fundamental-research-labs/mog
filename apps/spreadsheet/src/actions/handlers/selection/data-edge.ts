/**
 * Selection Handlers - Data-Edge Navigation
 *
 * Handlers for Ctrl+Arrow (move to data edge) and Ctrl+Shift+Arrow (extend to data edge).
 * These implement Excel-style data-aware navigation that jumps between empty/non-empty regions.
 * Includes hidden row/column awareness - stops at hidden region boundaries.
 *
 */

import { getMovingEdge, rangeFromAnchorAndCell } from '../../../systems/shared/types';

import type {
  ActionDependencies,
  ActionResult,
  AsyncActionHandler,
  CellCoord,
  CellRange,
  Direction,
} from './helpers';
import { handled } from './helpers';

/**
 * Move to data edge in a direction.
 * Uses Rust bridge findDataEdge to find target cell, then dispatches GO_TO.
 * Includes hidden row/column awareness - stops at hidden region boundaries.
 */
async function moveToDataEdge(
  deps: ActionDependencies,
  direction: Direction,
): Promise<ActionResult> {
  const activeCell = deps.accessors.selection.getActiveCell();
  const ws = deps.workbook.activeSheet;
  const targetCell = await ws.findDataEdge(activeCell.row, activeCell.col, direction);
  deps.commands.selection.goTo(targetCell);
  return handled();
}

export const MOVE_TO_EDGE_UP: AsyncActionHandler = (deps) => moveToDataEdge(deps, 'up');
export const MOVE_TO_EDGE_DOWN: AsyncActionHandler = (deps) => moveToDataEdge(deps, 'down');
export const MOVE_TO_EDGE_LEFT: AsyncActionHandler = (deps) => moveToDataEdge(deps, 'left');
export const MOVE_TO_EDGE_RIGHT: AsyncActionHandler = (deps) => moveToDataEdge(deps, 'right');

// =============================================================================
// Data-Edge Extension Handlers (Ctrl+Shift+Arrow)
// =============================================================================

/**
 * Extend selection to data edge.
 * Uses Rust bridge findDataEdge, then creates range from anchor to target.
 * Includes hidden row/column awareness - stops at hidden region boundaries.
 *
 * getMovingEdge() finds the current moving corner (opposite the anchor) so the
 * extend continues from where the previous one ended; this preserves
 * rectangular selections across perpendicular extends.
 */
async function extendToDataEdge(
  deps: ActionDependencies,
  direction: Direction,
): Promise<ActionResult> {
  const activeCell = deps.accessors.selection.getActiveCell();
  const ranges = deps.accessors.selection.getRanges();
  const anchor = deps.accessors.selection.getAnchor();
  const ws = deps.workbook.activeSheet;

  const anchorCell: CellCoord = anchor ?? activeCell;

  const currentRange = ranges[ranges.length - 1] as CellRange | undefined;
  const extendFrom: CellCoord = currentRange ? getMovingEdge(currentRange, anchorCell) : activeCell;

  const targetCell = await ws.findDataEdge(extendFrom.row, extendFrom.col, direction);

  const newRange = rangeFromAnchorAndCell(anchorCell, targetCell);

  // Physical Shift-extension keeps the anchor as the active cell. The moving
  // edge still drives range growth and viewport-follow through the range shape.
  deps.commands.selection.setSelection([newRange], anchorCell, anchorCell);
  return handled();
}

export const EXTEND_TO_EDGE_UP: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'up');
export const EXTEND_TO_EDGE_DOWN: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'down');
export const EXTEND_TO_EDGE_LEFT: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'left');
export const EXTEND_TO_EDGE_RIGHT: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'right');
