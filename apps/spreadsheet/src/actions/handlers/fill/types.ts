/**
 * Fill Handler Types and Helpers
 *
 * Delegates to ws.autoFill (kernel Rust fill engine) instead of
 * building FillContext and applying updates manually via setCells.
 */

import type { AutoFillMode, AutoFillPreviewResult, AutoFillResult } from '@mog-sdk/contracts/fill';
import type {
  AutoFillApplyReceipt,
  AutoFillPreviewReceipt,
  OperationDiagnostic,
  OperationReceiptBase,
  Workbook,
  Worksheet,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';

import type { CellRange, ComputedFillResult, FillError, FillOptions } from '../../../domain/fill';
import { getUIStore, handled, notHandled } from '../handler-utils';

// Re-export shared handler utilities for fill sub-modules
export { getUIStore, handled, notHandled };

// =============================================================================
// Mapping Helpers
// =============================================================================

/**
 * Map app-layer FillOptions to the kernel's AutoFillMode string.
 *
 * The kernel's AutoFillMode is a flat discriminant covering fill behavior,
 * content filtering, and series type in one value. The app-layer FillOptions
 * has separate fields for fillType, seriesType, dateUnit, etc.
 *
 * Priority:
 * 1. fillType-specific modes: 'formats', 'values' → direct map
 * 2. seriesType overrides: 'copy', 'linear', 'growth', 'date' → map with dateUnit
 * 3. Default: 'auto'
 */
function fillOptionsToMode(options: FillOptions): AutoFillMode {
  // Content-type-only modes (fillType takes priority)
  switch (options.fillType) {
    case 'formats':
      return 'formats';
    case 'values':
      return 'values';
    case 'formulas':
      // 'formulas' fillType means values + formulas without formats
      return 'withoutFormats';
  }

  // fillType === 'all' — now check seriesType
  switch (options.seriesType) {
    case 'copy':
      return 'copy';
    case 'linear':
      return options.includeFormats === false ? 'linearTrend' : 'series';
    case 'growth':
      return 'growthTrend';
    case 'date':
      // Map dateUnit to the specific date mode
      switch (options.dateUnit) {
        case 'day':
          return 'days';
        case 'weekday':
          return 'weekdays';
        case 'month':
          return 'months';
        case 'year':
          return 'years';
        default:
          return 'days'; // default date unit
      }
    case 'auto':
    default:
      return 'auto';
  }
}

/**
 * Map the kernel AutoFillResult to the app-layer ComputedFillResult.
 *
 * Since the kernel handles all mutations internally (values, formulas, formats),
 * the update arrays are empty — callers that read updates.errors or updates.pattern
 * still get correct data from the kernel result.
 */
type FillReceipt = OperationReceiptBase & Partial<AutoFillResult>;

function diagnosticToFillError(diagnostic: OperationDiagnostic): FillError {
  return {
    row: diagnostic.target?.row ?? 0,
    col: diagnostic.target?.col ?? 0,
    error: diagnostic.message,
    type: diagnostic.severity === 'error' ? 'error' : 'warning',
  };
}

function warningToFillError(warning: AutoFillResult['warnings'][number]): FillError {
  return {
    row: warning.row,
    col: warning.col,
    error:
      warning.kind.type === 'mergedCellsInTarget'
        ? 'Target range contains merged cells'
        : warning.kind.type === 'formulaRefOutOfBounds'
          ? `Formula reference out of bounds (ref ${warning.kind.refIndex})`
          : 'Source cell is empty',
    type: 'warning',
  };
}

function referenceDiagnosticToFillError(
  diagnostic: AutoFillPreviewResult['referenceDiagnostics'][number],
): FillError | null {
  if (!diagnostic.outOfBounds) return null;
  return {
    row: diagnostic.row,
    col: diagnostic.col,
    error: `Formula reference out of bounds (ref ${diagnostic.refIndex})`,
    type: 'warning',
  };
}

function receiptStatusError(receipt: FillReceipt, label: string): string | null {
  const diagnostic = receipt.diagnostics.find((item) => item.severity === 'error');
  if (diagnostic) return diagnostic.message;

  switch (receipt.status) {
    case 'applied':
    case 'noOp':
    case 'completed':
      return null;
    case 'partial':
      return `${label} only partially applied.`;
    case 'failed':
      return `${label} failed.`;
    case 'unsupported':
      return `${label} is unsupported.`;
    case 'cancelled':
      return `${label} was cancelled.`;
    case 'timedOut':
      return `${label} timed out.`;
    default:
      return `${label} returned unexpected status: ${receipt.status}.`;
  }
}

function fillFailure(
  range: CellRange,
  error: string,
  diagnostics: readonly OperationDiagnostic[] = [],
): ComputedFillResult {
  const diagnosticErrors = diagnostics.map(diagnosticToFillError);
  const errors =
    diagnosticErrors.length === 0 || !diagnosticErrors.some((item) => item.type === 'error')
      ? [
          {
            row: range.startRow,
            col: range.startCol,
            error,
            type: 'error' as const,
          },
          ...diagnosticErrors,
        ]
      : diagnosticErrors;

  return {
    success: false,
    updates: {
      valueUpdates: [],
      formulaUpdates: [],
      formatUpdates: [],
      filledCellIds: [],
      overwrittenCellIds: [],
      pattern: null,
      errors,
    },
  };
}

export function fillReceiptError(receipt: OperationReceiptBase, label: string): string | null {
  return receiptStatusError(receipt, label);
}

function mapToComputedFillResult(
  result: AutoFillApplyReceipt,
  preview?: AutoFillPreviewReceipt | null,
): ComputedFillResult {
  const previewReferenceErrors =
    preview?.referenceDiagnostics
      .map(referenceDiagnosticToFillError)
      .filter((error): error is FillError => error !== null) ?? [];

  return {
    success: true,
    updates: {
      valueUpdates: [],
      formulaUpdates: [],
      formatUpdates: [],
      filledCellIds: [],
      overwrittenCellIds: [],
      pattern: {
        type: result.patternType,
      },
      errors: [
        ...(preview?.diagnostics ?? []).map(diagnosticToFillError),
        ...previewReferenceErrors,
        ...result.warnings.map(warningToFillError),
      ],
    },
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute a fill operation via the kernel's ws.autoFill() API.
 *
 * Delegates pattern detection, series generation, formula adjustment, and
 * format copying to the Rust fill engine in a single atomic mutation.
 * Replaces the old path of buildFillContextFromBridge → computeFillUpdates →
 * setCells/formats.setRanges.
 *
 * @param ws - Worksheet instance
 * @param sourceRange - Source range with pattern data
 * @param targetRange - Target range to fill into
 * @param sheetId - Sheet ID (unused — ws already scoped to sheet, kept for signature compat)
 * @param options - Fill options
 * @param workbook - Workbook (unused — kernel handles everything, kept for signature compat)
 * @returns ComputedFillResult
 */
export async function executeFillViaWorksheet(
  ws: Worksheet,
  sourceRange: CellRange,
  targetRange: CellRange,
  _sheetId: SheetId,
  options: FillOptions,
  _workbook?: Workbook,
): Promise<ComputedFillResult> {
  const sourceA1 = cellRangeToA1(sourceRange);
  const targetA1 = cellRangeToA1(targetRange);
  const mode = fillOptionsToMode(options);

  console.log('[executeFillViaWorksheet] Calling ws.autoFill', {
    sourceA1,
    targetA1,
    mode,
    sourceRange,
    targetRange,
  });

  try {
    let preview: AutoFillPreviewReceipt | null = null;
    if (typeof ws.autoFillPreview === 'function') {
      preview = await ws.autoFillPreview(sourceA1, targetA1, mode);
      const previewError = receiptStatusError(preview, 'AutoFill preview');
      if (previewError) {
        return fillFailure(targetRange, previewError, preview.diagnostics);
      }
    }

    const result = await ws.autoFill(sourceA1, targetA1, mode);
    console.log('[executeFillViaWorksheet] ws.autoFill returned', result);
    const applyError = receiptStatusError(result, 'AutoFill');
    if (applyError) {
      return fillFailure(targetRange, applyError, result.diagnostics);
    }
    return mapToComputedFillResult(result, preview);
  } catch (err) {
    console.error('[executeFillViaWorksheet] ws.autoFill THREW', err);
    return fillFailure(targetRange, err instanceof Error ? err.message : String(err));
  }
}
