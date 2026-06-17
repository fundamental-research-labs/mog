import type {
  AutoFillMode,
  AutoFillPreviewResult,
  AutoFillResult,
  FillSeriesOptions,
} from '@mog/types-editor/fill/types';

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
 * Receipt returned by the non-mutating worksheet autofill preview path.
 *
 * The payload is produced by the same Rust fill/reference-adjustment engine as
 * autoFill(), but no worksheet cells or undo stack entries are written.
 */
export interface AutoFillPreviewReceipt extends OperationReceiptBase, AutoFillPreviewResult {
  readonly kind: 'autofill.preview';
  readonly status: 'completed';
  readonly mode: AutoFillMode;
  readonly worksheetChanged: false;
  readonly undoChanged: false;
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

/** Fill and autofill operations exposed on Worksheet. */
export interface WorksheetFill {
  /**
   * Autofill from source range into target range.
   *
   * @param sourceRange - Source range in A1 notation (e.g., "A1:A3")
   * @param targetRange - Target range to fill into (e.g., "A4:A10")
   * @param fillMode - Fill behavior. Default: 'auto' (detect pattern).
   */
  autoFill(
    sourceRange: string,
    targetRange: string,
    fillMode?: AutoFillMode,
  ): Promise<AutoFillApplyReceipt>;

  /**
   * Preview autofill without mutating cells.
   *
   * Uses the same Rust fill/reference-adjustment engine as autoFill(), returning
   * the target formula text and reference diagnostics that apply would produce.
   *
   * @param sourceRange - Source range in A1 notation (e.g., "A1:A3")
   * @param targetRange - Target range to preview (e.g., "A4:A10")
   * @param fillMode - Fill behavior. Default: 'auto' (detect pattern).
   */
  autoFillPreview(
    sourceRange: string,
    targetRange: string,
    fillMode?: AutoFillMode,
  ): Promise<AutoFillPreviewReceipt>;

  /**
   * Fill a range with a series (Edit > Fill > Series dialog equivalent).
   *
   * The range contains both source cells and target cells; the kernel splits
   * them based on direction.
   */
  fillSeries(range: string, options: FillSeriesOptions): Promise<FillSeriesApplyReceipt>;
}
