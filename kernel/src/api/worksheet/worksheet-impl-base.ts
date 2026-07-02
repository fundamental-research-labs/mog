/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type {
  CellMetadataCache as CellMetadataCacheContract,
  CellRange,
  SheetId,
  ViewportReader,
  Workbook,
  WorkbookInternal,
  WorksheetAnnotations,
  WorksheetCharts,
  WorksheetFormControls,
  WorksheetInternal,
  WorksheetPivots,
  WorksheetProtection,
} from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects';

import { CellMetadataCache } from '../../bridges/wire/cell-metadata-cache';
import type { DocumentContext } from '../../context';
import { KernelError, toMogSdkError } from '../../errors';
import type { SpreadsheetObjectManager } from '../../floating-objects';
import { createHandleLiveness, type HandleLiveness } from '../lifecycle/handle-liveness';
import { resolveCell } from '../internal/address-resolver';
import { parseCellRange } from '../internal/utils';
import { renameSheet } from '../workbook/operations/sheet-crud-operations';
import { createVersionOperationContext } from '../workbook/version-operation-context';
import { ActiveCellEditSourceCache, type CellRangeBounds } from './active-cell-edit-source-cache';
import type { CellAnnotationTarget } from './annotation-write-options';
import type { FormulaCellWriteOptions } from './formula-api-helpers';

export abstract class WorksheetImplBase {
  protected readonly workbook: Workbook | null;
  protected readonly _liveness: HandleLiveness;
  protected _disposed = false;
  protected _cachedName: string | undefined;
  protected _cachedIndex: number;
  protected _cachedVisible: boolean;
  protected _viewport: ViewportReader | null = null;
  protected _cellMetadata: CellMetadataCacheContract | null = null;
  protected readonly _activeCellEditSourceCache = new ActiveCellEditSourceCache();
  protected _activeCellDataRefreshInFlight: {
    row: number;
    col: number;
    promise: Promise<void>;
  } | null = null;

  /**
   * Raw kernel CellMetadataCache instance (not the contract wrapper).
   * Used internally for auto-registration with MutationResultHandler (via computeBridge)
   * so post-recalc projection changes get patched into the cache.
   * @internal
   */
  _rawCellMetadataCache: CellMetadataCache | null = null;

  /** The workbook's singleton floating object manager, passed by WorkbookImpl. */
  protected readonly _floatingObjectManager: SpreadsheetObjectManager | null;

  /** Bounds reader injected from the renderer layer. */
  protected _boundsReader: IObjectBoundsReader | null = null;

  constructor(
    public readonly sheetId: SheetId,
    protected readonly ctx: DocumentContext,
    options?: {
      workbook?: Workbook | null;
      name?: string;
      index?: number;
      visible?: boolean;
      floatingObjectManager?: SpreadsheetObjectManager;
      liveness?: HandleLiveness;
    },
  ) {
    const { workbook, name, index, visible, floatingObjectManager, liveness } = options ?? {};
    this.workbook = workbook ?? null;
    this._liveness =
      liveness ??
      createHandleLiveness({
        label: 'Worksheet',
        code: 'BRIDGE_DISPOSED',
        metadata: { label: 'Worksheet', sheetId: String(sheetId) },
      });
    this._cachedName = name;
    this._cachedIndex = index ?? -1;
    this._cachedVisible = visible ?? true;
    this._floatingObjectManager = floatingObjectManager ?? null;
  }

  /**
   * Update cached metadata from the parent WorkbookImpl's sheet cache refresh.
   * Called by WorkbookImpl._refreshSheetCache() to keep long-lived instances in sync.
   * @internal
   */
  _syncMetadata(name: string, index: number, visible: boolean): void {
    this._assertLive('worksheet._syncMetadata');
    this._cachedName = name;
    this._cachedIndex = index;
    this._cachedVisible = visible;
  }

  // ===========================================================================
  // Identity (sync properties)
  // ===========================================================================

  /** SYNC — returns cached sheet name, updated by refreshSheetMetadata(). */
  get name(): string {
    this._assertLive('worksheet.name');
    return this._cachedName ?? this.sheetId;
  }

  /** SYNC — returns cached 0-based index, updated by refreshSheetMetadata(). */
  get index(): number {
    this._assertLive('worksheet.index');
    return this._cachedIndex;
  }

  // ===========================================================================
  // Identity (methods)
  // ===========================================================================

  async getName(): Promise<string> {
    this._assertLive('worksheet.getName');
    if (this._cachedName != null) {
      return this._cachedName;
    }
    const name = await this.ctx.computeBridge.getSheetName(this.sheetId);
    if (name != null) {
      this._cachedName = name;
      return name;
    }
    throw new Error(
      `Sheet name not available for sheetId "${this.sheetId}" — bridge returned null`,
    );
  }

  async setName(name: string): Promise<void> {
    this._assertLive('worksheet.setName');
    this._ensureWritable('worksheet.setName');
    this._invalidateActiveCellEditSourceForSheet(this.sheetId);
    await renameSheet(this.ctx, this.sheetId, name, {
      operationContext: createVersionOperationContext(this.ctx, {
        operationIdPrefix: 'worksheet.setName',
        sheetIds: [this.sheetId],
        domainIds: ['sheets'],
      }),
    });
    this._cachedName = name;
    // Sync workbook-level cached sheet metadata so wb.sheetNames reflects the rename
    await (this.workbook as WorkbookInternal | null)?.refreshSheetMetadata();
  }

  getIndex(): number {
    this._assertLive('worksheet.getIndex');
    return this._cachedIndex;
  }

  getSheetId(): SheetId {
    return this.sheetId;
  }

  protected abstract get annotations(): WorksheetAnnotations;
  protected abstract get charts(): WorksheetCharts;
  protected abstract get formControls(): WorksheetFormControls;
  protected abstract get pivots(): WorksheetPivots;
  protected abstract get protection(): WorksheetProtection;
  protected abstract get _internal(): WorksheetInternal;

  // ===========================================================================
  // Write gate guard (the write gate)
  // ===========================================================================

  /**
   * Guard: throws WriteGateError if the document is not writable.
   * Called at the top of public mutation methods.
   */
  protected _ensureWritable(operation: string): void {
    this._assertLive(operation);
    try {
      this.ctx.writeGate.assertWritable(operation);
    } catch (err) {
      throw toMogSdkError(err, operation);
    }
  }

  protected _invalidateActiveCellEditSourceForCell(row: number, col: number): void {
    this._activeCellEditSourceCache.invalidateForCell(this.sheetId, row, col);
  }

  protected _invalidateActiveCellEditSourceForRange(range: CellRangeBounds): void {
    this._activeCellEditSourceCache.invalidateForRange(this.sheetId, range);
  }

  protected _invalidateActiveCellEditSourceForSheet(sheetId: SheetId | string): void {
    this._activeCellEditSourceCache.invalidateForSheet(sheetId);
  }

  // ===========================================================================
  // Protection guard helpers
  // ===========================================================================

  /**
   * Throws if the sheet is protected and the given cell is locked.
   */
  protected async ensureCellEditable(row: number, col: number): Promise<void> {
    const canEdit = await this.protection.canEditCell(row, col);
    if (!canEdit) {
      throw new Error(`Cannot edit cell (${row}, ${col}): sheet is protected and cell is locked`);
    }
  }

  /**
   * Throws if any cell in the given range is protected and locked.
   * Fast path: if the sheet is not protected at all, skips all per-cell checks.
   */
  protected async ensureRangeEditable(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<void> {
    // Fast path: if sheet is not protected, nothing to check
    const sheetProtected = await this.protection.isProtected();
    if (!sheetProtected) return;

    // Sheet is protected — check each cell in parallel
    const checks: Promise<void>[] = [];
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        checks.push(this.ensureCellEditable(r, c));
      }
    }
    await Promise.all(checks);
  }

  /**
   * Throws if the sheet is protected and the given structure operation is not allowed.
   */
  protected async ensureStructureOpAllowed(
    operation: 'insertRows' | 'insertColumns' | 'deleteRows' | 'deleteColumns',
  ): Promise<void> {
    const allowed = await this.protection.canDoStructureOp(operation);
    if (!allowed) {
      throw new Error(
        `Cannot perform ${operation}: sheet is protected and operation is not allowed`,
      );
    }
  }

  // ===========================================================================
  // Cell read/write (overloaded addressing)
  // ===========================================================================

  protected resolveCellWriteArgs(
    a: string | number,
    b: unknown,
    c?: unknown,
    d?: unknown,
  ): {
    row: number;
    col: number;
    value: unknown;
    options: FormulaCellWriteOptions | undefined;
  } {
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      return {
        row: pos.row,
        col: pos.col,
        value: b,
        options: c as FormulaCellWriteOptions | undefined,
      };
    }

    const col = b;
    if (typeof col !== 'number') {
      throw new KernelError(
        'API_INVALID_ADDRESS',
        `Invalid cell address: col must be a number, got ${typeof col}`,
        {
          context: { row: a, col },
        },
      );
    }

    return {
      row: a,
      col,
      value: c,
      options: d as FormulaCellWriteOptions | undefined,
    };
  }

  protected async applyCellAnnotation(
    row: number,
    col: number,
    text: string | undefined,
  ): Promise<void> {
    if (text === undefined) return;
    await this.annotations.cells.set(row, col, text);
  }

  protected async applyCellAnnotations(targets: readonly CellAnnotationTarget[]): Promise<void> {
    for (const target of targets) {
      await this.annotations.cells.set(target.row, target.col, target.text);
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Resolve a `string | CellRange` to a CellRange with this sheet's sheetId.
   * For strings, parses A1 notation. For CellRange objects, passes through.
   */
  protected resolveToCellRange(range: string | CellRange): CellRange {
    if (typeof range === 'string') {
      const parsed = parseCellRange(range);
      if (!parsed)
        throw new KernelError('API_INVALID_ADDRESS', `Invalid range: "${range}"`, {
          context: { range },
        });
      return { sheetId: this.sheetId, ...parsed };
    }
    return range;
  }

  protected _assertLive(operation: string): void {
    this._liveness.assertLive(operation);
    if (this._disposed) {
      throw this._liveness.error(operation);
    }
  }
}
