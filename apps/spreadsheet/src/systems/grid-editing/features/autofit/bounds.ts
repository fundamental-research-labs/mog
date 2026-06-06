import type { Worksheet } from '@mog-sdk/contracts/api';
import type { SheetBounds } from '@mog-sdk/contracts/rendering';

export async function getUsedSheetBoundsForAutofit(ws: Worksheet): Promise<SheetBounds | null> {
  const usedRange = await ws.getUsedRange();
  if (!usedRange) return null;

  return {
    minRow: Math.min(usedRange.startRow, usedRange.endRow),
    maxRow: Math.max(usedRange.startRow, usedRange.endRow),
    minCol: Math.min(usedRange.startCol, usedRange.endCol),
    maxCol: Math.max(usedRange.startCol, usedRange.endCol),
  };
}
