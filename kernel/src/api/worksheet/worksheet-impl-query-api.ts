/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type {
  ActiveCellEditSource,
  Chart,
  ChartConfig,
  ChartReadOptions,
  ChartRemoveReceipt,
  ChartTarget,
  ChartUpdateReceipt,
  CellData,
  CellRange,
  CellType,
  CellValueType,
  FindCellsQuery,
  FindCellsResult,
  FindInRangeOptions,
  NumberFormatCategory,
  PivotCreateConfig,
  PivotTableConfig,
  PivotTableHandle,
  PivotTableInfo,
  RangeValueType,
  SearchOptions,
  SearchResult,
  SignCheckOptions,
  SignCheckResult,
  SummaryOptions,
  VisibleRangeView,
  WorksheetRange,
} from '@mog-sdk/contracts/api';
import type { CellValue } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import { KernelError } from '../../errors';
import { resolveCell, resolveRange } from '../internal/address-resolver';
import { parseCellRange, toA1 } from '../internal/utils';
import { createVersionOperationContext } from '../workbook/version-operation-context';
import { dataConfigToApiConfig } from './pivots/config-conversion';
import * as CellOps from './operations/cell-operations';
import * as DescribeOps from './operations/describe-operations';
import * as QueryOps from './operations/query-operations';
import * as RangeQueryOps from './operations/range-query-operations';
import { toWorksheetRange, toWorksheetRangeOrNull } from './public-ranges';
import { WorksheetImplCellReadApi } from './worksheet-impl-cell-read-api';

export abstract class WorksheetImplQueryApi extends WorksheetImplCellReadApi {
  // ===========================================================================
  // LLM presentation
  // ===========================================================================

  async describe(address?: string): Promise<string> {
    return DescribeOps.describe(this.ctx, this.sheetId, address);
  }

  async describeRange(range?: string | CellRange, includeStyle: boolean = true): Promise<string> {
    if (range == null) {
      return DescribeOps.describeUsedRange(this.ctx, this.sheetId, includeStyle);
    }
    if (
      typeof range !== 'string' &&
      (typeof range.startRow !== 'number' ||
        typeof range.startCol !== 'number' ||
        typeof range.endRow !== 'number' ||
        typeof range.endCol !== 'number')
    ) {
      throw new KernelError(
        'API_INVALID_ARGUMENT',
        'describeRange range must be an A1 range string or CellRange object',
        {
          path: ['range'],
          suggestion: 'Call ws.describeRange() for the used range, or pass a range like "A1:B10"',
        },
      );
    }
    const rangeStr =
      typeof range === 'string'
        ? range
        : `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
    return DescribeOps.describeRange(this.ctx, this.sheetId, rangeStr, includeStyle);
  }

  async summarize(options?: SummaryOptions): Promise<string> {
    return DescribeOps.summarize(this.ctx, this.sheetId, options);
  }

  getCharts(options?: ChartReadOptions): Promise<Chart[]> {
    return this.charts.list(options);
  }

  listCharts(options?: ChartReadOptions): Promise<Chart[]> {
    return this.charts.list(options);
  }

  getChart(chartId: ChartTarget): Promise<Chart | null> {
    return this.charts.get(chartId);
  }

  updateChart(chartId: ChartTarget, updates: Partial<ChartConfig>): Promise<ChartUpdateReceipt> {
    return this.charts.update(chartId, updates);
  }

  removeChart(chartId: ChartTarget): Promise<ChartRemoveReceipt> {
    return this.charts.remove(chartId);
  }

  async addPivotTable(config: PivotCreateConfig): Promise<PivotTableConfig> {
    const receipt = await this.pivots.add(config);
    return dataConfigToApiConfig(receipt.config, receipt.config.sourceSheetName);
  }

  async removePivotTable(name: string): Promise<void> {
    await this.pivots.remove(name);
  }

  listPivotTables(): Promise<PivotTableInfo[]> {
    return this.pivots.list();
  }

  getPivotTable(name: string): Promise<PivotTableHandle | null> {
    return this.pivots.get(name);
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  async getUsedRange(): Promise<WorksheetRange | null> {
    return toWorksheetRangeOrNull(await QueryOps.getUsedRange(this.ctx, this.sheetId));
  }

  async getCurrentRegion(row: number, col: number): Promise<WorksheetRange> {
    const region = await this.ctx.computeBridge.getCurrentRegion(toSheetId(this.sheetId), row, col);
    return toWorksheetRange(region);
  }

  async findDataEdge(
    row: number,
    col: number,
    direction: 'up' | 'down' | 'left' | 'right',
  ): Promise<{ row: number; col: number }> {
    await this.ctx.awaitMaterialized?.(this.sheetId);
    return this.ctx.computeBridge.findDataEdge(this.sheetId, row, col, direction);
  }

  async findLastRow(
    col: number,
  ): Promise<{ lastDataRow: number | null; lastFormatRow: number | null }> {
    return this.ctx.computeBridge.findLastRow(this.sheetId, col);
  }

  async findLastColumn(
    row: number,
  ): Promise<{ lastDataCol: number | null; lastFormatCol: number | null }> {
    return this.ctx.computeBridge.findLastColumn(this.sheetId, row);
  }

  async findCells(query: FindCellsQuery): Promise<FindCellsResult>;
  async findCells(predicate: (cell: CellData) => boolean, range?: string): Promise<string[]>;
  async findCells(
    queryOrPredicate: FindCellsQuery | ((cell: CellData) => boolean),
    range?: string,
  ): Promise<FindCellsResult | string[]> {
    if (typeof queryOrPredicate !== 'function') {
      const bounds = queryOrPredicate.range ? resolveRange(queryOrPredicate.range) : undefined;
      return QueryOps.findCellsByQuery(this.ctx, this.sheetId, queryOrPredicate, bounds);
    }

    const bounds = range ? resolveRange(range) : undefined;
    const addresses = await QueryOps.findCells(this.ctx, this.sheetId, queryOrPredicate, bounds);
    return addresses.map((a) => toA1(a.row, a.col));
  }

  async findByValue(value: CellValue, range?: string): Promise<string[]> {
    const addresses = await QueryOps.findByValue(this.ctx, this.sheetId, value);
    const results = addresses.map((a) => toA1(a.row, a.col));
    if (!range) return results;
    const bounds = parseCellRange(range);
    if (!bounds) return results;
    return results.filter((addr) => {
      const pos = resolveCell(addr);
      return (
        pos.row >= bounds.startRow &&
        pos.row <= bounds.endRow &&
        pos.col >= bounds.startCol &&
        pos.col <= bounds.endCol
      );
    });
  }

  async findByFormula(pattern: RegExp, range?: string): Promise<string[]> {
    const addresses = await QueryOps.findByFormula(this.ctx, this.sheetId, pattern);
    const results = addresses.map((a) => toA1(a.row, a.col));
    if (!range) return results;
    const bounds = parseCellRange(range);
    if (!bounds) return results;
    return results.filter((addr) => {
      const pos = resolveCell(addr);
      return (
        pos.row >= bounds.startRow &&
        pos.row <= bounds.endRow &&
        pos.col >= bounds.startCol &&
        pos.col <= bounds.endCol
      );
    });
  }

  async regexSearch(patterns: string[], options?: SearchOptions): Promise<SearchResult[]> {
    let rangeBounds:
      | { startRow: number; startCol: number; endRow: number; endCol: number }
      | undefined;
    if (options?.range) {
      const parsed = parseCellRange(options.range);
      if (parsed) rangeBounds = parsed;
    }
    const results = await QueryOps.regexSearch(this.ctx, this.sheetId, patterns, {
      caseSensitive: options?.matchCase,
      wholeCell: options?.entireCell,
      includeFormulas: options?.searchFormulas,
      ...rangeBounds,
    });
    // Map internal SearchResult to contracts SearchResult shape
    return results.map((r) => ({
      address: r.address,
      value: r.value,
    }));
  }

  async signCheck(range?: string, options?: SignCheckOptions): Promise<SignCheckResult> {
    return QueryOps.signCheck(this.ctx, this.sheetId, range, options);
  }

  async findInRange(
    range: string | CellRange,
    text: string,
    options?: FindInRangeOptions,
  ): Promise<SearchResult | null> {
    const bounds = resolveRange(range);
    return RangeQueryOps.findInRange(
      this.ctx,
      this.sheetId,
      { sheetId: this.sheetId, ...bounds },
      text,
      {
        caseSensitive: options?.matchCase,
        wholeCell: options?.entireCell,
        includeFormulas: options?.searchFormulas,
      },
    );
  }

  async replaceAll(
    range: string | CellRange,
    text: string,
    replacement: string,
    options?: FindInRangeOptions,
  ): Promise<number> {
    this._ensureWritable('worksheet.replaceAll');
    const bounds = resolveRange(range);
    this._invalidateActiveCellEditSourceForRange(bounds);
    return RangeQueryOps.replaceAll(
      this.ctx,
      this.sheetId,
      { sheetId: this.sheetId, ...bounds },
      text,
      replacement,
      {
        caseSensitive: options?.matchCase,
        wholeCell: options?.entireCell,
        includeFormulas: options?.searchFormulas,
      },
      {
        operationContext: createVersionOperationContext(this.ctx, {
          operationIdPrefix: 'worksheet.replaceAll',
          sheetIds: [this.sheetId],
          domainIds: ['cells'],
        }),
      },
    );
  }

  async getExtendedRange(
    range: string,
    direction: 'up' | 'down' | 'left' | 'right',
    activeCell?: { row: number; col: number },
  ): Promise<WorksheetRange> {
    const parsed = parseCellRange(range);
    if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
    return toWorksheetRange(
      await RangeQueryOps.getExtendedRange(
        this.ctx,
        this.sheetId,
        { sheetId: this.sheetId, ...parsed },
        direction,
        activeCell,
      ),
    );
  }

  isEntireColumn(range: string | CellRange): boolean {
    if (typeof range === 'string') {
      // Check for column-only A1 notation (e.g., "A:C", "B:B")
      if (/^[A-Z]+:[A-Z]+$/i.test(range)) return true;
      const parsed = parseCellRange(range);
      if (!parsed) return false;
      return RangeQueryOps.isEntireColumn(parsed);
    }
    return RangeQueryOps.isEntireColumn(range);
  }

  isEntireRow(range: string | CellRange): boolean {
    if (typeof range === 'string') {
      // Check for row-only A1 notation (e.g., "1:5", "3:3")
      if (/^\d+:\d+$/.test(range)) return true;
      const parsed = parseCellRange(range);
      if (!parsed) return false;
      return RangeQueryOps.isEntireRow(parsed);
    }
    return RangeQueryOps.isEntireRow(range);
  }

  async getVisibleView(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<VisibleRangeView> {
    const bounds = resolveRange(a, b, c, d);
    return RangeQueryOps.getVisibleView(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
  }

  async getSpecialCells(cellType: CellType, valueType?: CellValueType): Promise<string[]> {
    const addresses = await RangeQueryOps.getSpecialCells(
      this.ctx,
      this.sheetId,
      cellType,
      valueType,
    );
    return addresses.map((a) => toA1(a.row, a.col));
  }

  // ===========================================================================
  // Editing
  // ===========================================================================

  async getValueForEditing(row: number, col: number, editText?: string): Promise<string> {
    return this._internal.getValueForEditing(row, col, editText);
  }

  async refreshActiveCellEditSource(row: number, col: number): Promise<void> {
    this._assertLive('worksheet.refreshActiveCellEditSource');
    await this._activeCellEditSourceCache.refresh(this.ctx, this.sheetId, row, col);
  }

  getActiveCellEditSource(row: number, col: number): ActiveCellEditSource | null {
    this._assertLive('worksheet.getActiveCellEditSource');
    return this._activeCellEditSourceCache.get(this.sheetId, row, col);
  }

  // ===========================================================================
  // Display
  // ===========================================================================

  async getDisplayValue(a: string | number, b?: number): Promise<string> {
    const { row, col } = resolveCell(a, b);
    return CellOps.getDisplayValue(this.ctx, this.sheetId, row, col);
  }

  async getDisplayValues(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<string[][]> {
    const bounds = resolveRange(a, b, c, d);
    return RangeQueryOps.getDisplayText(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
  }

  async getValueTypes(range: string | CellRange): Promise<RangeValueType[][]> {
    const cellRange = this.resolveToCellRange(range);
    return RangeQueryOps.getValueTypes(this.ctx, this.sheetId, cellRange);
  }

  async getNumberFormatCategories(range: string | CellRange): Promise<NumberFormatCategory[][]> {
    const cellRange = this.resolveToCellRange(range);
    return RangeQueryOps.getNumberFormatCategories(this.ctx, this.sheetId, cellRange);
  }
}
