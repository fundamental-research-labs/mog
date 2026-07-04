/**
 * WorksheetAnnotationsImpl - Implementation of the WorksheetAnnotations sub-API.
 */

import type {
  CellRange,
  SheetId,
  WorksheetAnnotationDeleteResult,
  WorksheetAnnotationDiagnosticReadOptions,
  WorksheetAnnotationReadOptions,
  WorksheetAnnotationRecord,
  WorksheetAnnotations,
  WorksheetCellAnnotationDeleteResult,
  WorksheetCellAnnotationDiagnosticListOptions,
  WorksheetCellAnnotationDiagnostics,
  WorksheetCellAnnotationListOptions,
  WorksheetCellAnnotationRecord,
  WorksheetCellAnnotationRef,
  WorksheetCellAnnotations,
  WorksheetCellAnnotationView,
  WorksheetCellAnnotationWriteEntry,
} from '@mog-sdk/contracts/api';
import { toA1 } from '@mog/spreadsheet-utils/a1';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type {
  AnnotationDeleteResult as BridgeAnnotationDeleteResult,
  AnnotationRecord as BridgeAnnotationRecord,
  MutationResult,
  Table as BridgeTable,
} from '../../bridges/compute/compute-types.gen';
import type { MutationAdmissionOptions } from '../../bridges/compute';
import { extractMutationData } from '../../bridges/compute/compute-core';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { resolveCell, resolveRange } from '../internal/address-resolver';
import { createVersionOperationContext } from '../internal/version-operation-context';

type AnnotationMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

type CellAnnotationEventAction = 'set' | 'removed' | 'acceptedStale';

function assertAnnotationText(text: unknown): string {
  if (typeof text !== 'string') {
    throw new KernelError('API_INVALID_ARGUMENT', 'Annotation text must be a string.');
  }
  return text;
}

function assertSupportedValidationMode(
  options: WorksheetAnnotationReadOptions | WorksheetAnnotationDiagnosticReadOptions | undefined,
): void {
  if (options?.validate === 'skip') {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      'Annotation validate: "skip" is not supported by the current kernel bridge.',
    );
  }
}

function assertLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 0) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      'Annotation list limit must be a non-negative integer.',
    );
  }
  return limit;
}

function sameTableRef(table: BridgeTable, tableRef: string): boolean {
  const normalizedRef = tableRef.toLowerCase();
  return (
    table.id === tableRef ||
    table.name.toLowerCase() === normalizedRef ||
    table.displayName.toLowerCase() === normalizedRef
  );
}

function toAnnotationRecord(record: BridgeAnnotationRecord): WorksheetAnnotationRecord {
  return record;
}

function currentRef(row: number, col: number): string {
  return toA1(row, col);
}

function toCellAnnotationRecord(
  record: BridgeAnnotationRecord,
  position?: { row: number; col: number },
): WorksheetCellAnnotationRecord {
  if (!position) return record;
  return {
    ...record,
    row: position.row,
    col: position.col,
    currentRef: currentRef(position.row, position.col),
  };
}

function toCellAnnotationView(record: WorksheetCellAnnotationRecord): WorksheetCellAnnotationView {
  const view: WorksheetCellAnnotationView = {
    id: record.id,
    anchorId: record.anchorId,
    status: record.status,
    ...(record.status === 'fresh' ? { text: record.text } : {}),
    ...(record.staleReason ? { staleReason: record.staleReason } : {}),
    updatedAt: record.updatedAt,
    ...(record.checkedAt !== undefined ? { checkedAt: record.checkedAt } : {}),
    ...(record.row !== undefined ? { row: record.row } : {}),
    ...(record.col !== undefined ? { col: record.col } : {}),
    ...(record.currentRef ? { currentRef: record.currentRef } : {}),
  };
  return view;
}

function toAnnotationDeleteResult(
  result: BridgeAnnotationDeleteResult,
): WorksheetAnnotationDeleteResult {
  return result;
}

function toCellAnnotationDeleteResult(
  result: BridgeAnnotationDeleteResult,
  position?: { row: number; col: number },
): WorksheetCellAnnotationDeleteResult {
  return {
    anchorId: result.anchorId,
    removed: result.removed,
    ...(result.annotation
      ? { annotation: toCellAnnotationRecord(result.annotation, position) }
      : {}),
  };
}

function normalizeRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function containsCell(range: CellRange, row: number, col: number): boolean {
  const normalized = normalizeRange(range);
  return (
    row >= normalized.startRow &&
    row <= normalized.endRow &&
    col >= normalized.startCol &&
    col <= normalized.endCol
  );
}

function diagnosticIncludes(
  record: WorksheetCellAnnotationRecord,
  options: WorksheetAnnotationDiagnosticReadOptions | undefined,
): boolean {
  if (record.status === 'fresh') return true;
  if (record.status === 'stale') return options?.includeStale === true;
  return options?.includeUnchecked === true;
}

export class WorksheetAnnotationsImpl implements WorksheetAnnotations {
  readonly cells: WorksheetCellAnnotations;

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {
    this.cells = new WorksheetCellAnnotationsImpl(this);
  }

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  private _mutationOptions(operationIdPrefix: string): AnnotationMutationOptions {
    const operationContext = createVersionOperationContext(this.ctx, {
      operationIdPrefix,
      sheetIds: [this.sheetId],
      domainIds: ['annotations'],
    });
    return {
      operationContext: {
        ...operationContext,
        capturePolicy: 'excluded',
        writeAdmissionMode: 'captureDisabledNoHistory',
      },
    };
  }

  private _emitCellAnnotationChanged(
    action: CellAnnotationEventAction,
    row: number,
    col: number,
    record: WorksheetCellAnnotationRecord | undefined,
    anchorId: string,
  ): void {
    this.ctx.eventBus.emit({
      type: 'cellAnnotation:changed',
      timestamp: this.ctx.clock.now(),
      sheetId: this.sheetId,
      row,
      col,
      anchorId,
      ...(record ? { annotationId: record.id, status: record.status } : {}),
      action,
      source: 'api',
    });
  }

  private _emitCellAnnotationsCleared(range?: CellRange): void {
    this.ctx.eventBus.emit({
      type: 'cellAnnotations:cleared',
      timestamp: this.ctx.clock.now(),
      sheetId: this.sheetId,
      ...(range ? { range: normalizeRange(range) } : {}),
      source: 'api',
    });
  }

  private _cellArgs(
    cellOrRow: WorksheetCellAnnotationRef | number,
    colOrText?: number | string,
    maybeText?: string,
  ): { row: number; col: number; text: string } {
    if (typeof cellOrRow === 'number') {
      if (typeof colOrText !== 'number') {
        throw new KernelError('API_INVALID_ARGUMENT', 'Cell annotation column must be a number.');
      }
      const { row, col } = resolveCell(cellOrRow, colOrText);
      return { row, col, text: assertAnnotationText(maybeText) };
    }
    const { row, col } = this._cellPosition(cellOrRow);
    return { row, col, text: assertAnnotationText(colOrText) };
  }

  _cellPosition(
    cellOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
  ): { row: number; col: number } {
    if (typeof cellOrRow === 'number') return resolveCell(cellOrRow, maybeCol);
    if (typeof cellOrRow === 'string') return resolveCell(cellOrRow);
    if (
      cellOrRow &&
      typeof cellOrRow === 'object' &&
      typeof cellOrRow.row === 'number' &&
      typeof cellOrRow.col === 'number'
    ) {
      return resolveCell(cellOrRow.row, cellOrRow.col);
    }
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      'Cell annotation ref must be an A1 address or row/col object.',
    );
  }

  private _range(range: string | CellRange | undefined): CellRange | undefined {
    if (range === undefined) return undefined;
    return typeof range === 'string' ? resolveRange(range) : resolveRange(range);
  }

  private async _tablesInSheet(): Promise<BridgeTable[]> {
    return this.ctx.computeBridge.getAllTablesInSheet(this.sheetId);
  }

  private async _resolveTableId(tableRef: string): Promise<string> {
    const tables = await this._tablesInSheet();
    const table = tables.find((candidate) => sameTableRef(candidate, tableRef));
    if (!table) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Table not found on worksheet for annotation: ${tableRef}`,
      );
    }
    return table.id;
  }

  private _requireRecord(result: MutationResult, operation: string): WorksheetAnnotationRecord {
    const record = extractMutationData<BridgeAnnotationRecord>(result);
    if (!record) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `${operation}: no annotation returned in MutationResult.data`,
      );
    }
    return toAnnotationRecord(record);
  }

  private _requireDeleteResult(
    result: MutationResult,
    operation: string,
  ): WorksheetAnnotationDeleteResult {
    const deleted = extractMutationData<BridgeAnnotationDeleteResult>(result);
    if (!deleted) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `${operation}: no annotation delete result returned in MutationResult.data`,
      );
    }
    return toAnnotationDeleteResult(deleted);
  }

  private _requireCellDeleteResult(
    result: MutationResult,
    operation: string,
    position: { row: number; col: number },
  ): WorksheetCellAnnotationDeleteResult {
    const deleted = extractMutationData<BridgeAnnotationDeleteResult>(result);
    if (!deleted) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `${operation}: no annotation delete result returned in MutationResult.data`,
      );
    }
    return toCellAnnotationDeleteResult(deleted, position);
  }

  async _setCellAnnotation(
    cellOrRow: WorksheetCellAnnotationRef | number,
    colOrText: number | string,
    maybeText?: string,
    action: Extract<CellAnnotationEventAction, 'set' | 'acceptedStale'> = 'set',
  ): Promise<WorksheetCellAnnotationRecord> {
    this._ensureWritable('worksheet.annotations.cells.set');
    const { row, col, text } = this._cellArgs(cellOrRow, colOrText, maybeText);
    const result = await this.ctx.computeBridge.setCellAnnotationByPosition(
      this.sheetId,
      row,
      col,
      text,
      this._mutationOptions('worksheet.annotations.cells.set'),
    );
    const record = toCellAnnotationRecord(
      this._requireRecord(result, 'setCellAnnotationByPosition'),
      { row, col },
    );
    this._emitCellAnnotationChanged(action, row, col, record, record.anchorId);
    return record;
  }

  async _getCellAnnotationRecord(
    cellOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
    options?: WorksheetAnnotationDiagnosticReadOptions,
  ): Promise<WorksheetCellAnnotationRecord | null> {
    assertSupportedValidationMode(options);
    const { row, col } = this._cellPosition(cellOrRow, maybeCol);
    const record = await this.ctx.computeBridge.getCellAnnotationByPosition(this.sheetId, row, col);
    if (!record) return null;
    const cellRecord = toCellAnnotationRecord(record, { row, col });
    return diagnosticIncludes(cellRecord, options) ? cellRecord : null;
  }

  async _getCellAnnotationView(
    cellOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
    options?: WorksheetAnnotationReadOptions,
  ): Promise<WorksheetCellAnnotationView | null> {
    assertSupportedValidationMode(options);
    const { row, col } = this._cellPosition(cellOrRow, maybeCol);
    const record = await this.ctx.computeBridge.getCellAnnotationByPosition(this.sheetId, row, col);
    return record ? toCellAnnotationView(toCellAnnotationRecord(record, { row, col })) : null;
  }

  async _removeCellAnnotation(
    cellOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
  ): Promise<WorksheetCellAnnotationDeleteResult> {
    this._ensureWritable('worksheet.annotations.cells.remove');
    const position = this._cellPosition(cellOrRow, maybeCol);
    const result = await this.ctx.computeBridge.removeCellAnnotationByPosition(
      this.sheetId,
      position.row,
      position.col,
      this._mutationOptions('worksheet.annotations.cells.remove'),
    );
    const deleted = this._requireCellDeleteResult(
      result,
      'removeCellAnnotationByPosition',
      position,
    );
    if (deleted.removed) {
      this._emitCellAnnotationChanged(
        'removed',
        position.row,
        position.col,
        deleted.annotation,
        deleted.anchorId,
      );
    }
    return deleted;
  }

  async _listCellAnnotationRecords(
    options: WorksheetCellAnnotationDiagnosticListOptions | undefined,
  ): Promise<WorksheetCellAnnotationRecord[]> {
    assertSupportedValidationMode(options);
    const range = this._range(options?.range);
    const limit = assertLimit(options?.limit);
    const records = await this.ctx.computeBridge.listCellAnnotations(this.sheetId);
    const positions = await this.ctx.computeBridge.resolveCellPositions(
      records.map((record) => record.anchorId),
    );

    const result: WorksheetCellAnnotationRecord[] = [];
    for (let i = 0; i < records.length; i++) {
      const position = positions[i]
        ? { row: positions[i]!.row, col: positions[i]!.col }
        : undefined;
      const record = toCellAnnotationRecord(records[i], position);
      if (range && (record.row === undefined || record.col === undefined)) continue;
      if (range && !containsCell(range, record.row!, record.col!)) continue;
      if (!diagnosticIncludes(record, options)) continue;
      result.push(record);
      if (limit !== undefined && result.length >= limit) break;
    }
    return result;
  }

  async _listCellAnnotationViews(
    options: WorksheetCellAnnotationListOptions | undefined,
  ): Promise<WorksheetCellAnnotationView[]> {
    assertSupportedValidationMode(options);
    const records = await this._listCellAnnotationRecords({
      ...options,
      includeStale: true,
      includeUnchecked: true,
    });
    return records.map(toCellAnnotationView);
  }

  async _clearCellAnnotations(rangeInput?: string | CellRange): Promise<void> {
    this._ensureWritable('worksheet.annotations.cells.clear');
    const range = this._range(rangeInput);
    const records = await this._listCellAnnotationRecords({
      range,
      includeStale: true,
      includeUnchecked: true,
    });
    for (const record of records) {
      if (record.row === undefined || record.col === undefined) continue;
      await this._removeCellAnnotation(record.row, record.col);
    }
    this._emitCellAnnotationsCleared(range);
  }

  async _acceptStaleCellAnnotation(
    cellOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
  ): Promise<WorksheetCellAnnotationRecord> {
    const position = this._cellPosition(cellOrRow, maybeCol);
    const record = await this._getCellAnnotationRecord(position, undefined, {
      includeStale: true,
      includeUnchecked: true,
    });
    if (!record) {
      throw new KernelError(
        'API_INVALID_ARGUMENT',
        'No cell annotation exists at the requested cell.',
      );
    }
    return this._setCellAnnotation(position.row, position.col, record.text, 'acceptedStale');
  }

  async setCell(cell: string, text: string): Promise<WorksheetAnnotationRecord>;
  async setCell(row: number, col: number, text: string): Promise<WorksheetAnnotationRecord>;
  async setCell(
    cellOrRow: string | number,
    colOrText: number | string,
    maybeText?: string,
  ): Promise<WorksheetAnnotationRecord> {
    return this._setCellAnnotation(cellOrRow, colOrText, maybeText);
  }

  async getCell(cell: string): Promise<WorksheetAnnotationRecord | null>;
  async getCell(row: number, col: number): Promise<WorksheetAnnotationRecord | null>;
  async getCell(
    cellOrRow: string | number,
    maybeCol?: number,
  ): Promise<WorksheetAnnotationRecord | null> {
    return this._getCellAnnotationRecord(cellOrRow, maybeCol, {
      includeStale: true,
      includeUnchecked: true,
    });
  }

  async removeCell(cell: string): Promise<WorksheetAnnotationDeleteResult>;
  async removeCell(row: number, col: number): Promise<WorksheetAnnotationDeleteResult>;
  async removeCell(
    cellOrRow: string | number,
    maybeCol?: number,
  ): Promise<WorksheetAnnotationDeleteResult> {
    const { row, col } = this._cellPosition(cellOrRow, maybeCol);
    const result = await this.ctx.computeBridge.removeCellAnnotationByPosition(
      this.sheetId,
      row,
      col,
      this._mutationOptions('worksheet.annotations.removeCell'),
    );
    const deleted = this._requireDeleteResult(result, 'removeCellAnnotationByPosition');
    if (deleted.removed) {
      this._emitCellAnnotationChanged(
        'removed',
        row,
        col,
        deleted.annotation ? toCellAnnotationRecord(deleted.annotation, { row, col }) : undefined,
        deleted.anchorId,
      );
    }
    return deleted;
  }

  async listCells(): Promise<WorksheetAnnotationRecord[]> {
    return this._listCellAnnotationRecords({
      includeStale: true,
      includeUnchecked: true,
    });
  }

  async setTable(tableRef: string, text: string): Promise<WorksheetAnnotationRecord> {
    this._ensureWritable('worksheet.annotations.setTable');
    const tableId = await this._resolveTableId(tableRef);
    const result = await this.ctx.computeBridge.setTableAnnotation(
      tableId,
      assertAnnotationText(text),
      this._mutationOptions('worksheet.annotations.setTable'),
    );
    return this._requireRecord(result, 'setTableAnnotation');
  }

  async getTable(tableRef: string): Promise<WorksheetAnnotationRecord | null> {
    const tableId = await this._resolveTableId(tableRef);
    const record = await this.ctx.computeBridge.getTableAnnotation(tableId);
    return record ? toAnnotationRecord(record) : null;
  }

  async removeTable(tableRef: string): Promise<WorksheetAnnotationDeleteResult> {
    this._ensureWritable('worksheet.annotations.removeTable');
    const tableId = await this._resolveTableId(tableRef);
    const result = await this.ctx.computeBridge.removeTableAnnotation(
      tableId,
      this._mutationOptions('worksheet.annotations.removeTable'),
    );
    return this._requireDeleteResult(result, 'removeTableAnnotation');
  }

  async listTables(): Promise<WorksheetAnnotationRecord[]> {
    const tables = await this._tablesInSheet();
    const tableIds = new Set(tables.map((table) => table.id));
    const records = await this.ctx.computeBridge.listTableAnnotations();
    return records.filter((record) => tableIds.has(record.anchorId)).map(toAnnotationRecord);
  }
}

class WorksheetCellAnnotationsImpl implements WorksheetCellAnnotations {
  readonly diagnostics: WorksheetCellAnnotationDiagnostics;

  constructor(private readonly owner: WorksheetAnnotationsImpl) {
    this.diagnostics = new WorksheetCellAnnotationDiagnosticsImpl(owner);
  }

  async set(ref: WorksheetCellAnnotationRef, text: string): Promise<WorksheetCellAnnotationRecord>;
  async set(row: number, col: number, text: string): Promise<WorksheetCellAnnotationRecord>;
  async set(
    refOrRow: WorksheetCellAnnotationRef | number,
    colOrText: number | string,
    maybeText?: string,
  ): Promise<WorksheetCellAnnotationRecord> {
    return this.owner._setCellAnnotation(refOrRow, colOrText, maybeText);
  }

  async setMany(entries: readonly WorksheetCellAnnotationWriteEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.owner._setCellAnnotation(entry.ref, entry.text);
    }
  }

  async get(
    ref: WorksheetCellAnnotationRef,
    options?: WorksheetAnnotationReadOptions,
  ): Promise<WorksheetCellAnnotationView | null>;
  async get(
    row: number,
    col: number,
    options?: WorksheetAnnotationReadOptions,
  ): Promise<WorksheetCellAnnotationView | null>;
  async get(
    refOrRow: WorksheetCellAnnotationRef | number,
    colOrOptions?: number | WorksheetAnnotationReadOptions,
    maybeOptions?: WorksheetAnnotationReadOptions,
  ): Promise<WorksheetCellAnnotationView | null> {
    return typeof refOrRow === 'number'
      ? this.owner._getCellAnnotationView(refOrRow, colOrOptions as number, maybeOptions)
      : this.owner._getCellAnnotationView(
          refOrRow,
          undefined,
          colOrOptions as WorksheetAnnotationReadOptions,
        );
  }

  async getText(ref: WorksheetCellAnnotationRef): Promise<string | null>;
  async getText(row: number, col: number): Promise<string | null>;
  async getText(
    refOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
  ): Promise<string | null> {
    const view = await this.owner._getCellAnnotationView(refOrRow, maybeCol);
    return view?.text ?? null;
  }

  async list(options?: WorksheetCellAnnotationListOptions): Promise<WorksheetCellAnnotationView[]> {
    return this.owner._listCellAnnotationViews(options);
  }

  async remove(ref: WorksheetCellAnnotationRef): Promise<WorksheetCellAnnotationDeleteResult>;
  async remove(row: number, col: number): Promise<WorksheetCellAnnotationDeleteResult>;
  async remove(
    refOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
  ): Promise<WorksheetCellAnnotationDeleteResult> {
    return this.owner._removeCellAnnotation(refOrRow, maybeCol);
  }

  async clear(range?: string | CellRange): Promise<void> {
    return this.owner._clearCellAnnotations(range);
  }

  async acceptStale(ref: WorksheetCellAnnotationRef): Promise<WorksheetCellAnnotationRecord>;
  async acceptStale(row: number, col: number): Promise<WorksheetCellAnnotationRecord>;
  async acceptStale(
    refOrRow: WorksheetCellAnnotationRef | number,
    maybeCol?: number,
  ): Promise<WorksheetCellAnnotationRecord> {
    return this.owner._acceptStaleCellAnnotation(refOrRow, maybeCol);
  }
}

class WorksheetCellAnnotationDiagnosticsImpl implements WorksheetCellAnnotationDiagnostics {
  constructor(private readonly owner: WorksheetAnnotationsImpl) {}

  async get(
    ref: WorksheetCellAnnotationRef,
    options?: WorksheetAnnotationDiagnosticReadOptions,
  ): Promise<WorksheetCellAnnotationRecord | null>;
  async get(
    row: number,
    col: number,
    options?: WorksheetAnnotationDiagnosticReadOptions,
  ): Promise<WorksheetCellAnnotationRecord | null>;
  async get(
    refOrRow: WorksheetCellAnnotationRef | number,
    colOrOptions?: number | WorksheetAnnotationDiagnosticReadOptions,
    maybeOptions?: WorksheetAnnotationDiagnosticReadOptions,
  ): Promise<WorksheetCellAnnotationRecord | null> {
    return typeof refOrRow === 'number'
      ? this.owner._getCellAnnotationRecord(refOrRow, colOrOptions as number, maybeOptions)
      : this.owner._getCellAnnotationRecord(
          refOrRow,
          undefined,
          colOrOptions as WorksheetAnnotationDiagnosticReadOptions,
        );
  }

  async list(
    options?: WorksheetCellAnnotationDiagnosticListOptions,
  ): Promise<WorksheetCellAnnotationRecord[]> {
    return this.owner._listCellAnnotationRecords(options);
  }
}
