/**
 * Fill Handler Types and Helpers
 *
 * Delegates to ws.autoFill (kernel Rust fill engine) instead of
 * building FillContext and applying updates manually via setCells.
 */

import type { AutoFillMode, AutoFillResult } from '@mog-sdk/contracts/fill';
import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';

import type { CellRange, ComputedFillResult, FillOptions } from '../../../domain/fill';
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
function mapToComputedFillResult(result: AutoFillResult): ComputedFillResult {
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
      errors: result.warnings.map((w) => ({
        row: w.row,
        col: w.col,
        error:
          w.kind.type === 'mergedCellsInTarget'
            ? 'Target range contains merged cells'
            : w.kind.type === 'formulaRefOutOfBounds'
              ? `Formula reference out of bounds (ref ${(w.kind as { refIndex: number }).refIndex})`
              : 'Source cell is empty',
        type: 'warning' as const,
      })),
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
    const result = await ws.autoFill(sourceA1, targetA1, mode);
    console.log('[executeFillViaWorksheet] ws.autoFill returned', result);
    return mapToComputedFillResult(result);
  } catch (err) {
    console.error('[executeFillViaWorksheet] ws.autoFill THREW', err);
    return {
      success: false,
      updates: {
        valueUpdates: [],
        formulaUpdates: [],
        formatUpdates: [],
        filledCellIds: [],
        overwrittenCellIds: [],
        pattern: null,
        errors: [
          {
            row: targetRange.startRow,
            col: targetRange.startCol,
            error: err instanceof Error ? err.message : String(err),
            type: 'error',
          },
        ],
      },
    };
  }
}
