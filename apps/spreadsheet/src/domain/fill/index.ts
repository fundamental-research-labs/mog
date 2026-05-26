/**
 * Fill Module - Barrel Export
 *
 * Central export for autofill operations.
 * The fill computation engine lives in Rust (compute-fill crate).
 * This module retains types, range geometry helpers, validation,
 * custom lists, fill series analysis, and flash fill.
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Formula adjustment types
  AdjustedCellRefPosition,
  AdjustedRangeRefPosition,
  AdjustedRefPosition,
  CellRange,
  // Pure computation types (Architecture Fix)
  ComputedFillResult,
  ComputedMultiSheetFillResult,
  // Execution types
  FillDirection,
  FillError,
  FillFormatUpdate,
  FillFormulaUpdate,
  FillOptions,
  FillPattern,
  // Pattern types
  FillPatternType,
  FillResult,
  AutoFillContentType,
  FillUpdates,
  FillValueUpdate,
  // Lookup types
  IFormulaDisplayLookup,
  // Position types
  Position,
  SeriesType,
} from './types';

// =============================================================================
// Constants
// =============================================================================

export { DEFAULT_FILL_OPTIONS, MAX_COLS, MAX_ROWS } from './types';

// =============================================================================
// Range Geometry Helpers
// =============================================================================

export { computeFillDirection, computeTargetRange, expandRange } from './types';

// =============================================================================
// Flash Fill
// =============================================================================

export {
  DEFAULT_FLASH_FILL_CONFIG,
  applyPattern as applyFlashFillPattern,
  detectFlashFillPattern,
  type FlashFillConfig,
  type FlashFillContext,
  type FlashFillDetectionResult,
  type FlashFillExample,
  type FlashFillPattern,
  type FlashFillPatternType,
  type FlashFillPreview,
} from './flash-fill';

// =============================================================================
// Custom Lists
// =============================================================================

export {
  InMemoryCustomListRegistry,
  defaultCustomListRegistry,
  detectCustomListPattern,
  generateCustomListSeries,
  type CustomList,
  type CustomListRegistry,
} from './custom-lists';

// =============================================================================
// Fill Validation
// =============================================================================

export {
  LARGE_FILL_THRESHOLD,
  MAX_FILL_CELLS,
  estimateFillDuration,
  formatDuration,
  getRangeSize,
  // Merge conflict detection
  hasPartialMergeConflict,
  validateFillOperation,
  type FillValidationResult,
  type MergedRegion,
} from './fill-validation';

// =============================================================================
// Fill Series Analyzer (Dialog-specific logic)
// =============================================================================

export {
  analyzeSelectionForFillSeries,
  type FillSeriesAnalysisResult,
} from './fill-series-analyzer';
