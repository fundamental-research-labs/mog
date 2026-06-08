/**
 * WorkbookImpl — Unified Workbook Implementation
 *
 * THE single implementation of the Workbook interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * Absorbs functionality from:
 * - SpreadsheetAPI (kernel/src/api/spreadsheet-api.ts)
 * - External API WorkbookImpl (kernel/src/external/workbook.ts)
 *
 * Design decisions:
 * 1. getSheetById(sheetId) is SYNC — constructs WorksheetImpl directly.
 *    getSheet/getSheetByIndex are ASYNC — reads from Rust.
 *    No JS-side sheet cache. Rust is the single source of truth.
 * 2. canUndo()/canRedo() are SYNC — delegated to UndoService's cached state.
 * 3. undoGroup() wraps operations in beginUndoGroup/endUndoGroup for undo grouping.
 *    Each mutation triggers its own recalc — no deferred calc accumulation.
 * 4. Errors are thrown, not returned as OperationResult. This is simpler
 *    for LLM code generation (try/catch beats checking .success).
 *
 * @see contracts/src/api/workbook.ts — Interface definition
 */

import type {
  CalculateOptions,
  CalculateResult,
  CheckpointInfo,
  CodeResult,
  InsertWorksheetOptions,
  ExecuteOptions,
  ScreenshotOptions,
  SearchOptions,
  SearchResult,
  FilterExpression,
  FunctionInfo,
  IRecordsAPI,
  RecordValues,
  SheetRangeDescribeResult,
  SheetRangeRequest,
  Workbook,
  WorkbookEvent,
  WorkbookInternal,
  WorkbookSettings,
  WorkbookSettingsPatch,
  WorkbookSnapshot,
  CustomList,
  WorkbookCustomListInput,
  WorkbookCustomListUpdate,
  WorkbookLinks,
  WorkbookLinkStatusScope,
  Worksheet,
  WorksheetWithInternals,
} from '@mog-sdk/contracts/api';
import type { CultureInfo } from '@mog-sdk/contracts/culture';
import type { IChartBridge, IInkRecognitionBridge, IPivotBridge } from '@mog-sdk/contracts/bridges';
import { type CellValuePrimitive, type SheetId, sheetId } from '@mog-sdk/contracts/core';
import { toRowId as toSpreadsheetRowId } from '@mog-sdk/contracts/cell-identity';
import {
  type CallableDisposable,
  DisposableStore,
  toDisposable,
} from '@mog/spreadsheet-utils/disposable';
import type { DocumentImportWarning } from '@mog-sdk/contracts/document';
import { materializeExternalFormulas } from '../../services/external-formulas';
import { slog } from '../../lib/slog';
import type {
  EventByType,
  IEventBus,
  SpreadsheetEventType as InternalEventType,
  SpreadsheetEvent as InternalSpreadsheetEvent,
} from '@mog-sdk/contracts/events';
import { KernelError } from '../../errors';
import type {
  MutationResultWithSheetLifecycleRuntimeHint,
  SheetRuntimeAdapterContext,
} from '../../bridges/mutation-result-handler';

import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';
import type { IKernelServices } from '@mog-sdk/contracts/services';

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type { AccessPrincipal } from '@mog-sdk/contracts/security';

import type { DocumentContext } from '../../context';
import { FormControlManager } from '../../domain/form-controls';
import { getName, getOrder } from '../../domain/sheets/sheet-meta';
import { DEFAULT_CALCULATION_SETTINGS } from '../../domain/workbook/core-defaults';
import { toComputeWorkbookSettings } from '../../domain/workbook/workbook-settings-wire';
import type { SpreadsheetObjectManager } from '../../floating-objects';
import { createCheckpointManager } from '../../services/checkpoint';
import type { ICheckpointManager } from '../../services/checkpoint';
import {
  getFunctionCatalog as getCatalog,
  getFunctionInfo as getInfo,
  getWorkbookSnapshot as getSnapshot,
} from '../internal/introspection';
import { parseCellAddress, parseCellRange, toA1 } from '../internal/utils';
import * as Records from '../namespaces/records';
import { formatDescribeRange } from '../worksheet/operations/describe-operations';
import { WorksheetImpl } from '../worksheet/worksheet-impl';

// Shared workbook types — extracted to avoid impl↔barrel cycle.
import type {
  CodeExecutorFactory,
  CodeExecutorType,
  CreateWorkbookOptions,
  WorkbookConfig,
} from './types';
export type { CreateWorkbookOptions, WorkbookConfig } from './types';

// Event mapping — extracted to `event-mapping.ts` so `sheets.ts` can import it
// without going through the barrel (which would re-introduce the cycle).
import { EVENT_TO_INTERNAL } from './event-mapping';
export { EVENT_TO_INTERNAL } from './event-mapping';

// Sub-API imports — imported directly from each module (NOT through `./index`)
// to keep the impl→barrel→impl cycle broken.
import type {
  WorkbookCellStyles,
  WorkbookChanges,
  WorkbookDiagnostics,
  WorkbookFunctions,
  WorkbookHistory,
  WorkbookNames,
  WorkbookNotifications,
  WorkbookPivotTableStyles,
  WorkbookProperties,
  WorkbookProtection,
  WorkbookScenarios,
  WorkbookSecurity,
  WorkbookSheets,
  WorkbookSlicerStyles,
  WorkbookSlicers,
  WorkbookStateProvider,
  WorkbookTableStyles,
  WorkbookTheme,
  WorkbookTimelineStyles,
  WorkbookViewport,
} from '@mog-sdk/contracts/api';
import { WorkbookHistoryImpl } from './history';
import { WorkbookNamesImpl } from './names';
import { WorkbookNotificationsImpl } from './notifications';
import { WorkbookPropertiesImpl } from './properties';
import { WorkbookProtectionImpl } from './protection';
import { WorkbookScenariosImpl } from './scenarios';
import { WorkbookSheetsImpl } from './sheets';
import { WorkbookSlicerStylesImpl } from './slicer-styles';
import { WorkbookSlicersImpl } from './slicers';
import { WorkbookTimelineStylesImpl } from './timeline-styles';
import { WorkbookTableStylesImpl } from './table-styles';
import { WorkbookCellStylesImpl } from './cell-styles';
import { WorkbookThemeImpl } from './theme';
import { WorkbookPivotTableStylesImpl } from './pivot-styles';
import { WorkbookFunctionsImpl } from './functions';
import { WorkbookSecurityImpl } from './security';
import { WorkbookViewportImpl } from './viewport';
import { WorkbookChangesImpl } from './changes';
import { WorkbookDiagnosticsImpl } from './diagnostics';

import { DEFAULT_CHROME_THEME } from '@mog-sdk/contracts/rendering';
import { NO_HOST_OPERATION_GATE, OperationDeniedError } from '../../document/host-operation-gate';
import type {
  HostExportContentPolicy,
  KernelDocumentHighWaterMarkProof,
} from '@mog-sdk/types-host/kernel';
import { createHostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import { createHandleLiveness, type HandleLiveness } from '../lifecycle/handle-liveness';

// =============================================================================
// WorkbookImpl
// =============================================================================

function resolveWorkbookLivenessMetadata(ctx: DocumentContext): {
  readonly label: string;
  readonly documentId?: string;
  readonly sessionId?: string;
} {
  const maybeScope = (ctx as { workbookLinkScope?: DocumentContext['workbookLinkScope'] })
    .workbookLinkScope;
  const scope = typeof maybeScope === 'function' ? maybeScope.call(ctx) : undefined;
  return {
    label: 'Workbook',
    ...(scope?.requestingDocumentId ? { documentId: scope.requestingDocumentId } : {}),
    ...(scope?.requestingSessionId ? { sessionId: scope.requestingSessionId } : {}),
  };
}

export class WorkbookImpl implements WorkbookInternal {
  /**
   * Internal DocumentContext — cast from the public IKernelContext.
   * WorkbookImpl is kernel-internal code and knows the runtime type is always DocumentContext.
   */
  private readonly ctx: DocumentContext;
  private readonly stateProvider: WorkbookStateProvider;
  private readonly eventBus: IEventBus;
  private readonly checkpointManager: ICheckpointManager;
  private readonly _floatingObjectManager: SpreadsheetObjectManager;
  private readonly _disposables = new DisposableStore();

  private codeExecutor: CodeExecutorType | null = null;
  private codeExecutorFactory: CodeExecutorFactory | null = null;
  private _formControlManager?: FormControlManager;
  private _links?: WorkbookLinks;
  private _diagnostics?: WorkbookDiagnosticsImpl;

  // Instance cache for getSheetById() — returns the same WorksheetImpl for the same sheetId
  // to provide referential stability (prevents infinite re-render loops when used in React deps)
  private _worksheetInstances: Map<SheetId, WorksheetImpl> = new Map();

  // Cached sheet metadata — populated by refreshSheetMetadata(), kept in sync on mutations
  private _cachedSheetNames: string[] = [];
  private _cachedSheetCount: number = 0;

  // Platform state: dirty tracking
  private _dirty = false;
  private _sheetRuntimeAdapterRegistration: CallableDisposable | null = null;
  private _sheetRuntimeAdapterHandler: unknown = null;

  // Platform state: whether the workbook was loaded from a previously saved source
  private readonly _previouslySaved: boolean;

  // Workbook properties (OfficeJS parity)
  readonly name: string;
  readonly readOnly: boolean;

  // Platform-provided save handler
  private readonly _onSave?: (buffer: Uint8Array) => Promise<void>;
  private readonly _writeFile?: (path: string, data: Uint8Array) => Promise<void>;

  // Track disposal
  private _disposed = false;
  private readonly _liveness: HandleLiveness;

  /**
   * Guard: throws a clean KernelError if the workbook has been disposed.
   * Called at the top of public methods to prevent stale sub-API instances
   * (sheets, charts, etc.) from hitting the invalidated transport.
   */
  private _ensureNotDisposed(): void {
    this._liveness.assertLive('workbook');
    if (this._disposed) {
      throw this._liveness.error('workbook');
    }
  }

  /**
   * Guard: throws WriteGateError if the document is not writable.
   * Called at the top of public mutation methods (the write gate).
   */
  private _ensureWritable(operation: string): void {
    this.ctx.writeGate.assertWritable(operation);
  }
  private _importWarnings: readonly DocumentImportWarning[] = [];

  constructor(config: WorkbookConfig) {
    // Cast to DocumentContext — WorkbookImpl is internal kernel code and knows the runtime type
    this.ctx = config.ctx as DocumentContext;
    this._liveness =
      config.liveness ??
      createHandleLiveness({
        label: 'Workbook',
        code: 'BRIDGE_DISPOSED',
        metadata: resolveWorkbookLivenessMetadata(this.ctx),
      });

    // stateProvider is the single source of truth for active sheet + UI state.
    // When not provided, a default headless provider tracks activeSheetId internally
    // and returns null/empty for all UI queries. _init() populates the active sheet
    // to the first sheet when it's empty.
    if (config.stateProvider) {
      this.stateProvider = config.stateProvider;
      slog('workbook.activeSheet.mode', { mode: 'external-provider' });
    } else {
      let _activeSheetId = '';
      this.stateProvider = {
        getActiveSheetId: () => _activeSheetId,
        setActiveSheetId: (id: string) => {
          slog('workbook.activeSheet.set', { sheetId: id });
          _activeSheetId = id;
        },
        getActiveCell: () => null,
        getSelectedRanges: () => [],
        getActiveObjectId: () => null,
        getActiveObjectType: () => null,
      };
      slog('workbook.activeSheet.mode', { mode: 'internal-tracking' });
    }

    this.eventBus = config.eventBus;
    this.checkpointManager = createCheckpointManager(
      this.ctx.computeBridge,
      this.ctx.services?.undo,
    );

    // Read the document-scoped singleton from context (created in createDocumentContext).
    this._floatingObjectManager = this.ctx.floatingObjectManager as SpreadsheetObjectManager;

    if (config.codeExecutorFactory) {
      this.codeExecutorFactory = config.codeExecutorFactory;
    }

    // Platform state
    this._previouslySaved = config.previouslySaved ?? false;
    this.name = config.name ?? '';
    this.readOnly = config.readOnly ?? false;
    this._onSave = config.onSave;
    this._writeFile = config.writeFile;
    this._importWarnings = config.importWarnings ?? [];

    // Write gate: if the workbook is opened read-only, lock the gate.
    if (this.readOnly) {
      (this.ctx.writeGate as import('../../document/write-gate').WriteGate)?.setMode('closed');
    }

    this.registerSheetRuntimeAdapter();

    // Subscribe to all events to track dirty state.
    const unsub = this.eventBus.onAll(() => {
      this._dirty = true;
    });
    if (unsub) {
      this._disposables.track(toDisposable(unsub));
    }
  }

  /**
   * @internal Lazy singleton FormControlManager for this document.
   * Used by WorksheetFormControlsImpl sub-API.
   */
  getFormControlManager(): FormControlManager {
    return (this._formControlManager ??= new FormControlManager(this.ctx));
  }

  // ===========================================================================
  // Platform State
  // ===========================================================================

  get autoSave(): boolean {
    return false;
  }

  get useSystemSeparators(): boolean {
    return true;
  }

  get isDirty(): boolean {
    return this._dirty;
  }

  markClean(): void {
    this._dirty = false;
  }

  get previouslySaved(): boolean {
    return this._previouslySaved;
  }

  // ===========================================================================
  // Active Object Queries (UI state — delegates to stateProvider)
  // ===========================================================================

  getActiveCell(): { sheetId: string; row: number; col: number; address: string } | null {
    const cell = this.stateProvider.getActiveCell();
    if (!cell) return null;
    return { ...cell, address: toA1(cell.row, cell.col) };
  }

  getSelectedRanges(): string[] {
    return this.stateProvider.getSelectedRanges();
  }

  getSelectedRange(): string | null {
    return this.stateProvider.getSelectedRanges()[0] ?? null;
  }

  getActiveChart(): string | null {
    return this.stateProvider.getActiveObjectType() === 'chart'
      ? this.stateProvider.getActiveObjectId()
      : null;
  }

  getActiveShape(): string | null {
    return this.stateProvider.getActiveObjectType() === 'shape'
      ? this.stateProvider.getActiveObjectId()
      : null;
  }

  getActiveSlicer(): string | null {
    return this.stateProvider.getActiveObjectType() === 'slicer'
      ? this.stateProvider.getActiveObjectId()
      : null;
  }

  /**
   * Initialize the workbook. Called by createWorkbook() factory.
   *
   * Pre-creates WorksheetImpl instances for all sheets and populates their
   * cached metadata (name, index, visibility) so that sync accessors like
   * getName() work immediately without a separate refreshSheetMetadata() call.
   */
  async _init(): Promise<void> {
    this.registerSheetRuntimeAdapter();

    const order = await getOrder(this.ctx);

    // Initialize active sheet if not yet set (default headless provider starts empty).
    // External providers that already have a valid active sheet are not overwritten.
    if (order.length > 0 && !this.stateProvider.getActiveSheetId()) {
      this.stateProvider.setActiveSheetId(order[0]);
    }

    // Pre-create worksheet instances so getSheetById()/activeSheet (sync)
    // return instances that already have cached metadata.
    for (const sheetId of order) {
      this._getOrCreateWorksheet(sheetId);
    }
    await this.refreshSheetMetadata();
  }

  /**
   * Resolve a name or index to a sheetId. ASYNC — reads from Rust.
   * String = sheet name (display name), number = 0-based index.
   * Never pass a sheetId here — use getSheetById(sheetId) for direct ID access.
   */
  async _resolveTarget(target: number | string): Promise<SheetId> {
    if (typeof target === 'number') {
      const order = await getOrder(this.ctx);
      if (target < 0 || target >= order.length) {
        throw new KernelError('API_SHEET_NOT_FOUND', `Sheet not found: ${target}`, {
          context: { target },
        });
      }
      return order[target];
    }

    // String — first try as a sheet name (case-insensitive lookup)
    const order = await getOrder(this.ctx);
    for (const id of order) {
      const name = await this.ctx.computeBridge.getSheetName(id);
      if (name != null && name.toLowerCase() === target.toLowerCase()) {
        return id;
      }
    }

    // Fallback: check if target is itself a sheetId in the order array
    const matchedId = order.find((id) => id === target);
    if (matchedId) {
      return matchedId;
    }

    throw new KernelError('API_SHEET_NOT_FOUND', `Sheet not found: ${target}`, {
      context: { target },
    });
  }

  /** Resolve a sheet name (case-insensitive) to its sheetId. ASYNC — reads from Rust. */
  private async _resolveSheetNameToId(nameLower: string): Promise<SheetId | undefined> {
    const order = await getOrder(this.ctx);
    for (const id of order) {
      const sheetName = await this.ctx.computeBridge.getSheetName(id);
      if (sheetName != null && sheetName.toLowerCase() === nameLower) {
        return id;
      }
    }
    return undefined;
  }

  // ===========================================================================
  // CodeExecutor Management
  // ===========================================================================

  /**
   * Set the CodeExecutor factory. Called by engine layer to inject the
   * executor implementation without creating a circular dependency.
   */
  setCodeExecutorFactory(factory: CodeExecutorFactory): void {
    this.codeExecutorFactory = factory;
  }

  private _getExecutor(): CodeExecutorType {
    if (!this.codeExecutor) {
      if (!this.codeExecutorFactory) {
        throw new KernelError(
          'COMPUTE_ERROR',
          'CodeExecutor not available. Call setCodeExecutorFactory() first.',
        );
      }
      this.codeExecutor = this.codeExecutorFactory({
        ctx: this.ctx,
        eventBus: this.eventBus,
        getActiveSheetId: () => this.getActiveSheetId(),
      });
    }
    return this.codeExecutor;
  }

  // ===========================================================================
  // Sheet Access
  // ===========================================================================

  /** Get a sheet by name (case-insensitive). ASYNC — resolves name via Rust. */
  async getSheet(name: string): Promise<WorksheetWithInternals> {
    this._ensureNotDisposed();
    const sheetId = await this._resolveTarget(name);
    const isNew = !this._worksheetInstances.has(sheetId);
    const ws = this._getOrCreateWorksheet(sheetId, name);
    // New instances have default metadata — sync from Rust to get actual visibility etc.
    if (isNew) {
      await this.refreshSheetMetadata();
    }
    return ws;
  }

  /** Get a sheet by sheetId. SYNC — just constructs/returns a WorksheetImpl. */
  getSheetById(sheetId: SheetId): WorksheetWithInternals {
    this._ensureNotDisposed();
    return this._getOrCreateWorksheet(sheetId);
  }

  /** Find a sheet by name, returning null if not found. Non-throwing. */
  async findSheet(name: string): Promise<WorksheetWithInternals | null> {
    this._ensureNotDisposed();
    try {
      return await this.getSheet(name);
    } catch {
      return null;
    }
  }

  /** Get a sheet by 0-based index. ASYNC — resolves index via Rust. */
  async getSheetByIndex(index: number): Promise<WorksheetWithInternals> {
    this._ensureNotDisposed();
    const sheetId = await this._resolveTarget(index);
    const isNew = !this._worksheetInstances.has(sheetId);
    const ws = this._getOrCreateWorksheet(sheetId);
    if (isNew) {
      await this.refreshSheetMetadata();
    }
    return ws;
  }

  get activeSheet(): WorksheetWithInternals {
    this._ensureNotDisposed();
    const activeId = sheetId(this.stateProvider.getActiveSheetId());
    slog('workbook.getActiveSheet', { resolvedSheetId: String(activeId) });
    return this._getOrCreateWorksheet(activeId);
  }

  /** SYNC — returns cached sheet count, updated by refreshSheetMetadata(). */
  get sheetCount(): number {
    this._ensureNotDisposed();
    return this._cachedSheetCount;
  }

  /** SYNC — returns cached sheet names in display order, updated by refreshSheetMetadata(). */
  get sheetNames(): string[] {
    this._ensureNotDisposed();
    return this._cachedSheetNames;
  }

  async getSheetCount(): Promise<number> {
    this._ensureNotDisposed();
    await this.refreshSheetMetadata();
    return this._cachedSheetCount;
  }

  async getSheetNames(): Promise<string[]> {
    this._ensureNotDisposed();
    await this.refreshSheetMetadata();
    return [...this._cachedSheetNames];
  }

  /** Get all worksheets in display order. ASYNC — resolves each sheet from the order. */
  async getSheets(): Promise<Worksheet[]> {
    this._ensureNotDisposed();
    const order = await getOrder(this.ctx);
    return order.map((id) => this._getOrCreateWorksheet(id));
  }

  async getOrCreateSheet(
    name: string,
  ): Promise<{ sheet: WorksheetWithInternals; created: boolean }> {
    this._ensureNotDisposed();
    // Try to find existing sheet by name (case-insensitive)
    try {
      const sheet = await this.getSheet(name);
      return { sheet, created: false };
    } catch {
      // Sheet not found — create it. sheets.add() returns the Worksheet directly.
      const sheet = (await this.sheets.add(name)) as WorksheetWithInternals;
      return { sheet, created: true };
    }
  }

  _getOrCreateWorksheet(sheetId: SheetId, name?: string): WorksheetWithInternals {
    let ws = this._worksheetInstances.get(sheetId);
    if (!ws) {
      ws = new WorksheetImpl(sheetId, this.ctx, {
        workbook: this as Workbook,
        name,
        floatingObjectManager: this._floatingObjectManager,
        liveness: this._liveness,
      });
      this._worksheetInstances.set(sheetId, ws);
    }
    return ws as WorksheetWithInternals;
  }

  /**
   * Populate cached metadata (name, index, visibility) for all worksheet
   * instances that were lazily created without metadata.
   *
   * Call after construction or when the sheet order may have changed.
   */
  async refreshSheetMetadata(): Promise<void> {
    if (this._disposed) return;
    const order = await getOrder(this.ctx);
    const names: string[] = [];
    await Promise.all(
      order.map(async (sheetId, idx) => {
        const ws = this._worksheetInstances.get(sheetId);
        const [name, hidden] = await Promise.all([
          getName(this.ctx, sheetId),
          this.ctx.computeBridge.isSheetHidden(sheetId),
        ]);
        const resolvedName = name ?? sheetId;
        names[idx] = resolvedName;
        if (ws) {
          ws._syncMetadata(resolvedName, idx, !hidden);
        }
      }),
    );
    // Update workbook-level cached sheet metadata
    this._cachedSheetNames = names;
    this._cachedSheetCount = order.length;
  }

  /** Get the current active sheet ID. Infrastructure-only (WorkbookInternal). */
  getActiveSheetId(): SheetId {
    return sheetId(this.stateProvider.getActiveSheetId());
  }

  /** Set the active sheet ID. Infrastructure-only (WorkbookInternal). */
  setActiveSheetId(id: SheetId): void {
    this.stateProvider.setActiveSheetId(String(id));
  }

  private registerSheetRuntimeAdapter(): void {
    const getMutationHandler = this.ctx.computeBridge.getMutationHandler?.bind(
      this.ctx.computeBridge,
    );
    const handler = getMutationHandler?.();
    if (!handler || handler === this._sheetRuntimeAdapterHandler) return;

    if (this._sheetRuntimeAdapterRegistration) {
      this._disposables.untrack(this._sheetRuntimeAdapterRegistration);
      this._sheetRuntimeAdapterRegistration.dispose();
      this._sheetRuntimeAdapterRegistration = null;
    }

    const registration = handler.registerSheetRuntimeAdapter('workbook-active-sheet', {
      captureContext: () => {
        const beforeActive = this.getProviderActiveSheetId();
        const beforeVisibleIds = this.getVisibleSheetIds();
        return {
          beforeActive,
          beforeActiveVisibleIndex: beforeActive ? beforeVisibleIds.indexOf(beforeActive) : -1,
        };
      },
      apply: (result, context) => this.applySheetRuntimeReconciliation(result, context),
    });

    this._sheetRuntimeAdapterHandler = handler;
    this._sheetRuntimeAdapterRegistration = this._disposables.track(registration);
  }

  private applySheetRuntimeReconciliation(
    result: MutationResultWithSheetLifecycleRuntimeHint,
    context: SheetRuntimeAdapterContext,
  ): void {
    const visibleIds = this.getVisibleSheetIds();
    if (visibleIds.length === 0) return;

    const currentActive = this.getProviderActiveSheetId();
    const hintedActive =
      context.source === 'user' ? this.getRuntimeHintActiveSheetId(result) : null;
    const nextActive =
      hintedActive && this.isVisibleSheet(hintedActive)
        ? hintedActive
        : currentActive && this.isVisibleSheet(currentActive)
          ? currentActive
          : this.getNearestVisibleSheetId(visibleIds, context.beforeActiveVisibleIndex);

    if (!nextActive || nextActive === currentActive) return;

    this.reconcileProviderRuntimeState(nextActive, visibleIds);
    this.stateProvider.setActiveSheetId(String(nextActive));
    this.eventBus.emit({
      type: 'sheet:activated',
      timestamp: Date.now(),
      sheetId: nextActive,
      name: this.ctx.mirror.getSheetMeta(nextActive).name ?? '',
      source: context.source === 'user' ? 'user' : 'remote',
    });
  }

  private getProviderActiveSheetId(): SheetId | null {
    const active = this.stateProvider.getActiveSheetId();
    return active ? sheetId(active) : null;
  }

  private getVisibleSheetIds(): SheetId[] {
    return this.ctx.mirror.getSheetIds().filter((id) => !this.ctx.mirror.getSheetMeta(id).hidden);
  }

  private isVisibleSheet(id: SheetId): boolean {
    const ids = this.ctx.mirror.getSheetIds();
    return ids.includes(id) && !this.ctx.mirror.getSheetMeta(id).hidden;
  }

  private getNearestVisibleSheetId(
    visibleIds: readonly SheetId[],
    beforeActiveVisibleIndex: number,
  ): SheetId {
    const targetIndex =
      beforeActiveVisibleIndex >= 0 ? Math.min(beforeActiveVisibleIndex, visibleIds.length - 1) : 0;
    return visibleIds[targetIndex]!;
  }

  private getRuntimeHintActiveSheetId(
    result: MutationResultWithSheetLifecycleRuntimeHint,
  ): SheetId | null {
    const activeSheet = result.sheetLifecycleRuntimeHint?.activeSheet;
    return activeSheet ? sheetId(String(activeSheet)) : null;
  }

  private reconcileProviderRuntimeState(nextActive: SheetId, visibleIds: readonly SheetId[]): void {
    const provider = this.stateProvider as WorkbookStateProvider & {
      reconcileSheetRuntimeState?: (state: {
        activeSheetId: string;
        visibleSheetIds: readonly string[];
      }) => void;
    };
    provider.reconcileSheetRuntimeState?.({
      activeSheetId: String(nextActive),
      visibleSheetIds: visibleIds.map(String),
    });
  }

  /**
   * Sync read view of the kernel state mirror — see WorkbookInternal contract.
   *
   * The mirror itself is owned by `DocumentContext` and populated by
   * `MutationResultHandler.applyAndNotify` BEFORE any event emission. The
   * Workbook just exposes the existing read view; no extra wiring needed
   * because every WorkbookImpl is constructed against a DocumentContext
   * that already carries the mirror.
   */
  get mirror() {
    return this.ctx.mirror;
  }

  // ===========================================================================
  // Orchestration: Undo Group
  // ===========================================================================

  private async runUndoGroup<T = void>(
    operation: string,
    fn: (wb: Workbook) => Promise<T>,
    description?: string,
  ): Promise<T> {
    this._ensureNotDisposed();
    this._ensureWritable(operation);
    if (description !== undefined) {
      this.ctx.services?.undo.setNextDescription(description);
    }
    await this.ctx.computeBridge.beginUndoGroup();
    try {
      const result = await fn(this);
      return result;
    } finally {
      await this.ctx.computeBridge.endUndoGroup();
    }
  }

  async undoGroup<T = void>(fn: (wb: Workbook) => Promise<T>): Promise<T> {
    return this.runUndoGroup('workbook.undoGroup', fn);
  }

  async batch<T = void>(label: string, fn: (wb: Workbook) => Promise<T>): Promise<T> {
    return this.runUndoGroup('workbook.batch', fn, label);
  }

  // ===========================================================================
  // Orchestration: Checkpoints
  // ===========================================================================

  createCheckpoint(label?: string): string {
    const id = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.checkpointManager.createSync(id, { name: label ?? 'Checkpoint' });
    return id;
  }

  async restoreCheckpoint(id: string): Promise<void> {
    this._ensureWritable('workbook.restoreCheckpoint');
    const result = await this.checkpointManager.restore(id);
    if (!result.ok) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Failed to restore checkpoint: ${result.error ?? 'unknown'}`,
      );
    }
    // Evict stale WorksheetImpl instances after checkpoint restore
    this._worksheetInstances.clear();
    await this.refreshSheetMetadata();
  }

  listCheckpoints(): CheckpointInfo[] {
    return this.checkpointManager.list().map((cp) => ({
      id: cp.id,
      label: cp.name,
      timestamp: cp.timestamp,
    }));
  }

  // ===========================================================================
  // Calculation Control
  // ===========================================================================

  private _calcSuspended = false;
  private _calculationState: 'done' | 'calculating' | 'pending' = 'done';
  private _cachedCalcMode: 'auto' | 'autoNoTable' | 'manual' | null = null;
  private _cachedCultureInfo: CultureInfo | null = null;

  get calculationState(): 'done' | 'calculating' | 'pending' {
    return this._calculationState;
  }

  async calculate(options?: CalculateOptions): Promise<CalculateResult> {
    this._ensureNotDisposed();
    const opts: CalculateOptions = options ?? {};

    // Build per-call iterative overrides for the bridge
    const recalcOptions: Record<string, unknown> = {};
    if (opts.iterative !== undefined) {
      if (typeof opts.iterative === 'boolean') {
        recalcOptions.iterative = opts.iterative;
      } else {
        recalcOptions.iterative = true;
        if (opts.iterative.maxIterations !== undefined) {
          recalcOptions.maxIterations = opts.iterative.maxIterations;
        }
        if (opts.iterative.maxChange !== undefined) {
          recalcOptions.maxChange = opts.iterative.maxChange;
        }
      }
    }

    this._calculationState = 'calculating';
    try {
      const externalMaterialized = await materializeExternalFormulas(this.ctx);
      const result = await this.ctx.computeBridge.fullRecalc(recalcOptions);
      this._calculationState = 'done';
      return {
        hasCircularRefs: result.metrics?.hasCircularRefs ?? false,
        converged: result.metrics?.iterativeConverged ?? false,
        iterations: result.metrics?.iterativeIterations ?? 0,
        maxDelta: result.metrics?.iterativeMaxDelta ?? 0,
        circularCellCount: result.metrics?.circularCellCount ?? 0,
        recomputedCount: (result.metrics?.cellsEvaluated ?? 0) + externalMaterialized,
      };
    } catch (e) {
      this._calculationState = 'done';
      const msg = String(e);
      if (
        msg.includes('Unknown napi method') ||
        msg.includes('not a function') ||
        msg.includes('not found')
      ) {
        // Graceful fallback for missing bridge method
        return {
          hasCircularRefs: false,
          converged: false,
          iterations: 0,
          maxDelta: 0,
          circularCellCount: 0,
          recomputedCount: 0,
        };
      }
      throw new KernelError('COMPUTE_ERROR', `Full recalculation failed: ${msg}`);
    }
  }

  suspendCalc(): void {
    this._calcSuspended = true;
    this._calculationState = 'pending';
  }

  async resumeCalc(): Promise<void> {
    if (!this._calcSuspended) return;
    this._calcSuspended = false;
    await this.calculate();
  }

  async getCalculationMode(): Promise<'auto' | 'autoNoTable' | 'manual'> {
    if (this._cachedCalcMode !== null) return this._cachedCalcMode;
    const settings = await this.ctx.computeBridge.getWorkbookSettings();
    this._cachedCalcMode = settings.calculationSettings?.calcMode ?? 'auto';
    return this._cachedCalcMode;
  }

  async setCalculationMode(mode: 'auto' | 'autoNoTable' | 'manual'): Promise<void> {
    this._ensureWritable('workbook.setCalculationMode');
    await this.setSettings({
      calculationSettings: await this.mergeCalculationSettings({ calcMode: mode }),
    });
    if (mode !== 'manual') {
      await this.calculate();
    }
  }

  async getIterativeCalculation(): Promise<boolean> {
    const settings = await this.ctx.computeBridge.getWorkbookSettings();
    return settings.calculationSettings?.enableIterativeCalculation ?? false;
  }

  async setIterativeCalculation(enabled: boolean): Promise<void> {
    this._ensureWritable('workbook.setIterativeCalculation');
    await this.setSettings({
      calculationSettings: await this.mergeCalculationSettings({
        enableIterativeCalculation: enabled,
      }),
    });
  }

  async setMaxIterations(n: number): Promise<void> {
    this._ensureWritable('workbook.setMaxIterations');
    await this.setSettings({
      calculationSettings: await this.mergeCalculationSettings({ maxIterations: n }),
    });
  }

  async setConvergenceThreshold(threshold: number): Promise<void> {
    this._ensureWritable('workbook.setConvergenceThreshold');
    await this.setSettings({
      calculationSettings: await this.mergeCalculationSettings({ maxChange: threshold }),
    });
  }

  async getUsePrecisionAsDisplayed(): Promise<boolean> {
    const settings = await this.ctx.computeBridge.getWorkbookSettings();
    return !(settings.calculationSettings?.fullPrecision ?? true);
  }

  async setUsePrecisionAsDisplayed(value: boolean): Promise<void> {
    this._ensureWritable('workbook.setUsePrecisionAsDisplayed');
    await this.setSettings({
      calculationSettings: await this.mergeCalculationSettings({ fullPrecision: !value }),
    });
  }

  private async mergeCalculationSettings(
    patch: Partial<NonNullable<WorkbookSettings['calculationSettings']>>,
  ): Promise<NonNullable<WorkbookSettings['calculationSettings']>> {
    const settings = await this.ctx.computeBridge.getWorkbookSettings();
    return {
      ...DEFAULT_CALCULATION_SETTINGS,
      ...settings.calculationSettings,
      ...patch,
    };
  }

  // ===========================================================================
  // Chart Data Point Tracking (OfficeJS Workbook #44)
  // ===========================================================================

  async getChartDataPointTrack(): Promise<boolean> {
    const settings = await this.ctx.computeBridge.getWorkbookSettings();
    return (settings as WorkbookSettings).chartDataPointTrack ?? true;
  }

  async setChartDataPointTrack(value: boolean): Promise<void> {
    this._ensureWritable('workbook.setChartDataPointTrack');
    await this.setSettings({ chartDataPointTrack: value });
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on<K extends keyof import('@mog-sdk/contracts/api').WorkbookEventMap>(
    event: K,
    handler: (event: import('@mog-sdk/contracts/api').WorkbookEventMap[K]) => void,
  ): CallableDisposable;
  on<T extends InternalEventType>(
    event: T,
    handler: (event: EventByType<T>) => void,
  ): CallableDisposable;
  on(event: string, handler: (event: unknown) => void): CallableDisposable;
  on(event: string, handler: (event: any) => void): CallableDisposable {
    // Check if this is a coarse WorkbookEvent
    const workbookInternalTypes = EVENT_TO_INTERNAL[event];
    if (workbookInternalTypes) {
      const unsubs: Array<() => void> = [];
      for (const internalType of workbookInternalTypes) {
        unsubs.push(this.eventBus.on(internalType, handler));
      }
      return toDisposable(() => {
        for (const u of unsubs) u();
      });
    }

    // Warn on unknown event names that aren't fine-grained internal types
    if (typeof event === 'string' && !event.includes(':') && !(event in EVENT_TO_INTERNAL)) {
      console.warn(
        `[Workbook.on] Unknown event "${event}". ` +
          `Known coarse events: ${Object.keys(EVENT_TO_INTERNAL).join(', ')}. ` +
          `For fine-grained events use internal type strings (e.g. "sheet:created").`,
      );
    }

    // Fine-grained event type string — pass through directly to the event bus
    return toDisposable(this.eventBus.on(event, handler));
  }

  emit(event: InternalSpreadsheetEvent): void {
    this.eventBus.emit(event);
  }

  /** Subscribe to multiple events at once. Returns a single unsubscribe function. */
  onMany(events: string[], handler: (event: InternalSpreadsheetEvent) => void): () => void {
    const unsubs = events.map((e) => this.on(e, handler as (event: any) => void));
    return () => {
      for (const u of unsubs) u();
    };
  }

  // ===========================================================================
  // Undo Plumbing
  // ===========================================================================

  setPendingUndoDescription(description: string): void {
    // Delegate to undo service — ctx.setPendingUndoDescription() is a dead variable
    this.ctx.services?.undo.setNextDescription(description);
  }

  setPendingSelectionCheckpoint(checkpoint: SelectionCheckpoint): void {
    this.ctx.setPendingSelectionCheckpoint(checkpoint);
  }

  // ===========================================================================
  // Floating Objects
  // ===========================================================================

  get floatingObjects(): IFloatingObjectManager {
    return this._floatingObjectManager;
  }

  /**
   * Get the concrete SpreadsheetObjectManager instance.
   * @internal Used by WorksheetImpl to pass to operation files (IFloatingObjectManager).
   */
  getFloatingObjectManager(): SpreadsheetObjectManager {
    return this._floatingObjectManager;
  }

  // ===========================================================================
  // Bridge Sub-Interfaces
  // ===========================================================================

  get pivot(): IPivotBridge {
    return this.ctx.pivot;
  }

  get charts(): IChartBridge {
    return this.ctx.charts;
  }

  get services(): IKernelServices {
    if (!this.ctx.services) {
      throw new KernelError('COMPUTE_ERROR', 'Kernel services not available');
    }
    return this.ctx.services;
  }

  // ===========================================================================
  // Records API (table-aware CRUD for view adapters/containers)
  // ===========================================================================

  private _records: IRecordsAPI | null = null;

  get records(): IRecordsAPI {
    if (!this._records) {
      const ctx = this.ctx;
      this._records = {
        get: (tableId: string, rowId: string) =>
          Records.get(ctx, tableId, toSpreadsheetRowId(rowId)),
        query: (tableId: string, filter?: FilterExpression) => Records.query(ctx, tableId, filter),
        getFieldValue: (tableId: string, rowId: string, fieldId: string) =>
          Records.getFieldValue(ctx, tableId, toSpreadsheetRowId(rowId), fieldId),
        getFieldByName: (tableId: string, rowId: string, fieldName: string) =>
          Records.getFieldByName(ctx, tableId, toSpreadsheetRowId(rowId), fieldName),
        create: (tableId: string, values: RecordValues) =>
          Records.create(ctx, tableId, values) as Promise<string>,
        update: (tableId: string, rowId: string, changes: Partial<RecordValues>) =>
          Records.update(ctx, tableId, toSpreadsheetRowId(rowId), changes),
        remove: (tableId: string, rowId: string) =>
          Records.remove(ctx, tableId, toSpreadsheetRowId(rowId)),
      };
    }
    return this._records;
  }

  // ===========================================================================
  // Code Execution
  // ===========================================================================

  async executeCode(code: string, options?: ExecuteOptions): Promise<CodeResult> {
    this._ensureNotDisposed();
    this._ensureWritable('workbook.executeCode');
    const executor = this._getExecutor();
    const result = await executor.execute(code, {
      timeout: options?.timeout,
    });

    return {
      success: result.status === 'success',
      output: result.logs?.join('\n'),
      error: result.error ?? undefined,
      diagnostics: result.diagnostics,
      duration: result.timing?.total,
    };
  }

  // ===========================================================================
  // Introspection
  // ===========================================================================

  async getWorkbookSnapshot(): Promise<WorkbookSnapshot> {
    return getSnapshot(this.ctx, () => this.getActiveSheetId());
  }

  getFunctionCatalog(): FunctionInfo[] {
    return getCatalog();
  }

  getFunctionInfo(name: string): FunctionInfo | null {
    return getInfo(name) ?? null;
  }

  async describeRanges(
    requests: SheetRangeRequest[],
    includeStyle: boolean = true,
  ): Promise<SheetRangeDescribeResult[]> {
    const MAX_BATCH_RANGES = 20;
    if (requests.length > MAX_BATCH_RANGES) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Too many ranges: ${requests.length} exceeds limit of ${MAX_BATCH_RANGES}`,
      );
    }

    // Build bridge requests — parse A1 ranges to numeric bounds
    const bridgeRequests = requests.map((r) => {
      if (!r.range) {
        return { sheetName: r.sheet };
      }
      const parsed = parseCellRange(r.range);
      if (!parsed) {
        return { sheetName: r.sheet }; // invalid range syntax — auto-detect used range
      }
      return {
        sheetName: r.sheet,
        startRow: parsed.startRow,
        startCol: parsed.startCol,
        endRow: parsed.endRow,
        endCol: parsed.endCol,
      };
    });

    // Single IPC call for all main data
    const response = await this.ctx.computeBridge.queryRanges(bridgeRequests);

    // Process each entry
    const results: SheetRangeDescribeResult[] = [];
    for (let i = 0; i < requests.length; i++) {
      const entry = response.entries[i];

      if (entry.status === 'error') {
        results.push({
          sheet: requests[i].sheet,
          range: requests[i].range ?? '',
          description: '',
          error: entry.message,
        });
        continue;
      }

      // entry is Ok(BatchRangeResult) — has sheetId, sheetName, startRow, etc., result
      const batchResult = entry;
      const bounds = {
        startRow: batchResult.startRow,
        startCol: batchResult.startCol,
        endRow: batchResult.endRow,
        endCol: batchResult.endCol,
      };

      const rangeStr = `${toA1(bounds.startRow, bounds.startCol)}:${toA1(bounds.endRow, bounds.endCol)}`;

      // Reuse the shared formatting function (includes context fetching via IPC)
      const description = await formatDescribeRange(
        this.ctx as DocumentContext,
        sheetId(batchResult.sheetId),
        batchResult.result,
        bounds,
        includeStyle,
      );

      results.push({
        sheet: batchResult.sheetName,
        range: rangeStr,
        description,
      });
    }

    return results;
  }

  // ===========================================================================
  // Import / Export
  // ===========================================================================

  async toXlsx(options?: { contextStripped?: boolean }): Promise<Uint8Array> {
    this._ensureNotDisposed();
    await this.ctx.awaitMaterialized?.('allSheets');

    // Host-backed path: export requires authorization through the operation gate.
    const gate = this.ctx.operationGate;
    if (gate !== NO_HOST_OPERATION_GATE) {
      const exportPathId = 'workbook.toXlsx';
      const destination = 'download';
      const format = 'xlsx';
      const highWaterMark = this.ctx.writeGate.captureHighWaterMark();
      const rawMaterializationProof = {
        source: 'rust-policy-engine' as const,
        decisionId: `raw-export-${Date.now()}`,
        sessionId: `kernel-export-${Date.now()}`,
        principalFingerprint: createHostCanonicalFingerprint({
          exportPathId,
          format,
          principal: 'active-kernel-session',
        }),
        resourceContextFingerprint: createHostCanonicalFingerprint({
          exportPathId,
          format,
          destination,
        }),
        target: 'raw-document-materialization' as const,
        scope: 'entire-document' as const,
        effectiveLevel: 'raw-materialize' as const,
        childPolicyResolution: 'all-materialized-targets-raw-authorized' as const,
        correlationId: `export-${Date.now()}`,
        issuedAt: Date.now(),
      };
      const contentPolicy: HostExportContentPolicy = {
        kind: 'authorized-raw-snapshot',
        rawMaterializationProof,
      };
      const proofPayload = {
        source: 'kernel-write-gate',
        mutationWatermark: String(highWaterMark.mutationWatermark),
        exportPathId,
        format,
        destination,
        requestedExportSinkRefs: [],
        contentPolicy,
      };
      const documentHighWaterMark: KernelDocumentHighWaterMarkProof = {
        source: 'kernel-write-gate',
        proofId: `export-proof-${Date.now()}`,
        registryId: 'kernel-workbook-export',
        sessionId: rawMaterializationProof.sessionId,
        resourceContextFingerprint: rawMaterializationProof.resourceContextFingerprint,
        mutationWatermark: String(highWaterMark.mutationWatermark),
        exportPathId,
        format,
        contentPolicyFingerprint: createHostCanonicalFingerprint(contentPolicy),
        destination,
        requestedExportSinkRefs: [],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30_000,
        coveredFields: [
          'proofId',
          'registryId',
          'sessionId',
          'resourceContextFingerprint',
          'mutationWatermark',
          'exportPathId',
          'format',
          'contentPolicyFingerprint',
          'destination',
          'requestedExportSinkRefs',
          'issuedAt',
          'expiresAt',
        ],
        canonicalPayloadHash: createHostCanonicalFingerprint(proofPayload),
        verification: {
          kind: 'live-kernel-write-gate-registry',
          registryId: 'kernel-workbook-export',
        },
      };
      await gate.authorizeExport({
        format,
        destination,
        exportPathId,
        documentHighWaterMark,
        requestedExportSinkRefs: [],
        contentPolicy,
      });
    }

    const bridge = this.ctx.computeBridge as typeof this.ctx.computeBridge & {
      exportToXlsxBytesContextStripped?: () => Promise<Uint8Array>;
    };
    if (options?.contextStripped) {
      if (!bridge.exportToXlsxBytesContextStripped) {
        throw new Error('context-stripped XLSX export is not available on this compute bridge');
      }
      return bridge.exportToXlsxBytesContextStripped();
    }
    return this.ctx.computeBridge.exportToXlsxBytes();
  }

  async insertWorksheets(
    data: string | Uint8Array,
    options?: InsertWorksheetOptions,
  ): Promise<string[]> {
    this._ensureWritable('workbook.insertWorksheets');
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      // Decode base64 to Uint8Array
      const binaryString = atob(data);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } else {
      bytes = data;
    }

    const insertPosition = await this._resolveInsertPosition(options);
    const insertedNames = await this.ctx.computeBridge.importSheetsFromXlsx(
      bytes,
      options?.sheetNamesToInsert ?? [],
      insertPosition,
    );
    await this.refreshSheetMetadata();
    return insertedNames;
  }

  private async _resolveInsertPosition(options?: InsertWorksheetOptions): Promise<number | null> {
    if (!options?.positionType || options.positionType === 'end') return null;

    switch (options.positionType) {
      case 'beginning':
        return 0;
      case 'before':
      case 'after': {
        if (!options.relativeTo) {
          throw new KernelError(
            'COMPUTE_ERROR',
            `'relativeTo' is required when positionType is '${options.positionType}'`,
          );
        }
        const ws = await this.getSheet(options.relativeTo);
        const idx = ws.getIndex();
        return options.positionType === 'before' ? idx : idx + 1;
      }
      default:
        return null;
    }
  }

  async captureScreenshot(
    sheet: Worksheet | string,
    range: string,
    options?: ScreenshotOptions,
  ): Promise<Uint8Array> {
    const sheetName = typeof sheet === 'string' ? sheet : sheet.name;
    const sid = await this._resolveTarget(sheetName);
    const parsed = parseCellRange(range);
    if (!parsed) {
      throw new KernelError('API_INVALID_ADDRESS', `Invalid cell range: "${range}"`, {
        context: { range },
      });
    }
    return this.ctx.computeBridge.captureScreenshot(
      sid,
      parsed.startRow,
      parsed.startCol,
      parsed.endRow,
      parsed.endCol,
      options?.dpr ?? 1,
      options?.showHeaders ?? true,
      options?.showGridlines ?? true,
      options?.maxWidth ?? null,
      options?.maxHeight ?? null,
    );
  }

  // ===========================================================================
  // Cross-workbook
  // ===========================================================================

  async copyRangeFrom(
    source: Workbook,
    fromRange: string,
    toRange: string,
    options?: { fromSheet?: string | Worksheet; toSheet?: string | Worksheet },
  ): Promise<void> {
    this._ensureWritable('workbook.copyRangeFrom');
    // Resolve source sheet
    let sourceSheet: Worksheet;
    if (options?.fromSheet) {
      sourceSheet =
        typeof options.fromSheet === 'string'
          ? await source.getSheet(options.fromSheet)
          : options.fromSheet;
    } else {
      sourceSheet = source.activeSheet;
    }

    // Resolve target sheet
    let targetSheet: Worksheet;
    if (options?.toSheet) {
      targetSheet =
        typeof options.toSheet === 'string'
          ? await this.getSheet(options.toSheet)
          : options.toSheet;
    } else {
      targetSheet = this.activeSheet;
    }

    const srcBounds = parseCellRange(fromRange);
    const tgtBounds = parseCellRange(toRange);
    if (!srcBounds) throw new KernelError('COMPUTE_ERROR', `Invalid source range: "${fromRange}"`);
    if (!tgtBounds) throw new KernelError('COMPUTE_ERROR', `Invalid target range: "${toRange}"`);

    const srcData = await sourceSheet.getRange(fromRange);

    await this.undoGroup(async () => {
      // Write values/formulas cell by cell (formulas start with '=' and
      // are parsed by Rust automatically via setCell)
      for (let r = 0; r < srcData.length; r++) {
        for (let c = 0; c < srcData[r].length; c++) {
          const cell = srcData[r][c];
          if (!cell) continue;
          const targetRow = tgtBounds.startRow + r;
          const targetCol = tgtBounds.startCol + c;
          const rawValue = cell.formula ?? cell.value ?? null;
          if (rawValue !== null) {
            // CellError objects can't be written directly — skip error cells
            // (they'll be recomputed if we're copying the formula)
            const writeValue =
              typeof rawValue === 'object' &&
              rawValue !== null &&
              'type' in rawValue &&
              (rawValue as any).type === 'error'
                ? null
                : rawValue;
            if (writeValue !== null) {
              await targetSheet.setCell(targetRow, targetCol, writeValue as CellValuePrimitive);
            }
          }
          // Copy format if present
          if (cell.format) {
            await targetSheet.formats.set(targetRow, targetCol, cell.format);
          }
        }
      }
    });
  }

  // ===========================================================================
  // Utilities (sync)
  // ===========================================================================

  indexToAddress(row: number, col: number): string {
    return toA1(row, col);
  }

  addressToIndex(address: string): { row: number; col: number } {
    const parsed = parseCellAddress(address);
    if (!parsed) {
      throw new KernelError('COMPUTE_ERROR', `Invalid cell address: "${address}"`);
    }
    return { row: parsed.row, col: parsed.col };
  }

  union(...ranges: string[]): string {
    if (ranges.length === 0) {
      throw new KernelError('COMPUTE_ERROR', 'union() requires at least one range');
    }
    for (const r of ranges) {
      if (!parseCellRange(r)) {
        throw new KernelError('COMPUTE_ERROR', `Invalid range address: "${r}"`);
      }
    }
    return ranges.join(',');
  }

  // ===========================================================================
  // Culture & Locale
  // ===========================================================================

  async getCultureInfo(): Promise<CultureInfo> {
    if (this._cachedCultureInfo) return this._cachedCultureInfo;
    const settings = await this.ctx.computeBridge.getWorkbookSettings();
    const cultureTag = settings.culture ?? 'en-US';
    const { getCulture } = await import('@mog/culture');
    this._cachedCultureInfo = getCulture(cultureTag);
    return this._cachedCultureInfo;
  }

  async getDecimalSeparator(): Promise<string> {
    const culture = await this.getCultureInfo();
    return culture.decimalSeparator;
  }

  async getThousandsSeparator(): Promise<string> {
    const culture = await this.getCultureInfo();
    return culture.thousandsSeparator;
  }

  async searchAllSheets(
    patterns: string[],
    options?: SearchOptions,
  ): Promise<Array<SearchResult & { sheetName: string }>> {
    let rangeBounds:
      | { startRow: number; startCol: number; endRow: number; endCol: number }
      | undefined;
    if (options?.range) {
      const { parseCellRange } = await import('@mog/spreadsheet-utils/a1');
      const parsed = parseCellRange(options.range);
      if (parsed) rangeBounds = parsed;
    }
    const result = await this.ctx.computeBridge.regexSearchAllSheets({
      patterns,
      caseSensitive: options?.matchCase ?? false,
      wholeCell: options?.entireCell ?? false,
      includeFormulas: options?.searchFormulas ?? false,
      ...rangeBounds,
    });
    return result.matches.map((m) => ({
      address: m.address,
      value: m.value,
      sheetName: m.sheetName,
    }));
  }

  // ===========================================================================
  // Workbook Settings
  // ===========================================================================

  async getSettings(): Promise<WorkbookSettings> {
    // route through `ctx.mirror` — no Rust IPC.
    // The mirror is populated by `MutationResultHandler.applyAndNotify`
    // (incl. hydration's first MutationResult per `mutation-result-coverage-rust.md`),
    // so this read is correct on first paint.
    return this.ctx.mirror.getWorkbookSettings();
  }

  async setSettings(updates: WorkbookSettingsPatch): Promise<void> {
    this._ensureWritable('workbook.setSettings');
    this._cachedCalcMode = null;
    this._cachedCultureInfo = null;
    // For workbook-level state mirror reads: workbook
    // settings now ride the MutationResult.workbookSettingsChanges channel.
    // The TS-side manual re-read + per-key emit that lived here was removed
    // when the Rust contract (commit 8747f39e3) shipped per-key change
    // metadata; MutationResultHandler.handleWorkbookSettingsChanges is the
    // single emission point. Per ARCHITECTURE-CHECKLIST §14 — replace the
    // old emission path with the new normalized one in the same change.
    await this.ctx.computeBridge.patchWorkbookSettings(updates);
  }

  async replaceSettings(settings: WorkbookSettings): Promise<void> {
    this._ensureWritable('workbook.replaceSettings');
    this._cachedCalcMode = null;
    this._cachedCultureInfo = null;
    await this.ctx.computeBridge.setWorkbookSettings(toComputeWorkbookSettings(settings));
  }

  async getCustomLists(): Promise<readonly CustomList[]> {
    const { getCustomLists } = await import('../../domain/workbook/workbook');
    return getCustomLists(this.ctx);
  }

  async addCustomList(input: WorkbookCustomListInput): Promise<CustomList> {
    this._ensureWritable('workbook.addCustomList');
    const { addCustomList } = await import('../../domain/workbook/workbook');
    return addCustomList(this.ctx, input.name, [...input.values]);
  }

  async updateCustomList(id: string, updates: WorkbookCustomListUpdate): Promise<boolean> {
    this._ensureWritable('workbook.updateCustomList');
    const { updateCustomList } = await import('../../domain/workbook/workbook');
    return updateCustomList(this.ctx, id, {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.values !== undefined ? { values: [...updates.values] } : {}),
    });
  }

  async deleteCustomList(id: string): Promise<boolean> {
    this._ensureWritable('workbook.deleteCustomList');
    const { deleteCustomList } = await import('../../domain/workbook/workbook');
    return deleteCustomList(this.ctx, id);
  }

  async setCustomLists(lists: readonly WorkbookCustomListInput[]): Promise<void> {
    this._ensureWritable('workbook.setCustomLists');
    const { replaceCustomLists } = await import('../../domain/workbook/workbook');
    await replaceCustomLists(
      this.ctx,
      lists.map((list) => ({ name: list.name, values: [...list.values] })),
    );
  }

  // ===========================================================================
  // Custom Settings (arbitrary KV store)
  // ===========================================================================

  async getCustomSetting(key: string): Promise<string | null> {
    return (await this.ctx.computeBridge.getCustomSetting(key)) ?? null;
  }

  async setCustomSetting(key: string, value: string): Promise<void> {
    this._ensureWritable('workbook.setCustomSetting');
    await this.ctx.computeBridge.setCustomSetting(key, value);
  }

  async deleteCustomSetting(key: string): Promise<void> {
    this._ensureWritable('workbook.deleteCustomSetting');
    await this.ctx.computeBridge.setCustomSetting(key, null);
  }

  async listCustomSettings(): Promise<Array<{ key: string; value: string }>> {
    const pairs = await this.ctx.computeBridge.listCustomSettings();
    return pairs.map(([key, value]: [string, string]) => ({ key, value }));
  }

  async getCustomSettingCount(): Promise<number> {
    const settings = await this.listCustomSettings();
    return settings.length;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async save(path?: string): Promise<Uint8Array> {
    this._ensureNotDisposed();
    const buffer = await this.toXlsx();
    if (path) {
      if (!this._writeFile) {
        throw new KernelError(
          'API_UNSUPPORTED_OPERATION',
          'Workbook.save(path) requires a platform-provided file writer in this runtime',
        );
      }
      await this._writeFile(path, buffer);
    }
    if (this._onSave) {
      await this._onSave(buffer);
    }
    this.markClean();
    return buffer;
  }

  async close(closeBehavior?: 'save' | 'skipSave'): Promise<void> {
    if (closeBehavior === 'save') {
      await this.save();
    }
    this.dispose();
  }

  get isDisposed(): boolean {
    return this._disposed || this._liveness.isDisposed;
  }

  get importWarnings(): readonly DocumentImportWarning[] {
    return this._importWarnings;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._liveness.invalidate({
      operation: 'workbook.dispose',
      message: 'Workbook is closed or disposed. Create a new workbook to continue.',
    });

    // Dispose all tracked child handles (viewport regions, subscriptions, etc.)
    this._disposables.dispose();

    if (this.codeExecutor) {
      this.codeExecutor.dispose();
      this.codeExecutor = null;
    }

    this._floatingObjectManager.dispose();

    // Dispose all cached WorksheetImpl instances (cleans up CellMetadataCache,
    // ConditionalFormatCache, viewport readers)
    for (const ws of this._worksheetInstances.values()) {
      ws.dispose();
    }
    this._worksheetInstances.clear();

    // Clear checkpoint manager state
    this.checkpointManager.clear();

    // Clear form control manager state if it was lazily created
    if (this._formControlManager) {
      this._formControlManager.clear();
      this._formControlManager = undefined;
    }
  }

  // ===========================================================================
  // Workbook-Only Context
  // ===========================================================================

  createCalculatorContext(sheetId: SheetId): unknown {
    return { sheetId };
  }

  get ink(): IInkRecognitionBridge | null {
    return this.ctx.inkRecognition ?? null;
  }

  recalculateAll(_sheetId: SheetId, _origin: string = 'user'): void {
    // No-op: all recalculation handled by Rust compute-core
  }

  recalculateSheet(_sheetId: SheetId, _origin: string = 'user'): void {
    // No-op: all recalculation handled by Rust compute-core
  }

  // ===========================================================================
  // Sub-API namespaces (lazy initialization)
  // ===========================================================================

  private _sheets?: WorkbookSheetsImpl;
  get sheets(): WorkbookSheets {
    this._ensureNotDisposed();
    return (this._sheets ??= new WorkbookSheetsImpl({
      ctx: this.ctx,
      resolveTarget: (t) => this._resolveTarget(t) as Promise<SheetId>,
      getSheetName: (id) => getName(this.ctx, id),
      getSheetCount: () => this.getSheetCount(),
      setActiveSheetId: (id) => this.stateProvider.setActiveSheetId(id),
      workbook: this as Workbook,
    }));
  }

  private _slicers?: WorkbookSlicersImpl;
  get slicers(): WorkbookSlicers {
    return (this._slicers ??= new WorkbookSlicersImpl({
      ctx: this.ctx,
      getWorksheetSlicers: (sheetId) => this._getOrCreateWorksheet(sheetId).slicers,
    }));
  }

  private _slicerStyles?: WorkbookSlicerStylesImpl;
  get slicerStyles(): WorkbookSlicerStyles {
    return (this._slicerStyles ??= new WorkbookSlicerStylesImpl({
      ctx: this.ctx,
    }));
  }

  private _timelineStyles?: WorkbookTimelineStylesImpl;
  get timelineStyles(): WorkbookTimelineStyles {
    return (this._timelineStyles ??= new WorkbookTimelineStylesImpl({
      ctx: this.ctx,
    }));
  }

  private _pivotTableStyles?: WorkbookPivotTableStylesImpl;
  get pivotTableStyles(): WorkbookPivotTableStyles {
    return (this._pivotTableStyles ??= new WorkbookPivotTableStylesImpl(this.ctx));
  }

  private _functions?: WorkbookFunctionsImpl;
  get functions(): WorkbookFunctions {
    return (this._functions ??= new WorkbookFunctionsImpl(this.ctx, () => this.getActiveSheetId()));
  }

  private _names?: WorkbookNamesImpl;
  get names(): WorkbookNames {
    return (this._names ??= new WorkbookNamesImpl({
      ctx: this.ctx,
      getActiveSheetId: () => this.getActiveSheetId(),
      resolveSheetNameToId: (nameLower) => this._resolveSheetNameToId(nameLower),
      getSheetName: (id) => getName(this.ctx, id),
    }));
  }

  private _scenarios?: WorkbookScenariosImpl;
  get scenarios(): WorkbookScenarios {
    return (this._scenarios ??= new WorkbookScenariosImpl({
      ctx: this.ctx,
      getActiveSheetId: () => this.getActiveSheetId(),
      getSheetOrder: () => getOrder(this.ctx),
      getSheetName: (id) => getName(this.ctx, id),
      resolveSheetNameToId: (nameLower) => this._resolveSheetNameToId(nameLower),
    }));
  }

  private _history?: WorkbookHistoryImpl;
  get history(): WorkbookHistory {
    return (this._history ??= new WorkbookHistoryImpl({
      ctx: this.ctx,
      refreshSheetMetadata: () => this.refreshSheetMetadata(),
    }));
  }

  private _tableStyles?: WorkbookTableStylesImpl;
  get tableStyles(): WorkbookTableStyles {
    return (this._tableStyles ??= new WorkbookTableStylesImpl(this.ctx));
  }

  private _cellStyles?: WorkbookCellStylesImpl;
  get cellStyles(): WorkbookCellStyles {
    return (this._cellStyles ??= new WorkbookCellStylesImpl(this.ctx));
  }

  private _properties?: WorkbookPropertiesImpl;
  get properties(): WorkbookProperties {
    return (this._properties ??= new WorkbookPropertiesImpl(this.ctx));
  }

  private _protection?: WorkbookProtectionImpl;
  get protection(): WorkbookProtection {
    return (this._protection ??= new WorkbookProtectionImpl(this.ctx));
  }

  private _security?: WorkbookSecurityImpl;
  get security(): WorkbookSecurity {
    this._ensureNotDisposed();
    return (this._security ??= new WorkbookSecurityImpl(this.ctx));
  }

  // Session-level principal API for the
  // "method not sub-API" rationale.

  async setActivePrincipal(principal: string[] | AccessPrincipal | null): Promise<void> {
    // Host-backed workbooks have immutable principals — the principal was
    // projected from the verified host identity at construction time and
    // must not be mutated by ordinary consumers.
    if (this.ctx.operationGate !== NO_HOST_OPERATION_GATE) {
      throw new OperationDeniedError(
        'setActivePrincipal',
        'HOST_PRINCIPAL_IMMUTABLE',
        'setActivePrincipal() is not available on host-backed workbooks. ' +
          'The principal was set during host construction and cannot be changed.',
      );
    }

    const tagsOrNull =
      principal === null ? null : Array.isArray(principal) ? principal : principal.tags;
    await this.ctx.computeBridge.setActivePrincipal(
      tagsOrNull === null ? null : { tags: tagsOrNull },
    );
  }

  async activePrincipal(): Promise<AccessPrincipal | null> {
    return this.ctx.computeBridge.activePrincipal();
  }

  async securityActive(): Promise<boolean> {
    return this.ctx.computeBridge.securityActive();
  }

  async makePrincipal(tags: string[]): Promise<AccessPrincipal> {
    if (this.ctx.operationGate !== NO_HOST_OPERATION_GATE) {
      throw new OperationDeniedError(
        'makePrincipal',
        'HOST_PRINCIPAL_IMMUTABLE',
        'makePrincipal() is not available on host-backed workbooks. ' +
          'Principal management is controlled by the host.',
      );
    }
    return this.ctx.computeBridge.makePrincipal(tags);
  }

  private _notifications?: WorkbookNotificationsImpl;
  get notifications(): WorkbookNotifications {
    if (!this._notifications) {
      if (!this.ctx.services) {
        throw new KernelError('COMPUTE_ERROR', 'Kernel services not available');
      }
      this._notifications = new WorkbookNotificationsImpl(this.ctx.services.notifications);
    }
    return this._notifications;
  }

  private _theme?: WorkbookThemeImpl;
  get theme(): WorkbookTheme {
    return (this._theme ??= new WorkbookThemeImpl(
      { ctx: this.ctx, eventBus: this.eventBus },
      DEFAULT_CHROME_THEME,
    ));
  }

  private _viewport?: WorkbookViewportImpl;
  get viewport(): WorkbookViewport {
    return (this._viewport ??= new WorkbookViewportImpl(this.ctx.computeBridge, this._disposables));
  }

  private _changes?: WorkbookChangesImpl;
  get changes(): WorkbookChanges {
    this._ensureNotDisposed();
    return (this._changes ??= new WorkbookChangesImpl(this.ctx, this._liveness));
  }

  get diagnostics(): WorkbookDiagnostics {
    return (this._diagnostics ??= new WorkbookDiagnosticsImpl(this.ctx));
  }

  get links(): WorkbookLinks {
    return (this._links ??= this.createWorkbookLinksPublicApi());
  }

  private createWorkbookLinksPublicApi(): WorkbookLinks {
    const service = this.ctx.workbookLinks;
    return {
      list: () => service.list(),
      get: (linkId) => service.get(linkId),
      add: (input) => service.create(input),
      create: (input) => service.create(input),
      retarget: (linkId, input) => service.update(linkId, input),
      update: (linkId, input) => service.update(linkId, input),
      break: (linkId, options) => service.break(linkId, options),
      delete: (linkId) => service.delete(linkId),
      getStatus: (linkId) => service.getStatus(linkId, this.workbookLinkScope()),
      refresh: (linkId) => service.refresh(linkId, this.workbookLinkScope()),
      refreshAll: (options) => service.refreshAll(this.workbookLinkScope(), options),
      watchStatus: (linkId, handler) =>
        service.watchStatus(linkId, this.workbookLinkScope(), handler),
      getUsages: (linkId) => service.getUsages(linkId),
      copySource: (linkId) => service.copySource(linkId, this.workbookLinkScope()),
      listPackageDiagnostics: () => service.listPackageDiagnostics(),
    };
  }

  private workbookLinkScope(): WorkbookLinkStatusScope {
    return this.ctx.workbookLinkScope();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a WorkbookImpl from a pre-existing WorkbookConfig.
 *
 * This is the power-user path where the caller provides a pre-existing kernel
 * context, event bus, and (optionally) active sheet callbacks.
 *
 * Exported so that `document-factory.ts` can consume it directly without going
 * through the overloaded `createWorkbook()` dispatcher — which would require
 * importing from `./create-workbook.ts`, which itself imports `document-factory`
 * (re-introducing the impl↔factory cycle).
 */
export async function createWorkbookFromConfig(config: WorkbookConfig): Promise<Workbook> {
  const wb = new WorkbookImpl(config);
  await wb._init();
  return wb;
}
