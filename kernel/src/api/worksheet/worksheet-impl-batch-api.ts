/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type {
  AggregateResult,
  AutoFillApplyReceipt,
  AutoFillPreviewReceipt,
  CellRange,
  FormatEntry,
  FillSeriesApplyReceipt,
  SetCellsResult,
  SortByColorOptions,
  SortOptions,
  Worksheet,
} from '@mog-sdk/contracts/api';
import type { CellValue, CellValuePrimitive, CopyFromOptions } from '@mog-sdk/contracts/core';
import type { ApiSortCriterion } from '@mog-sdk/contracts/sorting';
import type { AutoFillMode, FillSeriesOptions } from '@mog-sdk/contracts/fill';

import { withDirectEditRange } from '../../bridges/compute';
import { KernelError } from '../../errors';
import { resolveCell } from '../internal/address-resolver';
import { parseCellRange } from '../internal/utils';
import { createVersionMutationAdmissionOptions } from '../workbook/version-operation-context';
import { annotationTargetsFromSetCells } from './annotation-write-options';
import type { SetCellsEntry } from './formula-api-helpers';
import * as CellOps from './operations/cell-operations';
import * as DependencyOps from './operations/dependency-operations';
import * as FillOps from './operations/fill-operations';
import * as QueryOps from './operations/query-operations';
import * as SortOps from './operations/sort-operations';
import { normalizeSetCellsEntries } from './set-cells-normalization';
import { normalizeRangeSortOptions } from './sort-helpers';
import { worksheetToCSV, worksheetToJSON } from './worksheet-serialization';
import { WorksheetImplQueryApi } from './worksheet-impl-query-api';

export abstract class WorksheetImplBatchApi extends WorksheetImplQueryApi {
  // ===========================================================================
  // Sort / batch / autofill
  // ===========================================================================

  async sortRange(range: string | CellRange, options: SortOptions): Promise<void> {
    this._ensureWritable('worksheet.sortRange');

    const parsed =
      typeof range === 'object'
        ? range
        : (() => {
            const p = parseCellRange(range);
            if (!p) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
            return p;
          })();

    const cellRange = {
      sheetId: this.sheetId,
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    };
    const maxColumnIndex = parsed.endCol - parsed.startCol;
    const normalizedOptions = normalizeRangeSortOptions(options, {
      context: 'sortRange',
      maxColumnIndex,
    });

    // Normalize direction from SortColumn to contracts SortDirection ('asc'/'desc').
    // SortOps maps further to bridge SortOrder, and forwards the full
    // discriminated-union mode (value / cellColor / fontColor) so custom-list
    // and color-target fields survive the kernel boundary.
    const sortBy: ApiSortCriterion[] = normalizedOptions.columns.map((c): ApiSortCriterion => {
      const base = {
        column: parsed.startCol + c.column,
        direction: c.direction,
        caseSensitive: c.caseSensitive,
      };
      if (c.sortBy === 'cellColor' || c.sortBy === 'fontColor') {
        return {
          ...base,
          sortBy: c.sortBy,
          targetColor: c.targetColor,
          colorPosition: c.colorPosition,
        };
      }
      // Value branch — sortBy is 'value' or undefined. Pull `customList`
      // off explicitly via `'customList' in c` to satisfy the
      // discriminated-union narrowing rules (the optional discriminator
      // makes inferred narrowing too lossy).
      const customList =
        'customList' in c ? (c as { customList?: CellValue[] }).customList : undefined;
      return {
        ...base,
        sortBy: 'value' as const,
        customList,
      };
    });

    this._invalidateActiveCellEditSourceForRange(cellRange);
    await SortOps.sortRange(this.ctx, this.sheetId, cellRange, {
      sortBy,
      hasHeaders: normalizedOptions.hasHeaders,
      visibleRowsOnly: normalizedOptions.visibleRowsOnly,
    });
  }

  async sortByColor(range: string | CellRange, opts: SortByColorOptions): Promise<void> {
    this._ensureWritable('worksheet.sortByColor');
    const parsed =
      typeof range === 'object'
        ? range
        : (() => {
            const p = parseCellRange(range);
            if (!p) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
            return p;
          })();

    const cellRange = {
      sheetId: this.sheetId,
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    };

    // Build a single color-keyed criterion against the discriminated SortMode
    // shape. `sortBy: 'cellColor' | 'fontColor'` is the discriminator;
    // `targetColor` + `colorPosition` carry the variant payload.
    const criterion = {
      column: opts.column,
      direction: 'asc' as const,
      caseSensitive: false,
      sortBy: opts.colorType === 'fill' ? ('cellColor' as const) : ('fontColor' as const),
      targetColor: opts.color,
      colorPosition: opts.position,
    };

    this._invalidateActiveCellEditSourceForRange(cellRange);
    await SortOps.sortRange(this.ctx, this.sheetId, cellRange, {
      sortBy: [criterion],
      hasHeaders: opts.hasHeaders ?? false,
      visibleRowsOnly: opts.visibleRowsOnly,
    });
  }

  async autoFill(
    sourceRange: string,
    targetRange: string,
    fillMode?: AutoFillMode,
  ): Promise<AutoFillApplyReceipt> {
    this._ensureWritable('worksheet.autoFill');
    const source = parseCellRange(sourceRange);
    const target = parseCellRange(targetRange);
    if (!source) throw new KernelError('COMPUTE_ERROR', `Invalid source range: "${sourceRange}"`);
    if (!target) throw new KernelError('COMPUTE_ERROR', `Invalid target range: "${targetRange}"`);
    this._invalidateActiveCellEditSourceForRange(target);
    const result = await FillOps.autoFill(
      this.ctx,
      this.sheetId,
      source,
      target,
      fillMode ?? 'auto',
    );
    return result;
  }

  async autoFillPreview(
    sourceRange: string,
    targetRange: string,
    fillMode?: AutoFillMode,
  ): Promise<AutoFillPreviewReceipt> {
    this._assertLive('worksheet.autoFillPreview');
    const source = parseCellRange(sourceRange);
    const target = parseCellRange(targetRange);
    if (!source) throw new KernelError('COMPUTE_ERROR', `Invalid source range: "${sourceRange}"`);
    if (!target) throw new KernelError('COMPUTE_ERROR', `Invalid target range: "${targetRange}"`);
    return FillOps.autoFillPreview(this.ctx, this.sheetId, source, target, fillMode ?? 'auto');
  }

  async fillSeries(range: string, options: FillSeriesOptions): Promise<FillSeriesApplyReceipt> {
    this._ensureWritable('worksheet.fillSeries');
    const cellRange = parseCellRange(range);
    if (!cellRange) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
    this._invalidateActiveCellEditSourceForRange(cellRange);
    return FillOps.fillSeries(this.ctx, this.sheetId, cellRange, options);
  }

  async moveTo(sourceRange: string, targetRow: number, targetCol: number): Promise<void> {
    const parsed = parseCellRange(sourceRange);
    if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${sourceRange}"`);
    this._invalidateActiveCellEditSourceForRange(parsed);
    this._invalidateActiveCellEditSourceForRange({
      startRow: targetRow,
      startCol: targetCol,
      endRow: targetRow + (parsed.endRow - parsed.startRow),
      endCol: targetCol + (parsed.endCol - parsed.startCol),
    });
    await CellOps.relocateCells(
      this.ctx,
      this.sheetId,
      parsed,
      { row: targetRow, col: targetCol },
      createVersionMutationAdmissionOptions(this.ctx, {
        operationIdPrefix: 'worksheet.moveTo',
        sheetIds: [this.sheetId],
        domainIds: ['cells', 'cells.formats.direct'],
      }),
    );
  }

  async copyFrom(
    sourceRange: string,
    targetRange: string,
    options?: CopyFromOptions,
  ): Promise<void>;
  async copyFrom(
    srcStartRow: number,
    srcStartCol: number,
    srcEndRow: number,
    srcEndCol: number,
    tgtStartRow: number,
    tgtStartCol: number,
    options?: CopyFromOptions,
  ): Promise<void>;
  async copyFrom(
    srcStartRowOrRange: string | number,
    srcStartColOrTarget: string | number,
    srcEndRowOrOptions?: number | CopyFromOptions,
    srcEndCol?: number,
    tgtStartRow?: number,
    tgtStartCol?: number,
    numericOptions?: CopyFromOptions,
  ): Promise<void> {
    this._ensureWritable('worksheet.copyFrom');
    let sr: number, sc: number, er: number, ec: number, tr: number, tc: number;
    let opts: CopyFromOptions | undefined;

    if (typeof srcStartRowOrRange === 'string') {
      // String overload: copyFrom(sourceRange, targetRange, options?)
      const source = parseCellRange(srcStartRowOrRange);
      if (!source)
        throw new KernelError('COMPUTE_ERROR', `Invalid source range: "${srcStartRowOrRange}"`);
      const target = parseCellRange(srcStartColOrTarget as string);
      if (!target)
        throw new KernelError('COMPUTE_ERROR', `Invalid target range: "${srcStartColOrTarget}"`);
      sr = source.startRow;
      sc = source.startCol;
      er = source.endRow;
      ec = source.endCol;
      tr = target.startRow;
      tc = target.startCol;
      opts = srcEndRowOrOptions as CopyFromOptions | undefined;
    } else {
      // Numeric overload: copyFrom(srcStartRow, srcStartCol, srcEndRow, srcEndCol, tgtStartRow, tgtStartCol, options?)
      sr = srcStartRowOrRange;
      sc = srcStartColOrTarget as number;
      er = srcEndRowOrOptions as number;
      ec = srcEndCol!;
      tr = tgtStartRow!;
      tc = tgtStartCol!;
      opts = numericOptions;
    }

    const copyType = opts?.copyType ?? 'all';
    const skipBlanks = opts?.skipBlanks ?? false;
    const transpose = opts?.transpose ?? false;
    const rowCount = er - sr + 1;
    const colCount = ec - sc + 1;
    const targetRowCount = transpose ? colCount : rowCount;
    const targetColCount = transpose ? rowCount : colCount;

    this._invalidateActiveCellEditSourceForRange({
      startRow: tr,
      startCol: tc,
      endRow: tr + targetRowCount - 1,
      endCol: tc + targetColCount - 1,
    });

    await this.ctx.computeBridge.copyRange(
      this.sheetId,
      sr,
      sc,
      er,
      ec,
      this.sheetId,
      tr,
      tc,
      copyType,
      skipBlanks,
      transpose,
      withDirectEditRange(
        createVersionMutationAdmissionOptions(this.ctx, {
          operationIdPrefix: 'worksheet.copyFrom',
          sheetIds: [this.sheetId],
          domainIds: ['cells', 'cells.formats.direct'],
        }),
        this.sheetId,
        tr,
        tc,
        tr + targetRowCount - 1,
        tc + targetColCount - 1,
      ),
    );
  }

  async setCells(
    cells: Array<{ addr: string; value: CellValuePrimitive | Date; annotation?: string | null }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{
      address: string;
      value: CellValuePrimitive | Date;
      annotation?: string | null;
    }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{
      row: number;
      col: number;
      value: CellValuePrimitive | Date;
      annotation?: string | null;
    }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{ cell: string; formula: string; annotation?: string | null }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{ addr: string; formula: string; annotation?: string | null }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{ address: string; formula: string; annotation?: string | null }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{ row: number; col: number; formula: string; annotation?: string | null }>,
  ): Promise<SetCellsResult>;
  async setCells(cells: SetCellsEntry[]): Promise<SetCellsResult> {
    this._ensureWritable('worksheet.setCells');
    const normalizedCells = normalizeSetCellsEntries(cells);
    const annotationTargets = annotationTargetsFromSetCells('worksheet.setCells', normalizedCells);

    // Protection check: an unprotected sheet can skip per-cell bridge checks.
    // Protected sheets keep the exact sparse-cell semantics instead of using a
    // bounding rectangle, because unlocked islands inside a protected sheet are
    // valid edit targets.
    if (this.protection.canEditCellFast(0, 0) !== true) {
      await Promise.all(
        normalizedCells.map((cell) => {
          const addrStr = cell.addr ?? cell.address;
          const { row, col } =
            addrStr !== undefined ? resolveCell(addrStr) : (cell as { row: number; col: number });
          return this.ensureCellEditable(row, col);
        }),
      );
    }
    for (const cell of normalizedCells) {
      const addrStr = cell.addr ?? cell.address;
      const { row, col } =
        addrStr !== undefined ? resolveCell(addrStr) : (cell as { row: number; col: number });
      this._invalidateActiveCellEditSourceForCell(row, col);
    }
    const result = await CellOps.setCells(
      this.ctx,
      this.sheetId,
      normalizedCells,
      createVersionMutationAdmissionOptions(this.ctx, {
        operationIdPrefix: 'worksheet.setCells',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    );
    await this.applyCellAnnotations(annotationTargets);
    return result;
  }

  async toCSV(options?: { separator?: string; range?: string }): Promise<string> {
    return worksheetToCSV(this.ctx, this.sheetId, options);
  }

  async toJSON(options?: {
    headerRow?: number | 'none';
    range?: string;
  }): Promise<Record<string, CellValue>[]> {
    return worksheetToJSON(this.ctx, this.sheetId, options);
  }

  // ===========================================================================
  // Dependencies
  // ===========================================================================

  async getDependents(a: string | number, b?: number): Promise<string[]> {
    const { row, col } = resolveCell(a, b);
    return DependencyOps.getDependents(this.ctx, this.sheetId, row, col);
  }

  async getPrecedents(a: string | number, b?: number): Promise<string[]> {
    const { row, col } = resolveCell(a, b);
    return DependencyOps.getPrecedents(this.ctx, this.sheetId, row, col);
  }

  // ===========================================================================
  // Calculation control
  // ===========================================================================

  private _enableCalculation = true;

  get enableCalculation(): boolean {
    return this._enableCalculation;
  }

  set enableCalculation(value: boolean) {
    this._enableCalculation = value;
    // Sync to the Rust compute engine so the scheduler respects the flag.
    // Fire-and-forget — the bridge call persists to Yrs and updates the mirror.
    void this.ctx.computeBridge.setSheetEnableCalculation(this.sheetId, value);
  }

  async calculate(markAllDirty?: boolean): Promise<void> {
    if (markAllDirty) {
      // Full recalc via the workbook-level bridge (marks all cells dirty)
      await this.ctx.computeBridge.fullRecalc({});
    } else {
      // Trigger a standard recalc pass — evaluateExpression with a trivial
      // expression forces the engine to flush any pending dirty cells for this
      // sheet, which is the closest sheet-scoped recalc the bridge supports.
      await this.ctx.computeBridge.fullRecalc({});
    }
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  async getSelectionAggregates(ranges: CellRange[]): Promise<AggregateResult> {
    const raw = await QueryOps.getSelectionAggregates(
      this.ctx,
      this.sheetId,
      ranges.map((r) => ({
        startRow: r.startRow,
        startCol: r.startCol,
        endRow: r.endRow,
        endCol: r.endCol,
      })),
    );
    return {
      sum: raw.sum ?? 0,
      count: raw.count ?? 0,
      numericCount: raw.numericCount ?? 0,
      average: raw.average ?? null,
      min: raw.min ?? null,
      max: raw.max ?? null,
    };
  }

  async formatValues(entries: FormatEntry[]): Promise<string[]> {
    const bridgeEntries = entries.map((e) => {
      // The contract allows { type: string; value?: unknown } descriptors, but
      // the Rust CellValue deserializer expects raw JSON primitives (number, string, bool, null).
      // Convert typed descriptors to raw values for bridge compatibility.
      let rawValue: unknown = e.value;
      if (rawValue != null && typeof rawValue === 'object' && 'type' in rawValue) {
        const desc = rawValue as { type: string; value?: unknown };
        rawValue = desc.value ?? null;
      }
      return { value: rawValue, format_code: e.formatCode };
    });
    return QueryOps.formatValues(
      this.ctx,
      bridgeEntries as Array<{ value: { type: string; value?: unknown }; format_code: string }>,
    );
  }

  // ===========================================================================
  // Visibility
  // ===========================================================================

  async getVisibility(): Promise<'visible' | 'hidden' | 'veryHidden'> {
    const state = await this.ctx.computeBridge.getSheetVisibility(this.sheetId);
    return state as 'visible' | 'hidden' | 'veryHidden';
  }

  async setVisibility(state: 'visible' | 'hidden' | 'veryHidden'): Promise<void> {
    this._ensureWritable('worksheet.setVisibility');
    await this.ctx.computeBridge.setSheetVisibility(this.sheetId, state);
    this._cachedVisible = state === 'visible';
  }

  // ===========================================================================
  // Navigation
  // ===========================================================================

  async getNext(visibleOnly?: boolean): Promise<Worksheet> {
    const result = await this.getNextOrNull(visibleOnly);
    if (!result) {
      throw new KernelError('API_INVALID_ADDRESS', 'There is no next worksheet.');
    }
    return result;
  }

  async getNextOrNull(visibleOnly?: boolean): Promise<Worksheet | null> {
    if (!this.workbook) return null;
    const sheets = await this.workbook.getSheets();
    const currentIdx = sheets.findIndex((s) => s.getSheetId() === this.sheetId);
    if (currentIdx === -1) return null;
    for (let i = currentIdx + 1; i < sheets.length; i++) {
      if (visibleOnly) {
        const vis = await sheets[i].getVisibility();
        if (vis !== 'visible') continue;
      }
      return sheets[i];
    }
    return null;
  }

  async getPrevious(visibleOnly?: boolean): Promise<Worksheet> {
    const result = await this.getPreviousOrNull(visibleOnly);
    if (!result) {
      throw new KernelError('API_INVALID_ADDRESS', 'There is no previous worksheet.');
    }
    return result;
  }

  async getPreviousOrNull(visibleOnly?: boolean): Promise<Worksheet | null> {
    if (!this.workbook) return null;
    const sheets = await this.workbook.getSheets();
    const currentIdx = sheets.findIndex((s) => s.getSheetId() === this.sheetId);
    if (currentIdx === -1) return null;
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (visibleOnly) {
        const vis = await sheets[i].getVisibility();
        if (vis !== 'visible') continue;
      }
      return sheets[i];
    }
    return null;
  }
}
