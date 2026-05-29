/**
 * Unified Spreadsheet API -- Worksheet Interface
 *
 * THE definitive API for all sheet-level data and compute operations.
 * All domain operations live on Worksheet. Tables, grouping, pivots, etc.
 * are worksheet-scoped (matching Excel's object model).
 *
 * ## Addressing overloads
 *
 * Every cell/range method accepts both A1 strings AND numeric (row, col):
 *
 *   await ws.setCell("A1", 42);           // A1 string
 *   await ws.setCell(0, 0, 42);           // numeric (row, col)
 *
 * TypeScript discriminates on the first argument type (string vs number).
 * No runtime cost for the numeric path, negligible parse cost for A1.
 *
 * ## Sub-API namespaces
 *
 * Domain-specific operations are grouped into readonly sub-API accessors:
 *
 *   await ws.formats.setFormat("A1", { bold: true });
 *   await ws.structure.insertRows(0, 5);
 *   await ws.charts.addChart(config);
 *
 * Root methods cover: identity, cell I/O, formula, bulk reads, LLM presentation,
 * query, sort/batch, dependents/precedents, events, bridge accessors, display,
 * utility, and visibility.
 */
import type { CallableDisposable } from '@mog/types-core/disposable';
import type { CellControl, CellValue, CellValuePrimitive } from '@mog/types-core/core';
import type {
  EventByType,
  SpreadsheetEventType as InternalEventType,
  SpreadsheetEvent,
} from '@mog/types-events';
import type { AutoFillMode, AutoFillResult, FillSeriesOptions } from '@mog/types-editor/fill/types';
import type { IObjectBoundsReader } from '@mog/types-objects/objects/object-bounds-reader';
import type {
  AggregateResult,
  CellData,
  CellMetadataCache,
  CellRange,
  CellWriteOptions,
  ClearApplyTo,
  ClearResult,
  FormatChangeResult,
  FormatEntry,
  GoalSeekResult,
  IdentifiedCellData,
  NumberFormatCategory,
  RangeValueType,
  RawCellData,
  FindInRangeOptions,
  SearchOptions,
  SetCellsResult,
  SearchResult,
  SheetEvent,
  SheetEventMap,
  SheetId,
  SignCheckOptions,
  SignCheckResult,
  SortOptions,
  SummaryOptions,
  ViewportReader,
  VisibleRangeView,
} from './types';
import type { CellType, CellValueType } from './types';
import type { RegionMeta } from '../store/store-types';
import type { CopyFromOptions } from '@mog/types-core/core';
import type {
  WorksheetBindings,
  WorksheetChanges,
  WorksheetCharts,
  WorksheetComments,
  WorksheetCustomProperties,
  WorksheetConditionalFormatting,
  WorksheetConnectorCollection,
  WorksheetDrawingCollection,
  WorksheetEquationCollection,
  WorksheetFilters,
  WorksheetFormControls,
  WorksheetFormats,
  WorksheetHyperlinks,
  WorksheetInternal,
  WorksheetLayout,
  WorksheetNames,
  WorksheetObjectCollection,
  WorksheetOutline,
  WorksheetPictureCollection,
  WorksheetPivots,
  WorksheetPrint,
  WorksheetProtection,
  WorksheetSettings,
  WorksheetShapeCollection,
  WorksheetSlicers,
  WorksheetDiagrams,
  WorksheetSparklines,
  WorksheetStructure,
  WorksheetStyles,
  WorksheetTables,
  WorksheetTextBoxCollection,
  WorksheetValidation,
  WorksheetView,
  WorksheetWhatIf,
  WorksheetTextEffectCollection,
} from './worksheet/index';

/**
 * Options for {@link Worksheet.sortByColor}.
 *
 * Sorts the rows of a range by a color predicate on a single column.
 * Matched-color rows are placed on top (`position: 'top'`) or bottom
 * (`position: 'bottom'`) of the range; ties fall through to natural
 * row order (stable sort).
 */
export interface SortByColorOptions {
  /** Column index (0-based, absolute) whose color drives the sort. */
  column: number;
  /** Whether to compare against fill (cell background) or font color. */
  colorType: 'fill' | 'font';
  /** Hex color to match (e.g. '#FFFF00'). Case-insensitive. */
  color: string;
  /** Place matched-color rows on top of the range or at the bottom. */
  position: 'top' | 'bottom';
  /** Whether the first row of the range is a header row (default: false). */
  hasHeaders?: boolean;
  /** Sort only currently visible row slots, preserving hidden row positions. */
  visibleRowsOnly?: boolean;
}

/**
 * Typed cell readback record returned by {@link WorksheetCellsAccessor.get}.
 *
 * Shape is intentionally divergent from {@link Worksheet.getCell}'s
 * `{value: null}` empty form: every in-bounds cell carries a `valueType`
 * tag so callers can switch on the discriminant without a separate
 * "is this in-bounds" check. Out-of-bounds reads return `undefined`.
 */
export interface CellRecord {
  /** Sheet-relative position (0-indexed). */
  readonly row: number;
  readonly col: number;
  /** A1 address as supplied to `cells.get`, normalized to upper-case. */
  readonly addr: string;
  /** Effective value (formula result for formula cells, raw value otherwise). `null` for empty. */
  readonly value: CellValuePrimitive | null;
  /**
   * Per-cell value type classification — string-keyed enum already used
   * by {@link Worksheet.getValueTypes} for ranges.
   * `Empty | String | Double | Boolean | Error` (dates classified as
   * `Double`, matching the workbook API).
   */
  readonly valueType: RangeValueType;
  /** Authored formula (A1) when the cell has one; `null` otherwise. */
  readonly formula: string | null;
  /** Unified region-membership shape. `null` for plain cells. */
  readonly region: RegionMeta | null;
  /** Convenience: `region != null && !region.isAnchor`. Derived, not stored. */
  readonly isArrayMember: boolean;
}

/**
 * Sub-API for typed per-cell readback by A1 address.
 *
 * Surfaced on {@link Worksheet.cells}.
 */
export interface WorksheetCellsAccessor {
  /**
   * Read a typed cell record by A1 address (e.g. `"B2"`).
   *
   * **Async.** Backed by the kernel's domain-layer `CellReads.getData`,
   * which goes through the compute bridge (CellId lookup + `getActiveCell`,
   * with spill-member and materialized-cell fallbacks). A sync read off the
   * viewport buffer was considered and rejected: the viewport only covers
   * the rendered window, so a sync `get` would silently return `undefined`
   * for off-screen cells and surprise callers.
   *
   * Returns `undefined` when the cell is outside the sheet bounds. Empty
   * in-bounds cells return a record with `value === null` and
   * `valueType === RangeValueType.Empty` — deliberately divergent from
   * `getCell`'s `{value: null}` shape so the discriminant tag is always
   * present (callers don't need a separate "is this in-bounds" check).
   */
  get(addr: string): Promise<CellRecord | undefined>;
}

/**
 * Result returned when formula syntax validation rejects an input.
 *
 * `errorPosition` is a zero-based character offset into the authored formula
 * text, when the parser can locate one.
 */
export interface FormulaSyntaxValidationError {
  errorMessage: string;
  errorPosition?: number;
}

/**
 * Result returned when formula circular-reference validation rejects an input.
 */
export interface FormulaCircularReferenceValidation {
  cellAddress: string;
  formula: string;
}

/**
 * Kernel-owned read model for the source text used when entering edit mode on
 * the active cell.
 */
export interface ActiveCellEditSource {
  sheetId: SheetId;
  row: number;
  col: number;
  source: string;
  version: number;
  fresh: boolean;
}

export interface Worksheet {
  // ===========================================================================
  // Identity
  // ===========================================================================

  /** The internal sheet ID (immutable). */
  readonly sheetId: SheetId;

  /** Sheet name. SYNC — cached, updated on sheet mutations. */
  readonly name: string;

  /** 0-based sheet index in workbook order. SYNC — cached, updated on sheet mutations. */
  readonly index: number;

  /** Get the sheet name. Async — reads from Rust via IPC (cached after first call). */
  getName(): Promise<string>;

  /** Set the sheet name. */
  setName(name: string): Promise<void>;

  /** Get the 0-based sheet index. */
  getIndex(): number;

  /**
   * Get the internal sheet ID.
   * @deprecated Use the `sheetId` property instead.
   */
  getSheetId(): SheetId;

  // ===========================================================================
  // Cell read/write (overloaded addressing)
  // ===========================================================================

  /**
   * Set a cell value by A1 address.
   * String values starting with "=" are treated as formulas (e.g. "=SUM(B1:B10)").
   * Use `options.asFormula` to force formula interpretation without the "=" prefix.
   * Use `options.literal` to store strings starting with "=" as literal text.
   * Date values are automatically converted via setDateValue().
   */
  setCell(
    address: string,
    value: CellValuePrimitive | Date,
    options?: CellWriteOptions,
  ): Promise<void>;
  /**
   * Set a cell value by row/col.
   * String values starting with "=" are treated as formulas (e.g. "=SUM(B1:B10)").
   * Use `options.asFormula` to force formula interpretation without the "=" prefix.
   * Use `options.literal` to store strings starting with "=" as literal text.
   * Date values are automatically converted via setDateValue().
   */
  setCell(
    row: number,
    col: number,
    value: CellValuePrimitive | Date,
    options?: CellWriteOptions,
  ): Promise<void>;

  /**
   * Set a calendar date in a cell, automatically applying a date format.
   *
   * Four input forms (in order of preference for unambiguous semantics):
   *
   * 1. **Calendar parts** — `setDateValue(row, col, year, month, day)` /
   *    `setDateValue(addr, year, month, day)`. No `Date`, no timezone — the
   *    calendar value is the input.
   * 2. **ISO calendar string** — `setDateValue(row, col, '2026-03-01')` /
   *    `setDateValue(addr, '2026-03-01')`. No `Date`, no timezone.
   * 3. **`Date` instant** — `setDateValue(row, col, date)` /
   *    `setDateValue(addr, date)`. Resolved against the session's
   *    `userTimezone` (set when the workbook was created).
   * 4. **`Date` instant with explicit override** —
   *    `setDateValue(row, col, date, { tz })` / `setDateValue(addr, date, { tz })`.
   *    Use when a `Date` should be interpreted in a frame other than the
   *    session default.
   *
   */
  setDateValue(row: number, col: number, year: number, month: number, day: number): Promise<void>;
  setDateValue(address: string, year: number, month: number, day: number): Promise<void>;
  setDateValue(row: number, col: number, isoDate: string): Promise<void>;
  setDateValue(address: string, isoDate: string): Promise<void>;
  setDateValue(row: number, col: number, date: Date, opts?: { tz?: string }): Promise<void>;
  setDateValue(address: string, date: Date, opts?: { tz?: string }): Promise<void>;

  /**
   * Set a time-of-day in a cell, automatically applying a time format.
   *
   * Three input forms:
   *
   * 1. **Time parts** — `setTimeValue(row, col, hours, minutes, seconds)` /
   *    `setTimeValue(addr, hours, minutes, seconds)`.
   * 2. **`Date` instant** — `setTimeValue(row, col, date)` /
   *    `setTimeValue(addr, date)`. Resolved against the session's
   *    `userTimezone`.
   * 3. **`Date` instant with explicit override** — `setTimeValue(row, col, date, { tz })`.
   */
  setTimeValue(
    row: number,
    col: number,
    hours: number,
    minutes: number,
    seconds: number,
  ): Promise<void>;
  setTimeValue(address: string, hours: number, minutes: number, seconds: number): Promise<void>;
  setTimeValue(row: number, col: number, date: Date, opts?: { tz?: string }): Promise<void>;
  setTimeValue(address: string, date: Date, opts?: { tz?: string }): Promise<void>;

  /**
   * Typed per-cell readback accessor (A1-only). See {@link CellRecord}.
   *
   * Distinct from {@link getCell}: `cells.get` returns a record with a
   * `valueType` discriminant for every in-bounds cell, exposes the
   * unified {@link RegionMeta} for array/Data Table membership, and
   * returns `undefined` (not `{value: null}`) for out-of-bounds reads.
   */
  readonly cells: WorksheetCellsAccessor;

  /** Get cell data by A1 address. */
  getCell(address: string): Promise<CellData>;
  /** Get cell data by row/col. */
  getCell(row: number, col: number): Promise<CellData>;

  /** Get a 2D array of cell data for a range (A1 notation). */
  getRange(range: string): Promise<CellData[][]>;
  /** Get a 2D array of cell data for a range (CellRange object). */
  getRange(range: CellRange): Promise<CellData[][]>;
  /** Get a 2D array of cell data for a range (numeric bounds). */
  getRange(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<CellData[][]>;

  /**
   * Get cell data for multiple ranges at once (spreadsheet special-cell typeWorksheet.getRanges equivalent).
   *
   * @param addresses - Comma-separated A1-style range addresses (e.g. "A1:B5,D1:E5,G1")
   * @returns Array of 2D cell data arrays, one per address
   */
  getRanges(addresses: string): Promise<CellData[][][]>;

  /**
   * Set a 2D array of values into a range (A1 notation).
   * String values starting with "=" are treated as formulas.
   */
  setRange(range: string, values: (CellValuePrimitive | Date)[][]): Promise<void>;
  /**
   * Set a 2D array of values into a range (CellRange object).
   * String values starting with "=" are treated as formulas.
   */
  setRange(range: CellRange, values: (CellValuePrimitive | Date)[][]): Promise<void>;
  /**
   * Set a 2D array of values into a range (starting at row/col).
   * String values starting with "=" are treated as formulas.
   */
  setRange(
    startRow: number,
    startCol: number,
    values: (CellValuePrimitive | Date)[][],
  ): Promise<void>;

  /**
   * Enter a CSE (`Ctrl+Shift+Enter`) array formula on the given range.
   *
   * The formula is stored only on the top-left anchor; covered cells
   * are projections of the array result and read-only. Editing any
   * covered cell via `setCell` is rejected by Rust compute-core with
   * `ComputeError::PartialArrayWrite`. Tearing down the array formula
   * is `clear` / `setCell(anchor, null)` on the anchor.
   *
   * Distinct from a regular `setCell` of an array-returning formula:
   * dynamic-array spills allow blocker-literal writes into spill
   * members (raise `#SPILL!`), CSE rejects all partial writes.
   */
  setArrayFormula(range: CellRange, formula: string): Promise<void>;

  /** Clear all cell data (values and formulas) in a range (A1 notation, e.g. "A1:C3"). */
  clearData(range: string): Promise<ClearResult>;
  /** Clear all cell data (values and formulas) in a range (CellRange object). */
  clearData(range: CellRange): Promise<ClearResult>;
  /** Clear all cell data (values and formulas) in a range (numeric bounds). */
  clearData(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<ClearResult>;

  /**
   * Unified clear with mode selection (spreadsheet special-cell typeRange.clear equivalent).
   *
   * @param range - A1 range string (e.g. "A1:C3")
   * @param applyTo - What to clear: 'all' (default), 'contents', 'formats', 'hyperlinks'
   */
  clear(range: string, applyTo?: ClearApplyTo): Promise<ClearResult>;
  clear(range: CellRange, applyTo?: ClearApplyTo): Promise<ClearResult>;

  /**
   * Clear cell contents with form control awareness (spreadsheet special-cell typeclearOrResetContents equivalent).
   *
   * For cells linked to form controls: resets the control to its default value
   * (checkbox -> unchecked/false, comboBox -> first item/empty).
   * For all other cells: clears contents normally (same as clear(range, 'contents')).
   *
   * @param range - A1 range string (e.g. "A1:C3")
   */
  clearOrResetContents(range: string): Promise<void>;

  // ===========================================================================
  // Cell controls (checkbox, future: toggle, dropdown)
  // ===========================================================================

  /**
   * Get the cell control (e.g., checkbox) for a cell by A1 address.
   * Returns undefined if the cell does not contain a control.
   */
  getControl(address: string): Promise<CellControl | undefined>;
  /** Get the cell control by row/col. */
  getControl(row: number, col: number): Promise<CellControl | undefined>;

  /**
   * Set or clear a cell control by A1 address.
   * Pass undefined to remove the control and revert to a plain cell.
   */
  setControl(address: string, control: CellControl | undefined): Promise<void>;
  /** Set or clear a cell control by row/col. */
  setControl(row: number, col: number, control: CellControl | undefined): Promise<void>;

  // ===========================================================================
  // Convenience value access
  // ===========================================================================

  /** Get the computed value of a cell by A1 address. Returns null for empty cells. Error cells are returned as display strings (e.g. "#DIV/0!"). */
  getValue(address: string): Promise<CellValuePrimitive>;
  /** Get the computed value of a cell by row/col. Returns null for empty cells. Error cells are returned as display strings (e.g. "#DIV/0!"). */
  getValue(row: number, col: number): Promise<CellValuePrimitive>;

  /** Get all cell values in the used range as a 2D array. Returns [] if sheet is empty. */
  getData(): Promise<CellValue[][]>;

  /**
   * Get cell values for a range as a 2D array. Returns primitive values only
   * (no formatting, formulas, or metadata). Empty cells are null.
   *
   * This is the most common read pattern for SDK/LLM consumers.
   *
   * @param range - A1-style range string (e.g. "A1:C10")
   * @returns 2D array of cell values
   */
  getValues(range: string): Promise<CellValue[][]>;

  // ===========================================================================
  // Formula access
  // ===========================================================================

  /**
   * Evaluate a formula expression in the context of this sheet without writing
   * it to any cell. The expression should not include the leading `=`.
   *
   * @example
   *   const total = await ws.evaluate("SUM(A1:A10)");
   *
   * @param expression - Formula expression string (e.g. "SUM(A1:A10)")
   * @returns The computed result value
   */
  evaluate(expression: string): Promise<CellValue>;

  /**
   * Validate a formula expression in the context of this sheet without writing
   * it to any cell. Returns `null` when the formula is syntactically valid.
   *
   * Unlike {@link evaluate}, this is a raw commit-time syntax check: it does
   * not normalize or auto-correct incomplete input before parsing.
   */
  validateFormulaSyntax(formula: string): Promise<FormulaSyntaxValidationError | null>;

  /**
   * Validate whether entering a formula at row/col would create a circular
   * reference. Returns `null` when the formula is allowed.
   */
  validateFormulaCircularReference(
    formula: string,
    row: number,
    col: number,
  ): Promise<FormulaCircularReferenceValidation | null>;

  /** Get the formula of a cell by A1 address (null if not a formula cell). */
  getFormula(address: string): Promise<string | null>;
  /** Get the formula of a cell by row/col. */
  getFormula(row: number, col: number): Promise<string | null>;

  /** Get formulas for a range. Returns 2D array: formula string or null per cell. */
  getFormulas(range: string): Promise<(string | null)[][]>;

  /**
   * Get formulas for a range in R1C1 notation. Returns 2D array: R1C1 formula string or null per cell.
   *
   * References are converted relative to each cell's position:
   * - `$A$1` (absolute) becomes `R1C1`
   * - `A1` relative to cell B2 becomes `R[-1]C[-1]`
   * - `$A1` relative to cell B2 becomes `R[-1]C1` (mixed)
   *
   * @param range - A1-style range string (e.g. "A1:C10")
   */
  getFormulasR1C1(range: string): Promise<(string | null)[][]>;

  /**
   * Get the array formula for a cell that is part of a dynamic array spill.
   *
   * If the cell is the source of a dynamic array (e.g., =SEQUENCE(5)), returns
   * the formula. If the cell is a spill member (projected from a source), returns
   * the source cell's formula. Returns null if the cell is not part of an array.
   *
   * @param address - A1-style cell address
   * @returns The array formula string, or null if not an array cell
   */
  getFormulaArray(address: string): Promise<string | null>;
  /**
   * Get the array formula for a cell that is part of a dynamic array spill.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  getFormulaArray(row: number, col: number): Promise<string | null>;

  // ===========================================================================
  // Bulk reads
  // ===========================================================================

  /** Get raw cell data (value, formula, format, borders, etc.) by A1 address. */
  getRawCellData(address: string, includeFormula?: boolean): Promise<RawCellData>;
  /** Get raw cell data by row/col. */
  getRawCellData(row: number, col: number, includeFormula?: boolean): Promise<RawCellData>;

  /** Get raw data for a range as a 2D array (A1 notation or CellRange). */
  getRawRangeData(
    range: string | CellRange,
    options?: { includeFormula?: boolean },
  ): Promise<RawCellData[][]>;
  /** Get raw data for a range as a 2D array (numeric bounds). */
  getRawRangeData(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    includeFormula?: boolean,
  ): Promise<RawCellData[][]>;
  /** @deprecated Use the overloads above instead. */
  getRawRangeData(range: string, includeFormula?: boolean): Promise<RawCellData[][]>;

  /**
   * Get all non-empty cells in a range with stable CellId identity.
   *
   * Returns a flat array of cells (not a 2D grid) — only cells with data
   * are included. Each cell includes its CellId, position, computed value,
   * formula text (if formula cell), and pre-formatted display string.
   *
   * Used by operations that need identity-aware cell data (find-replace,
   * clipboard, cell relocation).
   */
  getRangeWithIdentity(range: string | CellRange): Promise<IdentifiedCellData[]>;
  getRangeWithIdentity(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<IdentifiedCellData[]>;

  // ===========================================================================
  // LLM presentation (A1 only -- returns formatted strings for agent context)
  // ===========================================================================

  /** Get a human-readable description of a cell or the entire used range.
   *  With address: returns compact cell string — "Revenue | =SUM(B2:B10) | [bold]"
   *  Without address: returns describeRange() over the used range (or empty string if sheet is empty) */
  describe(address?: string): Promise<string>;

  /** Get a tabular description of a range with formula abbreviation. */
  describeRange(range: string | CellRange, includeStyle?: boolean): Promise<string>;

  /** Get a sheet overview summary for agent context. */
  summarize(options?: SummaryOptions): Promise<string>;

  // ===========================================================================
  // Query
  // ===========================================================================

  /** Get the used range, or null if the sheet is empty. */
  getUsedRange(): Promise<CellRange | null>;

  /** Get the contiguous data region around a cell (Excel's Ctrl+Shift+* / CurrentRegion). */
  getCurrentRegion(row: number, col: number): Promise<CellRange>;

  /** Find the data edge in a direction (Excel's Ctrl+Arrow). Single bridge call to Rust. */
  findDataEdge(
    row: number,
    col: number,
    direction: 'up' | 'down' | 'left' | 'right',
  ): Promise<{ row: number; col: number }>;

  /** Find the last populated row in a column. Returns data and formatting edges. */
  findLastRow(col: number): Promise<{ lastDataRow: number | null; lastFormatRow: number | null }>;

  /** Find the last populated column in a row. Returns data and formatting edges. */
  findLastColumn(
    row: number,
  ): Promise<{ lastDataCol: number | null; lastFormatCol: number | null }>;

  /** Find all cells matching a predicate. Returns A1 addresses. Searches entire sheet or optionally within a range. */
  findCells(predicate: (cell: CellData) => boolean, range?: string): Promise<string[]>;

  /** Find all cells with a specific value. Returns A1 addresses. Searches entire sheet or optionally within a range. */
  findByValue(value: CellValue, range?: string): Promise<string[]>;

  /** Find all cells whose formula matches a regex pattern. Returns A1 addresses. Searches entire sheet or optionally within a range. */
  findByFormula(pattern: RegExp, range?: string): Promise<string[]>;

  /** Search cells using regex patterns. */
  regexSearch(patterns: string[], options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Detect cells whose numeric sign disagrees with their neighbors.
   * Returns anomalies sorted by severity — the agent decides which are real errors.
   */
  signCheck(range?: string, options?: SignCheckOptions): Promise<SignCheckResult>;

  /**
   * Find the first cell matching text within a range (spreadsheet special-cell typeRange.find equivalent).
   *
   * @param range - A1 range string to search within
   * @param text - Text or regex pattern to search for
   * @param options - Search options (matchCase, entireCell)
   * @returns The first matching SearchResult, or null if no match found
   */
  findInRange(
    range: string,
    text: string,
    options?: FindInRangeOptions,
  ): Promise<SearchResult | null>;

  /**
   * Find and replace all occurrences within a range (spreadsheet special-cell typeRange.replaceAll equivalent).
   *
   * @param range - A1 range string to search within
   * @param text - Text to find
   * @param replacement - Replacement text
   * @param options - Search options (matchCase, entireCell)
   * @returns Number of replacements made
   */
  replaceAll(
    range: string,
    text: string,
    replacement: string,
    options?: FindInRangeOptions,
  ): Promise<number>;

  /**
   * Get the extended range in a direction (spreadsheet special-cell typeRange.getExtendedRange / Ctrl+Shift+Arrow).
   *
   * From the active cell (default: top-left of range), finds the data edge in the given
   * direction and returns a range extending from the original range to that edge.
   *
   * @param range - A1 range string (current selection)
   * @param direction - Direction to extend
   * @param activeCell - Optional active cell override (default: top-left of range)
   * @returns Extended range as CellRange
   */
  getExtendedRange(
    range: string,
    direction: 'up' | 'down' | 'left' | 'right',
    activeCell?: { row: number; col: number },
  ): Promise<CellRange>;

  /**
   * Check if a range represents entire column(s) (e.g., "A:C").
   *
   * @param range - A1 range string or CellRange object
   * @returns True if the range represents entire column(s)
   */
  isEntireColumn(range: string | CellRange): boolean;

  /**
   * Check if a range represents entire row(s) (e.g., "1:5").
   *
   * @param range - A1 range string or CellRange object
   * @returns True if the range represents entire row(s)
   */
  isEntireRow(range: string | CellRange): boolean;

  /**
   * Get only the visible (non-hidden) rows from a range (visible range-view equivalent).
   *
   * Filters out rows hidden by AutoFilter or manual hide operations.
   * Returns cell values for visible rows only, along with the absolute row indices.
   *
   * @param range - A1 range string (e.g., "A1:Z100")
   * @returns Visible rows' values and their indices
   */
  getVisibleView(range: string): Promise<VisibleRangeView>;

  /**
   * Find cells matching a special cell type (spreadsheet special-cell typeRange.getSpecialCells equivalent).
   *
   * Returns addresses of cells matching the specified type within the used range.
   * Optionally filter by value type when cellType is `Constants` or `Formulas`.
   *
   * @param cellType - The type of cells to find
   * @param valueType - Optional value type filter (only for Constants/Formulas)
   * @returns Array of matching cell addresses
   */
  getSpecialCells(cellType: CellType, valueType?: CellValueType): Promise<string[]>;

  // ===========================================================================
  // Editing
  // ===========================================================================

  /**
   * Get the edit-mode string representation of a cell value.
   * Used by formula bar and in-cell editing.
   *
   * For formula cells, returns the formula string (e.g. "=SUM(A1:A10)").
   * For date/time cells, returns pre-computed edit text if available.
   * For value cells, returns the raw value as a string.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param editText - Optional pre-computed edit text (for date/time cells)
   * @returns The string to display in edit mode
   */
  getValueForEditing(row: number, col: number, editText?: string): Promise<string>;

  // ===========================================================================
  // Display
  // ===========================================================================

  /** Get the display value (formatted string) for a cell by A1 address. */
  getDisplayValue(address: string): Promise<string>;
  /** Get the display value (formatted string) for a cell by row/col. */
  getDisplayValue(row: number, col: number): Promise<string>;

  /**
   * Get the formatted display values for a range as a 2D array.
   *
   * Returns the same formatted strings shown in each cell (number formats applied,
   * dates formatted, etc.). This is the range counterpart to `getDisplayValue()`.
   *
   * @param range - A1-style range string (e.g. "A1:C10")
   * @returns 2D array of formatted display strings
   */
  getDisplayValues(range: string): Promise<string[][]>;

  /**
   * Get per-cell value type classification for a range (spreadsheet special-cell typeRange.valueTypes equivalent).
   *
   * @param range - A1 range string or CellRange object
   * @returns 2D array of RangeValueType enums
   */
  getValueTypes(range: string | CellRange): Promise<RangeValueType[][]>;

  /**
   * Get per-cell number format category for a range (spreadsheet special-cell typeRange.numberFormatCategories equivalent).
   *
   * @param range - A1 range string or CellRange object
   * @returns 2D array of NumberFormatCategory enums
   */
  getNumberFormatCategories(range: string | CellRange): Promise<NumberFormatCategory[][]>;

  // ===========================================================================
  // Sort / batch / autofill
  // ===========================================================================

  /** Sort a range by the specified options (A1 notation). */
  sortRange(range: string, options: SortOptions): Promise<void>;
  /** Sort a range by the specified options (CellRange object). */
  sortRange(range: CellRange, options: SortOptions): Promise<void>;

  /**
   * Sort a range by cell or font color, putting matched-color rows on top or bottom.
   *
   * Convenience wrapper over {@link sortRange} with a single color-keyed criterion.
   * Excel/ECMA-376 vocabulary: `'fill'` is the cell background fill, `'font'` is
   * the cell font color. Compares the resolved per-cell effective format.
   *
   * @param range - A1-style range string or CellRange object
   * @param opts - Color sort options (column, color type, target color, top/bottom position)
   */
  sortByColor(range: string | CellRange, opts: SortByColorOptions): Promise<void>;

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
  ): Promise<AutoFillResult>;

  /**
   * Fill a range with a series (Edit > Fill > Series dialog equivalent).
   * More explicit than autoFill — caller specifies exact series parameters.
   *
   * The range contains BOTH source cells (first row/col) and target cells (rest).
   * The kernel splits them based on direction.
   *
   * @param range - Range in A1 notation containing source + target cells
   * @param options - Series parameters (type, step, stop, direction, etc.)
   */
  fillSeries(range: string, options: FillSeriesOptions): Promise<void>;

  /**
   * Move (relocate) cells from a source range to a target position.
   *
   * Moves cell values, formulas, and formatting. Formula references within the
   * moved range are adjusted to the new position. The source range is cleared
   * after the move.
   *
   * @param sourceRange - Source range in A1 notation (e.g., "A1:B10")
   * @param targetRow - Destination top-left row (0-based)
   * @param targetCol - Destination top-left column (0-based)
   */
  moveTo(sourceRange: string, targetRow: number, targetCol: number): Promise<void>;

  /**
   * Copy cells from a source range to a target range with optional paste-special behavior.
   *
   * Supports selective copy (values only, formulas only, formats only, or all),
   * skip-blanks, and transpose. Maps to spreadsheet special-cell typeRange.copyFrom().
   *
   * @param sourceRange - Source range in A1 notation (e.g., "A1:B10")
   * @param targetRange - Target range in A1 notation (e.g., "D1:E10")
   * @param options - Optional paste-special behavior (copyType, skipBlanks, transpose)
   */
  copyFrom(sourceRange: string, targetRange: string, options?: CopyFromOptions): Promise<void>;
  /**
   * Copy cells from a source range to a target position with optional paste-special behavior.
   *
   * Numeric overload — source is defined by (row, col) bounds, target by top-left (row, col).
   *
   * @param srcStartRow - Source start row (0-based)
   * @param srcStartCol - Source start column (0-based)
   * @param srcEndRow - Source end row (0-based, inclusive)
   * @param srcEndCol - Source end column (0-based, inclusive)
   * @param tgtStartRow - Target top-left row (0-based)
   * @param tgtStartCol - Target top-left column (0-based)
   * @param options - Optional paste-special behavior (copyType, skipBlanks, transpose)
   */
  copyFrom(
    srcStartRow: number,
    srcStartCol: number,
    srcEndRow: number,
    srcEndCol: number,
    tgtStartRow: number,
    tgtStartCol: number,
    options?: CopyFromOptions,
  ): Promise<void>;

  /**
   * Bulk-write scattered cell values and/or formulas in a single IPC call.
   * Values starting with "=" are treated as formulas.
   *
   * Supports both A1 addressing and numeric (row, col) addressing.
   */
  setCells(
    cells: Array<{ addr: string; value: CellValuePrimitive | Date }>,
  ): Promise<SetCellsResult>;
  setCells(
    cells: Array<{ address: string; value: CellValuePrimitive | Date }>,
  ): Promise<SetCellsResult>;
  setCells(
    cells: Array<{ row: number; col: number; value: CellValuePrimitive | Date }>,
  ): Promise<SetCellsResult>;

  // ===========================================================================
  // Export helpers
  // ===========================================================================

  /**
   * Export the used range as a CSV string (RFC 4180 compliant).
   *
   * Fields containing commas, quotes, or newlines are quoted.
   * Double-quotes inside fields are escaped as "".
   * Formula injection is prevented by prefixing `=`, `+`, `-`, `@` with a tab character.
   *
   * @param options - Optional separator (default ",")
   */
  toCSV(options?: { separator?: string; range?: string }): Promise<string>;

  /**
   * Export the used range as an array of row objects.
   *
   * By default, the first row is used as header keys.
   * Pass `headerRow: 'none'` to use column letters (A, B, C, ...) as keys.
   * Pass `headerRow: N` to use a specific 0-based row as headers.
   *
   * @param options - Optional header row configuration and range
   */
  toJSON(options?: {
    headerRow?: number | 'none';
    range?: string;
  }): Promise<Record<string, CellValue>[]>;

  // ===========================================================================
  // Dependencies
  // ===========================================================================

  /** Get cells that depend on this cell by A1 address. */
  getDependents(address: string): Promise<string[]>;
  /** Get cells that depend on this cell by row/col. */
  getDependents(row: number, col: number): Promise<string[]>;

  /** Get cells that this cell depends on by A1 address. */
  getPrecedents(address: string): Promise<string[]>;
  /** Get cells that this cell depends on by row/col. */
  getPrecedents(row: number, col: number): Promise<string[]>;

  // ===========================================================================
  // Calculation control
  // ===========================================================================

  /**
   * Per-sheet toggle that controls whether formulas on this sheet are
   * recalculated. When `false`, formulas retain their last computed value but
   * do not recalculate when dependencies change.
   *
   * Defaults to `true`.
   */
  enableCalculation: boolean;

  /**
   * Force recalculation of this sheet.
   *
   * @param markAllDirty - If `true`, marks all formula cells on this sheet as
   *   dirty before recalculating (equivalent to a full sheet recalc). Defaults
   *   to `false`, which recalculates only cells already marked dirty.
   */
  calculate(markAllDirty?: boolean): Promise<void>;

  // ===========================================================================
  // Utility
  // ===========================================================================

  /** Get aggregates (SUM, COUNT, AVG, MIN, MAX) for selected ranges. */
  getSelectionAggregates(ranges: CellRange[]): Promise<AggregateResult>;

  /** Batch-format values using number format codes. Returns formatted strings. */
  formatValues(entries: FormatEntry[]): Promise<string[]>;

  /** What-If analysis: goal seek, data tables, and parametric evaluation */
  readonly whatIf: WorksheetWhatIf;

  // ===========================================================================
  // Visibility
  // ===========================================================================

  /** Get the visibility state of the sheet ('visible', 'hidden', or 'veryHidden'). */
  getVisibility(): Promise<'visible' | 'hidden' | 'veryHidden'>;
  /** Set the visibility state of the sheet. */
  setVisibility(state: 'visible' | 'hidden' | 'veryHidden'): Promise<void>;

  // ===========================================================================
  // Navigation
  // ===========================================================================

  /** Returns the next worksheet. If `visibleOnly` is true, skips hidden sheets. Throws if no next sheet exists. */
  getNext(visibleOnly?: boolean): Promise<Worksheet>;
  /** Returns the next worksheet, or null if none exists. If `visibleOnly` is true, skips hidden sheets. */
  getNextOrNull(visibleOnly?: boolean): Promise<Worksheet | null>;
  /** Returns the previous worksheet. If `visibleOnly` is true, skips hidden sheets. Throws if no previous sheet exists. */
  getPrevious(visibleOnly?: boolean): Promise<Worksheet>;
  /** Returns the previous worksheet, or null if none exists. If `visibleOnly` is true, skips hidden sheets. */
  getPreviousOrNull(visibleOnly?: boolean): Promise<Worksheet | null>;

  // ===========================================================================
  // Sheet-level events (replaces ctx.eventBus for sheet-scoped events)
  // ===========================================================================

  /**
   * Subscribe to sheet-level events. Returns a CallableDisposable (callable + disposable).
   *
   * Accepts both coarse SheetEvent types (recommended default) and fine-grained
   * internal event type strings (escape hatch for perf-sensitive callers).
   * Handler receives the internal event directly — no wrapper.
   */
  on<K extends keyof SheetEventMap>(
    event: K,
    handler: (event: SheetEventMap[K]) => void,
  ): CallableDisposable;
  on<T extends InternalEventType>(
    event: T,
    handler: (event: EventByType<T>) => void,
  ): CallableDisposable;
  on(event: string, handler: (event: unknown) => void): CallableDisposable;

  // ===========================================================================
  // Bridge sub-interfaces (replaces ctx.diagram)
  // ===========================================================================

  /** Diagram operations (CRUD, node ops, layout, cache). */
  readonly diagrams: WorksheetDiagrams;

  // ===========================================================================
  // Reactive caches
  // ===========================================================================

  /** Cell metadata cache — projections and validation errors (replaces cellMetadataCache factory). */
  readonly cellMetadata: CellMetadataCache;

  // ===========================================================================
  // Viewport — sync render-path data (replaces ctx.viewportBuffer)
  // ===========================================================================

  /** Sync viewport reader for 60fps render paths. */
  readonly viewport: ViewportReader;

  /**
   * Refresh the active-cell metadata cache (Stream C fix).
   *
   * Call this when the active cell changes (selection move) so the viewport
   * reader's `getActiveCellData()` returns up-to-date metadata — including
   * `isCseAnchor` — and the formula bar can immediately display `{=…}` braces
   * for CSE array formula cells.
   *
   * Looks up the cellId at the given position and calls the compute bridge's
   * `refreshActiveCell`. Safe to call speculatively; no-ops if the cell has
   * no id (empty cell).
   */
  refreshActiveCellData(row: number, col: number): Promise<void>;

  /**
   * Refresh the active-cell edit-source read model for the given cell.
   *
   * This is infrastructure for edit-entry hot paths. It is intentionally scoped
   * to the active cell rather than exposing arbitrary synchronous cell reads.
   */
  refreshActiveCellEditSource(row: number, col: number): Promise<void>;

  /**
   * Synchronously read the active-cell edit-source cache when it matches the
   * requested cell and is fresh. Returns null for stale/missing/different-cell
   * data so callers can fall back to one Rust-owned edit-source query.
   */
  getActiveCellEditSource(row: number, col: number): ActiveCellEditSource | null;

  // ===========================================================================
  // Sub-API namespaces (domain-specific operations)
  // ===========================================================================

  /** Opt-in change tracking (dirty cells, cascades, collab diffs) */
  readonly changes: WorksheetChanges;
  /** Cell visual formatting (bold, color, borders, etc.) */
  readonly formats: WorksheetFormats;
  /** Row/column sizing and visibility */
  readonly layout: WorksheetLayout;
  /** Freeze panes, split, gridlines, headings, tab color */
  readonly view: WorksheetView;
  /** Insert/delete rows/columns, merges, text-to-columns, dedup */
  readonly structure: WorksheetStructure;
  /** Chart CRUD */
  readonly charts: WorksheetCharts;
  /** All floating objects: shapes, pictures, text boxes, equations, text-effects, diagram, ink */
  readonly objects: WorksheetObjectCollection;

  // ── Typed floating object collections (object-managed types) ──
  /** Shape objects. */
  readonly shapes: WorksheetShapeCollection;
  /** Picture objects. */
  readonly pictures: WorksheetPictureCollection;
  /** Text box objects. */
  readonly textBoxes: WorksheetTextBoxCollection;
  /** Ink drawing objects. */
  readonly drawings: WorksheetDrawingCollection;
  /** Equation objects. */
  readonly equations: WorksheetEquationCollection;
  /** Decorative text-effect objects. */
  readonly textEffects: WorksheetTextEffectCollection;
  /** Connector objects. */
  readonly connectors: WorksheetConnectorCollection;
  /** AutoFilter, column filters, sort state */
  readonly filters: WorksheetFilters;
  /** Form controls (Checkbox, Button, ComboBox) */
  readonly formControls: WorksheetFormControls;
  /** Conditional formatting CRUD */
  readonly conditionalFormats: WorksheetConditionalFormatting;
  /** Data validation rules for this worksheet. */
  readonly validations: WorksheetValidation;
  /** Table CRUD and metadata */
  readonly tables: WorksheetTables;
  /** Pivot table CRUD */
  readonly pivots: WorksheetPivots;
  /** Slicer CRUD */
  readonly slicers: WorksheetSlicers;
  /** Sparkline CRUD and groups */
  readonly sparklines: WorksheetSparklines;
  /** Notes and threaded comments */
  readonly comments: WorksheetComments;
  /** Sheet-level custom properties (key-value store) */
  readonly customProperties: WorksheetCustomProperties;
  /** Hyperlink CRUD */
  readonly hyperlinks: WorksheetHyperlinks;
  /** Row/column grouping, outline levels, subtotals */
  readonly outline: WorksheetOutline;
  /** Sheet protection */
  readonly protection: WorksheetProtection;
  /** Print settings and page breaks */
  readonly print: WorksheetPrint;
  /** Sheet settings and custom lists */
  readonly settings: WorksheetSettings;
  /** Data source bindings and projections */
  readonly bindings: WorksheetBindings;
  /** Sheet-scoped named ranges */
  readonly names: WorksheetNames;
  /** Named cell style application and lookup */
  readonly styles: WorksheetStyles;

  // ===========================================================================
  // Internal plumbing (not public API — for bridges, formula bar, action handlers)
  // ===========================================================================

  /**
   * Inject the bounds reader (from the renderer's SceneGraphBoundsReader) so that
   * floating-object handles can resolve pixel bounds via `handle.getBounds()`.
   *
   * Calling this invalidates cached typed collections so they pick up the new reader
   * on their next access.
   */
  setBoundsReader(reader: IObjectBoundsReader): void;
}

/**
 * WorksheetWithInternals — Infrastructure-tier Worksheet interface.
 *
 * Extends the app-facing Worksheet with properties that only infrastructure code
 * (shell, coordinator, action handlers, formula bar) should access.
 * SDK consumers and LLMs must NOT use this interface; they should use Worksheet.
 */
export interface WorksheetWithInternals extends Worksheet {
  /** Emit a sheet-level event. Infrastructure-only — used by coordinator mutations. */
  emit(event: SpreadsheetEvent): void;

  /**
   * Internal operations needed by bridges, formula bar, and action handlers.
   * Infrastructure-only.
   */
  readonly _internal: WorksheetInternal;
}
