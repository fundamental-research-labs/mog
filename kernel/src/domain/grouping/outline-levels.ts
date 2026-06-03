/**
 * Outline Levels Module
 *
 * Query functions for outline level management in row/column grouping.
 * These are read-only operations that compute outline visibility and levels.
 * All group data is fetched from ComputeBridge (Rust compute core).
 *
 * Part of the Grouping Domain Module refactor.
 *
 * Architecture Notes:
 * - All functions are async queries delegating to ComputeBridge
 * - Groups returned from Rust already have resolved start/end positions
 * - Maximum 8 nested levels (Excel compatibility)
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { GroupDefinition, OutlineLevel } from '@mog-sdk/contracts/grouping';
import { DEFAULT_SHEET_GROUPING_CONFIG } from '@mog-sdk/contracts/grouping';

import type { DocumentContext } from '../../context/types';

import { resolveGroupRange } from './helpers';
import { getGroups } from './queries';
import { getAdjacentSummaryIndex } from './shared';

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get the maximum outline level in a sheet.
 * Used to render level buttons (1, 2, 3...).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param axis - Row or column axis
 * @returns Promise of maximum level (0 if no groups, 1-8 otherwise)
 */
export async function getMaxOutlineLevel(
  ctx: DocumentContext,
  sheetId: SheetId,
  axis: 'row' | 'column',
): Promise<number> {
  const groups = await getGroups(ctx, sheetId, axis);
  if (groups.length === 0) return 0;
  return Math.max(...groups.map((g) => g.level));
}

/**
 * Get outline levels for a range of rows.
 * Used by the renderer to determine visibility and display.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param startRow - Start row index
 * @param endRow - End row index
 * @returns Promise of computed outline levels
 */
export async function getRowOutlineLevels(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  endRow: number,
): Promise<OutlineLevel[]> {
  const groups = await getGroups(ctx, sheetId, 'row');
  const summaryRowsBelow = DEFAULT_SHEET_GROUPING_CONFIG.summaryRowsBelow;

  // Pre-resolve all group ranges
  const resolvedGroups = groups
    .map((g) => ({
      group: g,
      range: resolveGroupRange(g),
    }))
    .filter((g) => g.range !== null) as Array<{
    group: GroupDefinition;
    range: { start: number; end: number };
  }>;

  const result: OutlineLevel[] = [];

  for (let row = startRow; row <= endRow; row++) {
    // Find all groups containing this row as a detail row.
    const detailGroups = resolvedGroups.filter(
      ({ range }) => row >= range.start && row <= range.end,
    );
    const summaryGroups = resolvedGroups.filter(({ range }) => {
      return getAdjacentSummaryIndex(range.start, range.end, summaryRowsBelow) === row;
    });

    // Calculate level (max level of detail or adjacent summary groups)
    const level =
      detailGroups.length + summaryGroups.length > 0
        ? Math.max(
            ...detailGroups.map(({ group }) => group.level),
            ...summaryGroups.map(({ group }) => group.level),
          )
        : 0;

    // Check if row is visible (not hidden by any collapsed group)
    const visible = !detailGroups.some(({ group }) => group.collapsed);

    // Check if this is a summary row
    const isSummary = summaryGroups.length > 0;

    // Get group IDs (innermost to outermost)
    const groupIds = [...detailGroups, ...summaryGroups]
      .sort((a, b) => b.group.level - a.group.level)
      .map(({ group }) => group.id);

    result.push({
      index: row,
      level,
      visible,
      isSummary,
      groupIds,
    });
  }

  return result;
}

/**
 * Get outline levels for a range of columns.
 * Used by the renderer to determine visibility and display.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param startCol - Start column index
 * @param endCol - End column index
 * @returns Promise of computed outline levels
 */
export async function getColumnOutlineLevels(
  ctx: DocumentContext,
  sheetId: SheetId,
  startCol: number,
  endCol: number,
): Promise<OutlineLevel[]> {
  const groups = await getGroups(ctx, sheetId, 'column');
  const summaryColumnsRight = DEFAULT_SHEET_GROUPING_CONFIG.summaryColumnsRight;

  // Pre-resolve all group ranges
  const resolvedGroups = groups
    .map((g) => ({
      group: g,
      range: resolveGroupRange(g),
    }))
    .filter((g) => g.range !== null) as Array<{
    group: GroupDefinition;
    range: { start: number; end: number };
  }>;

  const result: OutlineLevel[] = [];

  for (let col = startCol; col <= endCol; col++) {
    // Find all groups containing this column as a detail column.
    const detailGroups = resolvedGroups.filter(
      ({ range }) => col >= range.start && col <= range.end,
    );
    const summaryGroups = resolvedGroups.filter(({ range }) => {
      return getAdjacentSummaryIndex(range.start, range.end, summaryColumnsRight) === col;
    });

    // Calculate level (max level of detail or adjacent summary groups)
    const level =
      detailGroups.length + summaryGroups.length > 0
        ? Math.max(
            ...detailGroups.map(({ group }) => group.level),
            ...summaryGroups.map(({ group }) => group.level),
          )
        : 0;

    // Check if column is visible (not hidden by any collapsed group)
    const visible = !detailGroups.some(({ group }) => group.collapsed);

    // Check if this is a summary column
    const isSummary = summaryGroups.length > 0;

    // Get group IDs (innermost to outermost)
    const groupIds = [...detailGroups, ...summaryGroups]
      .sort((a, b) => b.group.level - a.group.level)
      .map(({ group }) => group.id);

    result.push({
      index: col,
      level,
      visible,
      isSummary,
      groupIds,
    });
  }

  return result;
}

/**
 * Check if a row is visible (not hidden by collapsed groups).
 * Note: This only checks group visibility, not manual hide/unhide.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param row - Row index
 * @returns Promise of true if the row is visible by group state
 */
export async function isRowVisibleByGroups(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
): Promise<boolean> {
  const levels = await getRowOutlineLevels(ctx, sheetId, row, row);
  return levels[0]?.visible ?? true;
}

/**
 * Check if a column is visible (not hidden by collapsed groups).
 * Note: This only checks group visibility, not manual hide/unhide.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param col - Column index
 * @returns Promise of true if the column is visible by group state
 */
export async function isColumnVisibleByGroups(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
): Promise<boolean> {
  const levels = await getColumnOutlineLevels(ctx, sheetId, col, col);
  return levels[0]?.visible ?? true;
}
