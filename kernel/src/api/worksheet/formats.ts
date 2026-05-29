/**
 * WorksheetFormatsImpl — Implementation of the WorksheetFormats sub-API.
 *
 * Calls computeBridge directly for simple operations.
 * Delegates to format-operations for complex logic (pattern replication).
 *
 * Protection policy: format mutators enforce Excel-compatible sheet protection
 * permissions by target shape before dispatching bridge writes.
 */

import type {
  CellFormat,
  CellRange,
  FormatChangeResult,
  ResolvedCellFormat,
  SheetId,
  WorksheetFormats,
} from '@mog-sdk/contracts/api';
import type { NumberFormatType } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { detectFormatType } from '@mog/spreadsheet-utils/number-formats';
import { KernelError, unwrap } from '../../errors';

import type { DocumentContext } from '../../context';
import { resolveCell, resolveCellArgs } from '../internal/address-resolver';
import {
  getNumberFormatLocal as getNumFmtLocal,
  setNumberFormatLocal as setNumFmtLocal,
} from '../internal/number-format-locale';
import { normalizeRange, parseCellRange } from '../internal/utils';
import {
  applyFormatToRange,
  getCellProperties as getCellPropertiesOp,
  getColumnProperties as getColumnPropertiesOp,
  getDisplayedCellProperties as getDisplayedCellPropertiesOp,
  getDisplayedRangeProperties as getDisplayedRangePropertiesOp,
  getRowProperties as getRowPropertiesOp,
  setCellProperties as setCellPropertiesOp,
  setColumnProperties as setColumnPropertiesOp,
  setRowProperties as setRowPropertiesOp,
} from './operations/format-operations';
import { assertFormatOperationsAllowed, assertFormatRangesAllowed } from './protection-guards';

export class WorksheetFormatsImpl implements WorksheetFormats {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async set(
    a: string | number,
    b: CellFormat | number,
    c?: CellFormat,
  ): Promise<FormatChangeResult> {
    this._ensureWritable('formats.set');
    const { row, col, value: format } = resolveCellArgs<CellFormat>(a, b, c);
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatCells']);
    const result = await this.ctx.computeBridge.setFormatForRanges(
      this.sheetId,
      [[row, col, row, col]],
      format,
    );
    return { cellCount: result.propertyChanges?.length ?? 0 };
  }

  async setRange(a: string | CellRange, b: CellFormat): Promise<FormatChangeResult> {
    this._ensureWritable('formats.setRange');
    let range: CellRange;
    if (typeof a === 'string') {
      const parsed = parseCellRange(a);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${a}"`);
      range = { sheetId: this.sheetId, ...parsed };
    } else {
      range = a;
    }
    const n = normalizeRange(range);
    await assertFormatRangesAllowed(this.ctx, this.sheetId, [range]);
    const result = await this.ctx.computeBridge.setFormatForRanges(
      this.sheetId,
      [[n.startRow, n.startCol, n.endRow, n.endCol]],
      b,
    );
    return { cellCount: result.propertyChanges?.length ?? 0 };
  }

  async setRanges(ranges: CellRange[], format: CellFormat): Promise<void> {
    this._ensureWritable('formats.setRanges');
    await assertFormatRangesAllowed(this.ctx, this.sheetId, ranges);
    const boundedRanges: Array<[number, number, number, number]> = [];
    const promises: Promise<unknown>[] = [];

    for (const range of ranges) {
      if (range.isFullColumn) {
        for (let col = range.startCol; col <= range.endCol; col++) {
          promises.push(this.ctx.computeBridge.setColFormat(this.sheetId, col, format));
        }
      } else if (range.isFullRow) {
        for (let row = range.startRow; row <= range.endRow; row++) {
          promises.push(this.ctx.computeBridge.setRowFormat(this.sheetId, row, format));
        }
      } else {
        boundedRanges.push([range.startRow, range.startCol, range.endRow, range.endCol]);
      }
    }

    if (boundedRanges.length > 0) {
      promises.push(this.ctx.computeBridge.setFormatForRanges(this.sheetId, boundedRanges, format));
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  async hasExplicit(a: string | number, b?: number): Promise<boolean> {
    const { row, col } = resolveCell(a, b);
    const result = await this.ctx.computeBridge.queryRange(this.sheetId, row, col, row, col);
    const format = (result?.cells?.[0]?.format as CellFormat | undefined) ?? null;
    return format != null && Object.keys(format).length > 0;
  }

  async clearCell(a: string | number, b?: number): Promise<void> {
    this._ensureWritable('formats.clearCell');
    const { row, col } = resolveCell(a, b);
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatCells']);
    await this.ctx.computeBridge.clearFormatForRanges(this.sheetId, [[row, col, row, col]]);
  }

  async clear(): Promise<void> {
    this._ensureWritable('formats.clear');
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatCells']);
    await this.ctx.computeBridge.clearFormatForRanges(this.sheetId, [
      [0, 0, MAX_ROWS - 1, MAX_COLS - 1],
    ]);
  }

  async clearRange(a: string | CellRange): Promise<void> {
    let range: CellRange;
    if (typeof a === 'string') {
      const parsed = parseCellRange(a);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${a}"`);
      range = { sheetId: this.sheetId, ...parsed };
    } else {
      range = a;
    }
    const n = normalizeRange(range);
    await assertFormatRangesAllowed(this.ctx, this.sheetId, [range]);
    await this.ctx.computeBridge.clearFormatForRanges(this.sheetId, [
      [n.startRow, n.startCol, n.endRow, n.endCol],
    ]);
  }

  async clearRanges(ranges: CellRange[]): Promise<void> {
    await assertFormatRangesAllowed(this.ctx, this.sheetId, ranges);
    const tuples: Array<[number, number, number, number]> = ranges.map((r) => {
      const n = normalizeRange(r);
      return [n.startRow, n.startCol, n.endRow, n.endCol];
    });
    if (tuples.length > 0) {
      await this.ctx.computeBridge.clearFormatForRanges(this.sheetId, tuples);
    }
  }

  async get(a: string | number, b?: number): Promise<ResolvedCellFormat> {
    const { row, col } = resolveCell(a, b);
    // The bridge codegen aliases CellFormat as ResolvedCellFormat, but the Rust endpoint
    // guarantees all fields are present (null, never undefined). Cast to our stricter mapped type.
    return this.ctx.computeBridge.getResolvedFormat(
      this.sheetId,
      row,
      col,
    ) as Promise<ResolvedCellFormat>;
  }

  async getDisplayedCellProperties(a: string | number, b?: number): Promise<CellFormat> {
    const { row, col } = resolveCell(a, b);
    return unwrap(await getDisplayedCellPropertiesOp(this.ctx, this.sheetId, row, col));
  }

  async getDisplayedRangeProperties(range: string | CellRange): Promise<CellFormat[][]> {
    let cellRange: CellRange;
    if (typeof range === 'string') {
      const parsed = parseCellRange(range);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
      cellRange = { sheetId: this.sheetId, ...parsed };
    } else {
      cellRange = range;
    }
    return unwrap(await getDisplayedRangePropertiesOp(this.ctx, this.sheetId, cellRange));
  }

  async adjustIndent(a: string | number, b: number, c?: number): Promise<void> {
    const { row, col, value: amount } = resolveCellArgs<number>(a, b, c);
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatCells']);
    const current = await this.get(row, col);
    const currentIndent = current?.indent ?? 0;
    const newIndent = Math.max(0, Math.min(250, currentIndent + amount));
    await this.ctx.computeBridge.setFormatForRanges(this.sheetId, [[row, col, row, col]], {
      indent: newIndent,
    });
  }

  async clearFill(a: string | number, b?: number): Promise<void> {
    const { row, col } = resolveCell(a, b);
    const rangeTuple: [number, number, number, number] = [row, col, row, col];
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatCells']);

    // Read the SPARSE cell format (not the resolved one) so we only re-apply
    // actual cell-level overrides, not inherited cascade values.
    const result = await this.ctx.computeBridge.queryRange(this.sheetId, row, col, row, col);
    const current = (result?.cells?.[0]?.format as CellFormat | undefined) ?? null;

    // Clear all formatting on the cell first.
    await this.ctx.computeBridge.clearFormatForRanges(this.sheetId, [rangeTuple]);

    if (current) {
      // Strip fill-related properties and re-apply everything else.
      const { backgroundColor, patternType, patternForegroundColor, gradientFill, ...rest } =
        current;
      const hasRest = Object.keys(rest).length > 0;
      if (hasRest) {
        await this.ctx.computeBridge.setFormatForRanges(this.sheetId, [rangeTuple], rest);
      }
    }
  }

  async clearFillForRanges(ranges: CellRange[]): Promise<void> {
    await assertFormatRangesAllowed(this.ctx, this.sheetId, ranges);
    for (const range of ranges) {
      const n = normalizeRange(range);
      const rangeTuple: [number, number, number, number] = [
        n.startRow,
        n.startCol,
        n.endRow,
        n.endCol,
      ];

      // Read sparse cell formats for the range
      const result = await this.ctx.computeBridge.queryRange(
        this.sheetId,
        n.startRow,
        n.startCol,
        n.endRow,
        n.endCol,
      );

      // Clear all format for the range
      await this.ctx.computeBridge.clearFormatForRanges(this.sheetId, [rangeTuple]);

      // Re-apply non-fill properties for each cell that had overrides
      for (const cell of result?.cells ?? []) {
        const current = cell.format as CellFormat | undefined;
        if (!current) continue;
        const {
          backgroundColor,
          backgroundColorTint,
          patternType,
          patternForegroundColor,
          patternForegroundColorTint,
          gradientFill,
          ...rest
        } = current as any;
        if (Object.keys(rest).length > 0) {
          await this.ctx.computeBridge.setFormatForRanges(
            this.sheetId,
            [[cell.row, cell.col, cell.row, cell.col]],
            rest,
          );
        }
      }
    }
  }

  async getNumberFormatCategory(a: string | number, b?: number): Promise<NumberFormatType> {
    const { row, col } = resolveCell(a, b);
    const format = await this.get(row, col);
    const formatCode = format?.numberFormat ?? 'General';
    return detectFormatType(formatCode);
  }

  async getNumberFormatLocal(a: string | number, b?: number): Promise<string> {
    const { row, col } = resolveCell(a, b);
    const format = await this.get(row, col);
    const formatCode = format?.numberFormat ?? 'General';
    return getNumFmtLocal(formatCode);
  }

  async setNumberFormatLocal(
    a: string | number,
    b: string | number,
    c?: string,
    d?: string,
  ): Promise<void> {
    let row: number, col: number, localFormat: string, locale: string;
    if (typeof a === 'string') {
      // setNumberFormatLocal(address, localFormat, locale)
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      localFormat = b as string;
      locale = c!;
    } else {
      // setNumberFormatLocal(row, col, localFormat, locale)
      row = a;
      col = b as number;
      localFormat = c!;
      locale = d!;
    }
    const internalFormat = setNumFmtLocal(localFormat, locale);
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatCells']);
    await this.ctx.computeBridge.setFormatForRanges(this.sheetId, [[row, col, row, col]], {
      numberFormat: internalFormat,
    });
  }

  async applyPattern(
    format: CellFormat,
    sourceRange: CellRange | null,
    targetRange: CellRange,
  ): Promise<void> {
    await assertFormatRangesAllowed(this.ctx, this.sheetId, [targetRange]);
    await applyFormatToRange(this.ctx, this.sheetId, format, sourceRange, targetRange);
  }

  // ---------------------------------------------------------------------------
  // Bulk Property Operations
  // ---------------------------------------------------------------------------

  async getCellProperties(
    a: string | number,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<Array<Array<CellFormat | null>>> {
    let range: CellRange;
    if (typeof a === 'string') {
      const parsed = parseCellRange(a);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${a}"`);
      range = { sheetId: this.sheetId, ...parsed };
    } else {
      range = {
        sheetId: this.sheetId,
        startRow: a,
        startCol: b!,
        endRow: c!,
        endCol: d!,
      };
    }
    return unwrap(await getCellPropertiesOp(this.ctx, this.sheetId, range));
  }

  async setCellProperties(
    updates: Array<{ row: number; col: number; format: Partial<CellFormat> }>,
  ): Promise<void> {
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatCells']);
    unwrap(
      await setCellPropertiesOp(
        this.ctx,
        this.sheetId,
        updates as Array<{ row: number; col: number; format: CellFormat }>,
      ),
    );
  }

  async getRowProperties(rows: number[]): Promise<Map<number, CellFormat>> {
    return unwrap(await getRowPropertiesOp(this.ctx, this.sheetId, rows));
  }

  async setRowProperties(updates: Map<number, Partial<CellFormat>>): Promise<void> {
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
    unwrap(await setRowPropertiesOp(this.ctx, this.sheetId, updates as Map<number, CellFormat>));
  }

  async getColumnProperties(cols: number[]): Promise<Map<number, CellFormat>> {
    return unwrap(await getColumnPropertiesOp(this.ctx, this.sheetId, cols));
  }

  async setColumnProperties(updates: Map<number, Partial<CellFormat>>): Promise<void> {
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
    unwrap(await setColumnPropertiesOp(this.ctx, this.sheetId, updates as Map<number, CellFormat>));
  }
}
