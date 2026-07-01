/**
 * WorksheetAnnotationsImpl - Implementation of the WorksheetAnnotations sub-API.
 */

import type {
  SheetId,
  WorksheetAnnotationDeleteResult,
  WorksheetAnnotationRecord,
  WorksheetAnnotations,
} from '@mog-sdk/contracts/api';
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
import { resolveCell } from '../internal/address-resolver';
import { createVersionOperationContext } from '../internal/version-operation-context';

type AnnotationMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

function assertAnnotationText(text: unknown): string {
  if (typeof text !== 'string') {
    throw new KernelError('API_INVALID_ARGUMENT', 'Annotation text must be a string.');
  }
  return text;
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

function toAnnotationDeleteResult(
  result: BridgeAnnotationDeleteResult,
): WorksheetAnnotationDeleteResult {
  return result;
}

export class WorksheetAnnotationsImpl implements WorksheetAnnotations {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

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

  private _cellArgs(
    cellOrRow: string | number,
    colOrText?: number | string,
    maybeText?: string,
  ): { row: number; col: number; text: string } {
    if (typeof cellOrRow === 'string') {
      const { row, col } = resolveCell(cellOrRow);
      return { row, col, text: assertAnnotationText(colOrText) };
    }
    const col = colOrText;
    if (typeof col !== 'number') {
      throw new KernelError('API_INVALID_ARGUMENT', 'Cell annotation column must be a number.');
    }
    return { row: cellOrRow, col, text: assertAnnotationText(maybeText) };
  }

  private _cellPosition(
    cellOrRow: string | number,
    maybeCol?: number,
  ): { row: number; col: number } {
    return typeof cellOrRow === 'string'
      ? resolveCell(cellOrRow)
      : resolveCell(cellOrRow, maybeCol);
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

  async setCell(cell: string, text: string): Promise<WorksheetAnnotationRecord>;
  async setCell(row: number, col: number, text: string): Promise<WorksheetAnnotationRecord>;
  async setCell(
    cellOrRow: string | number,
    colOrText: number | string,
    maybeText?: string,
  ): Promise<WorksheetAnnotationRecord> {
    this._ensureWritable('worksheet.annotations.setCell');
    const { row, col, text } = this._cellArgs(cellOrRow, colOrText, maybeText);
    const result = await this.ctx.computeBridge.setCellAnnotationByPosition(
      this.sheetId,
      row,
      col,
      text,
      this._mutationOptions('worksheet.annotations.setCell'),
    );
    return this._requireRecord(result, 'setCellAnnotationByPosition');
  }

  async getCell(cell: string): Promise<WorksheetAnnotationRecord | null>;
  async getCell(row: number, col: number): Promise<WorksheetAnnotationRecord | null>;
  async getCell(
    cellOrRow: string | number,
    maybeCol?: number,
  ): Promise<WorksheetAnnotationRecord | null> {
    const { row, col } = this._cellPosition(cellOrRow, maybeCol);
    const record = await this.ctx.computeBridge.getCellAnnotationByPosition(this.sheetId, row, col);
    return record ? toAnnotationRecord(record) : null;
  }

  async removeCell(cell: string): Promise<WorksheetAnnotationDeleteResult>;
  async removeCell(row: number, col: number): Promise<WorksheetAnnotationDeleteResult>;
  async removeCell(
    cellOrRow: string | number,
    maybeCol?: number,
  ): Promise<WorksheetAnnotationDeleteResult> {
    this._ensureWritable('worksheet.annotations.removeCell');
    const { row, col } = this._cellPosition(cellOrRow, maybeCol);
    const result = await this.ctx.computeBridge.removeCellAnnotationByPosition(
      this.sheetId,
      row,
      col,
      this._mutationOptions('worksheet.annotations.removeCell'),
    );
    return this._requireDeleteResult(result, 'removeCellAnnotationByPosition');
  }

  async listCells(): Promise<WorksheetAnnotationRecord[]> {
    const records = await this.ctx.computeBridge.listCellAnnotations(this.sheetId);
    return records.map(toAnnotationRecord);
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
