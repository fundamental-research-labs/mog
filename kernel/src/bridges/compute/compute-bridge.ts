/**
 * Compute Bridge - Connects the spreadsheet UI to the Rust compute core.
 *
 * Thin composition root. All logic lives in:
 * - ComputeCore (compute-core.ts): lifecycle, mutation pipeline, viewport, sync, events
 * - createBridgeMethods (compute-bridge.gen.ts): ~400 passthrough methods via transport
 *
 * This file is a ~200-line composition root that:
 * 1. Mixes in generated methods from createBridgeMethods() factory
 * 2. Delegates lifecycle/viewport/sync to ComputeCore
 * 3. Provides hand-written overrides for methods needing special logic
 * 4. Re-exports all types for backward compatibility
 */

import { asFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import {
  type CellFormat,
  type CellMetadata,
  type CellValue,
  type SheetId,
  sheetId as toSheetId,
} from '@mog-sdk/contracts/core';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { RawSecurityEvent } from '@mog-sdk/contracts/events';
import type { ViewportRefreshDetails } from '@mog-sdk/contracts/api';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { SheetProtectionOptions } from '@mog-sdk/contracts/protection';
import { DEFAULT_PROTECTION_OPTIONS } from '@mog-sdk/contracts/protection';
import type { PivotExpansionState } from '@mog-sdk/contracts/pivot';

import type { BridgeTransport } from '@rust-bridge/client';
import { createTransport, normalizeBytesTuple, TransportError } from '@mog/transport';
import type { TransportConfig, TrapError } from '@mog/transport';
import { MutationResultHandler } from '../mutation-result-handler';
import type { ReadonlyBinaryViewportBuffer } from '../wire/viewport-coordinator';
import type { CellMetadataCache } from '../wire/cell-metadata-cache';
import type { RangeMetadataCache } from '../wire/range-metadata-cache';
import type { ViewportPrefetchState, ViewportScrollBehavior } from '../wire/viewport-prefetch';
import { SHEET_META_DEFAULT_COL_WIDTH } from '../../domain/sheets/sheet-meta-defaults';
import {
  normalizeFloatingObjectForStorage,
  normalizeFloatingObjectUpdateForStorage,
} from './floating-object-geometry-normalization';
import {
  splitTableHeaderWritesForSetCells,
  type PositionedCellInput,
  type TableHeaderRename,
} from './table-header-write-intercept';
import { prepareVersionMutationCapture, type MutationAdmissionOptions } from './mutation-admission';
import type { AdmittedSyncApplyContext } from './sync-apply-admission';
import { assertStrictValidationAdmission } from './validation-admission';

export interface PivotCreateWithSheetOptions {
  insertBeforeSheetId?: SheetId;
  insertIndex?: number;
}

// Generated types — source of truth from Rust snapshot-types
import type {
  ActiveCellData,
  Axis,
  // Slicer types
  CacheInvalidationEventReason,
  CalculationSettings,
  CellChange,
  // Comment types
  Comment,
  CellData,
  CellDataBin,
  CellEdit,
  CellErrorInfo,
  CellIdRange,
  CellInput,
  // Validation/Schema types
  CellValidationResult,
  CfChange,
  CFIconSetPreset,
  CFPresetCategory,
  CFRule,
  ChangeKind,
  ColumnFilter,
  CommentChange,
  DataBounds,
  DateValueResult,
  DimensionChange,
  DisconnectionEventReason,
  ColumnSchema as DomainColumnSchema,
  EnforcementLevel,
  EnterKeyDirection,
  FilterChange,
  FilterRecordCount,
  FilterSortState,
  FilterState,
  FloatingObjectChange,
  GroupDefinition,
  GroupingChange,
  ImportDiagnostic as WireImportDiagnostic,
  MergeChange,
  MutationResult,
  SyncApplyMutationMetadataWire,
  RuntimeDiagnosticsOptions as WireRuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage as WireRuntimeDiagnosticsPage,
  RustWorkbookSettingsPatch,
  NamedRangeChange,
  OutlineLevel,
  OutlineLevelButton,
  OutlineRenderData,
  OutlineSettingsUpdate,
  OutlineSymbol,
  ParsedDateInput,
  ParseResult,
  PivotTableChange,
  PivotTableConfig,
  PivotTableDef,
  PivotTableResult,
  // Sheet/print config types
  PrintRange,
  PrintTitles,
  ProjectionCellData,
  ProjectionChange,
  PropertyChange,
  ProtectedWorkbookOperation,
  RangeSchema,
  RangeSchemaDefinition,
  RecalcResult,
  RecalcValidationAnnotation,
  RecalcValidationError,
  RemoveDuplicatesResult,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  Scenario,
  ScenarioCreateInput,
  ScenarioCreateResult,
  ScenarioUpdateInput,
  ScenarioUpdateResult,
  ScenarioValidationError,
  SchemaConstraints,
  SchemaType,
  SelectionAggregates,
  // Domain types (charts, filters, sparklines, bindings, grouping, cell_ops)
  FloatingObjectCommon,
  ChartData,
  SheetChange,
  SheetDataBinding,
  SheetGroupingConfig,
  SheetPos,
  SheetProtectionConfig,
  SheetSettings,
  SheetSettingsChange,
  SheetSnapshot,
  SheetSnapshotBin,
  SlicerItem,
  SortingChange,
  Sparkline,
  SparklineChange,
  SparklineGroup,
  SplitViewConfig,
  StructureChangeResult,
  StructureChangeType,
  SubtotalOptions,
  SubtotalResult,
  TableChange,
  TextToColumnsOptions,
  UndoState,
  UpdateBindingFields,
  Viewport,
  ViewportMerge,
  VisibilityChange,
  WorkbookProtectionOptions,
  WorkbookSettings,
  WorkbookSnapshotBin,
} from './compute-types.gen';

/**
 * ChartFloatingObject — the chart variant of the wire FloatingObject union.
 * Previously exported directly from compute-types.gen; now defined as a type alias
 * since the gen file only exports the full `FloatingObject` union type.
 */
export type ChartFloatingObject = FloatingObjectCommon & { type: 'chart' } & ChartData;

export interface PivotUpdateAndMaterializeResult {
  config: PivotTableConfig | null;
  result: PivotTableResult | null;
}

// Re-export generated types for consumers
export type {
  ActiveCellData,
  Axis,
  // Slicer types
  CacheInvalidationEventReason,
  CalculationSettings,
  CellChange,
  // Comment types
  Comment,
  CellData,
  CellDataBin,
  CellEdit,
  CellErrorInfo,
  CellIdRange,
  CellInput,
  // Validation/Schema types
  CellValidationResult,
  CfChange,
  CFIconSetPreset,
  CFPresetCategory,
  CFRule,
  ChangeKind,
  ColumnFilter,
  CommentChange,
  DimensionChange,
  DisconnectionEventReason,
  DomainColumnSchema,
  EnforcementLevel,
  EnterKeyDirection,
  FilterChange,
  FilterRecordCount,
  FilterSortState,
  FilterState,
  FloatingObjectChange,
  GroupDefinition,
  GroupingChange,
  MergeChange,
  MutationResult,
  SyncApplyMutationMetadataWire,
  NamedRangeChange,
  OutlineLevel,
  OutlineLevelButton,
  OutlineRenderData,
  OutlineSettingsUpdate,
  OutlineSymbol,
  ParseResult,
  PivotTableChange,
  PivotTableConfig,
  PivotTableDef,
  // Sheet/print config types
  PrintRange,
  PrintTitles,
  ProjectionCellData,
  ProjectionChange,
  PropertyChange,
  ProtectedWorkbookOperation,
  RangeSchema,
  RangeSchemaDefinition,
  RecalcResult,
  RecalcValidationAnnotation,
  RecalcValidationError,
  RemoveDuplicatesResult,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  Scenario,
  ScenarioCreateInput,
  ScenarioCreateResult,
  ScenarioUpdateInput,
  ScenarioUpdateResult,
  ScenarioValidationError,
  SchemaConstraints,
  SchemaType,
  SelectionAggregates,
  // Domain types
  SheetChange,
  SheetDataBinding,
  SheetGroupingConfig,
  SheetPos,
  SheetSettings,
  SheetSettingsChange,
  SheetSnapshot,
  SheetSnapshotBin,
  SlicerItem,
  SortingChange,
  Sparkline,
  SparklineChange,
  SparklineGroup,
  SplitViewConfig,
  StructureChangeResult,
  StructureChangeType,
  SubtotalOptions,
  SubtotalResult,
  TableChange,
  TextToColumnsOptions,
  UndoState,
  UpdateBindingFields,
  Viewport,
  ViewportMerge,
  VisibilityChange,
  WorkbookProtectionOptions,
  WorkbookSettings,
  WorkbookSnapshotBin,
};

// =============================================================================
// Wire Types — Re-exported from compute-wire-types.ts
// =============================================================================

// Wire type definitions (Rust serde JSON format) are defined in compute-wire-types.ts.
// Re-exported here for backward compatibility.
export type {
  AggregateOpKind,
  BorderStyle,
  CellSchemaWire,
  CellValidationResultWire,
  CFBorderStyle,
  CFCellRange,
  CFColorPointWire,
  CFColorScaleWire,
  CFDataBarAxisPosition,
  CFDataBarDirection,
  CFDataBarWire,
  CfIconSetName,
  CFIconSetWire,
  CFIconThresholdOperator,
  CFIconThresholdWire,
  CFOperator,
  CFPresetsWire,
  CFRuleType,
  CFStyle,
  CFTextOperator,
  CFUnderlineType,
  CFValueType,
  ColorScaleResult,
  ColumnSchemaWire,
  DataBarResult,
  DataRow,
  DateOrder,
  DatePeriod,
  DateValueResult,
  DensityResult,
  DynamicFilterRule,
  EditorType,
  EditorTypeResolutionInputWire,
  EditorTypeResolutionResultWire,
  FilterLogic,
  FilterOperator,
  FormatEntry,
  HistogramBin,
  IconResult,
  IdentityFormulaRefWire,
  IdentityFormulaWire,
  InferredSchemaWire,
  Locale,
  NamedRangeDef,
  PageBreaks,
  ParsedDateInput,
  Point,
  RangeRefWire,
  RegressionMethod,
  RegressionOptions,
  RegressionOutput,
  SchemaConstraintsWire,
  SchemaMapEntryWire,
  SchemaTypeWire,
  Scope,
  SheetRange,
  SlicerSortOrder,
  SlicerSourceType,
  SortDirection,
  SortOrder,
  StackInput,
  StackMode,
  StackOutput,
  StructureChange,
  TableBoolOption,
  TableDef,
  TableRange,
  TopBottomBy,
  TopBottomDirection,
  TotalsFunction,
  ValidationErrorWire,
  ValidationResultWire,
  ValidationSchemaType,
  ViolinShape,
  ViolinStats,
  WorkbookSnapshot,
  CFRuleWire,
  CfPresets,
  ChartStatistics,
  GoalSeekParams,
  GoalSeekResult,
  DataTableParams,
  DataTableResult,
} from './compute-wire-types';

export type { TypedActiveCellData, TypedCellEdit } from './compute-wire-types';

// Value imports needed by this file
import type {
  CFPresetsWire,
  ColumnSchemaWire,
  EditorTypeResolutionInputWire,
  EditorTypeResolutionResultWire,
  FormatEntry,
  InferredSchemaWire,
  SchemaMapEntryWire,
  SchemaTypeWire,
  StructureChange,
  TypedActiveCellData,
  ValidationResultWire,
} from './compute-wire-types';

// =============================================================================
// Wire Converters — Re-exported from compute-wire-converters.ts
// =============================================================================

export {
  columnFilterCriteriaToCompute,
  identityFormulaToWire,
  wireToIdentityFormula,
  wireTableToTableConfig,
} from './compute-wire-converters';

// =============================================================================
// WASM Module Loading — delegated to platform/transport/wasm-loader.ts
// =============================================================================

export { extractMutationData } from './compute-core';
export type { SyncApplyWithMetadataResult } from './sync-apply-result';

// =============================================================================
// ComputeCore & Generated Bridge Methods
// =============================================================================

import type { WriteGate } from '../../document/write-gate';
import { GeneratedBridgeBase } from './compute-bridge.gen';
import { ComputeCore, extractMutationData } from './compute-core';
import type { SyncApplyWithMetadataResult } from './sync-apply-result';

// =============================================================================
// InitPhase type
// =============================================================================

export type InitPhase =
  | 'CREATED'
  | 'HYDRATED'
  | 'CONTEXT_SET'
  | 'STARTED'
  | 'DESTROYING'
  | 'DISPOSED';

// =============================================================================
// Theme Wire Types
//
// The hand-written ThemeDataWire / ThemeColorWire / ThemeColorSourceWire
// aliases that used to live here were removed in principal plumbing3 p01 once bridge-ts
// learned about `domain-types/src/domain/theme.rs` and started emitting
// `ThemeData` / `ThemeColor` / `ThemeColorSource` in compute-types.gen.ts.
// Import those directly from ./compute-types.gen (via the re-export block
// above) — the structural shape is identical.
// =============================================================================

/** Empty MutationResult for Rust commands that return void but callers expect MutationResult. */
function emptyMutationResult(): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {
        cellsEvaluated: 0,
        cellsSkippedClean: 0,
        cellsWithErrors: 0,
        topoLevels: 0,
        maxDepsPerCell: 0,
        totalDepEdges: 0,
        rangeScans: 0,
        rangeScanTotalCells: 0,
        rangeScanMaxCells: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheRebuilds: 0,
        cacheEvictions: 0,
        aggPrepassGroups: 0,
        aggPrepassCells: 0,
        levelsParallel: 0,
        levelsSequential: 0,
        parallelBatchCells: 0,
        hashmapInserts: 0,
        hashmapCapacityGrows: 0,
        projectionsRegistered: 0,
        projectionsMaterialized: 0,
        projectionConflicts: 0,
        timedOut: false,
        hasCircularRefs: false,
        iterativeConverged: false,
        iterativeIterations: 0,
        iterativeMaxDelta: null,
        circularCellCount: 0,
      },
    },
  };
}

function isParsedTopLevelDateFormula(input: CellInput): boolean {
  if (input.kind !== 'parse') return false;
  return /^=\s*(?:_xlfn\.)?date\s*\(/i.test(input.text.trim());
}

function hasGeneralNumberFormat(format: CellFormat): boolean {
  return format.numberFormat == null || format.numberFormat === 'General';
}

function appendPropertyChanges(result: MutationResult, extra: MutationResult): MutationResult {
  if (!extra.propertyChanges?.length) return result;
  return {
    ...result,
    propertyChanges: [...(result.propertyChanges ?? []), ...extra.propertyChanges],
  };
}

const UI_STATE_WORKBOOK_SETTINGS_KEYS = new Set<keyof RustWorkbookSettingsPatch>([
  'customSettings',
  'selectedSheetIds',
]);

function isUiStateWorkbookSettingsPatch(settings: RustWorkbookSettingsPatch): boolean {
  const keys = Object.keys(settings) as Array<keyof RustWorkbookSettingsPatch>;
  return keys.length > 0 && keys.every((key) => UI_STATE_WORKBOOK_SETTINGS_KEYS.has(key));
}

// =============================================================================
// ComputeBridge Class — Thin Composition Root
// =============================================================================

/**
 * ComputeBridge connects the spreadsheet UI to the Rust compute core.
 *
 * Extends GeneratedBridgeBase (~430 passthrough methods via prototype chain).
 * Hand-written methods for lifecycle, viewport, sync, undo, error recovery,
 * and adapter logic (getActiveCell, structureChange, copySheet, etc.)
 * override or extend the generated base naturally via class inheritance.
 */
export class ComputeBridge extends GeneratedBridgeBase {
  private bridgeCtx: IKernelContext;

  constructor(ctx: IKernelContext, docId: string, transport: BridgeTransport) {
    const core = new ComputeCore(ctx, docId, transport);
    super(core);
    this.bridgeCtx = ctx;
    core.setAfterMutationHook(() => this.flushPendingUpdateV1());
  }

  // ===========================================================================
  // Lifecycle delegates
  // ===========================================================================

  get phase(): InitPhase {
    return this.core.phase;
  }

  get isInitialized(): boolean {
    return this.core.isInitialized;
  }

  setContext(ctx: IKernelContext): void {
    this.core.setContext(ctx);
    this.bridgeCtx = ctx;
  }

  /**
   * Install a write gate on the underlying ComputeCore.
   * Called by the lifecycle system during the `installingWriteGate` phase.
   */
  setWriteGate(gate: WriteGate): void {
    this.core.setWriteGate(gate);
  }

  /**
   * The installed write gate, or null if not yet installed.
   * Used by the lifecycle system and RustDocument for bypass scopes.
   */
  get writeGate(): WriteGate | null {
    return this.core.writeGate;
  }

  createEngine(snapshot?: Record<string, unknown>): Promise<RecalcResult> {
    return this.core.createEngine(snapshot);
  }

  createEngineFromYrsState(yrsState: Uint8Array): Promise<RecalcResult> {
    return this.core.createEngineFromYrsState(yrsState);
  }

  setFloatingObject(
    sheetId: SheetId,
    objectId: string,
    json: unknown,
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    return super.setFloatingObject(
      sheetId,
      objectId,
      normalizeFloatingObjectForStorage(json),
      admissionOptions,
    );
  }

  createFloatingObject(
    sheetId: SheetId,
    config: unknown,
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    return super.createFloatingObject(
      sheetId,
      normalizeFloatingObjectForStorage(config),
      admissionOptions,
    );
  }

  updateFloatingObject(
    sheetId: SheetId,
    objectId: string,
    updates: unknown,
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    return super.updateFloatingObject(
      sheetId,
      objectId,
      normalizeFloatingObjectUpdateForStorage(updates),
      admissionOptions,
    );
  }

  start(): Promise<RecalcResult> {
    return this.core.start();
  }

  destroy(): Promise<void> {
    // Clear subscribers before delegating to core.destroy().
    // Subscribers must not see further fires after destroy() returns.
    this._updateSubscribers.clear();
    this.core.setAfterMutationHook(null);
    return this.core.destroy();
  }

  get ready(): Promise<void> {
    return this.core.ready;
  }

  // ===========================================================================
  // Module-Trap Observability — passthroughs to ComputeCore
  // ===========================================================================

  /** True once this bridge's ComputeCore has observed a WASM trap. */
  get isModuleTrapped(): boolean {
    return this.core.isModuleTrapped;
  }

  /** The originating trap if this bridge is trapped, else null. */
  get trapError(): TrapError | null {
    return this.core.trapError;
  }

  /**
   * Register a listener fired exactly once when this bridge's ComputeCore
   * observes a WASM trap. Used by the shell-level recovery coordinator.
   * See {@link ComputeCore.onTrap} for full semantics — late
   * registrations fire synchronously if already trapped, throwing
   * listeners are logged + swallowed, idempotency is per-listener.
   */
  onTrap(listener: (trap: TrapError) => void): () => void {
    return this.core.onTrap(listener);
  }

  // ===========================================================================
  // Viewport delegates
  // ===========================================================================

  refreshViewportForRegion(
    viewportId: string,
    sheetId: SheetId,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
    scrollBehavior: ViewportScrollBehavior = 'free',
  ): Promise<ViewportRefreshDetails> {
    return this.core.refreshViewportForRegion(viewportId, sheetId, bounds, scrollBehavior);
  }

  updateViewportVisibleWindow(
    viewportId: string,
    sheetId: SheetId,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): void {
    this.core.updateViewportVisibleWindow(viewportId, sheetId, bounds);
  }

  /**
   * Set the showFormulas flag. When true, Rust writes formula strings into the
   * `formatted` field for cells with formulas. Invalidates all viewport prefetch.
   */
  setShowFormulas(value: boolean): void {
    this.core.setShowFormulas(value);
  }

  setRenderScheduler(scheduler: import('@mog/canvas-engine').RenderScheduler | null): void {
    this.core.setRenderScheduler(scheduler);
  }

  initMutationHandler(): void {
    this.core.initMutationHandler();
  }

  override async freezeRows(sheetId: SheetId, count: number): Promise<MutationResult> {
    const current = await this.getFrozenPanesQuery(sheetId);
    return this.setFrozenPanes(sheetId, count, current.cols);
  }

  override async freezeColumns(sheetId: SheetId, count: number): Promise<MutationResult> {
    const current = await this.getFrozenPanesQuery(sheetId);
    return this.setFrozenPanes(sheetId, current.rows, count);
  }

  override completeDeferredHydration(): Promise<MutationResult> {
    const run = () =>
      this.core.mutateSystem('compute_complete_deferred_hydration', () =>
        this.core.transport.call<[Uint8Array, MutationResult]>(
          'compute_complete_deferred_hydration',
          { docId: this.core.docId },
        ),
      );
    const mutationHandler = this.core.getMutationHandler();
    return mutationHandler
      ? mutationHandler.withPivotUpdateOptions(
          { reason: 'uiConfigChanged', refreshPolicy: 'refreshAndMaterialize' },
          run,
        )
      : run();
  }

  setCellMetadataCache(cache: CellMetadataCache | null): void {
    this.core.setCellMetadataCache(cache);
  }

  setRangeMetadataCache(cache: RangeMetadataCache | null): void {
    this.core.setRangeMetadataCache(cache);
  }

  getMutationHandler(): MutationResultHandler | null {
    return this.core.getMutationHandler();
  }

  getViewportBuffer(viewportId: string): ReadonlyBinaryViewportBuffer | null {
    return this.core.getViewportBuffer(viewportId);
  }

  getAccessorForViewport(
    viewportId: string,
  ): import('../wire/binary-viewport-buffer').CellAccessor | undefined {
    return this.core.getAccessorForViewport(viewportId);
  }

  getPerViewportStates(): ReadonlyMap<string, ViewportPrefetchState> {
    return this.core.getPerViewportStates();
  }

  invalidateAllViewportPrefetch(): void {
    this.core.invalidateAllViewportPrefetch();
  }

  clearPerViewportState(): void {
    this.core.clearPerViewportState();
  }

  /**
   * Force-refresh all registered viewport buffers from Rust.
   * Delegates to ComputeCore.forceRefreshAllViewports().
   */
  forceRefreshAllViewports(): Promise<void> {
    return this.core.forceRefreshAllViewports();
  }

  registerViewportRegion(
    viewportId: string,
    sheetId: SheetId,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<void> {
    return this.core.registerViewportRegion(viewportId, sheetId, bounds);
  }

  updateViewportRegionBounds(
    viewportId: string,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<void> {
    return this.core.updateViewportRegionBounds(viewportId, bounds);
  }

  unregisterViewportRegion(viewportId: string): Promise<void> {
    return this.core.unregisterViewportRegion(viewportId);
  }

  resetSheetViewportRegions(sheetId: SheetId): Promise<void> {
    return this.core.resetSheetViewportRegions(sheetId);
  }

  refreshActiveCell(sheetId: SheetId, cellId: string): Promise<void> {
    return this.core.refreshActiveCell(sheetId, cellId);
  }

  getActiveCellData(): TypedActiveCellData | null {
    return this.core.getActiveCellData();
  }

  subscribeToViewportEvents(
    cb: (event: import('@mog-sdk/contracts/api').ViewportChangeEvent) => void,
  ): () => void {
    return this.core.subscribeToViewportEvents(cb);
  }

  // ===========================================================================
  // Sync delegates
  // ===========================================================================

  syncStateVector(): Promise<Uint8Array> {
    return this.core.syncStateVector();
  }

  syncDiff(remoteSv: Uint8Array): Promise<Uint8Array> {
    return this.core.syncDiff(remoteSv);
  }

  syncApply(update: Uint8Array): Promise<MutationResult>;
  syncApply(
    update: Uint8Array,
    syncApplyContext: AdmittedSyncApplyContext,
  ): Promise<MutationResult>;
  syncApply(
    update: Uint8Array,
    syncApplyContext?: AdmittedSyncApplyContext,
  ): Promise<MutationResult> {
    return syncApplyContext
      ? this.core.syncApply(update, syncApplyContext)
      : this.core.syncApply(update);
  }

  syncApplyLegacyRaw(update: Uint8Array): Promise<SyncApplyWithMetadataResult> {
    return this.core.syncApplyLegacyRaw(update);
  }

  syncApplyAdmitted(
    update: Uint8Array,
    syncApplyContext: AdmittedSyncApplyContext,
  ): Promise<MutationResult> {
    return this.core.syncApplyAdmitted(update, syncApplyContext);
  }

  syncApplyWithMetadata(
    update: Uint8Array,
    syncApplyContext: AdmittedSyncApplyContext,
  ): Promise<SyncApplyWithMetadataResult> {
    return this.core.syncApplyWithMetadata(update, syncApplyContext);
  }

  syncApplyAdmittedWithMetadata(
    update: Uint8Array,
    syncApplyContext: AdmittedSyncApplyContext,
  ): Promise<SyncApplyWithMetadataResult> {
    return this.core.syncApplyAdmittedWithMetadata(update, syncApplyContext);
  }

  override async drainPendingUpdates(): Promise<Uint8Array[]> {
    try {
      return await this.core.query(
        this.core.transport.call<Uint8Array[]>('compute_drain_pending_updates', {
          docId: this.core.docId,
        }),
      );
    } catch (err) {
      if (
        err instanceof TransportError &&
        err.message.startsWith('[compute_drain_pending_updates]') &&
        err.message.includes('bootstrap update leaked into provider drain')
      ) {
        throw new TransportError(
          'compute_drain_pending_updates',
          `bootstrap update leaked into provider drain: ` +
            `docId=${this.core.docId}, subscribers=${this._updateSubscribers.size}; ` +
            err.message,
          { cause: err },
        );
      }
      throw err;
    }
  }

  /**
   * Drain Rust's update_v1 buffer and synchronously fan it to current
   * subscribers. This is the production durability boundary between a
   * resolved mutation and Provider persistence: the polling dispatcher is
   * still kept as a safety net, but normal writes no longer wait for the
   * next timer tick before Providers see the update.
   */
  flushPendingUpdateV1(): Promise<void> {
    return (async () => {
      if (this._updateDispatchInFlightPromise) {
        await this._updateDispatchInFlightPromise;
      }
      await this._dispatchPendingUpdates();
    })();
  }

  // ===========================================================================
  // Provider Protocol — update_v1 subscription dispatcher
  //
  // The yrs Doc lives in the compute engine, not in TS. So `subscribeUpdateV1`
  // is NOT "TS calls into Rust to register a Rust closure" — it is "TS
  // registers a JS callback into a TS-side dispatcher; the dispatcher polls
  // the engine's update buffer on a microtask tick and fans drained payloads
  // out to all registered callbacks."
  //
  // - Engine-side: one `observe_update_v1` listener pushes update bytes into
  //   `update_buffer` (compute/core/src/storage/engine/update_buffer.rs).
  //   Volume bounded by transaction count, not cell count — bulk paste of
  //   10K cells in one txn fires the callback exactly once.
  // - TS-side: every `subscribeUpdateV1(cb)` call adds `cb` to a Set. On the
  //   first subscriber per bridge instance, a polling loop starts that calls
  //   `drainPendingUpdates` once per tick (microtask + setTimeout fallback)
  //   and dispatches every drained payload to every callback in FIFO order.
  // - Subscription handle: `{ unsubscribe(): void }`. Removing the last
  //   callback stops the polling loop. The engine-side observer stays
  //   installed for the doc's lifetime regardless.
  // - Always-async on every transport. Microtask coalescing on TS absorbs
  //   per-tick latency.
  //
  // On bridge restart (e.g. WASM reload during HMR), all subscriptions drop;
  // the orchestrator (`RustDocument`) re-attaches Providers, which re-subscribe.
  // ===========================================================================

  /** Registered callbacks for this bridge instance. */
  private _updateSubscribers: Set<(update: Uint8Array) => void> = new Set();

  /**
   * Reentrancy guard for the drain.  Prevents concurrent drain calls —
   * relevant when a subscriber's callback triggers another mutation that
   * re-enters flushPendingUpdateV1.
   */
  private _updateDispatchInFlight: boolean = false;
  private _updateDispatchInFlightPromise: Promise<void> | null = null;

  /**
   * Subscribe a callback to receive every yrs `update_v1` payload emitted
   * by the engine after a write transaction commits.
   *
   * Updates are delivered synchronously at the end of every mutation via
   * `flushPendingUpdateV1()` (called from the `afterMutationHook` in
   * `mutateCore`).  There is no polling loop — every mutation drains
   * the Rust update buffer immediately.
   *
   * Contract:
   * - Called in FIFO order matching yrs commit order.
   * - Bulk transactions: one callback fire per `txn.commit()` regardless
   *   of mutation count.
   * - Read-only ops (`encodeStateVector`, `syncFullState`, `encodeDiff`)
   *   do not fire the callback.
   *
   * Returns `{ unsubscribe(): void }`.  Idempotent.
   */
  subscribeUpdateV1(callback: (update: Uint8Array) => void): { unsubscribe: () => void } {
    this._updateSubscribers.add(callback);

    let unsubscribed = false;
    return {
      unsubscribe: () => {
        if (unsubscribed) return;
        unsubscribed = true;
        this._updateSubscribers.delete(callback);
      },
    };
  }

  private async _dispatchPendingUpdates(): Promise<void> {
    if (this._updateDispatchInFlight) {
      await this._updateDispatchInFlightPromise;
      return;
    }
    if (this._updateSubscribers.size === 0) return;
    if (!this.core.isInitialized) return;
    this._updateDispatchInFlight = true;
    const run = (async () => {
      try {
        // Snapshot subscribers to preserve no-reentrancy: a callback
        // that subscribes/unsubscribes during dispatch must not affect the
        // current flush's recipient set.
        const callbacks = Array.from(this._updateSubscribers);
        while (true) {
          let updates: Uint8Array[];
          try {
            updates = await this.drainPendingUpdates();
          } catch (err) {
            if (
              err instanceof TransportError &&
              err.message.startsWith('[compute_drain_pending_updates] instance not found')
            ) {
              this._updateSubscribers.clear();
              return;
            }
            throw err;
          }
          if (updates.length === 0) return;
          for (const update of updates) {
            for (const cb of callbacks) {
              try {
                cb(update);
              } catch (err) {
                console.warn('[ComputeBridge] update_v1 subscriber threw:', err);
              }
            }
          }
        }
      } finally {
        this._updateDispatchInFlight = false;
        this._updateDispatchInFlightPromise = null;
      }
    })();
    this._updateDispatchInFlightPromise = run;
    await run;
  }

  // ===========================================================================
  // Undo/Redo delegates
  // ===========================================================================

  // Override generated undo/redo to use mutateCore pipeline (no notifyForwardMutation)
  override undo(): Promise<MutationResult> {
    return this.core.undo();
  }

  override redo(): Promise<MutationResult> {
    return this.core.redo();
  }

  // Override generated beginUndoGroup/endUndoGroup to use core's direct transport call.
  // The generated bridge routes these through mutate() which destructures the WASM return
  // as [Uint8Array, MutationResult]. The WASM begin/endUndoGroup don't return viewport
  // patches, so the destructuring fails with "is not iterable".
  override async beginUndoGroup(): Promise<MutationResult> {
    await this.core.admitPublicMutation('compute_begin_undo_group');
    await this.core.beginUndoGroup();
    return { recalc: { changedCells: [] } } as unknown as MutationResult;
  }

  override async endUndoGroup(): Promise<MutationResult> {
    await this.core.admitPublicMutation('compute_end_undo_group');
    await this.core.endUndoGroup();
    return { recalc: { changedCells: [] } } as unknown as MutationResult;
  }

  undoState(): Promise<UndoState> {
    return this.core.getUndoState();
  }

  // ===========================================================================
  // Error Recovery delegates
  // ===========================================================================

  fullRecalc(options?: Record<string, unknown>): Promise<RecalcResult> {
    return this.core.fullRecalc(options);
  }

  exportToXlsxBytes(): Promise<Uint8Array> {
    return this.core.exportToXlsxBytes();
  }

  exportToXlsxBytesContextStripped(): Promise<Uint8Array> {
    return this.core.exportToXlsxBytesContextStripped();
  }

  importSheetsFromXlsx(
    xlsxData: Uint8Array,
    sheetNames: string[],
    insertPosition: number | null,
  ): Promise<string[]> {
    return this.core.importSheetsFromXlsx(xlsxData, sheetNames, insertPosition);
  }

  captureScreenshot(
    sheetId: string,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    dpr: number,
    showHeaders: boolean,
    showGridlines: boolean,
    maxWidth: number | null,
    maxHeight: number | null,
  ): Promise<Uint8Array> {
    return this.core.captureScreenshot(
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
      dpr,
      showHeaders,
      showGridlines,
      maxWidth,
      maxHeight,
    );
  }

  // ===========================================================================
  // Hand-written overrides — methods with special logic
  // All use this.core.transport.call() directly (no adapter).
  // ===========================================================================

  /** Get active cell data. Brands the formula field as FormulaA1. */
  async getActiveCell(sheetId: SheetId, cellId: string): Promise<TypedActiveCellData> {
    this.core.ensureInitialized();
    const data = await this.core.transport.call<ActiveCellData>('compute_get_active_cell', {
      docId: this.core.docId,
      sheetId,
      cellId,
    });
    if (data.formula != null) {
      (data as TypedActiveCellData).formula = asFormulaA1(data.formula);
    }
    return data as TypedActiveCellData;
  }

  /** Get data bounds for a sheet. Rust returns camelCase via serde. */
  async getDataBounds(sheetId: SheetId): Promise<DataBounds | null> {
    this.core.ensureInitialized();
    return this.core.transport.call<DataBounds | null>('compute_get_data_bounds', {
      docId: this.core.docId,
      sheetId,
    });
  }

  /** Structural change — delegates to ComputeCore for prefetch invalidation. */
  async structureChange(
    sheetId: SheetId,
    change: StructureChange,
    options?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    return this.core.structureChangeWithInvalidation(sheetId, change, options);
  }

  /** Copy a sheet and return the new sheet ID. */
  async copySheet(
    sheetId: SheetId,
    newName: string,
    options?: MutationAdmissionOptions,
  ): Promise<{ newSheetId: SheetId }> {
    // `compute_copy_sheet` returns `[String, MutationResult]` (not a bytes-tuple).
    // We capture the new sheet id alongside the MutationResult, then route it
    // through public admission and the normal mutation pipeline so the undo
    // service is notified. Without this, the undo cache stays stale and Cmd+Z
    // is a no-op after copying a sheet.
    const { raw } = await this.core.mutatePublicResult<[string, MutationResult]>(
      'compute_copy_sheet',
      () =>
        this.core.transport.call<[string, MutationResult]>('compute_copy_sheet', {
          docId: this.core.docId,
          sheetId,
          newName,
        }),
      ([, mutationResult]) => [new Uint8Array(0), mutationResult],
      undefined,
      options,
    );
    const [rawId] = raw;
    // `mutation_copy_sheet` in Rust registers formulas in the dep graph and
    // marks the scheduler dirty, but does not run a recalc pass — so copied
    // formula cells have no computed values. Trigger a recalc by calling
    // `compute_full_recalc` directly through the transport (bypassing the
    // CONTEXT_SET phase guard which only applies during initial startup), then
    // force-refresh all viewport buffers so the grid reads the fresh values.
    const recalcResult = await this.core.transport
      .call<RecalcResult>('compute_full_recalc', { docId: this.core.docId, options: {} })
      .catch(() => null);
    if (recalcResult) {
      this.core.getMutationHandler()?.applyAndNotify({ recalc: recalcResult } as MutationResult);
    }
    await this.core.forceRefreshAllViewports();
    return { newSheetId: toSheetId(rawId) };
  }

  /** Create a new sheet and return its ID. */
  async createSheet(
    name: string,
    options?: MutationAdmissionOptions,
  ): Promise<{ sheetId: SheetId }> {
    // See `copySheet` above: route through public admission and the normal
    // mutation pipeline so the undo service refreshes its cached state.
    const { raw } = await this.core.mutatePublicResult<[string, MutationResult]>(
      'compute_create_sheet_with_default_col_width',
      () =>
        this.core.transport.call<[string, MutationResult]>(
          'compute_create_sheet_with_default_col_width',
          {
            docId: this.core.docId,
            name,
            defaultColWidthPx: SHEET_META_DEFAULT_COL_WIDTH,
          },
        ),
      ([, mutationResult]) => [new Uint8Array(0), mutationResult],
      undefined,
      options,
    );
    const [rawId] = raw;
    return { sheetId: toSheetId(rawId) };
  }

  /**
   * Create the implicit default sheet on a freshly-started blank workbook.
   *
   * Identical to {@link createSheet} except the Rust path tags the underlying
   * Yrs transaction with `ORIGIN_BOOTSTRAP` so it never enters the undo stack.
   * A fresh workbook must report `canUndo === false` — using `createSheet` for
   * the bootstrap would mean the user's first Cmd+Z deletes the only sheet
   * (api-eval `history/undo-redo-state`, `history/undo-state-tracking`).
   *
   * Only the document lifecycle should call this; user-facing sheet creation
   * must go through {@link createSheet}.
   */
  async createDefaultSheet(name: string): Promise<{ sheetId: SheetId }> {
    const { raw } = await this.core.mutateSystemResult<[string, MutationResult]>(
      'compute_create_default_sheet_with_default_col_width',
      () =>
        this.core.transport.call<[string, MutationResult]>(
          'compute_create_default_sheet_with_default_col_width',
          {
            docId: this.core.docId,
            name,
            defaultColWidthPx: SHEET_META_DEFAULT_COL_WIDTH,
          },
        ),
      ([, mutationResult]) => [new Uint8Array(0), mutationResult],
    );
    const [rawId] = raw;
    return { sheetId: toSheetId(rawId) };
  }

  /** Remove a sheet. */
  async removeSheet(sheetId: SheetId, options?: MutationAdmissionOptions): Promise<void> {
    await this.core.admitPublicMutation('compute_delete_sheet', options);
    await prepareVersionMutationCapture(this.bridgeCtx, {
      operation: 'compute_delete_sheet',
      ...(options?.operationContext ? { operationContext: options.operationContext } : {}),
    });
    // `compute_delete_sheet` is `#[bridge::skip(ts_bridge)]` on the Rust side,
    // so it is absent from the generated BYTES_TUPLE_COMMANDS set and the
    // bytes-tuple normalizing transport does NOT auto-unpack the result. But
    // the Rust method still returns `(Vec<u8>, MutationResult)` (packed as a
    // single Buffer by the NAPI codec, passed as a 2-tuple by WASM). We call
    // `normalizeBytesTuple` manually to extract the tuple, then feed it
    // through `core.mutate()` so the MutationResult flows through the unified
    // pipeline (event bus delivery + undo-cache refresh) — without
    // `core.mutate()`, `sheet_changes` never reaches the event bus (FT-009)
    // *and* the undo service's cached `canUndo` stays stale, breaking Cmd+Z.
    //
    // The delete and the `_forceRecomputeRefErrorCells` workaround below must
    // collapse into a single undo entry — otherwise Cmd+Z reverts only the
    // workaround's no-op formula re-set and the sheet stays deleted. Wrap
    // both in an undo group so the user sees one atomic "Delete sheet" step.

    await this.core.beginUndoGroup();
    try {
      const raw = await this.core.transport.call<[Uint8Array, MutationResult] | Uint8Array>(
        'compute_delete_sheet',
        {
          docId: this.core.docId,
          sheetId,
        },
      );
      const tuple = normalizeBytesTuple(raw as [Uint8Array, MutationResult] | Uint8Array);
      await this.core.mutate(
        Promise.resolve(tuple),
        undefined,
        'compute_delete_sheet',
        options,
        true,
      );
      // Force-recalculate cells whose formula strings now contain "#REF!" after deletion.
      // Rust's remove_sheet() misses DepTarget::Range dependents, so cross-sheet positional
      // refs like =Sheet2!A1 are not recalculated. This workaround finds them by formula text
      // and re-evaluates them via setCellValuesParsed.
      await this._forceRecomputeRefErrorCells();
    } finally {
      await this.core.endUndoGroup();
    }

    // Formulas that referenced the deleted sheet are recalculated to #REF! by Rust,
    // but compute_delete_sheet does not return binary viewport patches. Force-refresh
    // all viewport buffers so the grid picks up the new cell values immediately.
    await this.core.forceRefreshAllViewports();
  }

  /**
   * After a sheet deletion, find cells whose formula display strings now contain
   * "#REF!" and force Rust to re-parse and re-evaluate them.
   *
   * This is a workaround for Rust's remove_sheet() only invalidating DepTarget::Cell
   * dependents, missing DepTarget::Range dependents (cross-sheet positional refs).
   */
  private async _forceRecomputeRefErrorCells(): Promise<void> {
    const sheetIds = await this.getSheetOrder();
    for (const remainingSheetId of sheetIds) {
      const affected = await this.findCellsByFormula(remainingSheetId, '#REF!');
      if (affected.length === 0) continue;
      const updates: [number, number, string][] = [];
      for (const [row, col] of affected) {
        const cellId = await this.getCellIdAt(remainingSheetId, row, col);
        if (!cellId) continue;
        const formula = await this.getFormula(toCellId(cellId));
        if (formula != null) updates.push([row, col, formula]);
      }
      if (updates.length > 0) await this.setCellValuesParsed(remainingSheetId, updates);
    }
  }

  /** Rename a sheet. */
  async renameSheet(
    sheetId: SheetId,
    name: string,
    options?: MutationAdmissionOptions,
  ): Promise<void> {
    // See `removeSheet` above for the rationale: `compute_rename_compute_sheet`
    // is `#[bridge::skip(ts_bridge)]`, so the bytes-tuple return from Rust is
    // NOT auto-unpacked by the transport. Normalize explicitly, then route
    // through `core.mutate()` so `sheet_changes` reach the event bus
    // (FT-010) AND the undo service refreshes its cached state (Cmd+Z parity).
    await this.core.mutatePublicResult<[Uint8Array, MutationResult] | Uint8Array>(
      'compute_rename_compute_sheet',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult] | Uint8Array>(
          'compute_rename_compute_sheet',
          {
            docId: this.core.docId,
            sheetId,
            name,
          },
        ),
      (raw) => normalizeBytesTuple(raw as [Uint8Array, MutationResult] | Uint8Array),
      undefined,
      options,
    );
    // Rust's `mutation_rename_sheet` rewrites Yrs formula text and
    // regenerates the `formula_strings` cache — no TS-side mirror needed.
  }

  /** Atomically create a new sheet AND a pivot table on it. */
  async pivotCreateWithSheet(
    sheetName: string,
    config: Partial<PivotTableConfig>,
    options?: PivotCreateWithSheetOptions,
  ): Promise<{ sheetId: SheetId; config: PivotTableConfig }> {
    const { raw } = await this.core.mutatePublicResult<[string, PivotTableConfig, MutationResult]>(
      'compute_pivot_create_with_sheet',
      () =>
        this.core.transport.call<[string, PivotTableConfig, MutationResult]>(
          'compute_pivot_create_with_sheet',
          { docId: this.core.docId, sheetName, config, options: options ?? null },
        ),
      ([, , mutationResult]) => [new Uint8Array(), mutationResult],
    );
    const [rawId, pivotConfig] = raw;
    return { sheetId: toSheetId(rawId), config: pivotConfig };
  }

  /**
   * Materialize pivot output through the mutation pipeline.
   *
   * The generated bridge currently routes `compute_pivot_materialize` through
   * `query()` even though the Rust method writes materialized cells. Use the
   * handwritten mutation command so viewport patches apply before the result is
   * returned, without adding a user-visible undo entry for this derived render.
   */
  async pivotMaterialize(
    sheetId: SheetId,
    pivotId: string,
    expansionState: PivotExpansionState | null,
  ): Promise<PivotTableResult> {
    await this.core.admitPublicMutation('compute_pivot_materialize_mutation');
    const raw = await this.core.transport.call<[Uint8Array, MutationResult] | Uint8Array>(
      'compute_pivot_materialize_mutation',
      {
        docId: this.core.docId,
        sheetId,
        pivotId,
        expansionState,
      },
    );
    const mutationResult = await this.core.mutateCore(
      Promise.resolve(normalizeBytesTuple(raw as [Uint8Array, MutationResult] | Uint8Array)),
      undefined,
      'compute_pivot_materialize_mutation',
    );
    const result = extractMutationData<PivotTableResult>(mutationResult);
    if (!result) {
      throw new Error('pivotMaterialize: no pivot result returned in MutationResult.data');
    }
    return result;
  }

  async pivotUpdateAndMaterialize(
    sheetId: SheetId,
    pivotId: string,
    config: PivotTableConfig,
    expansionState: PivotExpansionState | null,
  ): Promise<PivotUpdateAndMaterializeResult> {
    const mutationResult = await this.core.mutatePublic(
      'compute_pivot_update_and_materialize',
      async () => {
        const raw = await this.core.transport.call<[Uint8Array, MutationResult] | Uint8Array>(
          'compute_pivot_update_and_materialize',
          {
            docId: this.core.docId,
            sheetId,
            pivotId,
            config,
            expansionState,
          },
        );
        return normalizeBytesTuple(raw as [Uint8Array, MutationResult] | Uint8Array);
      },
    );
    const result = extractMutationData<PivotUpdateAndMaterializeResult>(mutationResult);
    if (!result) {
      throw new Error(
        'pivotUpdateAndMaterialize: no pivot payload returned in MutationResult.data',
      );
    }
    return result;
  }

  /**
   * Add a comment. Maps optional params to null defaults. Returns the created
   * comment from MutationResult.data.
   *
   * NOTE: compute_add_comment is #[bridge::skip(ts_bridge)] so it is absent
   * from the generated BYTES_TUPLE_COMMANDS set. The bytes-tuple normalizing
   * transport therefore does NOT auto-unpack the result. We call
   * normalizeBytesTuple manually to handle both packed (NAPI/Tauri) and
   * unpacked (WASM) return formats before feeding into the mutation pipeline.
   */
  async addComment(
    sheetId: SheetId,
    cellId: string,
    text: string,
    author: string,
    options?: { authorId?: string; parentId?: string; commentType?: 'note' | 'threadedComment' },
  ): Promise<Comment> {
    const { mutation: result } = await this.core.mutatePublicResult<
      [Uint8Array, MutationResult] | Uint8Array
    >(
      'compute_add_comment',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult] | Uint8Array>('compute_add_comment', {
          docId: this.core.docId,
          sheetId,
          cellId,
          text,
          author,
          authorId: options?.authorId ?? null,
          parentId: options?.parentId ?? null,
          // Replies inherit thread membership; default to 'threadedComment'
          // since a reply on a noted cell is impossible by construction (the
          // cell-level XOR invariant rejects it before this call lands).
          commentType: options?.commentType ?? 'threadedComment',
        }),
      (raw) => normalizeBytesTuple(raw as [Uint8Array, MutationResult] | Uint8Array),
    );
    const comment = extractMutationData<Comment>(result);
    if (!comment) {
      throw new Error('addComment: no comment returned in MutationResult.data');
    }
    return comment;
  }

  /** Add a comment by row/col position. Rust resolves the CellId internally. */
  async addCommentByPosition(
    sheetId: SheetId,
    row: number,
    col: number,
    text: string,
    author: string,
    authorId: string | null,
    parentId: string | null,
    commentType: 'note' | 'threadedComment',
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    return this.core.mutatePublic(
      'compute_add_comment_by_position',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult]>('compute_add_comment_by_position', {
          docId: this.core.docId,
          sheetId,
          row,
          col,
          text,
          author,
          authorId,
          parentId,
          commentType,
        }),
      undefined,
      admissionOptions,
    );
  }

  /** Get comments for a cell by row/col position. Rust resolves the CellId internally. */
  async getCommentsForCellByPosition(
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<Comment[]> {
    this.core.ensureInitialized();
    return this.core.query(
      this.core.transport.call<Comment[]>('compute_get_comments_for_cell_by_position', {
        docId: this.core.docId,
        sheetId,
        row,
        col,
      }),
    );
  }

  // ===========================================================================
  // Format Toggle Methods — delegate to generated toggleFormatProperty
  // ===========================================================================

  async toggleBold(
    sheetId: SheetId,
    ranges: Array<[number, number, number, number]>,
    activeRow: number,
    activeCol: number,
  ): Promise<MutationResult> {
    return this.toggleFormatProperty(sheetId, ranges, 'bold', activeRow, activeCol);
  }

  async toggleItalic(
    sheetId: SheetId,
    ranges: Array<[number, number, number, number]>,
    activeRow: number,
    activeCol: number,
  ): Promise<MutationResult> {
    return this.toggleFormatProperty(sheetId, ranges, 'italic', activeRow, activeCol);
  }

  async toggleStrikethrough(
    sheetId: SheetId,
    ranges: Array<[number, number, number, number]>,
    activeRow: number,
    activeCol: number,
  ): Promise<MutationResult> {
    return this.toggleFormatProperty(sheetId, ranges, 'strikethrough', activeRow, activeCol);
  }

  async toggleWrapText(
    sheetId: SheetId,
    ranges: Array<[number, number, number, number]>,
    activeRow: number,
    activeCol: number,
  ): Promise<MutationResult> {
    return this.toggleFormatProperty(sheetId, ranges, 'wrapText', activeRow, activeCol);
  }

  async toggleUnderline(
    sheetId: SheetId,
    ranges: Array<[number, number, number, number]>,
    activeRow: number,
    activeCol: number,
  ): Promise<MutationResult> {
    return this.toggleFormatProperty(sheetId, ranges, 'underline', activeRow, activeCol);
  }

  // ===========================================================================
  // Format Range Methods — delegate to generated setFormatForRanges
  // ===========================================================================

  async setCellFormatForRanges(
    sheetId: SheetId,
    ranges: Array<[number, number, number, number]>,
    format: Partial<CellFormat & CellMetadata>,
  ): Promise<MutationResult> {
    return this.setFormatForRanges(sheetId, ranges, format);
  }

  // ===========================================================================
  // CF Presets — stateless, no docId
  //
  // the CF-mutation override block (4 sites that called
  // `forceRefreshAllViewports` after addCfRule/updateCfRule/deleteCfRule/
  // reorderCfRules) is gone. The Rust mutation handlers in
  // `compute/core/src/storage/engine/formatting.rs` already emit full-
  // viewport-binary patches via `produce_cf_viewport_patches`, so the
  // generated bridge calls (`super.addCfRule(...)` and friends) carry
  // the post-mutation visual state through the binary patch channel.
  //
  // The structural CF re-eval gap (structural dependency gap) — insert/delete
  // rows/cols not re-evaluating CF on shifted ranges — is also now wired
  // through `YrsComputeEngine::structure_change`, which refreshes the CF cache
  // before the bridge-level structural viewport refresh reads fresh buffers.
  // ===========================================================================

  async getCFPresets(): Promise<CFPresetsWire> {
    return this.core.transport.call<CFPresetsWire>('compute_get_cf_presets', {});
  }

  // ===========================================================================
  // Schema Map Management (stateful — not in generated bridge)
  // ===========================================================================

  async setSchemaMap(entries: SchemaMapEntryWire[], version: number): Promise<void> {
    this.core.ensureInitialized();
    await this.core.transport.call<void>('compute_set_schema_map', {
      docId: this.core.docId,
      entries,
      version,
    });
  }

  async updateSchema(
    sheetId: SheetId,
    column: number,
    schema: ColumnSchemaWire,
    version: number,
  ): Promise<boolean> {
    this.core.ensureInitialized();
    return this.core.transport.call<boolean>('compute_update_schema', {
      docId: this.core.docId,
      sheetId,
      column,
      schema,
      version,
    });
  }

  async removeSchema(sheetId: SheetId, column: number, version: number): Promise<boolean> {
    this.core.ensureInitialized();
    return this.core.transport.call<boolean>('compute_remove_schema', {
      docId: this.core.docId,
      sheetId,
      column,
      version,
    });
  }

  // ===========================================================================
  // Validation — delegate to generated validateCellValue
  // ===========================================================================

  async validateCellValueInDoc(
    sheetId: SheetId,
    row: number,
    col: number,
    value: string,
  ): Promise<CellValidationResult> {
    return this.validateCellValue(sheetId, row, col, value);
  }

  // ===========================================================================
  // Hand-written adapter methods — unique logic, not overriding generated
  // ===========================================================================

  /**
   * Get all sheet IDs, branded.
   * Wire seam: Rust returns raw string[], we brand at the boundary.
   */
  override async getAllSheetIds(): Promise<SheetId[]> {
    const ids = await super.getAllSheetIds();
    return ids.map((id) => toSheetId(id));
  }

  /**
   * Get sheet IDs in display order, branded.
   * Wire seam: Rust returns raw string[], we brand at the boundary.
   */
  override async getSheetOrder(): Promise<SheetId[]> {
    const ids = await super.getSheetOrder();
    return ids.map((id) => toSheetId(id));
  }

  /**
   * Resolve a cellId to its (sheetId, row, col) position, branded.
   * Wire seam: Rust's CellPositionResult carries sheetId as raw string.
   */
  override async getCellPosition(
    sheetId: SheetId,
    cellIdHex: string,
  ): Promise<{ sheetId: SheetId; sheetName: string; row: number; col: number } | null> {
    const result = await super.getCellPosition(sheetId, cellIdHex);
    return result ? { ...result, sheetId: toSheetId(result.sheetId) } : null;
  }

  /** Get protection options for a sheet. Returns per-operation permissions when protected. */
  async getSheetProtectionOptions(sheetId: SheetId): Promise<SheetProtectionOptions | null> {
    const settings = await this.getSheetSettings(sheetId);
    if (!settings.isProtected) return null;
    return { ...DEFAULT_PROTECTION_OPTIONS, ...settings.protectionOptions };
  }

  /** Set multiple sheet settings at once (iterates entries). */
  async setSheetSettings(
    sheetId: SheetId,
    updates: Record<string, unknown>,
  ): Promise<MutationResult> {
    this.core.ensureInitialized();
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        await this.core.transport.call<void>('compute_set_sheet_setting', {
          docId: this.core.docId,
          sheetId,
          key,
          value: String(value),
        });
      }
    }
    return emptyMutationResult();
  }

  /** Apply automatic subtotals. Destructures config into positional args. */
  async autoSubtotals(
    sheetId: SheetId,
    config: {
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
      options: SubtotalOptions;
    },
  ): Promise<MutationResult> {
    return this.createSubtotals(
      sheetId,
      config.startRow,
      config.startCol,
      config.endRow,
      config.endCol,
      config.options,
    );
  }

  // ===========================================================================
  // CellEdit convenience wrappers
  // ===========================================================================

  /** Set multiple cells at once (CellEdit[] API). Delegates to applyChanges.
   *
   * Passes `skipCycleCheck: true` — this is a trusted bulk path (scenario
   * apply/restore, programmatic multi-cell writes). See
   * the circular-dependency handling invariant
   */
  async setCells(edits: CellEdit[]): Promise<MutationResult> {
    return this.applyChanges(edits, true);
  }

  async setCell(
    sheetId: SheetId,
    cellId: CellId,
    row: number,
    col: number,
    input: CellInput,
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    await assertStrictValidationAdmission(this, sheetId, [{ row, col, input }]);
    return super.setCell(sheetId, cellId, row, col, input, admissionOptions);
  }

  async setCellValueParsed(
    sheetId: SheetId,
    row: number,
    col: number,
    rawInput: string,
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    const { normalEdits, headerRenames } = await splitTableHeaderWritesForSetCells(this, sheetId, [
      { row, col, input: { kind: 'parse', text: rawInput } },
    ]);
    await assertStrictValidationAdmission(this, sheetId, normalEdits);
    const headerResult = await this.applyTableHeaderRenames(headerRenames, admissionOptions);
    if (normalEdits.length === 0) return headerResult ?? emptyMutationResult();
    return super.setCellValueParsed(sheetId, row, col, rawInput, admissionOptions);
  }

  async setCellValuesParsed(
    sheetId: SheetId,
    updates: [number, number, string][],
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    const edits = updates.map(
      ([row, col, text]) => ({ row, col, input: { kind: 'parse', text } }) as const,
    );
    const { normalEdits, headerRenames } = await splitTableHeaderWritesForSetCells(
      this,
      sheetId,
      edits,
    );
    await assertStrictValidationAdmission(this, sheetId, normalEdits);
    const headerResult = await this.applyTableHeaderRenames(headerRenames, admissionOptions);
    if (normalEdits.length === 0) return headerResult ?? emptyMutationResult();
    return super.setCellValuesParsed(
      sheetId,
      normalEdits.map((edit) => {
        if (edit.input.kind !== 'parse') {
          throw new Error(`Expected parsed cell input, got ${edit.input.kind}`);
        }
        return [edit.row, edit.col, edit.input.text] as [number, number, string];
      }),
      admissionOptions,
    );
  }

  async setCellValueAsText(
    sheetId: SheetId,
    row: number,
    col: number,
    value: string,
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    const { normalEdits, headerRenames } = await splitTableHeaderWritesForSetCells(this, sheetId, [
      { row, col, input: { kind: 'literal', text: value } },
    ]);
    await assertStrictValidationAdmission(this, sheetId, normalEdits);
    const headerResult = await this.applyTableHeaderRenames(headerRenames, admissionOptions);
    if (normalEdits.length === 0) return headerResult ?? emptyMutationResult();
    return super.setCellValueAsText(sheetId, row, col, value, admissionOptions);
  }

  batchSetCellsByPosition(
    edits: [SheetId, number, number, CellInput][],
    skipCycleCheck: boolean,
    admissionOptions?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    return this.core.mutatePublic(
      'compute_batch_set_cells_by_position',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult]>(
          'compute_batch_set_cells_by_position',
          {
            docId: this.core.docId,
            edits,
            skipCycleCheck,
          },
        ),
      edits.map(([editSheetId, row, col]) => ({
        sheetId: editSheetId,
        row,
        col,
      })),
      admissionOptions,
    );
  }

  /** Set cells by position. Converts to tuples for generated batchSetCellsByPosition.
   *
   * Passes `skip_cycle_check: true` — this is a trusted bulk path (ws.setCells,
   * table + record writes, xlsx import, range writes, ws.setCell). The
   * topological sort in Rust recalc() detects cycles; per-edge DFS here would
   * spuriously #REF! whichever formula happens to close an intentional cycle.
   * See the circular-dependency handling invariant
   */
  async setCellsByPosition(
    sheetId: SheetId,
    edits: PositionedCellInput[],
    options?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    const { normalEdits, headerRenames } = await splitTableHeaderWritesForSetCells(
      this,
      sheetId,
      edits,
    );

    await assertStrictValidationAdmission(this, sheetId, normalEdits);
    const headerResult = await this.applyTableHeaderRenames(headerRenames, options);

    if (normalEdits.length === 0) {
      return headerResult ?? emptyMutationResult();
    }

    const tuples: [SheetId, number, number, CellInput][] = normalEdits.map(
      (e) => [sheetId, e.row, e.col, e.input] as [SheetId, number, number, CellInput],
    );
    const result = await this.batchSetCellsByPosition(tuples, true, options);
    return this.applyDateFormulaFormatCompatibility(sheetId, normalEdits, result, options);
  }

  async setDateValue(
    sheetId: SheetId,
    row: number,
    col: number,
    year: number,
    month: number,
    day: number,
    options?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    await assertStrictValidationAdmission(this, sheetId, [
      {
        row,
        col,
        input: {
          kind: 'literal',
          text: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        },
      },
    ]);
    return this.core.mutatePublic(
      'compute_set_date_value',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult]>('compute_set_date_value', {
          docId: this.core.docId,
          sheetId,
          row,
          col,
          year,
          month,
          day,
        }),
      [{ sheetId, row, col }],
      options,
    );
  }

  async setTimeValue(
    sheetId: SheetId,
    row: number,
    col: number,
    hours: number,
    minutes: number,
    seconds: number,
    options?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    await assertStrictValidationAdmission(this, sheetId, [
      {
        row,
        col,
        input: {
          kind: 'literal',
          text: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
        },
      },
    ]);
    return this.core.mutatePublic(
      'compute_set_time_value',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult]>('compute_set_time_value', {
          docId: this.core.docId,
          sheetId,
          row,
          col,
          hours,
          minutes,
          seconds,
        }),
      [{ sheetId, row, col }],
      options,
    );
  }

  setTabColor(
    sheetId: SheetId,
    color: string | null,
    options?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    return this.core.mutatePublic(
      'compute_set_tab_color',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult]>('compute_set_tab_color', {
          docId: this.core.docId,
          sheetId,
          color,
        }),
      undefined,
      options,
    );
  }

  private async applyTableHeaderRenames(
    headerRenames: TableHeaderRename[],
    options?: MutationAdmissionOptions,
  ): Promise<MutationResult | null> {
    let headerResult: MutationResult | null = null;
    for (const rename of headerRenames) {
      headerResult = await this.renameTableColumn(
        rename.tableName,
        rename.columnIndex,
        rename.newName,
        options,
      );
    }
    return headerResult;
  }

  private async applyDateFormulaFormatCompatibility(
    sheetId: SheetId,
    edits: PositionedCellInput[],
    result: MutationResult,
    options?: MutationAdmissionOptions,
  ): Promise<MutationResult> {
    const dateFormulaEdits = edits.filter((edit) => isParsedTopLevelDateFormula(edit.input));
    if (dateFormulaEdits.length === 0) return result;

    const ranges: [number, number, number, number][] = [];
    for (const edit of dateFormulaEdits) {
      const [format, value] = await Promise.all([
        this.getResolvedFormat(sheetId, edit.row, edit.col),
        this.getCellValue(sheetId, edit.row, edit.col),
      ]);
      if (!hasGeneralNumberFormat(format) || typeof value !== 'number') {
        continue;
      }
      ranges.push([edit.row, edit.col, edit.row, edit.col]);
    }

    if (ranges.length === 0) return result;

    const formatResult = await this.core.mutatePublic(
      'compute_set_format_for_ranges',
      () =>
        this.core.transport.call<[Uint8Array, MutationResult]>('compute_set_format_for_ranges', {
          docId: this.core.docId,
          sheetId,
          ranges,
          format: { numberFormat: 'M/d/yyyy' },
        }),
      ranges.map(([row, col]) => ({ sheetId, row, col })),
      options,
    );
    return appendPropertyChanges(result, formatResult);
  }

  /** Patch Rust-owned workbook settings through the generated Rust bridge. */
  async patchWorkbookSettings(settings: RustWorkbookSettingsPatch): Promise<MutationResult> {
    this.core.ensureInitialized();
    if (isUiStateWorkbookSettingsPatch(settings)) {
      return this.core.mutatePublicUiState('compute_patch_workbook_settings', () =>
        this.core.transport.call<[Uint8Array, MutationResult]>('compute_patch_workbook_settings', {
          docId: this.core.docId,
          patch: settings,
        }),
      );
    }
    return super.patchWorkbookSettings(settings);
  }

  getImportDiagnostics(): Promise<WireImportDiagnostic[]> {
    this.core.ensureInitialized();
    return this.core.query(
      this.core.transport.call<WireImportDiagnostic[]>('compute_get_import_diagnostics', {
        docId: this.core.docId,
      }),
    );
  }

  getRuntimeDiagnostics(
    options: WireRuntimeDiagnosticsOptions = {},
  ): Promise<WireRuntimeDiagnosticsPage> {
    this.core.ensureInitialized();
    return this.core.query(
      this.core.transport.call<WireRuntimeDiagnosticsPage>('compute_get_runtime_diagnostics', {
        docId: this.core.docId,
        options,
      }),
    );
  }

  // resetWorkbookSettings, renameTableColumn, setCalculatedColumnFormula,
  // applyCalculatedFormulasToRow, setHyperlink, removeHyperlink
  // are mixed in from createBridgeMethods()

  // ===========================================================================
  // Theme bridge methods
  //
  // get/setWorkbookTheme are emitted by the bridge-ts generator as
  // Promise<ThemeData> / (theme: ThemeData) directly from the Rust struct in
  // `domain-types/src/domain/theme.rs`. The hand overrides that used to live
  // here were structurally identical and only existed because the generator
  // didn't know about ThemeData yet — now they would break the subclass
  // signature check (TS2416). The generated types are now authoritative.
  // ===========================================================================

  // ===========================================================================
  // wb.security — flat bridge methods (future privacy rebuild)
  //
  // Forwarders to the Rust `#[bridge::api(group = "security_ops")]` methods
  // on `YrsComputeEngine`, plus the session-level principal plumbing on
  // `ComputeService`. Auto-generated bindings are deferred to the bridge-ts
  // codegen refresh (R6 follow-up); until then these hand-written methods
  // cover the same call surface.
  // ===========================================================================

  async wbSecurityAddPolicy(policy: unknown): Promise<string> {
    await this.core.admitPublicMutation('compute_wb_security_add_policy');
    return this.core.transport.call<string>('compute_wb_security_add_policy', {
      docId: this.core.docId,
      policy,
    });
  }

  async wbSecurityRemovePolicy(id: string): Promise<void> {
    await this.core.admitPublicMutation('compute_wb_security_remove_policy');
    return this.core.transport.call<void>('compute_wb_security_remove_policy', {
      docId: this.core.docId,
      id,
    });
  }

  async wbSecurityUpdatePolicy(id: string, patch: unknown): Promise<void> {
    await this.core.admitPublicMutation('compute_wb_security_update_policy');
    return this.core.transport.call<void>('compute_wb_security_update_policy', {
      docId: this.core.docId,
      id,
      patch,
    });
  }

  wbSecurityListPolicies(): Promise<any[]> {
    this.core.ensureInitialized();
    return this.core.transport.call<any[]>('compute_wb_security_list_policies', {
      docId: this.core.docId,
    });
  }

  wbSecurityEffectiveAccess(target: unknown, principal: { tags: string[] }): Promise<string> {
    this.core.ensureInitialized();
    // Rust `wb_security_effective_access(target, principal_tags: Vec<String>)`
    // takes a flat tag list — unwrap the AccessPrincipal envelope here.
    return this.core.transport.call<string>('compute_wb_security_effective_access', {
      docId: this.core.docId,
      target,
      principalTags: principal.tags,
    });
  }

  wbSecurityExplainAccess(target: unknown, principal: { tags: string[] }): Promise<any> {
    this.core.ensureInitialized();
    return this.core.transport.call<any>('compute_wb_security_explain_access', {
      docId: this.core.docId,
      target,
      principalTags: principal.tags,
    });
  }

  async wbSecurityApplyTemplate(template: unknown): Promise<string[]> {
    await this.core.admitPublicMutation('compute_wb_security_apply_template');
    return this.core.transport.call<string[]>('compute_wb_security_apply_template', {
      docId: this.core.docId,
      template,
    });
  }

  async wbSecurityRemoveTemplate(templateId: string): Promise<void> {
    await this.core.admitPublicMutation('compute_wb_security_remove_template');
    return this.core.transport.call<void>('compute_wb_security_remove_template', {
      docId: this.core.docId,
      templateId,
    });
  }

  /**
   * Drain and return every pending `SecurityEvent` from the engine's
   * ring buffer (security event relay). SDK consumers poll this on a
   * cadence via `createSecurityEventRelay` (kernel-context wires one
   * per document) and re-emit on the kernel event bus.
   *
   * The return type is the raw tagged-enum shape serialised by
   * `compute_security::SecurityEvent` — the `RawSecurityEvent` union
   * in `contracts/src/events/security-events.ts` mirrors it one-to-
   * one. Callers that need the kernel event-bus shape should go
   * through the relay rather than shaping by hand.
   */
  wbSecurityDrainEvents(): Promise<RawSecurityEvent[]> {
    this.core.ensureInitialized();
    return this.core.transport.call<RawSecurityEvent[]>('compute_wb_security_drain_events', {
      docId: this.core.docId,
    });
  }

  // ---------------------------------------------------------------------------
  // Session-level principal plumbing (R2).
  //
  // `setActivePrincipal` accepts the principal shape `{ tags: string[] }` or
  // null to clear. `makePrincipal` interns a tag list through the Rust
  // PrincipalPool so pointer-identity caching stays sound. `activePrincipal`
  // and `securityActive` are primarily diagnostic.
  // ---------------------------------------------------------------------------

  setActivePrincipal(principal: { tags: string[] } | null): Promise<void> {
    // Rust `set_active_principal(tags: Option<Vec<String>>)` wants a flat
    // tag array (or null). Unwrap the `{ tags }` envelope here.
    return this.core.transport.call<void>('compute_set_active_principal', {
      docId: this.core.docId,
      tags: principal?.tags ?? null,
    });
  }

  async activePrincipal(): Promise<{ tags: string[] } | null> {
    // Rust returns `Option<Vec<String>>` — re-wrap into AccessPrincipal
    // shape so SDK callers see a consistent `{ tags }` envelope.
    const tags = await this.core.transport.call<string[] | null>('compute_active_principal', {
      docId: this.core.docId,
    });
    return tags === null ? null : { tags };
  }

  securityActive(): Promise<boolean> {
    return this.core.transport.call<boolean>('compute_security_active', {
      docId: this.core.docId,
    });
  }

  async makePrincipal(tags: string[]): Promise<{ tags: string[] }> {
    // Rust returns the canonical (sorted+deduped) `Vec<String>` flat list;
    // re-wrap for caller consistency.
    const canonical = await this.core.transport.call<string[]>('compute_make_principal', {
      docId: this.core.docId,
      tags,
    });
    return { tags: canonical };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ComputeBridge with automatic backend detection.
 *
 * - Tauri desktop: uses native Rust via IPC
 * - Web: uses Rust compiled to WASM
 *
 * Always returns a ComputeBridge. No fallback to TS calculator.
 *
 * Transport creation is delegated to `platform/transport/factory.ts`.
 * WASM init callbacks (initTableWasm, initChartWasm) are passed through
 * so the platform layer doesn't depend on kernel-specific bridges.
 *
 * @param config - Optional transport config (e.g., wasmInitFns for table/chart wiring)
 */
export async function createComputeBridge(
  ctx: IKernelContext,
  docId: string,
  config?: TransportConfig,
): Promise<ComputeBridge> {
  // Forward the session's userTimezone into transport time-injection so that
  // NOW()/TODAY() and any other clock-dependent Rust evaluation reads the
  // user's calendar today, not the host process's. The callback shape (rather
  // than a fixed string) means future ctx.userTimezone changes propagate
  // automatically.
  const transport = await createTransport({
    ...config,
    getUserTimezone: config?.getUserTimezone ?? (() => ctx.userTimezone),
  });
  return new ComputeBridge(ctx, docId, transport);
}

/**
 * Create a ComputeBridge from an existing BridgeTransport.
 *
 * Used by the headless package to create a bridge with a napi transport
 * instead of auto-detecting Tauri/WASM.
 */
export function createComputeBridgeFromTransport(
  ctx: IKernelContext,
  docId: string,
  transport: BridgeTransport,
): ComputeBridge {
  return new ComputeBridge(ctx, docId, transport);
}

// =============================================================================
// Standalone Schema API (stateless — no ComputeBridge instance needed)
// =============================================================================

/** Shared transport for standalone schema calls. */
let schemaTransport: BridgeTransport | null = null;

/**
 * Get (or create) a transport for stateless schema operations.
 * Delegates to platform/transport for auto-detection.
 */
async function getSchemaTransport(): Promise<BridgeTransport> {
  if (schemaTransport) return schemaTransport;
  schemaTransport = await createTransport();
  return schemaTransport;
}

/**
 * Validate a value against a column schema using the Rust schema engine.
 * Standalone function — no ComputeBridge instance needed.
 */
export async function rustSchemaValidate(
  value: CellValue,
  schema: ColumnSchemaWire,
): Promise<ValidationResultWire> {
  const t = await getSchemaTransport();
  return t.call<ValidationResultWire>('compute_schema_validate', { value, schema });
}

/**
 * Resolve the editor type for a cell using the Rust schema engine.
 * Standalone function — no ComputeBridge instance needed.
 */
export async function rustSchemaResolveEditor(
  input: EditorTypeResolutionInputWire,
): Promise<EditorTypeResolutionResultWire> {
  const t = await getSchemaTransport();
  return t.call<EditorTypeResolutionResultWire>('compute_schema_resolve_editor', { input });
}

/**
 * Infer the semantic type of a single value using the Rust schema engine.
 * Standalone function — no ComputeBridge instance needed.
 */
export async function rustSchemaInferType(value: CellValue): Promise<SchemaTypeWire> {
  const t = await getSchemaTransport();
  return t.call<SchemaTypeWire>('compute_schema_infer_type', { value });
}

/**
 * Infer a column schema from sample values using the Rust schema engine.
 * Standalone function — no ComputeBridge instance needed.
 */
export async function rustSchemaInferColumn(values: CellValue[]): Promise<InferredSchemaWire> {
  const t = await getSchemaTransport();
  return t.call<InferredSchemaWire>('compute_schema_infer_column', { values });
}

// Bridge client type stubs — now in compute-wire-types.ts, re-exported above.
