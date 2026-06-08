/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * Absorbs functionality from:
 * - SheetAPI (kernel/src/api/sheet-api.ts)
 * - External API WorksheetImpl (kernel/src/external/worksheet.ts)
 *
 * Design decisions:
 * 1. Every method that needs cell/range addressing uses resolveCell/resolveRange
 *    from address-resolver.ts — discriminates string (A1) vs number (row, col).
 * 2. All mutations throw on failure (no OperationResult). Operation modules
 *    throw directly — no unwrap ceremony needed.
 * 3. Sync methods (getName, getIndex, getSheetId, isVisible) use cached metadata
 *    from the parent WorkbookImpl sheet cache.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type {
  ActiveCellEditSource,
  AggregateResult,
  Chart,
  ChartConfig,
  ChartReadOptions,
  CellData,
  CellMetadataCache as CellMetadataCacheContract,
  CellRange,
  CellRecord,
  CellWriteOptions,
  ClearApplyTo,
  ClearResult,
  EventHandler,
  FormatEntry,
  FormulaCircularReferenceValidation,
  FormulaSyntaxValidationError,
  IdentifiedCellData,
  NumberFormatCategory,
  PivotCreateConfig,
  PivotTableConfig,
  PivotTableHandle,
  PivotTableInfo,
  RawCellData,
  FindInRangeOptions,
  SearchOptions,
  SearchResult,
  SetCellsResult,
  SheetEvent,
  SheetId,
  SignCheckOptions,
  SignCheckResult,
  SortByColorOptions,
  SortOptions,
  SummaryOptions,
  ViewportReader,
  VisibleRangeView,
  Workbook,
  WorkbookInternal,
  Worksheet,
  WorksheetCellsAccessor,
} from '@mog-sdk/contracts/api';
import { RangeValueType } from '@mog-sdk/contracts/api';
import type { CellType, CellValueType } from '@mog-sdk/contracts/api';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type {
  CellError,
  CellValue,
  CellValuePrimitive,
  CopyFromOptions,
} from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type { ApiSortCriterion } from '@mog-sdk/contracts/sorting';
import type { RegionMeta, StoreCellData } from '@mog-sdk/contracts/store';
import { displayStringOrNull, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  EventByType,
  SpreadsheetEventType as InternalEventType,
  SpreadsheetEvent,
} from '@mog-sdk/contracts/events';
import type { AutoFillMode, AutoFillResult, FillSeriesOptions } from '@mog-sdk/contracts/fill';
import { maskExternalFormulaRefsForValidation } from '../../services/external-formulas';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects';
import { type CallableDisposable, toDisposable } from '@mog/spreadsheet-utils/disposable';
import { KernelError, toMogSdkError } from '../../errors';

import type { RangeCellData } from '../../bridges/compute/compute-types.gen';
import { CellMetadataCache, createCellMetadataCache } from '../../bridges/wire/cell-metadata-cache';
import type { DocumentContext } from '../../context';
import { getCurrentRegion as getCurrentRegionDomain } from '../../domain/cells/cell-iteration';
import * as CellReads from '../../domain/cells/cell-reads';
import type { SpreadsheetObjectManager } from '../../floating-objects';
import { ERROR_DISPLAY_MAP, isCellError } from '@mog/spreadsheet-utils/errors';
import { resolveCell, resolveRange, resolveRangeToA1 } from '../internal/address-resolver';
import { parseCellAddress, parseCellRange, toA1 } from '../internal/utils';
import { normalizeCellValue } from '../internal/value-conversions';
import { renameSheet } from '../workbook/operations/sheet-crud-operations';
import { calendarPartsInTz, parseIsoDate } from './operations/calendar-tz';
import * as CellOps from './operations/cell-operations';
import * as DependencyOps from './operations/dependency-operations';
import * as FillOps from './operations/fill-operations';
import * as HyperlinkOps from './operations/hyperlink-operations';
import * as MergeOps from './operations/merge-operations';
import * as QueryOps from './operations/query-operations';
import * as RangeOps from './operations/range-operations';
import * as RangeQueryOps from './operations/range-query-operations';
import * as DescribeOps from './operations/describe-operations';
import * as SortOps from './operations/sort-operations';
import { deletePivotsContainedByClearRange } from './pivot-clear';
import { createViewportReader } from './viewport-reader';
import { createHandleLiveness, type HandleLiveness } from '../lifecycle/handle-liveness';

// Sub-API imports
import type {
  WorksheetBindings,
  WorksheetCharts,
  WorksheetComments,
  WorksheetCustomProperties,
  WorksheetConditionalFormatting,
  WorksheetConnectorCollection,
  WorksheetDrawingCollection,
  WorksheetEquationCollection,
  WorksheetFilters,
  WorksheetFormControls,
  WorksheetChanges,
  WorksheetFormats,
  WorksheetHyperlinks,
  WorksheetInternal,
  WorksheetLayout,
  WorksheetNames,
  WorksheetObjectCollection,
  WorksheetOutline,
  WorksheetPictureCollection,
  WorksheetPivots,
  WorksheetPrint,
  WorksheetProtection,
  WorksheetSettings,
  WorksheetShapeCollection,
  WorksheetSlicers,
  WorksheetDiagrams,
  WorksheetSparklines,
  WorksheetStructure,
  WorksheetStyles,
  WorksheetTables,
  WorksheetTextBoxCollection,
  WorksheetValidation,
  WorksheetView,
  WorksheetWhatIf,
  WorksheetTextEffectCollection,
} from '@mog-sdk/contracts/api';
import {
  WorksheetConnectorCollectionImpl,
  WorksheetDrawingCollectionImpl,
  WorksheetEquationCollectionImpl,
  WorksheetObjectCollectionImpl,
  WorksheetPictureCollectionImpl,
  WorksheetShapeCollectionImpl,
  WorksheetTextBoxCollectionImpl,
  WorksheetTextEffectCollectionImpl,
} from './collections/index';
// Sub-API impls — imported directly from each module (NOT through `./index`)
// to keep the impl↔barrel cycle broken. The barrel re-exports `WorksheetImpl`,
// so importing *from* the barrel here would create `worksheet-impl ↔ index`.
import { WorksheetBindingsImpl } from './bindings';
import { WorksheetChangesImpl } from './changes';
import { WorksheetChartsImpl } from './charts';
import { WorksheetCommentsImpl } from './comments';
import { WorksheetConditionalFormattingImpl } from './conditional-formats';
import { WorksheetCustomPropertiesImpl } from './custom-properties';
import { WorksheetFiltersImpl } from './filters';
import { formControlLinkedCellResetValue } from './form-control-linked-cell-reset';
import { WorksheetFormControlsImpl } from './form-controls';
import { WorksheetFormatsImpl } from './formats';
import { WorksheetHyperlinksImpl } from './hyperlinks';
import { WorksheetInternalImpl } from './internal';
import { WorksheetLayoutImpl } from './layout';
import { WorksheetNamesImpl } from './names';
import { WorksheetOutlineImpl } from './outline';
import { WorksheetPivotsImpl } from './pivots';
import { dataConfigToApiConfig } from './pivots/config-conversion';
import { WorksheetPrintImpl } from './print';
import { WorksheetProtectionImpl } from './protection';
import { WorksheetSettingsImpl } from './settings';
import { WorksheetSlicersImpl } from './slicers';
import { WorksheetDiagramsImpl } from './diagrams';
import { WorksheetSparklinesImpl } from './sparklines';
import { WorksheetStructureImpl } from './structure';
import { WorksheetStylesImpl } from './styles';
import { WorksheetTablesImpl } from './tables';
import { WorksheetValidationImpl } from './validation';
import { WorksheetViewImpl } from './view';
import { WorksheetWhatIfImpl } from './what-if';
import { WorksheetObjectsImpl } from './objects';

// =============================================================================
// Sheet Event Mapping
// =============================================================================

const SHEET_EVENT_TO_INTERNAL: Record<string, string[]> = {
  cellChanged: [
    'cell:changed',
    'cells:batch-changed',
    'cell:value-changed',
    'cell:format-changed',
    'cell:metadata-changed',
  ],
  filterChanged: ['filter:changed', 'filter:applied', 'filter:cleared', 'filter:column-changed'],
  visibilityChanged: [
    'visibility:changed',
    'row:hidden',
    'row:shown',
    'column:hidden',
    'column:shown',
  ],
  structureChanged: [
    'structure:changed',
    'row:inserted',
    'row:deleted',
    'rows:inserted',
    'rows:deleted',
    'column:inserted',
    'column:deleted',
    'columns:inserted',
    'columns:deleted',
  ],
  mergeChanged: ['merge:changed', 'merge:created', 'merge:removed'],
  tableChanged: ['table:changed', 'table:created', 'table:updated', 'table:deleted'],
  chartChanged: ['chart:changed', 'chart:created', 'chart:updated', 'chart:deleted'],
  slicerChanged: ['slicer:changed', 'slicer:created', 'slicer:updated', 'slicer:deleted'],
  sparklineChanged: [
    'sparkline:changed',
    'sparkline:created',
    'sparkline:updated',
    'sparkline:deleted',
  ],
  groupingChanged: ['grouping:changed', 'grouping:rows-changed', 'grouping:columns-changed'],
  cfChanged: [
    'cf:changed',
    'cf:rules-changed',
    'cf:rule-added',
    'cf:rule-removed',
    'cf:rules-cleared',
  ],
  viewportRefreshed: ['viewport:data-changed', 'viewport:refreshed'],
  recalcComplete: ['recalc:complete', 'calc:complete'],
  nameChanged: ['sheet:renamed'],
  selectionChanged: ['selection:changed'],
  activated: ['sheet:activated'],
  columnSorted: ['sort:column-sorted'],
  rowSorted: ['sort:row-sorted'],
  formulaChanged: ['formula:changed'],
  protectionChanged: ['protection:changed'],
};

// =============================================================================
// Sort direction mapping
// =============================================================================

type CellRangeBounds = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

type ActiveCellEditSourceTarget = {
  sheetId: SheetId;
  row: number;
  col: number;
};

/**
 * Map public API sort direction to bridge SortOrder.
 *
 * The public SortColumn uses 'asc'/'desc',
 * BridgeSortCriterion.direction is SortOrder = 'asc' | 'desc'.
 */
function mapSortDirection(direction: 'asc' | 'desc' | undefined): 'asc' | 'desc' {
  if (direction === 'desc') return 'desc';
  return 'asc';
}

// =============================================================================
// WorksheetImpl
// =============================================================================

export class WorksheetImpl implements Worksheet {
  private readonly workbook: Workbook | null;
  private readonly _liveness: HandleLiveness;
  private _disposed = false;
  private _cachedName: string | undefined;
  private _cachedIndex: number;
  private _cachedVisible: boolean;
  private _viewport: ViewportReader | null = null;
  private _cellMetadata: CellMetadataCacheContract | null = null;
  private _activeCellEditSource: ActiveCellEditSource | null = null;
  private _activeCellEditSourceTarget: ActiveCellEditSourceTarget | null = null;
  private _activeCellEditSourceEpoch = 0;
  private _activeCellEditSourceVersion = 0;
  private _unsubscribeActiveCellEditSourceEvents: (() => void) | null = null;
  private _activeCellDataRefreshInFlight: {
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
  private readonly _floatingObjectManager: SpreadsheetObjectManager | null;

  /** Bounds reader injected from the renderer layer. */
  private _boundsReader: IObjectBoundsReader | null = null;

  constructor(
    public readonly sheetId: SheetId,
    private readonly ctx: DocumentContext,
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
  // Bounds Reader injection
  // ===========================================================================

  setBoundsReader(reader: IObjectBoundsReader): void {
    this._assertLive('worksheet.setBoundsReader');
    this._boundsReader = reader;
    // Invalidate all cached typed collections so they are recreated with the new reader.
    this._objects = undefined;
    this._objectCollection = undefined;
    this._shapes = undefined;
    this._pictures = undefined;
    this._textBoxes = undefined;
    this._drawings = undefined;
    this._equations = undefined;
    this._textEffects = undefined;
    this._connectors = undefined;
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
    await renameSheet(this.ctx, this.sheetId, name);
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

  // ===========================================================================
  // Bridge Sub-Interfaces
  // ===========================================================================

  private _diagrams?: WorksheetDiagramsImpl;
  get diagrams(): WorksheetDiagrams {
    this._assertLive('worksheet.diagrams');
    return (this._diagrams ??= new WorksheetDiagramsImpl(
      this.ctx,
      this.sheetId,
      this._floatingObjectManager,
    ));
  }

  // ===========================================================================
  // Write gate guard (the write gate)
  // ===========================================================================

  /**
   * Guard: throws WriteGateError if the document is not writable.
   * Called at the top of public mutation methods.
   */
  private _ensureWritable(operation: string): void {
    this._assertLive(operation);
    try {
      this.ctx.writeGate.assertWritable(operation);
    } catch (err) {
      throw toMogSdkError(err, operation);
    }
  }

  private _subscribeActiveCellEditSourceInvalidation(): () => void {
    const eventTypes: InternalEventType[] = [
      'cell:changed',
      'cells:batch-changed',
      'cell:format-changed',
      'cell:metadata-changed',
      'formula:changed',
      'rows:inserted',
      'rows:deleted',
      'columns:inserted',
      'columns:deleted',
      'range:created',
      'range:replaced',
      'range:removed',
      'range:sorted',
      'sheet:deleted',
      'sheet:renamed',
      'selection:changed',
      'import:complete',
    ];

    return this.ctx.eventBus.onMany(eventTypes, (event) => {
      this._invalidateActiveCellEditSourceForEvent(event);
    });
  }

  private _ensureActiveCellEditSourceEventSubscription(): void {
    if (this._unsubscribeActiveCellEditSourceEvents) return;
    this._unsubscribeActiveCellEditSourceEvents = this._subscribeActiveCellEditSourceInvalidation();
  }

  private _activeCellEditSourceMatchesCell(
    sheetId: SheetId | string,
    row: number,
    col: number,
  ): boolean {
    const target = this._activeCellEditSourceTarget;
    return target?.sheetId === sheetId && target.row === row && target.col === col;
  }

  private _activeCellEditSourceIntersectsRange(
    sheetId: SheetId | string,
    range: CellRangeBounds,
  ): boolean {
    const target = this._activeCellEditSourceTarget;
    if (!target || target.sheetId !== sheetId) return false;
    return (
      target.row >= range.startRow &&
      target.row <= range.endRow &&
      target.col >= range.startCol &&
      target.col <= range.endCol
    );
  }

  private _markActiveCellEditSourceStale(): void {
    this._activeCellEditSourceEpoch += 1;
    if (this._activeCellEditSource) {
      this._activeCellEditSource = { ...this._activeCellEditSource, fresh: false };
    }
  }

  private _invalidateActiveCellEditSourceForCell(row: number, col: number): void {
    if (this._activeCellEditSourceMatchesCell(this.sheetId, row, col)) {
      this._markActiveCellEditSourceStale();
    }
  }

  private _invalidateActiveCellEditSourceForRange(range: CellRangeBounds): void {
    if (this._activeCellEditSourceIntersectsRange(this.sheetId, range)) {
      this._markActiveCellEditSourceStale();
    }
  }

  private _invalidateActiveCellEditSourceForSheet(sheetId: SheetId | string): void {
    if (this._activeCellEditSourceTarget?.sheetId === sheetId) {
      this._markActiveCellEditSourceStale();
    }
  }

  private _invalidateActiveCellEditSourceForEvent(event: SpreadsheetEvent): void {
    switch (event.type) {
      case 'cell:changed':
      case 'cell:format-changed':
      case 'cell:metadata-changed':
      case 'formula:changed':
        if (this._activeCellEditSourceMatchesCell(event.sheetId, event.row, event.col)) {
          this._markActiveCellEditSourceStale();
        }
        break;
      case 'cells:batch-changed':
        if (
          this._activeCellEditSourceTarget?.sheetId === event.sheetId &&
          event.changes.some((change) =>
            this._activeCellEditSourceMatchesCell(event.sheetId, change.row, change.col),
          )
        ) {
          this._markActiveCellEditSourceStale();
        }
        break;
      case 'rows:inserted':
      case 'rows:deleted': {
        const target = this._activeCellEditSourceTarget;
        if (target?.sheetId === event.sheetId && target.row >= event.startRow) {
          this._markActiveCellEditSourceStale();
        }
        break;
      }
      case 'columns:inserted':
      case 'columns:deleted': {
        const target = this._activeCellEditSourceTarget;
        if (target?.sheetId === event.sheetId && target.col >= event.startCol) {
          this._markActiveCellEditSourceStale();
        }
        break;
      }
      case 'range:sorted':
        if (this._activeCellEditSourceIntersectsRange(event.sheetId, event.range)) {
          this._markActiveCellEditSourceStale();
        }
        break;
      case 'range:created':
      case 'range:replaced':
      case 'range:removed':
      case 'sheet:deleted':
        this._invalidateActiveCellEditSourceForSheet(event.sheetId);
        break;
      case 'selection:changed':
        this._invalidateActiveCellEditSourceForSheet(event.sheetId);
        break;
      case 'sheet:renamed':
      case 'import:complete':
        if (this._activeCellEditSourceTarget) {
          this._markActiveCellEditSourceStale();
        }
        break;
    }
  }

  // ===========================================================================
  // Protection guard helpers
  // ===========================================================================

  /**
   * Throws if the sheet is protected and the given cell is locked.
   */
  private async ensureCellEditable(row: number, col: number): Promise<void> {
    const canEdit = await this.protection.canEditCell(row, col);
    if (!canEdit) {
      throw new Error(`Cannot edit cell (${row}, ${col}): sheet is protected and cell is locked`);
    }
  }

  /**
   * Throws if any cell in the given range is protected and locked.
   * Fast path: if the sheet is not protected at all, skips all per-cell checks.
   */
  private async ensureRangeEditable(
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
  private async ensureStructureOpAllowed(
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

  async setCell(
    address: string,
    value: CellValuePrimitive,
    options?: CellWriteOptions,
  ): Promise<void>;
  async setCell(
    row: number,
    col: number,
    value: CellValuePrimitive,
    options?: CellWriteOptions,
  ): Promise<void>;
  async setCell(a: string | number, b: any, c?: any, d?: any): Promise<void> {
    this._assertLive('worksheet.setCell');
    this._ensureWritable('worksheet.setCell');
    let row: number, col: number, value: any, options: CellWriteOptions | undefined;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      value = b;
      options = c as CellWriteOptions | undefined;
    } else {
      row = a;
      col = b;
      if (typeof col !== 'number') {
        throw new KernelError(
          'API_INVALID_ADDRESS',
          `Invalid cell address: col must be a number, got ${typeof col}`,
          {
            context: { row, col },
          },
        );
      }
      value = c;
      options = d as CellWriteOptions | undefined;
    }

    await this.ensureCellEditable(row, col);

    // Date values delegate to setDateValue
    if (value instanceof Date) {
      await this.setDateValue(row, col, value);
      return;
    }

    // If literal option is set, prefix "=" strings with apostrophe to store as text
    if (options?.literal && typeof value === 'string' && value.startsWith('=')) {
      value = "'" + value;
    }

    // If asFormula option is set, prepend = if not already
    if (options?.asFormula && typeof value === 'string' && !value.startsWith('=')) {
      value = `=${value}`;
    }

    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setCell(this.ctx, this.sheetId, row, col, value);
  }

  /**
   * Write a calendar date to a cell.
   *
   * The four input forms (in order of preference for unambiguous semantics):
   *
   * 1. Calendar parts — `setDateValue(row, col, year, month, day)` /
   *    `setDateValue(addr, year, month, day)`. No `Date`, no timezone.
   * 2. ISO calendar string — `setDateValue(row, col, '2026-03-01')` /
   *    `setDateValue(addr, '2026-03-01')`. No `Date`, no timezone.
   * 3. `Date` instant — `setDateValue(row, col, date)` /
   *    `setDateValue(addr, date)`. Resolved against the session's
   *    `userTimezone`. The ambient frame is whichever IANA zone the
   *    workbook was created with.
   * 4. `Date` instant with explicit override — `setDateValue(row, col, date, { tz })` /
   *    `setDateValue(addr, date, { tz })`. Use when the caller has a `Date`
   *    that should be interpreted in a frame other than the session default.
   *
   * Per-call `tz` always wins over `userTimezone`.
   *
   */
  setDateValue(row: number, col: number, year: number, month: number, day: number): Promise<void>;
  setDateValue(addr: string, year: number, month: number, day: number): Promise<void>;
  setDateValue(row: number, col: number, isoDate: string): Promise<void>;
  setDateValue(addr: string, isoDate: string): Promise<void>;
  setDateValue(row: number, col: number, date: Date, opts?: { tz?: string }): Promise<void>;
  setDateValue(addr: string, date: Date, opts?: { tz?: string }): Promise<void>;
  async setDateValue(
    a: string | number,
    b: string | number | Date,
    c?: number | Date | string | { tz?: string },
    d?: number | { tz?: string },
    e?: number,
  ): Promise<void> {
    this._assertLive('worksheet.setDateValue');
    this._ensureWritable('worksheet.setDateValue');
    const { row, col, year, month, day } = this.resolveDateArgs(a, b, c, d, e);
    await this.ensureCellEditable(row, col);
    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setDateValue(this.ctx, this.sheetId, row, col, { year, month, day });
  }

  /**
   * Write a time-of-day to a cell. Mirrors `setDateValue` overloads:
   *
   * 1. `setTimeValue(row, col, hours, minutes, seconds)` / addr form
   * 2. `setTimeValue(row, col, date)` — resolves against session `userTimezone`
   * 3. `setTimeValue(row, col, date, { tz })` — per-call override
   *
   * (No ISO-string overload yet — Excel doesn't have a canonical time-only ISO
   *  literal; if needed later, accept HH:MM:SS strings.)
   */
  setTimeValue(
    row: number,
    col: number,
    hours: number,
    minutes: number,
    seconds: number,
  ): Promise<void>;
  setTimeValue(addr: string, hours: number, minutes: number, seconds: number): Promise<void>;
  setTimeValue(row: number, col: number, date: Date, opts?: { tz?: string }): Promise<void>;
  setTimeValue(addr: string, date: Date, opts?: { tz?: string }): Promise<void>;
  async setTimeValue(
    a: string | number,
    b: number | Date,
    c?: number | Date | { tz?: string },
    d?: number | { tz?: string },
    e?: number,
  ): Promise<void> {
    this._assertLive('worksheet.setTimeValue');
    this._ensureWritable('worksheet.setTimeValue');
    const { row, col, hours, minutes, seconds } = this.resolveTimeArgs(a, b, c, d, e);
    await this.ensureCellEditable(row, col);
    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setTimeValue(this.ctx, this.sheetId, row, col, { hours, minutes, seconds });
  }

  /**
   * Decode the overloaded `setDateValue` argument list into a normalized
   * `{ row, col, year, month, day }` shape. Routes any `Date` instant through
   * `calendarPartsInTz` against the explicit `tz` option (when provided) or
   * the session's `userTimezone` — never host-local.
   */
  private resolveDateArgs(
    a: string | number,
    b: string | number | Date,
    c?: number | Date | string | { tz?: string },
    d?: number | { tz?: string },
    e?: number,
  ): { row: number; col: number; year: number; month: number; day: number } {
    // Resolve row/col from the first 1-2 args; track how many positional slots
    // were consumed so the remaining args can be interpreted unambiguously.
    let row: number, col: number;
    let rest: [unknown, unknown, unknown, unknown];
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      rest = [b, c, d, e];
    } else {
      row = a;
      col = b as number;
      rest = [c, d, e, undefined];
    }

    const [r0, r1, r2] = rest;

    // Form 1: parts (year, month, day)
    if (typeof r0 === 'number' && typeof r1 === 'number' && typeof r2 === 'number') {
      return { row, col, year: r0, month: r1, day: r2 };
    }

    // Form 2: ISO calendar string
    if (typeof r0 === 'string') {
      return { row, col, ...parseIsoDate(r0) };
    }

    // Form 3/4: Date instant (with optional { tz })
    if (r0 instanceof Date) {
      const opts = r1 as { tz?: string } | undefined;
      const tz = opts?.tz ?? this.ctx.userTimezone;
      const parts = calendarPartsInTz(r0, tz);
      return { row, col, year: parts.year, month: parts.month, day: parts.day };
    }

    throw new KernelError(
      'API_INVALID_ARGUMENT',
      'setDateValue: pass parts (year, month, day), an ISO date string ("YYYY-MM-DD"), or a Date instance.',
    );
  }

  /**
   * Decode the overloaded `setTimeValue` argument list. Mirrors
   * `resolveDateArgs` for hours/minutes/seconds.
   */
  private resolveTimeArgs(
    a: string | number,
    b: number | Date,
    c?: number | Date | { tz?: string },
    d?: number | { tz?: string },
    e?: number,
  ): { row: number; col: number; hours: number; minutes: number; seconds: number } {
    let row: number, col: number;
    let rest: [unknown, unknown, unknown, unknown];
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      rest = [b, c, d, e];
    } else {
      row = a;
      col = b as number;
      rest = [c, d, e, undefined];
    }

    const [r0, r1, r2] = rest;

    // Parts: hours, minutes, seconds
    if (typeof r0 === 'number' && typeof r1 === 'number' && typeof r2 === 'number') {
      return { row, col, hours: r0, minutes: r1, seconds: r2 };
    }

    // Date instant
    if (r0 instanceof Date) {
      const opts = r1 as { tz?: string } | undefined;
      const tz = opts?.tz ?? this.ctx.userTimezone;
      const parts = calendarPartsInTz(r0, tz);
      return {
        row,
        col,
        hours: parts.hours,
        minutes: parts.minutes,
        seconds: parts.seconds,
      };
    }

    throw new KernelError(
      'API_INVALID_ARGUMENT',
      'setTimeValue: pass parts (hours, minutes, seconds) or a Date instance.',
    );
  }

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
      };
    }
    return this._cells;
  }

  async getValue(a: string | number, b?: number): Promise<CellValuePrimitive> {
    this._assertLive('worksheet.getValue');
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

  async setRange(a: string | number | CellRange, b: any, c?: any[][]): Promise<void> {
    this._assertLive('worksheet.setRange');
    this._ensureWritable('worksheet.setRange');
    let startRow: number, startCol: number, values: any[][];
    if (typeof a === 'object') {
      startRow = a.startRow;
      startCol = a.startCol;
      values = b;
    } else if (typeof a === 'string') {
      const parsed = parseCellRange(a);
      if (parsed) {
        startRow = parsed.startRow;
        startCol = parsed.startCol;
      } else {
        // Fall back to single cell address as top-left corner of the range
        const cell = parseCellAddress(a);
        if (!cell) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${a}"`);
        startRow = cell.row;
        startCol = cell.col;
      }
      values = b;
    } else {
      startRow = a;
      startCol = b as number;
      values = c!;
    }

    // Protection check: verify all cells in the target range are editable
    await this.ensureRangeEditable(
      startRow,
      startCol,
      startRow + values.length - 1,
      startCol + (values[0]?.length ?? 1) - 1,
    );

    this._invalidateActiveCellEditSourceForRange({
      startRow,
      startCol,
      endRow: startRow + values.length - 1,
      endCol: startCol + (values[0]?.length ?? 1) - 1,
    });
    await RangeOps.setRange(this.ctx, this.sheetId, startRow, startCol, values);
  }

  /**
   * Enter a CSE array formula on the given range. Routes directly to
   * Rust `compute-core::set_array_formula` — the engine marks the
   * anchor (`mirror.cse_anchors`) and registers the projection so
   * subsequent partial writes are rejected as
   * `ComputeError::PartialArrayWrite`.
   */
  async setArrayFormula(range: CellRange, formula: string): Promise<void> {
    this._ensureWritable('worksheet.setArrayFormula');
    await this.ensureRangeEditable(range.startRow, range.startCol, range.endRow, range.endCol);
    this._invalidateActiveCellEditSourceForRange(range);
    await this.ctx.computeBridge.setArrayFormula(
      this.sheetId,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
      formula,
    );
    // Stream B fix: force a full viewport re-render for all viewports on this
    // sheet. The incremental patches path (enrich_metadata_flags) uses the
    // CellId-keyed lookup and misses projection members, so D2/D3 come back
    // with HAS_FORMULA=false after the mutation patch. The full render path
    // (build_viewport_render_data_inner → cell_render_at) correctly sets
    // HAS_FORMULA for all projection members. Refreshing here ensures the
    // viewport buffer reflects projection membership immediately.
    //
    // We must invalidate the prefetch cache first so the refresh is not
    // skipped by the "within existing prefetch bounds" guard (which would
    // otherwise return immediately, keeping the stale post-patch buffer).
    const vpStates = this.ctx.computeBridge.getPerViewportStates();
    const suffix = ':' + this.sheetId;
    const boundsToRefresh: Array<{
      vpId: string;
      bounds: { startRow: number; startCol: number; endRow: number; endCol: number };
    }> = [];
    for (const [vpId, state] of vpStates) {
      if (vpId.endsWith(suffix) && state.prefetchBounds) {
        boundsToRefresh.push({ vpId, bounds: state.prefetchBounds });
      }
    }
    if (boundsToRefresh.length > 0) {
      // Invalidate all prefetch so the next refresh call does not skip.
      this.ctx.computeBridge.invalidateAllViewportPrefetch();
      await Promise.all(
        boundsToRefresh.map(({ vpId, bounds }) =>
          this.ctx.computeBridge.refreshViewportForRegion(vpId, this.sheetId, bounds),
        ),
      );
    }

    // Stream C fix: refresh the active-cell metadata cache so the formula bar
    // immediately sees isCseAnchor=true and renders `{=…}` braces. The anchor
    // cell is always at the top-left of the range. We must look up its cellId
    // after the write because the engine creates it during set_array_formula.
    const anchorCellId = await this.ctx.computeBridge.getCellIdAt(
      this.sheetId,
      range.startRow,
      range.startCol,
    );
    if (anchorCellId) {
      await this.ctx.computeBridge.refreshActiveCell(this.sheetId, anchorCellId);
    }
  }

  /**
   * Refresh the active-cell metadata cache for the given cell position.
   * Looks up the cellId and calls computeBridge.refreshActiveCell so that
   * the formula bar reads fresh `isCseAnchor` / `isArrayFormula` metadata.
   */
  async refreshActiveCellData(row: number, col: number): Promise<void> {
    const inFlight = this._activeCellDataRefreshInFlight;
    if (inFlight && inFlight.row === row && inFlight.col === col) {
      return inFlight.promise;
    }

    const promise = (async () => {
      const cellId = await this.ctx.computeBridge.getCellIdAt(this.sheetId, row, col);
      if (cellId) {
        await this.ctx.computeBridge.refreshActiveCell(this.sheetId, cellId);
      }
    })();

    this._activeCellDataRefreshInFlight = { row, col, promise };
    try {
      await promise;
    } finally {
      if (this._activeCellDataRefreshInFlight?.promise === promise) {
        this._activeCellDataRefreshInFlight = null;
      }
    }
  }

  /** @deprecated Use clear(range, 'contents') instead */
  async clearData(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<ClearResult> {
    this._ensureWritable('worksheet.clearData');
    const bounds = resolveRange(a, b, c, d);
    await this.ensureRangeEditable(bounds.startRow, bounds.startCol, bounds.endRow, bounds.endCol);
    this._invalidateActiveCellEditSourceForRange(bounds);
    return RangeOps.clearRange(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
  }

  async clear(range: string | CellRange, applyTo?: ClearApplyTo): Promise<ClearResult> {
    this._ensureWritable('worksheet.clear');
    const bounds =
      typeof range === 'object'
        ? range
        : (() => {
            const parsed = parseCellRange(range);
            if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
            return parsed;
          })();
    await this.ensureRangeEditable(bounds.startRow, bounds.startCol, bounds.endRow, bounds.endCol);
    await deletePivotsContainedByClearRange(this.ctx, this.sheetId, bounds, applyTo ?? 'all');
    this._invalidateActiveCellEditSourceForRange(bounds);
    return RangeQueryOps.clearWithMode(
      this.ctx,
      this.sheetId,
      { sheetId: this.sheetId, ...bounds },
      applyTo ?? 'all',
    );
  }

  async clearOrResetContents(range: string): Promise<void> {
    this._ensureWritable('worksheet.clearOrResetContents');
    const parsed = parseCellRange(range);
    if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);

    const { startRow, startCol, endRow, endCol } = parsed;

    // Identify form-control-linked cells within the range
    const linkedCells: Array<{
      row: number;
      col: number;
      resetValue?: CellValuePrimitive;
    }> = [];

    const controls = this.formControls.list();
    if (controls.length > 0) {
      // Resolve each control's linkedCellId to a position
      const controlsWithLinkedCell = controls.filter(
        (c): c is typeof c & { linkedCellId: string } => {
          return 'linkedCellId' in c && !!(c as { linkedCellId?: string }).linkedCellId;
        },
      );
      const resolutions = await Promise.all(
        controlsWithLinkedCell.map(async (control) => {
          const pos = await this.ctx.computeBridge.getCellPosition(
            this.sheetId,
            control.linkedCellId,
          );
          return { control, pos };
        }),
      );

      for (const { control, pos } of resolutions) {
        if (
          pos &&
          pos.row >= startRow &&
          pos.row <= endRow &&
          pos.col >= startCol &&
          pos.col <= endCol
        ) {
          linkedCells.push({
            row: pos.row,
            col: pos.col,
            resetValue: formControlLinkedCellResetValue(control),
          });
        }
      }
    }

    // Clear all contents in the range
    await this.clear(range, 'contents');

    // Reset linked cells to their default values
    for (const { row, col, resetValue } of linkedCells) {
      if (resetValue !== undefined) {
        await CellOps.setCell(this.ctx, this.sheetId, row, col, resetValue);
      }
      // Buttons have no value to reset.
    }
  }

  // ===========================================================================
  // Cell controls (checkbox)
  // ===========================================================================

  async getControl(
    a: string | number,
    b?: number,
  ): Promise<import('@mog-sdk/contracts/core').CellControl | undefined> {
    const { row, col } = resolveCell(a, b);
    return CellOps.getControl(this.ctx, this.sheetId, row, col);
  }

  async setControl(
    a: string | number,
    b: number | import('@mog-sdk/contracts/core').CellControl | undefined,
    c?: import('@mog-sdk/contracts/core').CellControl | undefined,
  ): Promise<void> {
    this._ensureWritable('worksheet.setControl');
    if (typeof a === 'string') {
      // setControl(address, control)
      const { row, col } = resolveCell(a);
      const control = b as import('@mog-sdk/contracts/core').CellControl | undefined;
      await this.ensureCellEditable(row, col);
      this._invalidateActiveCellEditSourceForCell(row, col);
      await CellOps.setControl(this.ctx, this.sheetId, row, col, control);
    } else {
      // setControl(row, col, control)
      const row = a;
      const col = b as number;
      const control = c;
      await this.ensureCellEditable(row, col);
      this._invalidateActiveCellEditSourceForCell(row, col);
      await CellOps.setControl(this.ctx, this.sheetId, row, col, control);
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
    return this.ctx.computeBridge.evaluateExpression(this.sheetId, expression);
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

  getChart(chartId: string): Promise<Chart | null> {
    return this.charts.get(chartId);
  }

  updateChart(chartId: string, updates: Partial<ChartConfig>): Promise<void> {
    return this.charts.update(chartId, updates);
  }

  removeChart(chartId: string): Promise<void> {
    return this.charts.remove(chartId);
  }

  async addPivotTable(config: PivotCreateConfig): Promise<PivotTableConfig> {
    const created = await this.pivots.add(config);
    return dataConfigToApiConfig(created, created.sourceSheetName);
  }

  removePivotTable(name: string): Promise<void> {
    return this.pivots.remove(name);
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

  async getUsedRange(): Promise<CellRange | null> {
    return QueryOps.getUsedRange(this.ctx, this.sheetId);
  }

  async getCurrentRegion(row: number, col: number): Promise<CellRange> {
    return getCurrentRegionDomain(this.ctx, this.sheetId, row, col);
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

  async findCells(predicate: (cell: CellData) => boolean, range?: string): Promise<string[]> {
    const addresses = await QueryOps.findCells(this.ctx, this.sheetId, predicate);
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
    );
  }

  async getExtendedRange(
    range: string,
    direction: 'up' | 'down' | 'left' | 'right',
    activeCell?: { row: number; col: number },
  ): Promise<CellRange> {
    const parsed = parseCellRange(range);
    if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
    return RangeQueryOps.getExtendedRange(
      this.ctx,
      this.sheetId,
      { sheetId: this.sheetId, ...parsed },
      direction,
      activeCell,
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
    this._ensureActiveCellEditSourceEventSubscription();
    const requestEpoch = this._activeCellEditSourceEpoch + 1;
    this._activeCellEditSourceEpoch = requestEpoch;
    if (
      this._activeCellEditSource &&
      this._activeCellEditSource.fresh &&
      (this._activeCellEditSource.sheetId !== this.sheetId ||
        this._activeCellEditSource.row !== row ||
        this._activeCellEditSource.col !== col)
    ) {
      this._activeCellEditSource = { ...this._activeCellEditSource, fresh: false };
    }
    this._activeCellEditSourceTarget = { sheetId: this.sheetId, row, col };

    const source = await CellOps.getValueForEditing(this.ctx, this.sheetId, row, col);
    if (requestEpoch !== this._activeCellEditSourceEpoch) return;

    this._activeCellEditSourceVersion += 1;
    this._activeCellEditSource = {
      sheetId: this.sheetId,
      row,
      col,
      source,
      version: this._activeCellEditSourceVersion,
      fresh: true,
    };
  }

  getActiveCellEditSource(row: number, col: number): ActiveCellEditSource | null {
    const cache = this._activeCellEditSource;
    if (
      !cache ||
      !cache.fresh ||
      cache.sheetId !== this.sheetId ||
      cache.row !== row ||
      cache.col !== col
    ) {
      return null;
    }
    return { ...cache };
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

  // ===========================================================================
  // Sort / batch / autofill
  // ===========================================================================

  async sortRange(range: string | CellRange, options: SortOptions): Promise<void> {
    this._ensureWritable('worksheet.sortRange');
    if (!options?.columns || !Array.isArray(options.columns)) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'sortRange requires options.columns to be a non-empty array of SortColumn',
      );
    }

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

    // Normalize direction from SortColumn to contracts SortDirection ('asc'/'desc').
    // SortOps maps further to bridge SortOrder, and forwards the full
    // discriminated-union mode (value / cellColor / fontColor) so custom-list
    // and color-target fields survive the kernel boundary.
    const sortBy: ApiSortCriterion[] = options.columns.map((c): ApiSortCriterion => {
      const base = {
        column: parsed.startCol + c.column,
        direction: mapSortDirection(c.direction),
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
      hasHeaders: options.hasHeaders,
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
    });
  }

  async autoFill(
    sourceRange: string,
    targetRange: string,
    fillMode?: AutoFillMode,
  ): Promise<AutoFillResult> {
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

  async fillSeries(range: string, options: FillSeriesOptions): Promise<void> {
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
    await CellOps.relocateCells(this.ctx, this.sheetId, parsed, { row: targetRow, col: targetCol });
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
    );
  }

  async setCells(
    cells: Array<{ addr: string; value: CellValuePrimitive | Date }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{ address: string; value: CellValuePrimitive | Date }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{ row: number; col: number; value: CellValuePrimitive | Date }>,
  ): Promise<SetCellsResult>;
  async setCells(
    cells: Array<{
      addr?: string;
      address?: string;
      row?: number;
      col?: number;
      value: CellValuePrimitive | Date;
    }>,
  ): Promise<SetCellsResult> {
    this._ensureWritable('worksheet.setCells');
    // Protection check: verify all target cells are editable (concurrently)
    await Promise.all(
      cells.map((cell) => {
        const addrStr = cell.addr ?? cell.address;
        const { row, col } =
          addrStr !== undefined ? resolveCell(addrStr) : (cell as { row: number; col: number });
        return this.ensureCellEditable(row, col);
      }),
    );
    for (const cell of cells) {
      const addrStr = cell.addr ?? cell.address;
      const { row, col } =
        addrStr !== undefined ? resolveCell(addrStr) : (cell as { row: number; col: number });
      this._invalidateActiveCellEditSourceForCell(row, col);
    }
    return CellOps.setCells(this.ctx, this.sheetId, cells);
  }

  // ===========================================================================
  // Export helpers
  // ===========================================================================

  async toCSV(options?: { separator?: string; range?: string }): Promise<string> {
    const sep = options?.separator ?? ',';
    let range: { startRow: number; startCol: number; endRow: number; endCol: number } | null;
    if (options?.range) {
      const parsed = parseCellRange(options.range);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${options.range}"`);
      range = parsed;
    } else {
      range = await QueryOps.getUsedRange(this.ctx, this.sheetId);
    }
    if (!range) return '';

    const cellData = await RangeOps.getRange(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    });

    const lines: string[] = [];
    for (const row of cellData) {
      const fields: string[] = [];
      for (const cell of row) {
        const val = cell.value;
        if (val == null) {
          fields.push('');
          continue;
        }
        // Use pre-formatted display string from Rust when available
        // (respects number formats, date formats, locale, etc.)
        let str =
          cell.formatted != null && cell.formatted !== ''
            ? cell.formatted
            : String(normalizeCellValue(val));

        // Formula injection protection: prefix dangerous leading chars with tab
        if (str.length > 0 && '=+-@'.includes(str[0])) {
          str = '\t' + str;
        }

        // RFC 4180: quote fields containing separator, double-quote, or newline
        if (str.includes(sep) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          str = '"' + str.replace(/"/g, '""') + '"';
        }
        fields.push(str);
      }
      lines.push(fields.join(sep));
    }
    return lines.join('\r\n');
  }

  async toJSON(options?: {
    headerRow?: number | 'none';
    range?: string;
  }): Promise<Record<string, CellValue>[]> {
    let range: { startRow: number; startCol: number; endRow: number; endCol: number } | null;
    if (options?.range) {
      const parsed = parseCellRange(options.range);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${options.range}"`);
      range = parsed;
    } else {
      range = await QueryOps.getUsedRange(this.ctx, this.sheetId);
    }
    if (!range) return [];

    const cellData = await RangeOps.getRange(this.ctx, this.sheetId, {
      sheetId: this.sheetId,
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    });

    if (cellData.length === 0) return [];

    const headerOpt = options?.headerRow;
    let headers: string[];
    let dataStartIdx: number;

    if (headerOpt === 'none') {
      // Use column letters as keys
      headers = cellData[0].map((_, i) => {
        let col = range.startCol + i;
        let letter = '';
        while (col >= 0) {
          letter = String.fromCharCode(65 + (col % 26)) + letter;
          col = Math.floor(col / 26) - 1;
        }
        return letter;
      });
      dataStartIdx = 0;
    } else {
      const headerRowIdx = typeof headerOpt === 'number' ? headerOpt - range.startRow : 0;
      if (headerRowIdx < 0 || headerRowIdx >= cellData.length) {
        throw new KernelError('COMPUTE_ERROR', `Header row index out of range`);
      }
      headers = cellData[headerRowIdx].map((cell) =>
        cell.value != null ? String(cell.value) : '',
      );
      dataStartIdx = headerRowIdx + 1;
    }

    const result: Record<string, CellValue>[] = [];
    for (let i = dataStartIdx; i < cellData.length; i++) {
      const row = cellData[i];
      const obj: Record<string, CellValue> = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = normalizeCellValue(row[j]?.value ?? null);
      }
      result.push(obj);
    }
    return result;
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

  // ===========================================================================
  // Viewport — sync render-path data
  // ===========================================================================

  get viewport(): ViewportReader {
    if (!this._viewport) {
      this._viewport = this._createViewportReader();
    }
    return this._viewport;
  }

  private _createViewportReader(): ViewportReader {
    return createViewportReader(this.sheetId, this.ctx.computeBridge);
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on<K extends keyof import('@mog-sdk/contracts/api').SheetEventMap>(
    event: K,
    handler: (event: import('@mog-sdk/contracts/api').SheetEventMap[K]) => void,
  ): CallableDisposable;
  on<T extends InternalEventType>(
    event: T,
    handler: (event: EventByType<T>) => void,
  ): CallableDisposable;
  on(event: string, handler: (event: unknown) => void): CallableDisposable;
  on(event: string, handler: (event: any) => void): CallableDisposable {
    // Special case: 'deactivated' is derived from 'sheet:activated' — fires when
    // a DIFFERENT sheet becomes active (meaning this sheet was deactivated).
    if (event === 'deactivated') {
      const unsub = this.ctx.eventBus.on('sheet:activated', (internalEvent: any) => {
        if (internalEvent.sheetId !== this.sheetId) {
          handler({
            type: 'sheet:deactivated',
            sheetId: this.sheetId,
            name: this.name,
            timestamp: Date.now(),
          });
        }
      });
      return toDisposable(unsub);
    }

    const internalTypes = SHEET_EVENT_TO_INTERNAL[event];

    if (internalTypes) {
      // Coarse SheetEvent — subscribe to all mapped internal events, filter by sheetId
      const unsubs: Array<() => void> = [];
      for (const internalType of internalTypes) {
        const unsub = this.ctx.eventBus.on(internalType, (internalEvent: any) => {
          // Sheet-scoped filtering: only fire if the event is for this sheet
          if (internalEvent.sheetId && internalEvent.sheetId !== this.sheetId) return;
          handler(internalEvent); // Pass directly — no wrapper!
        });
        unsubs.push(unsub);
      }
      return toDisposable(() => {
        for (const u of unsubs) u();
      });
    }

    // Warn on unknown event names that aren't fine-grained internal types
    if (
      typeof event === 'string' &&
      !event.includes(':') &&
      event !== 'deactivated' &&
      !(event in SHEET_EVENT_TO_INTERNAL)
    ) {
      console.warn(
        `[Worksheet.on] Unknown event "${event}". ` +
          `Known coarse events: ${Object.keys(SHEET_EVENT_TO_INTERNAL).join(', ')}. ` +
          `For fine-grained events use internal type strings (e.g. "cell:changed").`,
      );
    }

    // Fine-grained InternalEventType passthrough — subscribe directly, filter by sheetId
    const unsub = this.ctx.eventBus.on(event, (internalEvent: any) => {
      if (internalEvent.sheetId && internalEvent.sheetId !== this.sheetId) return;
      handler(internalEvent); // Pass directly — no wrapper!
    });
    return toDisposable(unsub);
  }

  emit(event: SpreadsheetEvent): void {
    this.ctx.eventBus.emit(event);
  }

  /**
   * Subscribe to multiple events at once. Returns a single unsubscribe function.
   *
   * Accepts either `SheetEventMap` keys (camelCase, public API) or
   * `InternalEventType` strings (colon-separated, fine-grained). These are the
   * same two name spaces the single-event `on()` overloads accept; this method
   * just dispatches one subscription per element so each call binds to the
   * right typed overload. The untyped `on(string, (unknown) => void)` overload
   * is NOT used — callers always get payload typing through the underlying
   * `on()` generics.
   *
   * The handler receives the widened union of every payload the subscribed
   * events could emit: `SpreadsheetEvent` (all `InternalEventType` payloads)
   * plus `SheetEventMap[keyof SheetEventMap]` (which adds the synthetic
   * `sheet:deactivated` event that exists only on the public API surface).
   */
  onMany(
    events: Array<keyof import('@mog-sdk/contracts/api').SheetEventMap | InternalEventType>,
    handler: (
      event:
        | SpreadsheetEvent
        | import('@mog-sdk/contracts/api').SheetEventMap[keyof import('@mog-sdk/contracts/api').SheetEventMap],
    ) => void,
  ): () => void {
    const unsubs: CallableDisposable[] = [];
    for (const e of events) {
      // Colon-separated = InternalEventType overload; otherwise = SheetEventMap
      // overload. The runtime split matches the contract boundary declared in
      // `SHEET_EVENT_TO_INTERNAL` (contracts/src/api/internal-events).
      if (e.includes(':')) {
        unsubs.push(this.on(e as InternalEventType, handler));
      } else {
        const key = e as keyof import('@mog-sdk/contracts/api').SheetEventMap;
        unsubs.push(this.on(key, handler));
      }
    }
    return () => {
      for (const u of unsubs) u();
    };
  }

  // ===========================================================================
  // Reactive Caches
  // ===========================================================================

  get cellMetadata(): CellMetadataCacheContract {
    this._assertLive('worksheet.cellMetadata');
    if (!this._cellMetadata) {
      const cache = createCellMetadataCache(this.workbook);
      this._rawCellMetadataCache = cache;
      // Auto-register with MutationResultHandler for post-recalc patching
      this.ctx.computeBridge.setCellMetadataCache(cache);
      this._cellMetadata = {
        isProjectedPosition: (row, col) => cache.isProjectedPosition(row, col),
        getProjectionSourcePosition: (row, col) => cache.getProjectionSourcePosition(row, col),
        getProjectionRange: (row, col) => cache.getProjectionRange(row, col),
        hasValidationErrors: (row, col) => cache.hasValidationErrors(row, col),
        evaluateViewport: (sheetId, startRow, startCol, endRow, endCol) =>
          cache.evaluateViewport(toSheetId(sheetId), startRow, startCol, endRow, endCol),
        onChange: (callback) => cache.onChange(callback),
        clear: () => cache.clear(),
        destroy: () => cache.dispose(),
      };
    }
    return this._cellMetadata;
  }

  // ===========================================================================
  // Sub-API namespaces (lazy initialization)
  // ===========================================================================

  private _changes?: WorksheetChangesImpl;
  get changes(): WorksheetChanges {
    this._assertLive('worksheet.changes');
    return (this._changes ??= new WorksheetChangesImpl(this.ctx, this.sheetId, this._liveness));
  }

  private _formats?: WorksheetFormatsImpl;
  get formats(): WorksheetFormats {
    return (this._formats ??= new WorksheetFormatsImpl(this.ctx, this.sheetId));
  }

  private _layout?: WorksheetLayoutImpl;
  get layout(): WorksheetLayout {
    return (this._layout ??= new WorksheetLayoutImpl(this.ctx, this.sheetId));
  }

  private _view?: WorksheetViewImpl;
  get view(): WorksheetView {
    return (this._view ??= new WorksheetViewImpl(this.ctx, this.sheetId));
  }

  private _structure?: WorksheetStructureImpl;
  get structure(): WorksheetStructure {
    return (this._structure ??= new WorksheetStructureImpl(this.ctx, this.sheetId));
  }

  private _charts?: WorksheetChartsImpl;
  get charts(): WorksheetCharts {
    return (this._charts ??= new WorksheetChartsImpl(
      this.ctx,
      this.sheetId,
      this.ctx.chartImageExporter,
    ));
  }

  private _objects?: WorksheetObjectsImpl;
  private _objectCollection?: WorksheetObjectCollectionImpl;
  get objects(): WorksheetObjectCollection {
    return (this._objectCollection ??= new WorksheetObjectCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  /** Internal accessor — ensures _objects is initialized and returns the concrete type. */
  private get _objectsImpl(): WorksheetObjectsImpl {
    return (this._objects ??= new WorksheetObjectsImpl(
      this.ctx,
      this.sheetId,
      this._floatingObjectManager,
    ));
  }

  // ── Typed floating object collections ─────────────────────

  private _shapes?: WorksheetShapeCollectionImpl;
  get shapes(): WorksheetShapeCollection {
    return (this._shapes ??= new WorksheetShapeCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _pictures?: WorksheetPictureCollectionImpl;
  get pictures(): WorksheetPictureCollection {
    return (this._pictures ??= new WorksheetPictureCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _textBoxes?: WorksheetTextBoxCollectionImpl;
  get textBoxes(): WorksheetTextBoxCollection {
    return (this._textBoxes ??= new WorksheetTextBoxCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _drawings?: WorksheetDrawingCollectionImpl;
  get drawings(): WorksheetDrawingCollection {
    return (this._drawings ??= new WorksheetDrawingCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _equations?: WorksheetEquationCollectionImpl;
  get equations(): WorksheetEquationCollection {
    return (this._equations ??= new WorksheetEquationCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _textEffects?: WorksheetTextEffectCollectionImpl;
  get textEffects(): WorksheetTextEffectCollection {
    return (this._textEffects ??= new WorksheetTextEffectCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _connectors?: WorksheetConnectorCollectionImpl;
  get connectors(): WorksheetConnectorCollection {
    return (this._connectors ??= new WorksheetConnectorCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _filters?: WorksheetFiltersImpl;
  get filters(): WorksheetFilters {
    return (this._filters ??= new WorksheetFiltersImpl(this.ctx, this.sheetId));
  }

  private _formControls?: WorksheetFormControlsImpl;
  get formControls(): WorksheetFormControls {
    return (this._formControls ??= new WorksheetFormControlsImpl(
      this.ctx,
      (
        this.workbook as unknown as {
          getFormControlManager(): import('@mog-sdk/contracts/form-controls').IFormControlManager;
        }
      ).getFormControlManager(),
      this.sheetId,
    ));
  }

  private _conditionalFormatsAPI?: WorksheetConditionalFormattingImpl;
  get conditionalFormats(): WorksheetConditionalFormatting {
    return (this._conditionalFormatsAPI ??= new WorksheetConditionalFormattingImpl(
      this.ctx,
      this.sheetId,
    ));
  }

  private _validation?: WorksheetValidationImpl;

  get validations(): WorksheetValidation {
    return (this._validation ??= new WorksheetValidationImpl(this.ctx, this.sheetId));
  }

  private _tables?: WorksheetTablesImpl;
  get tables(): WorksheetTables {
    return (this._tables ??= new WorksheetTablesImpl(this.ctx, this.sheetId));
  }

  private _pivots?: WorksheetPivotsImpl;
  get pivots(): WorksheetPivots {
    this._assertLive('worksheet.pivots');
    return (this._pivots ??= new WorksheetPivotsImpl(
      this.ctx,
      this.sheetId,
      this.workbook,
      this._liveness,
    ));
  }

  private _slicers?: WorksheetSlicersImpl;
  get slicers(): WorksheetSlicers {
    return (this._slicers ??= new WorksheetSlicersImpl(this.ctx, this.sheetId));
  }

  private _sparklines?: WorksheetSparklinesImpl;
  get sparklines(): WorksheetSparklines {
    return (this._sparklines ??= new WorksheetSparklinesImpl(this.ctx, this.sheetId));
  }

  private _comments?: WorksheetCommentsImpl;
  get comments(): WorksheetComments {
    return (this._comments ??= new WorksheetCommentsImpl(this.ctx, this.sheetId));
  }

  private _customProperties?: WorksheetCustomPropertiesImpl;
  get customProperties(): WorksheetCustomProperties {
    return (this._customProperties ??= new WorksheetCustomPropertiesImpl(this.ctx, this.sheetId));
  }

  private _hyperlinks?: WorksheetHyperlinksImpl;
  get hyperlinks(): WorksheetHyperlinks {
    return (this._hyperlinks ??= new WorksheetHyperlinksImpl(this.ctx, this.sheetId));
  }

  private _outline?: WorksheetOutlineImpl;
  get outline(): WorksheetOutline {
    return (this._outline ??= new WorksheetOutlineImpl(this.ctx, this.sheetId));
  }

  private _protection?: WorksheetProtectionImpl;
  get protection(): WorksheetProtection {
    return (this._protection ??= new WorksheetProtectionImpl(this.ctx, this.sheetId));
  }

  private _whatIf?: WorksheetWhatIfImpl;
  get whatIf(): WorksheetWhatIf {
    return (this._whatIf ??= new WorksheetWhatIfImpl(this.ctx, this.sheetId));
  }

  private _print?: WorksheetPrintImpl;
  get print(): WorksheetPrint {
    return (this._print ??= new WorksheetPrintImpl(this.ctx, this.sheetId));
  }

  private _settings?: WorksheetSettingsImpl;
  get settings(): WorksheetSettings {
    return (this._settings ??= new WorksheetSettingsImpl(this.ctx, this.sheetId));
  }

  private _bindings?: WorksheetBindingsImpl;
  get bindings(): WorksheetBindings {
    return (this._bindings ??= new WorksheetBindingsImpl(this.ctx, this.sheetId));
  }

  private _names?: WorksheetNamesImpl;
  get names(): WorksheetNames {
    return (this._names ??= new WorksheetNamesImpl(this.ctx, this.sheetId));
  }

  private _styles?: WorksheetStylesImpl;
  get styles(): WorksheetStyles {
    return (this._styles ??= new WorksheetStylesImpl(this.ctx, this.sheetId));
  }

  private __internal?: WorksheetInternalImpl;
  get _internal(): WorksheetInternal {
    return (this.__internal ??= new WorksheetInternalImpl(this.ctx, this.sheetId));
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Resolve a `string | CellRange` to a CellRange with this sheet's sheetId.
   * For strings, parses A1 notation. For CellRange objects, passes through.
   */
  private resolveToCellRange(range: string | CellRange): CellRange {
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

  // ===========================================================================

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._unsubscribeActiveCellEditSourceEvents?.();
    this._unsubscribeActiveCellEditSourceEvents = null;
    this._activeCellEditSource = null;
    this._activeCellEditSourceTarget = null;
    // Dispose the _internal sub-API's cfCache if it was created
    if (this.__internal) {
      (this.__internal as WorksheetInternalImpl).dispose();
      this.__internal = undefined;
    }
    if (this._cellMetadata) {
      this._cellMetadata.destroy();
      this._cellMetadata = null;
      this._rawCellMetadataCache = null;
      // Auto-unregister from MutationResultHandler
      this.ctx.computeBridge.setCellMetadataCache(null);
    }
    this._viewport = null;
  }

  private _assertLive(operation: string): void {
    this._liveness.assertLive(operation);
    if (this._disposed) {
      throw this._liveness.error(operation);
    }
  }
}

// =============================================================================
// A1 → R1C1 formula converter (used by getFormulasR1C1)
// =============================================================================

/**
 * Convert column letters (e.g. "A", "BC") to a 1-based column number.
 */
function colLettersToNumber(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64); // 'A' = 65
  }
  return result;
}

/**
 * Set of Excel error display strings (`#DIV/0!`, `#N/A`, ...). Used by
 * {@link projectCellRecord} to discriminate string-typed cell values
 * between {@link RangeValueType.Error} and {@link RangeValueType.String}.
 *
 * Built from {@link ERROR_DISPLAY_MAP} so the two stay in sync; if a new
 * `ErrorVariant` ships, the map is the single source of truth.
 */
const ERROR_DISPLAY_STRINGS = new Set<string>(Object.values(ERROR_DISPLAY_MAP));

/**
 * Project a domain-layer {@link StoreCellData} (or `undefined`) to the
 * public {@link CellRecord} shape returned by `Worksheet.cells.get(addr)`.
 *
 * Empty in-bounds cells (`data === undefined`) deliberately return a
 * record with `value: null` + `valueType: Empty` rather than `undefined`
 * — see the public-API contract on {@link WorksheetCellsAccessor.get}.
 *
 * `isArrayMember` is derived here as `region != null && !region.isAnchor`
 * so the public surface has one canonical representation; the bridge's
 * back-compat `metadata.isArrayMember` field is intentionally ignored on
 * this read path so the accessor exposes one canonical surface.
 */
function projectCellRecord(
  addr: string,
  row: number,
  col: number,
  data: StoreCellData | undefined,
): CellRecord {
  const normalizedAddr = addr.toUpperCase();
  if (data === undefined) {
    return {
      row,
      col,
      addr: normalizedAddr,
      value: null,
      valueType: RangeValueType.Empty,
      formula: null,
      region: null,
      isArrayMember: false,
    };
  }

  const effective = CellReads.getEffectiveValue(data);
  const valueType = classifyValueType(effective);
  const value: CellValuePrimitive | null =
    effective !== null && isCellError(effective)
      ? ERROR_DISPLAY_MAP[effective.value]
      : (effective as CellValuePrimitive | null);
  const region: RegionMeta | null = data.region ?? null;
  const isArrayMember = region != null && !region.isAnchor;

  return {
    row,
    col,
    addr: normalizedAddr,
    value,
    valueType,
    formula: data.formula ?? null,
    region,
    isArrayMember,
  };
}

/**
 * Classify an effective {@link CellValue} into a {@link RangeValueType}.
 *
 * Switch arms:
 *
 * - `null`  → `Empty`
 * - number  → `Double` (dates included; matches OfficeJS)
 * - boolean → `Boolean`
 * - string  → `Error` if the string matches a known Excel error display
 *   (e.g. `#DIV/0!`, `#N/A`); otherwise `String`
 * - {@link CellError} object → `Error`
 */
function classifyValueType(v: CellValue | null): RangeValueType {
  if (v === null) return RangeValueType.Empty;
  if (typeof v === 'number') return RangeValueType.Double;
  if (typeof v === 'boolean') return RangeValueType.Boolean;
  if (typeof v === 'string') {
    return ERROR_DISPLAY_STRINGS.has(v) ? RangeValueType.Error : RangeValueType.String;
  }
  if (isCellError(v)) return RangeValueType.Error;
  return RangeValueType.Empty;
}

/** Regex matching A1-style cell references (with optional $ anchors). */
const A1_REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)/g;

/**
 * Convert an A1-style formula string to R1C1 notation relative to (baseRow, baseCol).
 * baseRow and baseCol are 0-based.
 */
function a1FormulaToR1C1(formula: string, baseRow: number, baseCol: number): string {
  const baseRow1 = baseRow + 1;
  const baseCol1 = baseCol + 1;

  return formula.replace(
    A1_REF_RE,
    (_match, colDollar: string, colLetters: string, rowDollar: string, rowDigits: string) => {
      const refRow = parseInt(rowDigits, 10);
      const refCol = colLettersToNumber(colLetters);

      const rowAbsolute = rowDollar === '$';
      const colAbsolute = colDollar === '$';

      let rowPart: string;
      if (rowAbsolute) {
        rowPart = `R${refRow}`;
      } else {
        const delta = refRow - baseRow1;
        rowPart = delta === 0 ? 'R' : `R[${delta}]`;
      }

      let colPart: string;
      if (colAbsolute) {
        colPart = `C${refCol}`;
      } else {
        const delta = refCol - baseCol1;
        colPart = delta === 0 ? 'C' : `C[${delta}]`;
      }

      return rowPart + colPart;
    },
  );
}
