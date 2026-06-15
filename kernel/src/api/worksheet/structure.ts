/**
 * WorksheetStructureImpl — Implementation of the WorksheetStructure sub-API.
 *
 * Calls through to computeBridge directly for all structure and merge operations,
 * without the OperationResult/unwrap ceremony.
 */
import type {
  CellRange,
  DeleteCellsReceipt,
  DeleteColumnsReceipt,
  DeleteRowsReceipt,
  InsertCellsReceipt,
  InsertColumnsReceipt,
  InsertRowsReceipt,
  MergeReceipt,
  MergedRegion,
  RemoveDuplicatesResult,
  SheetId,
  TextToColumnsOptions,
  TextToColumnsResult,
  UnmergeReceipt,
  WorksheetStructure,
} from '@mog-sdk/contracts/api';

import type { ProtectionOperation } from '@mog-sdk/contracts/api';

import type { MutationResult } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { resolveCell, resolveRange } from '../internal/address-resolver';
import { normalizeRange, toA1 } from '../internal/utils';
import { WorksheetProtectionImpl } from './protection';

export class WorksheetStructureImpl implements WorksheetStructure {
  private _protection?: WorksheetProtectionImpl;

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private get protectionApi(): WorksheetProtectionImpl {
    return (this._protection ??= new WorksheetProtectionImpl(this.ctx, this.sheetId));
  }

  /**
   * Guard: throws WriteGateError if the document is not writable (the write gate).
   */
  private _ensureWritable(operation: string): void {
    this.ctx.writeGate.assertWritable(operation);
  }

  /**
   * Throws if the sheet is protected and the given structure operation is not allowed.
   */
  private async ensureStructureOpAllowed(operation: ProtectionOperation): Promise<void> {
    const allowed = await this.protectionApi.canDoStructureOp(operation);
    if (!allowed) {
      throw new KernelError(
        'OPERATION_FAILED',
        `Cannot perform ${operation}: sheet is protected and operation is not allowed`,
      );
    }
  }

  // ===========================================================================
  // Row / Column insertion and deletion
  // ===========================================================================

  async insertRows(index: number, count: number): Promise<InsertRowsReceipt> {
    this._ensureWritable('structure.insertRows');
    if (index < 0) throw new KernelError('API_INVALID_ADDRESS', `Invalid row index: ${index}`);
    if (count <= 0)
      return { kind: 'insertRows', sheetId: this.sheetId, insertedAt: index, count: 0 };
    await this.ensureStructureOpAllowed('insertRows');
    const result = (await this.ctx.computeBridge.structureChange(this.sheetId, {
      InsertRows: { at: index, count, new_row_ids: [] },
    })) as MutationResult | void;
    const sc = result?.structureChanges?.[0];
    return {
      kind: 'insertRows',
      sheetId: sc?.sheetId ?? this.sheetId,
      insertedAt: sc?.at ?? index,
      count: sc?.count ?? count,
    };
  }

  async deleteRows(index: number, count: number): Promise<DeleteRowsReceipt> {
    this._ensureWritable('structure.deleteRows');
    if (index < 0) throw new KernelError('API_INVALID_ADDRESS', `Invalid row index: ${index}`);
    if (count <= 0)
      return { kind: 'deleteRows', sheetId: this.sheetId, deletedAt: index, count: 0 };
    await this.ensureStructureOpAllowed('deleteRows');
    const result = (await this.ctx.computeBridge.structureChange(this.sheetId, {
      DeleteRows: { at: index, count, deleted_cell_ids: [] },
    })) as MutationResult | void;
    const sc = result?.structureChanges?.[0];
    return {
      kind: 'deleteRows',
      sheetId: sc?.sheetId ?? this.sheetId,
      deletedAt: sc?.at ?? index,
      count: sc?.count ?? count,
    };
  }

  async insertColumns(index: number, count: number): Promise<InsertColumnsReceipt> {
    this._ensureWritable('structure.insertColumns');
    if (index < 0) throw new KernelError('API_INVALID_ADDRESS', `Invalid column index: ${index}`);
    if (count <= 0)
      return { kind: 'insertColumns', sheetId: this.sheetId, insertedAt: index, count: 0 };
    await this.ensureStructureOpAllowed('insertColumns');
    const result = (await this.ctx.computeBridge.structureChange(this.sheetId, {
      InsertCols: { at: index, count, new_col_ids: [] },
    })) as MutationResult | void;
    const sc = result?.structureChanges?.[0];
    return {
      kind: 'insertColumns',
      sheetId: sc?.sheetId ?? this.sheetId,
      insertedAt: sc?.at ?? index,
      count: sc?.count ?? count,
    };
  }

  async deleteColumns(index: number, count: number): Promise<DeleteColumnsReceipt> {
    this._ensureWritable('structure.deleteColumns');
    if (index < 0) throw new KernelError('API_INVALID_ADDRESS', `Invalid column index: ${index}`);
    if (count <= 0)
      return { kind: 'deleteColumns', sheetId: this.sheetId, deletedAt: index, count: 0 };
    await this.ensureStructureOpAllowed('deleteColumns');
    const result = (await this.ctx.computeBridge.structureChange(this.sheetId, {
      DeleteCols: { at: index, count, deleted_cell_ids: [] },
    })) as MutationResult | void;
    const sc = result?.structureChanges?.[0];
    return {
      kind: 'deleteColumns',
      sheetId: sc?.sheetId ?? this.sheetId,
      deletedAt: sc?.at ?? index,
      count: sc?.count ?? count,
    };
  }

  // ===========================================================================
  // Cell shifting
  // ===========================================================================

  async insertCellsWithShift(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    direction: 'right' | 'down',
  ): Promise<InsertCellsReceipt> {
    this._ensureWritable('structure.insertCellsWithShift');
    await this.ensureStructureOpAllowed(direction === 'right' ? 'insertColumns' : 'insertRows');
    const rowCount = endRow - startRow + 1;
    const colCount = endCol - startCol + 1;
    const shiftRight = direction === 'right';
    await this.ctx.computeBridge.insertCellsWithShift(
      this.sheetId,
      startRow,
      startCol,
      rowCount,
      colCount,
      shiftRight,
    );
    return {
      kind: 'insertCells',
      sheetId: this.sheetId,
      range: { startRow, startCol, endRow, endCol },
      direction,
    };
  }

  async deleteCellsWithShift(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    direction: 'left' | 'up',
  ): Promise<DeleteCellsReceipt> {
    this._ensureWritable('structure.deleteCellsWithShift');
    await this.ensureStructureOpAllowed(direction === 'left' ? 'deleteColumns' : 'deleteRows');
    const rowCount = endRow - startRow + 1;
    const colCount = endCol - startCol + 1;
    const shiftLeft = direction === 'left';
    await this.ctx.computeBridge.deleteCellsWithShift(
      this.sheetId,
      startRow,
      startCol,
      rowCount,
      colCount,
      shiftLeft,
    );
    return {
      kind: 'deleteCells',
      sheetId: this.sheetId,
      range: { startRow, startCol, endRow, endCol },
      direction,
    };
  }

  // ===========================================================================
  // Dimensions
  // ===========================================================================

  async getRowCount(): Promise<number> {
    try {
      const bounds = await this.ctx.computeBridge.getDataBounds(this.sheetId);
      if (!bounds) return 0;
      return bounds.maxRow + 1;
    } catch {
      return 0;
    }
  }

  async getColumnCount(): Promise<number> {
    try {
      const bounds = await this.ctx.computeBridge.getDataBounds(this.sheetId);
      if (!bounds) return 0;
      return bounds.maxCol + 1;
    } catch {
      return 0;
    }
  }

  // ===========================================================================
  // Data operations
  // ===========================================================================

  async textToColumns(
    range: string | CellRange,
    options: TextToColumnsOptions,
  ): Promise<TextToColumnsResult> {
    this._ensureWritable('structure.textToColumns');
    const parsed = resolveRange(range);
    const dest = resolveTextToColumnsDestination(options.destination, parsed);
    const bridgeOptions = toBridgeTextToColumnsOptions(options);
    const raw = await this.ctx.computeBridge.textToColumns(
      this.sheetId,
      parsed.startRow,
      parsed.endRow,
      parsed.startCol,
      dest.row,
      dest.col,
      bridgeOptions,
    );
    // The ComputeBridge.textToColumns override handles the YRS → mirror sync
    // (read-back + setCellsByPosition) so no forceRefreshAllViewports needed here.
    const payload = (raw as MutationResult).data as
      | { rowsProcessed?: number; columnsCreated?: number }
      | undefined;
    return {
      rowsProcessed: payload?.rowsProcessed ?? parsed.endRow - parsed.startRow + 1,
      columnsCreated: payload?.columnsCreated ?? 1,
    };
  }

  async removeDuplicates(
    range: string | CellRange,
    columns: number[],
    hasHeaders?: boolean,
  ): Promise<RemoveDuplicatesResult> {
    this._ensureWritable('structure.removeDuplicates');
    const parsed = resolveRange(range);
    const raw = await this.ctx.computeBridge.removeDuplicates(
      this.sheetId,
      parsed.startRow,
      parsed.startCol,
      parsed.endRow,
      parsed.endCol,
      columns,
      hasHeaders ?? false,
    );
    // Rust returns full-viewport patches for this operation and the viewport
    // coordinator applies those patches directly, so no follow-up refresh is
    // needed here.
    // The bridge returns MutationResult whose `.data` field carries the
    // removeDuplicates stats as a JSON object set via `with_data` on the Rust side.
    const payload = (raw as MutationResult).data as
      | { duplicatesRemoved?: number; uniqueValuesRemaining?: number }
      | undefined;
    return {
      removedCount: payload?.duplicatesRemoved ?? 0,
      remainingCount: payload?.uniqueValuesRemaining ?? 0,
    };
  }

  // ===========================================================================
  // Merges
  // ===========================================================================

  async merge(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<MergeReceipt> {
    this._ensureWritable('structure.merge');
    const bounds = resolveRange(a, b, c, d);
    const normalized = normalizeRange(bounds);

    if (normalized.startRow === normalized.endRow && normalized.startCol === normalized.endCol) {
      throw new KernelError('COMPUTE_ERROR', 'Cannot merge a single cell');
    }

    await this.ctx.computeBridge.mergeRange(
      this.sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
    );
    // Merge changes cell geometry — force-refresh all viewports so the
    // ViewportMergeIndex is rebuilt immediately (not deferred to next scroll).
    // Without this, clicking a merged slave cell right after the merge
    // finds a stale VMI (null entry), so the active cell snaps to the
    // clicked col rather than the merge's top-left origin.
    this.ctx.computeBridge.invalidateAllViewportPrefetch();
    await this.ctx.computeBridge.forceRefreshAllViewports();
    return {
      kind: 'merge',
      range: `${toA1(normalized.startRow, normalized.startCol)}:${toA1(normalized.endRow, normalized.endCol)}`,
    };
  }

  async unmerge(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<UnmergeReceipt> {
    this._ensureWritable('structure.unmerge');
    const bounds = resolveRange(a, b, c, d);
    const normalized = normalizeRange(bounds);

    const overlappingMerges = await this.ctx.computeBridge.getMergesInViewportSpatial(
      this.sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
    );
    if (overlappingMerges.length === 0) {
      return {
        kind: 'unmerge',
        range: `${toA1(normalized.startRow, normalized.startCol)}:${toA1(normalized.endRow, normalized.endCol)}`,
      };
    }

    await this.ctx.computeBridge.unmergeRange(
      this.sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
    );
    // Unmerge changes cell geometry — force-refresh all viewports so the
    // ViewportMergeIndex is rebuilt immediately (not deferred to next scroll).
    this.ctx.computeBridge.invalidateAllViewportPrefetch();
    await this.ctx.computeBridge.forceRefreshAllViewports();
    return {
      kind: 'unmerge',
      range: `${toA1(normalized.startRow, normalized.startCol)}:${toA1(normalized.endRow, normalized.endCol)}`,
    };
  }

  async getMergedRegions(): Promise<MergedRegion[]> {
    const regions = await this.ctx.computeBridge.getAllMergesInSheet(this.sheetId);
    return regions.map((r) => ({
      range: `${toA1(r.startRow, r.startCol)}:${toA1(r.endRow, r.endCol)}`,
      startRow: r.startRow,
      startCol: r.startCol,
      endRow: r.endRow,
      endCol: r.endCol,
      rowSpan: r.endRow - r.startRow + 1,
      colSpan: r.endCol - r.startCol + 1,
    }));
  }

  async getMergeAtCell(a: string | number, b?: number): Promise<CellRange | null> {
    const { row, col } = resolveCell(a, b);
    const info = await this.ctx.computeBridge.getMergeAtCellQuery(this.sheetId, row, col);
    if (!info) return null;
    return {
      startRow: info.merge.startRow,
      startCol: info.merge.startCol,
      endRow: info.merge.endRow,
      endCol: info.merge.endCol,
    };
  }
}

// =============================================================================
// Internal helpers
// =============================================================================

function resolveTextToColumnsDestination(
  destination: TextToColumnsOptions['destination'],
  source: CellRange,
): { row: number; col: number } {
  if (!destination) {
    return { row: source.startRow, col: source.startCol };
  }
  if (typeof destination === 'string') {
    return resolveCell(destination);
  }
  if (
    Number.isInteger(destination.row) &&
    destination.row >= 0 &&
    Number.isInteger(destination.col) &&
    destination.col >= 0
  ) {
    return destination;
  }
  throw new KernelError(
    'API_INVALID_ADDRESS',
    `Invalid text-to-columns destination: ${JSON.stringify(destination)}`,
  );
}

function toBridgeTextToColumnsOptions(options: TextToColumnsOptions): Record<string, unknown> {
  const splitType = options.type === 'fixedWidth' ? 'fixedWidth' : 'delimited';
  let delimiters: Record<string, boolean | string | undefined>;
  if (options.delimiters) {
    delimiters = {
      tab: options.delimiters.tab ?? false,
      comma: options.delimiters.comma ?? false,
      semicolon: options.delimiters.semicolon ?? false,
      space: options.delimiters.space ?? false,
    };
    if (options.delimiters.other) {
      delimiters.other = options.delimiters.other;
    }
  } else {
    const delimiter = options.delimiter ?? 'comma';
    delimiters = {
      tab: delimiter === 'tab',
      comma: delimiter === 'comma',
      semicolon: delimiter === 'semicolon',
      space: delimiter === 'space',
    };
    if (delimiter === 'custom' && options.customDelimiter) {
      delimiters.other = options.customDelimiter;
    }
  }

  let textQualifier: string;
  if (options.textQualifier === "'") {
    textQualifier = 'singleQuote';
  } else if (options.textQualifier === 'none') {
    textQualifier = 'none';
  } else {
    // default: double-quote (matches Rust default)
    textQualifier = 'doubleQuote';
  }

  return {
    splitType,
    delimiters,
    treatConsecutiveAsOne: options.treatConsecutiveAsOne ?? false,
    textQualifier,
    fixedWidthBreaks: options.fixedWidthBreaks ?? [],
  };
}
