/**
 * Row Groups Module
 *
 * Row grouping (outline) CRUD operations for creating, removing, and querying row groups.
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
// Row Group CRUD Operations
// =============================================================================

/**
 * Group a range of rows.
 *
 * Delegates to ComputeBridge. Rust handles:
 * - Level calculation based on existing groups
 * - Parent group resolution
 * - RowId-based identity references for CRDT-safe storage
 * - Group creation and storage
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row index (inclusive)
 * @param endRow - End row index (inclusive)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function groupRows(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  endRow: number,
  _origin: StructureChangeSource = 'user',
): void {
  if (startRow > endRow) {
    [startRow, endRow] = [endRow, startRow];
  }

  void ctx.computeBridge.groupRows(sheetId, startRow, endRow);
}

/**
 * Ungroup rows (removes one level of grouping from the range).
 * Removes the innermost group that fully contains the range.
 *
 * Delegates to ComputeBridge. Rust handles:
 * - Finding the innermost containing group
 * - Unhiding rows if group was collapsed
 * - Group deletion
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row index (inclusive)
 * @param endRow - End row index (inclusive)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function ungroupRows(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  endRow: number,
  _origin: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.ungroupRows(sheetId, startRow, endRow);
}

/**
 * Clear all row grouping in a range (removes all levels).
 *
 * Delegates to ComputeBridge via repeated ungroupRows calls.
 * Rust handles unhiding rows from collapsed groups and group deletion.
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row index (inclusive)
 * @param endRow - End row index (inclusive)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function clearRowGrouping(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  endRow: number,
  _origin: StructureChangeSource = 'user',
): void {
  if (startRow > endRow) {
    [startRow, endRow] = [endRow, startRow];
  }

  // Delegate to CB: fetch groups, ungroup each overlapping one.
  // Rust handles unhiding rows and group deletion.
  void (async () => {
    const groups = await ctx.computeBridge.getGroups(sheetId, 'row');
    // Find all groups that overlap with this range, deepest first
    const overlapping = groups
      .filter((g: any) => !(g.end < startRow || g.start > endRow))
      .sort((a: any, b: any) => b.level - a.level);

    await Promise.all(
      overlapping.map(() => ctx.computeBridge.ungroupRows(sheetId, startRow, endRow)),
    );
  })();
}

// =============================================================================
// Row Group Query Operations
// =============================================================================

/**
 * Get rows that would be affected by collapsing/expanding a group.
 * For row groups, returns every detail row in start..=end; the summary row is adjacent.
 *
 * Fetches group data from ComputeBridge and computes affected rows locally.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param groupId - Group ID to query
 * @param summaryRowsBelow - Whether summary row is below (default: true)
 * @returns Promise of row indices that would be hidden/shown
 */
export async function getAffectedRowsByGroup(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
  _summaryRowsBelow: boolean = true,
): Promise<number[]> {
  const groups = await ctx.computeBridge.getGroups(sheetId, 'row');
  const group = groups.find((g: any) => g.id === groupId);
  if (!group || group.axis !== 'row') return [];

  const rows: number[] = [];
  for (let row = group.start; row <= group.end; row++) {
    rows.push(row);
  }

  return rows;
}
