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

type ColumnGroup = {
  start?: number;
  end?: number;
  level?: number;
  collapsed?: boolean;
  hidden?: boolean;
};

type OutlineAwareWorksheet = {
  getCell?: (row: number, col: number) => Promise<{ value?: unknown; formula?: unknown }>;
  outline?: {
    getState?: () => Promise<{ columnGroups?: ColumnGroup[] }>;
    getSettings?: () => Promise<{ summaryColumnsRight?: boolean }>;
  };
};

// =============================================================================
// Data-Edge Navigation Handlers (Ctrl+Arrow)
// =============================================================================

function isNonEmptyCell(cell: { value?: unknown; formula?: unknown } | null | undefined): boolean {
  return (
    (cell?.value !== null && cell?.value !== undefined && cell.value !== '') ||
    (typeof cell?.formula === 'string' && cell.formula.length > 0)
  );
}

function toValidColumnGroup(
  group: ColumnGroup,
): (Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup) | null {
  const { start, end } = group;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start === undefined || end === undefined || start < 0 || end < start) return null;
  return group as Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup;
}

function findPreviousPeerGroup(
  groups: Array<Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup>,
  group: Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup,
): (Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup) | null {
  const sameLevel = (candidate: ColumnGroup) => (candidate.level ?? 1) === (group.level ?? 1);
  let previous: (Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup) | null = null;
  for (const candidate of groups) {
    if (candidate.end >= group.start || !sameLevel(candidate)) continue;
    if (!previous || candidate.end > previous.end) previous = candidate;
  }
  return previous;
}

async function hasRowDataAt(ws: OutlineAwareWorksheet, row: number, col: number): Promise<boolean> {
  if (typeof ws.getCell !== 'function') return false;
  try {
    return isNonEmptyCell(await ws.getCell(row, col));
  } catch {
    return false;
  }
}

async function getCollapsedColumnSummaryTarget(
  deps: ActionDependencies,
  activeCell: CellCoord,
  targetCell: CellCoord,
  direction: Direction,
): Promise<CellCoord | null> {
  if (direction !== 'left' && direction !== 'right') return null;

  const ws = deps.workbook.activeSheet as OutlineAwareWorksheet;
  if (typeof ws.outline?.getState !== 'function') return null;

  let summaryColumnsRight = true;
  try {
    summaryColumnsRight = (await ws.outline.getSettings?.())?.summaryColumnsRight ?? true;
  } catch {
    summaryColumnsRight = true;
  }
  if (!summaryColumnsRight) return null;

  let groups: Array<Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup> = [];
  try {
    groups = ((await ws.outline.getState())?.columnGroups ?? [])
      .map(toValidColumnGroup)
      .filter(
        (group): group is Required<Pick<ColumnGroup, 'start' | 'end'>> & ColumnGroup =>
          group !== null,
      )
      .sort((a, b) => a.start - b.start || a.end - b.end);
  } catch {
    return null;
  }

  const collapsedGroups = groups.filter(
    (group) => group.collapsed === true || group.hidden === true,
  );

  if (direction === 'right') {
    for (const group of collapsedGroups) {
      const summaryCol = group.end + 1;
      if (summaryCol <= activeCell.col || summaryCol <= targetCell.col) continue;

      const previousGroup = findPreviousPeerGroup(groups, group);
      if (!previousGroup) continue;
      if (activeCell.col < previousGroup.start || activeCell.col > previousGroup.end) continue;
      if (!(await hasRowDataAt(ws, activeCell.row, summaryCol))) continue;

      return { row: activeCell.row, col: summaryCol };
    }
  } else {
    for (const group of collapsedGroups) {
      const summaryCol = group.end + 1;
      if (activeCell.col !== summaryCol || targetCell.col < summaryCol) continue;

      const previousGroup = findPreviousPeerGroup(groups, group);
      if (!previousGroup) continue;
      if (!(await hasRowDataAt(ws, activeCell.row, summaryCol))) continue;

      return { row: activeCell.row, col: previousGroup.start };
    }
  }

  return null;
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

  const rawTargetCell = await ws.findDataEdge(activeCell.row, activeCell.col, direction);
  const targetCell =
    (await getCollapsedColumnSummaryTarget(deps, activeCell, rawTargetCell, direction)) ??
    rawTargetCell;

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

  const rawTargetCell = await ws.findDataEdge(extendFrom.row, extendFrom.col, direction);
  const targetCell =
    (await getCollapsedColumnSummaryTarget(deps, extendFrom, rawTargetCell, direction)) ??
    rawTargetCell;

  const newRange = rangeFromAnchorAndCell(anchorCell, targetCell);

  // activeCell stays at the anchor (Excel parity) — matches EXTEND_TO_ROW_END
  // and EXTEND_TO_LAST_USED_CELL in home-end.ts.
  deps.commands.selection.setSelection([newRange], anchorCell, anchorCell);
  return handled();
}

export const EXTEND_TO_EDGE_UP: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'up');
export const EXTEND_TO_EDGE_DOWN: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'down');
export const EXTEND_TO_EDGE_LEFT: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'left');
export const EXTEND_TO_EDGE_RIGHT: AsyncActionHandler = (deps) => extendToDataEdge(deps, 'right');
