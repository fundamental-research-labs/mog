import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import { trackPendingAutofit } from '../../../systems/grid-editing/coordination/pending-autofit';
import {
  getAutofitColumnsForResize,
  getAutofitRowsForResize,
} from '../../../systems/grid-editing/features/autofit/selection-targets';

interface AutofitResizeArgs {
  activeSheetId: SheetId;
  ranges: readonly CellRange[];
  workbook: WorkbookInternal;
}

function snapshotRanges(ranges: readonly CellRange[]): CellRange[] {
  return ranges.map((range) => ({ ...range }));
}

export function trackColumnResizeAutofit(args: AutofitResizeArgs & { col: number }): void {
  const ranges = snapshotRanges(args.ranges);
  trackPendingAutofit(
    Promise.all([
      import('../../../systems/grid-editing/features/autofit'),
      import('@mog/grid-renderer'),
    ]).then(async ([{ autoFitColumns }, { getTextMeasurementService }]) => {
      const textMeasurement = getTextMeasurementService();
      const ws = args.workbook.getSheetById(args.activeSheetId);
      const usedRange = await ws.getUsedRange();
      const columnsToFit = getAutofitColumnsForResize(args.col, ranges, usedRange);
      await autoFitColumns(
        args.activeSheetId,
        columnsToFit,
        textMeasurement,
        (entries) => ws.formatValues(entries),
        args.workbook,
      );
    }),
  );
}

export function trackRowResizeAutofit(args: AutofitResizeArgs & { row: number }): void {
  const ranges = snapshotRanges(args.ranges);
  trackPendingAutofit(
    Promise.all([
      import('../../../systems/grid-editing/features/autofit'),
      import('@mog/grid-renderer'),
    ]).then(async ([{ autoFitRows }, { getTextMeasurementService }]) => {
      const textMeasurement = getTextMeasurementService();
      const ws = args.workbook.getSheetById(args.activeSheetId);
      const usedRange = await ws.getUsedRange();
      const rowsToFit = getAutofitRowsForResize(args.row, ranges, usedRange);
      await autoFitRows(
        args.activeSheetId,
        rowsToFit,
        textMeasurement,
        (entries) => ws.formatValues(entries),
        args.workbook,
      );
    }),
  );
}
