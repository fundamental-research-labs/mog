/**
 * SheetCoordinator - Composition Root
 *
 * ~250-line pure composition root that creates 5 systems and wires cross-system events.
 * All domain logic lives inside the systems. The coordinator only:
 * 1. Creates systems with narrow configs
 * 2. Calls system.start() in dependency order
 * 3. Wires cross-system events
 * 4. Implements handlePointerUp/handlePointerCancel via DragTerminators
 * 5. Implements dispose()
 *
 */

import { createActor } from 'xstate';

import { selectionSelectors } from '../selectors';
import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type { MutationReceipt } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type SheetId, type CellFormat } from '@mog-sdk/contracts/core';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { FloatingObjectPatch, HitTestService } from '@mog-sdk/contracts/rendering';
import { wallClockNow as defaultWallClockNow } from '@mog/platform';
import { focusMachine, type FocusActor } from '@mog/shell';
import {
  createFloatingObjectCache,
  type FloatingObjectCache,
} from '../cache/floating-object-cache';
import { GridEditingSystem } from '../systems/grid-editing/grid-editing-system';
import { setupFindReplaceCoordination } from '../systems/grid-editing/features/find-replace/find-replace-coordination';
import { setupMergeAnchorCoordination } from '../systems/grid-editing/coordination/merge-anchor-coordination';
import { setupNamedRangesIntegration } from '../systems/grid-editing/subscriptions/named-ranges-integration';
import { setupScrollCommitCoordination } from '../systems/grid-editing/coordination/scroll-commit-coordination';
import { setupSheetSwitchCoordination } from '../systems/grid-editing/subscriptions/sheet-switch-coordination';
import { InkSystem } from '../systems/ink/ink-system';
import { InputSystem } from '../systems/input/input-system';
import { ObjectSystem } from '../systems/objects/object-system';
import { RenderSystem } from '../systems/renderer/render-system';

import type { IGridEditingSystem } from '../systems/grid-editing/types';
import type { IInkSystem } from '../systems/ink/types';
import type { IInputSystem } from '../systems/input/types';
import type { IObjectSystem } from '../systems/objects/types';
import type { IRenderSystem } from '../systems/renderer/types';

import { wireConnectorRerouting } from './connector-rerouting';
import {
  wireFlashFillDismissOnSelectionMove,
  wireFlashFillOnCommit,
  wireReturnToOriginSheet,
  wirePendingCellFormatOnCommit,
} from './editor-transition-handlers';
import { setupFlashFillCoordination } from '../systems/grid-editing/features/flash-fill';
import type { SheetCoordinatorConfig } from './types';
import { processCoordinatorReceipts } from './receipt-processing';
import { setupFloatingObjectSheetPopulation } from './floating-object-sheet-population';

// =============================================================================
// SHEET COORDINATOR CLASS
// =============================================================================

export class SheetCoordinator {
  // ===========================================================================
  // The 5 Systems (public readonly)
  // ===========================================================================

  readonly grid: IGridEditingSystem;
  readonly renderer: IRenderSystem;
  readonly objects: IObjectSystem;
  readonly input: IInputSystem;
  readonly ink: IInkSystem;

  // ===========================================================================
  // Reactive Stores
  // ===========================================================================

  /** Reactive cache for floating objects */
  readonly floatingObjectCache: FloatingObjectCache | null = null;

  // ===========================================================================
  // Config + State
  // ===========================================================================

  /** Unified Workbook API for data operations */
  readonly workbook: import('@mog-sdk/contracts/api').WorkbookInternal | undefined;

  /**
   * UI store API exposed for testing and devtools introspection.
   * Wires through `config.sheetSwitchDependencies?.uiStoreApi`. Tests access
   * this via `window.__COORDINATOR__.uiStore.getState()` to read e.g. flash
   * fill preview state.
   */
  readonly uiStore: import('zustand').StoreApi<import('../ui-store').UIState> | undefined;

  private readonly config: SheetCoordinatorConfig;
  private readonly focusActor: FocusActor;
  private disposed = false;

  // Cross-system wiring cleanup
  private readonly crossWiringCleanups: Array<() => void> = [];

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(config: SheetCoordinatorConfig) {
    this.config = config;
    this.workbook = config.workbook;
    this.uiStore = config.sheetSwitchDependencies?.uiStoreApi;
    // -------------------------------------------------------------------------
    // 1. Build shared infrastructure needed by multiple systems
    // -------------------------------------------------------------------------

    // Floating object access (infrastructure-tier).
    // Position lookup wiring happens inside WorkbookImpl._init() — the kernel
    // wires its own infrastructure.
    const floatingObjects: IFloatingObjectManager | null = this.workbook?.floatingObjects ?? null;

    // FloatingObjectCache — reactive Zustand cache for floating objects.
    // Created when we have floating object access; otherwise null (no-doc mode).
    if (floatingObjects && this.workbook) {
      this.floatingObjectCache = createFloatingObjectCache();
      this.wireFloatingObjectManager(floatingObjects, this.workbook);

      // Connector re-routing: when a shape moves/resizes, update connected connectors
      const unsubConnectorRerouting = wireConnectorRerouting(
        this.workbook,
        this.floatingObjectCache,
      );
      this.crossWiringCleanups.push(unsubConnectorRerouting);
    } else {
      this.floatingObjectCache = null;
    }

    // -------------------------------------------------------------------------
    // 2. Create the 5 systems with narrow configs
    // -------------------------------------------------------------------------

    // Grid Editing System
    this.grid = new GridEditingSystem({
      initialSheetId: config.initialSheetId,
      getActiveSheetId: config.getActiveSheetId,
      getEnterKeyDirection: config.workbook
        ? async () => {
            const settings = await this.workbook!.getSettings();
            return (
              (settings.enterKeyDirection as import('@mog-sdk/contracts/machines').Direction) ??
              'down'
            );
          }
        : undefined,
      editorDeps: config.editorDependencies,
      clipboardDeps: config.clipboardDependencies,
      wallClockNow: config.wallClockNow ?? defaultWallClockNow,
      workbook: this.workbook,
      // UIState is a superset of GridEditingUIStore — safe cast
      uiStoreApi: config.sheetSwitchDependencies?.uiStoreApi,
      getGeometry: () => this.renderer.getGeometry(),
      getViewport: () => this.renderer.getViewport(),
      getHitTest: () => this.renderer.getHitTest(),
      onMetric: config.onMetric,
      onDimensionsChanged: (_sheetId: SheetId) => this.renderer.invalidate('dimensions-changed'),
      readOnly: config.readOnly,
    });

    // Render System
    // UIState is a superset of RendererUIStore — safe cast
    this.renderer = new RenderSystem({
      workbook: this.workbook,
      viewport: this.workbook?.viewport,
      sheetSwitchDeps: config.sheetSwitchDependencies
        ? { uiStoreApi: config.sheetSwitchDependencies.uiStoreApi }
        : undefined,
      onMetric: config.onMetric,
    });

    // Object System
    //
    const hitTestService: HitTestService = {
      hitTestOutline: (x, y) => {
        const hit = this.renderer.getHitTest()?.atViewportPoint({ x, y });
        if (!hit) return null;
        if (hit.type === 'outline-level-button') {
          return { type: 'level-button', axis: hit.axis, level: hit.level };
        }
        if (hit.type === 'outline-collapse-button') {
          return {
            type: 'collapse-button',
            axis: hit.axis,
            groupId: hit.groupId,
            collapsed: hit.collapsed,
          };
        }
        return { type: 'none', axis: 'row' };
      },
    };

    this.objects = new ObjectSystem({
      floatingObjects: floatingObjects ?? undefined,
      hitTestService,
      workbook: this.workbook,
      getCanvas: () => this.renderer.getContainer(),
      getGeometry: () => this.renderer.getGeometry(),
      getObjects: () => this.renderer.getObjects(),
      // Workspace-internal: ObjectSystem needs raw GridRenderer for
      // floating-object hit testing with region/handle detail.
      // ISheetViewObjects capability doesn't expose hit-region detail
      // (body vs resize-handle vs rotate) needed by the object interaction
      // state machine. SheetView.gridRenderer is @internal — this access
      // is acceptable from apps/spreadsheet but must not appear in public
      // @mog-sdk/sheet-view declarations.
      getGridRenderer: () => this.renderer.getRenderer(),
      onMetric: config.onMetric,
      mutations: {
        moveChart: async (_ctx, sheetId, chartId, dx, dy) => {
          const wb = this.workbook;
          if (!wb) return { success: false };
          wb.setPendingUndoDescription('Move chart');
          const handle = await wb.getSheetById(sheetId).objects.get(chartId);
          if (!handle) return { success: false };
          await handle.move(dx, dy);
          return { success: true };
        },
        resizeChart: async (_ctx, sheetId, chartId, size) => {
          const wb = this.workbook;
          if (!wb) return { success: false };
          wb.setPendingUndoDescription('Resize chart');
          const handle = await wb.getSheetById(sheetId).objects.get(chartId);
          if (!handle) return { success: false };
          await handle.resize(size.width, size.height);
          return { success: true };
        },
        moveObject: async (_ctx, store, objectId, x, y) => {
          const wb = this.workbook;
          if (!wb) return { success: false };
          if (!store) return { success: false };
          const existing = await store.getObject(objectId);
          if (!existing) return { success: false };
          wb.setPendingUndoDescription('Move object');
          store.moveObject(objectId, x, y);
          return { success: true };
        },
        resizeObject: async (_ctx, store, objectId, width, height) => {
          const wb = this.workbook;
          if (!wb) return { success: false };
          if (!store) return { success: false };
          const existing = await store.getObject(objectId);
          if (!existing) return { success: false };
          wb.setPendingUndoDescription('Resize object');
          store.resizeObject(objectId, width, height);
          return { success: true };
        },
        rotateObject: async (_ctx, store, objectId, angle) => {
          const wb = this.workbook;
          if (!wb) return { success: false };
          if (!store) return { success: false };
          const existing = await store.getObject(objectId);
          if (!existing) return { success: false };
          wb.setPendingUndoDescription('Rotate object');
          store.rotateObject(objectId, angle);
          return { success: true };
        },
      },
    });

    // Input System
    this.input = new InputSystem({
      platform: config.platform,
      workbook: this.workbook,
      inputConfig: config.inputConfig,
      enableKeyboard: config.enableKeyboard,
      onUIAction: config.onUIAction,
      // UIState is a superset of KeyboardUIStore — safe cast
      sheetSwitchDeps: config.sheetSwitchDependencies
        ? { uiStoreApi: config.sheetSwitchDependencies.uiStoreApi }
        : undefined,
      onMetric: config.onMetric,
    });

    // Focus actor for input system's focus coordination (shared focus stack)
    this.focusActor = createActor(focusMachine);
    this.focusActor.start();
    this.input.setFocusActor(this.focusActor);

    // Ink System
    this.ink = new InkSystem({
      getCanvas: () => this.renderer.getContainer(),
      getGeometry: () => this.renderer.getGeometry(),
      onMetric: config.onMetric,
    });

    // -------------------------------------------------------------------------
    // 3. Start systems in dependency order
    // -------------------------------------------------------------------------

    this.grid.start();
    this.renderer.start();
    this.objects.start();
    this.input.start();
    this.ink.start();

    // Wire viewport-follow: selection actor's `userSelectionChanged` emit
    // is the single source of truth for "scroll active cell into view".
    // Subscription cleanup is owned by RenderSystem.dispose().
    this.renderer.setSelectionActorForViewportFollow(this.grid.access.actors.selection);

    // -------------------------------------------------------------------------
    // 4. Wire cross-system events
    // -------------------------------------------------------------------------

    this.wireCrossSystemEvents();
  }

  // ===========================================================================
  // Late-Arriving Dependencies (React layer → composition root → systems)
  // ===========================================================================

  /**
   * Set renderer dependencies.
   *
   * The object system no longer needs a DimensionProvider — it uses
   * ComputeBridge directly for dimension queries. Only the renderer needs these deps.
   * The renderer execution creates VPI+VMI from the ViewportReader.
   *
   * The React layer calls this ONE method; the composition root distributes internally.
   */
  setRendererDependencies(dependencies: import('./types').RendererDependencies): void {
    this.renderer.setRendererDependencies(dependencies);
  }

  // ===========================================================================
  // Cross-System Event Wiring
  // ===========================================================================

  private wireCrossSystemEvents(): void {
    // Selection context exclusivity (grid <-> objects)
    this.crossWiringCleanups.push(
      this.grid.onSelectionActive(() => {
        this.objects.notifyExternalSelectionActive();
      }),
    );

    this.crossWiringCleanups.push(
      this.objects.onObjectSelectionActive(() => {
        this.grid.notifyExternalSelectionActive();
      }),
    );

    // Editor-focus synchronization
    this.crossWiringCleanups.push(this.grid.onEditStart(() => this.input.focusEditor()));

    this.crossWiringCleanups.push(this.grid.onEditEnd(() => this.input.focusGrid()));

    // Active-cell metadata cache: keep the kernel-owned active-cell read
    // model warm from selection changes. Edit source is intentionally not
    // warmed here; beginEditSession owns protected/hidden-aware source reads.
    if (this.workbook && this.config.getActiveSheetId) {
      const workbook = this.workbook;
      const selectionActor = this.grid.access.actors.selection;
      const getActiveSheetId = () => toSheetId(this.config.getActiveSheetId!());
      let last: {
        sheetId: SheetId;
        row: number;
        col: number;
      } | null = null;

      const refreshActiveCell = () => {
        const sheetId = getActiveSheetId();
        const { activeCell } = selectionActor.getSnapshot().context;
        if (
          last &&
          last.sheetId === sheetId &&
          last.row === activeCell.row &&
          last.col === activeCell.col
        ) {
          return;
        }
        last = { sheetId, row: activeCell.row, col: activeCell.col };

        try {
          const ws = workbook.getSheetById(sheetId);
          void ws.refreshActiveCellData(activeCell.row, activeCell.col).catch((err) => {
            console.warn('[SheetCoordinator] active-cell cache refresh failed', err);
          });
        } catch {
          // Sheet can disappear during deletion/import teardown; the next valid
          // selection change will repopulate the active-cell cache.
        }
      };

      refreshActiveCell();
      const sub = selectionActor.subscribe(refreshActiveCell);
      this.crossWiringCleanups.push(() => sub.unsubscribe());
    }

    // Cross-sheet formula: return to origin sheet on edit completion (commit or cancel).
    // The editor's context.sheetId is the sheet where editing started. If the user
    // navigated to another sheet while building a cross-sheet formula, switch back
    // when the editor goes inactive (via Enter commit, Tab commit, or Escape cancel).
    if (this.config.sheetSwitchDependencies) {
      const uiStoreApi = this.config.sheetSwitchDependencies.uiStoreApi;
      const editorActor = this.grid.access.actors.editor;

      this.crossWiringCleanups.push(wireReturnToOriginSheet(editorActor, uiStoreApi));
    }

    // Pending cell format: re-apply format after commit.
    // When a user presses Cmd+B on an empty cell and then types, the Rust
    // compute layer may discard the format-only entry when no value exists.
    // After the value is committed we re-apply the pending format so that it
    // persists alongside the newly written cell value.
    if (this.config.sheetSwitchDependencies && this.workbook) {
      const uiStoreApi = this.config.sheetSwitchDependencies.uiStoreApi;
      const editorActor = this.grid.access.actors.editor;
      const workbook = this.workbook;

      this.crossWiringCleanups.push(
        wirePendingCellFormatOnCommit(editorActor, uiStoreApi, workbook),
      );
    }

    // Flash Fill auto-preview: when the user commits a cell, ask the Flash
    // Fill coordinator to look for a transformation pattern across prior
    // examples in the same column. If one is detected, the coordinator will
    // populate `uiStore.flashFillPreview` with ghosted preview values.
    //
    // The coordinator owns the async pattern detection + UI state mutation;
    // this wiring just kicks it off on each commit transition.
    if (this.config.sheetSwitchDependencies && this.workbook) {
      const uiStoreApi = this.config.sheetSwitchDependencies.uiStoreApi;
      const editorActor = this.grid.access.actors.editor;
      const workbook = this.workbook;
      const getActiveSheetId = (): SheetId =>
        toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))());

      const flashFillSetup = setupFlashFillCoordination({
        workbook,
        // UIState is a superset of GridEditingUIStore — safe cast at the
        // coordinator boundary (same pattern as render-/grid-editing-system).
        uiStore: uiStoreApi as unknown as import('zustand').StoreApi<
          import('../systems/grid-editing/types').GridEditingUIStore
        >,
        getActiveSheetId,
      });
      this.crossWiringCleanups.push(flashFillSetup.cleanup);
      this.crossWiringCleanups.push(wireFlashFillOnCommit(editorActor, flashFillSetup.coordinator));
      this.crossWiringCleanups.push(
        wireFlashFillDismissOnSelectionMove(
          this.grid.access.actors.selection,
          flashFillSetup.coordinator,
        ),
      );
    }

    // Scroll-commit: commit editor on grid scroll (Excel behavior)
    const scrollCommitResult = setupScrollCommitCoordination({
      editorActor: this.grid.access.actors.editor,
      onScrollChange: (callback) => this.input.onScrollChange(callback),
    });
    this.crossWiringCleanups.push(scrollCommitResult.cleanup);

    // Render invalidation (all sources -> renderer)
    this.crossWiringCleanups.push(
      this.grid.onStateChange(() => this.renderer.invalidate('grid-state')),
    );

    this.crossWiringCleanups.push(
      this.objects.onStateChange(() => this.renderer.invalidate('objects')),
    );

    this.crossWiringCleanups.push(this.ink.onStateChange(() => this.renderer.invalidate('ink')));

    // Named ranges: recalculate dependent formulas on name CRUD events
    if (this.workbook && this.config.getActiveSheetId) {
      this.crossWiringCleanups.push(
        setupNamedRangesIntegration({
          workbook: this.workbook,
          getActiveSheetId: this.config.getActiveSheetId,
        }),
      );
    }

    // Merge anchor: after a merge whose region contains the current
    // activeCell, snap activeCell to the merge top-left (Excel parity).
    // Sibling of the renderer's `merges:changed` listener — covers ALL
    // merge entry points (action handlers, devtools, keyboard) without
    // duplicating logic into each merge call site.
    // @see systems/grid-editing/coordination/merge-anchor-coordination.ts
    if (this.workbook && this.config.getActiveSheetId) {
      const workbook = this.workbook;
      const getActiveSheetId = this.config.getActiveSheetId;
      const mergeAnchor = setupMergeAnchorCoordination({
        workbook,
        selectionActor: this.grid.access.actors.selection,
        getActiveSheetId: () => toSheetId(getActiveSheetId()),
      });
      this.crossWiringCleanups.push(mergeAnchor.cleanup);
    }

    // Find-replace coordination: wires search/replace operations to the renderer for
    // highlight invalidation. Lifted to SheetCoordinator to avoid GridEditingSystem
    // directly referencing RendererActor (cross-system coupling).
    //
    // TIMING DEPENDENCY: The UI (FindReplaceDialog.tsx useEffect) independently
    // sends a SEARCH event to transition the machine to 'searching' state. The coordinator
    // then detects the query change via onStateChange() and triggers debouncedSearch(),
    // which eventually sends SEARCH_COMPLETE. These two triggers must stay in sync.
    if (this.workbook) {
      const workbook = this.workbook;
      const findReplaceResult = setupFindReplaceCoordination({
        findReplaceActor: this.grid.access.actors.findReplace,
        selectionActor: this.grid.access.actors.selection,
        invalidateRenderer: () => this.renderer.invalidate('find-replace'),
        resolveCellPosition: async () => {
          // Primary resolution is cache-based (see navigateToResult / executeReplace).
          // This fallback returns null — navigation skipped, search results still display.
          return null;
        },
        getActiveSheetId: () =>
          toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))()),
        workbook,
        setActiveSheet: this.config.sheetSwitchDependencies
          ? (sheetId) =>
              this.config.sheetSwitchDependencies!.uiStoreApi.getState().setActiveSheet(sheetId)
          : undefined,
        overrideTargetSheetViewState: this.config.sheetSwitchDependencies
          ? (sheetId, row, col) => {
              const uiStore = this.config.sheetSwitchDependencies!.uiStoreApi.getState();
              const existing = uiStore.getSheetViewState(sheetId);
              uiStore.saveSheetViewState(sheetId, {
                ranges: [{ startRow: row, startCol: col, endRow: row, endCol: col }],
                activeCell: { row, col },
                anchor: null,
                anchorCol: null,
                anchorRow: null,
                scrollTop: existing?.scrollTop ?? 0,
                scrollLeft: existing?.scrollLeft ?? 0,
              });
            }
          : undefined,
      });

      this.crossWiringCleanups.push(findReplaceResult.cleanup);
    }

    // Sheet switch coordination: save/restore view state (selection + scroll) on sheet switch.
    // Also persists cell-level scroll position to Rust ground truth.
    if (this.workbook && this.config.sheetSwitchDependencies) {
      const uiStoreApi = this.config.sheetSwitchDependencies.uiStoreApi;
      const workbook = this.workbook;

      this.crossWiringCleanups.push(
        setupSheetSwitchCoordination({
          workbook,
          importDurability: this.config.sheetSwitchDependencies.importDurability,
          editorActor: this.grid.access.actors.editor,
          clipboardActor: this.grid.access.actors.clipboard,
          rendererActor: this.renderer.access.actors.renderer,
          selectionActor: this.grid.access.actors.selection,
          chartActor: this.objects.access.actors.chart,

          // Subscribe to activeSheetId changes, providing both new and previous IDs
          onSheetSwitch: (callback) => {
            return uiStoreApi.subscribe((state, prevState) => {
              if (state.activeSheetId !== prevState.activeSheetId) {
                callback(state.activeSheetId, prevState.activeSheetId);
              }
            });
          },

          // The editing sheet is the sheet where editing started (from editor context),
          // NOT the currently active sheet. By the time Zustand subscribers fire,
          // UIStore.activeSheetId has already been updated to the new sheet.
          // Reading from editor context.sheetId gives the correct origin sheet.
          getEditingSheetId: () => {
            const editorState = this.grid.access.actors.editor.getSnapshot();
            const isEditing = !editorState.matches('inactive');
            return isEditing ? (editorState.context.sheetId ?? null) : null;
          },

          // UIStore view state callbacks
          getSheetViewState: (sheetId) => uiStoreApi.getState().getSheetViewState(sheetId),
          saveSheetViewState: (sheetId, state) =>
            uiStoreApi.getState().saveSheetViewState(sheetId, state),
          deleteSheetViewState: (sheetId) => uiStoreApi.getState().deleteSheetViewState(sheetId),

          // Get current pixel scroll position from renderer
          getScrollPosition: () => this.renderer.getScrollPosition(),

          // Dimension bounds validation (delegates to geometry capability)
          getSheetBounds: () => this.renderer.getSheetBounds(),

          // Delegate to RenderSystem for top-left visible cell (Rust scroll persistence).
          getTopLeftCell: (sheetId) => this.renderer.getTopLeftVisibleCell(sheetId),

          // Restore focus to grid unless same-sheet formula editing still owns the inline editor.
          onSheetSwitchComplete: () => {
            const editorState = this.grid.access.actors.editor.getSnapshot();
            const activeSheetId = uiStoreApi.getState().activeSheetId;
            const editingSheetId = editorState.context.sheetId;
            const formulaEditingOnActiveSheet =
              editorState.matches('formulaEditing') && editingSheetId === activeSheetId;
            if (!formulaEditingOnActiveSheet) {
              this.input.focusGrid();
            }
          },

          // re-push layout-predicate callbacks
          // (isRowHidden / isColHidden / getMergedRegionAt) into the
          // selection machine so the new sheet's merges/visibility drive
          // navigation. Without this re-fire, the machine's merge-escape
          // logic would still resolve against the previous sheet's merges.
          //
          // Fire-and-forget: refreshLayoutCallbacks is async (it pre-fetches
          // hidden-row/col bitmaps for sync predicate use inside the
          // selection machine). The sheet-switch coordination doesn't need
          // to coordinate with the fetch landing — until it lands, the
          // machine sees `undefined` callbacks (or the prior sheet's
          // values, briefly) and falls back to "no hidden rows / no
          // merges". A network/storage round-trip is shorter than the
          // user's next keystroke after a sheet switch, so this is safe.
          refreshLayoutCallbacks: () => {
            void this.grid.refreshLayoutCallbacks().catch((err) => {
              console.error(
                '[SheetCoordinator] refreshLayoutCallbacks failed on sheet switch',
                err,
              );
            });
          },
        }),
      );
    }

    // Toolbar format coordination: keep UIStore.activeCellFormat in sync with the active cell's
    // format so ribbon buttons (Bold, Italic, etc.) show correct active state.
    // Uses dedicated toolbarDependencies — not gated on sheetSwitchDependencies.
    if (this.workbook && this.config.toolbarDependencies) {
      const tbUiStoreApi = this.config.toolbarDependencies.uiStoreApi;
      const tbWorkbook = this.workbook;
      const tbSelectionActor = this.grid.access.actors.selection;

      const getSheetId = () =>
        toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))());

      const readAndUpdateFormat = () => {
        const sheetId = getSheetId();
        const { activeCell } = tbSelectionActor.getSnapshot().context;
        try {
          const ws = tbWorkbook.getSheetById(sheetId);
          const format =
            (ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
              | CellFormat
              | undefined) ?? null;
          tbUiStoreApi.getState().setActiveCellFormat(format);
        } catch {
          // Sheet not found during sheet deletion or initialization — skip update
        }
      };

      // Keep UIStore.toolbarRanges in sync with the selection actor's ranges.
      // Toolbar consumers (AlignmentGroup, AlignmentTab dialog, context menu)
      // read toolbarRanges for merge-state detection.
      const readAndUpdateToolbarRanges = () => {
        const ranges = selectionSelectors.ranges(tbSelectionActor.getSnapshot());
        if (ranges) {
          const normalized = ranges.map(
            (r: {
              startRow: number;
              endRow: number;
              startCol: number;
              endCol: number;
              isFullRow?: boolean;
              isFullColumn?: boolean;
            }) => ({
              startRow: Math.min(r.startRow, r.endRow),
              endRow: Math.max(r.startRow, r.endRow),
              startCol: Math.min(r.startCol, r.endCol),
              endCol: Math.max(r.startCol, r.endCol),
              isFullRow: r.isFullRow,
              isFullColumn: r.isFullColumn,
            }),
          );
          tbUiStoreApi.getState().setToolbarRanges(normalized);
        }
      };

      // Re-read format when selection moves to a different cell
      const selectionSub = tbSelectionActor.subscribe(() => {
        readAndUpdateFormat();
        readAndUpdateToolbarRanges();
      });
      this.crossWiringCleanups.push(() => selectionSub.unsubscribe());

      // Update immediately when the active cell's format changes (e.g., Ctrl+B applies bold)
      const formatUnsub = tbWorkbook.on('cell:format-changed', (event) => {
        const sheetId = getSheetId();
        const { activeCell } = tbSelectionActor.getSnapshot().context;
        if (
          event.sheetId === sheetId &&
          event.row === activeCell.row &&
          event.col === activeCell.col
        ) {
          // Read fresh format from the viewport buffer — it is already patched by
          // applyMultiViewportPatches before applyAndNotify emits this event, so
          // getCellData always returns the post-mutation format.
          // Using event.newFormat directly was unreliable because some Rust mutations
          // (e.g. compute_set_format_for_ranges used by INCREASE/DECREASE_FONT_SIZE)
          // do not populate PropertyChange.format, yielding undefined here.
          readAndUpdateFormat();
        }
      });
      this.crossWiringCleanups.push(formatUnsub);

      // Initial population
      readAndUpdateFormat();
      readAndUpdateToolbarRanges();
    }
  }

  // ===========================================================================
  // Floating Object Store Wiring
  // ===========================================================================

  /**
   * Wire event subscriptions that keep the FloatingObjectCache in sync
   * with the kernel's floating object state.
   *
   * Pattern: subscribe to invalidation events first, then populate.
   * Events are idempotent re-reads so no race condition.
   */
  private wireFloatingObjectManager(
    floatingObjects: IFloatingObjectManager,
    workbook: import('@mog-sdk/contracts/api').WorkbookInternal,
  ): void {
    const store = this.floatingObjectCache!;

    // =========================================================================
    // Granular event handling with microtask coalescing
    //
    // Instead of re-reading ALL objects for a sheet on every event (O(n) per
    // event, destroys structural sharing), we handle each event granularly:
    //
    // created/updated → fetch THAT one object → store.setObject
    // deleted → store.removeObject (no fetch needed)
    //
    // This preserves structural sharing — unchanged objects keep their
    // references in the Map, so Zustand selectors for unrelated objects
    // don't trigger re-renders.
    //
    // Multiple synchronous events (common during batch operations) are
    // coalesced into a single microtask flush, which fetches all pending
    // objects in parallel and applies them in one atomic store.applyBatch().
    // =========================================================================

    /** objectId → inline data (object) or `true` if a fetch is needed */
    const pendingFetches = new Map<string, unknown>();
    /** objectId → pre-computed pixel bounds from Rust (when available) */
    const pendingBounds = new Map<
      string,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    /** objectIds to remove (deleted) */
    const pendingDeletes = new Set<string>();
    /** objectId → changedFields from the event (when available) */
    const pendingChangedFields = new Map<string, string[]>();
    /** objectIds with bounds-only updates (no data change, no fetch needed) */
    const pendingBoundsOnly = new Map<
      string,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    let flushScheduled = false;
    let projectionDisposed = false;
    let projectionGeneration = 0;

    this.crossWiringCleanups.push(() => {
      projectionDisposed = true;
      projectionGeneration++;
      flushScheduled = false;
      pendingFetches.clear();
      pendingBounds.clear();
      pendingChangedFields.clear();
      pendingBoundsOnly.clear();
      pendingDeletes.clear();
    });

    const scheduleFlush = () => {
      if (projectionDisposed) return;
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
    };

    const scheduleObjectFetch = (
      objectId: string,
      data?: unknown,
      eventBounds?: { x: number; y: number; width: number; height: number; rotation: number },
      changedFields?: string[],
    ) => {
      if (projectionDisposed) return;
      // If a delete was pending for this object, cancel it — the object is back
      pendingDeletes.delete(objectId);
      // Bounds-only update: no data change, skip fetch, just update cached bounds.
      // This happens when dimension changes (row resize, column insert, etc.) shift
      // cell-anchored objects without changing their anchor config.
      if (data == null && eventBounds) {
        // Only schedule bounds-only if no full fetch is already pending
        if (!pendingFetches.has(objectId)) {
          pendingBoundsOnly.set(objectId, eventBounds);
        }
        scheduleFlush();
        return;
      }
      // Full update — clear any bounds-only pending for this object
      pendingBoundsOnly.delete(objectId);
      pendingFetches.set(objectId, data ?? true);
      if (eventBounds) {
        pendingBounds.set(objectId, eventBounds);
      }
      if (changedFields) {
        pendingChangedFields.set(objectId, changedFields);
      }
      scheduleFlush();
    };

    const scheduleObjectDelete = (objectId: string) => {
      if (projectionDisposed) return;
      // If a fetch was pending for this object, cancel it — it's gone
      pendingFetches.delete(objectId);
      pendingBounds.delete(objectId);
      pendingChangedFields.delete(objectId);
      pendingBoundsOnly.delete(objectId);
      pendingDeletes.add(objectId);
      scheduleFlush();
    };

    const flush = async () => {
      if (projectionDisposed) {
        flushScheduled = false;
        return;
      }
      const flushGeneration = projectionGeneration;
      flushScheduled = false;

      // Snapshot and clear pending work
      const fetchEntries = [...pendingFetches.entries()];
      const boundsSnapshot = pendingBounds.size > 0 ? new Map(pendingBounds) : undefined;
      const changedFieldsSnapshot =
        pendingChangedFields.size > 0 ? new Map(pendingChangedFields) : undefined;
      const boundsOnlySnapshot =
        pendingBoundsOnly.size > 0 ? new Map(pendingBoundsOnly) : undefined;
      const deleteIds = [...pendingDeletes];
      pendingFetches.clear();
      pendingBounds.clear();
      pendingChangedFields.clear();
      pendingBoundsOnly.clear();
      pendingDeletes.clear();

      const fetched: FloatingObject[] = [];
      const needsFetch: string[] = [];

      // Separate entries with inline data from those needing a fetch
      for (const [id, data] of fetchEntries) {
        if (data !== true && data != null && typeof data === 'object') {
          // Inline data available — use directly, no round-trip
          fetched.push(data as FloatingObject);
        } else {
          needsFetch.push(id);
        }
      }

      // Fetch only objects that don't have inline data
      if (needsFetch.length > 0) {
        const results = await Promise.all(needsFetch.map((id) => floatingObjects.getObject(id)));
        if (projectionDisposed || projectionGeneration !== flushGeneration) return;
        for (const obj of results) {
          if (obj) {
            fetched.push(obj);
          }
          // If getObject returns undefined, the object was deleted between
          // event emission and fetch — treat it as a delete
        }
      }

      // Merge bounds-only updates into the boundsSnapshot for the batch apply.
      // These objects have no data change — we only update their cached bounds.
      let mergedBounds = boundsSnapshot;
      if (boundsOnlySnapshot) {
        mergedBounds = mergedBounds ? new Map(mergedBounds) : new Map();
        for (const [id, b] of boundsOnlySnapshot) {
          mergedBounds.set(id, b);
        }
      }

      // Rust's create-floating-object mutation doesn't include pixel bounds
      // for all object types (e.g. pictures). Without bounds, the renderer's
      // applySceneGraphPatches skips the object entirely. Fetch bounds from
      // Rust for any fetched objects that the event didn't supply bounds for.
      const needsBoundsObjs = fetched.filter((obj) => !mergedBounds?.has(obj.id));
      if (needsBoundsObjs.length > 0) {
        const sid = (this.config.getActiveSheetId ?? (() => this.config.initialSheetId))();
        if (sid) {
          const allBounds = await floatingObjects.computeAllObjectBounds(toSheetId(sid));
          if (projectionDisposed || projectionGeneration !== flushGeneration) return;
          for (const obj of needsBoundsObjs) {
            const b = allBounds.get(obj.id);
            if (b) {
              if (!mergedBounds) mergedBounds = new Map();
              mergedBounds.set(obj.id, b);
            }
          }
        }
      }

      // Apply all changes in a single atomic store update
      if (fetched.length > 0 || deleteIds.length > 0 || (mergedBounds && mergedBounds.size > 0)) {
        if (projectionDisposed || projectionGeneration !== flushGeneration) return;
        // Snapshot existing object IDs before applying the batch so we can
        // distinguish 'created' vs 'updated' in the renderer patches.
        const existingObjects = store.getState().objects;

        store.getState().applyBatch(fetched, deleteIds, mergedBounds);

        // Build FloatingObjectPatch[] and push directly to the renderer,
        // bypassing the Zustand subscription diff in render-context-coordination.
        const patches: FloatingObjectPatch[] = [];

        for (const obj of fetched) {
          patches.push({
            objectId: obj.id,
            kind: existingObjects.has(obj.id) ? 'updated' : 'created',
            data: obj,
            bounds: mergedBounds?.get(obj.id),
            changedFields: changedFieldsSnapshot?.get(obj.id),
          });
        }

        for (const id of deleteIds) {
          patches.push({ objectId: id, kind: 'remove' });
        }

        // Bounds-only updates: objects whose pixel bounds shifted (e.g. row/col resize)
        // but whose data didn't change. Read current data from store (post-applyBatch).
        if (boundsOnlySnapshot) {
          for (const [id, b] of boundsOnlySnapshot) {
            // Skip if already covered by a fetched object
            if (fetched.some((obj) => obj.id === id)) continue;
            const objData = store.getState().objects.get(id);
            if (objData) {
              patches.push({ objectId: id, kind: 'updated', data: objData, bounds: b });
            }
          }
        }

        if (patches.length > 0) {
          this.renderer.getObjects()?.applyPatches(patches);
        }
      }
    };

    // =========================================================================
    // Event subscriptions
    //
    // All floating object mutations flow through the compute bridge, so
    // MutationResultHandler emits floatingObject:created/updated/deleted.
    // These are the ONLY lifecycle events we subscribe to — no canvasObject:*
    // subscriptions needed. This eliminates duplicate event processing that
    // previously caused redundant Rust round-trips on insert.
    // =========================================================================

    const unsubFOCreated = workbook.on('floatingObject:created', (event) => {
      if (event.objectId) {
        scheduleObjectFetch(event.objectId, event.data, event.bounds);
        // TODO: auto-select newly created object
      }
    });
    this.crossWiringCleanups.push(unsubFOCreated);

    const unsubFOUpdated = workbook.on('floatingObject:updated', (event) => {
      if (event.objectId) {
        scheduleObjectFetch(event.objectId, event.data, event.bounds, event.changedFields);
      }
    });
    this.crossWiringCleanups.push(unsubFOUpdated);

    const unsubFODeleted = workbook.on('floatingObject:deleted', (event) => {
      if (event.objectId) {
        scheduleObjectDelete(event.objectId);
        this.objects.access.commands.object.objectDeleted(event.objectId);
        this.objects.access.commands.chart.remoteChartDeleted(event.objectId);
      }
    });
    this.crossWiringCleanups.push(unsubFODeleted);

    // =========================================================================
    // Initial population
    //
    // Subscribe to events first, then populate the initial active sheet.
    // Other sheets get populated on first activation by the sheet-switch
    // subscription below; events that fire during the async population are
    // coalesced and applied after — no race condition.
    // =========================================================================
    if (this.config.initialSheetId) {
      const initialSheetId = toSheetId(this.config.initialSheetId);
      const initialGeneration = projectionGeneration;
      void (async () => {
        if (projectionDisposed || projectionGeneration !== initialGeneration) return;
        const [objects, bounds] = await Promise.all([
          floatingObjects.getObjectsInSheet(initialSheetId),
          floatingObjects.computeAllObjectBounds(initialSheetId),
        ]);
        if (projectionDisposed || projectionGeneration !== initialGeneration) return;
        if (objects.length > 0) {
          store.getState().setObjectsForSheet(initialSheetId, objects, bounds);
        }
      })();
    }

    // =========================================================================
    // Sheet-switch population
    //
    // The kernel emits no synthetic load events on sheet activation, so the
    // FloatingObjectCache stays empty for any sheet other than the initial
    // one until a mutation lands. That breaks the renderer's first repaint
    // after a tab click: `useFloatingObjectsInSheet(newSheetId)` returns []
    // and the scene-graph rebuild in GridRenderer.syncSceneGraph()
    // pairs cache objects with kernel bounds by ID — when the sets disagree
    // the rebuild draws the previous sheet's drawings (whose per-sheet IDs
    // happen to collide with the new sheet's, e.g. fobj-0/fobj-1).
    //
    // Fix: on activeSheetId change, fetch the new sheet's objects through the
    // kernel manager, hydrate the cache, then re-trigger the renderer's
    // switchSheet so its syncSceneGraph reads the populated cache.
    // switchSheet is idempotent for the same sheetId — the second call just
    // does another clear + rebuild, which is the intended self-heal.
    // =========================================================================
    if (this.uiStore) {
      this.crossWiringCleanups.push(
        setupFloatingObjectSheetPopulation({
          uiStore: this.uiStore,
          floatingObjects,
          floatingObjectCache: store,
          getRendererObjects: () => this.renderer.getObjects(),
          getActiveSheetId: () =>
            (this.config.getActiveSheetId ?? (() => this.config.initialSheetId))(),
          importDurability: this.config.sheetSwitchDependencies?.importDurability,
          isDisposed: () => projectionDisposed,
          getGeneration: () => projectionGeneration,
        }),
      );
    }
  }

  // ===========================================================================
  // Cross-System Dispatch (pointer-up/cancel)
  // ===========================================================================

  /**
   * Handle pointer up event by delegating to each system's DragTerminator.
   * Each system checks its own actor states internally.
   */
  handlePointerUp(): void {
    this.grid.dragTerminator.endDrag();
    this.objects.dragTerminator.endDrag();
    this.renderer.pageBreakDragTerminator.endDrag();
    this.ink.dragTerminator.endDrag();
    this.input.clearActivePointerId();
  }

  /**
   * Handle pointer cancel event by delegating to each system's DragTerminator.
   * Each system reverts its own drag state without committing.
   */
  handlePointerCancel(): void {
    this.grid.dragTerminator.cancelDrag();
    this.objects.dragTerminator.cancelDrag();
    this.renderer.pageBreakDragTerminator.cancelDrag();
    this.ink.dragTerminator.cancelDrag();
    this.input.clearActivePointerId();
  }

  // ===========================================================================
  // Receipt Processing (Mutation Receipt Pattern —)
  // ===========================================================================

  /**
   * Process mutation receipts returned by action handlers.
   *
   * This is the pull-path counterpart to the EventBus push-path handled by
   * wireFloatingObjectManager(). When an action handler returns receipts,
   * the caller can pass them here for immediate synchronous processing,
   * bypassing the async EventBus → microtask coalescing pipeline.
   *
   * The processing mirrors what the EventBus listeners do:
   * - floatingObject create/update → update FloatingObjectCache + push renderer patches
   * - floatingObject delete → remove from cache + push renderer 'remove' patch
   *
   * WIRING: This method should be called after dispatch() returns an ActionResult
   * with receipts. The wiring point is wherever dispatch results are consumed —
   * currently the keyboard coordinator, toolbar hooks, and context menu hooks.
   * A future dispatcher middleware or ActionDependencies.coordinator integration
   * will make this automatic.
   *
   * @see wireFloatingObjectManager() for the EventBus (push-path) equivalent
   */
  processReceipts(receipts: MutationReceipt[]): void {
    (window as any).__OS_DEVTOOLS__?.reportReceipt?.(receipts);
    processCoordinatorReceipts(this, receipts);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  dispose(): void {
    if (this.disposed) return;

    // Clean up cross-system wiring
    for (const cleanup of this.crossWiringCleanups) {
      cleanup();
    }
    this.crossWiringCleanups.length = 0;

    // Clear floating object cache
    this.floatingObjectCache?.getState().clear();

    // Stop focus actor
    this.focusActor.stop();

    // Dispose in reverse creation order
    this.ink.dispose();
    this.input.dispose();
    this.objects.dispose();
    this.renderer.dispose();
    this.grid.dispose();

    this.disposed = true;
  }

  isActive(): boolean {
    return !this.disposed;
  }

  // ── DevTools / Testing API ──────────────────────────────────────────
  readonly deleteSheet = (sheetName: string): void => {
    if (!this.workbook) return;

    const confirm = this.config.confirmDialog;
    if (confirm) {
      const confirmed = confirm(
        `Data in sheet "${sheetName}" will be permanently deleted. Continue?`,
      );
      if (!confirmed) return;
    }

    void this.workbook.sheets.remove(sheetName);
  };
}
