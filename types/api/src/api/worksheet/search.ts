import type { FormulaA1 } from '@mog/types-core/formula-string';
import type { CellFormat, CellRange, CellValue } from '@mog/types-core/core';
import type { RangeValueType } from '../types';

/** Value-type filters accepted by `worksheet.findCells(query)`. */
export type FindCellsValueType =
  | RangeValueType
  | 'empty'
  | 'string'
  | 'number'
  | 'boolean'
  | 'error';

/** Basic format filters accepted by `worksheet.findCells(query)`. */
export interface FindCellsFormatQuery {
  /** Match cell background colors. `fillColor` is accepted as an alias by the runtime. */
  backgroundColor?: string | string[];
  /** Ergonomic alias for `backgroundColor`. */
  fillColor?: string | string[];
  /** Match font colors. */
  fontColor?: string | string[];
  /** Match bold state. */
  bold?: boolean;
}

/** Optional fields to include in `worksheet.findCells(query)` result cells. */
export type FindCellsInclude = 'value' | 'formula' | 'formatted' | 'format';

/** Declarative cell query for `worksheet.findCells(query)`. */
export interface FindCellsQuery {
  /** Limit search to this A1 range or CellRange. Defaults to the used range. */
  range?: string | CellRange;
  /** Match blank cells. Blank means no formula and an empty/null value. */
  blank?: boolean;
  /** Match formula presence. */
  hasFormula?: boolean;
  /** Match one or more value types. */
  valueType?: FindCellsValueType | FindCellsValueType[];
  /** Match basic format properties. */
  format?: FindCellsFormatQuery;
  /** Fields to include beyond address/row/col. */
  include?: FindCellsInclude[];
  /** Maximum result cells for this page. Default 1000; maximum 5000. */
  pageSize?: number;
  /** Cursor returned by the previous page. */
  cursor?: string;
}

/** A structured cell match returned by `worksheet.findCells(query)`. */
export interface FoundCell {
  /** Cell address in A1 notation. */
  address: string;
  /** Zero-based row index. */
  row: number;
  /** Zero-based column index. */
  col: number;
  /** Included when requested with `include: ['value']`. */
  value?: CellValue;
  /** Included when requested with `include: ['formula']`. */
  formula?: FormulaA1;
  /** Included when requested with `include: ['formatted']`. */
  formatted?: string;
  /** Included when requested with `include: ['format']`. */
  format?: CellFormat;
}

/** Paginated structured result returned by `worksheet.findCells(query)`. */
export interface FindCellsResult {
  /** Convenience list of matching A1 addresses. */
  addresses: string[];
  /** Structured matching cells. */
  cells: FoundCell[];
  /** Matching addresses compacted into row-contiguous A1 ranges. */
  ranges: string[];
  /** True when more results are available. */
  truncated: boolean;
  /** Pass to the next call to continue scanning. */
  nextCursor?: string;
}
