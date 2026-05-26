/**
 * Column Groups Module
 *
 * Column grouping (outline) operations: create, ungroup, clear.
 * All operations delegate to ComputeBridge (Rust compute core).
 *
 * Stream O: Grouping/Outline Implementation
 *
 * Architecture Notes:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 * - No manual event emission from domain modules
 * - Maximum 8 nested levels (Excel compatibility)
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Column Group CRUD Operations
// =============================================================================

/**
 * Group a range of columns.
 *
 * Delegates to ComputeBridge. Rust handles:
 * - Level calculation based on existing groups
 * - Parent group resolution
 * - ColId-based identity references for CRDT-safe storage
 * - Group creation and storage
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startCol - Start column index (inclusive)
 * @param endCol - End column index (inclusive)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function groupColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  startCol: number,
  endCol: number,
  _origin: StructureChangeSource = 'user',
): void {
  if (startCol > endCol) {
    [startCol, endCol] = [endCol, startCol];
  }

  void ctx.computeBridge.groupColumns(sheetId, startCol, endCol);
}

/**
 * Ungroup columns (removes one level of grouping from the range).
 * Removes the innermost group that fully contains the range.
 *
 * Delegates to ComputeBridge. Rust handles:
 * - Finding the innermost containing group
 * - Unhiding columns if group was collapsed
 * - Group deletion
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startCol - Start column index (inclusive)
 * @param endCol - End column index (inclusive)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function ungroupColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  startCol: number,
  endCol: number,
  _origin: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.ungroupColumns(sheetId, startCol, endCol);
}

/**
 * Clear all column grouping in a range (removes all levels).
 *
 * Delegates to ComputeBridge via repeated ungroupColumns calls.
 * Rust handles unhiding columns from collapsed groups and group deletion.
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startCol - Start column index (inclusive)
 * @param endCol - End column index (inclusive)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function clearColumnGrouping(
  ctx: DocumentContext,
  sheetId: SheetId,
  startCol: number,
  endCol: number,
  _origin: StructureChangeSource = 'user',
): void {
  if (startCol > endCol) {
    [startCol, endCol] = [endCol, startCol];
  }

  // Delegate to CB: fetch groups, ungroup each overlapping one.
  // Rust handles unhiding columns and group deletion.
  void (async () => {
    const groups = await ctx.computeBridge.getGroups(sheetId, 'column');
    // Find all groups that overlap with this range, deepest first
    const overlapping = groups
      .filter((g: any) => !(g.end < startCol || g.start > endCol))
      .sort((a: any, b: any) => b.level - a.level);

    await Promise.all(
      overlapping.map(() => ctx.computeBridge.ungroupColumns(sheetId, startCol, endCol)),
    );
  })();
}

// =============================================================================
// Query Methods
// =============================================================================

/**
 * Get columns that would be affected by collapsing/expanding a group.
 * For column groups, returns columns that are hidden/shown (excludes summary column).
 *
 * Fetches group data from ComputeBridge and computes affected columns locally.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param groupId - Group ID
 * @param summaryColumnsRight - Whether summary column is on the right (default: true)
 * @returns Promise of column indices that would be affected
 */
export async function getAffectedColumnsByGroup(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
  summaryColumnsRight: boolean = true,
): Promise<number[]> {
  const groups = await ctx.computeBridge.getGroups(sheetId, 'column');
  const group = groups.find((g: any) => g.id === groupId);
  if (!group || group.axis !== 'column') return [];

  const cols: number[] = [];
  for (let col = group.start; col <= group.end; col++) {
    const isSummaryCol = summaryColumnsRight ? col === group.end : col === group.start;
    if (!isSummaryCol) {
      cols.push(col);
    }
  }

  return cols;
}
