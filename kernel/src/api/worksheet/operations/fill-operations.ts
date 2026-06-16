/**
 * Fill Operations Module
 *
 * Extracted from WorksheetImpl for better modularity.
 * Delegates autofill to the Rust compute core via the bridge.
 */

import type {
  AutoFillChange,
  AutoFillMode,
  AutoFillResult,
  AutoFillWarning,
  FillPatternType,
  FillSeriesOptions,
} from '@mog-sdk/contracts/fill';
import type {
  AutoFillApplyReceipt,
  FillSeriesApplyReceipt,
  OperationDiagnostic,
  OperationEffect,
} from '@mog-sdk/contracts/api';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import { KernelError } from '../../../errors';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../../context';

// ==========================================================================
// Fill Operations
// ==========================================================================
//
// All fill behaviour — pattern detection, series generation, formula ref
// adjustment, cross-sheet prefix preservation — happens in Rust
// (`compute-fill` crate + `mutation_handlers/fill.rs`). The kernel only
// translates the user-facing request shape to the bridge wire shape.

/**
 * Compute fill direction from source and target range geometry.
 *
 * Uses extension-based detection: checks where the target extends beyond the
 * source, not just whether they're strictly non-overlapping. This correctly
 * handles the common case where the target overlaps the source (e.g.
 * autoFill("A10:C10", "A1:C10") should fill upward).
 *
 * Matches the Rust `compute_fill_direction` in compute-fill/helpers.rs.
 */
function computeDirection(source: CellRange, target: CellRange): string {
  if (target.endRow > source.endRow) return 'down';
  if (target.startRow < source.startRow) return 'up';
  if (target.endCol > source.endCol) return 'right';
  if (target.startCol < source.startCol) return 'left';
  return 'down'; // default: target contained within source
}

/**
 * Map AutoFillMode to include flags for the bridge request.
 */
function modeToFlags(mode: AutoFillMode): {
  includeFormulas: boolean;
  includeValues: boolean;
  includeFormats: boolean;
} {
  switch (mode) {
    case 'formats':
      return { includeFormulas: false, includeValues: false, includeFormats: true };
    case 'values':
      return { includeFormulas: true, includeValues: true, includeFormats: false };
    case 'withoutFormats':
      return { includeFormulas: true, includeValues: true, includeFormats: false };
    default:
      return { includeFormulas: true, includeValues: true, includeFormats: true };
  }
}

async function runAsSingleUndoStep<T>(
  ctx: DocumentContext,
  operation: () => Promise<T>,
): Promise<T> {
  await ctx.computeBridge.beginUndoGroup();
  try {
    return await operation();
  } finally {
    await ctx.computeBridge.endUndoGroup();
  }
}

function extractFillResult(bridgeResult: { data?: unknown } | null | undefined): AutoFillResult {
  const fillData = bridgeResult?.data as
    | {
        patternType?: string;
        filledCellCount?: number;
        warnings?: AutoFillWarning[];
        changes?: AutoFillChange[];
      }
    | undefined;

  return {
    patternType: (fillData?.patternType ?? 'copy') as FillPatternType,
    filledCellCount: fillData?.filledCellCount ?? 0,
    warnings: fillData?.warnings ?? [],
    changes: fillData?.changes ?? [],
  };
}

function filledChangeCount(result: AutoFillResult): number {
  return result.filledCellCount > 0 ? result.filledCellCount : result.changes.length;
}

function effectsForFillApply(params: {
  sheetId: SheetId;
  targetRange: CellRange;
  changedCellCount: number;
  undoGroup: boolean;
}): OperationEffect[] {
  const range = cellRangeToA1(params.targetRange);
  if (params.changedCellCount === 0) {
    return [{ type: 'worksheetUnchanged', sheetId: params.sheetId, range }];
  }

  const effects: OperationEffect[] = [
    {
      type: 'materializedCells',
      sheetId: params.sheetId,
      range,
      count: params.changedCellCount,
    },
    {
      type: 'changedRange',
      sheetId: params.sheetId,
      range,
      count: params.changedCellCount,
    },
  ];

  if (params.undoGroup) {
    effects.push({ type: 'createdUndoEntry', sheetId: params.sheetId, range });
  }

  return effects;
}

function diagnosticForAutoFillWarning(
  warning: AutoFillWarning,
  sheetId: SheetId,
): OperationDiagnostic {
  const target = { sheetId, row: warning.row, col: warning.col };

  switch (warning.kind.type) {
    case 'mergedCellsInTarget':
      return {
        severity: 'warning',
        code: 'AUTOFILL_MERGED_CELLS_IN_TARGET',
        message: 'Target range contains merged cells.',
        target,
        recoverable: true,
        nextAction: 'Unmerge the target cells or choose a target range without merged cells.',
      };
    case 'formulaRefOutOfBounds':
      return {
        severity: 'warning',
        code: 'AUTOFILL_REF_OUT_OF_BOUNDS',
        message: 'A formula reference moved outside the worksheet bounds during autofill.',
        target,
        recoverable: true,
        nextAction: 'Review the filled formula references before relying on the result.',
        details: { refIndex: warning.kind.refIndex },
      };
    case 'sourceCellEmpty':
      return {
        severity: 'warning',
        code: 'AUTOFILL_SOURCE_CELL_EMPTY',
        message: 'The source cell used for autofill is empty.',
        target,
        recoverable: true,
        nextAction: 'Enter a source value or adjust the source range.',
      };
  }
}

function diagnosticsForAutoFillWarnings(
  warnings: readonly AutoFillWarning[],
  sheetId: SheetId,
): OperationDiagnostic[] {
  return warnings.map((warning) => diagnosticForAutoFillWarning(warning, sheetId));
}

function autoFillApplyReceipt(params: {
  sheetId: SheetId;
  targetRange: CellRange;
  mode: AutoFillMode;
  result: AutoFillResult;
  undoGroup: boolean;
}): AutoFillApplyReceipt {
  const changedCellCount = filledChangeCount(params.result);
  return {
    kind: 'autofill.apply',
    status: changedCellCount > 0 ? 'applied' : 'noOp',
    effects: effectsForFillApply({
      sheetId: params.sheetId,
      targetRange: params.targetRange,
      changedCellCount,
      undoGroup: params.undoGroup,
    }),
    diagnostics: diagnosticsForAutoFillWarnings(params.result.warnings, params.sheetId),
    mode: params.mode,
    patternType: params.result.patternType,
    filledCellCount: params.result.filledCellCount,
    warnings: params.result.warnings,
    changes: params.result.changes,
  };
}

function fillSeriesApplyReceipt(params: {
  sheetId: SheetId;
  targetRange: CellRange;
  mode: AutoFillMode;
  options: FillSeriesOptions;
  result: AutoFillResult;
}): FillSeriesApplyReceipt {
  const changedCellCount = filledChangeCount(params.result);
  return {
    kind: 'fillSeries.apply',
    status: changedCellCount > 0 ? 'applied' : 'noOp',
    effects: effectsForFillApply({
      sheetId: params.sheetId,
      targetRange: params.targetRange,
      changedCellCount,
      undoGroup: true,
    }),
    diagnostics: diagnosticsForAutoFillWarnings(params.result.warnings, params.sheetId),
    mode: params.mode,
    options: params.options,
    patternType: params.result.patternType,
    filledCellCount: params.result.filledCellCount,
    warnings: params.result.warnings,
    changes: params.result.changes,
  };
}

/**
 * Autofill from source range into target range.
 *
 * Delegates to ComputeBridge.autoFill which calls the Rust fill engine.
 * The fill engine detects patterns (linear, date, copy, etc.) and fills
 * the target range accordingly.
 *
 * @param ctx - Document context (compute bridge, event bus, etc.)
 * @param sheetId - Sheet identifier
 * @param sourceRange - Source range containing the pattern to extend
 * @param targetRange - Target range to fill into
 * @param mode - Fill behavior mode (default: 'auto')
 * @throws KernelError if range coordinates are invalid
 */
export async function autoFill(
  ctx: DocumentContext,
  sheetId: SheetId,
  sourceRange: CellRange,
  targetRange: CellRange,
  mode: AutoFillMode,
  options: { undoGroup?: boolean } = {},
): Promise<AutoFillApplyReceipt> {
  // Validate ranges
  if (
    sourceRange.startRow < 0 ||
    sourceRange.startCol < 0 ||
    targetRange.startRow < 0 ||
    targetRange.startCol < 0
  ) {
    throw new KernelError('COMPUTE_ERROR', 'Range coordinates must be non-negative');
  }

  await ctx.awaitMaterialized?.('allSheets');

  const direction = computeDirection(sourceRange, targetRange);
  const flags = modeToFlags(mode);

  const bridgeRequest = {
    sourceRange: {
      startRow: sourceRange.startRow,
      startCol: sourceRange.startCol,
      endRow: sourceRange.endRow,
      endCol: sourceRange.endCol,
    },
    targetRange: {
      startRow: targetRange.startRow,
      startCol: targetRange.startCol,
      endRow: targetRange.endRow,
      endCol: targetRange.endCol,
    },
    direction,
    mode,
    stepValue: 1,
    ...flags,
  };

  const operation = () => ctx.computeBridge.autoFill(sheetId, bridgeRequest);
  const bridgeResult =
    options.undoGroup === false ? await operation() : await runAsSingleUndoStep(ctx, operation);
  const result = extractFillResult(bridgeResult);

  return autoFillApplyReceipt({
    sheetId,
    targetRange,
    mode,
    result,
    undoGroup: options.undoGroup !== false,
  });
}

// ==========================================================================
// Fill Series (Edit > Fill > Series dialog)
// ==========================================================================

/**
 * Split a unified range into source (first row/col) and target (rest)
 * based on the fill direction.
 *
 * For 'down': source = first row, target = remaining rows
 * For 'up': source = last row, target = remaining rows above
 * For 'right': source = first column, target = remaining columns
 * For 'left': source = last column, target = remaining columns to the left
 */
function splitRangeForSeries(
  range: CellRange,
  direction: FillSeriesOptions['direction'],
): { sourceRange: CellRange; targetRange: CellRange } {
  switch (direction) {
    case 'down':
      return {
        sourceRange: {
          startRow: range.startRow,
          startCol: range.startCol,
          endRow: range.startRow,
          endCol: range.endCol,
        },
        targetRange: {
          startRow: range.startRow + 1,
          startCol: range.startCol,
          endRow: range.endRow,
          endCol: range.endCol,
        },
      };
    case 'up':
      return {
        sourceRange: {
          startRow: range.endRow,
          startCol: range.startCol,
          endRow: range.endRow,
          endCol: range.endCol,
        },
        targetRange: {
          startRow: range.startRow,
          startCol: range.startCol,
          endRow: range.endRow - 1,
          endCol: range.endCol,
        },
      };
    case 'right':
      return {
        sourceRange: {
          startRow: range.startRow,
          startCol: range.startCol,
          endRow: range.endRow,
          endCol: range.startCol,
        },
        targetRange: {
          startRow: range.startRow,
          startCol: range.startCol + 1,
          endRow: range.endRow,
          endCol: range.endCol,
        },
      };
    case 'left':
      return {
        sourceRange: {
          startRow: range.startRow,
          startCol: range.endCol,
          endRow: range.endRow,
          endCol: range.endCol,
        },
        targetRange: {
          startRow: range.startRow,
          startCol: range.startCol,
          endRow: range.endRow,
          endCol: range.endCol - 1,
        },
      };
  }
}

/**
 * Map FillSeriesOptions to AutoFillMode string for the bridge.
 *
 * - linear + trend → 'linearTrend'
 * - linear (no trend) → 'series'
 * - growth → 'growthTrend'
 * - date → 'days' | 'weekdays' | 'months' | 'years' based on dateUnit
 */
function seriesOptionsToMode(options: FillSeriesOptions): AutoFillMode {
  switch (options.seriesType) {
    case 'linear':
      return options.trend ? 'linearTrend' : 'series';
    case 'growth':
      return 'growthTrend';
    case 'date':
      switch (options.dateUnit) {
        case 'weekday':
          return 'weekdays';
        case 'month':
          return 'months';
        case 'year':
          return 'years';
        case 'day':
        default:
          return 'days';
      }
    default:
      return 'series';
  }
}

/**
 * Fill a range with a series (Edit > Fill > Series dialog equivalent).
 *
 * More explicit than autoFill — the caller specifies exact series parameters
 * (type, step, stop, direction) instead of relying on auto-detection.
 *
 * Internally reuses the same autoFill bridge call — the difference is that
 * FillSeriesOptions maps to a specific (non-auto) FillMode, bypassing
 * pattern detection in the Rust engine.
 *
 * @param ctx - Document context (compute bridge, event bus, etc.)
 * @param sheetId - Sheet identifier
 * @param range - Unified range containing source + target cells
 * @param options - Series parameters from the Fill Series dialog
 * @throws KernelError if the range is too small to split into source + target
 */
export async function fillSeries(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: FillSeriesOptions,
): Promise<FillSeriesApplyReceipt> {
  // Validate that the range has enough rows/cols to split
  const isVertical = options.direction === 'down' || options.direction === 'up';
  if (isVertical && range.startRow === range.endRow) {
    throw new KernelError(
      'COMPUTE_ERROR',
      'Fill series requires at least 2 rows for vertical fill',
    );
  }
  if (!isVertical && range.startCol === range.endCol) {
    throw new KernelError(
      'COMPUTE_ERROR',
      'Fill series requires at least 2 columns for horizontal fill',
    );
  }

  const { sourceRange, targetRange } = splitRangeForSeries(range, options.direction);
  const mode = seriesOptionsToMode(options);

  const bridgeResult = await runAsSingleUndoStep(ctx, () =>
    ctx.computeBridge.autoFill(sheetId, {
      sourceRange: {
        startRow: sourceRange.startRow,
        startCol: sourceRange.startCol,
        endRow: sourceRange.endRow,
        endCol: sourceRange.endCol,
      },
      targetRange: {
        startRow: targetRange.startRow,
        startCol: targetRange.startCol,
        endRow: targetRange.endRow,
        endCol: targetRange.endCol,
      },
      direction: options.direction,
      mode,
      includeFormulas: false, // Series dialog fills values only
      includeValues: true,
      includeFormats: false,
      stepValue: options.stepValue ?? 1,
    }),
  );
  const result = extractFillResult(bridgeResult);

  return fillSeriesApplyReceipt({
    sheetId,
    targetRange,
    mode,
    options,
    result,
  });
}
