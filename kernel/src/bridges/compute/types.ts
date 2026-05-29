/**
 * Compute Bridge Pure Wire Types — Hand-written leaf module.
 *
 * These type definitions mirror Rust serde JSON wire formats and are the
 * canonical hand-written source for types that both the generated `.gen.ts`
 * files and hand-written bridge code need to share. This module MUST remain
 * a leaf: it may import only from external packages, never from other
 * modules inside `kernel/src/bridges/compute/` (and in particular never from
 * `compute-bridge.ts`, `compute-core.ts`, `compute-bridge.gen.ts`, or
 * `compute-types.gen.ts`). Keeping this file at the bottom of the import
 * graph lets `compute-bridge.gen.ts` and `compute-types.gen.ts` import these
 * types without re-entering the hand-written composition root, breaking the
 * historic codegen cycle.
 *
 * Historical note: Most of these types previously lived in
 * `compute-wire-types.ts` (which also imported from `compute-types.gen.ts`
 * for branded helpers). They were extracted here so the generated files can
 * consume them as a leaf dependency. `compute-wire-types.ts` now re-exports
 * from this file and keeps only the `.gen.ts`-dependent branded helpers.
 *
 * @see compute-core/src/types/ - Rust type definitions
 */

import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Types — Match Rust serde JSON wire format
// =============================================================================

export type NonNullPatch<T = unknown> = T;
export type NullablePatch<T = unknown> = T | null;

// These types mirror the Rust structs in compute-core/src/types/snapshot.rs.
// Field names use snake_case to match Rust's serde default serialization.
// UUID-based identity types are serialized as strings on the JSON path.

// ---- Identity Formula wire types (matches Rust IdentityFormula) ----

/**
 * IdentityFormulaRef wire format — externally tagged discriminated union
 * matching Rust's serde default for `enum IdentityFormulaRef`.
 */
export type IdentityFormulaRefWire =
  | { Cell: { id: string; row_absolute: boolean; col_absolute: boolean } }
  | {
      Range: {
        start_id: string;
        end_id: string;
        start_row_absolute: boolean;
        start_col_absolute: boolean;
        end_row_absolute: boolean;
        end_col_absolute: boolean;
      };
    }
  | {
      RectRange: {
        sheet_id: string;
        start_row_id: string;
        start_col_id: string;
        end_row_id: string;
        end_col_id: string;
        start_row_absolute: boolean;
        start_col_absolute: boolean;
        end_row_absolute: boolean;
        end_col_absolute: boolean;
      };
    }
  | { FullRow: { row_id: string; absolute: boolean } }
  | {
      RowRange: {
        start_row_id: string;
        end_row_id: string;
        start_absolute: boolean;
        end_absolute: boolean;
      };
    }
  | { FullCol: { col_id: string; absolute: boolean } }
  | {
      ColRange: {
        start_col_id: string;
        end_col_id: string;
        start_absolute: boolean;
        end_absolute: boolean;
      };
    };

/** IdentityFormula wire format matching Rust IdentityFormula. */
export interface IdentityFormulaWire {
  template: string;
  refs: IdentityFormulaRefWire[];
  is_dynamic_array: boolean;
  is_volatile: boolean;
}

/**
 * Structural change events sent from TS to Rust.
 * Matches Rust's StructureChange enum with serde adjacently-tagged variants.
 */
export type StructureChange =
  | { InsertRows: { at: number; count: number; new_row_ids: string[] } }
  | { DeleteRows: { at: number; count: number; deleted_cell_ids: string[] } }
  | { InsertCols: { at: number; count: number; new_col_ids: string[] } }
  | { DeleteCols: { at: number; count: number; deleted_cell_ids: string[] } }
  | { RemapPositions: { updates: [string, number, number][] } };

/** Lexical scope for variable resolution — matches Rust `Scope` enum (externally tagged). */
export type Scope = { Sheet: string } | 'Workbook';

/** Named range definition (identity-based — uses IdentityFormula). */
export interface NamedRangeDef {
  name: string;
  scope: Scope;
  refers_to: IdentityFormulaWire;
  raw_expression?: string;
}

/** Table definition (for structured references like Table1[Col]). */
export interface TableDef {
  name: string;
  sheet: string;
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
  columns: string[];
  has_headers: boolean;
  has_totals: boolean;
}

/**
 * Identity-based cell range used by wire-level CF rule encodings.
 *
 * Mirrors the generated `CellIdRange` interface in `compute-types.gen.ts`
 * (defined there via the Rust codegen's external_type_map). Duplicated
 * here — as a pure inline structure with the same shape — so this module
 * can stay a leaf and not re-enter the generated files. The two
 * definitions are structurally identical by construction.
 */
export interface CellIdRange {
  topLeftCellId: string;
  bottomRightCellId: string;
}

// =============================================================================
// CF Wire Types — Match Rust cf::types serde JSON format
// =============================================================================

/** CF presets from Rust (single source of truth). */
export interface CFPresetsWire {
  dataBars: unknown[];
  colorScales: unknown[];
  iconSetNames: string[];
}

// =============================================================================
// Schema Wire Types — Match Rust schema serde JSON format
// =============================================================================

/**
 * Schema type wire format. Matches Rust SchemaType enum (camelCase).
 */
export type SchemaTypeWire =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'null'
  | 'currency'
  | 'percentage'
  | 'integer'
  | 'email'
  | 'url'
  | 'phone'
  | 'time'
  | 'company'
  | 'person'
  | 'stock'
  | 'location'
  | 'distribution'
  | 'any';

/**
 * Schema constraints wire format. Matches Rust SchemaConstraints.
 * Uses camelCase field names. `enum_values` is renamed to `enum`.
 */
export interface SchemaConstraintsWire {
  required?: boolean;
  allowBlank?: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  equal?: number;
  notEqual?: number;
  notBetweenMin?: number;
  notBetweenMax?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  enumSource?: RangeRefWire;
  enumSourceFormula?: string;
  unique?: boolean;
  formula?: string;
}

/**
 * Column schema wire format. Matches Rust ColumnSchema.
 * Field `schema_type` is renamed to `type` via serde.
 */
export interface ColumnSchemaWire {
  id: string;
  name: string;
  type: SchemaTypeWire;
  constraints?: SchemaConstraintsWire;
  distribution?: { type: string; params: Record<string, number> };
  description?: string;
}

/** Validation error wire format. */
export interface ValidationErrorWire {
  code: string;
  message: string;
  severity: string;
}

/** Validation result wire format. Matches Rust ValidationResult (camelCase). */
export interface ValidationResultWire {
  valid: boolean;
  errors: ValidationErrorWire[];
  coercedValue?: { type: string; value?: unknown };
  inferredType?: SchemaTypeWire;
}

/**
 * Cell schema (subset of ColumnSchema for editor resolution).
 * Field `schema_type` is renamed to `type` via serde.
 */
/** Validation rule types from the API contracts — used in CellSchemaWire. */
export type ValidationSchemaType = 'list' | 'wholeNumber' | 'decimal' | 'textLength' | 'custom';

export interface CellSchemaWire {
  type?: SchemaTypeWire | ValidationSchemaType;
  constraints?: SchemaConstraintsWire;
}

/** Editor type resolution input. Matches Rust EditorTypeResolutionInput (camelCase). */
export interface EditorTypeResolutionInputWire {
  schema?: CellSchemaWire;
  resolvedEnumItems?: string[];
}

/** Editor types. Matches Rust EditorType enum (camelCase). */
export type EditorType =
  | 'text'
  | 'dropdown'
  | 'date'
  | 'time'
  | 'color'
  | 'checkbox'
  | 'slider'
  | 'calculator';

/** Editor type resolution result. Matches Rust EditorTypeResolutionResult (camelCase). */
export interface EditorTypeResolutionResultWire {
  editorType: EditorType;
  enumItems?: string[];
  requiresValidation: boolean;
}

/** Inferred schema wire format. Matches Rust InferredSchema (camelCase). */
export interface InferredSchemaWire {
  schema: ColumnSchemaWire;
  confidence: number;
  sampleSize: number;
  typesFound: Record<string, number>;
}

/** Schema map entry for bulk load. Matches Rust SchemaMapEntry (camelCase). */
export interface SchemaMapEntryWire {
  sheetId: string;
  column: number;
  schema: ColumnSchemaWire;
}

/** Range reference wire format for range schemas. */
export interface RangeRefWire {
  sheetId?: string;
  startId: string;
  endId: string;
}

/** Cell validation result wire format (document-aware validation). */
export interface CellValidationResultWire {
  valid: boolean;
  errors: ValidationErrorWire[];
  schemaId?: string;
}

// =============================================================================
// Bridge client type stubs — used by compute-backend-adapter.ts and
// compute-bridge.gen.ts. Minimal type definitions matching Rust serde JSON.
// =============================================================================

// --- Chart bridge types (from compute-stats & compute-charts) ---
export type DataRow = Record<string, unknown>;
export interface Point {
  x: number;
  y: number;
}
export type RegressionMethod = 'linear' | 'log' | 'exp' | 'pow' | 'quad' | 'poly';
export interface RegressionOutput {
  method: RegressionMethod;
  order?: number;
  coefficients: number[];
  r_squared: number;
  points: Point[];
  equation: string;
}
export interface DensityResult {
  x: number[];
  density: number[];
  bandwidth: number;
  max_density: number;
}
export interface HistogramBin {
  bin0: number;
  bin1: number;
  count: number;
}
export type StackMode = 'zero' | 'normalize' | 'center';
export interface StackInput {
  category: string;
  value: number;
  group: string;
}
export interface StackOutput {
  category: string;
  group: string;
  value: number;
  start: number;
  end: number;
}
export interface ViolinStats {
  min: number;
  max: number;
  median: number;
  q1: number;
  q3: number;
  mean: number;
}
export interface ViolinShape {
  left: Point[];
  right: Point[];
  stats: ViolinStats;
}
export type AggregateOpKind =
  | 'count'
  | 'sum'
  | 'mean'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'variance'
  | 'stdev'
  | 'q1'
  | 'q3'
  | 'ci0'
  | 'ci1'
  | 'distinct'
  | 'values';
export type SortOrder = 'asc' | 'desc';

// --- Format bridge types (FormatBridge in bridge_pure.rs) ---
export interface FormatEntry {
  value: { type: string; value?: unknown };
  format_code: string;
}
export interface DateValueResult {
  serial: number;
  formatToApply?: string;
}
export interface ParsedDateInput {
  serial: number;
  suggested_format: string;
}
export interface FormulaCircularReferenceValidation {
  cellAddress: string;
  formula: string;
}
/** Date component ordering for locale-aware formatting. */
export type DateOrder = 'MDY' | 'DMY' | 'YMD';

// --- CF bridge types (from compute-cf) ---
export type CFRuleType =
  | 'cellValue'
  | 'formula'
  | 'colorScale'
  | 'dataBar'
  | 'iconSet'
  | 'top10'
  | 'aboveAverage'
  | 'duplicateValues'
  | 'containsText'
  | 'notContainsText'
  | 'beginsWith'
  | 'endsWith'
  | 'containsBlanks'
  | 'notContainsBlanks'
  | 'containsErrors'
  | 'notContainsErrors'
  | 'timePeriod';
export type CFOperator =
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'equal'
  | 'notEqual'
  | 'between'
  | 'notBetween';
export type CFTextOperator = 'contains' | 'notContains' | 'beginsWith' | 'endsWith';
export type DatePeriod =
  | 'yesterday'
  | 'today'
  | 'tomorrow'
  | 'last7Days'
  | 'lastWeek'
  | 'thisWeek'
  | 'nextWeek'
  | 'lastMonth'
  | 'thisMonth'
  | 'nextMonth'
  | 'lastQuarter'
  | 'thisQuarter'
  | 'nextQuarter'
  | 'lastYear'
  | 'thisYear'
  | 'nextYear';
export type CFValueType = 'min' | 'max' | 'percent' | 'percentile' | 'number' | 'formula';
export type CFDataBarDirection = 'leftToRight' | 'rightToLeft' | 'context';
export type CFDataBarAxisPosition = 'automatic' | 'midpoint' | 'none';
export type CFIconThresholdOperator = 'greaterThanOrEqual' | 'greaterThan';
export type CfIconSetName =
  | '3Arrows'
  | '3ArrowsGray'
  | '3Flags'
  | '3TrafficLights1'
  | '3TrafficLights2'
  | '3Signs'
  | '3Symbols'
  | '3Symbols2'
  | '3Stars'
  | '3Triangles'
  | '4Arrows'
  | '4ArrowsGray'
  | '4RedToBlack'
  | '4Rating'
  | '4TrafficLights'
  | '5Arrows'
  | '5ArrowsGray'
  | '5Rating'
  | '5Quarters'
  | '5Boxes'
  | 'NoIcons'
  | 'Custom';
export type CFUnderlineType =
  | 'none'
  | 'single'
  | 'double'
  | 'singleAccounting'
  | 'doubleAccounting';
export type CFBorderStyle =
  | 'none'
  | 'thin'
  | 'medium'
  | 'thick'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'hair'
  | 'mediumDashed'
  | 'dashDot'
  | 'mediumDashDot'
  | 'dashDotDot'
  | 'mediumDashDotDot'
  | 'slantDashDot';
/**
 * CF style wire type — bridges Rust `CfRenderStyle` (compute-cf) to TS.
 *
 * The Rust type was renamed from CFStyle to CfRenderStyle to avoid codegen
 * collision with domain-types' persistence CFStyle. Colors here are hex
 * strings; the generated CfRenderStyle uses RGBA tuples. Conversion happens
 * at the bridge layer.
 */
export interface CFStyle {
  backgroundColor?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underlineType?: CFUnderlineType;
  strikethrough?: boolean;
  borderColor?: string;
  borderStyle?: CFBorderStyle;
  numberFormat?: string;
  // Per-side borders (matching compute-cf/src/types/rule.rs)
  borderTopColor?: string;
  borderTopStyle?: CFBorderStyle;
  borderBottomColor?: string;
  borderBottomStyle?: CFBorderStyle;
  borderLeftColor?: string;
  borderLeftStyle?: CFBorderStyle;
  borderRightColor?: string;
  borderRightStyle?: CFBorderStyle;
}
export interface CFColorPointWire {
  type: CFValueType;
  value?: string;
  color: string;
}
export interface CFColorScaleWire {
  minPoint: CFColorPointWire;
  midPoint?: CFColorPointWire;
  maxPoint: CFColorPointWire;
}
export interface CFDataBarWire {
  minPoint: CFColorPointWire;
  maxPoint: CFColorPointWire;
  positiveColor: string;
  negativeColor?: string;
  borderColor?: string;
  negativeBorderColor?: string;
  showBorder?: boolean;
  gradient?: boolean;
  direction?: CFDataBarDirection;
  axisPosition?: CFDataBarAxisPosition;
  axisColor?: string;
  showValue?: boolean;
  minLength?: number;
  maxLength?: number;
}
export interface CFIconThresholdWire {
  type: CFValueType;
  value?: string;
  operator: CFIconThresholdOperator;
}
export interface CFIconSetWire {
  iconSetName: CfIconSetName;
  thresholds: CFIconThresholdWire[];
  percent?: boolean;
  reverseOrder?: boolean;
  showIconOnly?: boolean;
}
/** Data bar rendering result from CF evaluation. */
export interface DataBarResult {
  fillPercent: number;
  color: [number, number, number, number];
  gradient: boolean;
  axisPosition: number;
  isNegative: boolean;
  negativeColor?: [number, number, number, number];
  showValue: boolean;
  showAxis: boolean;
  borderColor?: [number, number, number, number];
  negativeBorderColor?: [number, number, number, number];
  showBorder: boolean;
  direction: CFDataBarDirection;
  axisColor?: [number, number, number, number];
}
/** Color scale rendering result from CF evaluation. */
export interface ColorScaleResult {
  color: [number, number, number, number];
}
/** Icon rendering result from CF evaluation. */
export interface IconResult {
  setName: CfIconSetName;
  iconIndex: number;
  showValue: boolean;
}

// --- Engine types (YrsComputeEngine) ---
export interface PageBreakEntry {
  id: number;
  min: number;
  max: number;
  manual: boolean;
  pt: boolean;
}

export interface PageBreaks {
  rowBreaks: PageBreakEntry[];
  colBreaks: PageBreakEntry[];
}

// --- Table types (from compute-table) ---
export interface TableRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
export type TotalsFunction =
  | 'average'
  | 'count'
  | 'countNums'
  | 'max'
  | 'min'
  | 'stdDev'
  | 'sum'
  | 'var'
  | 'custom'
  | 'none';
export type TableBoolOption =
  | 'bandedRows'
  | 'bandedColumns'
  | 'emphasizeFirstColumn'
  | 'emphasizeLastColumn'
  | 'showFilterButtons';
export type FilterLogic = 'and' | 'or';
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'beginsWith'
  | 'endsWith'
  | 'contains'
  | 'notContains'
  | 'between'
  | 'notBetween'
  | 'isBlank'
  | 'isNotBlank';
export type TopBottomDirection = 'top' | 'bottom';
export type TopBottomBy = 'items' | 'percent' | 'sum';
export type DynamicFilterRule =
  | 'aboveAverage'
  | 'belowAverage'
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'thisWeek'
  | 'lastWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'nextMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'nextQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'nextYear';
export type SlicerSourceType = 'table' | 'pivot';
export type SlicerSortOrder = 'ascending' | 'descending' | 'dataSourceOrder';
export interface SheetRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
/** CF cell range — alias for SheetRange (position-based range). */
export type CFCellRange = SheetRange;
/** Regression options for chart statistics. */
export interface RegressionOptions {
  numPoints?: number;
  minX?: number;
  maxX?: number;
  precision?: number;
}
/** Locale configuration for number formatting. */
export interface Locale {
  tag: string;
  decimalSeparator: string;
  thousandsSeparator: string;
  dateOrder: string;
}
export type SortDirection = 'asc' | 'desc';
export type BorderStyle = 'thin' | 'medium' | 'thick';

// --- CF Rule wire type (from compute-cf::types::CFRuleWire, camelCase) ---
export interface CFRuleWire {
  ruleType: CFRuleType;
  priority: number;
  stopIfTrue?: boolean;
  style?: CFStyle;
  operator?: CFOperator;
  values?: string[];
  formula?: string;
  colorScale?: CFColorScaleWire;
  dataBar?: CFDataBarWire;
  iconSet?: CFIconSetWire;
  text?: string;
  textOperator?: CFTextOperator;
  datePeriod?: DatePeriod;
  rank?: number;
  percent?: boolean;
  bottom?: boolean;
  above?: boolean;
  equalAverage?: boolean;
  stdDev?: number;
  unique?: boolean;
  blanks?: boolean;
  errors?: boolean;
  ranges?: CellIdRange[];
}

// --- CF presets (from bridge_pure::CfPresets, camelCase) ---
export interface CfPresets {
  dataBars: CFDataBarWire[];
  colorScales: CFColorScaleWire[];
  iconSetNames: CfIconSetName[];
}

// `ChartStatistics` was relocated from bridge_pure.rs into snapshot-types
// and is now generated into compute-types.gen.ts. The
// hand-written interface that lived here was deleted; consumers should
// import the generated definition (re-exported via compute-bridge.ts /
// compute-wire-types.ts).

// --- Goal Seek wire types (from compute-core::solver::types, snake_case) ---
export interface GoalSeekParams {
  formula_cell: string;
  target: number;
  input_cell: string;
  initial_guess: number;
  max_iterations?: number;
  precision?: number;
  max_change?: number;
}

export type GoalSeekError = 'NonNumeric' | 'MaxIterations' | 'Diverged';

export interface GoalSeekResult {
  found: boolean;
  solution_value?: number;
  achieved_value?: number;
  iterations: number;
  error?: GoalSeekError;
  error_message?: string;
}

// --- Data Table wire types (from compute-core::data_table, snake_case) ---

export interface DataTableParams {
  formula_cell: string;
  row_input_cell?: string | null;
  col_input_cell?: string | null;
  row_values: CellValue[];
  col_values: CellValue[];
}

export interface DataTableResult {
  results: CellValue[][];
  cell_count: number;
  cancelled: boolean;
}

export interface CreateDataTableInput {
  sheetId: SheetId;
  tableRange: string;
  rowInputCell?: string | null;
  colInputCell?: string | null;
}

export interface CreateDataTableResult {
  regionId: string;
  tableRange: string;
  bodyRange: string;
  rowInputCell?: string | null;
  colInputCell?: string | null;
  rowsComputed: number;
  colsComputed: number;
  cellCount: number;
}

// ---------------------------------------------------------------------------
// Region metadata — `CellMetadata.region` shape (Stream D3 of
// `projection-family region semantics`).
//
// Mirrors Rust `snapshot_types::properties::{RegionMeta, RegionKind,
// RegionBounds}`. Surfaces non-trivial cell-membership shapes (CSE
// arrays, dynamic-array spill, Data Table; future pivot / table column /
// defined-name / external) through ONE wire field.
//
// **No `source` field on `RegionMeta`.** Formula text stays on
// `cellData.formula`.
// ---------------------------------------------------------------------------

/**
 * Region kind discriminant — string union matching Rust's
 * `serde(rename_all = "camelCase")` serialization of `enum RegionKind`.
 *
 * - `arraySpill` — modern dynamic-array spill (e.g. `=SEQUENCE(5)`).
 *   The formula bar does NOT brace-wrap members.
 * - `cseArray` — legacy Ctrl+Shift+Enter array formula. Formula bar
 *   brace-wraps (`{=…}`).
 * - `dataTable` — XLSX `<f t="dataTable">`. Formula bar brace-wraps
 *   (`{=TABLE(…)}`).
 */
export type RegionKind = 'arraySpill' | 'cseArray' | 'dataTable';

/**
 * Region rectangle dimensions in cells. Together with `anchorRow` /
 * `anchorCol` describes the region rectangle.
 */
export interface RegionBounds {
  rows: number;
  cols: number;
}

/**
 * Region membership shape carried on `CellMetadata.region`.
 *
 * `isAnchor` distinguishes the formula-owning cell (CSE anchor / Data
 * Table master) from members. Formula text is on `cellData.formula`,
 * not duplicated here.
 */
export interface RegionMeta {
  kind: RegionKind;
  isAnchor: boolean;
  anchorRow: number;
  anchorCol: number;
  bounds: RegionBounds;
}

/**
 * `CellMetadata` wire shape mirroring Rust's
 * `snapshot_types::properties::CellMetadata`.
 *
 * The `region` field is the unified region-membership shape (D3).
 * `isArrayFormula`, `isCseAnchor`, and `isArrayMember` are back-compat
 * derivations that the formula bar / canvas read today; D5 will
 * deprecate them in favor of `region.kind`.
 */
export interface CellMetadata {
  provenance?: string;
  validation?: string;
  connectionId?: string;
  s?: number;
  cm?: number;
  vm?: number;
  formulaResultType?: number;
  sstIndex?: number;
  originalValue?: string;
  isArrayFormula?: boolean;
  isCseAnchor?: boolean;
  /** NEW in D3: derived as `region != null && !region.isAnchor`. */
  isArrayMember?: boolean;
  /** NEW in D3: unified region-membership shape. `null` for plain cells. */
  region?: RegionMeta | null;
}
