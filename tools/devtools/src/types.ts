// Runtime event types — discriminated union
// Each recorder produces one of these

/**
 * Flow event source — where the event originated.
 * Added in flow schema v2 (Round 6 / O-1). Optional on the public types for
 * one release cycle so legacy v1 traces keep deserializing without errors.
 *
 * - `keyboard`: a real keyboard / pointer event entered through the browser
 *   (the only path before O-D landed harness-helper synthetic actions).
 * - `harness`: a test harness helper drove
 *   the action programmatically (set by O-D's `withHarnessAction`).
 * - `network`: an inbound message from the colab transport / RPC.
 * - `internal`: emitted by the runtime itself — XState transitions, guard
 *   rejections, action receipts, viewport-buffer applies, etc.
 */
export type FlowEventSource = 'keyboard' | 'harness' | 'network' | 'internal' | 'pointer';

/**
 * Optional schema-v2 timing/source metadata mixed into every `RuntimeEvent`
 * variant. The store-level events carry only `source` and `tSinceStepStart`
 * (since `ActorEvent` and `ViewportBufferEvent` already use `kind` for their
 * own discriminator). The v2 `kind: string` field is projected onto each
 * flow sub-array entry by `buildFlow` — see {@link FlowEntryMeta}.
 *
 * Both fields are optional during the v1→v2 transition window so legacy v1
 * traces keep deserializing without runtime errors.
 */
export interface FlowEventTimingMeta {
  /** Where the event originated. See {@link FlowEventSource}. */
  source?: FlowEventSource;
  /**
   * `performance.now()` ms since the current step's start, anchored by
   * `__dt.clear()` (which runners call before each step). 0 means "before any
   * step started" or "anchor unknown" (e.g. v1-fixture upgrade).
   */
  tSinceStepStart?: number;
  /**
   * Flagged when this event appears to be a duplicate of the immediately
   * preceding event (same type, timestamp, and key fields). Root cause is
   * two active sheet contexts processing the same action — a kernel-level
   * issue, not a recorder issue. This flag makes the symptom visible.
   */
  isDuplicate?: boolean;
}

/**
 * Schema-v2 metadata projected onto each flow sub-array entry
 * (`flow.transitions[*]`, `flow.bridgeCalls[*]`, etc). See O-1 in
 */
export interface FlowEntryMeta {
  /** Where the event originated. */
  source?: FlowEventSource;
  /**
   * Freeform classifier — `'bridge.read'`, `'bridge.write'`, `'action.dispatch'`,
   * `'machine.transition'`, `'machine.guard.reject'`, `'harness.helper'`, etc.
   * O-B will fill the read/write split using the bridge manifest from O-0.
   */
  kind?: string;
  /** ms since the current step's anchor — see {@link FlowEventTimingMeta}. */
  tSinceStepStart?: number;
}

/**
 * Minimal devtools inspection contract for a persistence provider instance.
 *
 * This intentionally models only the devtools readback field. It is not the
 * storage Provider protocol and must not grow behavior knobs for tests.
 */
export interface PersistenceProviderInspection {
  readonly _devtoolsDb?: IDBDatabase | null;
}

/**
 * Per-doc shape exposed via `__dt.persistenceProviders[docId]`.
 */
export interface PersistenceProvidersSnapshot {
  readonly idbDatabase: IDBDatabase | null;
  readonly indexedDbProvider: PersistenceProviderInspection | null;
}

/**
 * Per-doc snapshot exposed via `__dt.persistenceState[docId]`.
 */
export interface PersistenceStateSnapshot {
  readonly pendingUpdates: number;
  readonly hasFlushFailed: boolean;
  readonly hasAppendActive: boolean;
}

/**
 * Page-level provider state exposed via `__dt.providerState`.
 */
export interface ProviderStateSnapshot {
  readonly readOnly: boolean;
}

export type RuntimeEvent =
  | ActorEvent
  | EventBusEvent
  | RenderEvent
  | CanvasFrameEvent
  | BridgeCallEvent
  | ViewportBufferEvent
  | ActionDispatchEvent
  | ReceiptEvent
  | SceneGraphPatchEvent;

export interface ActorEvent extends FlowEventTimingMeta {
  type: 'actor';
  timestamp: number;
  actorId: string;
  // For transitions
  kind: 'transition' | 'event.sent' | 'event.received' | 'guard.reject';
  fromState?: string;
  toState?: string;
  eventType?: string;
  eventData?: unknown;
  guardName?: string;
  durationMs?: number;
  correlationId?: number;
}

export interface EventBusEvent extends FlowEventTimingMeta {
  type: 'eventbus';
  timestamp: number;
  eventType: string;
  eventData?: unknown;
  correlationId?: number;
}

export interface RenderEvent extends FlowEventTimingMeta {
  type: 'render';
  timestamp: number;
  appId: string;
  componentId: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDurationMs: number;
  baseDurationMs: number;
  correlationId?: number;
}

export interface CanvasFrameEvent extends FlowEventTimingMeta {
  type: 'canvas';
  timestamp: number;
  layerTimings: Record<string, { lastMs: number; avgMs: number; maxMs: number }>;
  totalMs: number;
  /** Viewport buffer generation consumed for this render (if available). */
  bufferGeneration?: number;
  correlationId?: number;
}

export interface BridgeCallEvent extends FlowEventTimingMeta {
  type: 'bridge';
  timestamp: number;
  bridgeName: string;
  method: string;
  durationMs: number;
  args?: unknown[];
  error?: string;
  mutationMeta?: {
    viewportPatchBytes: number;
    changedCellCount: number;
    recalcedCellCount: number;
  };
  correlationId?: number;
}

export interface ViewportBufferEvent extends FlowEventTimingMeta {
  type: 'viewport-buffer';
  timestamp: number;
  kind: 'mutation-applied' | 'full-refresh' | 'delta-applied';
  viewportId: string;
  patchCount: number;
  skippedOutOfBounds: number;
  bufferBounds: { startRow: number; startCol: number; rows: number; cols: number };
  generation: number;
  overflowPoolBytes: number;
  sampleCells?: Array<{ row: number; col: number; displayText: string | null }>;
  correlationId?: number;
}

export interface ActionDispatchEvent extends FlowEventTimingMeta {
  type: 'action';
  timestamp: number;
  action: string;
  durationMs: number;
  /**
   * `boolean` for keyboard-driven actions (the dispatcher always knows the
   * outcome). `null` for in-flight harness-helper actions emitted by
   * `withHarnessAction` that haven't finalized yet (e.g. when an outer
   * helper's begin record is observed before its inner fn completes).
   * Always non-null after finalize.
   */
  handled: boolean | null;
  error?: string;
  receiptCount: number;
  receiptDomains?: string[];
  payload?: unknown;
  correlationId?: number;
}

export interface ReceiptEvent extends FlowEventTimingMeta {
  type: 'receipt';
  timestamp: number;
  receipts: Array<{
    domain: string;
    action: string;
    id: string;
    hasBounds: boolean;
    hasObject: boolean;
  }>;
  patchCount: number;
  correlationId?: number;
}

export interface SceneGraphPatchEvent extends FlowEventTimingMeta {
  type: 'scenegraph';
  timestamp: number;
  patches: Array<{
    objectId: string;
    kind: string;
    objectType?: string;
    hasBounds: boolean;
    hasData: boolean;
    skipped?: boolean;
    skipReason?: string;
  }>;
  correlationId?: number;
}

// Ring buffer entry wraps any runtime event
export interface StoreEntry {
  id: number;
  event: RuntimeEvent;
}

// Machine state tracking (for __dt.machines() queries)
export interface MachineSnapshot {
  actorId: string;
  currentState: string;
  context?: unknown;
  eventCount: number;
  lastTransitionAt: number;
  transitions: ActorEvent[]; // last N transitions kept
}

// Global hook interface
declare global {
  interface OSDevToolsHook {
    reportActor(actorId: string, inspectionEvent: unknown): void;
    reportRender(
      appId: string,
      componentId: string,
      phase: string,
      actualDurationMs: number,
      baseDurationMs: number,
    ): void;
    reportEvent(event: { type: string }): void;
    reportCanvasFrame(
      layerTimings: Record<string, { lastMs: number; avgMs: number; maxMs: number }>,
      bufferGeneration?: number,
    ): void;
    reportBridgeCall(
      bridge: string,
      method: string,
      args: unknown[],
      durationMs: number,
      result: unknown,
      error?: string,
    ): void;
    reportViewportBuffer(event: Omit<ViewportBufferEvent, 'type' | 'timestamp'>): void;
    reportAction(
      action: string,
      durationMs: number,
      result: { handled: boolean; error?: string; receipts?: unknown[] },
      payload?: unknown,
    ): void;
    reportReceipt(
      receipts: Array<{
        domain: string;
        action: string;
        id: string;
        bounds?: unknown;
        object?: unknown;
      }>,
    ): void;
    reportSceneGraphPatch(
      patches: Array<{
        objectId: string;
        kind: string;
        data?: unknown;
        bounds?: unknown;
        skipped?: boolean;
        skipReason?: string;
      }>,
    ): void;
    /**
     * Report a synthetic harness-helper action — emitted by O-D's
     * `withHarnessAction` wrapper around every exported `interactions/*.ts`
     * helper. Unlike `reportAction`, this carries `source: 'harness'` and
     * `kind: 'harness.helper'` directly from the call site rather than
     * defaulting to keyboard.
     */
    reportHarnessAction(entry: {
      name: string;
      handled: boolean | null;
      tSinceStepStart: number;
      durationMs?: number;
      error?: string;
    }): void;
    /** Get the current active correlation ID (if any). Runtimes that want to tag their events can call this. */
    getCorrelationId(): number | undefined;
    /** Anchor for `tSinceStepStart` (flow schema v2 / O-1). */
    getStepStartT(): number;
  }
}

export type OSDevToolsHook = globalThis.OSDevToolsHook;

// Lightweight status snapshot for UI polling
export interface DevToolsStatus {
  recording: boolean;
  eventCount: number;
  machines: Array<{
    id: string;
    state: string;
    eventCount: number;
    lastTransitionAt: number;
  }>;
  slowCount: number; // events above 16ms threshold
}

// Console API interface
export interface DevToolsConsoleAPI {
  // Quick diagnosis
  last(n?: number): StoreEntry[];
  print(n?: number): void;

  // XState
  machines(): void;
  machine(id: string): void;
  transitions(filter?: string): void;

  // EventBus
  events(filter?: string): void;

  // React
  renders(filter?: string): void;
  slowRenders(ms?: number): void;

  // Canvas
  frames(n?: number): void;

  // Bridge
  bridge(filter?: string): void;

  // Viewport buffer
  viewport: ((viewportId?: string) => void) & {
    getCellBounds(
      row: number,
      col: number,
    ): { x: number; y: number; width: number; height: number } | null;
  };
  cell(row: number, col: number, viewportId?: string): void;

  // Viewport buffer events
  bufferEvents(filter?: string): void;

  // Action pipeline
  actions(filter?: string): void;
  receipts(filter?: string): void;
  patches(filter?: string): void;
  pipeline(n?: number): void;

  // Analysis
  slow(ms?: number): void;
  timeline(ms?: number): void;
  between(tsStart: number, tsEnd: number): void;
  for(actorId: string): void;

  // Mutations with viewport buffer outcomes
  mutations(): void;

  // Cell mutation history
  cellHistory(row: number, col: number): void;

  // Causal flow
  flow(correlationId: number): void;
  lastFlow(): void;

  // Status (lightweight, for UI)
  getStatus(): DevToolsStatus;

  // Subscribe to changes. Returns unsubscribe function.
  subscribe(listener: () => void): () => void;

  // Export
  toJSON(): {
    events: StoreEntry[];
    machines: Record<string, MachineSnapshot>;
    viewportBuffers?: Record<string, unknown>;
  };

  // Control
  enable(): void;
  disable(): void;
  clear(): void;

  /**
   * Clear retained actor/machine snapshots.
   *
   * `clear()` is step-scoped and intentionally preserves the last-known
   * machine state for assertions. Use this at document/runtime boundaries
   * after the old document has been disposed.
   */
  clearActorState(): void;

  /**
   * Dispatch an action through the spreadsheet's unified action
   * system, routed through the wired `KeyboardCoordinator` so the
   * handler runs with the same `ActionDependencies` real keyboard
   * input supplies. Canonical entry point for app-eval scenarios that
   * need to trigger an action (dialog-open, panel-open, one-off
   * operation) where no dedicated `__dt.<helper>` exists.
   *
   * Returns the handler's `ActionResult` (or `null` if the coordinator
   * isn't wired yet). A typo'd action surfaces as
   * `{handled: false, reason: 'not_found'}` from the production
   * dispatcher.
   */
  dispatch(action: string, payload?: unknown): Promise<unknown>;

  // ── Programmatic API (structured return values for agent tooling) ──

  /** Get structured causal flow for a correlationId */
  getFlow(correlationId: number): ProgrammaticFlow | null;

  /** Get the most recent causal flow (structured) */
  getLastFlow(): ProgrammaticFlow | null;

  /** Read a single cell value from viewport buffer */
  getCellValue(row: number, col: number, viewportId?: string): ProgrammaticCellValue | null;

  /**
   * Read a batch of cells via the compute bridge (production read path —
   * `bridge.queryRange`). Use this when assertions need cells that may
   * not be rendered in the current viewport (the viewport buffer only
   * covers ~34 rows at default zoom; stress-perf scenarios spot-check
   * cells thousands of rows away from the canvas).
   *
   * Resolves with `{ "<row>,<col>": ProgrammaticCellValue }` for every
   * requested cell. Cells with no stored value are still included with
   * `displayText: null` so callers can distinguish "queried and empty"
   * from "not queried".
   */
  getCellsViaBridge(
    cells: ReadonlyArray<{ row: number; col: number }>,
  ): Promise<Record<string, ProgrammaticCellValue>>;

  /**
   * Read displayed format properties for a batch of cells via the compute
   * bridge (production read path — `bridge.getDisplayedRangeProperties` +
   * per-cell fallback). Supports cells outside the rendered viewport and
   * returns the same normalized format keys as `getCellFormat`.
   */
  getDisplayedFormatsForCells(
    cells: ReadonlyArray<{ row: number; col: number }>,
  ): Promise<Record<string, Record<string, unknown>>>;

  /**
   * Read the kernel-resolved `numberFormat` for a batch of cells via
   * `bridge.getResolvedFormat`. The viewport-binary palette only carries
   * `numberFormat` when it changes the rendered text (e.g. `"@"` on
   * numeric values is omitted), so capture uses this to fill gaps.
   * Returns a sparse map keyed by `"<row>,<col>"`.
   */
  getResolvedNumberFormats(
    cells: ReadonlyArray<{ row: number; col: number }>,
  ): Promise<Record<string, string>>;

  /** Read a single cell's format from viewport buffer */
  getCellFormat(row: number, col: number, viewportId?: string): Record<string, unknown> | null;

  /** Read whether the rendered viewport accessor reports a comment marker. */
  hasComment(row: number, col: number, viewportId?: string): boolean;

  /** Read the data-bar fill ratio (0..1) for a cell, or null if no data-bar CF applies */
  getDataBarRatio(row: number, col: number, viewportId?: string): number | null;

  /** Read the icon-set bucket index (0-based) for a cell, or null if no icon-set CF applies */
  getIconBucket(row: number, col: number, viewportId?: string): number | null;

  /** Alias of getIconBucket — matches the name used by icon-set scenario helpers */
  getIconSetBucket(row: number, col: number, viewportId?: string): number | null;

  /** Get all machine states as a structured map */
  getMachineStates(): Record<string, ProgrammaticMachineState>;

  /** Get action dispatch events since a timestamp (default: all) */
  getActionLog(since?: number): ActionDispatchEvent[];

  /** Get guard rejections since a timestamp (default: all) */
  getGuardRejections(since?: number): ActorEvent[];

  /** Get recent captured errors (fire-and-forget failures, unhandled rejections) */
  getRecentErrors(since?: number): ProgrammaticError[];

  /** Clear error buffer */
  clearErrors(): void;

  /**
   * Capture an error from a handler-side try/catch (Round 6 / O-A).
   *
   * Pushes an entry into the error ring buffer with the supplied `source`
   * tag (typically `'handler:<ACTION_NAME>'` or `'bridge:<methodName>'`).
   * Accepts arbitrary error values — non-Error inputs are coerced via `String()`.
   *
   * Optional chaining is recommended at call sites (`window.__dt?.captureError?.(...)`)
   * so production builds without devtools loaded incur zero overhead.
   */
  captureError(source: string, error: unknown): void;

  /**
   * Toggle interception of `console.error` (Round 6 / O-A).
   *
   * Off by default in production builds. The app-eval harness flips this on
   * via `__dt.setCaptureConsoleErrors(true)` once per page init so every
   * `console.error(...)` call lands in the ring buffer with `source:
   * 'console.error'`. Returns the prior enabled state for symmetry.
   */
  setCaptureConsoleErrors(enabled: boolean): boolean;

  // ── Mutation Helpers (for app-eval / agent tooling) ──

  /**
   * Apply a named cell style ("Good", "Bad", "Neutral", "Input", "Output", "Normal", etc.)
   * to the currently selected cells.
   *
   * Style names are case-insensitive and map to built-in Excel-compatible style IDs.
   * "Normal" clears all formatting. All other names resolve through wb.cellStyles.get().
   */
  applyCellStyle(name: string): Promise<void>;

  /**
   * Set format properties on a specific cell (identified by 0-based row/col).
   * Accepts any subset of CellFormat (e.g. { backgroundColor, fontColor, numberFormat }).
   *
   * Uses the active worksheet's formats API directly, bypassing selection state.
   */
  setCellFormat(row: number, col: number, format: Record<string, unknown>): Promise<void>;

  /**
   * Merge selected cells across each row independently (Excel "Merge Across").
   * Creates one merged region per row within the current selection.
   */
  mergeAcross(): Promise<void>;

  /**
   * Merge a range into a single merged region (Excel "Merge Cells", no center).
   * Does NOT apply center alignment.
   *
   * Without args: merges the active selection's first range.
   * With explicit row/col bounds: merges that range directly — useful from
   * fixtures and harness helpers that want to merge an arbitrary range
   * without first arranging the selection state.
   */
  mergeCells(startRow?: number, startCol?: number, endRow?: number, endCol?: number): Promise<void>;

  /**
   * Return all merged regions on the active sheet.
   * Each region is { startRow, startCol, endRow, endCol } (0-based).
   */
  getMergedRegions(): Promise<
    Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>
  >;

  // ── Filter Helpers (for app-eval / agent tooling) ──

  /** Create an auto-filter on the used range of the active sheet. */
  createAutoFilter(): Promise<void>;
  /** Alias for createAutoFilter. */
  toggleAutoFilter(): Promise<void>;
  /** Filter a column by allowed values (0-based col index). */
  applyFilter(col: number, values: (string | number)[]): Promise<void>;
  /** Alias for applyFilter. */
  setFilter(col: number, values: (string | number)[]): Promise<void>;
  /** Apply a custom condition filter on a column. */
  setCustomFilter(
    col: number,
    criteria: { operator: string; value: number | string },
  ): Promise<void>;
  /** Alternate signature for setCustomFilter. */
  applyCustomFilter(col: number, operator: string, value: number | string): Promise<void>;
  /** Apply a multi-condition filter (AND/OR logic across up to 2 conditions). */
  applyConditionFilter(
    col: number,
    conditions: { operator: string; value?: number | string; value2?: number | string }[],
    logic?: 'and' | 'or',
  ): Promise<void>;
  /** Apply a dynamic filter rule (e.g. 'lastMonth', 'aboveAverage'). */
  applyDynamicFilter(col: number, rule: string): Promise<void>;
  /** Filter a column by cell color. Discriminator vocab matches Excel/ECMA-376
   *  ('fill' / 'font'). Legacy `'background'` is accepted as an alias for `'fill'`. */
  filterByColor(
    col: number,
    options: { colorType?: 'fill' | 'background' | 'font'; color: string },
  ): Promise<void>;
  /** Reapply the first auto-filter (refreshes hidden-row state). */
  reapplyFilter(): Promise<void>;
  /** Alias for reapplyFilter. */
  refreshFilter(): Promise<void>;

  // ── Layout Queries (for app-eval / agent tooling) ──

  /** Read the height of a row in pixels on the active sheet (0-based row index). */
  getRowHeight(row: number): Promise<number | null>;

  // ── Invariants (Round 7 I-0) ──

  /**
   * Run all registered cross-source invariants in a single browser-side
   * pass. Returns timed results suitable for attaching to a snapshot.
   *
   * Invariants are registered through the eval-harness registry (or the
   * thin facade at `apps/spreadsheet/src/devtools/invariant-registry.ts`);
   * the public `__dt` API does NOT expose the registry itself.
   */
  invariants(): InvariantsRunOutput;

  // ── Freeze panes ──
  /**
   * Read freeze-pane state with rendering applied flag.
   *
   * `frozenRows` / `frozenCols` come from the kernel's per-sheet view model
   * (the "logical" freeze count). `applied` indicates whether the renderer
   * has actually drawn a freeze divider at that boundary on the current
   * paint — the smoking-gun read for #130-class "freeze never applies on
   * first render" regressions where the kernel state is correct but the
   * canvas never installs the divider.
   *
   * `applied` is `true` iff the renderer's `viewportLayout.dividers`
   * contains at least one `freeze`-type divider (or the layout reports
   * non-zero `frozenRows`/`frozenCols` in its `headerInfo`). When
   * `frozenRows === 0 && frozenCols === 0`, `applied` is `false`.
   */
  getFreezeState(): Promise<{
    frozenRows: number;
    frozenCols: number;
    applied: boolean;
  } | null>;
  getFrozenPanes(): { rows: number; cols: number } | null;
  freezeTopRow(): Promise<void>;
  freezeFirstColumn(): Promise<void>;
  freezePanes(rows: number, cols: number): Promise<void>;
  unfreezePanes(): Promise<void>;

  // ── Hide/unhide rows & columns ──
  hideRows(rows: number[]): Promise<void>;
  hideColumns(cols: number[]): Promise<void>;
  unhideRows(startRow: number, endRow: number): Promise<void>;
  unhideColumns(startCol: number, endCol: number): Promise<void>;
  isRowHidden(row: number): Promise<boolean | null>;
  isColumnHidden(col: number): Promise<boolean | null>;

  // ── Dimensions (read parity with getRowHeight) ──
  getColWidth(col: number): Promise<number | null>;

  // ── app-eval / app-eval rendered-state readback: rendered-state readbacks ──
  //
  // Each of these reads from the canvas/drawing layer's actual rendered
  // state (the scene graph, the renderer's drawn row/col extents, the
  // canvas pixel buffer). They DELIBERATELY do not read kernel layout
  // because the eight-axis closure requires app-eval to catch
  // "kernel says X, canvas drew Y" disagreements. See
  //
  // No `getComment` / `getHyperlink` / `getNote` / `getValidation` —
  // cell-attached metadata is observed through the production
  // click-to-open flow and asserted on the popover DOM.

  /**
   * Return descriptors for every drawing object the canvas drew on the
   * specified sheet (or the active sheet when omitted). Reads from the
   * scene graph's z-ordered list — that is the single authority for
   * what gets rendered on the drawing layer. If the parser dropped a
   * drawing, it will not appear here, which is the correct behaviour:
   * the api-eval scenario for the same fixture catches parse-side gaps.
   */
  getRenderedDrawings(sheetId?: string): Promise<DrawingDescriptor[]>;

  /**
   * Return the rendered (canvas-side) row height in CSS pixels. Reads
   * from the grid renderer's `getCellPageBounds(row, 0).height` so the
   * value reflects what the canvas actually drew, not what the kernel
   * layout-index reports. Returns `null` when the renderer can't
   * resolve bounds (e.g. row entirely outside the rendered viewport).
   */
  getRenderedRowHeight(sheet: string | null, row: number): Promise<number | null>;

  /** Rendered (canvas-side) column width — see {@link getRenderedRowHeight}. */
  getRenderedColWidth(sheet: string | null, col: number): Promise<number | null>;

  /**
   * Intrinsic rendered cell size in CSS pixels, independent of current viewport
   * visibility when SheetView geometry can resolve it. Falls back to page
   * bounds for older renderer adapters.
   */
  getRenderedCellSize(
    sheet: string | null,
    row: number,
    col: number,
  ): Promise<{ width: number; height: number } | null>;

  /**
   * First row whose canvas geometry is currently resolvable for the given
   * renderer viewport scope. Unlike {@link getViewportStartRow}, this is not a
   * compute/prefetch bound; it is derived from the live grid renderer and is
   * guaranteed to be usable with {@link getRenderedRowHeight} when non-null.
   */
  getRenderedViewportStartRow(scope?: string): number | null;

  // ── UX-FIX explicit-format #18 — accessors that retire __SHELL__ reach-throughs ──

  /**
   * Active document id (the same value `__SHELL__.store.getState().activeFileId`
   * exposes). Replaces the `__SHELL__.store` reach in lifecycle /
   * refresh-persistence specs.
   */
  getActiveFileId(): string | null;

  /**
   * Per-viewport state snapshots from the active document's compute
   * bridge, as a plain Record keyed by viewport scope (e.g. `'main:0'`).
   * Optional `scopePrefix` filters to keys starting with that string.
   * Empty object on any failure.
   *
   * Replaces the `__SHELL__.documentManager.getDocument(...).context.computeBridge.getPerViewportStates()`
   * walk used by popover-overflow / CF spec helpers.
   */
  getViewportStates(scopePrefix?: string): Record<string, unknown>;

  /**
   * Convenience: top-of-viewport row index for a given scope (`'main'`
   * by default). Returns `null` when no viewport matches the scope.
   */
  getViewportStartRow(scope?: string): number | null;

  /**
   * Tab color for a given sheet (SheetId or display name) on the active
   * document. Returns `null` when no tab color is set or the bridge
   * isn't reachable. Replaces the `ctx.computeBridge.getTabColorQuery`
   * walk used by sheet-tab-color specs.
   */
  getActiveSheetTabColor(sheet: string): Promise<string | null>;

  /**
   * Force a full-viewport recompute on the active doc's compute bridge.
   * No-op when the bridge isn't reachable. Used by CF specs
   * (cf-data-bar / cf-icon-set) to flush the data-bar ratio cache.
   */
  forceRefreshViewports(): Promise<void>;

  // ── additional structural
  //    readbacks for OOXML import-fidelity scenarios. ──

  /**
   * Outline-gutter groups for a sheet (David §0.2, #127).
   *
   * Returns the kernel-state row/column outline groups for `sheet`
   * (matched by name or SheetId). Returns `null` when neither axis has
   * any groups — the same condition under which `OutlineToggleOverlay`
   * decides not to mount, so the readback's null IS the
   * "would-not-mount" signal the import-fidelity scenarios assert
   * against.
   *
   * Why not the rendered DOM toggles: `OutlineToggleOverlay` only emits
   * a <button> for groups whose anchor cell is in the *visible
   * viewport* (see `computeOutlineRects` in OutlineToggleOverlay.tsx —
   * the toggle position comes from `coords.cellToViewport(...)`, which
   * returns null off-screen and the loop bails). For a sheet with 15
   * row groups spanning rows 5..108, only the first 1-2 are visible at
   * scroll y=0, so DOM-querySelector counts ≪ kernel count even though
   * the parser ingested everything correctly. Tests that verify
   * import-fidelity want kernel state — the parser's destination and
   * the renderer's source of truth — not whichever toggles happen to
   * be visible right now.
   */
  getOutlineGutter(sheet: string): Promise<{
    rows: { row: number; level: number; collapsed: boolean }[];
    cols: { col: number; level: number; collapsed: boolean }[];
  } | null>;

  /**
   * Active sheet display name from the selected sheet tab, with a workbook
   * fallback. Used by app-eval scenarios to prove a sheet-switch interaction
   * landed before reading active-renderer state.
   */
  getActiveSheetName(): string | null;

  /**
   * Per-sheet gridline visibility (David §0.2, #128).
   *
   * Reads the grid renderer's `sheetAdapter.showGridlines` flag — the
   * exact value `BackgroundLayer.render` consults before stroking
   * gridlines. This catches both:
   *   - "parser dropped showGridLines and the renderer's default-true
   *     wins" (stale snapshot, first paint draws gridlines anyway)
   *   - "parser preserved showGridLines=false but the renderer ignores
   *     it" (hypothetical regression — we still want to gate against it)
   *
   * Returns `false` when no renderer is mounted (no canvas → no draw).
   * `sheetId` is accepted for symmetry with the rest of the structural
   * primitives, but the renderer only carries one current sheet at a
   * time, so the value is the active-sheet readback. Pass the active
   * sheet id at the call site.
   */
  gridlinesVisible(sheetId: string): boolean;

  /**
   * Formula-bar contents readback (David §0.2, used by Groups C + F).
   *
   * Reads the formula-bar input element's current value plus the
   * array-member flag. `text` is the input's `.value` (the same
   * string the user sees, including the `=` prefix on formulas and
   * any pending edit-mode buffer). `isArrayMember` is `true` when
   * the active cell is a member of an Excel-style array formula —
   * Excel renders array members with `{=…}` braces and italic styling
   * in the bar; both signals are visible state we want to assert
   * against.
   *
   * Returns `null` when the formula-bar element is not in the DOM
   * (e.g., the user has hidden the formula bar via View ribbon).
   */
  getFormulaBarText(): { text: string; isArrayMember: boolean } | null;

  /**
   * Capture a PNG snapshot of the canvas. When `region` is provided, only
   * the specified rectangle is captured (CSS pixels in canvas-element
   * coordinate space). The DPR of the captured image is returned alongside
   * so callers can pixel-diff against goldens generated at a known DPR.
   */
  getCanvasSnapshot(region?: PixelRect): Promise<CanvasSnapshot>;

  // ── app-eval / app-eval input-mode readback (Richard §0.1, §0.2) ──
  //
  // Each of these reads from a user-visible DOM/global surface. Per
  // `feedback_production_path_only`, no kernel-state shortcuts —
  // `getCellEditorBuffer` reads `activeElement.value`,
  // `getOverlayBounds` reads `getBoundingClientRect()` on a mounted
  // overlay, and `persistenceEnabled` is a plain boolean getter.

  /**
   * Read the cell editor's current buffer via `activeElement.value`.
   *
   * Returns the editor input's value when `document.activeElement` is
   * the cell editor input (`<textarea>` or `<input>` mounted by
   * `InlineCellEditor`); `null` otherwise. This is the smoking-gun
   * read for #110-class bugs ("did a stray character leak into the
   * cell while a different mode owned the keystream?") — the test
   * asserts `getCellEditorBuffer() === ''` after, e.g., an
   * Alt-sequence completes, surfacing leak-into-editor regressions
   * that the kernel-side state would not see.
   *
   * DOM read only — does NOT cross into kernel state.
   */
  getCellEditorBuffer(): string | null;

  /**
   * Read DOM bounds for an overlay element by stable id.
   *
   * `domRect` is the overlay's `getBoundingClientRect()`.
   *
   * `clippedToContainer` is the `getBoundingClientRect()` of the
   * nearest `overflow: auto|hidden|scroll` ancestor (or `null` when
   * the overlay's parents all flow without clipping).
   *
   * `allChildrenVisible` is `true` iff every direct child element of
   * the overlay has a non-zero intersection with `clippedToContainer`
   * (or, when `clippedToContainer` is `null`, with the viewport). A
   * `false` result is the smoking gun for #118-class clipping
   * regressions (alt-hints rendered but cut off by an overflow
   * boundary).
   *
   * Returns `null` when no element with the requested id is mounted.
   *
   * DOM read only.
   */
  getOverlayBounds(overlayId: OverlayId): OverlayBounds | null;

  /**
   * Persistence feature flag (IndexedDB hydration).
   *
   * Returns `true` when the kernel's IndexedDB persistence layer is
   * wired (rehydrates a workbook on page reload); `false` otherwise.
   * Plain boolean getter, no side effects.
   *
   * Used by the §2.1 refresh-persistence scenarios to gate which
   * contract they assert against — until #112's product fix lands,
   * scenarios that depend on hydration skip cleanly when this is
   * `false` (reported as `pending`, not `pass`).
   */
  readonly persistenceEnabled: boolean;

  /**
   * Per-doc persistence state snapshots. Installed by the shell persistence
   * bridge once shell lifecycle state is available.
   */
  readonly persistenceState?: Readonly<Record<string, PersistenceStateSnapshot>>;

  /**
   * Page-level provider state. Currently used for the multi-tab read-only
   * Web Lock path.
   */
  readonly providerState?: Readonly<ProviderStateSnapshot>;

  /**
   * Dev-only persistence provider inspection handles. This lets Playwright
   * drive the real IndexedDB failure path without production behavior knobs.
   */
  readonly persistenceProviders?: Readonly<Record<string, PersistenceProvidersSnapshot>>;

  // ── Autofit ──
  autoFitRow(row: number): Promise<void>;
  autoFitColumn(col: number): Promise<void>;

  // ── Debug Recording ──

  /** Start a debug recording session. Enables the event store and begins capturing. */
  startRecording(): void;
  /** Stop the debug recording and return the raw bundle (without bugReport). */
  stopRecording(): unknown | null;
  /** Get the debug recorder instance for subscribing to state changes. */
  getRecording(): unknown;
  /** Check if a debug recording is in progress. */
  isRecording(): boolean;

  // ── Collaboration presence readback ──

  /**
   * Read remote cursors from the collab sidecar's presence map.
   * Returns an array of RemoteCursor descriptors (user id/name/color,
   * activeCell, selection ranges, isEditing, sheetId) — the same shape
   * the renderer's RemoteCursorsLayer consumes.
   *
   * Returns `[]` when collaboration is inactive or no remote participants
   * have selection data.
   */
  getRemoteCursors(): RemoteCursorDescriptor[];

  // ── Outline / Group ──
  groupRows(startRow: number, endRow: number): Promise<void>;
  groupColumns(startCol: number, endCol: number): Promise<void>;
  ungroupRows(startRow: number, endRow: number): Promise<void>;
  ungroupColumns(startCol: number, endCol: number): Promise<void>;
  getOutlineLevel(axis: 'row' | 'col', index: number): Promise<number | null>;
  toggleOutlineGroup(axis: 'row' | 'col', level: number, collapse: boolean): Promise<void>;
}

// ── Invariants surface (Round 7 I-0) ──
//
// The full type definitions live with the eval-harness registry (to keep
// registry implementation co-located with its consumers). The public `__dt`
// surface only needs the return-shape type.

export type InvariantSeverity = 'error' | 'warn';
export type InvariantResult =
  | { ok: true }
  | { ok: false; message: string; evidence: Record<string, unknown> };
export interface InvariantsRunOutput {
  results: Array<{ id: string; severity: InvariantSeverity } & InvariantResult>;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

// ── Snapshot types for on-demand DevTools queries ──

export interface ViewportSnapshotCell {
  row: number;
  col: number;
  valueType: number;
  numberValue: number;
  displayText: string | null;
  hasFormula: boolean;
  formatIdx: number;
}

export interface ViewportSnapshotViewport {
  id: string;
  startRow: number;
  startCol: number;
  rows: number;
  cols: number;
  generation: number;
  stringPoolBytes: number;
  overflowPoolBytes: number;
  formatPaletteSize: number;
  cellCount: number;
  sampleCells: ViewportSnapshotCell[];
}

export interface ViewportSnapshotData {
  viewports: ViewportSnapshotViewport[];
}

export interface SceneGraphSnapshotObject {
  id: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  zIndex: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  groupId: string | null;
  rotation: number;
}

export interface SceneGraphSnapshotData {
  objects: SceneGraphSnapshotObject[];
}

export interface CellSnapshotData {
  row: number;
  col: number;
  viewportId: string;
  valueType: number;
  numberValue: number;
  displayText: string | null;
  errorText: string | null;
  hasFormula: boolean;
  hasComment: boolean;
  hasSparkline: boolean;
  hasHyperlink: boolean;
  isCheckbox: boolean;
  hasValidationError: boolean;
  formatIdx: number;
  format: Record<string, unknown> | null;
  flags: number;
  bgColorOverride: string | null;
  fontColorOverride: string | null;
}

// ── Programmatic API types (for app-eval and agent tooling) ──

/**
 * Action sub-record on a {@link ProgrammaticFlow}. Carries v2 source/kind/
 * tSinceStepStart so callers can tell keyboard-driven from harness-helper-
 * driven dispatches.
 */
export interface ProgrammaticFlowAction extends FlowEntryMeta {
  name: string;
  /** `null` for in-flight harness-helper actions — see {@link ActionDispatchEvent.handled}. */
  handled: boolean | null;
  durationMs: number;
  error?: string;
  receiptCount: number;
  payload?: unknown;
}

export interface ProgrammaticFlowTransition extends FlowEntryMeta {
  machineId: string;
  fromState: string;
  toState: string;
  eventType: string;
  durationMs?: number;
}

export interface ProgrammaticFlowReceipt extends FlowEntryMeta {
  domain: string;
  action: string;
  id: string;
}

export interface ProgrammaticFlowBridgeCall extends FlowEntryMeta {
  bridge: string;
  method: string;
  durationMs: number;
  mutationMeta?: {
    changedCellCount: number;
    recalcedCellCount: number;
  };
}

export interface ProgrammaticFlowViewportUpdate extends FlowEntryMeta {
  kind: string;
  patchCount: number;
}

export interface ProgrammaticFlowGuardRejection extends FlowEntryMeta {
  machineId: string;
  eventType: string;
}

/** Structured causal flow for a single interaction, keyed by correlationId */
export interface ProgrammaticFlow {
  /**
   * Schema version. v1 (`schemaVersion` absent or `1`) flows lack the v2
   * `source` / `kind` / `tSinceStepStart` metadata. v2 flows always have
   * these populated on every entry — see {@link FlowEntryMeta}.
   *
   * Use the eval-harness flow upgrader to lift older fixtures.
   */
  schemaVersion?: 1 | 2;
  correlationId: number;
  /**
   * The first action in this flow. Backwards-compatible single-record
   * surface kept for legacy consumers (`classify.ts`, `hint.ts`,
   * `inspect.ts`, etc).
   *
   * After O-D, a single step can carry both a harness-helper action
   * (`source: 'harness'`) AND a keyboard-driven action (`source: 'keyboard'`)
   * because keyboard helpers like `keyboard.pressKey` emit a synthetic
   * harness record alongside the real keyboard-driven dispatch. New code
   * should iterate {@link actions} to see them all in time order.
   */
  action: ProgrammaticFlowAction | null;
  /**
   * Every action observed in this flow's correlation window, in
   * `tSinceStepStart` order. Added by O-D; existing consumers still read
   * `action` (the first entry) and don't need to migrate.
   */
  actions: ProgrammaticFlowAction[];
  transitions: ProgrammaticFlowTransition[];
  receipts: ProgrammaticFlowReceipt[];
  bridgeCalls: ProgrammaticFlowBridgeCall[];
  viewportUpdates: ProgrammaticFlowViewportUpdate[];
  guardRejections: ProgrammaticFlowGuardRejection[];
  /**
   * per-step events ordered by `tSinceStepStart`. Pointer
   * entries already conform to this shape; other event kinds follow.
   * Optional + defaults to `[]` for v1 callers that don't read it.
   */
  events?: FlowEvent[];
}

// ── pointer-flow event shape (mirrors docs/pointer-flow.md §1) ──

/** Pointer-event kinds (D-1 today; O-1 will extend with keyboard/internal kinds). */
export type FlowEventKind = 'pointer.click' | 'pointer.drag' | 'context-menu.open';

/** Role-qualified description of the DOM element a pointer addressed. */
export interface FlowPointerTarget {
  role?: string;
  name?: string;
  testId?: string;
}

interface FlowEventBase {
  source: FlowEventSource;
  kind: FlowEventKind;
  /** Milliseconds since `step.startedAt` (browser performance.now()). Always >= 0. */
  tSinceStepStart: number;
  /** Links a pointer event to the action it caused, when within 50ms. */
  correlationId?: number;
}

export interface FlowPointerClickEvent extends FlowEventBase {
  source: 'pointer';
  kind: 'pointer.click';
  target: FlowPointerTarget;
  button: 'left' | 'right' | 'middle';
  detail: 1 | 2;
}

export interface FlowPointerDragEvent extends FlowEventBase {
  source: 'pointer';
  kind: 'pointer.drag';
  from: FlowPointerTarget;
  to: FlowPointerTarget;
  /** Wall-clock duration ms. Always > 0. */
  durationMs: number;
}

export interface FlowContextMenuOpenEvent extends FlowEventBase {
  source: 'pointer';
  kind: 'context-menu.open';
  anchor: FlowPointerTarget;
  /** Viewport-relative coordinates (clientX/clientY). */
  x: number;
  y: number;
}

/** Discriminated union covering every event D-1 emits today. */
export type FlowEvent = FlowPointerClickEvent | FlowPointerDragEvent | FlowContextMenuOpenEvent;

// ── app-eval / app-eval rendered-state readback: rendered-state readback types ──

/**
 * The kinds of drawing objects the canvas can render. Mirrors the
 * SceneObject discriminator from `@mog/drawing-canvas/scene/types`,
 * collapsed to the user-visible categories that matter for app-eval
 * (so 'picture' becomes 'image', 'oleObject' becomes the catch-all
 * 'shape', etc). The mapping lives at the `__dt` boundary; downstream
 * scenarios reason in terms of what a user would see.
 */
export type DrawingKind =
  | 'image'
  | 'chart'
  | 'shape'
  | 'formControl'
  | 'smartArt'
  | 'wordArt'
  | 'diagram';

export interface CellRef {
  row: number;
  col: number;
}

export interface DrawingDescriptor {
  id: string;
  kind: DrawingKind;
  /**
   * Cell anchor for the drawing. Computed by snapping the document-space
   * top-left corner to the nearest cell at read time. `to` is omitted
   * when the drawing's bounds collapse to a single cell (the canvas
   * never anchors a 0-size drawing to two cells).
   */
  anchor: { from: CellRef; to?: CellRef; offsetPx?: { dx: number; dy: number } };
  /** Document-space pixel bounds (matches what the canvas drew). */
  boundsPx: { x: number; y: number; w: number; h: number };
  visible: boolean;
  /** For image/chart drawings, the source URL or chart id. Optional for shapes. */
  src?: string;
  chartType?: string;
  dataRange?: string;
  sourceRange?: string;
  chartRange?: string;
  usedSyntheticAnchorFallback?: boolean;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasSnapshot {
  /**
   * PNG-encoded canvas pixels. Bytes are wrapped in a length-prefixed
   * array so the value survives the page.evaluate JSON-serialization
   * boundary (Uint8Array doesn't survive structuredClone through
   * Playwright's RPC).
   */
  png: Uint8Array;
  /** Device pixel ratio at capture time. */
  dpr: number;
}

/** Cell value read programmatically from viewport buffer */
export interface ProgrammaticCellValue {
  row: number;
  col: number;
  viewportId: string;
  displayText: string | null;
  valueType: number;
  numberValue?: number;
  hasFormula?: boolean;
  /** A1 formula text, including the leading "=" when the read surface exposes it. */
  formula?: string;
  errorText?: string | null;
  /** True when the row is hidden (by filter or manual hide). The cell value
   *  is still present (for assertions that verify hidden-row data is preserved)
   *  but the canvas does not paint this row — the user sees nothing. */
  isHidden?: boolean;
}

/** Machine state snapshot for programmatic queries */
export interface ProgrammaticMachineState {
  actorId: string;
  currentState: string;
  context?: unknown;
  eventCount: number;
  lastTransitionAt: number;
}

/** Captured error from fire-and-forget or unhandled promise rejection */
export interface ProgrammaticError {
  timestamp: number;
  source: string;
  error: string;
  stack?: string;
}

// ── overlay readback types ──

/**
 * Stable ids for overlays the corpus reads via `__dt.getOverlayBounds`.
 *
 *   - `alt-hints`: the KeyTip badge overlay rendered after a clean
 *     Alt tap-and-release (`pressAndReleaseAlt`).
 *   - `format-cells` / `paste-special` / `find` / `go-to` / `insert`
 *     / `define-name`: the Excel-equivalent modal dialogs the
 *     keyboard-mode router routes into.
 *   - `data-table`: the Data > What-If > Data Table dialog (app-eval
 *     / David §5.1.1, #137). Used by the dialog-sizing scenarios that
 *     assert the dialog isn't accidentally rendered full-screen.
 *
 * Each id maps to an element on the page via the convention
 * `[data-testid="overlay-<id>"]`. The implementation falls back to
 * `[data-overlay-id="<id>"]` for legacy mounts.
 */
export type OverlayId =
  | 'alt-hints'
  | 'format-cells'
  | 'paste-special'
  | 'find'
  | 'go-to'
  | 'insert'
  | 'define-name'
  | 'data-table';

export interface OverlayBounds {
  /** The overlay element's `getBoundingClientRect()` in CSS pixels. */
  domRect: PixelRect;
  /**
   * Bounding rect of the nearest scroll/overflow container that clips
   * the overlay. `null` when the overlay's ancestors all flow without
   * clipping (i.e. the body is the effective container).
   */
  clippedToContainer: PixelRect | null;
  /**
   * `true` iff every direct child element of the overlay has a
   * non-zero intersection with `clippedToContainer` (or, when
   * `clippedToContainer` is `null`, with the viewport). A `false`
   * value is the smoking gun for clipping regressions.
   */
  allChildrenVisible: boolean;
}

// ── Collaboration presence readback types ──

export interface RemoteCursorDescriptor {
  userId: string;
  name: string;
  color: string;
  activeCell: { row: number; col: number };
  selection: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  sheetId: string;
  isEditing: boolean;
  editingCell?: { row: number; col: number };
}

declare global {
  interface Window {
    __OS_DEVTOOLS__?: OSDevToolsHook;
    __dt?: DevToolsConsoleAPI;
  }
}
