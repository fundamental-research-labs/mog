/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type {
  CellData,
  CellRange,
  CellRecord,
  FormulaCircularReferenceValidation,
  FormulaSyntaxValidationError,
  IdentifiedCellData,
  RawCellData,
  SheetId,
  WorksheetCellVisitor,
  WorksheetCellsAccessor,
  WorksheetGetCellsFormulasOnlyOptions,
  WorksheetGetCellsFullOptions,
  WorksheetGetCellsOptions,
  WorksheetGetCellsValuesOnlyOptions,
  WorksheetRangeCell,
  WorksheetRangeFormulaCell,
  WorksheetRangeValueCell,
} from '@mog-sdk/contracts/api';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type { CellValue, CellValuePrimitive } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';

import type { RangeCellData } from '../../bridges/compute/compute-types.gen';
import { KernelError } from '../../errors';
import { maskExternalFormulaRefsForValidation } from '../../services/external-formulas';
import * as CellReads from '../../domain/cells/cell-reads';
import { resolveCell, resolveRange } from '../internal/address-resolver';
import { parseCellAddress, toA1 } from '../internal/utils';
import { normalizeCellValue } from '../internal/value-conversions';
import { formulaAddressHint, normalizeFormulaExpression } from './formula-api-helpers';
import { a1FormulaToR1C1 } from './formula-r1c1';
import * as CellOps from './operations/cell-operations';
import * as HyperlinkOps from './operations/hyperlink-operations';
import * as MergeOps from './operations/merge-operations';
import * as QueryOps from './operations/query-operations';
import * as RangeOps from './operations/range-operations';
import { projectCellRecord } from './cell-record-projection';
import { WorksheetImplCellWriteApi } from './worksheet-impl-cell-write-api';

export abstract class WorksheetImplCellReadApi extends WorksheetImplCellWriteApi {
  async getCell(a: string | number, b?: number): Promise<CellData> {
    this._assertLive('worksheet.getCell');
    const { row, col } = resolveCell(a, b);
    const data = await CellOps.getCell(this.ctx, this.sheetId, row, col);
    return data ?? { value: null };
  }

  // ===========================================================================
  // Typed cell-record accessor — `Worksheet.cells.get(addr)`
  // ===========================================================================

  /**
   * Typed per-cell readback. See {@link WorksheetCellsAccessor} on the public
   * interface for the contract — empty in-bounds cells return a record with
   * `value: null` + `valueType: Empty`; out-of-bounds returns `undefined`.
   *
   * Implementation lives on the impl as a memoized property so the accessor
   * object identity is stable across calls (matches the pattern used by
   * other sub-APIs like `viewport` / `cellMetadata`).
   */
  private _cells?: WorksheetCellsAccessor;
  get cells(): WorksheetCellsAccessor {
    this._assertLive('worksheet.cells');
    if (!this._cells) {
      this._cells = {
        get: async (addr: string): Promise<CellRecord | undefined> => {
          this._assertLive('worksheet.cells.get');
          const parsed = parseCellAddress(addr);
          if (!parsed) {
            throw new KernelError('API_INVALID_ADDRESS', `Invalid cell address: "${addr}"`);
          }
          const { row, col } = parsed;
          if (row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLS) {
            return undefined;
          }
          const data = await CellReads.getData(this.ctx, this.sheetId, row, col);
          return projectCellRecord(addr, row, col, data);
        },
        list: (async (range: string | CellRange, options?: WorksheetGetCellsOptions) => {
          this._assertLive('worksheet.cells.list');
          const bounds = resolveRange(range);
          return RangeOps.getCells(
            this.ctx,
            this.sheetId,
            this.name,
            {
              sheetId: this.sheetId,
              startRow: bounds.startRow,
              startCol: bounds.startCol,
              endRow: bounds.endRow,
              endCol: bounds.endCol,
            },
            options,
          );
        }) as WorksheetCellsAccessor['list'],
      };
    }
    return this._cells;
  }

  async getValue(a: string | number, b?: number): Promise<CellValuePrimitive> {
    this._assertLive('worksheet.getValue');
    if (typeof a === 'string' && a.trim().startsWith('=')) {
      throw formulaAddressHint('worksheet.getValue', a);
    }
    const { row, col } = resolveCell(a, b);
    const value = await CellOps.getValue(this.ctx, this.sheetId, row, col);
    return normalizeCellValue(value ?? null);
  }

  async getData(): Promise<CellValue[][]> {
    this._assertLive('worksheet.getData');
    const range = await QueryOps.getUsedRange(this.ctx, this.sheetId);
    if (!range) return [];
    const cellData = await RangeOps.getRange(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    });
    return cellData.map((row) => row.map((cell) => normalizeCellValue(cell.value ?? null)));
  }

  async getValues(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<CellValue[][]> {
    this._assertLive('worksheet.getValues');
    const bounds = resolveRange(a, b, c, d);
    return RangeOps.getRangeValues(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
  }

  async getRange(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<CellData[][]> {
    this._assertLive('worksheet.getRange');
    const bounds = resolveRange(a, b, c, d);
    return RangeOps.getRange(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
  }

  async getRanges(addresses: string): Promise<CellData[][][]> {
    this._assertLive('worksheet.getRanges');
    const parts = addresses
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Promise.all(parts.map((addr) => this.getRange(addr)));
  }

  async getCells(
    range: string | CellRange,
    options?: WorksheetGetCellsFullOptions,
  ): Promise<WorksheetRangeCell[]>;
  async getCells(
    range: string | CellRange,
    options: WorksheetGetCellsValuesOnlyOptions,
  ): Promise<WorksheetRangeValueCell[]>;
  async getCells(
    range: string | CellRange,
    options: WorksheetGetCellsFormulasOnlyOptions,
  ): Promise<WorksheetRangeFormulaCell[]>;
  async getCells(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    options?: WorksheetGetCellsOptions,
  ): Promise<WorksheetRangeCell[]>;
  async getCells(
    a: string | number | CellRange,
    b?: number | WorksheetGetCellsOptions,
    c?: number,
    d?: number,
    e?: WorksheetGetCellsOptions,
  ): Promise<Array<WorksheetRangeCell | WorksheetRangeValueCell | WorksheetRangeFormulaCell>> {
    this._assertLive('worksheet.getCells');
    let bounds: { startRow: number; startCol: number; endRow: number; endCol: number };
    let options: WorksheetGetCellsOptions | undefined;

    if (typeof a === 'number') {
      bounds = resolveRange(a, b as number, c, d);
      options = e;
    } else {
      bounds = resolveRange(a);
      options = b as WorksheetGetCellsOptions | undefined;
    }

    return RangeOps.getCells(
      this.ctx,
      this.sheetId,
      this.name,
      {
        sheetId: this.sheetId,
        startRow: bounds.startRow,
        startCol: bounds.startCol,
        endRow: bounds.endRow,
        endCol: bounds.endCol,
      },
      options,
    );
  }

  async forEachCell(
    range: string | CellRange,
    visitor: WorksheetCellVisitor,
    options?: { readonly sparse?: boolean },
  ): Promise<void> {
    this._assertLive('worksheet.forEachCell');
    const cells = await this.getCells(range, options);
    for (let i = 0; i < cells.length; i++) {
      await visitor(cells[i], i);
    }
  }

  // ===========================================================================
  // Formula access
  // ===========================================================================

  async getFormula(a: string | number, b?: number): Promise<string | null> {
    const { row, col } = resolveCell(a, b);
    const formula = await CellOps.getFormula(this.ctx, this.sheetId, row, col);
    return formula ?? null;
  }

  async getFormulas(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<(string | null)[][]> {
    const bounds = resolveRange(a, b, c, d);
    return RangeOps.getRangeFormulas(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
  }

  async getFormulasR1C1(range: string): Promise<(string | null)[][]> {
    const bounds = resolveRange(range);
    const formulas = await RangeOps.getRangeFormulas(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
    // Convert each A1-style formula to R1C1 notation relative to the cell's position
    return formulas.map((row, rowIdx) =>
      row.map((formula, colIdx) => {
        if (formula === null) return null;
        return a1FormulaToR1C1(formula, bounds.startRow + rowIdx, bounds.startCol + colIdx);
      }),
    );
  }

  async getFormulaArray(a: string | number, b?: number): Promise<string | null> {
    const { row, col } = resolveCell(a, b);

    // Check if this cell is a projected (spill member) position
    const isProjected = await CellOps.isProjectedPosition(this.ctx, this.sheetId, row, col);
    if (isProjected) {
      // Get the source cell of the projection
      const source = await CellOps.getProjectionSource(this.ctx, this.sheetId, row, col);
      if (source) {
        const formula = await CellOps.getFormula(this.ctx, this.sheetId, source.row, source.col);
        return formula ?? null;
      }
      return null;
    }

    // Check if this cell itself is a spill source (has a projection range)
    const projRange = await CellOps.getProjectionRange(this.ctx, this.sheetId, row, col);
    if (projRange) {
      const formula = await CellOps.getFormula(this.ctx, this.sheetId, row, col);
      return formula ?? null;
    }

    return null;
  }

  async evaluate(expression: string): Promise<CellValue> {
    this._assertLive('worksheet.evaluate');
    return this.ctx.computeBridge.evaluateExpression(
      this.sheetId,
      normalizeFormulaExpression(expression, 'worksheet.evaluate'),
    );
  }

  async evaluateFormula(
    formula: string,
    options?: { sheet?: string | SheetId },
  ): Promise<CellValue> {
    this._assertLive('worksheet.evaluateFormula');
    const targetSheetId = await this.resolveFormulaEvaluationSheetId(options?.sheet);
    return this.ctx.computeBridge.evaluateExpression(
      targetSheetId,
      normalizeFormulaExpression(formula, 'worksheet.evaluateFormula'),
    );
  }

  private async resolveFormulaEvaluationSheetId(sheet?: string | SheetId): Promise<SheetId> {
    if (sheet == null || sheet === this.sheetId || sheet === this.name) {
      return this.sheetId;
    }

    if (this.workbook) {
      const target = await this.workbook.findSheet(String(sheet));
      if (target) {
        return target.sheetId;
      }
    }

    throw new KernelError(
      'API_SHEET_NOT_FOUND',
      `Sheet not found for formula evaluation: ${sheet}`,
      {
        suggestion:
          'Call evaluateFormula on the target worksheet, or pass a sheet name from the same workbook.',
        context: {
          validationKind: 'formulaEvaluationSheetNotFound',
          received: sheet,
        },
      },
    );
  }

  async validateFormulaSyntax(formula: string): Promise<FormulaSyntaxValidationError | null> {
    const validationFormula = maskExternalFormulaRefsForValidation(formula);
    const result = await this.ctx.computeBridge.validateFormulaSyntax(
      this.sheetId,
      validationFormula,
    );
    if (!result) return null;
    const [errorMessage, errorPosition] = result;
    return {
      errorMessage,
      ...(errorPosition == null ? {} : { errorPosition }),
    };
  }

  async validateFormulaCircularReference(
    formula: string,
    row: number,
    col: number,
  ): Promise<FormulaCircularReferenceValidation | null> {
    return this.ctx.computeBridge.validateFormulaCircularReference(
      this.sheetId,
      row,
      col,
      maskExternalFormulaRefsForValidation(formula),
    );
  }

  // ===========================================================================
  // Bulk reads
  // ===========================================================================

  async getRawCellData(
    a: string | number,
    b?: number | boolean,
    c?: boolean,
  ): Promise<RawCellData> {
    let row: number, col: number, includeFormula: boolean;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      includeFormula = (b as boolean) ?? true;
    } else {
      row = a;
      col = b as number;
      includeFormula = c ?? true;
    }

    const [value, formula, format, hyperlink, mergeInfo] = await Promise.all([
      CellOps.getValue(this.ctx, this.sheetId, row, col),
      includeFormula ? CellOps.getFormula(this.ctx, this.sheetId, row, col) : undefined,
      CellOps.getFormat(this.ctx, this.sheetId, row, col),
      HyperlinkOps.getHyperlink(this.ctx, this.sheetId, row, col),
      MergeOps.getMergeAt(this.ctx, this.sheetId, row, col),
    ]);

    return {
      value: normalizeCellValue(value ?? null),
      formula: formula ?? undefined,
      format: format ?? undefined,
      hyperlink: hyperlink ?? undefined,
      isMerged: mergeInfo !== undefined,
      mergedRegion: mergeInfo
        ? `${toA1(mergeInfo.startRow, mergeInfo.startCol)}:${toA1(mergeInfo.endRow, mergeInfo.endCol)}`
        : undefined,
    };
  }

  async getRawRangeData(
    range: string | CellRange,
    options?: { includeFormula?: boolean },
  ): Promise<RawCellData[][]>;
  async getRawRangeData(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    includeFormula?: boolean,
  ): Promise<RawCellData[][]>;
  async getRawRangeData(range: string, includeFormula?: boolean): Promise<RawCellData[][]>;
  async getRawRangeData(
    a: string | number | CellRange,
    b?: number | boolean | { includeFormula?: boolean },
    c?: number,
    d?: number,
    e?: boolean,
  ): Promise<RawCellData[][]> {
    let parsed: { startRow: number; startCol: number; endRow: number; endCol: number };
    let includeFormula: boolean | undefined;
    if (typeof a === 'number') {
      parsed = resolveRange(a, b as number, c as number, d);
      includeFormula = e;
    } else {
      parsed = resolveRange(a);
      if (typeof b === 'object' && b !== null && 'includeFormula' in b) {
        includeFormula = b.includeFormula;
      } else {
        includeFormula = b as boolean | undefined;
      }
    }

    const rangeData = await this.ctx.computeBridge.queryRange(
      this.sheetId,
      parsed.startRow,
      parsed.startCol,
      parsed.endRow,
      parsed.endCol,
    );

    // Build lookup map from flat cell array
    const cellMap = new Map<string, RangeCellData>();
    for (const vc of rangeData.cells) {
      cellMap.set(`${vc.row},${vc.col}`, vc);
    }

    const result: RawCellData[][] = [];
    for (let row = parsed.startRow; row <= parsed.endRow; row++) {
      const rowData: RawCellData[] = [];
      for (let col = parsed.startCol; col <= parsed.endCol; col++) {
        const vc = cellMap.get(`${row},${col}`);
        if (!vc) {
          rowData.push({ value: null });
        } else {
          rowData.push({
            value: normalizeCellValue(vc.value) ?? null,
            formula: (includeFormula !== false ? vc.formula : undefined) as FormulaA1 | undefined,
            format: vc.format ?? undefined,
          });
        }
      }
      result.push(rowData);
    }
    return result;
  }

  async getRangeWithIdentity(range: string | CellRange): Promise<IdentifiedCellData[]>;
  async getRangeWithIdentity(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<IdentifiedCellData[]>;
  async getRangeWithIdentity(
    a: string | CellRange | number,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<IdentifiedCellData[]> {
    let startRow: number, startCol: number, endRow: number, endCol: number;
    if (typeof a === 'number') {
      startRow = a;
      startCol = b!;
      endRow = c!;
      endCol = d!;
    } else {
      const resolved = this.resolveToCellRange(a);
      startRow = resolved.startRow;
      startCol = resolved.startCol;
      endRow = resolved.endRow;
      endCol = resolved.endCol;
    }
    return QueryOps.getRangeWithIdentity(
      this.ctx,
      this.sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    );
  }
}
