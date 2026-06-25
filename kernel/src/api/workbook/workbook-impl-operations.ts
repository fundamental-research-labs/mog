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
import {
  getTrackedExternalFormulas,
  materializeExternalFormulas,
} from '../../services/external-formulas';
import { createVersionMutationAdmissionOptions } from './version-operation-context';
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
import {
  applyWorkbookReadOnlyMode,
  createWorkbookFeatureGateBinder,
  createWorkbookStateProvider,
  type WorkbookFeatureGateBinder,
} from './workbook-construction-config';
import { createWorkbookCheckoutTransactionCoordinator } from './workbook-checkout-transactions';
import { createWorkbookLiveness } from './workbook-liveness';
import { resolveWorkbookImportWarnings } from './workbook-import-warnings';
import { withDefaultWorkbookCheckoutMaterializer } from './workbook-versioning-assembly';

import { DEFAULT_CHROME_THEME } from '@mog-sdk/contracts/rendering';
import { NO_HOST_OPERATION_GATE, OperationDeniedError } from '../../document/host-operation-gate';
import type {
  HostExportContentPolicy,
  KernelDocumentHighWaterMarkProof,
} from '@mog-sdk/types-host/kernel';
import { createHostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { HandleLiveness } from '../lifecycle/handle-liveness';

// =============================================================================
// WorkbookImpl Operations
// =============================================================================

import { WorkbookImplFoundation } from './workbook-impl-foundation';

export abstract class WorkbookImplOperations extends WorkbookImplFoundation {
  abstract setSettings(updates: WorkbookSettingsPatch): Promise<void>;

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
      const result = await fn(this as unknown as Workbook);
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
      const trackedExternalFormulas = getTrackedExternalFormulas(this.ctx);
      const externalMaterialized = await materializeExternalFormulas(
        this.ctx,
        trackedExternalFormulas.length > 0
          ? createVersionMutationAdmissionOptions(this.ctx, {
              operationIdPrefix: 'workbook.calculate.externalFormulas',
              sheetIds: [...new Set(trackedExternalFormulas.map((formula) => formula.sheetId))],
              domainIds: ['cells'],
            })
          : undefined,
      );
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

  // Records API (table-aware CRUD for view adapters/containers)
  // ===========================================================================

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
      mutationPolicy: options?.mutationPolicy ?? 'rollbackOnError',
    });

    return {
      success: result.status === 'success',
      output: result.logs?.join('\n'),
      error: result.error ?? undefined,
      diagnostics: result.diagnostics,
      mutationStatus: result.mutationStatus ?? 'unknown',
      changeCount: result.changeCount ?? 0,
      directCount: result.directCount ?? 0,
      indirectCount: result.indirectCount ?? 0,
      editRanges: result.editRanges ?? [],
      dirtyCells: result.dirtyCells ?? [],
      formattedSummary: result.formattedSummary,
      rollbackError: result.rollbackError,
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
        toSheetId(batchResult.sheetId),
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
}
