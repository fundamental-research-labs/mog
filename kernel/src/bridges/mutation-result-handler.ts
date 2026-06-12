/**
 * MutationResultHandler — Centralized processor for MutationResult objects
 * returned from Rust IPC commands.
 *
 * All mutations flow through Rust:
 *   1. TS calls Rust IPC command (e.g., compute_set_cell)
 *   2. Rust mutates Yrs + recalculates
 *   3. MutationResult returned to TS
 *   4. MutationResultHandler processes it:
 *      a. Patches per-viewport buffers with dimension changes
 *      b. Emits EventBus events for reactive rendering
 *
 * @see kernel/src/bridges/compute/compute-bridge.ts - MutationResult type definitions
 */

import {
  type CellValue as ContractCellValue,
  type PolicyPreservedParseOutcome as ContractPolicyPreservedParseOutcome,
  type PrintSettings as ContractPrintSettings,
  type RangeId,
  type SheetId,
  type SheetSettings,
  type WorkbookSettings,
  sheetId as toSheetId,
} from '@mog-sdk/contracts/core';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type {
  CellChangedEvent,
  CellFormatChangedEvent,
  CellsBatchChangedEvent,
  FilterCapability,
  FilterKind,
  IEventBus,
  ImportFilterUnsupportedReason,
  PivotUpdateOptions,
} from '@mog-sdk/contracts/events';
import type {
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  RuntimeOperationDiagnostic as PublicRuntimeOperationDiagnostic,
} from '@mog-sdk/contracts/data/diagnostics';
import type {
  FloatingObject,
  FloatingObjectGroup,
  FloatingObjectKind,
} from '@mog-sdk/contracts/floating-objects';

import type { ViewportCoordinatorRegistry } from './wire/viewport-coordinator-registry';
import type { CellMetadataCache } from './wire/cell-metadata-cache';
import { toDisposable, type CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import {
  decodeRangeMetaJson,
  type RangeMetadataCache,
  type RangeMeta,
} from './wire/range-metadata-cache';
import { ChangeAccumulator } from '../api/worksheet/change-accumulator';
import { VIEW_OPTION_KEYS } from '../domain/workbook/core-defaults';
import type { StateMirror } from '../document/state-mirror';
import type {
  CellChange,
  CfChange,
  CommentChange,
  DimensionChange,
  FilterChange,
  FloatingObjectChange,
  GroupingChange,
  MergeChange,
  MutationResult,
  NamedRangeChange,
  PageBreakChange,
  PivotTableChange,
  PolicyPreservedParseOutcome as WirePolicyPreservedParseOutcome,
  PrintAreaChange,
  PrintSettingsChange,
  PrintTitlesChange,
  PropertyChange,
  RangeChange,
  RecalcResult,
  RuntimeOperationDiagnostic as WireRuntimeOperationDiagnostic,
  ScrollPositionChange,
  SheetChange,
  SheetLifecycleRuntimeHint,
  SheetSettingsChange,
  SlicerChange,
  SortingChange,
  SparklineChange,
  SplitConfigChange,
  StructureChangeResult,
  TableChange,
  VisibilityChange,
  WorkbookSettingsChange,
} from './compute/compute-types.gen';
import { toFloatingObject, toFloatingObjectGroup } from './compute/floating-object-mapper';
import type {
  FloatingObjectChangeKind,
  SerializedFloatingObjectGroup as WireFloatingObjectGroup,
} from './compute/compute-types.gen';

function toEventFilterKind(value: string | undefined): FilterKind | undefined {
  if (value === 'autoFilter' || value === 'tableFilter' || value === 'advancedFilter') {
    return value;
  }
  return undefined;
}

function toEventFilterCapability(value: string | undefined): FilterCapability | undefined {
  if (value === 'supported' || value === 'unsupported') {
    return value;
  }
  return undefined;
}

const IMPORT_FILTER_UNSUPPORTED_REASONS = new Set<string>([
  'unknownDynamicType',
  'unknownCustomOperator',
  'dateGroupUnsupported',
  'dynamicTemporalContextUnsupported',
  'valueTokenUnresolved',
  'valueTypeUnsupported',
  'colorDxfUnresolved',
  'iconFilterUnsupported',
  'unknownExtension',
  'tableFilterShapeUnsupported',
]);

function toEventUnsupportedReasons(
  values: string[] | undefined,
): ImportFilterUnsupportedReason[] | undefined {
  if (!values?.length) return undefined;
  const reasons = values.filter((value): value is ImportFilterUnsupportedReason =>
    IMPORT_FILTER_UNSUPPORTED_REASONS.has(value),
  );
  return reasons.length > 0 ? reasons : undefined;
}

function toPublicRuntimeDiagnostic(
  diagnostic: WireRuntimeOperationDiagnostic,
): PublicRuntimeOperationDiagnostic {
  return {
    ...diagnostic,
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    filterKind: toEventFilterKind(diagnostic.filterKind),
  };
}

function normalizeRuntimeDiagnosticsLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return RUNTIME_DIAGNOSTIC_RETENTION;
  return Math.max(0, Math.min(RUNTIME_DIAGNOSTIC_RETENTION, Math.trunc(limit)));
}

function parseRuntimeDiagnosticSequence(sequence: string | undefined): bigint | null {
  if (sequence == null || sequence.trim() === '') return null;
  try {
    return BigInt(sequence);
  } catch {
    return null;
  }
}

type ByteLike = Uint8Array | ArrayBuffer | number[] | { type?: string; data?: number[] };

const rangeMetaDecoder = new TextDecoder();
const RUNTIME_DIAGNOSTIC_RETENTION = 1024;

function bytesFromBridge(value: ByteLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Uint8Array.from(value.data);
  }
  throw new TypeError(`Unsupported byte payload shape: ${Object.prototype.toString.call(value)}`);
}

function decodeRangeMeta(data: RangeChange['data']): RangeMeta {
  return decodeRangeMetaJson(
    JSON.parse(rangeMetaDecoder.decode(bytesFromBridge(data as ByteLike))),
  );
}

function normalizeSheetSettingsChangedKey(changedKey: string): string {
  // Rust storage uses a nested `protectionDetails` Y.Map, while the public
  // SheetSettings snapshot exposes protection through derived public fields.
  return changedKey === 'protectionDetails' ? 'protectionOptions' : changedKey;
}

function toContractPolicyPreservedParseOutcome(
  outcome: WirePolicyPreservedParseOutcome,
): ContractPolicyPreservedParseOutcome {
  return {
    ...outcome,
    sheetId: toSheetId(outcome.sheetId),
    cellId: toCellId(outcome.cellId),
  };
}

// =============================================================================
// Refined type for floating-object group changes.
//
// The generated MutationResult reuses FloatingObjectChange[] for
// floatingObjectGroupChanges, but Rust actually sends
// SerializedFloatingObjectGroup in the `data` field. This refined
// interface provides correct typing so we can avoid `as unknown as` casts.
// =============================================================================

interface FloatingObjectGroupChange {
  sheetId: string;
  objectId: string;
  kind: FloatingObjectChangeKind;
  data?: WireFloatingObjectGroup;
}

export type MutationResultWithSheetLifecycleRuntimeHint = MutationResult & {
  sheetLifecycleRuntimeHint?: SheetLifecycleRuntimeHint | null;
};

export interface SheetRuntimeAdapterContext {
  beforeActive: SheetId | null;
  beforeActiveVisibleIndex: number;
  source: MutationSource;
}

export interface SheetRuntimeAdapter {
  captureContext(): Omit<SheetRuntimeAdapterContext, 'source'>;
  apply(
    result: MutationResultWithSheetLifecycleRuntimeHint,
    context: SheetRuntimeAdapterContext,
  ): void;
}

// =============================================================================
// Domain Change Source Type
// =============================================================================

// Re-exported from ./mutation-source so existing importers (which pulled
// `MutationSource` from this file) keep working. The canonical declaration
// lives in the leaf module to avoid the mutation-result-handler ↔
// change-accumulator cycle.
export type { MutationSource } from './mutation-source';
import type { MutationSource } from './mutation-source';

/** Error info from a failed mutation. */
export interface MutationError {
  /** What operation failed (e.g., 'setCellFormat', 'mergeCells'). */
  operation: string;
  /** Error message from Rust. */
  message: string;
  /** Original error object if available. */
  cause?: unknown;
}

interface DirectCellEditPosition {
  sheetId: string;
  row: number;
  col: number;
}

// =============================================================================
// Cell Position Resolver
// =============================================================================

/**
 * Normalizes a position from Rust. Rust now sends `position: CellPosition | null`
 * directly (the resolved-position fix eliminated the `u32::MAX` sentinel). Callers
 * MUST treat `null` as "skip this change" — emitting a fallback event at row:0
 * / col:0 was a live bug that painted spurious A1 updates in subscribers.
 */
function resolvedPosition(
  position: { row: number; col: number } | null | undefined,
): { row: number; col: number } | null {
  return position ?? null;
}

// =============================================================================
// MutationResultHandler
// =============================================================================

/**
 * Centralized handler for processing MutationResult objects from Rust IPC.
 *
 * Responsibilities:
 * 1. Patch per-viewport buffers for dimension changes within the visible area
 * 2. Emit EventBus events for reactive rendering
 *
 * Usage:
 * ```typescript
 * const handler = new MutationResultHandler(eventBus);
 * const result = await bridge.setCellFormat(sheetId, cellId, format);
 * handler.applyAndNotify(result);
 * ```
 */
export class MutationResultHandler {
  private coordinatorRegistry: ViewportCoordinatorRegistry | null = null;
  private eventBus: IEventBus;
  private cellMetadataCache: CellMetadataCache | null = null;
  private rangeMetadataCache: RangeMetadataCache | null = null;
  private onUndoDescription?: (description: string) => void;
  private pivotUpdateOptionsStack: PivotUpdateOptions[] = [];
  private sheetRuntimeAdapters = new Map<string, SheetRuntimeAdapter>();
  private runtimeDiagnostics: PublicRuntimeOperationDiagnostic[] = [];
  private runtimeDiagnosticsEvicted = false;

  /**
   * Kernel state mirror — single sync read view of bounded direct workbook/
   * sheet state. The handler holds the writable `StateMirror` reference
   * (constructor-injected via `setStateMirror`); ESLint rule
   * `no-mirror-apply-outside-handler` is the secondary
   * layer that catches casts at non-handler call sites.
   *
   * `applyAndNotify` calls `this.stateMirror?.apply(result)` BEFORE any
   * event emission so subscribers re-rendering on those events read
   * post-mutation state on their first re-read (Pillar 1, pinned by
   * the apply-then-emit unit test).
   *
   * Null until wired by `compute-core.initMutationHandler`. Tests that do
   * not exercise mirror behavior leave it null and rely on the apply being
   * a no-op.
   */
  private stateMirror: StateMirror | null = null;

  /** Error callbacks for mutation failures. */
  private errorCallbacks: Array<(error: MutationError) => void> = [];

  withPivotUpdateOptions<T>(options: PivotUpdateOptions, fn: () => Promise<T>): Promise<T> {
    this.pivotUpdateOptionsStack.push(options);
    return fn().finally(() => {
      this.pivotUpdateOptionsStack.pop();
    });
  }

  /** Change accumulator for opt-in change tracking (ws.changes.track()). */
  readonly changeAccumulator: ChangeAccumulator;

  constructor(eventBus: IEventBus, onUndoDescription?: (description: string) => void) {
    this.eventBus = eventBus;
    this.onUndoDescription = onUndoDescription;
    this.changeAccumulator = new ChangeAccumulator();
  }

  /** Set the ViewportCoordinatorRegistry for per-viewport dimension patching. */
  setCoordinatorRegistry(registry: ViewportCoordinatorRegistry | null): void {
    this.coordinatorRegistry = registry;
  }

  /** Set the CellMetadataCache for sync render loop patching. */
  setCellMetadataCache(cache: CellMetadataCache | null): void {
    this.cellMetadataCache = cache;
  }

  /** Set the RangeMetadataCache for first-class range lifecycle tracking. */
  setRangeMetadataCache(cache: RangeMetadataCache | null): void {
    this.rangeMetadataCache = cache;
  }

  /**
   * Wire the kernel state mirror. Called once at bridge bootstrap time
   * from `compute-core.initMutationHandler`. The handler keeps the
   * writable `StateMirror` reference (not `MirrorReadView`) so it can call
   * `apply()`; the public `DocumentContext.mirror` surface is the
   * read-only narrowed view.
   *
   * This is the SOLE approved boundary where the writable mirror crosses
   * out of the kernel-context factory. mirror-apply lint guard (ESLint
   * `no-mirror-apply-outside-handler`) flags any other site that
   * dereferences `.apply` on a value typed as `StateMirror` /
   * `MirrorReadView`.
   */
  setStateMirror(mirror: StateMirror | null): void {
    this.stateMirror = mirror;
  }

  getRuntimeDiagnostics(options: RuntimeDiagnosticsOptions = {}): RuntimeDiagnosticsPage {
    const limit = normalizeRuntimeDiagnosticsLimit(options.limit);
    const since = parseRuntimeDiagnosticSequence(options.sinceSequence);
    const firstRetained = parseRuntimeDiagnosticSequence(this.runtimeDiagnostics[0]?.sequence);
    const filtered =
      since == null
        ? this.runtimeDiagnostics
        : this.runtimeDiagnostics.filter((diagnostic) => {
            const sequence = parseRuntimeDiagnosticSequence(diagnostic.sequence);
            return sequence != null && sequence > since;
          });
    const diagnostics = filtered.slice(0, limit);
    const last = diagnostics.at(-1);
    const truncated =
      this.runtimeDiagnosticsEvicted &&
      (since == null || firstRetained == null || since < firstRetained);

    return {
      diagnostics,
      nextSequence: last?.sequence,
      truncated,
    };
  }

  private recordRuntimeDiagnostics(
    diagnostics: WireRuntimeOperationDiagnostic[] | undefined,
  ): void {
    if (!diagnostics?.length) return;
    this.runtimeDiagnostics.push(...diagnostics.map(toPublicRuntimeDiagnostic));
    if (this.runtimeDiagnostics.length > RUNTIME_DIAGNOSTIC_RETENTION) {
      this.runtimeDiagnostics = this.runtimeDiagnostics.slice(-RUNTIME_DIAGNOSTIC_RETENTION);
      this.runtimeDiagnosticsEvicted = true;
    }
  }

  registerSheetRuntimeAdapter(ownerKey: string, adapter: SheetRuntimeAdapter): CallableDisposable {
    this.sheetRuntimeAdapters.set(ownerKey, adapter);
    return toDisposable(() => {
      if (this.sheetRuntimeAdapters.get(ownerKey) === adapter) {
        this.sheetRuntimeAdapters.delete(ownerKey);
      }
    });
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Process a MutationResult from any IPC command.
   *
   * Steps:
   * 1. Patch per-viewport buffers for dimension changes (immediate rendering)
   * 2. Emit EventBus events for reactive subscribers
   *
   * @param result - MutationResult from a Rust IPC command
   * @param source - Whether this mutation originated from the local user or remote collaboration
   * @param directEdits - Optional positions of directly-written cells (to distinguish direct vs cascade)
   */
  applyAndNotify(
    result: MutationResult,
    source: MutationSource = 'user',
    directEdits?: DirectCellEditPosition[],
  ): void {
    // ── Pillar 1: apply BEFORE emit ───────────────────────────────────────────
    //
    // The kernel state mirror absorbs every in-scope `MutationResult` variant
    // (sheet meta, sheet settings, page breaks, print area/titles/settings,
    // split config, scroll position, workbook settings) BEFORE any per-variant
    // event is emitted. Hooks that re-render on those events must therefore
    // see post-mutation state on their first re-read — pinned by the
    // apply-then-emit unit test in `__tests__/state-mirror.test.ts`. A
    // regression that swaps the order produces visibly stale renders for one
    // frame and is hard to spot in code review.
    //
    // Cell-value changes (recalc/projectionChanges) are owned by
    // BinaryViewportBuffer / CellMetadataCache, not the mirror — they ride
    // their own patch path below. The mirror covers ONLY bounded direct
    // workbook/sheet state.
    //
    // No-op when the mirror isn't wired (test setup that doesn't exercise
    // mirror behavior). See `setStateMirror` for the single approved
    // boundary that crosses the read-only / writable type split.
    const sheetRuntimeContexts =
      this.sheetRuntimeAdapters.size > 0
        ? Array.from(this.sheetRuntimeAdapters.entries(), ([ownerKey, adapter]) => ({
            ownerKey,
            context: adapter.captureContext(),
          }))
        : [];

    this.stateMirror?.apply(result);
    this.recordRuntimeDiagnostics(result.diagnostics);

    if (sheetRuntimeContexts.length > 0) {
      const resultWithHint = result as MutationResultWithSheetLifecycleRuntimeHint;
      for (const { ownerKey, context } of sheetRuntimeContexts) {
        this.sheetRuntimeAdapters.get(ownerKey)?.apply(resultWithHint, { ...context, source });
      }
    }

    // 1. Cell value changes (from recalc)
    if (result.recalc) {
      this.handleRecalcResult(result.recalc, source);
    }
    if (directEdits?.length) {
      this.emitMissingDirectEditCellEvents(directEdits, result.recalc, source);
    }

    // 2. Structure changes (must be first — they affect row/column indices)
    if (result.structureChanges?.length) {
      this.handleStructureChanges(result.structureChanges, source);
    }

    // 3. Domain-specific changes
    if (result.propertyChanges?.length) {
      this.handlePropertyChanges(result.propertyChanges, source);
    }
    if (result.dimensionChanges?.length) {
      this.handleDimensionChanges(result.dimensionChanges, source);
    }
    if (result.mergeChanges?.length) {
      this.handleMergeChanges(result.mergeChanges, source);
    }
    if (result.visibilityChanges?.length) {
      this.handleVisibilityChanges(result.visibilityChanges, source);
    }
    if (result.commentChanges?.length) {
      this.handleCommentChanges(result.commentChanges, source);
    }
    if (result.filterChanges?.length) {
      this.handleFilterChanges(result.filterChanges, source);
    }
    if (result.tableChanges?.length) {
      this.handleTableChanges(result.tableChanges, source);
    }
    if (result.slicerChanges?.length) {
      this.handleSlicerChanges(result.slicerChanges, source);
    }
    if (result.sheetChanges?.length) {
      this.handleSheetChanges(result.sheetChanges, source);
    }
    if (result.settingsChanges?.length) {
      this.handleSettingsChanges(result.settingsChanges, source);
    }
    // ── Direct workbook/sheet state coverage (Rust contract 8747f39e3) ────────
    // Each family below was added to MutationResult by the
    // mutation-result-coverage-rust plan. The kernel state mirror has
    // already absorbed these variants at the top of `applyAndNotify`
    // (Pillar 1: `mirror.apply(result)` runs BEFORE every emit) — the
    // per-handler branches below are pure event normalization.
    if (result.pageBreakChanges?.length) {
      this.handlePageBreakChanges(result.pageBreakChanges, source);
    }
    if (result.printAreaChanges?.length) {
      this.handlePrintAreaChanges(result.printAreaChanges, source);
    }
    if (result.printTitlesChanges?.length) {
      this.handlePrintTitlesChanges(result.printTitlesChanges, source);
    }
    if (result.printSettingsChanges?.length) {
      this.handlePrintSettingsChanges(result.printSettingsChanges, source);
    }
    if (result.splitConfigChanges?.length) {
      this.handleSplitConfigChanges(result.splitConfigChanges, source);
    }
    if (result.scrollPositionChanges?.length) {
      this.handleScrollPositionChanges(result.scrollPositionChanges, source);
    }
    if (result.workbookSettingsChanges?.length) {
      this.handleWorkbookSettingsChanges(result.workbookSettingsChanges, source);
    }
    this.handlePolicyPreservedParseOutcomes(result, source);
    if (result.cfChanges?.length) {
      this.handleCfChanges(result.cfChanges, source);
    }
    if (result.namedRangeChanges?.length) {
      this.handleNamedRangeChanges(result.namedRangeChanges, source);
    }
    if (result.groupingChanges?.length) {
      this.handleGroupingChanges(result.groupingChanges, source);
    }
    if (result.sparklineChanges?.length) {
      this.handleSparklineChanges(result.sparklineChanges, source);
    }
    if (result.sortingChanges?.length) {
      this.handleSortingChanges(result.sortingChanges, source);
    }
    if (result.floatingObjectChanges?.length) {
      this.handleFloatingObjectChanges(result.floatingObjectChanges, source);
    }
    if (result.floatingObjectGroupChanges?.length) {
      // The generated type reuses FloatingObjectChange[] for group changes,
      // but Rust sends SerializedFloatingObjectGroup in the data field.
      // FloatingObjectGroupChange refines the data type to match the wire reality.
      // Safe: both share {sheetId, objectId, kind} — only `data` differs.
      this.handleFloatingObjectGroupChanges(
        result.floatingObjectGroupChanges as FloatingObjectGroupChange[],
        source,
      );
    }
    if (result.pivotChanges?.length) {
      this.handlePivotChanges(result.pivotChanges, source);
    }
    if (result.rangeChanges?.length) {
      this.handleRangeChanges(result.rangeChanges, source);
    }

    // 4. Undo description (for undo stack UI)
    if (result.undoDescription) {
      this.handleUndoDescription(result.undoDescription);
    }

    // 5. Feed change accumulators for opt-in tracking (ws.changes.track())
    if (this.changeAccumulator.activeCount > 0 && result.recalc?.changedCells?.length) {
      const cells = result.recalc.changedCells;

      // ---------------------------------------------------------------------------
      // DESIGN NOTE: Dual old_value capture paths (L3)
      //
      // There are two mechanisms that populate old cell values, both feeding into
      // `result.oldValues` (a `Record<"sheetId:cellId", CellValue>`):
      //
      // 1. **CellMirror read-before-write (Rust, CANONICAL)**
      //    In `cell_editing.rs`, each write function (set_cell_value_parsed,
      //    set_cell_value_as_text, set_cell_values_parsed, import_values, set_cell)
      //    snapshots `mirror.get_cell_value(&cell_id)` BEFORE calling
      //    `mirror.apply_edit()` or `cell_values::set_cell_value()`. The snapshot
      //    is patched onto `RecalcResult.changed_cells[].old_value` for direct edits.
      //    For cascade changes (formula dependents), `epoch_cache.rs` snapshots values
      //    before the recalc engine overwrites them.
      //
      // 2. **Observer/mutation_handlers threading (Rust, SECONDARY)**
      //    In `mutation_handlers.rs`, the `build_mutation_result()` function iterates
      //    `changes.cells` and copies any `cell_change.old_value` (already set by
      //    path #1) into `MutationResult.old_values`. This is a passthrough that
      //    re-keys the data as "sheetId:cellId" for the TS bridge.
      //
      // Path #1 (CellMirror) is canonical. The original observer-based approach
      // (using yrs `EntryChange::Updated(old, new)` in `observe.rs`) was abandoned
      // because production writes use depth-2 cell replacement (`cells_map.insert`),
      // which orphans the old YMap before the observer callback fires, causing old
      // values to be None. See `the dirty-cell featurization invariant`
      // for the full history. The field was renamed from `observer_old_values` to
      // `old_values` to reflect that the data source is now the CellMirror, not the
      // yrs observer.
      //
      // Both paths are needed: #1 captures the values, #2 threads them through the
      // MutationResult bridge to reach this TS-side merge point. They are not
      // redundant — they are sequential stages of the same pipeline.
      // ---------------------------------------------------------------------------

      // Merge old values into changedCells so ChangeAccumulator can
      // populate DirtyCell.oldValue for "old → new" transition display.
      if (result.oldValues) {
        const oldValues = result.oldValues;
        for (const cell of cells) {
          const key = `${cell.sheetId}:${cell.cellId}`;
          if (key in oldValues) {
            cell.oldValue = oldValues[key];
          }
        }
      }

      // Flatten `position: CellPosition | null` to the row/col shape expected
      // by `ChangeAccumulator.ingest`. Unresolved positions are dropped: the
      // accumulator keys on (sheetId, row, col), so a synthetic fallback
      // would collide with real A1 cells.
      const accumulatorCells = cells
        .map((c) => {
          if (!c.position) return null;
          return {
            sheetId: c.sheetId,
            row: c.position.row,
            col: c.position.col,
            value: c.value,
            oldValue: c.oldValue,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (accumulatorCells.length > 0) {
        this.changeAccumulator.ingest(accumulatorCells, directEdits ?? null, source);
      }
    }
  }

  private handlePolicyPreservedParseOutcomes(result: MutationResult, source: MutationSource): void {
    if (!result.policyPreservedParseSummary) {
      return;
    }
    this.eventBus.emit({
      type: 'workbook:policy-preserved',
      timestamp: Date.now(),
      outcomes:
        result.policyPreservedParseOutcomes?.map(toContractPolicyPreservedParseOutcome) ?? [],
      summary: result.policyPreservedParseSummary,
      source: source === 'user' ? 'user' : 'remote',
    });
  }

  /**
   * Register an error callback for mutation failures.
   *
   * When a fire-and-forget mutation is rejected by Rust (e.g., merge conflict,
   * protection violation), the error is surfaced via these callbacks.
   * The UI layer registers a callback to show error toasts.
   *
   * @param callback - Called with error details when a mutation fails
   * @returns Unsubscribe function
   */
  onError(callback: (error: MutationError) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const idx = this.errorCallbacks.indexOf(callback);
      if (idx !== -1) this.errorCallbacks.splice(idx, 1);
    };
  }

  // ===========================================================================
  // Recalc Result (Cell Values)
  // ===========================================================================

  private handleRecalcResult(recalc: RecalcResult, source: MutationSource): void {
    const hasChanges = recalc.changedCells.length > 0 || recalc.projectionChanges.length > 0;
    if (!hasChanges) return;

    // Patch CellMetadataCache for sync render loop
    if (this.cellMetadataCache && recalc.projectionChanges.length > 0) {
      this.cellMetadataCache.patchProjectionChanges(recalc.projectionChanges);
    }

    this.emitCellChangeEvents(recalc.changedCells, source);
  }

  private emitMissingDirectEditCellEvents(
    directEdits: DirectCellEditPosition[],
    recalc: RecalcResult | undefined | null,
    source: MutationSource,
  ): void {
    const emittedKeys = new Set<string>();
    for (const change of recalc?.changedCells ?? []) {
      const pos = resolvedPosition(change.position);
      if (pos) {
        emittedKeys.add(`${change.sheetId}:${pos.row}:${pos.col}`);
      }
    }

    const missing = directEdits.filter(
      (edit) => !emittedKeys.has(`${edit.sheetId}:${edit.row}:${edit.col}`),
    );
    if (missing.length === 0) return;

    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'formula' : 'remote';
    const bySheet = new Map<string, DirectCellEditPosition[]>();
    for (const edit of missing) {
      let sheetEdits = bySheet.get(edit.sheetId);
      if (!sheetEdits) {
        sheetEdits = [];
        bySheet.set(edit.sheetId, sheetEdits);
      }
      sheetEdits.push(edit);
    }

    for (const [sheetId, sheetEdits] of bySheet) {
      if (sheetEdits.length === 1) {
        const edit = sheetEdits[0];
        const cellEvent: CellChangedEvent = {
          type: 'cell:changed',
          timestamp,
          sheetId,
          row: edit.row,
          col: edit.col,
          oldValue: undefined,
          newValue: undefined,
          source: eventSource,
        };
        this.eventBus.emit(cellEvent);
      } else {
        const batchEvent: CellsBatchChangedEvent = {
          type: 'cells:batch-changed',
          timestamp,
          sheetId,
          changes: sheetEdits.map((edit) => ({
            row: edit.row,
            col: edit.col,
            oldValue: undefined,
            newValue: undefined,
          })),
          source: eventSource,
        };
        this.eventBus.emit(batchEvent);
      }
    }
  }

  private emitCellChangeEvents(changes: CellChange[], source: MutationSource): void {
    if (changes.length === 0) return;

    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'formula' : 'remote';

    // Group changes by sheet for batch events
    const changesBySheet = new Map<string, CellChange[]>();
    for (const change of changes) {
      let group = changesBySheet.get(change.sheetId);
      if (!group) {
        group = [];
        changesBySheet.set(change.sheetId, group);
      }
      group.push(change);
    }

    for (const [sheetId, sheetChanges] of changesBySheet) {
      // Filter to only changes with a resolved position. Previously we fell
      // back to { row: 0, col: 0 } for unresolved
      // positions, which emitted a spurious A1 `cell:changed` event — any UI
      // subscriber would mis-paint A1 whenever a mutation produced a change
      // the engine couldn't map back to a grid index (e.g. cascade on a cell
      // whose position was torn down).
      const resolvedChanges: Array<{
        change: CellChange;
        pos: { row: number; col: number };
      }> = [];
      for (const change of sheetChanges) {
        const pos = resolvedPosition(change.position);
        if (pos === null) continue;
        resolvedChanges.push({ change, pos });
      }
      if (resolvedChanges.length === 0) continue;

      if (resolvedChanges.length === 1) {
        const { change, pos } = resolvedChanges[0];
        const cellEvent: CellChangedEvent = {
          type: 'cell:changed',
          timestamp,
          sheetId,
          row: pos.row,
          col: pos.col,
          oldValue: undefined,
          newValue: change.value as ContractCellValue | undefined,
          source: eventSource,
        };
        this.eventBus.emit(cellEvent);
      } else {
        const batchEvent: CellsBatchChangedEvent = {
          type: 'cells:batch-changed',
          timestamp,
          sheetId,
          changes: resolvedChanges.map(({ change, pos }) => ({
            row: pos.row,
            col: pos.col,
            oldValue: undefined,
            newValue: change.value as ContractCellValue | undefined,
          })),
          source: eventSource,
        };
        this.eventBus.emit(batchEvent);
      }
    }
  }

  // ===========================================================================
  // Property Changes (Cell Format)
  // ===========================================================================

  private handlePropertyChanges(changes: PropertyChange[], source: MutationSource): void {
    // Viewport buffer is already patched by the binary mutation blob in mutateCore()
    // (Rust's produce_format_change_patches includes format_idx + displayText).
    // This method only emits events for non-viewport consumers (toolbar, cell property subscriptions).

    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      const pos = resolvedPosition(change.position);
      if (!pos) continue;

      const formatEvent: CellFormatChangedEvent = {
        type: 'cell:format-changed',
        timestamp,
        sheetId: change.sheetId,
        row: pos.row,
        col: pos.col,
        oldFormat: undefined,
        newFormat:
          change.kind === 'Set'
            ? (change.format as CellFormatChangedEvent['newFormat'])
            : undefined,
        source: eventSource,
      };
      this.eventBus.emit(formatEvent);
    }
  }

  // ===========================================================================
  // Dimension Changes (Row Height / Column Width)
  // ===========================================================================

  private handleDimensionChanges(changes: DimensionChange[], source: MutationSource): void {
    // Patch viewport: update row/column dimensions in the buffer
    this.patchDimensionChanges(changes);

    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      if (change.axis === 'row' && change.kind === 'Set' && change.size != null) {
        this.eventBus.emit({
          type: 'row:height-changed',
          timestamp,
          sheetId: change.sheetId,
          row: change.index,
          oldHeight: 0,
          newHeight: change.size,
          source: eventSource,
        });
      } else if (change.axis === 'col' && change.kind === 'Set' && change.size != null) {
        this.eventBus.emit({
          type: 'column:width-changed',
          timestamp,
          sheetId: change.sheetId,
          col: change.index,
          oldWidth: 0,
          newWidth: change.size,
          source: eventSource,
        });
      }
    }
  }

  private patchDimensionChanges(changes: DimensionChange[]): void {
    if (this.coordinatorRegistry) {
      for (const coordinator of this.coordinatorRegistry.getAllCoordinators()) {
        const bounds = coordinator.getBounds();
        const bufferSheetId = bounds?.sheetId;
        for (const change of changes) {
          if (change.sheetId !== bufferSheetId) continue;
          if (change.kind === 'Set' && change.size != null) {
            coordinator.applyDimensionPatch(
              change.axis as 'row' | 'col',
              change.index,
              change.size,
              false,
            );
          }
        }
      }
    }
  }

  // ===========================================================================
  // Merge Changes
  // ===========================================================================

  private handleMergeChanges(changes: MergeChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    this.eventBus.emit({
      type: 'merges:changed',
      timestamp,
      sheetId: changes[0].sheetId,
      mergeCount: changes.filter((c) => c.kind === 'Set').length,
      regions: changes.map((c) => ({
        kind: c.kind,
        startRow: c.startRow,
        startCol: c.startCol,
        endRow: c.endRow,
        endCol: c.endCol,
      })),
      source: eventSource,
    });
  }

  // ===========================================================================
  // Visibility Changes (Hidden Rows/Columns)
  // ===========================================================================

  private handleVisibilityChanges(changes: VisibilityChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    // Group by axis and hidden state for batch events
    const hiddenRows: number[] = [];
    const unhiddenRows: number[] = [];
    const hiddenCols: number[] = [];
    const unhiddenCols: number[] = [];

    for (const change of changes) {
      if (change.axis === 'row') {
        if (change.hidden) hiddenRows.push(change.index);
        else unhiddenRows.push(change.index);
      } else {
        if (change.hidden) hiddenCols.push(change.index);
        else unhiddenCols.push(change.index);
      }
    }

    const sheetId = changes[0].sheetId;

    if (hiddenRows.length > 0) {
      this.eventBus.emit({
        type: 'rows:hidden',
        timestamp,
        sheetId,
        rows: hiddenRows,
        source: eventSource,
      });
    }
    if (unhiddenRows.length > 0) {
      this.eventBus.emit({
        type: 'rows:unhidden',
        timestamp,
        sheetId,
        rows: unhiddenRows,
        source: eventSource,
      });
    }
    if (hiddenCols.length > 0) {
      this.eventBus.emit({
        type: 'columns:hidden',
        timestamp,
        sheetId,
        cols: hiddenCols,
        source: eventSource,
      });
    }
    if (unhiddenCols.length > 0) {
      this.eventBus.emit({
        type: 'columns:unhidden',
        timestamp,
        sheetId,
        cols: unhiddenCols,
        source: eventSource,
      });
    }
  }

  // ===========================================================================
  // Comment Changes
  // ===========================================================================

  private handleCommentChanges(changes: CommentChange[], source: MutationSource): void {
    // Simplified notification: subscribers can query Rust for full data.
    const timestamp = Date.now();
    for (const change of changes) {
      this.eventBus.emit({
        type: 'comments:cleared', // Reuse as a "comments changed" signal
        timestamp,
        sheetId: change.sheetId,
        source: source === 'user' ? 'user' : 'remote',
      });
    }
  }

  // ===========================================================================
  // Filter Changes
  // ===========================================================================

  private handleFilterChanges(changes: FilterChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      const action = change.action ?? (change.kind === 'Removed' ? 'deleted' : 'updated');
      const type =
        action === 'created'
          ? 'filter:created'
          : action === 'applied'
            ? 'filter:applied'
            : action === 'cleared'
              ? 'filter:cleared'
              : action === 'deleted'
                ? 'filter:deleted'
                : 'filter:updated';
      this.eventBus.emit({
        type,
        timestamp,
        sheetId: change.sheetId,
        filterId: change.filterId ?? '',
        filterKind: toEventFilterKind(change.filterKind),
        tableId: change.tableId,
        capability: toEventFilterCapability(change.capability),
        unsupportedReasons: toEventUnsupportedReasons(change.unsupportedReasons),
        hasActiveFilter: change.hasActiveFilter,
        clearable: change.clearable,
        diagnostics: change.diagnostics?.map(toPublicRuntimeDiagnostic),
        hiddenRowCount: change.hiddenRowCount,
        visibleRowCount: change.visibleRowCount,
        source: eventSource,
      });
    }
  }

  // ===========================================================================
  // Table Changes
  // ===========================================================================

  private handleTableChanges(changes: TableChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      const tableId = change.tableId;
      if (!tableId) continue;
      if (change.kind === 'Set') {
        this.eventBus.emit({
          type: 'table:updated',
          timestamp,
          sheetId: change.sheetId,
          tableId,
          changes: {},
          source: eventSource,
        });
      } else {
        this.eventBus.emit({
          type: 'table:deleted',
          timestamp,
          sheetId: change.sheetId,
          tableId,
          source: eventSource,
        });
      }
    }
  }

  // ===========================================================================
  // Slicer Changes
  // ===========================================================================

  private handleSlicerChanges(changes: SlicerChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      switch (change.kind) {
        case 'created': {
          const sourceInfo = this.getSlicerSourceInfo(change);
          this.eventBus.emit({
            type: 'slicer:created',
            timestamp,
            sheetId: change.sheetId,
            slicerId: change.slicerId,
            sourceType: sourceInfo.sourceType,
            sourceId: sourceInfo.sourceId,
            source: eventSource,
          });
          break;
        }
        case 'updated':
          this.eventBus.emit({
            type: 'slicer:updated',
            timestamp,
            sheetId: change.sheetId,
            slicerId: change.slicerId,
            updatedFields: change.updatedFields ?? [],
            source: eventSource,
          });
          break;
        case 'deleted':
          this.eventBus.emit({
            type: 'slicer:deleted',
            timestamp,
            sheetId: change.sheetId,
            slicerId: change.slicerId,
            source: eventSource,
          });
          break;
        case 'selectionChanged':
          this.eventBus.emit({
            type: 'slicer:selectionChanged',
            timestamp,
            sheetId: change.sheetId,
            slicerId: change.slicerId,
            selectedValues: change.selectedValues ?? [],
            changeType: change.selectionChangeType ?? 'sync',
          });
          break;
      }
    }
  }

  private getSlicerSourceInfo(change: SlicerChange): {
    sourceType: 'table' | 'pivot';
    sourceId: string;
  } {
    if (change.sourceType && change.sourceId) {
      return { sourceType: change.sourceType, sourceId: change.sourceId };
    }
    const source = change.data?.source;
    if (source?.type === 'pivot') {
      return { sourceType: 'pivot', sourceId: source.pivotId };
    }
    if (source?.type === 'table') {
      return { sourceType: 'table', sourceId: source.tableId };
    }
    return { sourceType: 'table', sourceId: '' };
  }

  // ===========================================================================
  // Range Changes (first-class range lifecycle — first-class range lifecycle)
  // ===========================================================================

  private handleRangeChanges(changes: RangeChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      const { sheetId, rangeId, kind, data } = change;

      switch (kind) {
        case 'Created':
        case 'Replaced': {
          const meta = decodeRangeMeta(data);
          this.rangeMetadataCache?.set(toSheetId(sheetId), rangeId as RangeId, meta);
          this.eventBus.emit({
            type: kind === 'Created' ? 'range:created' : 'range:replaced',
            timestamp,
            sheetId,
            rangeId,
            source: eventSource,
          });
          break;
        }
        case 'Removed': {
          this.rangeMetadataCache?.delete(toSheetId(sheetId), rangeId as RangeId);
          this.eventBus.emit({
            type: 'range:removed',
            timestamp,
            sheetId,
            rangeId,
            source: eventSource,
          });
          break;
        }
        case 'Reformatted': {
          this.eventBus.emit({
            type: 'range:reformatted',
            timestamp,
            sheetId,
            rangeId,
            source: eventSource,
          });
          break;
        }
        case 'Bound': {
          this.eventBus.emit({
            type: 'range:bound',
            timestamp,
            sheetId,
            rangeId,
            source: eventSource,
          });
          break;
        }
      }
    }
  }

  // ===========================================================================
  // Sheet Changes
  // ===========================================================================

  private handleSheetChanges(changes: SheetChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      switch (change.field) {
        case 'sheet':
          if (change.kind === 'Set') {
            if (change.sourceSheetId) {
              // Copy operation
              this.eventBus.emit({
                type: 'sheet:copied',
                timestamp,
                sourceSheetId: change.sourceSheetId,
                newSheetId: change.sheetId,
                newName: change.name ?? '',
                source: eventSource,
              });
            } else {
              // Create operation
              this.eventBus.emit({
                type: 'sheet:created',
                timestamp,
                sheetId: change.sheetId,
                name: change.name ?? '',
                index: change.index ?? -1,
                source: eventSource,
              });
            }
          } else if (change.kind === 'Removed') {
            // Delete operation — clean up range cache for the deleted sheet
            this.rangeMetadataCache?.deleteSheet(toSheetId(change.sheetId));
            this.eventBus.emit({
              type: 'sheet:deleted',
              timestamp,
              sheetId: change.sheetId,
              name: change.name ?? '',
              source: eventSource,
            });
          }
          break;

        case 'name':
          this.eventBus.emit({
            type: 'sheet:renamed',
            timestamp,
            sheetId: change.sheetId,
            oldName: change.oldName ?? '',
            newName: change.name ?? '',
            source: eventSource,
          });
          break;

        case 'order':
          this.eventBus.emit({
            type: 'sheet:moved',
            timestamp,
            sheetId: change.sheetId,
            fromIndex: change.oldIndex ?? -1,
            toIndex: change.index ?? -1,
            source: eventSource,
          });
          break;

        case 'hidden':
          this.eventBus.emit({
            type: 'sheet:visibilityChanged',
            timestamp,
            sheetId: change.sheetId,
            hidden: change.hidden ?? false,
            source: eventSource,
          });
          break;

        case 'frozen':
          this.eventBus.emit({
            type: 'freeze:changed',
            timestamp,
            sheetId: change.sheetId,
            oldFrozenRows: change.oldFrozenRows ?? 0,
            oldFrozenCols: change.oldFrozenCols ?? 0,
            newFrozenRows: change.frozenRows ?? 0,
            newFrozenCols: change.frozenCols ?? 0,
            source: eventSource,
          });
          break;

        case 'tabColor':
          this.eventBus.emit({
            type: 'sheet:colorChanged',
            timestamp,
            sheetId: change.sheetId,
            oldColor: change.oldColor ?? null,
            newColor: change.color ?? null,
            source: eventSource,
          });
          break;
      }
    }
  }

  // ===========================================================================
  // Settings Changes (Sheet Settings)
  // ===========================================================================

  private handleSettingsChanges(changes: SheetSettingsChange[], source: MutationSource): void {
    const timestamp = Date.now();
    for (const change of changes) {
      const changedKey = normalizeSheetSettingsChangedKey(change.changedKey);
      const settings = change.settings as SheetSettings;
      this.eventBus.emit({
        type: 'sheet:settings-changed',
        timestamp,
        sheetId: change.sheetId,
        settings,
        changedKey: changedKey as keyof SheetSettings,
        source,
      });
      // Semantic re-emission: the Rust SheetSettings payload covers both
      // view-shape keys (gridlines/headers/RTL/formula-display/zero-display/
      // zoom) and non-view keys (protection, default dims). Subscribers of
      // `view:options-changed` only care about the view subset; emit a
      // dedicated event so they do not have to filter on `changedKey`
      // themselves. Schema-driven via VIEW_OPTION_KEYS per
      // ARCHITECTURE-CHECKLIST §6.
      if (VIEW_OPTION_KEYS.has(changedKey)) {
        this.eventBus.emit({
          type: 'view:options-changed',
          timestamp,
          sheetId: change.sheetId,
          showGridlines: settings.showGridlines,
          showRowHeaders: settings.showRowHeaders,
          showColumnHeaders: settings.showColumnHeaders,
          source,
        });
      }
    }
  }

  // ===========================================================================
  // Page-Break Changes (per-sheet full snapshot)
  // ===========================================================================

  private handlePageBreakChanges(changes: PageBreakChange[], source: MutationSource): void {
    const timestamp = Date.now();
    for (const change of changes) {
      // Wire-shape normalization: the Rust serde shape skips zero values for
      // `min` (`#[serde(skip_serializing_if = "is_zero")]`) and `pt` (boolean
      // default-false), so the gen'd TS interface marks both optional. The
      // event contract carries `min: number` and `pt: boolean` required —
      // default the missing fields to 0 / false at the bridge boundary.
      const normalize = (b: {
        id: number;
        min?: number;
        max: number;
        manual: boolean;
        pt?: boolean;
      }) => ({ id: b.id, min: b.min ?? 0, max: b.max, manual: b.manual, pt: b.pt ?? false });
      this.eventBus.emit({
        type: 'print:page-breaks-changed',
        timestamp,
        sheetId: change.sheetId,
        rowBreaks: (change.breaks.rowBreaks ?? []).map(normalize),
        colBreaks: (change.breaks.colBreaks ?? []).map(normalize),
        source,
      });
    }
  }

  // ===========================================================================
  // Print-Area Changes (set / removed)
  // ===========================================================================

  private handlePrintAreaChanges(changes: PrintAreaChange[], source: MutationSource): void {
    const timestamp = Date.now();
    for (const change of changes) {
      this.eventBus.emit({
        type: 'print:area-changed',
        timestamp,
        sheetId: change.sheetId,
        printArea: change.kind === 'Set' ? (change.area ?? null) : null,
        source,
      });
    }
  }

  // ===========================================================================
  // Print-Titles Changes (per-sheet full snapshot)
  // ===========================================================================

  private handlePrintTitlesChanges(changes: PrintTitlesChange[], source: MutationSource): void {
    const timestamp = Date.now();
    for (const change of changes) {
      this.eventBus.emit({
        type: 'print:titles-changed',
        timestamp,
        sheetId: change.sheetId,
        printTitles: change.titles,
        source,
      });
    }
  }

  // ===========================================================================
  // Print-Settings Changes (per-sheet full snapshot)
  // ===========================================================================

  private handlePrintSettingsChanges(changes: PrintSettingsChange[], source: MutationSource): void {
    const timestamp = Date.now();
    for (const change of changes) {
      this.eventBus.emit({
        type: 'sheet:print-settings-changed',
        timestamp,
        sheetId: change.sheetId,
        settings: change.settings as ContractPrintSettings,
        source,
      });
    }
  }

  // ===========================================================================
  // Split-View Config Changes (set / removed) — sheet-level
  // ===========================================================================

  private handleSplitConfigChanges(changes: SplitConfigChange[], source: MutationSource): void {
    const timestamp = Date.now();
    for (const change of changes) {
      // Split config is a sheet-level setting — emit the existing dedicated
      // split events. The split-specific events stay in place because
      // subscribers in the renderer rely on the create/remove/position-change
      // distinction (see view-events.ts). The mirror has already absorbed
      // the change at the top of `applyAndNotify`.
      if (change.kind === 'Set' && change.config) {
        this.eventBus.emit({
          type: 'split:position-changed',
          timestamp,
          sheetId: change.sheetId,
          config: {
            direction: change.config.direction as 'horizontal' | 'vertical' | 'both',
            horizontalPosition: change.config.horizontalPosition,
            verticalPosition: change.config.verticalPosition,
          },
          source: source === 'user' ? 'user' : 'remote',
        });
      } else if (change.kind === 'Removed') {
        this.eventBus.emit({
          type: 'split:removed',
          timestamp,
          sheetId: change.sheetId,
          source: source === 'user' ? 'user' : 'remote',
        });
      }
    }
  }

  // ===========================================================================
  // Scroll-Position Changes (per-sheet)
  // ===========================================================================

  private handleScrollPositionChanges(
    changes: ScrollPositionChange[],
    source: MutationSource,
  ): void {
    const timestamp = Date.now();
    // Map MutationSource -> ScrollSource. The contract surface for
    // `scroll:changed` is { 'user' | 'keyboard' | 'programmatic' }; remote
    // collab scrolls map to 'programmatic' (the writer wasn't us, the local
    // viewport snaps without a user gesture).
    const scrollSource: 'user' | 'programmatic' = source === 'user' ? 'user' : 'programmatic';
    for (const change of changes) {
      this.eventBus.emit({
        type: 'scroll:changed',
        timestamp,
        sheetId: change.sheetId,
        scrollX: change.leftCol,
        scrollY: change.topRow,
        source: scrollSource,
      });
    }
  }

  // ===========================================================================
  // Workbook-Settings Changes (workbook-level, multi-key)
  // ===========================================================================

  private handleWorkbookSettingsChanges(
    changes: WorkbookSettingsChange[],
    source: MutationSource,
  ): void {
    const timestamp = Date.now();
    for (const change of changes) {
      const settings = change.settings as WorkbookSettings;
      // Rust ships one WorkbookSettingsChange with N changedKeys; emit one
      // event per key so existing per-key subscribers (e.g. the calc-mode
      // listener) wake up without re-reading the full settings blob.
      for (const key of change.changedKeys) {
        this.eventBus.emit({
          type: 'workbook:settings-changed',
          timestamp,
          settings,
          changedKey: key as keyof WorkbookSettings,
          source: source === 'user' ? 'user' : 'remote',
        });
      }
    }
  }

  // ===========================================================================
  // Conditional Formatting Changes
  // ===========================================================================

  private handleCfChanges(changes: CfChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    // Group by sheet for a single batch event
    const sheetIds = new Set(changes.map((c) => c.sheetId));
    for (const sheetId of sheetIds) {
      const sheetChanges = changes.filter((c) => c.sheetId === sheetId);
      this.eventBus.emit({
        type: 'cf:rules-changed',
        timestamp,
        sheetId,
        ruleCount: sheetChanges.filter((c) => c.kind === 'Set').length,
        addedRuleIds: sheetChanges
          .filter((c) => c.kind === 'Set' && c.ruleId)
          .map((c) => c.ruleId!),
        removedRuleIds: sheetChanges
          .filter((c) => c.kind === 'Removed' && c.ruleId)
          .map((c) => c.ruleId!),
        source: eventSource,
      });
    }
  }

  // ===========================================================================
  // Named Range Changes
  // ===========================================================================

  private handleNamedRangeChanges(changes: NamedRangeChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      const name = { name: change.name ?? '' };
      if (change.kind === 'Removed') {
        this.eventBus.emit({
          type: 'name:deleted',
          timestamp,
          name,
          source: eventSource,
        });
      } else if (change.kind === 'Set') {
        this.eventBus.emit({
          type: 'name:updated',
          timestamp,
          newName: name,
          source: eventSource,
        });
      }
    }
  }

  // ===========================================================================
  // Grouping Changes
  // ===========================================================================

  private handleGroupingChanges(changes: GroupingChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    // Group changes by sheet so each sheet gets one event with all its changes.
    const changesBySheet = new Map<string, GroupingChange[]>();
    for (const c of changes) {
      let group = changesBySheet.get(c.sheetId);
      if (!group) {
        group = [];
        changesBySheet.set(c.sheetId, group);
      }
      group.push(c);
    }

    for (const [sheetId, sheetChanges] of changesBySheet) {
      // Emit the canonical 'grouping:changed' event that useGroupingState /
      // useGroupingActions subscribe to via ws.on('grouping:changed', ...).
      // The old 'outline:settings-changed' emission was incorrect — that event
      // is reserved for settings-only changes (summaryRowsBelow etc.), not for
      // group create/delete/toggle, and was not subscribed to by any hook.
      this.eventBus.emit({
        type: 'grouping:changed',
        timestamp,
        sheetId,
        changes: sheetChanges.map((c) => ({
          axis: c.axis === 'row' ? ('row' as const) : ('column' as const),
          kind: c.kind,
        })),
        source: eventSource,
      });
    }
  }

  // ===========================================================================
  // Sparkline Changes
  // ===========================================================================

  private handleSparklineChanges(changes: SparklineChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      this.eventBus.emit({
        type: 'sparkline:changed',
        timestamp,
        sheetId: change.sheetId,
        position: change.position,
        kind: change.kind,
        source: eventSource,
      });
    }
  }

  // ===========================================================================
  // Sorting Changes
  // ===========================================================================

  private handleSortingChanges(changes: SortingChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      this.eventBus.emit({
        type: 'range:sorted',
        timestamp,
        sheetId: toSheetId(change.sheetId),
        range: {
          startRow: change.startRow,
          startCol: change.startCol,
          endRow: change.endRow,
          endCol: change.endCol,
        },
        options: { criteria: [], hasHeaders: false },
        rowsMoved: change.rowsMoved,
        source: eventSource,
      } as Parameters<typeof this.eventBus.emit>[0]);
    }
  }

  // ===========================================================================
  // Structure Changes (Row/Column Insert/Delete)
  // ===========================================================================

  private handleStructureChanges(changes: StructureChangeResult[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';

    for (const change of changes) {
      switch (change.changeType) {
        case 'insertRows':
          this.eventBus.emit({
            type: 'rows:inserted',
            timestamp,
            sheetId: change.sheetId,
            startRow: change.at,
            count: change.count,
            source: eventSource,
          });
          break;
        case 'deleteRows':
          this.eventBus.emit({
            type: 'rows:deleted',
            timestamp,
            sheetId: change.sheetId,
            startRow: change.at,
            count: change.count,
            source: eventSource,
          });
          break;
        case 'insertCols':
          this.eventBus.emit({
            type: 'columns:inserted',
            timestamp,
            sheetId: change.sheetId,
            startCol: change.at,
            count: change.count,
            source: eventSource,
          });
          break;
        case 'deleteCols':
          this.eventBus.emit({
            type: 'columns:deleted',
            timestamp,
            sheetId: change.sheetId,
            startCol: change.at,
            count: change.count,
            source: eventSource,
          });
          break;
      }
    }
  }

  // ===========================================================================
  // Floating Object Changes
  // ===========================================================================

  private handleFloatingObjectChanges(
    changes: FloatingObjectChange[],
    _source: MutationSource,
  ): void {
    const timestamp = Date.now();
    const source = _source === 'user' ? ('user' as const) : ('remote' as const);

    for (const change of changes) {
      switch (change.kind.type) {
        case 'created':
          this.eventBus.emit({
            type: 'floatingObject:created',
            timestamp,
            sheetId: change.sheetId,
            containerId: change.sheetId,
            objectId: change.objectId,
            objectType: change.objectType ?? change.data?.type,
            // Rust sends the full object as FloatingObject (FloatingObjectCommon & FloatingObjectData);
            // at runtime it contains all FloatingObject fields via serde flatten.
            data: change.data ? toFloatingObject(change.data) : undefined,
            bounds: change.bounds,
            source,
          });
          break;
        case 'updated':
          this.eventBus.emit({
            type: 'floatingObject:updated',
            timestamp,
            sheetId: change.sheetId,
            containerId: change.sheetId,
            objectId: change.objectId,
            changes: {}, // Backward compat — cleanup is prefetch
            changedFields: change.kind.changedFields ?? [],
            data: change.data ? toFloatingObject(change.data) : undefined,
            bounds: change.bounds,
            source,
          });
          break;
        case 'removed':
          this.eventBus.emit({
            type: 'floatingObject:deleted',
            timestamp,
            sheetId: change.sheetId,
            containerId: change.sheetId,
            objectId: change.objectId,
            data: change.data ? toFloatingObject(change.data) : undefined,
            objectType: change.objectType ?? change.data?.type ?? 'shape',
            source,
          });
          break;
      }

      // Also emit chart-specific events for chart-type floating objects.
      // This bridges the floating object pipeline to the React chart editor UI
      // which subscribes to chart:created/updated/deleted events.
      const objectType = change.objectType ?? change.data?.type;
      const mappedForChart = change.data ? toFloatingObject(change.data) : undefined;
      if (objectType === 'chart') {
        switch (change.kind.type) {
          case 'created':
            this.eventBus.emit({
              type: 'chart:created',
              timestamp,
              sheetId: change.sheetId,
              chartId: change.objectId,
              chartType: mappedForChart?.type === 'chart' ? mappedForChart.chartType : '',
              dataRange: {
                sheetId: change.sheetId,
                startRow: 0,
                startCol: 0,
                endRow: 0,
                endCol: 0,
              },
              source,
            });
            break;
          case 'updated':
            if (change.kind.changedFields?.includes('chartConfig')) {
              this.eventBus.emit({
                type: 'chart:updated',
                timestamp,
                sheetId: change.sheetId,
                chartId: change.objectId,
                changes: {},
                source,
              });
            }
            break;
          case 'removed':
            this.eventBus.emit({
              type: 'chart:deleted',
              timestamp,
              sheetId: change.sheetId,
              chartId: change.objectId,
              source,
            });
            break;
        }
      }
    }
  }

  private handleFloatingObjectGroupChanges(
    changes: FloatingObjectGroupChange[],
    _source: MutationSource,
  ): void {
    const timestamp = Date.now();
    const source = _source === 'user' ? ('user' as const) : ('remote' as const);

    for (const change of changes) {
      if (!change.data) continue;
      switch (change.kind.type) {
        case 'created':
        case 'updated':
          // No distinct floatingObjectGroup:created event in contracts yet;
          // emit updated for both created and updated kinds.
          this.eventBus.emit({
            type: 'floatingObjectGroup:updated',
            timestamp,
            sheetId: change.sheetId,
            containerId: change.sheetId,
            groupId: change.objectId,
            data: toFloatingObjectGroup(change.data),
            source,
          });
          break;
        case 'removed':
          this.eventBus.emit({
            type: 'floatingObjectGroup:deleted',
            timestamp,
            sheetId: change.sheetId,
            containerId: change.sheetId,
            groupId: change.objectId,
            data: toFloatingObjectGroup(change.data),
            source,
          });
          break;
      }
    }
  }

  // ===========================================================================
  // Pivot Table Changes
  // ===========================================================================

  private handlePivotChanges(changes: PivotTableChange[], source: MutationSource): void {
    const timestamp = Date.now();
    const eventSource = source === 'user' ? 'user' : 'remote';
    const activePivotUpdate = this.pivotUpdateOptionsStack[this.pivotUpdateOptionsStack.length - 1];

    for (const change of changes) {
      if (change.kind === 'Set') {
        const update =
          (change as PivotTableChange & { update?: PivotUpdateOptions }).update ??
          activePivotUpdate;
        if (!update) {
          throw new Error(
            `pivot:updated for ${change.pivotId} was emitted without PivotUpdateOptions`,
          );
        }
        // Emit a simplified pivot:updated signal. Full PivotUpdatedEvent requires
        // oldConfig/newConfig which Rust doesn't provide; subscribers should query
        // Rust for full pivot data on receiving this event.
        this.eventBus.emit({
          type: 'pivot:updated',
          timestamp,
          sheetId: change.sheetId,
          outputSheetId: change.sheetId,
          sourceSheetId: '',
          pivotId: change.pivotId,
          oldConfig: undefined,
          newConfig: undefined,
          update,
          source: eventSource,
        });
      } else {
        this.eventBus.emit({
          type: 'pivot:deleted',
          timestamp,
          sheetId: change.sheetId,
          outputSheetId: change.sheetId,
          sourceSheetId: '',
          pivotId: change.pivotId,
          source: eventSource,
        });
      }
    }
  }

  // ===========================================================================
  // Undo Description
  // ===========================================================================

  private handleUndoDescription(description: string): void {
    this.onUndoDescription?.(description);
  }
}
