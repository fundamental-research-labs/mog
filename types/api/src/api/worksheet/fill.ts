import type { AutoFillMode, AutoFillResult, FillSeriesOptions } from '@mog/types-editor/fill/types';

import type { OperationReceiptBase } from '../operation-receipt';

/**
 * Receipt returned by the mutating worksheet autofill apply path.
 *
 * The legacy AutoFillResult payload fields remain on the receipt root so
 * callers can read patternType, filledCellCount, warnings, and changes without
 * re-querying the worksheet.
 */
export interface AutoFillApplyReceipt extends OperationReceiptBase, AutoFillResult {
  readonly kind: 'autofill.apply';
  readonly status: 'applied' | 'noOp';
  readonly mode: AutoFillMode;
}

/**
 * Receipt returned by worksheet fillSeries().
 *
 * This preserves the same AutoFillResult payload fields as autoFill(), while
 * also recording the explicit series options that selected the fill mode.
 */
export interface FillSeriesApplyReceipt extends OperationReceiptBase, AutoFillResult {
  readonly kind: 'fillSeries.apply';
  readonly status: 'applied' | 'noOp';
  readonly mode: AutoFillMode;
  readonly options: FillSeriesOptions;
}
