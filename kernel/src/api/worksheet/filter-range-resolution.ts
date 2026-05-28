import type { SheetId } from '@mog-sdk/contracts/core';

import type { FilterState } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';

export interface ResolvedFilterRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Resolve a FilterState's live bounds. Table-backed filters use the table
 * registry because their stored cell identities can move during row reorders.
 */
export async function resolveFilterRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  filter: FilterState,
): Promise<ResolvedFilterRange> {
  if (filter.tableId) {
    const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
    const table = tables.find((candidate) => candidate.id === filter.tableId);
    if (table) {
      return {
        startRow: table.range.startRow,
        startCol: table.range.startCol,
        endRow: table.range.endRow,
        endCol: table.range.endCol,
      };
    }
  }

  const [startPos, endPos, dataEndPos] = await Promise.all([
    ctx.computeBridge.getCellPosition(sheetId, filter.headerStartCellId),
    ctx.computeBridge.getCellPosition(sheetId, filter.headerEndCellId),
    ctx.computeBridge.getCellPosition(sheetId, filter.dataEndCellId),
  ]);
  return {
    startRow: startPos?.row ?? 0,
    startCol: startPos?.col ?? 0,
    endRow: dataEndPos?.row ?? endPos?.row ?? 0,
    endCol: endPos?.col ?? 0,
  };
}
