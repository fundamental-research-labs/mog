/**
 * Fill Types
 *
 * Pure type definitions for fill/autofill operations.
 * These types are shared between the domain fill module and other zones
 * that need to reference fill configuration without depending on the domain layer.
 *
 * @module @mog-sdk/contracts/fill
 */

import type { CellValue } from '@mog/types-core';

// =============================================================================
// FILL DIRECTION & MODE TYPES
// =============================================================================

/** Direction of a fill operation relative to the source range. */
export type FillDirection = 'down' | 'right' | 'up' | 'left';

/** What content types to include in the fill. */
export type AutoFillContentType = 'all' | 'formulas' | 'values' | 'formats';

/** How the fill series should be generated. */
export type SeriesType = 'auto' | 'copy' | 'linear' | 'growth' | 'date';

/** Unit for date-based series fills. */
export type DateUnit = 'day' | 'weekday' | 'month' | 'year';

// =============================================================================
// FILL OPTIONS
// =============================================================================

/**
 * Configuration options for a fill operation.
 * Controls direction, content types, series generation, and visibility handling.
 */
export interface FillOptions {
  direction: FillDirection;
  fillType: AutoFillContentType;
  seriesType: SeriesType;
  dateUnit?: DateUnit;
  step?: number;
  includeFormulas: boolean;
  includeValues: boolean;
  includeFormats: boolean;
  smartFill: boolean;
  includeValidation?: boolean;
  skipHiddenRows?: boolean;
  skipHiddenCols?: boolean;
  isRowHidden?: (row: number) => boolean;
  isColHidden?: (col: number) => boolean;
}

/** Default fill options used when no overrides are specified. */
export const DEFAULT_FILL_OPTIONS: FillOptions = {
  direction: 'down',
  fillType: 'all',
  seriesType: 'auto',
  includeFormulas: true,
  includeValues: true,
  includeFormats: true,
  smartFill: true,
  includeValidation: true,
  skipHiddenRows: true,
  skipHiddenCols: true,
};

// =============================================================================
// FLASH FILL PREVIEW
// =============================================================================

/**
 * A single cell's preview value for flash fill.
 * Used to show the user what values flash fill will produce before confirming.
 */
export interface FlashFillPreviewValue {
  row: number;
  col: number;
  value: CellValue;
}

// =============================================================================
// AUTOFILL MODE & RESULT TYPES
// =============================================================================

/**
 * Fill mode for autoFill() — matches Rust FillMode enum.
 * Covers the full spreadsheet fill behavior set.
 */
export type AutoFillMode =
  | 'auto' // Detect pattern automatically (default)
  | 'copy' // Always copy (no series)
  | 'series' // Force series interpretation
  | 'days' // Force date unit: days
  | 'weekdays' // Force date unit: weekdays
  | 'months' // Force date unit: months
  | 'years' // Force date unit: years
  | 'formats' // Copy formats only
  | 'values' // Copy values only (no formats)
  | 'withoutFormats' // Copy values + formulas, skip formats
  | 'linearTrend' // Force linear regression trend
  | 'growthTrend'; // Force exponential regression trend

/**
 * Pattern type detected by the fill engine.
 */
export type FillPatternType =
  | 'copy'
  | 'linear'
  | 'growth'
  | 'date'
  | 'time'
  | 'weekday'
  | 'weekdayShort'
  | 'month'
  | 'monthShort'
  | 'quarter'
  | 'ordinal'
  | 'textWithNumber'
  | 'customList';

/** A single cell change produced by the fill engine. */
export interface AutoFillChange {
  row: number;
  col: number;
  type: 'value' | 'formula' | 'format' | 'clear';
}

/**
 * Result from autoFill() — summary of what the fill engine did.
 */
export interface AutoFillResult {
  /** The pattern that was detected (or forced by mode) */
  patternType: FillPatternType;
  /** Number of cells that were filled */
  filledCellCount: number;
  /** Any warnings generated during fill */
  warnings: AutoFillWarning[];
  /** Per-cell changes listing each cell written */
  changes: AutoFillChange[];
}

/** A single adjusted formula reference reported by the Rust fill engine. */
export interface AutoFillAdjustedRef {
  refIndex: number;
  targetRow: number;
  targetCol: number;
  targetEndRow: number | null;
  targetEndCol: number | null;
  outOfBounds: boolean;
}

/** Formula text produced for one target cell during autofill preview. */
export interface AutoFillFormulaPreview {
  row: number;
  col: number;
  formula: string;
  sourceFormula: string;
  adjustedRefs: AutoFillAdjustedRef[];
}

/** Per-reference diagnostic emitted during autofill preview. */
export interface AutoFillReferenceDiagnostic extends AutoFillAdjustedRef {
  row: number;
  col: number;
}

/**
 * Dry-run result from autoFillPreview().
 */
export interface AutoFillPreviewResult extends AutoFillResult {
  /** Target formulas rendered after Rust reference adjustment. */
  formulas: AutoFillFormulaPreview[];
  /** Per-reference diagnostics for adjusted formula references. */
  referenceDiagnostics: AutoFillReferenceDiagnostic[];
}

export interface AutoFillWarning {
  row: number;
  col: number;
  kind: AutoFillWarningKind;
}

export type AutoFillWarningKind =
  | { type: 'mergedCellsInTarget' }
  | { type: 'formulaRefOutOfBounds'; refIndex: number }
  | { type: 'sourceCellEmpty' };

/**
 * Options for the Fill Series dialog (Edit > Fill > Series).
 */
export interface FillSeriesOptions {
  direction: FillDirection;
  seriesType: 'linear' | 'growth' | 'date';
  stepValue: number;
  stopValue?: number;
  dateUnit?: DateUnit;
  trend?: boolean;
}
