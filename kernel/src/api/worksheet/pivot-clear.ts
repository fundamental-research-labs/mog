import type { CellRange, ClearApplyTo, SheetId } from '@mog-sdk/contracts/api';
import type { DocumentContext } from '../../context';
import { getPivotRangeForId } from '../../domain/pivots/ranges';
import { normalizeRange } from '../internal/utils';

function rangeContainsRange(container: CellRange, candidate: CellRange): boolean {
  const c = normalizeRange(container);
  const r = normalizeRange(candidate);
  return (
    c.startRow <= r.startRow &&
    c.startCol <= r.startCol &&
    c.endRow >= r.endRow &&
    c.endCol >= r.endCol
  );
}

export async function deletePivotsContainedByClearRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  applyTo: ClearApplyTo = 'all',
): Promise<void> {
  if (applyTo !== 'all' && applyTo !== 'contents') {
    return;
  }

  const pivotBridge = ctx.pivot;
  if (!pivotBridge) {
    return;
  }

  let pivots: Awaited<ReturnType<typeof pivotBridge.getAllPivots>>;
  try {
    pivots = await pivotBridge.getAllPivots(sheetId);
  } catch {
    return;
  }

  const clearRange = normalizeRange(range);
  for (const pivot of pivots) {
    const pivotId = pivot.id ?? pivot.name;
    if (!pivotId) {
      continue;
    }

    let pivotRange: CellRange | null;
    try {
      pivotRange = await getPivotRangeForId({ ctx, sheetId, pivotId });
    } catch {
      continue;
    }
    if (!pivotRange || !rangeContainsRange(clearRange, pivotRange)) {
      continue;
    }

    await pivotBridge.deletePivot(sheetId, pivotId);
  }
}
