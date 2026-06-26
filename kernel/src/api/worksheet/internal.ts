/**
 * WorksheetInternalImpl — Implementation of the WorksheetInternal interface.
 *
 * Internal plumbing operations for bridges, formula bar, and action handlers.
 * NOT part of the public Worksheet API surface — only exposed on WorksheetImpl.
 */

import type {
  CellRange,
  ConditionalFormatCache,
  SheetId,
  WorksheetInternalChart,
  WorksheetInternal,
} from '@mog-sdk/contracts/api';
import { toCellId, type IdentityFormula } from '@mog-sdk/contracts/cell-identity';
import type { RangeSchema } from '@mog-sdk/contracts/schema';
import type {
  ChartFloatingObject,
  RangeSchema as BridgeRangeSchema,
} from '../../bridges/compute/compute-bridge';
import type { Table as CanonicalTable } from '../../bridges/compute/compute-types.gen';
import type { TableConfig } from '@mog-sdk/contracts/tables';

import {
  identityFormulaToWire,
  wireTableToTableConfig,
} from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import { getOrCreateCellId as getOrCreateCellIdDomain } from '../../domain/cells/cell-identity';
import { getData as getCellStoreDataDomain } from '../../domain/cells/cell-values';
import { orderChartsForList } from '../../domain/charts/chart-list-ordering';
import { serializedChartToChart } from '../../domain/charts/chart-public-api-converters';
import * as CellOps from './operations/cell-operations';
import {
  getWorksheetValidationCache,
  invalidateWorksheetValidationCache,
} from './validation-cache';

export class WorksheetInternalImpl implements WorksheetInternal {
  private _cfCache: ConditionalFormatCache | null = null;

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private async ensureTargetRangeEditable(
    targetSheetId: SheetId,
    startRow: number,
    startCol: number,
    rowCount: number,
    colCount: number,
  ): Promise<void> {
    const sheetProtected = await this.ctx.computeBridge.isSheetProtected(targetSheetId);
    if (!sheetProtected) return;

    const endRow = startRow + rowCount - 1;
    const endCol = startCol + colCount - 1;
    const checks: Promise<void>[] = [];
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        checks.push(
          this.ctx.computeBridge.canEditCell(targetSheetId, row, col).then((canEdit) => {
            if (!canEdit) {
              throw new Error(
                `Cannot edit cell (${row}, ${col}): sheet is protected and cell is locked`,
              );
            }
          }),
        );
      }
    }
    await Promise.all(checks);
  }

  private isSameRange(a: CellRange, b: CellRange): boolean {
    return (
      a.startRow === b.startRow &&
      a.startCol === b.startCol &&
      a.endRow === b.endRow &&
      a.endCol === b.endCol
    );
  }

  private rangeContainsRange(container: CellRange, candidate: CellRange): boolean {
    return (
      candidate.startRow >= container.startRow &&
      candidate.endRow <= container.endRow &&
      candidate.startCol >= container.startCol &&
      candidate.endCol <= container.endCol
    );
  }

  private async waitForTableAtCell(
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<CanonicalTable | null> {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      const table = await this.ctx.computeBridge.getTableAtCell(sheetId, row, col);
      if (table) return table;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return this.ctx.computeBridge.getTableAtCell(sheetId, row, col);
  }

  private async refreshRegisteredViewportsForSheet(sheetId: SheetId): Promise<void> {
    const vpStates = this.ctx.computeBridge.getPerViewportStates();
    const suffix = ':' + sheetId;
    const boundsToRefresh: Array<{
      vpId: string;
      bounds: { startRow: number; startCol: number; endRow: number; endCol: number };
    }> = [];

    for (const [vpId, state] of vpStates) {
      if (vpId.endsWith(suffix) && state.prefetchBounds) {
        boundsToRefresh.push({ vpId, bounds: state.prefetchBounds });
      }
    }

    if (boundsToRefresh.length === 0) return;

    this.ctx.computeBridge.invalidateAllViewportPrefetch();
    await Promise.all(
      boundsToRefresh.map(({ vpId, bounds }) =>
        this.ctx.computeBridge.refreshViewportForRegion(vpId, sheetId, bounds),
      ),
    );
  }

  private async getTableDefinitionsForRange(sourceRange: CellRange): Promise<CanonicalTable[]> {
    const tables = await this.ctx.computeBridge.getAllTablesInSheet(this.sheetId);
    return tables.filter(
      (table) =>
        this.isSameRange(table.range, sourceRange) ||
        this.rangeContainsRange(sourceRange, table.range),
    );
  }

  private async copyTableDefinitionsToTarget(
    tables: CanonicalTable[],
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetRow: number,
    targetCol: number,
    options: { checkExisting?: boolean } = {},
  ): Promise<void> {
    for (const table of tables) {
      const rowOffset = table.range.startRow - sourceRange.startRow;
      const colOffset = table.range.startCol - sourceRange.startCol;
      const targetStartRow = targetRow + rowOffset;
      const targetStartCol = targetCol + colOffset;
      const targetEndRow = targetStartRow + (table.range.endRow - table.range.startRow);
      const targetEndCol = targetStartCol + (table.range.endCol - table.range.startCol);

      const existing =
        options.checkExisting === false
          ? null
          : await this.ctx.computeBridge.getTableAtCell(
              targetSheetId,
              targetStartRow,
              targetStartCol,
            );
      if (!existing) {
        await this.ctx.computeBridge.createTableLifecycle(
          targetSheetId,
          null,
          targetStartRow,
          targetStartCol,
          targetEndRow,
          targetEndCol,
          table.columns.map((column) => column.name),
          table.hasHeaderRow,
          table.style,
        );
      }

      const created =
        existing ?? (await this.waitForTableAtCell(targetSheetId, targetStartRow, targetStartCol));
      if (!created) continue;

      const boolOptions = [
        ['bandedRows', table.bandedRows],
        ['bandedColumns', table.bandedColumns],
        ['emphasizeFirstColumn', table.emphasizeFirstColumn],
        ['emphasizeLastColumn', table.emphasizeLastColumn],
        ['showFilterButtons', table.showFilterButtons],
      ] as const;

      for (const [option, value] of boolOptions) {
        await this.ctx.computeBridge.setTableBoolOption(created.name, option, value);
      }
      if (created.hasTotalsRow !== table.hasTotalsRow) {
        await this.ctx.computeBridge.toggleTotalsRow(created.name);
      }
      if (created.hasHeaderRow !== table.hasHeaderRow) {
        await this.ctx.computeBridge.toggleHeaderRow(created.name);
      }
      await this.ctx.computeBridge.setTableAutoExpand(created.name, table.autoExpand);
      await this.ctx.computeBridge.setTableAutoCalculatedColumns(
        created.name,
        table.autoCalculatedColumns,
      );
    }
  }

  async getCellIdAt(row: number, col: number): Promise<string | null> {
    return CellOps.getCellIdAt(this.ctx, this.sheetId, row, col);
  }

  async getOrCreateCellId(row: number, col: number): Promise<string> {
    return getOrCreateCellIdDomain(this.ctx, this.sheetId, row, col);
  }

  async getCellPosition(cellId: string): Promise<{ row: number; col: number } | null> {
    const pos = await this.ctx.computeBridge.getCellPosition(this.sheetId, cellId);
    if (!pos) return null;
    return { row: pos.row, col: pos.col };
  }

  async batchGetCellPositions(
    cellIds: string[],
  ): Promise<Map<string, { row: number; col: number }>> {
    return CellOps.batchGetCellPositions(this.ctx, this.sheetId, cellIds);
  }

  async listStoredCharts(): Promise<WorksheetInternalChart[]> {
    const charts = (await this.ctx.computeBridge.getAllCharts(
      this.sheetId,
    )) as ChartFloatingObject[];

    return orderChartsForList(charts)
      .sort((a, b) => {
        const zA = a.zIndex ?? 0;
        const zB = b.zIndex ?? 0;
        if (zA !== zB) return zA - zB;
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      })
      .map((rawChart) => {
        const endAnchorCellId = rawChart.toAnchorCellId;
        return {
          ...serializedChartToChart(rawChart),
          anchorCellId: rawChart.anchorCellId ? toCellId(rawChart.anchorCellId) : undefined,
          endAnchorCellId: endAnchorCellId ? toCellId(endAnchorCellId) : undefined,
          anchorMode: rawChart.anchor?.anchorMode,
          dataRangeIdentity: rawChart.dataRangeIdentity,
          seriesRangeIdentity: rawChart.seriesRangeIdentity,
          categoryRangeIdentity: rawChart.categoryRangeIdentity,
          zIndex: rawChart.zIndex,
        };
      });
  }

  get cfCache(): ConditionalFormatCache {
    if (!this._cfCache) {
      // No-op stub: CF data is now provided directly by the binary viewport buffer
      // from Rust's CF cache. The TS-side ConditionalFormatCache pipeline is no
      // longer needed for rendering. This stub satisfies the interface contract
      // so existing consumers (event-subscriptions, cf-coordination) don't break.
      this._cfCache = {
        getResult: () => undefined,
        hasCF: () => false,
        evaluateAll: () => Promise.resolve(),
        invalidateCells: () => Promise.resolve(),
        invalidateAll: () => {},
        onRulesChanged: () => () => {},
        destroy: () => {},
      };
    }
    return this._cfCache;
  }

  async getValueForEditing(row: number, col: number, editText?: string): Promise<string> {
    void editText;
    return CellOps.getValueForEditing(this.ctx, this.sheetId, row, col);
  }

  async toA1Display(identityFormula: IdentityFormula): Promise<string> {
    const wire = identityFormulaToWire(identityFormula);
    return this.ctx.computeBridge.toA1Display(this.sheetId, wire);
  }

  async getTableConfig(row: number, col: number): Promise<TableConfig | undefined> {
    const result = await this.ctx.computeBridge.getTableAtCell(this.sheetId, row, col);
    if (!result) return undefined;
    return wireTableToTableConfig(result);
  }

  async getCellStoreData(row: number, col: number): Promise<unknown> {
    return getCellStoreDataDomain(this.ctx, this.sheetId, row, col);
  }

  async clampRangeToDataBounds(range: CellRange): Promise<CellRange> {
    // Non-full ranges are returned as-is
    if (!range.isFullColumn && !range.isFullRow) return range;

    const DATA_BOUNDS_BUFFER = 100;
    const bounds = await this.ctx.computeBridge.getDataBounds(this.sheetId);
    const maxDataRow = bounds?.maxRow ?? 0;
    const maxDataCol = bounds?.maxCol ?? 0;

    const endRow = range.isFullColumn
      ? Math.max(range.startRow, Math.min(range.endRow, maxDataRow + DATA_BOUNDS_BUFFER))
      : range.endRow;
    const endCol = range.isFullRow
      ? Math.max(range.startCol, Math.min(range.endCol, maxDataCol + DATA_BOUNDS_BUFFER))
      : range.endCol;

    return {
      ...range,
      endRow,
      endCol,
      isFullColumn: false,
      isFullRow: false,
    };
  }

  async relocateCells(sourceRange: CellRange, targetRow: number, targetCol: number): Promise<void> {
    await this.ensureTargetRangeEditable(
      this.sheetId,
      targetRow,
      targetCol,
      sourceRange.endRow - sourceRange.startRow + 1,
      sourceRange.endCol - sourceRange.startCol + 1,
    );
    await CellOps.relocateCells(this.ctx, this.sheetId, sourceRange, {
      row: targetRow,
      col: targetCol,
    });
  }

  async relocateCellsToSheet(
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetRow: number,
    targetCol: number,
  ): Promise<void> {
    await this.ensureTargetRangeEditable(
      targetSheetId,
      targetRow,
      targetCol,
      sourceRange.endRow - sourceRange.startRow + 1,
      sourceRange.endCol - sourceRange.startCol + 1,
    );
    // cross-sheet relocate now emits clear+write patches
    // through the Rust mutation handler (`relocate_cells_yrs` rebuilds
    // both source and target sheet viewport binaries). The kernel-side
    // `forceRefreshAllViewports` was a band-aid for the patch gap and is
    // gone.
    await this.ctx.computeBridge.relocateCellsYrs(
      this.sheetId,
      sourceRange.startRow,
      sourceRange.startCol,
      sourceRange.endRow,
      sourceRange.endCol,
      targetSheetId,
      targetRow,
      targetCol,
    );
    invalidateWorksheetValidationCache(this.ctx, this.sheetId);
    invalidateWorksheetValidationCache(this.ctx, targetSheetId);
  }

  async getRangeSchemas(): Promise<RangeSchema[]> {
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasForSheet(this.sheetId);
    // Bridge-side RangeSchema declares enforcement as optional; the public
    // RangeSchema requires it. Default to 'strict' for any rule the engine
    // emitted without an explicit enforcement (matches Rust default).
    return schemas.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      ranges: s.ranges,
      schema: s.schema,
      enforcement: s.enforcement ?? 'strict',
      ui: s.ui,
    }));
  }

  async setRangeSchemaFromClipboard(
    range: CellRange,
    schema: RangeSchema['schema'],
    enforcement: RangeSchema['enforcement'],
    ui?: RangeSchema['ui'],
  ): Promise<void> {
    const bridgeSchema: BridgeRangeSchema = {
      id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      ranges: [
        {
          startId: `${range.startRow}:${range.startCol}`,
          endId: `${range.endRow}:${range.endCol}`,
        },
      ],
      schema: schema as BridgeRangeSchema['schema'],
      enforcement,
      ui: ui as BridgeRangeSchema['ui'],
    };
    invalidateWorksheetValidationCache(this.ctx, this.sheetId);
    await this.ctx.computeBridge.setRangeSchema(this.sheetId, bridgeSchema);
  }

  async copyRangeToSheet(
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetRow: number,
    targetCol: number,
    copyType: 'all' | 'values' | 'formulas' | 'formats',
    skipBlanks: boolean,
    transpose: boolean,
  ): Promise<void> {
    const sourceRowCount = sourceRange.endRow - sourceRange.startRow + 1;
    const sourceColCount = sourceRange.endCol - sourceRange.startCol + 1;
    const shouldCopyTables = copyType === 'all' && !skipBlanks && !transpose;
    const tablesToCopy = shouldCopyTables
      ? await this.getTableDefinitionsForRange(sourceRange)
      : [];

    if (tablesToCopy.length > 0) {
      await this.copyTableDefinitionsToTarget(
        tablesToCopy,
        sourceRange,
        targetSheetId,
        targetRow,
        targetCol,
        { checkExisting: false },
      );
    }

    await this.ensureTargetRangeEditable(
      targetSheetId,
      targetRow,
      targetCol,
      transpose ? sourceColCount : sourceRowCount,
      transpose ? sourceRowCount : sourceColCount,
    );

    // Cross-sheet relocate generalization: the Rust `compute_copy_range` mutation
    // handler now rebuilds the target sheet's viewport binary on cross-
    // sheet copies (in addition to the incremental flush on the source
    // sheet). The kernel-side `forceRefreshAllViewports` band-aid is gone.
    await this.ctx.computeBridge.copyRange(
      this.sheetId,
      sourceRange.startRow,
      sourceRange.startCol,
      sourceRange.endRow,
      sourceRange.endCol,
      targetSheetId,
      targetRow,
      targetCol,
      copyType,
      skipBlanks,
      transpose,
    );

    if (copyType === 'formats') {
      await this.refreshRegisteredViewportsForSheet(targetSheetId);
    }

    if (tablesToCopy.length > 0) {
      await this.copyTableDefinitionsToTarget(
        tablesToCopy,
        sourceRange,
        targetSheetId,
        targetRow,
        targetCol,
      );
    }
  }

  /** Tear down the CF cache if it was created. Called by WorksheetImpl.dispose(). */
  dispose(): void {
    if (this._cfCache) {
      this._cfCache.destroy();
      this._cfCache = null;
    }
  }
}
