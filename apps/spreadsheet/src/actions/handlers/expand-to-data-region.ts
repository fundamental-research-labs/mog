/**
 * Excel "current region" auto-expansion for single-cell / single-row selections.
 *
 * Excel auto-expands the selection to the contiguous data block (the "current
 * region") before executing operations like Sort, Insert Table, Create Chart,
 * and AutoFilter. This module provides the shared utility every such handler
 * should call before consuming a selection range.
 *
 * Behavior (matches Excel):
 * - Single cell → expand via `ws.getCurrentRegion`
 * - Single row → expand via `ws.getCurrentRegion` (treated as header row),
 *   preserving any explicit rows/columns the user already selected
 * - Multi-row range → return as-is (user explicitly chose the range)
 * - Empty cell (no adjacent data) → return `null`
 *
 * Underlying kernel implementation: `getCurrentRegionDomain` in
 * `kernel/src/domain/cells/cell-iteration.ts` (exposed via WorksheetImpl).
 *
 */

import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

export async function expandToDataRegion(
  ws: Worksheet,
  range: CellRange,
): Promise<CellRange | null> {
  // Single-cell selections are also single-row; the multi-row case is the
  // only one that bypasses expansion.
  const isSingleRow = range.startRow === range.endRow;
  if (!isSingleRow) {
    return range;
  }

  const expanded = await ws.getCurrentRegion(range.startRow, range.startCol);
  // getCurrentRegion returns the same single cell when there's no adjacent
  // data — treat that as "no data region" and let the caller decide.
  if (expanded.startRow === expanded.endRow && expanded.startCol === expanded.endCol) {
    return null;
  }
  return {
    startRow: Math.min(expanded.startRow, range.startRow),
    startCol: Math.min(expanded.startCol, range.startCol),
    endRow: Math.max(expanded.endRow, range.endRow),
    endCol: Math.max(expanded.endCol, range.endCol),
  };
}
