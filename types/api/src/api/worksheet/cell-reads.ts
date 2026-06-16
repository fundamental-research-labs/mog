import type { CellFormat, CellValuePrimitive, SheetId } from '@mog/types-core/core';
import type { FormulaA1 } from '@mog/types-core/formula-string';
import type { RangeValueType } from '../types';

/** Normalized origin metadata repeated on every address-bearing range cell. */
export interface WorksheetRangeOrigin {
  /** A1 range actually read, normalized from the supplied input. */
  readonly address: string;
  /** Absolute top-left row and column of the range (0-indexed). */
  readonly startRow: number;
  readonly startCol: number;
  /** Absolute bottom-right row and column of the range (0-indexed). */
  readonly endRow: number;
  readonly endCol: number;
}

/** Shared absolute and range-relative identity for address-bearing range cells. */
export interface WorksheetRangeCellBase {
  /** Sheet display name at read time. */
  readonly sheet: string;
  /** Stable internal sheet id. */
  readonly sheetId: SheetId;
  /** A1 cell address, e.g. `"B3"`. */
  readonly address: string;
  /** Absolute sheet row and column (0-indexed). */
  readonly row: number;
  readonly col: number;
  /** Offset from the requested range's top-left cell (0-indexed). */
  readonly offsetRow: number;
  readonly offsetCol: number;
  /** Requested range origin and bounds. */
  readonly range: WorksheetRangeOrigin;
}

/**
 * Address-bearing bulk cell read record returned by `Worksheet.getCells` and
 * `Worksheet.cells.list`.
 */
export interface WorksheetRangeCell extends WorksheetRangeCellBase {
  /** Computed cell value. Empty cells are `null`; error cells use display strings. */
  readonly value: CellValuePrimitive;
  /** Per-cell value type classification matching `RangeValueType`. */
  readonly valueType: RangeValueType;
  /** Authored formula (A1) when present; `null` otherwise. */
  readonly formula: FormulaA1 | null;
  /** Cell formatting when explicitly present. */
  readonly format?: CellFormat;
  /** Pre-formatted display string when available from compute. */
  readonly formatted?: string;
}

/** Values-only address-bearing range cell shape. */
export interface WorksheetRangeValueCell extends WorksheetRangeCellBase {
  readonly value: CellValuePrimitive;
  readonly valueType: RangeValueType;
  readonly formatted?: string;
}

/** Formula-only address-bearing range cell shape. */
export interface WorksheetRangeFormulaCell extends WorksheetRangeCellBase {
  readonly value: CellValuePrimitive;
  readonly valueType: RangeValueType;
  readonly formula: FormulaA1;
  readonly formatted?: string;
}

/** Options for address-bearing bulk cell reads. */
export interface WorksheetGetCellsOptions {
  /**
   * If true, omit cells with no value, formula, format, or formatted display.
   * Defaults to false so the output shape covers every coordinate in the range.
   */
  readonly sparse?: boolean;
  /**
   * Return only address/value/type/display fields. Mutually exclusive with
   * `formulasOnly`.
   */
  readonly valuesOnly?: boolean;
  /**
   * Return only formula cells, with address/value/type/formula/display fields.
   * Mutually exclusive with `valuesOnly`.
   */
  readonly formulasOnly?: boolean;
}

export interface WorksheetGetCellsFullOptions extends WorksheetGetCellsOptions {
  readonly valuesOnly?: false;
  readonly formulasOnly?: false;
}

export interface WorksheetGetCellsValuesOnlyOptions extends WorksheetGetCellsOptions {
  readonly valuesOnly: true;
  readonly formulasOnly?: false;
}

export interface WorksheetGetCellsFormulasOnlyOptions extends WorksheetGetCellsOptions {
  readonly formulasOnly: true;
  readonly valuesOnly?: false;
}

/** Callback used by `Worksheet.forEachCell`. */
export type WorksheetCellVisitor = (
  cell: WorksheetRangeCell,
  index: number,
) => void | Promise<void>;
