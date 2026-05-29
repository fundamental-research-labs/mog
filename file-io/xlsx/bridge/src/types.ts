/**
 * @fileoverview Type definitions for the WASM-based XLSX parser.
 *
 * These types define the data structures used for parsing XLSX files
 * with world-class performance using Rust + WebAssembly.
 *
 * @module xlsx-parser/types
 */

// =============================================================================
// Generated Types (from Rust via bridge-ts — single source of truth)
// =============================================================================
// These types are auto-generated from the Rust output structs and accurately
// reflect what the WASM parser actually produces. Import these when you need
// the exact Rust output shape.
// The bridge shape is a semantic subset of XLSX import state. Rust-internal
// fidelity sidecars can preserve additional OOXML for in-process export, but
// they are not exposed here as editable TypeScript data.

import type {
  FormControlOutput as _FormControlOutput,
  OleObjectOutput as _OleObjectOutput,
} from '@mog/bridge-ts/generated/xlsx-types';
export type {
  AlignmentOutput,
  CellProtectionOutput,
  CellXfOutput,
  FontOutput,
  FormControlOutput,
  HeaderFooterOutput,
  MarginsOutput,
  OleObjectOutput,
  PageBreakOutput,
  PageBreaksOutput,
  SlicerAnchor as ParsedSlicerAnchor,
  SlicerCacheDef as ParsedSlicerCacheDef,
  SlicerDef as ParsedSlicerDef,
  SlicerPivotTableRef as ParsedSlicerPivotTableRef,
  SlicerTabularData as ParsedSlicerTabularData,
  SlicerTabularItem as ParsedSlicerTabularItem,
  TableSlicerCache as ParsedTableSlicerCache,
  PrintSettingsOutput,
  SheetViewOutput,
  StylesOutput,
} from '@mog/bridge-ts/generated/xlsx-types';

// CellAnchor is inlined in the generated SlicerAnchor type; provide a named alias
// for downstream consumers that reference it as ParsedSlicerCellAnchor.
export type ParsedSlicerCellAnchor = { col: number; colOff: number; row: number; rowOff: number };

// Re-export the full generated file under a namespace-like alias
export type {
  FullParsedSheet as WasmFullParsedSheet,
  FullParseResult as WasmFullParseResult,
} from '@mog/bridge-ts/generated/xlsx-types';

// =============================================================================
// External Link Types (generated from Rust domain-types via bridge-ts)
// =============================================================================

import type { ExternalLink } from '@mog/bridge-ts/generated/xlsx-types';
export type {
  CachedValue,
  ExternalCacheValue,
  ExternalDefinedName,
  ExternalLink,
  ExternalLinkExtraRel,
  ExternalLinkRelationship,
  ExternalLinkRelationshipCurrentness,
  ExternalLinkRelationshipRole,
  ExternalLinkType,
} from '@mog/bridge-ts/generated/xlsx-types';

// =============================================================================
// Cell Value Types
// =============================================================================

/**
 * Raw cell value types supported by the parser.
 * Matches the existing CellRawValue type from @mog-sdk/contracts.
 */
export type CellRawValue = string | number | boolean | null;

// =============================================================================
// Parser Configuration
// =============================================================================

/**
 * Configuration for WasmXlsxParser constructor.
 */
export interface ParserConfig {
  /**
   * Maximum number of cells the parser can handle.
   * @default 1_000_000 (1 million cells)
   */
  maxCells?: number;

  /**
   * Maximum bytes for string data.
   * @default 100_000_000 (100 MB)
   */
  maxStringBytes?: number;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for parser failures.
 */
export enum ParseErrorCode {
  /** WASM module failed to initialize */
  WasmInitFailed = 'WASM_INIT_FAILED',
  /** Invalid or corrupted XLSX file */
  InvalidFile = 'INVALID_FILE',
  /** ZIP decompression failed */
  ZipError = 'ZIP_ERROR',
  /** XML parsing failed */
  XmlError = 'XML_ERROR',
  /** Cell limit exceeded */
  CellLimitExceeded = 'CELL_LIMIT_EXCEEDED',
  /** Memory allocation failed */
  OutOfMemory = 'OUT_OF_MEMORY',
  /** Operation was cancelled */
  Cancelled = 'CANCELLED',
  /** Generic parse error */
  ParseError = 'PARSE_ERROR',
}

/**
 * Custom error class for XLSX parsing errors.
 */
export class XlsxParseError extends Error {
  readonly code: ParseErrorCode;
  readonly cause?: Error;

  constructor(code: ParseErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = 'XlsxParseError';
    this.code = code;
    this.cause = cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, XlsxParseError);
    }
  }
}

// =============================================================================
// Feature Detection
// =============================================================================

/**
 * Capabilities detected at runtime.
 */
export interface ParserCapabilities {
  /** WebAssembly is supported */
  wasmSupported: boolean;
  /** WASM SIMD instructions are supported */
  simdSupported: boolean;
  /** SharedArrayBuffer is available */
  sharedArrayBufferSupported: boolean;
  /** WebAssembly.instantiateStreaming is available */
  streamingSupported: boolean;
}

// =============================================================================
// Full Parse Result Types (for parse_xlsx_full)
// =============================================================================

/**
 * Complete result from parse_xlsx_full().
 * Contains all parsed data as JavaScript objects (no binary buffers).
 */
export interface FullParseResult {
  /** Parsed worksheets with complete data */
  sheets: FullParsedSheet[];
  /** Shared strings table */
  sharedStrings: SharedStringEntry[];
  /** Complete stylesheet (fonts, fills, borders, number formats) */
  styles: ParsedStyles;
  /** Theme data (colors, fonts, effects) */
  theme: ParsedTheme | null;
  /** Defined names (named ranges, formulas) */
  definedNames: DefinedName[];
  /** Workbook protection settings */
  workbookProtection: WorkbookProtection | null;
  /** Workbook metadata (title, author, etc.) */
  metadata: WorkbookMetadata;
  /** External workbook links */
  externalLinks: ExternalLink[];
  /**
   * @deprecated Calculation chains are recalculation caches and are intentionally
   * dropped by production parsing/export. This array is always empty.
   */
  calcChain: CalcChainEntry[];
  /** Custom document properties */
  customProperties: CustomProperty[];
  /** VBA project info (if present) */
  vbaProject: VbaProjectInfo | null;
  /** Active sheet index */
  activeSheetIndex: number;
  /** Slicer cache definitions (workbook-level, shared across sheets) */
  slicerCaches: SlicerCacheDef[];
  /** Non-fatal parsing errors */
  errors: ParseErrorDetail[];
  /** Parsing statistics */
  stats: FullParseStats;
}

/**
 * Shared string entry - can be plain text or rich text.
 */
export type SharedStringEntry = string | RichTextEntry;

/**
 * Rich text with formatting runs.
 */
export interface RichTextEntry {
  /** Plain text content */
  text: string;
  /** Formatting runs */
  runs: RichTextRun[];
}

/**
 * A single formatted run within rich text.
 */
export interface RichTextRun {
  /** Text content of this run */
  text: string;
  /** OOXML underline token for rich text runs */
  underlineStyle?: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';
  /** Legacy underline projection; true means single underline when underlineStyle is absent */
  underline?: boolean;
  /** Rich text run outline flag */
  outline?: boolean;
  /** Rich text run shadow flag */
  shadow?: boolean;
  /** Rich text run condense flag */
  condense?: boolean;
  /** Rich text run extend flag */
  extend?: boolean;
  /** Font properties for this run */
  font?: ParsedFont;
}

/**
 * Fully parsed sheet with all Excel features.
 */
export interface FullParsedSheet {
  /** Sheet name as displayed in tabs */
  name: string;
  /** Sheet index (0-based) */
  index: number;
  /** Relationship ID */
  rId: string;
  /** Sheet visibility state */
  state: SheetState;
  /** Tab color (ARGB hex) */
  tabColor?: string;

  // Cell data
  /** All cells in this sheet */
  cells: CellData[];
  /** Used range bounds */
  usedRange: CellRange | null;

  // Structure
  /** Merged cell ranges */
  merges: MergeRange[];
  /** Column widths (objects from Rust ColWidth) */
  colWidths: ColWidth[];
  /** Row heights (objects from Rust RowHeight) */
  rowHeights: RowHeight[];
  /** Hidden column indices */
  hiddenCols: number[];
  /** Hidden row indices */
  hiddenRows: number[];
  /** Default column width */
  defaultColWidth: number;
  /** Default row height */
  defaultRowHeight: number;
  /** Frozen pane configuration */
  frozenPane: FrozenPane | null;
  /** Row outline groups */
  rowOutlineGroups: OutlineGroup[];
  /** Column outline groups */
  colOutlineGroups: OutlineGroup[];

  // Features
  /** Conditional formatting rules */
  conditionalFormats: ConditionalFormat[];
  /** Data validation rules */
  dataValidations: DataValidation[];
  /** Tables (ListObjects) */
  tables: Table[];
  /** Auto filter settings */
  autoFilter: AutoFilter | null;
  /** Sparkline groups */
  sparklines: SparklineGroup[];
  /** Cell comments */
  comments: Comment[];
  /** Hyperlinks */
  hyperlinks: Hyperlink[];

  // Print & view settings
  /** Page setup for printing (structured output from Rust PrintSettingsOutput) */
  printSettings: PrintSettings | null;
  /** Page breaks (structured output from Rust PageBreaksOutput, null if none) */
  pageBreaks: PageBreaks | null;
  /** Sheet protection settings */
  protection: SheetProtection | null;
  /** View options (structured output from Rust SheetViewOutput, null if defaults) */
  viewOptions: SheetViewOptions | null;
  /** Sort state */
  sortState: SortState | null;

  /** Charts embedded in this sheet (from drawing/chart XML parts) */
  charts: ChartSpec[];

  /** SmartArt diagrams embedded in this sheet (raw XML parts for rendering pipeline) */
  smartartDiagrams: SmartArtPartsOutput[];

  /** Slicer definitions parsed from this sheet's slicer parts */
  slicers: SlicerDef[];
  /** Slicer anchors (positions in the drawing layer) for this sheet */
  slicerAnchors: SlicerAnchor[];

  /** Form controls (checkboxes, dropdowns, buttons, scroll bars, etc.) */
  formControls: _FormControlOutput[];
  /** OLE objects and embedded package placeholders parsed from worksheet XML. */
  oleObjects?: _OleObjectOutput[];

  /** Sheet-level parse errors */
  errors: ParseErrorDetail[];
}

/**
 * Sheet visibility state.
 */
export type SheetState = 'visible' | 'hidden' | 'veryHidden';

/**
 * Cell data from full parse.
 */
export interface CellData {
  /** Row index (0-based) */
  row: number;
  /** Column index (0-based) */
  col: number;
  /** Cell type */
  type: CellType;
  /** Raw cell value */
  value: CellRawValue;
  /** Display/formatted value */
  displayValue?: string;
  /** Formula (without leading =) */
  formula?: string;
  /** Array formula range (if array formula master) */
  arrayFormulaRange?: CellRange;
  /** Shared formula index */
  sharedFormulaIndex?: number;
  /** Style index into styles.cellXfs */
  styleIndex: number;
  /** Inline rich text (for inlineStr type) */
  inlineString?: RichTextEntry;
}

/**
 * Cell type enumeration.
 */
export type CellType = 's' | 'str' | 'n' | 'b' | 'e' | 'inlineStr';

/**
 * Cell range definition.
 *
 * This is a local definition because xlsx-parser is intentionally standalone
 * (no workspace dependency on contracts). Structurally identical to the canonical
 * `CellRange` in `@mog-sdk/contracts/core` (subset - missing optional
 * `isFullColumn`, `isFullRow`, and `sheetId` fields).
 *
 * @see `@mog-sdk/contracts/core` for the canonical `CellRange` type.
 */
export interface CellRange {
  /** Start row (0-based) */
  startRow: number;
  /** Start column (0-based) */
  startCol: number;
  /** End row (0-based, inclusive) */
  endRow: number;
  /** End column (0-based, inclusive) */
  endCol: number;
}

/**
 * Merge range (alias for CellRange with same semantics).
 */
export type MergeRange = CellRange;

/**
 * Column width entry. Matches Rust `ColWidth` struct (camelCase serde).
 */
export interface ColWidth {
  /** Column index (0-based) */
  col: number;
  /** Width in character units */
  width: number;
  /** Start column (1-indexed, for XLSX range representation) */
  min?: number;
  /** End column (1-indexed, for XLSX range representation) */
  max?: number;
  /** Whether this is a custom width */
  customWidth?: boolean;
  /** Whether the column is hidden */
  hidden?: boolean;
  /** Style index for the column */
  style?: number;
  /** Whether width was calculated for best fit */
  bestFit?: boolean;
}

/**
 * Row height entry. Matches Rust `RowHeight` struct (camelCase serde).
 */
export interface RowHeight {
  /** Row index (0-based) */
  row: number;
  /** Height in points */
  height: number;
  /** Whether this is a custom height */
  customHeight?: boolean;
  /** Whether the row is hidden */
  hidden?: boolean;
  /** Style index for the row */
  style?: number;
}

/**
 * Frozen pane configuration.
 */
export interface FrozenPane {
  /** Number of frozen rows */
  rows: number;
  /** Number of frozen columns */
  cols: number;
  /** Top-left cell of the scrollable region */
  topLeftCell: { row: number; col: number };
  /** Active pane */
  activePane?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
  /** Pane state */
  state?: 'frozen' | 'frozenSplit' | 'split';
}

/**
 * Row/column outline group.
 */
export interface OutlineGroup {
  /** Start index */
  start: number;
  /** End index */
  end: number;
  /** Outline level (1-7) */
  level: number;
  /** Whether collapsed */
  collapsed: boolean;
  /** Whether hidden */
  hidden: boolean;
}

// =============================================================================
// Conditional Formatting Types
// =============================================================================

/**
 * Conditional formatting rule set.
 */
export interface ConditionalFormat {
  /** Cell ranges (space-separated A1 references) */
  sqref: string;
  /** Is this for a pivot table */
  pivot?: boolean;
  /** Rules in priority order */
  rules: CfRule[];
}

/**
 * Single conditional formatting rule.
 */
export interface CfRule {
  /** Rule type */
  type: CfRuleType;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Differential format ID for styling */
  dxfId?: number;
  /** Stop evaluating lower priority rules if this matches */
  stopIfTrue?: boolean;
  /** Operator for cellIs type */
  operator?: CfOperator;
  /** Text for text-based rules */
  text?: string;
  /** Time period for date rules */
  timePeriod?: CfTimePeriod;
  /** Rank for top10 rules */
  rank?: number;
  /** Use percentage for top10 */
  percent?: boolean;
  /** Bottom instead of top */
  bottom?: boolean;
  /** Above average flag */
  aboveAverage?: boolean;
  /** Standard deviation multiplier */
  stdDev?: number;
  /** Include equal to average */
  equalAverage?: boolean;
  /** Formula(s) for the rule */
  formulas?: string[];
  /** Color scale configuration */
  colorScale?: ColorScale;
  /** Data bar configuration */
  dataBar?: DataBar;
  /** Icon set configuration */
  iconSet?: IconSet;
}

/**
 * Conditional formatting rule type.
 */
export type CfRuleType =
  | 'expression'
  | 'cellIs'
  | 'colorScale'
  | 'dataBar'
  | 'iconSet'
  | 'top10'
  | 'uniqueValues'
  | 'duplicateValues'
  | 'containsText'
  | 'notContainsText'
  | 'beginsWith'
  | 'endsWith'
  | 'containsBlanks'
  | 'notContainsBlanks'
  | 'containsErrors'
  | 'notContainsErrors'
  | 'timePeriod'
  | 'aboveAverage';

/**
 * Conditional formatting operator.
 */
export type CfOperator =
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'equal'
  | 'notEqual'
  | 'greaterThanOrEqual'
  | 'greaterThan'
  | 'between'
  | 'notBetween'
  | 'containsText'
  | 'notContains'
  | 'beginsWith'
  | 'endsWith';

/**
 * Time period for date-based CF.
 */
export type CfTimePeriod =
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'last7Days'
  | 'thisMonth'
  | 'lastMonth'
  | 'nextMonth'
  | 'thisWeek'
  | 'lastWeek'
  | 'nextWeek';

/**
 * Color scale definition.
 */
export interface ColorScale {
  /** Value thresholds (2 or 3) */
  cfvo: Cfvo[];
  /** Colors (2 or 3) */
  colors: ParsedColor[];
}

/**
 * Conditional format value object.
 */
export interface Cfvo {
  /** Value type */
  type: CfvoType;
  /** Value or formula */
  val?: string;
  /** Greater than or equal */
  gte?: boolean;
}

/**
 * CFVO type.
 */
export type CfvoType =
  | 'num'
  | 'percent'
  | 'max'
  | 'min'
  | 'formula'
  | 'percentile'
  | 'autoMin'
  | 'autoMax';

/**
 * Data bar configuration.
 */
export interface DataBar {
  /** Minimum bar length percentage */
  minLength?: number;
  /** Maximum bar length percentage */
  maxLength?: number;
  /** Show cell value */
  showValue?: boolean;
  /** Value thresholds */
  cfvo: [Cfvo, Cfvo];
  /** Bar color */
  color: ParsedColor;
  /** Use gradient fill */
  gradient?: boolean;
  /** Bar direction */
  direction?: 'leftToRight' | 'rightToLeft' | 'context';
  /** Axis position */
  axisPosition?: 'automatic' | 'middle' | 'none';
  /** Axis color */
  axisColor?: ParsedColor;
  /** Border color */
  borderColor?: ParsedColor;
  /** Negative fill color */
  negativeFillColor?: ParsedColor;
  /** Negative border color */
  negativeBorderColor?: ParsedColor;
}

/**
 * Icon set configuration.
 */
export interface IconSet {
  /** Icon set type */
  iconSet?: IconSetType;
  /** Show cell value */
  showValue?: boolean;
  /** Values are percentages */
  percent?: boolean;
  /** Reverse icon order */
  reverse?: boolean;
  /** Value thresholds */
  cfvo: Cfvo[];
  /** Use custom icons */
  custom?: boolean;
  /** Custom icon selection */
  cfIcon?: CfIcon[];
}

/**
 * Icon set type.
 */
export type IconSetType =
  | '3Arrows'
  | '3ArrowsGray'
  | '3Flags'
  | '3TrafficLights1'
  | '3TrafficLights2'
  | '3Signs'
  | '3Symbols'
  | '3Symbols2'
  | '4Arrows'
  | '4ArrowsGray'
  | '4RedToBlack'
  | '4Rating'
  | '4TrafficLights'
  | '5Arrows'
  | '5ArrowsGray'
  | '5Rating'
  | '5Quarters'
  | '3Stars'
  | '3Triangles'
  | '5Boxes'
  | 'NoIcons';

/**
 * Custom icon reference.
 */
export interface CfIcon {
  /** Icon set to get icon from */
  iconSet: IconSetType;
  /** Icon index within the set */
  iconId: number;
}

// =============================================================================
// Data Validation Types
// =============================================================================

/**
 * Data validation rule.
 */
export interface DataValidation {
  /** Cell ranges */
  sqref: string;
  /** Validation type */
  type?: DataValidationType;
  /** Operator */
  operator?: DataValidationOperator;
  /** First formula/value */
  formula1?: string;
  /** Second formula (for between/notBetween) */
  formula2?: string;
  /** Allow blank cells */
  allowBlank?: boolean;
  /** Show dropdown (confusingly, false means show) */
  showDropDown?: boolean;
  /** Show input message */
  showInputMessage?: boolean;
  /** Input message title */
  promptTitle?: string;
  /** Input message text */
  prompt?: string;
  /** Show error message */
  showErrorMessage?: boolean;
  /** Error style */
  errorStyle?: DataValidationErrorStyle;
  /** Error title */
  errorTitle?: string;
  /** Error message */
  error?: string;
  /** IME mode */
  imeMode?: DataValidationImeMode;
}

/**
 * Data validation type.
 */
export type DataValidationType =
  | 'none'
  | 'whole'
  | 'decimal'
  | 'list'
  | 'date'
  | 'time'
  | 'textLength'
  | 'custom';

/**
 * Data validation operator.
 */
export type DataValidationOperator =
  | 'between'
  | 'notBetween'
  | 'equal'
  | 'notEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual';

/**
 * Data validation error style.
 */
export type DataValidationErrorStyle = 'stop' | 'warning' | 'information';

/**
 * Data validation IME mode.
 */
export type DataValidationImeMode =
  | 'noControl'
  | 'off'
  | 'on'
  | 'disabled'
  | 'hiragana'
  | 'fullKatakana'
  | 'halfKatakana'
  | 'fullAlpha'
  | 'halfAlpha'
  | 'fullHangul'
  | 'halfHangul';

// =============================================================================
// Table Types
// =============================================================================

/**
 * Excel table (ListObject).
 */
export interface Table {
  /** Table ID */
  id: number;
  /** Cell range reference */
  ref: string;
  /** Display name */
  displayName: string;
  /** Internal name */
  name?: string;
  /** Comment */
  comment?: string;
  /** Table type */
  tableType?: TableType;
  /** Header row count (default 1) */
  headerRowCount?: number;
  /** Totals row count (default 0) */
  totalsRowCount?: number;
  /** Show totals row */
  totalsRowShown?: boolean;
  /** Table columns */
  columns: TableColumn[];
  /** Auto filter */
  autoFilter?: AutoFilter;
  /** Sort state */
  sortState?: SortState;
  /** Style info */
  styleInfo?: TableStyleInfo;
  /** Parsed range */
  range: CellRange;
}

/**
 * Table type.
 */
export type TableType = 'worksheet' | 'xml' | 'queryTable';

/**
 * Table column.
 */
export interface TableColumn {
  /** Column ID */
  id: number;
  /** Unique name */
  uniqueName?: string;
  /** Display name */
  name: string;
  /** Totals row function */
  totalsRowFunction?: TotalsRowFunction;
  /** Totals row label */
  totalsRowLabel?: string;
  /** Totals row formula */
  totalsRowFormula?: string;
  /** Calculated column formula */
  calculatedColumnFormula?: string;
  /** Header row DXF ID */
  headerRowDxfId?: number;
  /** Data DXF ID */
  dataDxfId?: number;
  /** Totals row DXF ID */
  totalsRowDxfId?: number;
}

/**
 * Totals row function.
 */
export type TotalsRowFunction =
  | 'none'
  | 'sum'
  | 'min'
  | 'max'
  | 'average'
  | 'count'
  | 'countNums'
  | 'stdDev'
  | 'var'
  | 'custom';

/**
 * Table style info.
 */
export interface TableStyleInfo {
  /** Style name */
  name?: string;
  /** Show first column formatting */
  showFirstColumn?: boolean;
  /** Show last column formatting */
  showLastColumn?: boolean;
  /** Show row stripes */
  showRowStripes?: boolean;
  /** Show column stripes */
  showColumnStripes?: boolean;
}

/**
 * Auto filter configuration.
 */
export interface AutoFilter {
  /** Range reference */
  ref: string;
  /** Filter columns */
  filterColumns?: FilterColumn[];
  /** Sort state */
  sortState?: SortState;
}

/**
 * Filter column.
 */
export interface FilterColumn {
  /** Column ID */
  colId: number;
  /** Hide filter button */
  hiddenButton?: boolean;
  /** Show filter button */
  showButton?: boolean;
  /** Value filters */
  filters?: {
    blank?: boolean;
    values: string[];
    calendarType?: string;
    dateGroupItems?: Array<{
      year: number;
      month?: number;
      day?: number;
      hour?: number;
      minute?: number;
      second?: number;
      dateTimeGrouping: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';
    }>;
  };
  /** Top 10 filter */
  top10?: {
    top?: boolean;
    percent?: boolean;
    val: number;
    filterVal?: number;
  };
  /** Custom filters */
  customFilters?: {
    and?: boolean;
    filters: Array<{
      operator?: string;
      val?: string;
    }>;
  };
  /** Dynamic filter */
  dynamicFilter?: {
    type: string;
    val?: number;
    maxVal?: number;
    valIso?: string;
    maxValIso?: string;
  };
  /** Color filter */
  colorFilter?: {
    dxfId?: number;
    cellColor?: boolean;
  };
  /** Icon filter */
  iconFilter?: {
    iconSet?: string;
    iconId?: number;
  };
}

/**
 * Sort state.
 */
export interface SortState {
  /** Sort by columns (vs rows) */
  columnSort?: boolean;
  /** Case sensitive */
  caseSensitive?: boolean;
  /** Sort method */
  sortMethod?: 'stroke' | 'pinYin' | 'none';
  /** Range reference */
  ref: string;
  /** Sort conditions */
  sortConditions: SortCondition[];
}

/**
 * Sort condition.
 */
export interface SortCondition {
  /** Descending order */
  descending?: boolean;
  /** Sort by type */
  sortBy?: 'value' | 'cellColor' | 'fontColor' | 'icon';
  /** Range reference */
  ref: string;
  /** Custom list */
  customList?: string;
  /** DXF ID for color sort */
  dxfId?: number;
  /** Icon set for icon sort */
  iconSet?: string;
  /** Icon ID for icon sort */
  iconId?: number;
}

// =============================================================================
// Sparkline Types
// =============================================================================

/**
 * Sparkline group.
 */
export interface SparklineGroup {
  /** Sparkline type */
  type: 'line' | 'column' | 'stacked';
  /** Data source range */
  dataRange: string;
  /** Location range */
  locationRange: string;
  /** Individual sparklines */
  sparklines: Sparkline[];
  /** Axis color */
  axisColor?: ParsedColor;
  /** First point color */
  firstColor?: ParsedColor;
  /** Last point color */
  lastColor?: ParsedColor;
  /** High point color */
  highColor?: ParsedColor;
  /** Low point color */
  lowColor?: ParsedColor;
  /** Negative point color */
  negativeColor?: ParsedColor;
  /** Marker color */
  markerColor?: ParsedColor;
  /** Series color */
  seriesColor?: ParsedColor;
  /** Line weight */
  lineWeight?: number;
  /** Show markers */
  markers?: boolean;
  /** Show high point */
  high?: boolean;
  /** Show low point */
  low?: boolean;
  /** Show first point */
  first?: boolean;
  /** Show last point */
  last?: boolean;
  /** Show negative points */
  negative?: boolean;
  /** Display empty cells as */
  displayEmptyCellsAs?: 'gap' | 'zero' | 'span';
  /** Display hidden */
  displayHidden?: boolean;
  /** Right to left */
  rightToLeft?: boolean;
  /** Min axis type */
  minAxisType?: 'individual' | 'group' | 'custom';
  /** Max axis type */
  maxAxisType?: 'individual' | 'group' | 'custom';
  /** Manual min */
  manualMin?: number;
  /** Manual max */
  manualMax?: number;
}

/**
 * Individual sparkline.
 */
export interface Sparkline {
  /** Data range */
  dataRange: string;
  /** Cell location */
  location: string;
}

// =============================================================================
// Comment Types
// =============================================================================

/**
 * Cell comment.
 */
export interface Comment {
  /** Cell reference */
  ref: string;
  /** Author ID */
  authorId: number;
  /** Author name */
  authorName?: string;
  /** Comment text (plain or rich) */
  text: string | RichTextEntry;
  /** Is threaded comment */
  isThreaded?: boolean;
  /** Comment GUID */
  guid?: string;
  /** Timestamp */
  timestamp?: string;
}

// =============================================================================
// Hyperlink Types
// =============================================================================

/**
 * Cell hyperlink.
 */
export interface Hyperlink {
  /** Cell reference */
  ref: string;
  /** Target URL/path */
  target?: string;
  /** Internal location (sheet reference) */
  location?: string;
  /** Display text */
  display?: string;
  /** Tooltip text */
  tooltip?: string;
}

// =============================================================================
// Print Settings Types
// =============================================================================

/**
 * Print settings.
 */
export interface PrintSettings {
  /** Paper size */
  paperSize?: number;
  /** Custom paper width */
  paperWidth?: string;
  /** Custom paper height */
  paperHeight?: string;
  /** Orientation */
  orientation?: 'portrait' | 'landscape';
  /** Scale percentage */
  scale?: number;
  /** Fit to width pages */
  fitToWidth?: number;
  /** Fit to height pages */
  fitToHeight?: number;
  /** Print area */
  printArea?: string;
  /** Print titles (rows to repeat) */
  printTitleRows?: string;
  /** Print titles (cols to repeat) */
  printTitleCols?: string;
  /** Page margins */
  margins?: PageMargins;
  /** Header/footer */
  headerFooter?: HeaderFooter;
  /** Print gridlines */
  gridLines?: boolean;
  /** Gridlines set flag */
  gridLinesSet?: boolean;
  /** Print headings */
  headings?: boolean;
  /** Center horizontally on page */
  horizontalCentered?: boolean;
  /** Center vertically on page */
  verticalCentered?: boolean;
  /** Black and white */
  blackAndWhite?: boolean;
  /** Draft quality */
  draft?: boolean;
  /** First page number */
  firstPageNumber?: number;
  /** Horizontal DPI */
  horizontalDpi?: number;
  /** Vertical DPI */
  verticalDpi?: number;
  /** Number of copies */
  copies?: number;
  /** Page setup properties */
  pageSetupProperties?: PageSetupProperties;
}

export interface PageSetupProperties {
  /** Fit to page */
  fitToPage: boolean;
  /** Automatic page breaks */
  autoPageBreaks: boolean;
}

/**
 * Page margins.
 */
export interface PageMargins {
  /** Left margin */
  left: number;
  /** Right margin */
  right: number;
  /** Top margin */
  top: number;
  /** Bottom margin */
  bottom: number;
  /** Header margin */
  header: number;
  /** Footer margin */
  footer: number;
}

/**
 * Header and footer.
 */
export interface HeaderFooter {
  /** Different odd/even pages */
  differentOddEven?: boolean;
  /** Different first page */
  differentFirst?: boolean;
  /** Scale with document */
  scaleWithDoc?: boolean;
  /** Align with margins */
  alignWithMargins?: boolean;
  /** Odd page header */
  oddHeader?: string;
  /** Odd page footer */
  oddFooter?: string;
  /** Even page header */
  evenHeader?: string;
  /** Even page footer */
  evenFooter?: string;
  /** First page header */
  firstHeader?: string;
  /** First page footer */
  firstFooter?: string;
}

/**
 * Page breaks.
 */
export interface PageBreaks {
  /** Row page breaks */
  rowBreaks: PageBreak[];
  /** Column page breaks */
  colBreaks: PageBreak[];
}

/**
 * Single page break.
 */
export interface PageBreak {
  /** Break position */
  id: number;
  /** Manual break */
  man: boolean;
  /** Max extent */
  max?: number;
  /** Min extent */
  min?: number;
}

// =============================================================================
// Sheet Protection Types
// =============================================================================

/**
 * Sheet protection settings.
 */
export interface SheetProtection {
  /** Password hash */
  passwordHash?: string;
  /** Algorithm name */
  algorithmName?: string;
  /** Hash value */
  hashValue?: string;
  /** Salt value */
  saltValue?: string;
  /** Spin count */
  spinCount?: number;
  /** Sheet protected */
  sheet?: boolean;
  /** Objects protected */
  objects?: boolean;
  /** Scenarios protected */
  scenarios?: boolean;
  /** Format cells allowed */
  formatCells?: boolean;
  /** Format columns allowed */
  formatColumns?: boolean;
  /** Format rows allowed */
  formatRows?: boolean;
  /** Insert columns allowed */
  insertColumns?: boolean;
  /** Insert rows allowed */
  insertRows?: boolean;
  /** Insert hyperlinks allowed */
  insertHyperlinks?: boolean;
  /** Delete columns allowed */
  deleteColumns?: boolean;
  /** Delete rows allowed */
  deleteRows?: boolean;
  /** Select locked cells allowed */
  selectLockedCells?: boolean;
  /** Sort allowed */
  sort?: boolean;
  /** Auto filter allowed */
  autoFilter?: boolean;
  /** Pivot tables allowed */
  pivotTables?: boolean;
  /** Select unlocked cells allowed */
  selectUnlockedCells?: boolean;
}

/**
 * Sheet view options.
 */
export interface SheetViewOptions {
  /** Show gridlines */
  showGridLines?: boolean;
  /** Show row/column headers */
  showRowColHeaders?: boolean;
  /** Show zeros */
  showZeros?: boolean;
  /** Show formulas */
  showFormulas?: boolean;
  /** Show outline symbols */
  showOutlineSymbols?: boolean;
  /** Right to left */
  rightToLeft?: boolean;
  /** Zoom scale */
  zoomScale?: number;
  /** Zoom scale for normal view */
  zoomScaleNormal?: number;
  /** Zoom scale for page break preview */
  zoomScalePageBreakPreview?: number;
  /** Zoom scale for page layout */
  zoomScalePageLayout?: number;
  /** View type */
  view?: 'normal' | 'pageBreakPreview' | 'pageLayout';
  /** Tab selected */
  tabSelected?: boolean;
  /** Window protection */
  windowProtection?: boolean;
}

// =============================================================================
// Styles Types
// =============================================================================

/**
 * Complete parsed stylesheet.
 */
export interface ParsedStyles {
  /** Number formats */
  numberFormats: NumberFormat[];
  /** Fonts */
  fonts: ParsedFont[];
  /** Fills */
  fills: ParsedFill[];
  /** Borders */
  borders: ParsedBorder[];
  /** Cell style XFs */
  cellStyleXfs: CellXf[];
  /** Cell XFs */
  cellXfs: CellXf[];
  /** Named cell styles */
  cellStyles: NamedCellStyle[];
}

/**
 * Number format.
 */
export interface NumberFormat {
  /** Format ID */
  id: number;
  /** Format code string */
  formatCode: string;
}

/**
 * Parsed font.
 */
export interface ParsedFont {
  /** Font name */
  name?: string;
  /** Font size */
  size?: number;
  /** Bold */
  bold?: boolean;
  /** Italic */
  italic?: boolean;
  /** Underline style */
  underline?: FontUnderline;
  /** Strikethrough */
  strikethrough?: boolean;
  /** Font color */
  color?: ParsedColor;
  /** Font family number */
  family?: number;
  /** Character set */
  charset?: number;
  /** Font scheme */
  scheme?: 'major' | 'minor' | 'none';
  /** Vertical alignment */
  vertAlign?: 'superscript' | 'subscript';
  /** Outline */
  outline?: boolean;
  /** Shadow */
  shadow?: boolean;
  /** Condense */
  condense?: boolean;
  /** Extend */
  extend?: boolean;
}

/**
 * Font underline style.
 */
export type FontUnderline = 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';

/**
 * Parsed fill.
 */
export interface ParsedFill {
  /** Fill type */
  type: 'pattern' | 'gradient';
  /** Pattern type */
  patternType?: PatternType;
  /** Foreground color */
  fgColor?: ParsedColor;
  /** Background color */
  bgColor?: ParsedColor;
  /** Gradient fill */
  gradient?: GradientFill;
}

/**
 * Pattern type.
 */
export type PatternType =
  | 'none'
  | 'solid'
  | 'mediumGray'
  | 'darkGray'
  | 'lightGray'
  | 'darkHorizontal'
  | 'darkVertical'
  | 'darkDown'
  | 'darkUp'
  | 'darkGrid'
  | 'darkTrellis'
  | 'lightHorizontal'
  | 'lightVertical'
  | 'lightDown'
  | 'lightUp'
  | 'lightGrid'
  | 'lightTrellis'
  | 'gray125'
  | 'gray0625';

/**
 * Gradient fill.
 */
export interface GradientFill {
  /** Gradient type */
  type: 'linear' | 'path';
  /** Rotation degree */
  degree?: number;
  /** Left position */
  left?: number;
  /** Right position */
  right?: number;
  /** Top position */
  top?: number;
  /** Bottom position */
  bottom?: number;
  /** Gradient stops */
  stops: GradientStop[];
}

/** GradientStop — XLSX bridge layer. Maps to CT_GradientStop (dml-main.xsd:1539) with resolved color string. */
export interface GradientStop {
  /** Position (0-1) */
  position: number;
  /** Color */
  color: ParsedColor;
}

/**
 * Parsed color.
 */
export interface ParsedColor {
  /** Color type */
  type: 'rgb' | 'theme' | 'indexed' | 'auto';
  /** RGB value (ARGB hex) */
  rgb?: string;
  /** Theme color index */
  theme?: number;
  /** Tint adjustment (-1 to 1) */
  tint?: number;
  /** Indexed color value */
  indexed?: number;
  /** Auto color */
  auto?: boolean;
}

/**
 * Parsed border.
 */
export interface ParsedBorder {
  /** Left border */
  left?: BorderSide;
  /** Right border */
  right?: BorderSide;
  /** Top border */
  top?: BorderSide;
  /** Bottom border */
  bottom?: BorderSide;
  /** Diagonal border */
  diagonal?: BorderSide;
  /** Diagonal up */
  diagonalUp?: boolean;
  /** Diagonal down */
  diagonalDown?: boolean;
}

/**
 * Border side.
 */
export interface BorderSide {
  /** Border style */
  style?: BorderStyle;
  /** Border color */
  color?: ParsedColor;
}

/**
 * Border style.
 */
export type BorderStyle =
  | 'none'
  | 'thin'
  | 'medium'
  | 'thick'
  | 'double'
  | 'hair'
  | 'dotted'
  | 'dashed'
  | 'mediumDashed'
  | 'dashDot'
  | 'mediumDashDot'
  | 'dashDotDot'
  | 'mediumDashDotDot'
  | 'slantDashDot';

/**
 * Cell XF (formatting record).
 */
export interface CellXf {
  /** Number format ID */
  numFmtId: number;
  /** Font ID */
  fontId: number;
  /** Fill ID */
  fillId: number;
  /** Border ID */
  borderId: number;
  /** XF ID (for cell XFs) */
  xfId?: number;
  /** Alignment */
  alignment?: CellAlignment;
  /** Protection */
  protection?: CellProtection;
  /** Apply number format */
  applyNumberFormat?: boolean;
  /** Apply font */
  applyFont?: boolean;
  /** Apply fill */
  applyFill?: boolean;
  /** Apply border */
  applyBorder?: boolean;
  /** Apply alignment */
  applyAlignment?: boolean;
  /** Apply protection */
  applyProtection?: boolean;
  /** Quote prefix */
  quotePrefix?: boolean;
  /** Pivot button */
  pivotButton?: boolean;
}

/**
 * Cell alignment.
 */
export interface CellAlignment {
  /** Horizontal alignment */
  horizontal?:
    | 'general'
    | 'left'
    | 'center'
    | 'right'
    | 'fill'
    | 'justify'
    | 'centerContinuous'
    | 'distributed';
  /** Vertical alignment */
  vertical?: 'top' | 'center' | 'bottom' | 'justify' | 'distributed';
  /** Text rotation (degrees) */
  textRotation?: number;
  /** Wrap text */
  wrapText?: boolean;
  /** Shrink to fit */
  shrinkToFit?: boolean;
  /** Indent level */
  indent?: number;
  /** Reading order */
  readingOrder?: number;
  /** Relative indent */
  relativeIndent?: number;
  /** Justify last line */
  justifyLastLine?: boolean;
}

/**
 * Cell protection.
 */
export interface CellProtection {
  /** Cell is locked */
  locked?: boolean;
  /** Formula is hidden */
  hidden?: boolean;
}

/**
 * Named cell style.
 */
export interface NamedCellStyle {
  /** Style name */
  name: string;
  /** XF ID */
  xfId: number;
  /** Built-in ID */
  builtinId?: number;
  /** Custom built-in */
  customBuiltin?: boolean;
}

/**
 * Differential format (for CF, tables).
 */
export interface DifferentialFormat {
  /** Font overrides */
  font?: Partial<ParsedFont>;
  /** Fill overrides */
  fill?: Partial<ParsedFill>;
  /** Border overrides */
  border?: Partial<ParsedBorder>;
  /** Number format */
  numFmt?: NumberFormat;
  /** Alignment overrides */
  alignment?: Partial<CellAlignment>;
  /** Protection overrides */
  protection?: Partial<CellProtection>;
}

/**
 * Parsed table style.
 */
export interface ParsedTableStyle {
  /** Style name */
  name: string;
  /** Is pivot style */
  pivot: boolean;
  /** Is table style */
  table: boolean;
  /** Style elements */
  elements: TableStyleElement[];
}

/**
 * Table style element.
 */
export interface TableStyleElement {
  /** Element type */
  type: TableStyleElementType;
  /** DXF ID */
  dxfId: number;
  /** Size (for stripes) */
  size?: number;
}

/**
 * Table style element type.
 */
export type TableStyleElementType =
  | 'wholeTable'
  | 'headerRow'
  | 'totalRow'
  | 'firstColumn'
  | 'lastColumn'
  | 'firstRowStripe'
  | 'secondRowStripe'
  | 'firstColumnStripe'
  | 'secondColumnStripe'
  | 'firstHeaderCell'
  | 'lastHeaderCell'
  | 'firstTotalCell'
  | 'lastTotalCell';

// =============================================================================
// Theme Types
// =============================================================================

/**
 * Parsed theme.
 */
export interface ParsedTheme {
  /** Theme name */
  name: string;
  /** Theme colors */
  colors: ThemeColors;
  /** Theme fonts */
  fonts: ThemeFonts;
  /** Format scheme */
  formatScheme?: ThemeFormatScheme;
}

/**
 * Theme colors.
 */
export interface ThemeColors {
  /** Dark 1 color */
  dk1: string;
  /** Light 1 color */
  lt1: string;
  /** Dark 2 color */
  dk2: string;
  /** Light 2 color */
  lt2: string;
  /** Accent 1 */
  accent1: string;
  /** Accent 2 */
  accent2: string;
  /** Accent 3 */
  accent3: string;
  /** Accent 4 */
  accent4: string;
  /** Accent 5 */
  accent5: string;
  /** Accent 6 */
  accent6: string;
  /** Hyperlink color */
  hlink: string;
  /** Followed hyperlink color */
  folHlink: string;
}

/**
 * Theme fonts.
 */
export interface ThemeFonts {
  /** Major (heading) font - Latin */
  majorLatin: string;
  /** Major font - East Asian */
  majorEastAsian?: string;
  /** Major font - Complex script */
  majorComplexScript?: string;
  /** Minor (body) font - Latin */
  minorLatin: string;
  /** Minor font - East Asian */
  minorEastAsian?: string;
  /** Minor font - Complex script */
  minorComplexScript?: string;
}

/**
 * Theme format scheme.
 */
export interface ThemeFormatScheme {
  /** Scheme name */
  name: string;
  /** Fill styles */
  fillStyleList?: ParsedFill[];
  /** Line styles */
  lineStyleList?: ParsedLineStyle[];
  /** Effect styles */
  effectStyleList?: ThemeEffect[];
  /** Background fill styles */
  bgFillStyleList?: ParsedFill[];
}

/**
 * Parsed line style.
 */
export interface ParsedLineStyle {
  /** Line width */
  width: number;
  /** Compound type */
  compound?: 'single' | 'double' | 'thickThin' | 'thinThick' | 'triple';
  /** Dash style */
  dash?:
    | 'solid'
    | 'dot'
    | 'dash'
    | 'dashDot'
    | 'lgDash'
    | 'lgDashDot'
    | 'lgDashDotDot'
    | 'sysDash'
    | 'sysDot'
    | 'sysDashDot'
    | 'sysDashDotDot';
  /** Line fill */
  fill?: ParsedFill;
}

/**
 * Theme effect.
 */
export interface ThemeEffect {
  /** Raw XML (for preservation) */
  raw?: string;
}

// =============================================================================
// Workbook-Level Types
// =============================================================================

/**
 * Defined name.
 */
export interface DefinedName {
  /** Name */
  name: string;
  /** Reference formula */
  refersTo: string;
  /** Local sheet ID (if scoped to sheet) */
  localSheetId?: number;
  /** Hidden */
  hidden?: boolean;
  /** Comment */
  comment?: string;
  /** Is function */
  function?: boolean;
  /** Is VB procedure */
  vbProcedure?: boolean;
  /** Custom menu text */
  customMenu?: string;
  /** Description */
  description?: string;
  /** Help text */
  help?: string;
  /** Status bar text */
  statusBar?: string;
  /** Is XLM macro */
  xlm?: boolean;
  /** Shortcut key */
  shortcutKey?: string;
  /** Publish to server */
  publishToServer?: boolean;
  /** Is workbook parameter */
  workbookParameter?: boolean;
}

/**
 * Workbook protection.
 */
export interface WorkbookProtection {
  /** Lock structure */
  lockStructure?: boolean;
  /** Lock windows */
  lockWindows?: boolean;
  /** Password hash */
  passwordHash?: string;
  /** Algorithm name */
  algorithmName?: string;
  /** Hash value */
  hashValue?: string;
  /** Salt value */
  saltValue?: string;
  /** Spin count */
  spinCount?: number;
}

/**
 * Workbook metadata.
 */
export interface WorkbookMetadata {
  /** Title */
  title?: string;
  /** Subject */
  subject?: string;
  /** Creator/Author */
  creator?: string;
  /** Last modified by */
  lastModifiedBy?: string;
  /** Created date (ISO) */
  created?: string;
  /** Modified date (ISO) */
  modified?: string;
  /** Application name */
  application?: string;
  /** Application version */
  appVersion?: string;
  /** Description */
  description?: string;
  /** Keywords */
  keywords?: string[];
  /** Category */
  category?: string;
  /** Company */
  company?: string;
}

/**
 * @deprecated Legacy calculation-chain DTO. Production parsing does not expose
 * calc-chain dependency semantics and `FullParseResult.calcChain` is always empty.
 */
export interface CalcChainEntry {
  /** Cell reference */
  cellRef: string;
  /** Sheet ID */
  sheetId: number;
  /** Is array formula */
  isArray?: boolean;
  /** New calculation level */
  newLevel?: boolean;
  /** New thread */
  newThread?: boolean;
}

/**
 * Custom property.
 */
export interface CustomProperty {
  /** Property name */
  name: string;
  /** Property value */
  value: string | number | boolean | Date;
  /** Value type */
  type: 'string' | 'number' | 'boolean' | 'date';
}

/**
 * VBA project info.
 */
export interface VbaProjectInfo {
  /** Is signed */
  isSigned: boolean;
  /** Project name */
  name?: string;
  /** Module names */
  modules: string[];
  /** Is protected */
  isProtected: boolean;
  /** Signature valid */
  signatureValid?: boolean;
}

// =============================================================================
// Chart Types (from Rust ChartSpec in domain-types)
// =============================================================================

/**
 * Chart specification from the Rust parser (domain-types ChartSpec).
 * Full-fidelity: captures chart type, position, size, and the complete
 * chart definition as an opaque JSON blob.
 */
export interface ChartSpec {
  chartType: string;
  title?: string;
  position: AnchorPosition;
  size: ObjectSize;
  zIndex: number;
  definition: ChartDefinition;
  importStatus?: ImportObjectStatus;
}

export interface ImportObjectStatus {
  source: 'xlsx' | 'csv' | 'native' | 'unknown';
  featureKind: string;
  recoverability:
    | 'fullySupported'
    | 'repaired'
    | 'partiallySupported'
    | 'preservedNotRenderable'
    | 'preservedNotEditable'
    | 'unsupportedPreserved'
    | 'unsupportedDropped'
    | 'malformedDropped'
    | 'securityDisabled';
  renderability: 'renderable' | 'placeholder' | 'notRenderable';
  editability: 'editable' | 'partiallyEditable' | 'notEditable';
  diagnostics?: ImportDiagnosticRef[];
  reference?: ImportDiagnosticRef;
}

export interface ImportDiagnosticRef {
  id?: string;
  part?: string;
  relationshipId?: string;
  relationshipTarget?: string;
  sheetIndex?: number;
  sheetName?: string;
  row?: number;
  col?: number;
  cellRef?: string;
  sourceRange?: string;
  featureKind?: string;
  objectId?: string;
  objectName?: string;
  relatedParts?: string[];
}

/**
 * Two-cell anchor position for a drawing object.
 * Matches Rust AnchorPosition from domain-types.
 */
export interface AnchorPosition {
  anchorRow: number;
  anchorCol: number;
  anchorRowOffset: number;
  anchorColOffset: number;
  endRow?: number;
  endCol?: number;
  endRowOffset?: number;
  endColOffset?: number;
}

/**
 * Object size (width x height in EMU-derived units).
 * Matches Rust ObjectSize from domain-types.
 */
export interface ObjectSize {
  width: number;
  height: number;
}

/**
 * Opaque chart definition payload (serde_json::Value).
 * The full OOXML chart model serialized as a JSON value.
 */
export type ChartDefinition = unknown;

// =============================================================================
// SmartArt Types
// =============================================================================

/**
 * Raw XML parts for a single SmartArt diagram.
 *
 * Each field contains the raw XML content of the corresponding OOXML diagram part.
 * The TypeScript rendering pipeline parses these XML blobs to build the SmartArt model.
 */
export interface SmartArtPartsOutput {
  /** Index of the graphicFrame anchor in the drawing (for position correlation) */
  anchorIndex: number;
  /** `xl/diagrams/data{N}.xml` -- dataModel (node tree, text, connections) */
  dataXml?: string;
  /** `xl/diagrams/layout{N}.xml` -- layoutDef (layout algorithm definition) */
  layoutXml?: string;
  /** `xl/diagrams/colors{N}.xml` -- colorsDef (color transform) */
  colorsXml?: string;
  /** `xl/diagrams/quickStyles{N}.xml` -- styleDef (style definition) */
  styleXml?: string;
  /** `xl/diagrams/drawing{N}.xml` -- drawing cache (pre-rendered, MS extension) */
  drawingXml?: string;
}

// =============================================================================
// Slicer Types
// =============================================================================

/**
 * A single slicer definition (CT_Slicer from x14 namespace).
 *
 * Parsed from `<x14:slicer>` elements inside `xl/slicers/slicer{N}.xml`.
 * Matches Rust `SlicerDef` with `#[serde(rename_all = "camelCase")]`.
 */
export interface SlicerDef {
  /** Slicer name (unique identifier within the workbook) */
  name: string;
  /** Name of the associated slicer cache */
  cache: string;
  /** Display caption (defaults to name if absent) */
  caption?: string;
  /** Index of the first visible item (0-based) */
  startItem?: number;
  /** Number of columns in the slicer (default: 1) */
  columnCount: number;
  /** Whether to show the caption header (default: true) */
  showCaption: boolean;
  /** Hierarchy level for OLAP slicers (default: 0) */
  level: number;
  /** Slicer style name (e.g., "SlicerStyleLight1") */
  style?: string;
  /** Whether the slicer position is locked (default: false) */
  lockedPosition: boolean;
  /** Row height in EMUs (optional) */
  rowHeight?: number;
  /** Extension list (opaque XML passthrough) */
  extLst?: string;
}

/**
 * Slicer cache definition (CT_SlicerCacheDefinition from x14 namespace).
 *
 * Parsed from `xl/slicerCaches/slicerCache{N}.xml`.
 * Matches Rust `SlicerCacheDef` with `#[serde(rename_all = "camelCase")]`.
 */
export interface SlicerCacheDef {
  /** Cache name (unique identifier) */
  name: string;
  /** Optional UID (from xr10:uid attribute) */
  uid?: string;
  /** Source column/field name */
  sourceName: string;
  /** Associated pivot tables (for pivot-backed slicers) */
  pivotTables: SlicerPivotTableRef[];
  /** Tabular data for pivot-backed non-OLAP slicers */
  tabularData?: SlicerTabularData;
  /** Table slicer cache (for table-backed slicers, from x15 extension) */
  tableSlicerCache?: TableSlicerCache;
  /** Extension list (opaque XML passthrough) */
  extLst?: string;
}

/**
 * Reference to a pivot table associated with a slicer cache.
 * Matches Rust `SlicerPivotTableRef` with `#[serde(rename_all = "camelCase")]`.
 */
export interface SlicerPivotTableRef {
  /** Tab (sheet) ID */
  tabId: number;
  /** Pivot table name */
  name: string;
}

/**
 * Tabular slicer cache data for pivot-backed non-OLAP slicers.
 * Matches Rust `SlicerTabularData` with `#[serde(rename_all = "camelCase")]`.
 */
export interface SlicerTabularData {
  /** Pivot cache ID */
  pivotCacheId: number;
  /** Sort order for slicer items */
  sortOrder: SlicerSortOrder;
  /** Whether to use custom list sorting (default: false) */
  customListSort: boolean;
  /** Whether to show items with no data (default: false) */
  showMissing: boolean;
  /** Cross-filter behavior */
  crossFilter: SlicerCrossFilter;
  /** Slicer items (references into the pivot cache) */
  items: SlicerTabularItem[];
  /** Extension list (opaque XML passthrough) */
  extLst?: string;
}

/**
 * A single item in a tabular slicer cache.
 * Matches Rust `SlicerTabularItem` with `#[serde(rename_all = "camelCase")]`.
 */
export interface SlicerTabularItem {
  /** Index into pivot cache shared items */
  x: number;
  /** Whether the item is selected (default: false) */
  s: boolean;
  /** Whether the item has no data (default: false) */
  nd: boolean;
}

/**
 * Table slicer cache definition (CT_TableSlicerCache from x15 namespace).
 * Matches Rust `TableSlicerCache` with `#[serde(rename_all = "camelCase")]`.
 */
export interface TableSlicerCache {
  /** Table ID */
  tableId: number;
  /** Column index within the table */
  column: number;
  /** Sort order for slicer items */
  sortOrder: SlicerSortOrder;
  /** Whether to use custom list sorting (default: false) */
  customListSort: boolean;
  /** Cross-filter behavior */
  crossFilter: SlicerCrossFilter;
  /** Extension list (opaque XML passthrough) */
  extLst?: string;
}

/**
 * Sort order for slicer items.
 * Matches Rust `SlicerSortOrder` with `#[serde(rename_all = "camelCase")]`.
 */
export type SlicerSortOrder = 'ascending' | 'descending';

/**
 * Cross-filter behavior for slicers.
 * Matches Rust `SlicerCrossFilter` with `#[serde(rename_all = "camelCase")]`.
 */
export type SlicerCrossFilter = 'none' | 'showItemsWithDataAtTop' | 'showItemsWithNoData';

/**
 * Cell anchor position with EMU offset.
 * Matches Rust `CellAnchor` from ooxml-types (no rename_all, so fields are snake_case).
 */
export interface SlicerCellAnchor {
  /** Zero-based column index */
  col: number;
  /** Column offset in EMUs */
  col_off: number;
  /** Zero-based row index */
  row: number;
  /** Row offset in EMUs */
  row_off: number;
}

/**
 * Slicer anchor — position of a slicer in the drawing layer.
 * Matches Rust `SlicerAnchor` with `#[serde(rename_all = "camelCase")]`.
 */
export interface SlicerAnchor {
  /** Slicer name (links back to SlicerDef.name) */
  slicerName: string;
  /** Top-left anchor position */
  from: SlicerCellAnchor;
  /** Bottom-right anchor position */
  to: SlicerCellAnchor;
}

/**
 * Parse error detail (for non-fatal errors).
 */
export interface ParseErrorDetail {
  /** Error code */
  code: ParseErrorDetailCode;
  /** Severity level */
  severity: ParseErrorSeverity;
  /** Error location */
  location: ErrorLocation;
  /** Error message */
  message: string;
  /** Raw XML (for debugging) */
  rawXml?: string;
  /** Fallback value used */
  fallback?: string;
}

/**
 * Parse error code.
 */
export type ParseErrorDetailCode =
  // XML Errors
  | 'MALFORMED_XML'
  | 'INVALID_XML_STRUCTURE'
  | 'UNEXPECTED_ELEMENT'
  | 'MISSING_REQUIRED_ATTRIBUTE'
  // Reference Errors
  | 'INVALID_CELL_REF'
  | 'INVALID_RANGE_REF'
  | 'INVALID_SHEET_REF'
  | 'CIRCULAR_REFERENCE'
  // Relationship Errors
  | 'MISSING_RELATIONSHIP'
  | 'BROKEN_RELATIONSHIP'
  | 'INVALID_RELATIONSHIP_TARGET'
  // Part Errors
  | 'MISSING_PART'
  | 'CORRUPTED_PART'
  | 'INVALID_CONTENT_TYPE'
  // Data Errors
  | 'INVALID_NUMBER'
  | 'INVALID_DATE'
  | 'INVALID_BOOLEAN'
  | 'CORRUPTED_SHARED_STRING'
  | 'INVALID_FORMULA'
  // Feature Errors
  | 'UNSUPPORTED_FEATURE'
  | 'UNSUPPORTED_CHART_TYPE'
  | 'UNSUPPORTED_FUNCTION'
  // Schema Errors
  | 'SCHEMA_VIOLATION'
  | 'VERSION_MISMATCH'
  // File Errors
  | 'TRUNCATED_FILE'
  | 'INVALID_ZIP'
  | 'DECOMPRESSION_ERROR'
  // Unknown
  | 'UNKNOWN_ERROR';

/**
 * Parse error severity.
 */
export type ParseErrorSeverity = 'warning' | 'error' | 'fatal';

/**
 * Error location.
 */
export interface ErrorLocation {
  /** Part/file path */
  part: string;
  /** XPath-like path */
  path?: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
  /** Cell reference */
  cellRef?: string;
  /** Sheet name */
  sheetName?: string;
}

// =============================================================================
// Stats Types
// =============================================================================

/**
 * Full parsing statistics.
 */
export interface FullParseStats {
  /** Total parse time (ms) */
  totalTimeMs: number;
  /** ZIP extraction time (ms) */
  zipTimeMs: number;
  /** XML parsing time (ms) */
  xmlTimeMs: number;
  /** Style processing time (ms) */
  styleTimeMs: number;
  /** Number of sheets */
  sheetCount: number;
  /** Total cell count */
  cellCount: number;
  /** Formula count */
  formulaCount: number;
  /** Bytes read */
  bytesRead: number;
  /** Peak memory usage (bytes) */
  peakMemoryBytes?: number;
  /** Parts parsed */
  partsParsed: number;
  /** Parts skipped */
  partsSkipped: number;
}

// =============================================================================
// Full Parse Options
// =============================================================================

/**
 * Options for the full parser.
 */
export interface FullParseOptions {
  /**
   * Maximum number of cells to parse.
   * Parsing stops after this limit is reached.
   * @default 1_000_000 (1 million cells)
   */
  maxCells?: number;

  /**
   * Maximum bytes to allocate for string data.
   * @default 100_000_000 (100 MB)
   */
  maxStringBytes?: number;

  /**
   * Progress callback invoked periodically during parsing.
   * @param percent - Progress percentage (0-100)
   */
  onProgress?: (percent: number) => void;

  /**
   * Parse mode for error handling.
   * - strict: Fail on any error
   * - lenient: Continue on recoverable errors (default)
   * - permissive: Try to extract as much as possible
   */
  mode?: 'strict' | 'lenient' | 'permissive';

  /** Skip parsing styles (faster but no formatting) */
  skipStyles?: boolean;

  /** Skip parsing charts */
  skipCharts?: boolean;

  /** Skip parsing drawings/images */
  skipDrawings?: boolean;

  /** Skip parsing comments */
  skipComments?: boolean;

  /** Skip parsing data validation */
  skipDataValidation?: boolean;

  /** Skip parsing conditional formatting */
  skipConditionalFormatting?: boolean;

  /** Only parse specific sheets (by name) */
  sheetFilter?: string[];

  /** Parse cell values only (no formulas, styles) */
  valuesOnly?: boolean;
}
