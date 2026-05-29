/**
 * Core spreadsheet contracts - shared types used across all packages
 */

// =============================================================================
// Spreadsheet Limits
// =============================================================================

/** Maximum rows in a sheet (Excel limit: 1,048,576) */
export const MAX_ROWS = 1_048_576;

/** Maximum columns in a sheet (Excel limit: 16,384 = XFD) */
export const MAX_COLS = 16_384;

// =============================================================================
// Cell Value Types
// =============================================================================

import type { FormulaA1 } from './cells/formula-string';
import type { CellId } from './cells/cell-identity';
import type { RichText } from './cells/rich-text';
import { sheetId, type SheetId } from './sheet-id';

/**
 * Primitive cell value types
 */
export type CellValuePrimitive = string | number | boolean | null;

/**
 * Cell value including error types.
 * Used for computed/formula results and API output.
 */
export type CellValue = CellValuePrimitive | CellError;

/**
 * Cell-embedded interactive control (e.g., checkbox).
 *
 * When a cell contains a control, formulas see its `checked` state as
 * TRUE/FALSE. The `type` field discriminates the control kind for future
 * extensibility (toggle, dropdown, etc.).
 */
export interface CellControl {
  /** The kind of control. Currently only 'checkbox' is supported. */
  type: 'checkbox';
  /** Whether the control is in its active state (checkbox: ticked). */
  checked: boolean;
}

/**
 * Raw cell input value types.
 * Includes RichText for formatted literal text input.
 * Formula results are never RichText - use CellValue for those.
 *
 * When converting from CellRawValue to CellValue, use:
 * - `toPlainText()` from './rich-text' if value is RichText
 * - Value as-is if it's a primitive
 */
export type CellRawValue = CellValuePrimitive | RichText;

/**
 * Machine-friendly variant names for Excel error types.
 * Use `errorDisplayString()` to convert to the user-facing display string.
 */
export type ErrorVariant =
  | 'Null'
  | 'Div0'
  | 'Value'
  | 'Ref'
  | 'Name'
  | 'Num'
  | 'Na'
  | 'GettingData'
  | 'Spill'
  | 'Calc'
  | 'Circ';

/**
 * Standard Excel error types
 */
export interface CellError {
  type: 'error';
  value: ErrorVariant;
  message?: string;
}

export { sheetId };
export type { SheetId };

/**
 * Range identifier — branded to prevent accidental interchange with plain strings.
 * Hex-encoded u128, matching the Rust `RangeId` type.
 */
declare const __rangeId: unique symbol;
export type RangeId = string & { readonly [__rangeId]: true };

/** Construct a branded RangeId from a raw string. */
export function rangeId(id: string): RangeId {
  return id as RangeId;
}

/** Semantic role of a range — must match Rust `RangeKind` enum. */
export enum RangeKind {
  Data = 'Data',
  Format = 'Format',
  NamedRange = 'NamedRange',
  CondFormat = 'CondFormat',
  Validation = 'Validation',
  Protection = 'Protection',
  PrintArea = 'PrintArea',
  Table = 'Table',
}

/**
 * Anchor describing which rows/cols a range covers.
 * Externally-tagged union matching the Rust `RangeAnchor` enum
 * (default serde, no tag attribute). Variant names PascalCase,
 * field names camelCase (per-variant rename_all).
 */
export type RangeAnchor =
  | { Elastic: { startRow: string; endRow: string; startCol: string; endCol: string } }
  | { Strict: { rowIds: string[]; colIds: string[] } };

/** Encoding scheme for bulk payload data. Must match Rust `PayloadEncoding`. */
export type PayloadEncoding = 'None' | 'F64Le' | 'I64Le' | 'MixedCbor';

/** Immutable identity domain for compact row/column axis runs. */
export type AxisRunId = number;

/** One compact row/column run span. */
export interface AxisIdentityRunRef {
  runId: AxisRunId;
  startOffset: number;
  len: number;
}

/**
 * Compact-or-explicit reference to row or column identities used by range payloads.
 *
 * Externally-tagged union matching Rust `AxisIdentityRef`.
 */
export type AxisIdentityRef<Id extends string = string> =
  | { StoreRun: AxisIdentityRunRef }
  | { Runs: AxisIdentityRunRef[] }
  | { Explicit: Id[] };

export type RowAxisIdentityRef = AxisIdentityRef<string>;
export type ColAxisIdentityRef = AxisIdentityRef<string>;

/**
 * Cell address reference
 *
 * NOTE: sheetId is REQUIRED to ensure explicit sheet context for all cell references.
 * This enables proper cross-sheet formula handling and dependency tracking.
 * If you need a cell reference without sheet context (within the active sheet),
 * use { row, col } inline or create a local type.
 */
export interface CellAddress {
  row: number; // 0-indexed
  col: number; // 0-indexed
  sheetId: string;
}

/**
 * Cell range reference.
 *
 * This is THE canonical range type for ALL range operations in the spreadsheet.
 * Uses flat format for simplicity and JSON compatibility.
 *
 * Used by: XState machines, canvas coordinates, React hooks, API, events, tables, pivots
 */
export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** True when entire column(s) selected via column header click */
  isFullColumn?: boolean;
  /** True when entire row(s) selected via row header click */
  isFullRow?: boolean;
  sheetId?: string;
}

/**
 * Number format types — defined in Rust, generated into constants.gen.ts.
 */
import type { NumberFormatType } from '@mog/types-culture';
export type { NumberFormatType } from '@mog/types-culture';

// =============================================================================
// Fill Types (Pattern and Gradient)
// =============================================================================

/**
 * Spreadsheet pattern fill types.
 *
 * XLSX supports 18 pattern types for cell backgrounds. These patterns
 * combine a foreground color (the pattern) with a background color.
 *
 * Pattern visualization (8x8 pixels):
 * - none: No fill (transparent)
 * - solid: Solid fill (fgColor only)
 * - darkGray/mediumGray/lightGray/gray125/gray0625: Dot density patterns
 * - darkHorizontal/lightHorizontal: Horizontal stripe patterns
 * - darkVertical/lightVertical: Vertical stripe patterns
 * - darkDown/lightDown: Diagonal stripes (top-left to bottom-right)
 * - darkUp/lightUp: Diagonal stripes (bottom-left to top-right)
 * - darkGrid/lightGrid: Grid patterns (horizontal + vertical)
 * - darkTrellis/lightTrellis: Cross-hatch patterns (both diagonals)
 */
export type PatternType =
  | 'none'
  | 'solid'
  | 'darkGray'
  | 'mediumGray'
  | 'lightGray'
  | 'gray125'
  | 'gray0625'
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
  | 'lightTrellis';

/**
 * GradientStop — Core contracts layer. Maps to CT_GradientStop (dml-main.xsd:1539) with position + color for cell formatting.
 */
export interface GradientStop {
  /**
   * Position along the gradient (0.0 to 1.0).
   * 0.0 = start of gradient, 1.0 = end of gradient.
   */
  position: number;

  /**
   * Color at this position.
   * Can be absolute hex or theme reference.
   */
  color: string;
}

/**
 * Gradient fill configuration.
 *
 * Excel supports two gradient types:
 * - linear: Color transitions along a line at a specified angle
 * - path: Color transitions radially from a center point
 *
 * Gradients require at least 2 stops (start and end colors).
 */
export interface GradientFill {
  /**
   * Type of gradient.
   * - 'linear': Straight line gradient at specified degree
   * - 'path': Radial/rectangular gradient from center point
   */
  type: 'linear' | 'path';

  /**
   * Angle of linear gradient in degrees (0-359).
   * 0 = left-to-right, 90 = bottom-to-top, etc.
   * Only used when type is 'linear'.
   */
  degree?: number;

  /**
   * Center point for path gradients (0.0 to 1.0 for each axis).
   * { left: 0.5, top: 0.5 } = center of cell.
   * Only used when type is 'path'.
   */
  center?: {
    left: number;
    top: number;
  };

  /**
   * Gradient color stops.
   * Must have at least 2 stops. Stops should be ordered by position.
   */
  stops: GradientStop[];
}

/**
 * Cell formatting options
 *
 * This interface defines the Excel/OOXML format properties that can be applied to cells.
 * The implementation status of each property is tracked in format-registry.ts.
 *
 * @see FORMAT_PROPERTY_REGISTRY in format-registry.ts for implementation status
 */
export interface CellFormat {
  // ===========================================================================
  // Number Format
  // ===========================================================================

  /**
   * Spreadsheet number format code string.
   *
   * Common format codes:
   * - Currency:    '$#,##0.00'
   * - Accounting:  '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)'
   * - Percentage:  '0.00%'
   * - Date:        'M/D/YYYY', 'YYYY-MM-DD', 'MMM D, YYYY'
   * - Time:        'h:mm AM/PM', 'HH:mm:ss'
   * - Number:      '#,##0.00', '0.00'
   * - Scientific:  '0.00E+00'
   * - Text:        '@'
   * - Fraction:    '# ?/?'
   *
   * See the `formatPresets` section in api-spec.json for the full catalog
   * of 85+ pre-defined format codes with examples.
   *
   * @example
   * // Currency
   * { numberFormat: '$#,##0.00' }
   * // Percentage with 1 decimal
   * { numberFormat: '0.0%' }
   * // ISO date
   * { numberFormat: 'YYYY-MM-DD' }
   */
  numberFormat?: string;
  /**
   * Number format category hint. Auto-detected from numberFormat when not set.
   * Valid values: 'general' | 'number' | 'currency' | 'accounting' | 'date' |
   *              'time' | 'percentage' | 'fraction' | 'scientific' | 'text' |
   *              'special' | 'custom'
   */
  numberFormatType?: NumberFormatType;

  // ===========================================================================
  // Font Properties
  // ===========================================================================

  fontFamily?: string;
  fontSize?: number;
  /**
   * Theme font reference for "+Headings" / "+Body" workbook theme fonts.
   *
   * When set, the cell uses the theme's majorFont (headings) or minorFont (body)
   * instead of fontFamily. Theme fonts are resolved at render time, allowing cells
   * to automatically update when the workbook theme changes.
   *
   * Behavior:
   * - 'major': Uses theme.fonts.majorFont
   * - 'minor': Uses theme.fonts.minorFont
   * - undefined: Uses fontFamily property (or default font if not set)
   *
   * When fontTheme is set, fontFamily is ignored for rendering but may still be
   * stored for fallback purposes. This matches Excel's behavior where "+Headings"
   * cells can have a fontFamily that's used when the theme is unavailable.
   *
   * @see resolveThemeFonts in theme.ts for resolution
   * @see ThemeFonts for theme font pair definition
   */
  fontTheme?: 'major' | 'minor';
  /**
   * Font color. Can be:
   * - Absolute hex: '#4472c4' or '#ff0000'
   * - Theme reference: 'theme:accent1' (uses current theme's accent1 color)
   * - Theme with tint: 'theme:accent1:0.4' (40% lighter) or 'theme:accent1:-0.25' (25% darker)
   *
   * Theme references are resolved at render time via resolveThemeColors().
   * This enables cells to automatically update when the workbook theme changes.
   *
   * @see resolveThemeColors in theme.ts for resolution
   * @see ThemeColorSlot for valid slot names (dark1, light1, accent1-6, etc.)
   */
  fontColor?: string;
  /** Font color tint modifier (-1.0 to +1.0). Applied on top of fontColor. */
  fontColorTint?: number;
  bold?: boolean;
  italic?: boolean;
  /**
   * Underline type. Excel supports 4 underline styles:
   * - 'none': No underline (default)
   * - 'single': Standard underline under all characters
   * - 'double': Two parallel lines under all characters
   * - 'singleAccounting': Underline under text only (not spaces), for column alignment
   * - 'doubleAccounting': Double underline under text only (not spaces), for column alignment
   */
  underlineType?: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';
  strikethrough?: boolean;

  /**
   * Superscript text (vertAlign = 'superscript' in Excel).
   * Text is rendered smaller and raised above the baseline.
   */
  superscript?: boolean;

  /**
   * Subscript text (vertAlign = 'subscript' in Excel).
   * Text is rendered smaller and lowered below the baseline.
   */
  subscript?: boolean;

  /**
   * Font outline effect.
   * Draws only the outline of each character (hollow text).
   * Rare in modern spreadsheets but supported by Excel.
   */
  fontOutline?: boolean;

  /**
   * Font shadow effect.
   * Adds a shadow behind the text.
   * Rare in modern spreadsheets but supported by Excel.
   */
  fontShadow?: boolean;

  // ===========================================================================
  // Alignment Properties
  // ===========================================================================

  /**
   * Horizontal text alignment.
   * - 'general': Context-based (left for text, right for numbers) - Excel default
   * - 'left': Left-align text
   * - 'center': Center text
   * - 'right': Right-align text
   * - 'fill': Repeat content to fill cell width
   * - 'justify': Justify text (distribute evenly)
   * - 'centerContinuous': Center across selection without merging
   * - 'distributed': Distribute text evenly with indent support
   */
  horizontalAlign?:
    | 'general'
    | 'left'
    | 'center'
    | 'right'
    | 'fill'
    | 'justify'
    | 'centerContinuous'
    | 'distributed';

  /**
   * Vertical text alignment. The TypeScript/API contract uses `middle`
   * for centered vertical alignment.
   * - 'top': Align to top of cell
   * - 'middle': Center vertically
   * - 'bottom': Align to bottom of cell - Excel default
   * - 'justify': Justify vertically (distribute lines evenly)
   * - 'distributed': Distribute text evenly with vertical spacing
   */
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'justify' | 'distributed';
  wrapText?: boolean;

  /**
   * Text rotation angle in degrees.
   * - 0-90: Counter-clockwise rotation
   * - 91-180: Clockwise rotation (180 - value)
   * - 255: Vertical text (stacked characters, read top-to-bottom)
   */
  textRotation?: number;

  /**
   * Indent level (0-15).
   * Each level adds approximately 8 pixels of indent from the cell edge.
   * Works with left and right horizontal alignment.
   */
  indent?: number;

  /**
   * Shrink text to fit cell width.
   * Reduces font size to fit all text within the cell width.
   * Mutually exclusive with wrapText in Excel behavior.
   */
  shrinkToFit?: boolean;

  /**
   * Text reading order for bidirectional text support.
   * - 'context': Determined by first character with strong directionality
   * - 'ltr': Left-to-right (forced)
   * - 'rtl': Right-to-left (forced)
   */
  readingOrder?: 'context' | 'ltr' | 'rtl';

  /** Auto-indent flag (ECMA-376 CT_CellAlignment/@autoIndent). */
  autoIndent?: boolean;

  // ===========================================================================
  // Fill Properties
  // ===========================================================================

  /**
   * Background color. Can be:
   * - Absolute hex: '#ffffff' or '#c6efce'
   * - Theme reference: 'theme:accent1' (uses current theme's accent1 color)
   * - Theme with tint: 'theme:accent1:0.4' (40% lighter) or 'theme:accent1:-0.25' (25% darker)
   *
   * Theme references are resolved at render time via resolveThemeColors().
   * This enables cells to automatically update when the workbook theme changes.
   *
   * For solid fills, this is the only color needed.
   * For pattern fills, this is the background color behind the pattern.
   *
   * @see resolveThemeColors in theme.ts for resolution
   * @see ThemeColorSlot for valid slot names (dark1, light1, accent1-6, etc.)
   */
  backgroundColor?: string;

  /** Background color tint modifier (-1.0 to +1.0). Applied on top of backgroundColor. */
  backgroundColorTint?: number;

  /**
   * Pattern fill type.
   * XLSX supports 18 pattern types for cell backgrounds.
   * When set (and not 'none' or 'solid'), the cell uses a pattern fill.
   */
  patternType?: PatternType;

  /**
   * Pattern foreground color.
   * The color of the pattern itself (dots, lines, etc.).
   * Only used when patternType is set to a non-solid pattern.
   */
  patternForegroundColor?: string;

  /** Pattern foreground color tint modifier (-1.0 to +1.0). */
  patternForegroundColorTint?: number;

  /**
   * Gradient fill configuration.
   * When set, overrides backgroundColor and pattern fill.
   * Excel supports linear and path (radial) gradients.
   */
  gradientFill?: GradientFill;

  // ===========================================================================
  // Border Properties
  // ===========================================================================

  /** Cell borders (top, right, bottom, left, diagonal) */
  borders?: CellBorders;

  // ===========================================================================
  // Protection Properties
  // ===========================================================================

  /**
   * Cell is locked when sheet protection is enabled.
   * Default is true in Excel (all cells locked by default).
   * Only effective when the sheet's isProtected flag is true.
   */
  locked?: boolean;

  /**
   * Formula is hidden when sheet protection is enabled.
   * When true, the cell's formula is not shown in the formula bar.
   * The computed value is still displayed in the cell.
   * Only effective when the sheet's isProtected flag is true.
   */
  hidden?: boolean;

  /**
   * Cell value is forced to text mode (apostrophe prefix).
   * When true:
   * - Raw value includes the leading apostrophe
   * - Display value strips the apostrophe
   * - Formula bar shows the apostrophe
   * - Value is NOT coerced to date/number/etc.
   *
   * Set when user types ' as first character.
   * Follows cell on sort/move (keyed by CellId, Cell Identity Model).
   *
   */
  forcedTextMode?: boolean;

  // ===========================================================================
  // Extensible
  // ===========================================================================

  /**
   * Arbitrary extension data for future features.
   * Use namespaced keys: "myfeature.mykey"
   * Example: { ignoreError: true } to suppress error indicators.
   */
  extensions?: Record<string, unknown>;
}

/** Dense cell format where every property is explicitly present (null when unset). Returned by formats.get(). */
export type ResolvedCellFormat = {
  [K in keyof CellFormat]-?: CellFormat[K] | null;
};

/**
 * Border style.
 *
 * D3: Spreadsheet border styles. The full XLSX border-style set is supported:
 * - Solid: 'thin', 'medium', 'thick' (varying line widths)
 * - Dashed: 'dashed', 'mediumDashed' (varying dash lengths)
 * - Dotted: 'dotted', 'hair' (dots and very fine lines)
 * - Double: 'double' (two parallel lines)
 * - Dash-dot combinations: 'dashDot', 'dashDotDot', 'mediumDashDot', 'mediumDashDotDot'
 * - Special: 'slantDashDot' (slanted dash-dot pattern)
 *
 * @see cells-layer.ts getBorderDashPattern() for canvas rendering
 * @see format-mapper.ts for XLSX import/export mapping
 */
export interface BorderStyle {
  style:
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
    | 'dashDotDot'
    | 'mediumDashDot'
    | 'mediumDashDotDot'
    | 'slantDashDot';
  color?: string;
  /** Tint modifier for border color (-1.0 to +1.0, ECMA-376). */
  colorTint?: number;
}

/**
 * Cell borders
 *
 * ECMA-376 CT_Border: Full border specification for cells.
 * Supports standard borders (top/right/bottom/left), diagonal borders,
 * RTL equivalents (start/end), and internal borders for ranges (vertical/horizontal).
 */
export interface CellBorders {
  top?: BorderStyle;
  right?: BorderStyle;
  bottom?: BorderStyle;
  left?: BorderStyle;
  diagonal?: BorderStyle & { direction?: 'up' | 'down' | 'both' };

  /**
   * Diagonal up flag (ECMA-376 CT_Border @diagonalUp).
   * When true, diagonal line runs from bottom-left to top-right.
   * Note: This is the spec-compliant representation. For convenience,
   * diagonal.direction can also be used which derives from these flags.
   */
  diagonalUp?: boolean;

  /**
   * Diagonal down flag (ECMA-376 CT_Border @diagonalDown).
   * When true, diagonal line runs from top-left to bottom-right.
   * Note: This is the spec-compliant representation. For convenience,
   * diagonal.direction can also be used which derives from these flags.
   */
  diagonalDown?: boolean;

  // === RTL Support (ECMA-376 CT_Border) ===
  /**
   * RTL start border (maps to left in LTR, right in RTL).
   * Used for bidirectional text support.
   */
  start?: BorderStyle;

  /**
   * RTL end border (maps to right in LTR, left in RTL).
   * Used for bidirectional text support.
   */
  end?: BorderStyle;

  // === Internal Borders (ECMA-376 CT_Border - for ranges) ===
  /**
   * Internal vertical border (between cells in a range).
   * Only meaningful when applied to a range of cells.
   */
  vertical?: BorderStyle;

  /**
   * Internal horizontal border (between cells in a range).
   * Only meaningful when applied to a range of cells.
   */
  horizontal?: BorderStyle;

  // === Border Mode (ECMA-376 CT_Border @outline) ===
  /**
   * Outline mode flag.
   * When true, borders are applied as outline around the range.
   * When false/undefined, borders apply to individual cells.
   */
  outline?: boolean;
}

/**
 * Border preset mode for the `APPLY_BORDERS` action and the Format Cells
 * dialog Border tab.
 *
 * Controls how a `CellBorders` payload is mapped onto a multi-cell
 * selection:
 * - `'none'`: Remove all borders from every cell in the selection.
 * - `'outline'`: Apply borders to outer edges of the selection only
 *   (top row, bottom row, left col, right col). Used by the toolbar's
 *   "Outside Borders" preset and the dialog's "Outline" button.
 * - `'inside'`: Apply borders to internal cell dividers only (between
 *   cells). Used by the dialog's "Inside" button.
 * - `null`: Apply borders as specified to every cell in the selection
 *   (no preset semantics).
 */
export type BorderPresetMode = 'none' | 'outline' | 'inside' | null;

/**
 * Complete cell data
 */
export interface CellData {
  value: CellValue;
  formula?: FormulaA1;
  format?: CellFormat;
  borders?: CellBorders;
  comment?: string;
  hyperlink?: string;
  /** Pre-formatted display string from Rust (e.g., "$1,234.50", "1/1/2024"). */
  formatted?: string;
}

// ============================================================================
// Cell Style Types
// ============================================================================

/**
 * Style category for grouping styles in the UI gallery.
 */
export type StyleCategory =
  | 'good-bad-neutral' // Good, Bad, Neutral
  | 'data-model' // Calculation, Check Cell, etc.
  | 'titles-headings' // Title, Heading 1-4
  | 'themed' // Accent1-6 variations
  | 'number-format' // Currency, Percent, Comma
  | 'custom'; // User-defined styles

/**
 * Named cell style that can be applied to cells.
 *
 * Styles are a named collection of formatting properties. When applied,
 * the format values are copied to cells (not referenced by ID). This
 * matches Excel behavior where style changes don't affect already-styled cells.
 *
 * Built-in styles are defined in code and never persisted.
 * Custom styles are stored in Yjs for collaboration.
 */
export interface CellStyle {
  /** Unique identifier (e.g., 'good', 'heading1', 'custom-abc123') */
  id: string;
  /** Display name shown in UI (e.g., 'Good', 'Heading 1') */
  name: string;
  /** Category for UI grouping */
  category: StyleCategory;
  /** The formatting properties to apply */
  format: CellFormat;
  /** True for built-in styles, false for user-created */
  builtIn: boolean;
}

/**
 * Sheet metadata
 */
export interface SheetInfo {
  id: string;
  name: string;
  index: number;
  hidden?: boolean;
  tabColor?: string;
}

/**
 * Per-sheet view options (persisted in Yjs).
 * Stream F: Freeze Panes & View Options
 */
export interface SheetViewOptions {
  /** Whether gridlines are visible (default: true) */
  showGridlines: boolean;
  /** Whether row headers (1, 2, 3...) are visible (default: true) */
  showRowHeaders: boolean;
  /** Whether column headers (A, B, C...) are visible (default: true) */
  showColumnHeaders: boolean;
  /** Whether the sheet is displayed right-to-left (default: false) */
  rightToLeft: boolean;
  /** Whether to display formulas instead of computed values (default: false) */
  showFormulas: boolean;
  /** Whether to display zero values (default: true, matching Excel) */
  showZeros: boolean;
  /** Zoom scale percentage, or undefined for default (100%) */
  zoomScale?: number;
}

// ============================================================================
// Workbook & Sheet Settings (Stream L: Settings & Toggles)
// ============================================================================

/**
 * Direction for enter key movement after committing an edit.
 * Issue 8: Settings Panel
 */
export type EnterKeyDirection = 'down' | 'right' | 'up' | 'left' | 'none';

// ============================================================================
// Calculation Settings (G.3: Iterative Calculation)
// ============================================================================

/**
 * Calculation settings for the workbook.
 * G.3: Supports iterative calculation for circular references.
 *
 * Excel allows formulas with circular references to calculate iteratively
 * until they converge or reach the maximum iterations. When disabled (default),
 * circular references result in #CALC! errors.
 *
 */
/** Calculation mode — when the engine recalculates formulas. */
export type CalcMode = 'auto' | 'autoNoTable' | 'manual';

export interface CalculationSettings {
  /**
   * Whether to allow iterative calculation for circular references.
   * When true, formulas with circular references calculate iteratively.
   * When false (default), circular references show #CALC! error.
   */
  enableIterativeCalculation: boolean;

  /**
   * Maximum number of iterations for iterative calculation.
   * Excel default: 100
   */
  maxIterations: number;

  /**
   * Maximum change between iterations for convergence.
   * Calculation stops when all results change by less than this amount.
   * Excel default: 0.001
   */
  maxChange: number;

  /**
   * Calculation mode (auto/manual/autoNoTable).
   * Default: 'auto'
   */
  calcMode: CalcMode;

  /**
   * Whether to use full (15-digit) precision for calculations.
   * Default: true
   */
  fullPrecision: boolean;

  /**
   * Cell reference style (true = R1C1, false = A1).
   * Default: false
   */
  r1c1Mode: boolean;

  /**
   * Whether to perform a full calculation when the file is opened.
   * Default: false
   */
  fullCalcOnLoad: boolean;

  /**
   * Whether the workbook's last calculation completed.
   * Preserved for XLSX calculation metadata fidelity.
   * Default: true
   */
  calcCompleted: boolean;

  /**
   * Whether Excel should recalculate when saving.
   * Default: true
   */
  calcOnSave: boolean;

  /**
   * Whether concurrent calculation is enabled.
   * Default: true
   */
  concurrentCalc: boolean;

  /**
   * Explicit concurrent calculation thread count, when present.
   * Default: null
   */
  concurrentManualCount: number | null;

  /**
   * Whether to force a full recalculation.
   * Default: false
   */
  forceFullCalc: boolean;

  /**
   * Excel calculation engine version (`calcId` in OOXML).
   */
  calcId?: number;

  /**
   * Whether `iterateCount` was explicitly present in the source workbook.
   * Preserved for XLSX round-trip fidelity.
   * Default: false
   */
  hasExplicitIterateCount: boolean;

  /**
   * Whether `iterateDelta` was explicitly present in the source workbook.
   * Preserved for XLSX round-trip fidelity.
   * Default: false
   */
  hasExplicitIterateDelta: boolean;
}

// DEFAULT_CALCULATION_SETTINGS moved to @mog-sdk/kernel/defaults/core

/**
 * Workbook-level settings (persisted in Yjs workbook metadata).
 * These apply globally to the entire workbook, not per-sheet.
 * Stream L: Settings & Toggles
 */
export interface WorkbookSettings {
  /** Whether horizontal scrollbar is visible (default: true) */
  showHorizontalScrollbar: boolean;
  /** Whether vertical scrollbar is visible (default: true) */
  showVerticalScrollbar: boolean;
  /**
   * Whether scrollbars auto-hide when not scrolling (default: false).
   * When true, scrollbars fade out after scroll ends and reappear on hover or scroll.
   * Auto-Hide Scroll Bars
   */
  autoHideScrollBars: boolean;
  /** Whether the tab strip is visible (default: true) */
  showTabStrip: boolean;
  /** Whether sheets can be reordered by dragging (default: true) */
  allowSheetReorder: boolean;
  /** Whether the formula bar is visible (default: true) */
  showFormulaBar: boolean;
  /** Whether to auto-fit column width on header double-click (default: true) */
  autoFitOnDoubleClick: boolean;
  /**
   * ID of active theme.
   * Built-in theme IDs: 'office', 'slice', 'vapor-trail', etc.
   * Use 'custom' to indicate a custom theme is stored in customTheme.
   * Issue 4: Page Layout - Themes
   */
  themeId: string;

  /**
   * Override for theme fonts. When set, uses this font theme instead
   * of the fonts from the selected theme.
   * Built-in font theme IDs: 'office', 'arial', 'times', 'calibri', etc.
   * undefined means use fonts from themeId.
   *
   * Theme Font UI
   */
  themeFontsId?: string;

  /**
   * Locale/culture for number, date, and currency formatting.
   * Uses IETF language tags: 'en-US', 'de-DE', 'ja-JP', etc.
   * Default: 'en-US'
   *
   * This affects:
   * - Decimal and thousands separators (1,234.56 vs 1.234,56)
   * - Currency symbol position ($100 vs 100 €)
   * - Date format patterns (MM/DD/YYYY vs DD.MM.YYYY)
   * - Month and day name translations
   * - AM/PM designators
   *
   * Stream G: Culture & Localization
   */
  culture: string;

  // ===========================================================================
  // Issue 8: Settings Panel - Editing Behavior Settings
  // ===========================================================================

  /** Whether to show cut/copy indicator (marching ants). Default: true */
  showCutCopyIndicator: boolean;

  /** Whether fill handle dragging is enabled. Default: true */
  allowDragFill: boolean;

  /** Direction to move after pressing Enter. Default: 'down' */
  enterKeyDirection: EnterKeyDirection;

  /** Whether cell drag-and-drop to move cells is enabled. Default: false (not yet implemented) */
  allowCellDragDrop: boolean;

  // ===========================================================================
  // Stream H: Multi-Sheet Selection
  // ===========================================================================

  /**
   * Currently selected sheet IDs for multi-sheet operations.
   * Default: undefined (falls back to [activeSheetId])
   *
   * This is collaborative state - other users can see which sheets you have selected.
   * Used for operations that broadcast to multiple sheets (formatting, structure changes).
   *
   * When multiple sheets are selected:
   * - Formatting operations apply to all selected sheets
   * - Structure operations (insert/delete rows/cols) apply to all selected sheets
   * - The active sheet is always included in the selection
   */
  selectedSheetIds?: SheetId[];

  // ===========================================================================
  // Workbook protection
  // ===========================================================================

  /**
   * Whether the workbook structure is protected.
   * When true, prevents adding, deleting, renaming, hiding, unhiding, or moving sheets.
   * Default: false
   *
   * Protect Workbook dialog
   */
  isWorkbookProtected?: boolean;

  /**
   * Hashed protection password for workbook (optional).
   * Uses XLSX-compatible XOR hash algorithm for round-trip compatibility.
   * Empty string or undefined means no password protection.
   */
  workbookProtectionPasswordHash?: string;

  /**
   * Workbook protection options (what operations are prevented).
   * Only relevant when isWorkbookProtected is true.
   * If not set, defaults to DEFAULT_WORKBOOK_PROTECTION_OPTIONS.
   * @see WorkbookProtectionOptions in protection.ts
   */
  workbookProtectionOptions?: import('./document/protection').WorkbookProtectionOptions;

  // ===========================================================================
  // G.3: Calculation Settings (Iterative Calculation for Circular References)
  // ===========================================================================

  /**
   * Calculation settings including iterative calculation for circular references.
   * If not set, defaults to DEFAULT_CALCULATION_SETTINGS.
   *
   */
  calculationSettings?: CalculationSettings;

  /**
   * Whether the workbook uses the 1904 date system (affects all date calculations).
   * Default: false (1900 date system).
   */
  date1904?: boolean;

  // ===========================================================================
  // Tables - default style
  // ===========================================================================

  /**
   * Default table style ID for new tables created in this workbook.
   * Can be a built-in style preset name (e.g., 'medium2', 'dark1')
   * or a custom style ID (e.g., 'custom-abc123').
   *
   * When undefined, new tables use the 'medium2' preset by default.
   *
   * Tables Excel compatibility: set as default style
   */
  defaultTableStyleId?: string;

  // ===========================================================================
  // Chart Settings
  // ===========================================================================

  /**
   * Whether chart data points track cell movement when cells are inserted/deleted.
   * When true, chart data series follow their original data points even if
   * the underlying cells shift due to row/column insertion or deletion.
   * Default: true (matches the spreadsheet default).
   *
   * Mirrors the workbook chart data point tracking behavior.
   */
  chartDataPointTrack?: boolean;

  /** Workbook-level controls for future automatic conversions. */
  automaticConversionPolicy: AutomaticConversionPolicy;
}

export interface AutomaticConversionPolicy {
  convertDateLikeText: boolean;
  convertTimeLikeText: boolean;
  convertFractionLikeText: boolean;
  convertScientificNotation: boolean;
  convertLeadingZeroNumbers: boolean;
  convertLongDigitNumbers: boolean;
  convertPercentSuffix: boolean;
  convertCurrencySymbol: boolean;
  convertFormattedNumbers: boolean;
}

export interface AutomaticConversionPolicyPatch {
  convertDateLikeText?: boolean;
  convertTimeLikeText?: boolean;
  convertFractionLikeText?: boolean;
  convertScientificNotation?: boolean;
  convertLeadingZeroNumbers?: boolean;
  convertLongDigitNumbers?: boolean;
  convertPercentSuffix?: boolean;
  convertCurrencySymbol?: boolean;
  convertFormattedNumbers?: boolean;
}

export type WorkbookSettingsPatch = Omit<Partial<WorkbookSettings>, 'automaticConversionPolicy'> & {
  automaticConversionPolicy?: AutomaticConversionPolicyPatch;
};

export type AutomaticConversionCategory =
  | 'dateLikeText'
  | 'timeLikeText'
  | 'fractionLikeText'
  | 'scientificNotation'
  | 'leadingZeroNumber'
  | 'longDigitNumber'
  | 'percentSuffix'
  | 'currencySymbol'
  | 'formattedNumber';

export interface PolicyPreservedParseOutcome {
  sheetId: SheetId;
  cellId: CellId;
  row: number;
  col: number;
  submittedText: string;
  category: AutomaticConversionCategory;
}

export interface PolicyPreservedParseSummary {
  totalPreserved: number;
  emittedCount: number;
  omittedCount: number;
  outcomeEntriesTruncated: boolean;
  submittedTextTruncatedCount: number;
}

/**
 * Default workbook settings.
 * Stream L: Settings & Toggles
 *
 * SCHEMA-DRIVEN: Defaults are derived from WORKBOOK_SETTINGS_SCHEMA.
 * @see store/workbook-schema.ts for the single source of truth.
 */
// DEFAULT_WORKBOOK_SETTINGS moved to @mog-sdk/kernel/defaults/core

/**
 * Extended sheet settings (persisted in Yjs sheet metadata).
 * Extends SheetViewOptions with additional per-sheet configuration.
 * Stream L: Settings & Toggles
 */
export interface SheetSettings extends SheetViewOptions {
  /** Whether the sheet is protected (default: false) */
  isProtected: boolean;
  /** Hashed protection password (optional, empty string if no password) */
  protectionPasswordHash?: string;
  /**
   * Granular protection options (what operations are allowed when protected).
   * Only relevant when isProtected is true.
   * If not set, defaults to DEFAULT_PROTECTION_OPTIONS.
   * @see SheetProtectionOptions in protection.ts
   */
  protectionOptions?: import('./document/protection').SheetProtectionOptions;
  /** Whether to show zero values or display blank (default: true) */
  showZeroValues: boolean;
  /** Gridline color (default: '#e2e2e2') */
  gridlineColor: string;
  /** Right-to-left layout (default: false) */
  rightToLeft: boolean;
  /** Default row height for new rows in pixels (default: 21) */
  defaultRowHeight: number;
  /** Default column width for new columns in pixels (default: 100) */
  defaultColWidth: number;
}

// DEFAULT_SHEET_SETTINGS moved to @mog-sdk/kernel/defaults/core

/**
 * Paper size type for print settings
 */
export type PaperSize = 'letter' | 'legal' | 'a4' | 'a3' | 'custom';

/**
 * Page orientation type for print settings
 */
export type PageOrientation = 'portrait' | 'landscape';

/**
 * Page margins in inches.
 * Full OOXML representation including header/footer margins.
 */
export interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
}

/**
 * Header/footer configuration (OOXML CT_HeaderFooter).
 */
export interface HeaderFooter {
  oddHeader: string | null;
  oddFooter: string | null;
  evenHeader: string | null;
  evenFooter: string | null;
  firstHeader: string | null;
  firstFooter: string | null;
  differentOddEven: boolean;
  differentFirst: boolean;
  scaleWithDoc: boolean;
  alignWithMargins: boolean;
}

/**
 * Full print settings for a sheet, matching the Rust domain-types canonical type.
 *
 * Replaces the old lossy SheetPrintSettings. All fields are nullable where the
 * underlying OOXML attribute is optional, using `null` to mean "not set / use default".
 *
 * Distinct from PrintOptions (runtime-only configuration in print-export).
 */
export interface PrintSettings {
  /** OOXML paper size code (1=Letter, 9=A4, etc.), null = not set */
  paperSize: number | null;
  /** Custom paper width such as "210mm" or "8.5in", null = not set */
  paperWidth?: string | null;
  /** Custom paper height such as "297mm" or "11in", null = not set */
  paperHeight?: string | null;
  /** Page orientation, null = not set (defaults to portrait) */
  orientation: string | null;
  /** Scale percentage (10-400), null = not set */
  scale: number | null;
  /** Fit to N pages wide, null = not set */
  fitToWidth: number | null;
  /** Fit to N pages tall, null = not set */
  fitToHeight: number | null;
  /** Print cell gridlines */
  gridlines: boolean;
  /** Whether gridline printing was explicitly set; OOXML defaults to true */
  gridLinesSet?: boolean;
  /** Print row/column headings */
  headings: boolean;
  /** Center content horizontally on page */
  hCentered: boolean;
  /** Center content vertically on page */
  vCentered: boolean;
  /** Page margins in inches (with header/footer margins) */
  margins: PageMargins | null;
  /** Header/footer configuration */
  headerFooter: HeaderFooter | null;
  /** Print in black and white */
  blackAndWhite: boolean;
  /** Draft quality */
  draft: boolean;
  /** First page number override, null = auto */
  firstPageNumber: number | null;
  /** Page order: "downThenOver" or "overThenDown", null = default */
  pageOrder: string | null;
  /** Use printer defaults */
  usePrinterDefaults: boolean | null;
  /** Horizontal DPI, null = not set */
  horizontalDpi: number | null;
  /** Vertical DPI, null = not set */
  verticalDpi: number | null;
  /** Relationship ID for printer settings binary, null = not set */
  rId: string | null;
  /** Whether the sheet had printOptions element in OOXML */
  hasPrintOptions: boolean;
  /** Whether the sheet had pageSetup element in OOXML */
  hasPageSetup: boolean;
  /** Number of copies, null = not set */
  copies?: number | null;
  /** Sheet-level page setup properties from sheetPr/pageSetUpPr */
  pageSetupProperties?: PageSetupProperties | null;
  /** Whether to use firstPageNumber (vs auto) */
  useFirstPageNumber: boolean;
  /** How to print cell comments: "none" | "atEnd" | "asDisplayed", null = not set (defaults to none) */
  printComments: string | null;
  /** How to print cell errors: "displayed" | "blank" | "dash" | "NA", null = not set (defaults to displayed) */
  printErrors: string | null;
}

export interface PageSetupProperties {
  /** Fit sheet content to page dimensions */
  fitToPage: boolean;
  /** Automatically insert page breaks */
  autoPageBreaks: boolean;
}

/** @deprecated Use PrintSettings instead */
export type SheetPrintSettings = PrintSettings;

/**
 * Position of a header/footer image in the page layout.
 */
export type HfImagePosition =
  | 'leftHeader'
  | 'centerHeader'
  | 'rightHeader'
  | 'leftFooter'
  | 'centerFooter'
  | 'rightFooter';

/**
 * Header/footer image metadata.
 * Stores image references (path or data-URL), not binary blobs.
 */
export interface HeaderFooterImageInfo {
  position: HfImagePosition;
  /** Image source — resolved path for imported, or data-URL for API-created */
  src: string;
  /** Descriptive title */
  title: string;
  /** Width in points */
  widthPt: number;
  /** Height in points */
  heightPt: number;
}

// DEFAULT_SHEET_PRINT_SETTINGS moved to @mog-sdk/kernel/defaults/core

/**
 * Column metadata
 */
export interface ColumnInfo {
  index: number;
  width: number;
  hidden?: boolean;
  format?: CellFormat;
}

/**
 * Row metadata
 */
export interface RowInfo {
  index: number;
  height: number;
  hidden?: boolean;
  format?: CellFormat;
}

/**
 * Data type detection result
 */
export type DetectedDataType = 'string' | 'number' | 'date' | 'boolean' | 'empty' | 'error';

/**
 * Utility type for 2D data arrays
 */
export type DataMatrix<T = CellValue> = T[][];

/**
 * Read-only data provider interface
 */
export interface IDataProvider {
  getCellValue(address: CellAddress): CellValue;
  getCellData(address: CellAddress): CellData | undefined;
  getRangeValues(range: CellRange): DataMatrix;
  getSheetInfo(sheetId: string): SheetInfo | undefined;
  getSheetIds(): string[];
}

// ============================================================================
// Cell Metadata Types
// ============================================================================

/**
 * How a cell's value was set
 */
export interface CellDataSource {
  /** How the value was entered */
  type: 'manual' | 'import' | 'api' | 'formula' | 'remote-link';
  /** Additional context (file name, API endpoint, formula address, etc.) */
  source?: string;
}

/**
 * Validation error for a cell
 */
export interface ValidationError {
  /** Rule ID that failed (e.g., "type:number", "constraint:positive") */
  rule: string;
  /** Human-readable error message */
  message: string;
  /** Error blocks save; warning just displays */
  severity: 'error' | 'warning';
}

/**
 * Metadata attached to individual cells.
 * Stored in a separate Yjs map for sparse, efficient storage.
 */
export interface CellMetadata {
  // === Provenance ===
  /** User ID who last modified this cell */
  modifiedBy?: string;
  /** Timestamp of last modification (Unix ms) */
  modifiedAt?: number;
  /** How this cell's value was set */
  dataSource?: CellDataSource;

  // === Validation ===
  /** Type validation or assertion errors */
  validationErrors?: ValidationError[];

  // === Live Data ===
  /** ID of external data connection, if any */
  connectionId?: string;
  /** Whether connected data is current */
  staleness?: 'fresh' | 'stale' | 'error';
  /** When data was last fetched from source */
  lastFetched?: number;

  // === Formula Auditing (Stream B2) ===
  /**
   * Whether this cell contains an array formula (CSE - Ctrl+Shift+Enter).
   * When true, the formula bar displays the formula with curly braces: {=FORMULA}
   * The formula itself is stored without braces in cells.raw - this is display metadata only.
   */
  isArrayFormula?: boolean;

  // === Extensible ===
  /**
   * Arbitrary extension data for future features.
   * Use namespaced keys: "myfeature.mykey"
   */
  extensions?: Record<string, unknown>;
}

// ============================================================================
// Unified Cell Properties
// ============================================================================

/**
 * All non-computational properties of a cell.
 *
 * This unified type merges visual formatting (CellFormat) with metadata
 * (provenance, validation, connections) into a single structure. This enables:
 * - Single Yjs map for all non-computational data
 * - Unified observer for reactivity
 * - Clear mental model: cells = computation, properties = everything else
 *
 * Stored in a single Yjs map for unified reactivity.
 */
export interface CellProperties {
  // === Visual Formatting ===
  /** Cell formatting (font, colors, alignment, etc.) */
  format?: CellFormat;

  // === Provenance ===
  /** User ID who last modified this cell */
  modifiedBy?: string;
  /** Timestamp of last modification (Unix ms) */
  modifiedAt?: number;
  /** How this cell's value was set */
  dataSource?: CellDataSource;

  // === Validation ===
  /** Type validation or assertion errors */
  validationErrors?: ValidationError[];

  // === Live Data ===
  /** ID of external data connection, if any */
  connectionId?: string;
  /** Whether connected data is current */
  staleness?: 'fresh' | 'stale' | 'error';
  /** When data was last fetched from source */
  lastFetched?: number;

  // === Formula Auditing (Stream B2) ===
  /**
   * Whether this cell contains an array formula (CSE - Ctrl+Shift+Enter).
   * When true, the formula bar displays the formula with curly braces: {=FORMULA}
   * The formula itself is stored without braces in cells.raw - this is display metadata only.
   */
  isArrayFormula?: boolean;

  // === Extensible ===
  /**
   * Arbitrary extension data for future features.
   * Use namespaced keys: "myfeature.mykey"
   */
  extensions?: Record<string, unknown>;
}

// =============================================================================
// Copy / Paste Types
// =============================================================================

/**
 * Specifies what data to copy in a range copy operation.
 * Maps to the spreadsheet range-copy mode.
 */
export type CopyType = 'all' | 'formulas' | 'values' | 'formats';

/**
 * Options for Range.copyFrom() operation.
 */
export interface CopyFromOptions {
  /** What to copy — defaults to 'all'. */
  copyType?: CopyType;
  /** Skip blank source cells (preserve target values where source is empty). */
  skipBlanks?: boolean;
  /** Transpose rows ↔ columns during copy. */
  transpose?: boolean;
}

// =============================================================================
// Branded Display Text
// =============================================================================

declare const __formattedText: unique symbol;
/**
 * Opaque branded type for pre-formatted display text.
 * NOT assignable to `string` — forces consumers to either:
 * - Use `.value` for semantic data (correct for logic)
 * - Call `displayString()` to explicitly unwrap (correct for rendering)
 */
export interface FormattedText {
  readonly [__formattedText]: true;
  /** @deprecated FormattedText is not a string. Use displayString() or .value instead. */
  toString(): string;
}
