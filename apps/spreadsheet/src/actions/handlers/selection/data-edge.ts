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

// =============================================================================
// Data-Edge Navigation Handlers (Ctrl+Arrow)
// =============================================================================

const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

interface DataEdgeReturnHint {
  sheetId: string;
  from: CellCoord;
  to: CellCoord;
  direction: Direction;
}

let lastDataEdgeMove: DataEdgeReturnHint | null = null;

function sameCell(a: CellCoord, b: CellCoord): boolean {
  return a.row === b.row && a.col === b.col;
}

function isHorizontalDirection(direction: Direction): boolean {
  return direction === 'left' || direction === 'right';
}

async function isVisibleCell(
  deps: ActionDependencies,
  sheetId: string,
  cell: CellCoord,
): Promise<boolean> {
  try {
    const ws = deps.workbook.getSheetById(sheetId as never);
    const [hiddenRows, hiddenCols] = await Promise.all([
      ws.layout.getHiddenRowsBitmap(),
      ws.layout.getHiddenColumnsBitmap(),
    ]);
    return !hiddenRows.has(cell.row) && !hiddenCols.has(cell.col);
  } catch {
    return false;
  }
}

function matchingReturnHint(
  sheetId: string,
  activeCell: CellCoord,
  direction: Direction,
): DataEdgeReturnHint | null {
  if (!isHorizontalDirection(direction)) {
    return null;
  }

  if (
    lastDataEdgeMove &&
    isHorizontalDirection(lastDataEdgeMove.direction) &&
    lastDataEdgeMove.sheetId === sheetId &&
    lastDataEdgeMove.direction === OPPOSITE_DIRECTION[direction] &&
    sameCell(lastDataEdgeMove.to, activeCell)
  ) {
    return lastDataEdgeMove;
  }
  return null;
}

export function __resetDataEdgeReturnHintForTests(): void {
  lastDataEdgeMove = null;
}

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
  const activeSheetId = String(deps.getActiveSheetId());

  const returnHint = matchingReturnHint(activeSheetId, activeCell, direction);
  if (returnHint && (await isVisibleCell(deps, activeSheetId, returnHint.from))) {
    lastDataEdgeMove = null;
    deps.commands.selection.goTo(returnHint.from);
    return handled();
  }

  const targetCell = await ws.findDataEdge(activeCell.row, activeCell.col, direction);
  lastDataEdgeMove = !isHorizontalDirection(direction) || sameCell(activeCell, targetCell)
    ? null
    : {
        sheetId: activeSheetId,
        from: activeCell,
        to: targetCell,
        direction,
      };

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

  deps.commands.selection.setSelection([newRange], anchorCell, anchorCell);
  return handled();
}

export const EXTEND_TO_EDGE_UP: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'up');
export const EXTEND_TO_EDGE_DOWN: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'down');
export const EXTEND_TO_EDGE_LEFT: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'left');
export const EXTEND_TO_EDGE_RIGHT: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'right');
