/**
 * Compute Wire Types — Backwards-compat barrel + branded-type helpers.
 *
 * The bulk of hand-written wire types now live in `./types.ts`, which is a
 * leaf module (no intra-package imports). This file re-exports every pure
 * wire type from `./types` for backwards compatibility with existing
 * consumers that import from `./compute-wire-types` (e.g. converters,
 * hand-written operations). It also hosts the small set of branded helpers
 * that genuinely depend on generated types in `./compute-types.gen.ts`
 * (`TypedActiveCellData`, `TypedCellEdit`, and the simplified init
 * `WorkbookSnapshot`). Keeping those helpers here, rather than in
 * `./types.ts`, preserves the "types is a leaf" invariant that the codegen
 * relies on to stay cycle-free.
 */

import type { ActiveCellData, CellEdit, ChartStatistics, SheetSnapshot } from './compute-types.gen';
export type { ChartStatistics };
import type { FormulaA1, FormulaTemplate } from '@mog-sdk/contracts/cells';

import type { NamedRangeDef, TableDef } from './types';

// =============================================================================
// Pure wire types — re-exported verbatim from ./types (leaf module).
// =============================================================================

export type {
  AggregateOpKind,
  BorderStyle,
  CellIdRange,
  CellSchemaWire,
  CellValidationResultWire,
  CFBorderStyle,
  CFCellRange,
  CFColorPointWire,
  CFColorScaleWire,
  CFDataBarAxisPosition,
  CFDataBarDirection,
  CFDataBarWire,
  CfIconSetName,
  CFIconSetWire,
  CFIconThresholdOperator,
  CFIconThresholdWire,
  CFOperator,
  CFPresetsWire,
  CfPresets,
  CFRuleType,
  CFRuleWire,
  CFStyle,
  CFTextOperator,
  CFUnderlineType,
  CFValueType,
  ColorScaleResult,
  ColumnSchemaWire,
  DataBarResult,
  DataRow,
  DataTableParams,
  DataTableResult,
  DateOrder,
  DatePeriod,
  DateValueResult,
  DensityResult,
  DynamicFilterRule,
  EditorType,
  EditorTypeResolutionInputWire,
  EditorTypeResolutionResultWire,
  FilterLogic,
  FilterOperator,
  FormatEntry,
  GoalSeekError,
  GoalSeekParams,
  GoalSeekResult,
  HistogramBin,
  IconResult,
  IdentityFormulaRefWire,
  IdentityFormulaWire,
  InferredSchemaWire,
  Locale,
  NamedRangeDef,
  PageBreakEntry,
  PageBreaks,
  ParsedDateInput,
  Point,
  RangeRefWire,
  RegressionMethod,
  RegressionOptions,
  RegressionOutput,
  SchemaConstraintsWire,
  SchemaMapEntryWire,
  SchemaTypeWire,
  Scope,
  SheetRange,
  SlicerSortOrder,
  SlicerSourceType,
  SortDirection,
  SortOrder,
  StackInput,
  StackMode,
  StackOutput,
  StructureChange,
  TableBoolOption,
  TableDef,
  TableRange,
  TopBottomBy,
  TopBottomDirection,
  TotalsFunction,
  ValidationErrorWire,
  ValidationResultWire,
  ValidationSchemaType,
  ViolinShape,
  ViolinStats,
} from './types';

// =============================================================================
// Branded Formula Type Overrides — depend on generated types in .gen.ts
// =============================================================================

// The generated types (compute-types.gen.ts) use plain `string` for formula
// fields. These overrides narrow the types using branded FormulaA1/FormulaTemplate
// to catch =prefix mismatches at compile time.

/**
 * ActiveCellData with `formula` narrowed to `FormulaA1`.
 *
 * Rust's `ActiveCellData.formula` always includes the `=` prefix
 * (produced by `to_a1_string()`), so we brand it accordingly.
 */
export type TypedActiveCellData = Omit<ActiveCellData, 'formula'> & {
  formula?: FormulaA1;
};

/**
 * CellEdit with `formula` narrowed to `FormulaTemplate | null`.
 *
 * Rust's `CellEdit.formula` is the template WITHOUT `=` prefix
 * (from `IdentityFormula.template`), so we brand it accordingly.
 */
export type TypedCellEdit = Omit<CellEdit, 'formula'> & {
  formula: FormulaTemplate | null;
};

/**
 * Full workbook snapshot for initialization (JSON path — string UUIDs).
 *
 * Note: This is a simplified version for TS → Rust init calls. The
 * generated `WorkbookSnapshot` (in compute-types.gen.ts) includes
 * additional required fields (pivot_tables, iterative_calc, etc.) that
 * Rust sends back but aren't required for init. This init wrapper
 * references the generated `SheetSnapshot` and the hand-written leaf
 * types `NamedRangeDef` / `TableDef` from `./types`.
 */
export interface WorkbookSnapshot {
  sheets: SheetSnapshot[];
  named_ranges: NamedRangeDef[];
  tables: TableDef[];
}
