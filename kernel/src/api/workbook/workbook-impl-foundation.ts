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
  WorkbookXlsxExportOptions,
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
import {
  type CellValuePrimitive,
  sheetId as toSheetId,
  type SheetId,
} from '@mog-sdk/contracts/core';
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
import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';
import type { SnapshotRootFreshLifecycleMaterialization } from '../document/snapshot-root-lifecycle-hydrator';
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
import {
  attachWorkbookVersioning,
  attachWorkbookVersionSurfaceStatusService,
} from './version-wiring';
import { rebindVersioningAfterCheckout } from './version/checkout/version-checkout-rebind';
import { readVersionLiveCollaborationStatus } from './version/live-collaboration/version-live-collaboration-status';
import { readVersionPendingProviderWrites } from './version/pending/provider-writes';
import {
  getKnownSheetNames,
  resolveSheetNameToId as resolveWorkbookSheetNameToId,
  resolveSheetTarget,
} from './sheet-lookup';
import {
  createSaveCallbackFailedError,
  createSaveWriteFailedError,
  createSaveWriterUnavailableError,
  normalizeWorkbookSavePath,
} from './save-errors';
import { assertWorkbookXlsxExportDomainSupportManifest } from './export-errors';
import { removeMogVersionMetadataPackageInventoryFromXlsx } from './xlsx-clean-export-package';
import { maybeAddMogVersionMetadataToXlsx } from './version/xlsx-metadata/xlsx-version-metadata';
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
  WorkbookVersion,
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
import {
  WorkbookVersionWithDirtyTracking,
  type WorkbookVersionDirtyTrackingState,
} from './workbook-version-dirty-tracking';
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
import { WorkbookLinksImpl } from './links';
import { createWorkbookContextBinding, type WorkbookContextBinding } from './context-binding';
import { reconcileCheckoutActiveSheet } from './version/checkout/version-checkout-materializer-active-sheet';
import { createWorkbookVersionSurfaceStatusService } from './version/surface-status/version-surface-status-service';
import type { VersionSurfaceActiveCheckoutStateChanged } from './version/surface-status/version-surface-status-service';
import { shouldTrackEventAsWorkbookDirty } from './workbook-dirty-event-filter';
import {
  applyWorkbookReadOnlyMode,
  createWorkbookFeatureGateBinder,
  createWorkbookStateProvider,
  type WorkbookFeatureGateBinder,
} from './workbook-construction-config';
import { createWorkbookCheckoutTransactionCoordinator } from './workbook-checkout-transactions';
import { createWorkbookLiveness } from './workbook-liveness';
import { resolveWorkbookImportWarnings } from './workbook-import-warnings';
import {
  withDefaultWorkbookCheckoutMaterializer,
  withPreviouslySavedVersioningInitialization,
} from './workbook-versioning-assembly';

import { DEFAULT_CHROME_THEME } from '@mog-sdk/contracts/rendering';
import { NO_HOST_OPERATION_GATE, OperationDeniedError } from '../../document/host-operation-gate';
import type {
  HostExportContentPolicy,
  KernelDocumentHighWaterMarkProof,
} from '@mog-sdk/types-host/kernel';
import { createHostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { HandleLiveness } from '../lifecycle/handle-liveness';

// =============================================================================
// WorkbookImpl Foundation
// =============================================================================

export abstract class WorkbookImplFoundation {
  abstract get sheets(): WorkbookSheets;

  /**
   * Internal DocumentContext — cast from the public IKernelContext.
   * WorkbookImpl is kernel-internal code and knows the runtime type is always DocumentContext.
   */
  protected readonly ctx: DocumentContext;
  protected readonly contextBinding: WorkbookContextBinding;
  protected readonly stateProvider: WorkbookStateProvider;
  protected readonly eventBus: IEventBus;
  private readonly bindFeatureGates: WorkbookFeatureGateBinder;
  protected checkpointManager: ICheckpointManager;
  protected readonly _disposables = new DisposableStore();

  protected codeExecutor: CodeExecutorType | null = null;
  private codeExecutorFactory: CodeExecutorFactory | null = null;
  protected _formControlManager?: FormControlManager;
  protected _links?: WorkbookLinks;
  protected _diagnostics?: WorkbookDiagnosticsImpl;
  protected readonly _checkoutMaterializations =
    new Set<SnapshotRootFreshLifecycleMaterialization>();
  protected _dirty = false;
  protected _dirtyStatusSequence = 0;
  protected readonly checkoutTransactions = createWorkbookCheckoutTransactionCoordinator({
    readContext: () => this.ctx,
    isDirty: () => this._dirty,
  });
  private readonly versionSurfaceStatusService = createWorkbookVersionSurfaceStatusService({
    readDirtyState: () => ({
      hasUncommittedLocalChanges: this._dirty,
      calculationState: this._calculationState,
      checkoutInProgress: this.checkoutTransactions.checkoutInProgress,
      revision: this._dirtyStatusSequence,
      contextGeneration: this.contextBinding.generation,
    }),
    readPendingProviderWrites: () => readVersionPendingProviderWrites(this.ctx),
    readLiveCollaborationStatus: () => readVersionLiveCollaborationStatus(this.ctx),
    notifyActiveCheckoutStateChanged: (change) =>
      this.emitVersionActiveCheckoutStateChanged(change),
  });

  protected get _floatingObjectManager(): SpreadsheetObjectManager {
    return this.ctx.floatingObjectManager as SpreadsheetObjectManager;
  }

  // Instance cache for getSheetById() — returns the same WorksheetImpl for the same sheetId
  // to provide referential stability (prevents infinite re-render loops when used in React deps)
  protected _worksheetInstances: Map<SheetId, WorksheetImpl> = new Map();

  // Cached sheet metadata — populated by refreshSheetMetadata(), kept in sync on mutations
  protected _cachedSheetIds: SheetId[] = [];
  protected _cachedSheetNames: string[] = [];
  protected _cachedSheetCount: number = 0;

  private _sheetRuntimeAdapterRegistration: CallableDisposable | null = null;
  private _sheetRuntimeAdapterHandler: unknown = null;

  protected _calcSuspended = false;
  protected _calculationState: 'done' | 'calculating' | 'pending' = 'done';
  protected _cachedCalcMode: 'auto' | 'autoNoTable' | 'manual' | null = null;
  protected _cachedCultureInfo: CultureInfo | null = null;
  protected _records: IRecordsAPI | null = null;

  protected _sheets?: WorkbookSheetsImpl;
  protected _slicers?: WorkbookSlicersImpl;
  protected _slicerStyles?: WorkbookSlicerStylesImpl;
  protected _timelineStyles?: WorkbookTimelineStylesImpl;
  protected _pivotTableStyles?: WorkbookPivotTableStylesImpl;
  protected _functions?: WorkbookFunctionsImpl;
  protected _names?: WorkbookNamesImpl;
  protected _scenarios?: WorkbookScenariosImpl;
  protected _history?: WorkbookHistoryImpl;
  protected _version?: WorkbookVersion;
  protected _tableStyles?: WorkbookTableStylesImpl;
  protected _cellStyles?: WorkbookCellStylesImpl;
  protected _properties?: WorkbookPropertiesImpl;
  protected _protection?: WorkbookProtectionImpl;
  protected _security?: WorkbookSecurityImpl;
  protected _notifications?: WorkbookNotificationsImpl;
  protected _theme?: WorkbookThemeImpl;
  protected _viewport?: WorkbookViewportImpl;
  protected _changes?: WorkbookChangesImpl;

  // Platform state: whether the workbook was loaded from a previously saved source
  private readonly _previouslySaved: boolean;

  // Workbook properties (OfficeJS parity)
  readonly name: string;
  readonly readOnly: boolean;

  // Platform-provided save handler
  protected readonly _onSave?: (buffer: Uint8Array) => Promise<void>;
  protected readonly _writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  private readonly persistCheckoutMaterialization?: WorkbookConfig['persistCheckoutMaterialization'];

  // Track disposal
  protected _disposed = false;
  protected readonly _liveness: HandleLiveness;

  /**
   * Guard: throws a clean KernelError if the workbook has been disposed.
   * Called at the top of public methods to prevent stale sub-API instances
   * (sheets, charts, etc.) from hitting the invalidated transport.
   */
  protected _ensureNotDisposed(): void {
    this._liveness.assertLive('workbook');
    if (this._disposed) {
      throw this._liveness.error('workbook');
    }
  }

  /**
   * Guard: throws WriteGateError if the document is not writable.
   * Called at the top of public mutation methods (the write gate).
   */
  protected _ensureWritable(operation: string): void {
    this.ctx.writeGate.assertWritable(operation);
  }
  protected _importWarnings: readonly DocumentImportWarning[] = [];

  constructor(config: WorkbookConfig) {
    // Cast to DocumentContext — WorkbookImpl is internal kernel code and knows the runtime type
    this.bindFeatureGates = createWorkbookFeatureGateBinder(config);
    this.contextBinding = createWorkbookContextBinding(
      this.withWorkbookFeatureGates(config.ctx as DocumentContext),
    );
    this.ctx = this.contextBinding.context;
    // Platform state
    this._previouslySaved = config.previouslySaved ?? false;
    const versioning = withPreviouslySavedVersioningInitialization(
      withDefaultWorkbookCheckoutMaterializer(config.versioning, {
        currentContext: () => this.ctx,
        revalidateCheckoutPublish: (input) =>
          this.checkoutTransactions.revalidateCheckoutPublish(input),
        publishCheckoutMaterialization: (materialization, input) =>
          this.publishCheckoutMaterialization(materialization, input),
      }),
      {
        previouslySaved: this._previouslySaved,
        currentContext: () => this.ctx,
        markClean: () => this.markClean(),
      },
    );
    if (versioning) {
      attachWorkbookVersioning(this.ctx, {
        ...versioning,
        checkoutTransactionGuard: this.checkoutTransactions.guard,
      });
    }
    attachWorkbookVersionSurfaceStatusService(this.ctx, this.versionSurfaceStatusService);
    this._liveness = createWorkbookLiveness(config, this.ctx);

    // stateProvider is the single source of truth for active sheet + UI state.
    // When not provided, a default headless provider tracks activeSheetId internally
    // and returns null/empty for all UI queries. _init() populates the active sheet
    // to the first sheet when it's empty.
    this.stateProvider = createWorkbookStateProvider(config.stateProvider);

    this.eventBus = config.eventBus;
    this.checkpointManager = createCheckpointManager(
      this.ctx.computeBridge,
      this.ctx.services?.undo,
    );

    if (config.codeExecutorFactory) {
      this.codeExecutorFactory = config.codeExecutorFactory;
    }

    this.name = config.name ?? '';
    this.readOnly = config.readOnly ?? false;
    this._onSave = config.onSave;
    this._writeFile = config.writeFile;
    this._importWarnings = resolveWorkbookImportWarnings(config);
    this.persistCheckoutMaterialization = config.persistCheckoutMaterialization;

    // Write gate: if the workbook is opened read-only, lock the gate.
    applyWorkbookReadOnlyMode(this.ctx, this.readOnly);

    this.registerSheetRuntimeAdapter();

    // Subscribe to all events to track dirty state.
    const unsub = this.eventBus.onAll((event) => {
      if (!shouldTrackEventAsWorkbookDirty(event)) return;
      this.markDirty();
    });
    if (unsub) {
      this._disposables.track(toDisposable(unsub));
    }
  }

  private withWorkbookFeatureGates(ctx: DocumentContext): DocumentContext {
    return this.bindFeatureGates(ctx);
  }

  private async publishCheckoutMaterialization(
    materialization: SnapshotRootFreshLifecycleMaterialization,
    input: CheckoutSnapshotApplyInput,
  ): Promise<void> {
    const nextContext = materialization.context;
    const currentVersioning = (this.ctx as DocumentContext & { versioning?: unknown }).versioning;
    const nextVersioning = rebindVersioningAfterCheckout({
      versioning: currentVersioning,
      nextContext,
    });
    const mutableNextContext = nextContext as unknown as {
      eventBus: IEventBus;
      versioning?: unknown;
    };
    mutableNextContext.eventBus = this.eventBus;
    // The materialized lifecycle installed its mutation handler against its private bus.
    // Rebuild it after swapping to the stable workbook bus so post-checkout edits publish normally.
    nextContext.computeBridge.initMutationHandler();
    attachWorkbookVersioning(nextContext, nextVersioning);
    attachWorkbookVersionSurfaceStatusService(nextContext, this.versionSurfaceStatusService);

    await this.persistCheckoutMaterialization?.(materialization, input);
    this.contextBinding.publish(this.withWorkbookFeatureGates(nextContext));
    this.versionSurfaceStatusService.recordCheckoutMaterialization(input);
    this._checkoutMaterializations.add(materialization);
    this.resetRuntimeCachesAfterCheckoutPublish();
    await this.refreshSheetMetadata();
    await this.reconcileActiveSheetAfterCheckout();
    this.eventBus.emit({
      type: 'workbook:version-checkout-materialized',
      commitId: String(input.commitId),
      targetKind: input.resolvedTarget.kind,
      ...(input.resolvedTarget.kind === 'ref' || input.resolvedTarget.kind === 'head'
        ? { refName: String(input.resolvedTarget.refName) }
        : {}),
      timestamp: Date.now(),
    } satisfies InternalSpreadsheetEvent);
  }

  private resetRuntimeCachesAfterCheckoutPublish(): void {
    for (const ws of this._worksheetInstances.values()) {
      ws.dispose();
    }
    this._worksheetInstances.clear();
    this._cachedSheetIds = [];
    this._cachedSheetNames = [];
    this._cachedSheetCount = 0;
    this.setDirtyState(false);
    this._calcSuspended = false;
    this._calculationState = 'done';
    this._cachedCalcMode = null;
    this._cachedCultureInfo = null;

    if (this.codeExecutor) {
      this.codeExecutor.dispose();
      this.codeExecutor = null;
    }

    this._sheets = undefined;
    this._slicers = undefined;
    this._slicerStyles = undefined;
    this._timelineStyles = undefined;
    this._pivotTableStyles = undefined;
    this._functions = undefined;
    this._names = undefined;
    this._scenarios = undefined;
    this._history = undefined;
    this._version = undefined;
    this._tableStyles = undefined;
    this._cellStyles = undefined;
    this._properties = undefined;
    this._protection = undefined;
    this._security = undefined;
    this._theme = undefined;
    this._changes = undefined;

    this.checkpointManager.clear();
    this.checkpointManager = createCheckpointManager(
      this.ctx.computeBridge,
      this.ctx.services?.undo,
    );

    if (this._sheetRuntimeAdapterRegistration) {
      this._disposables.untrack(this._sheetRuntimeAdapterRegistration);
      this._sheetRuntimeAdapterRegistration.dispose();
      this._sheetRuntimeAdapterRegistration = null;
      this._sheetRuntimeAdapterHandler = null;
    }
    this.registerSheetRuntimeAdapter();

    this._records = null;
    this._links = undefined;
    this._diagnostics = undefined;
    this._viewport = undefined;
    this._notifications = undefined;
  }

  private async reconcileActiveSheetAfterCheckout(): Promise<void> {
    await reconcileCheckoutActiveSheet({ ctx: this.ctx, stateProvider: this.stateProvider });
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

  private markDirty(): void {
    if (this._dirty) {
      this._dirtyStatusSequence += 1;
      this.emitVersionDirtyStatusChanged(true, true);
      return;
    }
    this.setDirtyState(true);
  }

  private setDirtyState(next: boolean): void {
    if (this._dirty === next) return;
    const previous = this._dirty;
    this._dirty = next;
    this._dirtyStatusSequence += 1;
    this.emitVersionDirtyStatusChanged(next, previous);
  }

  private emitVersionDirtyStatusChanged(
    hasUncommittedLocalChanges: boolean,
    previousHasUncommittedLocalChanges: boolean,
  ): void {
    this.eventBus.emit({
      type: 'workbook:version-dirty-status-changed',
      hasUncommittedLocalChanges,
      previousHasUncommittedLocalChanges,
      statusRevision: this._dirtyStatusSequence,
      timestamp: Date.now(),
    } satisfies InternalSpreadsheetEvent);
  }

  private emitVersionActiveCheckoutStateChanged(
    change: VersionSurfaceActiveCheckoutStateChanged,
  ): void {
    this.eventBus.emit({
      type: 'workbook:version-active-checkout-state-changed',
      activeCheckoutSession: change.activeCheckoutSession,
      previousActiveCheckoutSession: change.previousActiveCheckoutSession,
      statusRevision: change.statusRevision,
      reason: change.reason,
      timestamp: Date.now(),
    } satisfies InternalSpreadsheetEvent);
  }

  markClean(): void {
    this.setDirtyState(false);
  }

  protected readVersionDirtyTrackingState(): WorkbookVersionDirtyTrackingState {
    return { isDirty: this._dirty, revision: this._dirtyStatusSequence };
  }

  protected markCleanIfDirtyRevisionUnchanged(revision: number): boolean {
    if (!this._dirty || this._dirtyStatusSequence !== revision) return false;
    this.markClean();
    return true;
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
    if (this._previouslySaved) {
      this.markClean();
    }
  }

  /**
   * Resolve a name or index to a sheetId. ASYNC — reads from Rust.
   * String = sheet name (display name), number = 0-based index.
   * Never pass a sheetId here — use getSheetById(sheetId) for direct ID access.
   */
  async _resolveTarget(target: number | string): Promise<SheetId> {
    return resolveSheetTarget(this.ctx, target);
  }

  /** Resolve a sheet name (case-insensitive) to its sheetId. ASYNC — reads from Rust. */
  protected async _resolveSheetNameToId(nameLower: string): Promise<SheetId | undefined> {
    return resolveWorkbookSheetNameToId(this.ctx, nameLower);
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

  protected _getExecutor(): CodeExecutorType {
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
    const activeId = toSheetId(this.stateProvider.getActiveSheetId());
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
      const order = this.ctx.mirror.getSheetIds();
      const index = this._cachedSheetIds.indexOf(sheetId);
      const mirrorIndex = order.indexOf(sheetId);
      const meta = this.ctx.mirror.getSheetMeta(sheetId);
      ws = new WorksheetImpl(sheetId, this.ctx, {
        workbook: this as unknown as Workbook,
        name:
          name ??
          (index >= 0 ? this._cachedSheetNames[index] : undefined) ??
          meta.name ??
          String(sheetId),
        index: index >= 0 ? index : mirrorIndex >= 0 ? mirrorIndex : undefined,
        visible: meta.hidden === undefined ? undefined : !meta.hidden,
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
    this._cachedSheetIds = [...order];
    this._cachedSheetNames = names;
    this._cachedSheetCount = order.length;
  }

  /** Get the current active sheet ID. Infrastructure-only (WorkbookInternal). */
  getActiveSheetId(): SheetId {
    return toSheetId(this.stateProvider.getActiveSheetId());
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
    return active ? toSheetId(active) : null;
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
    return activeSheet ? toSheetId(String(activeSheet)) : null;
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
}
