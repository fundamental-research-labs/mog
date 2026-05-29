/**
 * GridEditingSystem
 *
 * of Stream 1: Spreadsheet Subsystem Architecture
 *
 * The largest and most complex system. Owns the grid's editing model:
 * - Creates 7 internal actors (selection, editor, clipboard, findReplace, comment, drawBorder, slicer)
 * - Builds the actor-access layer from those actors
 * - Wires the tightly-coupled trio coordination (selection <-> editor <-> clipboard)
 * - Creates internal feature modules
 * - Implements DragTerminator for pointer-up dispatch
 * - Exposes public API (IGridEditingSystem)
 *
 * PHILOSOPHY: No slow migrations. Build the RIGHT solution.
 * Copy existing coordination — don't reinvent logic.
 *
 * @module systems/grid-editing
 */

import { assign, createActor, fromPromise, type InspectionEvent } from 'xstate';

import { clipboardSelectors, editorSelectors, selectionSelectors } from '../../selectors';
import type {
  ClipboardSnapshot,
  Direction,
  EditorSnapshot,
  SelectionSnapshot,
} from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { MutationResult } from '@mog-sdk/contracts/protection';
import type { SlicerCache } from '@mog-sdk/contracts/slicers';
import { sheetId as toSheetId, type CellRange, type SheetId } from '@mog-sdk/contracts/core';

import type { ClipboardActor } from './machines/clipboard-machine';
import { clipboardMachine, getClipboardSnapshot } from './machines/clipboard-machine';
import type { CommentActor } from './machines/comment-machine';
import { commentMachine } from './machines/comment-machine';
import type { DrawBorderActor } from './machines/draw-border-machine';
import { drawBorderMachine } from './machines/draw-border-machine';
import type { FindReplaceActor } from './machines/find-replace-machine';
import { findReplaceMachine } from './machines/find-replace-machine';
import type { EditorActor } from './machines/grid-editor-machine';
import { editorMachine } from './machines/grid-editor-machine';
import type { SelectionActor, SelectionState } from './machines/grid-selection-machine';
import { selectionMachine } from './machines/grid-selection-machine';
import { getSelectionSnapshot } from './machines/selection/derived-state';
import type { SlicerActor } from './machines/slicer-machine';
import { slicerMachine } from './machines/slicer-machine';
import {
  createEditEntryService,
  type BeginEditSessionRequest,
  type EditEntryService,
} from './edit-entry-service';

// Actor-access factories
import {
  createClipboardAccessor,
  createClipboardCommands,
  createCommentAccessor,
  createCommentCommands,
  createDrawBorderAccessor,
  createDrawBorderCommands,
  createEditorAccessor,
  createEditorCommands,
  createFindReplaceAccessor,
  createFindReplaceCommands,
  createSelectionAccessor,
  createSelectionCommands,
} from './actor-access';

// Coordination modules
import {
  setupCrossCoordination,
  setupEditingInputInterception,
  type EditingInputInterceptionResult,
} from './coordination/cross-coordination';
import { setupEditorCommitCoordination } from './coordination/editor-commit-coordination';
import { setupClipboardPasteIntegration } from './coordination/paste-integration';
import { setupValidationCirclesCoordination } from './features/validation';
import { setupTableSelectionCoordination } from './features/table';
import { setupPivotSelectionCoordination } from './features/pivot';
import {
  setupCommentHoverCoordination,
  setupCommentSelectionCoordination,
  type CommentHoverCoordinationResult,
} from './features/comment';
import { guardBridgeMutation } from '../../actions/handlers/bridge-error-guard';
// Types
import { CleanupManager } from '../shared/cleanup-manager';
import type { DragTerminator } from '../shared/drag-terminator';
import { buildCheckboxCoordination } from './features/checkbox/checkbox-coordination';
import { createFillCoordinator, type FillCoordinator } from './features/fill/fill-coordination';
import { createResizeCoordinator, type ResizeCoordinator } from './features/resize';
import type {
  CommentHoverCoordinator,
  DrawBorderCoordinator,
  FindReplaceCoordinator,
  GridEditingActorAccess,
  GridEditingConfig,
  IGridEditingSystem,
} from './types';

// =============================================================================
// HELPER: Direction utilities
// =============================================================================

function getOppositeDirection(dir: Direction | 'none'): Direction | 'none' {
  switch (dir) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'none':
      return 'none';
  }
}

function rangesEqual(a: CellRange, b: CellRange): boolean {
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol
  );
}

function rangeContainsRange(container: CellRange, candidate: CellRange): boolean {
  return (
    candidate.startRow >= container.startRow &&
    candidate.endRow <= container.endRow &&
    candidate.startCol >= container.startCol &&
    candidate.endCol <= container.endCol
  );
}

// =============================================================================
// HELPER: Build EditorSnapshot from raw actor states
// =============================================================================

/**
 * Build EditorSnapshot from editor + selection actor state.
 * editingCell is derived from selection.activeCell when editor is active.
 */
function buildEditorSnapshot(
  editorActor: EditorActor,
  selectionActor: SelectionActor,
): EditorSnapshot {
  const state = editorActor.getSnapshot();
  const isEditing = !state.matches('inactive');
  // Use editingCell from editor context (stable during formula point mode).
  // Falls back to selection.activeCell for backward compatibility.
  const editingCell = isEditing
    ? (state.context.editingCell ?? selectionActor.getSnapshot().context.activeCell)
    : null;

  return {
    isEditing,
    isFormulaEditing: state.matches('formulaEditing'),
    editingCell,
    sheetId: state.context.sheetId,
    mergeBounds: state.context.mergeBounds,
    value: state.context.value,
    hasConflict: state.context.hasConflict,
    isIMEComposing: state.matches('imeComposing'),
  };
}

// =============================================================================
// GRID EDITING SYSTEM
// =============================================================================

/**
 * GridEditingSystem - Complete implementation
 *
 * Creates all internal actors, wires coordination, and exposes the public API
 * defined by IGridEditingSystem.
 */
export class GridEditingSystem implements IGridEditingSystem {
  // ===========================================================================
  // Internal Actors (created and owned by this system)
  // ===========================================================================

  private readonly selectionActor: SelectionActor;
  private readonly editorActor: EditorActor;
  private readonly clipboardActor: ClipboardActor;
  private readonly findReplaceActor: FindReplaceActor;
  private readonly commentActor: CommentActor;
  private readonly drawBorderActor: DrawBorderActor;
  private readonly slicerActor: SlicerActor;

  // ===========================================================================
  // Actor Access Layer (built from internal actors)
  // ===========================================================================

  readonly access: GridEditingActorAccess;

  // ===========================================================================
  // Cross-System Integration
  // ===========================================================================

  readonly dragTerminator: DragTerminator;

  // ===========================================================================
  // Tool Mode Coordinators (sub-coordinators with cleanup lifecycle)
  // ===========================================================================

  readonly findReplace: FindReplaceCoordinator;
  readonly drawBorder: DrawBorderCoordinator;
  readonly commentHover: CommentHoverCoordinator;

  private readonly editEntry: EditEntryService;

  // ===========================================================================
  // Internal State
  // ===========================================================================

  /** Configuration (retained for lazy initialization of features) */
  private readonly config: GridEditingConfig;

  /** Editing input interception (prevents selection-editor divergence) */
  private editingInputInterception: EditingInputInterceptionResult | null = null;

  /** Cleanup functions accumulated during start() */
  private readonly cleanupFns: (() => void)[] = [];

  /**
   * Per-sheet authoritative merge index used by the SelectionMachine's
   * `getMergedRegionAt` layout callback. Populated from
   * `ws.structure.getMergedRegions()` at bootstrap / sheet switch and kept
   * fresh by a `merges:changed` subscription that applies the per-region
   * `kind: 'Set' | 'Removed'` deltas.
   *
   * Why not `ws.viewport.getMerges()`? merge/unmerge use `mutatePlain` —
   * they don't push a viewport binary patch, so the viewport's merge cache
   * is stale immediately after a structure mutation. The selection machine
   * needs a sync source that is fresh the moment `merge()` resolves; that
   * is the bridge's `merges:changed` payload, which delivers per-region
   * detail directly.
   *
   * Mirrors the pattern used by `merge-anchor-coordination.ts`, which
   * documents the same staleness gotcha at file head.
   */
  private readonly mergeRegionsBySheet = new Map<SheetId, CellRange[]>();

  /** Selection-active callbacks */
  private readonly selectionActiveCallbacks = new Set<() => void>();

  /** Edit-start callbacks */
  private readonly editStartCallbacks = new Set<() => void>();

  /** Edit-end callbacks */
  private readonly editEndCallbacks = new Set<() => void>();

  /** State-change callbacks */
  private readonly stateChangeCallbacks = new Set<() => void>();

  /** Slicer cache change callbacks */
  private readonly slicerCacheChangeCallbacks = new Set<() => void>();

  /** Whether start() has been called */
  private started = false;

  /** Whether dispose() has been called */
  private disposed = false;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(config: GridEditingConfig) {
    this.config = config;

    // -------------------------------------------------------------------------
    // 1. Create all 7 actors (with optional devtools inspection)
    // -------------------------------------------------------------------------

    const inspect = (evt: InspectionEvent) => {
      window.__OS_DEVTOOLS__?.reportActor?.(evt.actorRef.sessionId, evt);
    };

    this.selectionActor = createActor(selectionMachine, { id: 'selection', inspect });

    // Provide the commitCellValue invoke service so the editor machine awaits
    // the bridge call before transitioning out of `committing`.
    const editorDeps = config.editorDeps;
    const selectionActorRef = this.selectionActor;
    this.editorActor = createActor(
      editorMachine.provide({
        actions: {
          // Snapshot selection state into editor context before entering committing.
          // This eliminates the raw .getSnapshot() call inside the fromPromise service.
          // @see Rule 18: no raw .getSnapshot() in fromPromise services
          snapshotSelectionForCommit: assign(({ context }) => {
            const snap = selectionActorRef.getSnapshot();
            return {
              commitActiveCell: snap.context.activeCell,
              // Use the explicit edit-session snapshot when available.
              // CSE commits must target the range selected before editing
              // collapsed the visible selection to the active cell.
              commitSelectionRanges:
                context.editStartSelectionRanges ?? selectionSelectors.ranges(snap),
            };
          }),
        },
        actors: {
          commitCellValue: fromPromise(async ({ input: context }) => {
            const {
              value,
              sheetId,
              isArrayFormula,
              datePickerCommit,
              editingCell: editorEditingCell,
              commitActiveCell,
              commitSelectionRanges,
            } = context;
            const editingCell = editorEditingCell ?? commitActiveCell;
            if (editingCell && sheetId && editorDeps?.setCellValue) {
              if (datePickerCommit && editorDeps.setDateValue) {
                editorDeps.setPendingUndoDescription?.(
                  datePickerCommit.kind === 'datetime' ? 'Set date/time' : 'Set date',
                );
                const result = editorDeps.setDateValue(
                  toSheetId(sheetId),
                  editingCell.row,
                  editingCell.col,
                  datePickerCommit.isoDate,
                  datePickerCommit.kind,
                );
                if (result instanceof Promise) await result;
                return;
              }

              editorDeps.setPendingUndoDescription?.(
                `Edit cell ${editingCell.row},${editingCell.col}`,
              );

              if (isArrayFormula && commitSelectionRanges && commitSelectionRanges.length > 0) {
                const range = commitSelectionRanges[0];
                const selectionRange = {
                  startRow: range.startRow,
                  startCol: range.startCol,
                  endRow: range.endRow,
                  endCol: range.endCol,
                };
                if (editorDeps.setArrayFormula) {
                  const result = editorDeps.setArrayFormula(
                    toSheetId(sheetId),
                    selectionRange,
                    value,
                  );
                  if (result instanceof Promise) await result;
                } else {
                  console.warn(
                    '[CSE] setArrayFormula not wired — falling back to single-cell write',
                  );
                  // Fallback: setArrayFormula not wired — write as regular formula to the editing cell
                  const result = editorDeps.setCellValue(
                    toSheetId(sheetId),
                    editingCell.row,
                    editingCell.col,
                    value,
                  );
                  if (result instanceof Promise) await result;
                }
              } else {
                const result = editorDeps.setCellValue(
                  toSheetId(sheetId),
                  editingCell.row,
                  editingCell.col,
                  value,
                );
                if (result instanceof Promise) await result;
              }
            }
          }),
        },
      }),
      { id: 'editor', inspect },
    );
    this.clipboardActor = createActor(clipboardMachine, { id: 'clipboard', input: {}, inspect });
    this.findReplaceActor = createActor(findReplaceMachine, { id: 'findReplace', inspect });
    this.commentActor = createActor(commentMachine, { id: 'comment', inspect });
    this.drawBorderActor = createActor(drawBorderMachine, { id: 'drawBorder', inspect });
    this.slicerActor = createActor(slicerMachine, { id: 'slicer', inspect });

    // -------------------------------------------------------------------------
    // 2. Build actor-access layer from internal actors
    // -------------------------------------------------------------------------

    this.access = this.buildActorAccess();

    // -------------------------------------------------------------------------
    // 3. Build DragTerminator
    // -------------------------------------------------------------------------

    this.dragTerminator = this.buildDragTerminator();

    // -------------------------------------------------------------------------
    // 4. Create tool mode coordinators (placeholder lifecycles)
    // Actual wiring happens in start when dependencies are available.
    // -------------------------------------------------------------------------

    this.findReplace = this.buildFindReplaceCoordinator();
    this.drawBorder = this.buildDrawBorderCoordinator();
    this.commentHover = this.buildCommentHoverCoordinator();
    this.editEntry = createEditEntryService({
      workbook: config.workbook,
      clipboardActor: this.clipboardActor,
      selectionActor: this.selectionActor,
      editorActor: this.editorActor,
      isReadOnly: () => config.readOnly === true,
      getMergedRegion: (_sheetId, cell) => {
        return config.getGeometry?.()?.getMergeAnchor(cell.row, cell.col) ?? undefined;
      },
      getPreEditSelectionRanges: () => selectionSelectors.ranges(this.selectionActor.getSnapshot()),
    });
  }

  // ===========================================================================
  // Snapshot Accessors
  // ===========================================================================

  getSelectionSnapshot(): SelectionSnapshot {
    return getSelectionSnapshot(this.selectionActor.getSnapshot());
  }

  getEditorSnapshot(): EditorSnapshot {
    return buildEditorSnapshot(this.editorActor, this.selectionActor);
  }

  getClipboardSnapshot(): ClipboardSnapshot {
    return getClipboardSnapshot(this.clipboardActor.getSnapshot());
  }

  // ===========================================================================
  // Editing Lifecycle
  // ===========================================================================

  startEditing(cell: CellCoord, sheetId: SheetId, initialValue?: string): void {
    if (!this.config.workbook) {
      if (this.config.readOnly) return;
      const preEditSelectionRanges = selectionSelectors.ranges(this.selectionActor.getSnapshot());
      this.selectionActor.send({
        type: 'BEGIN_CELL_EDIT',
        cell,
      });
      this.editorActor.send({
        type: 'START_EDITING',
        cell,
        sheetId,
        initialValue: initialValue ?? '',
        entryMode: 'typing',
        preEditSelectionRanges,
      });
      return;
    }

    void this.editEntry.beginEditSession({
      sheetId,
      cell,
      entryMode: 'typing',
      initialTextHint: initialValue,
    });
  }

  beginEditSession(request: BeginEditSessionRequest): Promise<MutationResult> {
    return this.editEntry.beginEditSession(request);
  }

  invalidateEditSessions(reason: string): void {
    this.editEntry.invalidate(reason);
  }

  handleStartDragCells(cell: CellCoord, ctrlKey: boolean): void {
    this.selectionActor.send({
      type: 'START_DRAG_CELLS',
      cell,
      ctrlKey,
    });
  }

  handleDragCellsMove(cell: CellCoord, isCopyMode: boolean): void {
    this.selectionActor.send({
      type: 'DRAG_CELLS_MOVE',
      cell,
      ctrlKey: isCopyMode,
    });
  }

  handleCellClick(cell: CellCoord, shiftKey = false, ctrlKey = false): boolean {
    // If editing, intercept the click (commit-then-move pattern)
    if (this.editingInputInterception) {
      return this.editingInputInterception.interceptCellClick(cell, shiftKey, ctrlKey);
    }
    return false;
  }

  commitEdit(direction: Direction | 'none' = 'none'): void {
    this.editorActor.send({ type: 'COMMIT', direction });
  }

  async commitWithKey(commitKey: 'enter' | 'shift-enter' | 'tab' | 'shift-tab'): Promise<void> {
    const enterDir: Direction = (await this.config.getEnterKeyDirection?.()) ?? 'down';
    let direction: Direction | 'none';
    switch (commitKey) {
      case 'enter':
        direction = enterDir;
        break;
      case 'shift-enter':
        direction = getOppositeDirection(enterDir);
        break;
      case 'tab':
        direction = 'right';
        break;
      case 'shift-tab':
        direction = 'left';
        break;
    }
    this.editorActor.send({ type: 'COMMIT', direction, commitKey });
  }

  cancelEdit(): void {
    this.editorActor.send({ type: 'CANCEL' });
  }

  // ===========================================================================
  // Clipboard Operations
  // ===========================================================================

  copy(data: import('../shared/types').ClipboardData): void {
    const ranges = selectionSelectors.ranges(this.selectionActor.getSnapshot());
    this.clipboardActor.send({ type: 'COPY', ranges, data });
  }

  cut(data: import('../shared/types').ClipboardData): void {
    const ranges = selectionSelectors.ranges(this.selectionActor.getSnapshot());
    this.clipboardActor.send({ type: 'CUT', ranges, data });
  }

  paste(): void {
    const activeCell = this.selectionActor.getSnapshot().context.activeCell;
    this.clipboardActor.send({ type: 'PASTE', targetCell: activeCell });
  }

  // ===========================================================================
  // Cell Property Subscriptions
  // ===========================================================================

  subscribeToCellPropertyChanges(
    _sheetId: SheetId,
    _row: number,
    _col: number,
    _onChange: () => void,
  ): () => void {
    // TODO: Wire to cell-property-subscriptions module
    // For now, return a no-op unsubscribe
    return () => {};
  }

  // ===========================================================================
  // Table/Slicer Domain Logic
  // ===========================================================================

  getSlicerCache(_slicerId: string): SlicerCache | null {
    // Slicer cache lookup — delegate to domain module.
    // The actual cache building is done by the slicer-integration module.
    return null;
  }

  rebuildAllSlicerCaches(): void {
    // Notify slicer cache change callbacks
    for (const cb of this.slicerCacheChangeCallbacks) {
      cb();
    }
  }

  // ===========================================================================
  // Feature Configuration (React component wiring)
  // ===========================================================================

  private resizeCoordinator: ResizeCoordinator | null = null;
  private fillCoordinator: FillCoordinator | null = null;
  private commentHoverCoordination: CommentHoverCoordinationResult | null = null;

  private checkboxCoordination:
    | import('./features/checkbox/checkbox-coordination').CheckboxCoordinationResult
    | null = null;

  setCheckboxCoordination(
    config: import('./features/checkbox/checkbox-coordination').CheckboxCoordinationConfig,
  ): void {
    const cleanups = new CleanupManager();
    this.checkboxCoordination = buildCheckboxCoordination(config, cleanups);
    this.cleanupFns.push(() => cleanups.dispose());
  }

  isCheckboxCell(sheetId: SheetId, row: number, col: number): boolean {
    return this.checkboxCoordination?.isCheckboxCell(sheetId, row, col) ?? false;
  }

  toggleCheckbox(
    cell: import('@mog-sdk/contracts/rendering').CellCoord,
    sheetId: SheetId,
  ): boolean {
    return this.checkboxCoordination?.toggleCheckbox(cell, sheetId) ?? false;
  }

  // ===========================================================================
  // Cross-System Integration
  // ===========================================================================

  notifyExternalSelectionActive(): void {
    this.selectionActor.send({
      type: 'EXTERNAL_SELECTION_ACTIVE',
      context: 'objects',
    });
  }

  onSelectionActive(callback: () => void): () => void {
    this.selectionActiveCallbacks.add(callback);
    return () => {
      this.selectionActiveCallbacks.delete(callback);
    };
  }

  onEditStart(callback: () => void): () => void {
    this.editStartCallbacks.add(callback);
    return () => {
      this.editStartCallbacks.delete(callback);
    };
  }

  onEditEnd(callback: () => void): () => void {
    this.editEndCallbacks.add(callback);
    return () => {
      this.editEndCallbacks.delete(callback);
    };
  }

  onStateChange(callback: () => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => {
      this.stateChangeCallbacks.delete(callback);
    };
  }

  onSlicerCacheChange(callback: () => void): () => void {
    this.slicerCacheChangeCallbacks.add(callback);
    return () => {
      this.slicerCacheChangeCallbacks.delete(callback);
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    if (this.started) return;
    if (this.disposed) {
      throw new Error('GridEditingSystem: Cannot restart after dispose. Create a new instance.');
    }

    // 1. Start all actors
    this.selectionActor.start();
    this.editorActor.start();
    this.clipboardActor.start();
    this.findReplaceActor.start();
    this.commentActor.start();
    this.drawBorderActor.start();
    this.slicerActor.start();

    // 1a. In read-only mode, disable fill handle drag via selection machine settings
    if (this.config.readOnly) {
      this.selectionActor.send({ type: 'UPDATE_SETTINGS', allowDragFill: false });
    }

    // 2. Wire tightly-coupled trio coordination (selection <-> editor <-> clipboard)
    this.setupTrioCoordination();

    // 2b. Wire clipboard paste integration (pasting state → executePaste)
    this.setupClipboardPasteIntegration();

    // 3. Wire editor commit coordination (validation → commit → execution)
    this.setupEditorCommitCoordination();

    // 3b. Wire validation-circles auto-clear coordination.
    // Subscribes to `validation:passed` events from the kernel schema-bridge
    // and removes the cell from the validation-circles set so the overlay
    // disappears the moment a previously-invalid cell becomes valid.
    // Ribbon "Circle Invalid Data" populates the set; this keeps it live.
    this.setupValidationCirclesCoordination();

    // 3d. Wire table-selection coordination for Table Design contextual UX.
    // This keeps UIStore.tableDesign.selectedTableId synchronized with both
    // selection movement and table topology changes under the active cell.
    this.setupTableSelectionCoordination();

    // 3e. Wire PivotTable contextual selection coordination.
    this.setupPivotSelectionCoordination();

    // 3f. Wire comment popover coordination. Hover opens from the rendered
    // indicator, and selection movement closes viewing popovers.
    this.setupCommentCoordination();

    // 4. Wire editing input interception
    this.setupEditingInputInterception();

    // 5. Wire actor state change notifications
    this.setupStateChangeNotifications();

    // 6. Wire resize coordinator (applies dimension changes after header resize drag)
    if (this.config.workbook) {
      this.resizeCoordinator = createResizeCoordinator();
      this.resizeCoordinator.setDependencies({
        selectionActor: this.selectionActor,
        workbook: this.config.workbook,
        getActiveSheetId: () =>
          toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))()),
      });
      this.cleanupFns.push(() => {
        this.resizeCoordinator?.dispose();
        this.resizeCoordinator = null;
      });
    }

    // 7. Wire fill coordinator (executes fill on fill handle drag end)
    if (this.config.workbook) {
      this.fillCoordinator = createFillCoordinator();
      this.fillCoordinator.setDependencies({
        selectionActor: this.selectionActor,
        workbook: this.config.workbook,
        getActiveSheetId: () =>
          toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))()),
        readOnly: this.config.readOnly,
      });
      this.cleanupFns.push(() => {
        this.fillCoordinator?.dispose();
        this.fillCoordinator = null;
      });
    }

    // 8. Find-replace coordination is wired externally by SheetCoordinator
    // (not here) to avoid cross-system coupling with RendererActor.
    // See SheetCoordinator.wireCrossSystemEvents() for the wiring.

    // 9. Push layout-predicate callbacks (isRowHidden / isColHidden /
    // getMergedRegionAt) into the selection machine. The machine consumes
    // them via `ctx.getMergedRegionAt` (merge-escape on every navigation
    // path) and `ctx.isRowHidden` / `ctx.isColHidden` (skip-hidden logic in
    // moveCellSkipHidden + Tab/Enter cycle). Previously, only the integration
    // simulator pushed visibility callbacks; production left them
    // undefined, which silently disabled merge-escape and hidden-skip on
    // every keyboard navigation path. This verifies that
    // `actor.getSnapshot.context.getMergedRegionAt` is a function before
    // any input.
    //
    // The push fires here at machine bootstrap and is re-fired on every
    // sheet switch via `refreshLayoutCallbacks()` (called from the sheet
    // switch coordination wiring). Hidden-row/col bitmaps and viewport merge
    // arrays are sheet-scoped, so we close over the active sheet ID at the
    // call site rather than caching them inside the machine context.
    //
    // Fire-and-forget: refreshLayoutCallbacks is async (it pre-fetches the
    // hidden-row/col bitmaps from the workbook). `start()` itself is sync
    // because nothing in its remaining wiring depends on the bitmap fetch
    // having landed — the machine treats `undefined` callbacks as
    // "no hidden rows / no merges" until the SET_LAYOUT_CALLBACKS event
    // arrives. Brief staleness during the round-trip is acceptable; the
    // user can't navigate faster than a microtask resolution.
    void this.refreshLayoutCallbacks().catch((err) => {
      // Surface the failure on the console so it's visible in dev/QA but
      // don't propagate — bitmap fetch failures fall back to "no hidden
      // rows" inside refreshLayoutCallbacks itself, so navigation still
      // works (just without hidden-skip).
      console.error('[GridEditingSystem] refreshLayoutCallbacks failed at start', err);
    });

    // 9b. Subscribe to `merges:changed` to keep the SelectionMachine's
    // sync merge index fresh. The viewport buffer doesn't reflect
    // merge/unmerge mutations (they go through mutatePlain), so the
    // selection machine's `getMergedRegionAt` callback closes over
    // `mergeRegionsBySheet` instead of `ws.viewport.getMerges()`. Each
    // event delivers per-region detail (`kind: 'Set' | 'Removed'`) which
    // we apply incrementally — covers user merges, devtools merges, and
    // remote/CRDT merge events uniformly. Cross-sheet events update the
    // per-sheet bucket without re-firing layout callbacks (which only
    // need to fire when the bucket the callback closes over may have
    // changed — i.e., the active sheet).
    if (this.config.workbook) {
      const workbook = this.config.workbook;
      const getActiveSheetId = () =>
        toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))());
      const unsubMergesChanged = workbook.on('merges:changed', (event) => {
        const sheetId = toSheetId(event.sheetId as SheetId);
        const current = this.mergeRegionsBySheet.get(sheetId) ?? [];
        let next = current;
        if (event.regions && event.regions.length > 0) {
          next = current.slice();
          for (const region of event.regions) {
            // Drop any cached entry that overlaps this region's anchor (the
            // bridge fires a separate Set/Removed per region; we resolve by
            // exact anchor match — a Set with new bounds replaces, a Removed
            // matching the anchor drops).
            const anchorMatchIdx = next.findIndex(
              (r) => r.startRow === region.startRow && r.startCol === region.startCol,
            );
            if (anchorMatchIdx !== -1) next.splice(anchorMatchIdx, 1);
            if (region.kind === 'Set') {
              next.push({
                startRow: region.startRow,
                startCol: region.startCol,
                endRow: region.endRow,
                endCol: region.endCol,
              });
            }
          }
        }
        this.mergeRegionsBySheet.set(sheetId, next);
      });
      this.cleanupFns.push(unsubMergesChanged);

      // Drop the per-sheet entry on sheet deletion to avoid leaking memory
      // across long sessions where sheets are added/removed many times.
      const unsubSheetDeleted = workbook.on('sheet:deleted', (event) => {
        this.mergeRegionsBySheet.delete(toSheetId(event.sheetId as SheetId));
      });
      this.cleanupFns.push(unsubSheetDeleted);
      // Reference getActiveSheetId to avoid an unused-binding lint; the
      // active-sheet read happens inside the layout-callback closure built
      // by refreshLayoutCallbacks().
      void getActiveSheetId;
    }

    this.started = true;
  }

  // ===========================================================================
  // Layout-predicate callback wiring (layout)
  // ===========================================================================

  /**
   * Push the current sheet's layout-predicate callbacks into the selection
   * machine. Called at machine bootstrap and on every sheet switch.
   *
   * Hidden-row / hidden-column predicates close over a snapshot of the
   * sheet's `getHiddenRowsBitmap()` / `getHiddenColumnsBitmap()` taken at
   * call time. The selection machine consumes these as sync predicates
   * (Tab/Enter cycle, moveCellSkipHidden) — the underlying layout API
   * returns `Promise<boolean>` for the per-row form, which silently
   * degrades to `false` if invoked through a sync `typeof === 'boolean'`
   * guard. Pre-fetching the bitmap is the canonical pattern (see
   * `actions/handlers/selection/helpers.ts:createVisibilityChecker`).
   *
   * `getMergedRegionAt` resolves merges from `mergeRegionsBySheet`, an
   * authoritative per-sheet sync index that is initialized from
   * `ws.structure.getMergedRegions()` at refresh time and kept fresh by a
   * `merges:changed` subscription installed in `start()`. The viewport
   * buffer's `getMerges()` is NOT used here because merge/unmerge go
   * through `mutatePlain` and don't push viewport binary patches — see
   * the file head of `merge-anchor-coordination.ts` for the same gotcha.
   *
   * Known limitation: the bitmap snapshot is taken at sheet switch /
   * bootstrap time. Mid-session row-hide / col-hide events do not
   * invalidate the snapshot until the next sheet switch. The dominant
   * source of hidden rows is filters / saved hide state applied at sheet
   * load, which this covers correctly. A future change can wire workbook
   * layout-mutation events to re-fire this method, but the surface for
   * those events isn't established yet — adding it here would be scope
   * creep.
   *
   * If no workbook is configured (headless / no-doc mode), the callbacks
   * stay `undefined` and the machine falls back to its no-callback path.
   *
   * @see ../../actions/handlers/selection/helpers.ts createVisibilityChecker
   * @see ../actor-access/selection-commands.ts setLayoutCallbacks
   * @see ./machines/selection/merge-escape.ts
   * @see ./machines/selection/cycle.ts
   */
  async refreshLayoutCallbacks(): Promise<void> {
    const workbook = this.config.workbook;
    if (!workbook) {
      // Headless mode: no sheet to query. Clear the callbacks so a previously
      // wired (now-stale) value doesn't survive across worksheet replacement.
      this.selectionActor.send({
        type: 'SET_LAYOUT_CALLBACKS',
        isRowHidden: undefined,
        isColHidden: undefined,
        getMergedRegionAt: undefined,
      });
      return;
    }

    // Resolve the active sheet via the same accessor used elsewhere in this
    // class (e.g., `setupTrioCoordination`'s `getCurrentSheetId`).
    const getSheetId = () =>
      toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))());

    // Pre-fetch hidden-row and hidden-column bitmaps so the predicates the
    // selection machine consumes are synchronous Set.has() lookups. The
    // worksheet's per-row `isRowHidden(row)` is `Promise<boolean>` (see
    // `types/api/src/api/worksheet/layout.ts`), so a sync wrapper that
    // ignored the promise would always return `false` — silently disabling
    // hidden-row skipping on every Tab/Enter cycle. Mirrors
    // `createVisibilityChecker` in `actions/handlers/selection/helpers.ts`.
    let hiddenRows: Set<number>;
    let hiddenCols: Set<number>;
    try {
      const ws = workbook.getSheetById(getSheetId());
      [hiddenRows, hiddenCols] = await Promise.all([
        ws.layout.getHiddenRowsBitmap(),
        ws.layout.getHiddenColumnsBitmap(),
      ]);
    } catch {
      // If the bitmap fetch fails (sheet missing during a switch race,
      // bridge transient, etc.), fall back to empty sets so navigation
      // proceeds without skipping. A subsequent refresh will repopulate.
      hiddenRows = new Set<number>();
      hiddenCols = new Set<number>();
    }

    const isRowHidden = (row: number): boolean => hiddenRows.has(row);
    const isColHidden = (col: number): boolean => hiddenCols.has(col);

    // Pre-fetch the authoritative merge list for the active sheet and seed
    // `mergeRegionsBySheet`. The `merges:changed` subscription installed in
    // `start()` keeps the bucket fresh after this point — but the initial
    // population must come from `ws.structure.getMergedRegions()` because
    // the bridge only re-emits per-region detail on mutation, not on read.
    const activeSheetId = getSheetId();
    try {
      const ws = workbook.getSheetById(activeSheetId);
      const regions = await ws.structure.getMergedRegions();
      this.mergeRegionsBySheet.set(
        activeSheetId,
        regions.map((r) => ({
          startRow: r.startRow,
          startCol: r.startCol,
          endRow: r.endRow,
          endCol: r.endCol,
        })),
      );
    } catch {
      // Best-effort: if the fetch fails, leave whatever was already cached
      // from a prior refresh / merges:changed delta. Do NOT clear, since
      // an empty bucket would silently disable merge-escape on every key.
      if (!this.mergeRegionsBySheet.has(activeSheetId)) {
        this.mergeRegionsBySheet.set(activeSheetId, []);
      }
    }

    // getMergedRegionAt closes over the per-sheet entry resolved at call
    // time so sheet switches pick up the right bucket without requiring
    // a re-bind on the SelectionMachine. The bucket itself is mutated in
    // place by the `merges:changed` listener in `start()`.
    const getMergedRegionAt = (row: number, col: number): CellRange | null => {
      const sheetId = getSheetId();
      const merges = this.mergeRegionsBySheet.get(sheetId);
      if (!merges || merges.length === 0) return null;
      const merge = merges.find(
        (m) => row >= m.startRow && row <= m.endRow && col >= m.startCol && col <= m.endCol,
      );
      if (!merge) return null;
      return {
        startRow: merge.startRow,
        startCol: merge.startCol,
        endRow: merge.endRow,
        endCol: merge.endCol,
      };
    };

    if (this.disposed) return;

    this.selectionActor.send({
      type: 'SET_LAYOUT_CALLBACKS',
      isRowHidden,
      isColHidden,
      getMergedRegionAt,
    });
  }

  dispose(): void {
    if (this.disposed) return;

    // Run all cleanup functions in reverse order
    for (let i = this.cleanupFns.length - 1; i >= 0; i--) {
      this.cleanupFns[i]();
    }
    this.cleanupFns.length = 0;

    // Stop all actors in reverse order
    if (this.started) {
      this.slicerActor.stop();
      this.drawBorderActor.stop();
      this.commentActor.stop();
      this.findReplaceActor.stop();
      this.clipboardActor.stop();
      this.editorActor.stop();
      this.selectionActor.stop();
    }

    // Clear all callback sets
    this.selectionActiveCallbacks.clear();
    this.editStartCallbacks.clear();
    this.editEndCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.slicerCacheChangeCallbacks.clear();

    this.editingInputInterception = null;
    this.disposed = true;
  }

  // ===========================================================================
  // Private: Build Actor Access Layer
  // ===========================================================================

  private buildActorAccess(): GridEditingActorAccess {
    return {
      accessors: {
        selection: createSelectionAccessor(this.selectionActor),
        editor: createEditorAccessor(this.editorActor),
        clipboard: createClipboardAccessor(this.clipboardActor),
        findReplace: createFindReplaceAccessor(this.findReplaceActor),
        comment: createCommentAccessor(this.commentActor),
        drawBorder: createDrawBorderAccessor(this.drawBorderActor),
      },
      commands: {
        selection: createSelectionCommands(this.selectionActor),
        editor: createEditorCommands(this.editorActor),
        clipboard: createClipboardCommands(this.clipboardActor),
        findReplace: createFindReplaceCommands(this.findReplaceActor),
        comment: createCommentCommands(this.commentActor),
        drawBorder: createDrawBorderCommands(this.drawBorderActor),
      },
      selectors: {
        selection: selectionSelectors,
        editor: editorSelectors,
        clipboard: clipboardSelectors,
      },
      actors: {
        selection: this.selectionActor,
        editor: this.editorActor,
        clipboard: this.clipboardActor,
        findReplace: this.findReplaceActor,
        comment: this.commentActor,
        drawBorder: this.drawBorderActor,
        slicer: this.slicerActor,
      },
    };
  }

  // ===========================================================================
  // Private: Build DragTerminator
  // ===========================================================================

  /**
   * Build DragTerminator that checks all internal actor states for active drags.
   *
   * Drag operations owned by this system:
   * - Fill handle drag (selection: draggingFillHandle / rightDraggingFillHandle)
   * - Cell drag-drop (selection: draggingCells)
   * - Header resize (selection: resizingHeader)
   * - Table resize (selection: resizingTable)
   * - Column/row header selection drag (selection: selectingColumn / selectingRow)
   * - Draw border drag (drawBorder: active sub-states)
   */
  private buildDragTerminator(): DragTerminator {
    return {
      endDrag: () => {
        const selSnap = this.selectionActor.getSnapshot();

        // Fill handle drag
        if (selSnap.matches('draggingFillHandle')) {
          this.selectionActor.send({ type: 'END_FILL_HANDLE_DRAG' });
          return;
        }
        if (selSnap.matches('rightDraggingFillHandle')) {
          this.selectionActor.send({ type: 'END_FILL_HANDLE_DRAG' });
          return;
        }

        // Cell drag-drop
        if (selSnap.matches('draggingCells')) {
          this.selectionActor.send({ type: 'END_DRAG_CELLS' });
          return;
        }

        // Header resize
        if (selSnap.matches('resizingHeader')) {
          this.selectionActor.send({ type: 'END_RESIZE' });
          return;
        }

        // Table resize
        if (selSnap.matches('resizingTable')) {
          this.selectionActor.send({ type: 'END_TABLE_RESIZE' });
          return;
        }

        // Column/row header selection drag
        if (selSnap.matches('selectingColumn') || selSnap.matches('selectingRow')) {
          this.selectionActor.send({ type: 'MOUSE_UP' });
          return;
        }

        // Basic selection drag (selecting, extending, multiSelecting)
        if (
          selSnap.matches('selecting') ||
          selSnap.matches('extending') ||
          selSnap.matches('multiSelecting')
        ) {
          this.selectionActor.send({ type: 'MOUSE_UP' });
          return;
        }

        // Formula range drag
        // selectingRangeForFormula has nested states - check if in dragging sub-state
        if (selSnap.matches({ selectingRangeForFormula: 'dragging' })) {
          this.selectionActor.send({ type: 'MOUSE_UP' });
          return;
        }

        // Draw border drag
        const dbSnap = this.drawBorderActor.getSnapshot();
        if (
          dbSnap.matches({ drawingBorder: 'active' }) ||
          dbSnap.matches({ drawingBorderGrid: 'active' }) ||
          dbSnap.matches({ erasingBorder: 'active' })
        ) {
          this.drawBorderActor.send({ type: 'MOUSE_UP' });
          return;
        }
      },

      cancelDrag: () => {
        const selSnap = this.selectionActor.getSnapshot();

        // Fill handle - cancel
        if (selSnap.matches('draggingFillHandle') || selSnap.matches('rightDraggingFillHandle')) {
          this.selectionActor.send({ type: 'RESET' });
          return;
        }

        // Cell drag-drop - cancel
        if (selSnap.matches('draggingCells')) {
          this.selectionActor.send({ type: 'CANCEL_DRAG_CELLS' });
          return;
        }

        // Header resize - cancel
        if (selSnap.matches('resizingHeader')) {
          this.selectionActor.send({ type: 'CANCEL_RESIZE' });
          return;
        }

        // Table resize - cancel
        if (selSnap.matches('resizingTable')) {
          this.selectionActor.send({ type: 'CANCEL_TABLE_RESIZE' });
          return;
        }

        // Column/row selection drag - reset
        if (selSnap.matches('selectingColumn') || selSnap.matches('selectingRow')) {
          this.selectionActor.send({ type: 'RESET' });
          return;
        }

        // Basic selection drag - reset
        if (
          selSnap.matches('selecting') ||
          selSnap.matches('extending') ||
          selSnap.matches('multiSelecting')
        ) {
          this.selectionActor.send({ type: 'RESET' });
          return;
        }

        // Formula range drag
        if (selSnap.matches({ selectingRangeForFormula: 'dragging' })) {
          this.selectionActor.send({ type: 'MOUSE_UP' });
          return;
        }

        // Draw border - cancel returns to inactive
        const dbSnap = this.drawBorderActor.getSnapshot();
        if (
          dbSnap.matches({ drawingBorder: 'active' }) ||
          dbSnap.matches({ drawingBorderGrid: 'active' }) ||
          dbSnap.matches({ erasingBorder: 'active' })
        ) {
          this.drawBorderActor.send({ type: 'CANCEL' });
          return;
        }
      },
    };
  }

  // ===========================================================================
  // Private: Build Tool Mode Coordinators
  // ===========================================================================

  /**
   * Build FindReplaceCoordinator.
   * This creates a lightweight wrapper; full wiring happens when deps are available.
   */
  private buildFindReplaceCoordinator(): FindReplaceCoordinator {
    const cleanups: (() => void)[] = [];

    return {
      cleanup: () => {
        for (const fn of cleanups) fn();
        cleanups.length = 0;
      },
    };
  }

  /**
   * Build DrawBorderCoordinator.
   * This creates a lightweight wrapper; full wiring happens when deps are available.
   */
  private buildDrawBorderCoordinator(): DrawBorderCoordinator {
    const cleanups: (() => void)[] = [];

    return {
      cleanup: () => {
        for (const fn of cleanups) fn();
        cleanups.length = 0;
      },
    };
  }

  /**
   * Build CommentHoverCoordinator.
   * This creates a lightweight wrapper; full wiring happens when deps are available.
   */
  private buildCommentHoverCoordinator(): CommentHoverCoordinator {
    return {
      notifyPopoverMouseEnter: () => {
        this.commentHoverCoordination?.notifyPopoverMouseEnter();
      },
      notifyPopoverMouseLeave: () => {
        this.commentHoverCoordination?.notifyPopoverMouseLeave();
      },
      handleIndicatorMouseEnter: (info) => {
        this.commentHoverCoordination?.handleIndicatorMouseEnter({
          sheetId: toSheetId(info.sheetId),
          row: info.row,
          col: info.col,
        });
      },
      handleIndicatorMouseLeave: (info) => {
        this.commentHoverCoordination?.handleIndicatorMouseLeave({
          sheetId: toSheetId(info.sheetId),
          row: info.row,
          col: info.col,
        });
      },
      handleMouseMove: (info) => {
        this.commentHoverCoordination?.handleMouseMove(info);
      },
      handleMouseLeave: () => {
        this.commentHoverCoordination?.handleMouseLeave();
      },
      cleanup: () => {
        this.commentHoverCoordination?.cleanup();
        this.commentHoverCoordination = null;
      },
    };
  }

  // ===========================================================================
  // Private: Trio Coordination (Selection <-> Editor <-> Clipboard)
  // ===========================================================================

  /**
   * Wire the tightly-coupled trio coordination.
   *
   * This is THE critical wiring that makes selection, editor, and clipboard
   * work together. Delegates to setupCrossCoordination which handles:
   * - Editor -> Selection: formula mode, commit-then-move
   * - Selection -> Editor: formula range insertion
   * - State -> Render invalidation (via callback)
   */
  private setupTrioCoordination(): void {
    const workbookForCoord = this.config.workbook;
    const cleanupCrossCoordination = setupCrossCoordination({
      selectionActor: this.selectionActor,
      editorActor: this.editorActor,
      clipboardActor: this.clipboardActor,
      // Renderer actor not available within this system — render invalidation
      // is handled externally by the coordinator via onStateChange callbacks.
      rendererActor: null,
      getVisibilityCallbacks: () => {
        const ctx = this.selectionActor.getSnapshot().context;
        return {
          isRowHidden: ctx.isRowHidden,
          isColHidden: ctx.isColHidden,
        };
      },
      getCurrentSheetId: () =>
        (this.config.getActiveSheetId ?? (() => this.config.initialSheetId))(),
      getSheetName: workbookForCoord
        ? (sid) => workbookForCoord.getSheetById(toSheetId(sid)).name
        : undefined,
    });

    this.cleanupFns.push(cleanupCrossCoordination);
  }

  /**
   * Wire clipboard paste integration.
   *
   * This observes the clipboard machine and executes paste operations when
   * the machine enters 'pasting' state. Without this wiring, the clipboard
   * machine transitions to 'pasting' but nobody actually executes the paste.
   *
   * Requires clipboardDeps.store (PasteStoreOperations) to be provided.
   * If not available, paste integration is skipped (paste will be a no-op).
   */
  private setupClipboardPasteIntegration(): void {
    const workbook = this.config.workbook;
    if (!workbook) return; // No workbook = no paste (headless/no-doc mode)

    const clipboardDeps = this.config.clipboardDeps;
    // Use workbook.activeSheet.sheetId as ground truth: it is a synchronous
    // property that always reflects the current active sheet. The UIStore-based
    // fallbacks (clipboardDeps.getActiveSheetId / config.getActiveSheetId) are
    // updated asynchronously via React state and can be stale at paste time —
    // e.g. when the user copies on Sheet1, switches to Sheet2, then pastes: the
    // UIStore still reports Sheet1, causing the paste to land on the wrong sheet.
    const getActiveSheetId = () =>
      workbook.activeSheet?.sheetId ??
      toSheetId(
        (
          clipboardDeps?.getActiveSheetId ??
          this.config.getActiveSheetId ??
          (() => this.config.initialSheetId)
        )(),
      );

    // Build PasteStoreOperations from the Workbook unified API.
    // Each call resolves the worksheet dynamically so paste works across sheet switches.
    const store: import('../../domain/clipboard').PasteStoreOperations = {
      setCellValues: async (sheetId, updates) => {
        await guardBridgeMutation(async () => {
          await workbook.getSheetById(sheetId).setCells(updates);
        });
      },
      setCellFormat: (sheetId, row, col, format) => {
        void workbook
          .getSheetById(sheetId)
          .formats.set(row, col, format as import('@mog-sdk/contracts/core').CellFormat);
      },
      getCellData: (_sheetId, row, col) => {
        const ws = workbook.getSheetById(_sheetId);
        const cell = ws.viewport.getCellData(row, col);
        if (!cell) return undefined;
        return {
          raw: cell.editText ?? cell.displayText ?? undefined,
          computed: cell.displayText ?? undefined,
        };
      },
      getSheetName: async (sheetId) => (await workbook.getSheetById(sheetId).getName()) ?? sheetId,
      mergeRange: (sheetId, startRow, startCol, endRow, endCol) => {
        void workbook.getSheetById(sheetId).structure.merge(startRow, startCol, endRow, endCol);
        return true;
      },
      unmergeRange: (sheetId, startRow, startCol, endRow, endCol) => {
        void workbook.getSheetById(sheetId).structure.unmerge(startRow, startCol, endRow, endCol);
      },
      getMergesInRange: (_sheetId, range) => {
        const allMerges = workbook.getSheetById(_sheetId).viewport.getMerges();
        return allMerges
          .filter(
            (m) =>
              m.start_row <= range.endRow &&
              m.end_row >= range.startRow &&
              m.start_col <= range.endCol &&
              m.end_col >= range.startCol,
          )
          .map((m) => ({
            startRow: m.start_row,
            startCol: m.start_col,
            endRow: m.end_row,
            endCol: m.end_col,
          }));
      },
      relocateCells: async (sourceSheetId, sourceRange, targetSheetId, targetRow, targetCol) => {
        try {
          const sourceSheet = workbook.getSheetById(sourceSheetId);
          if (sourceSheetId === targetSheetId) {
            await sourceSheet._internal.relocateCells(sourceRange, targetRow, targetCol);
          } else {
            await sourceSheet._internal.relocateCellsToSheet(
              sourceRange,
              targetSheetId,
              targetRow,
              targetCol,
            );
          }

          const movedCount =
            (sourceRange.endRow - sourceRange.startRow + 1) *
            (sourceRange.endCol - sourceRange.startCol + 1);
          return { success: true, movedCount };
        } catch (err) {
          const error = err instanceof Error ? err.message : 'relocateCells failed';
          return { success: false, movedCount: 0, error };
        }
      },
      moveTablesForCutPaste: async (
        sourceSheetId,
        sourceRange,
        targetSheetId,
        targetRow,
        targetCol,
      ) => {
        if (sourceSheetId !== targetSheetId) return;

        const sheet = workbook.getSheetById(sourceSheetId);
        const bridge = (
          sheet as unknown as {
            ctx?: {
              computeBridge?: {
                getAllTablesInSheet(
                  sheetId: SheetId,
                ): Promise<Array<{ name: string; range: CellRange }>>;
                resizeTable(
                  tableName: string,
                  newStartRow: number,
                  newStartCol: number,
                  newEndRow: number,
                  newEndCol: number,
                ): Promise<unknown>;
              };
            };
          }
        ).ctx?.computeBridge;
        if (!bridge) return;

        const tables = await bridge.getAllTablesInSheet(sourceSheetId);
        const tableMoves = tables
          .filter(
            (table) =>
              rangesEqual(table.range, sourceRange) || rangeContainsRange(sourceRange, table.range),
          )
          .map((table) => {
            const rowOffset = table.range.startRow - sourceRange.startRow;
            const colOffset = table.range.startCol - sourceRange.startCol;
            const targetStartRow = targetRow + rowOffset;
            const targetStartCol = targetCol + colOffset;
            return {
              name: table.name,
              sourceRange: table.range,
              targetRange: {
                startRow: targetStartRow,
                startCol: targetStartCol,
                endRow: targetStartRow + (table.range.endRow - table.range.startRow),
                endCol: targetStartCol + (table.range.endCol - table.range.startCol),
              },
            };
          });
        const tableMoveByName = new Map(tableMoves.map((move) => [move.name, move]));

        await Promise.all(
          tables
            .filter((table) => {
              const move = tableMoveByName.get(table.name);
              return Boolean(move && rangesEqual(table.range, move.sourceRange));
            })
            .map((table) => {
              const move = tableMoveByName.get(table.name)!;
              return bridge.resizeTable(
                table.name,
                move.targetRange.startRow,
                move.targetRange.startCol,
                move.targetRange.endRow,
                move.targetRange.endCol,
              );
            }),
        );
      },
      copyRange: async (
        sourceSheetId,
        sourceRange,
        targetSheetId,
        targetRow,
        targetCol,
        copyType,
        skipBlanks,
        transpose,
      ) => {
        await workbook
          .getSheetById(sourceSheetId)
          ._internal.copyRangeToSheet(
            sourceRange,
            targetSheetId,
            targetRow,
            targetCol,
            copyType,
            skipBlanks,
            transpose,
          );
      },
      addComment: async (sheetId, row, col, content, author, options) => {
        const ws = workbook.getSheetById(sheetId);
        const text = content.map((segment) => segment.text ?? '').join('');
        if (!text.trim()) return;

        if (options?.commentType === 'note') {
          await ws.comments.addNote(row, col, { text, author });
          return;
        }

        const comment = await ws.comments.add(row, col, { text, author });
        if (options?.resolved && comment.threadId) {
          await ws.comments.resolveThread(comment.threadId, true);
        }
      },
      setHyperlink: (sheetId, row, col, url) => {
        void workbook.getSheetById(sheetId).hyperlinks.set(row, col, url ?? '');
      },
      setRangeSchema: (sheetId, range, schema, enforcement, ui) => {
        // PasteStoreOperations declares the schema's `type` as `string` for
        // domain neutrality; the kernel internal API typechecks against the
        // gen'd CellSchemaType union. The strings flow through unchanged at
        // runtime — they're round-tripped from the source rule the user just
        // copied, so the cast is type-erased noise rather than an unsafe
        // widening.
        type InternalSchema = Parameters<
          import('@mog-sdk/contracts/api').WorksheetInternal['setRangeSchemaFromClipboard']
        >[1];
        void workbook
          .getSheetById(sheetId)
          ._internal.setRangeSchemaFromClipboard(range, schema as InternalSchema, enforcement, ui);
      },
      createConditionalFormat: async (sheetId, ranges, rules) => {
        const format = await workbook
          .getSheetById(sheetId)
          .conditionalFormats.add(ranges, rules as import('@mog-sdk/contracts/api').CFRuleInput[]);
        return format.id;
      },
    };

    const cleanupPasteIntegration = setupClipboardPasteIntegration({
      clipboardActor: this.clipboardActor,
      store,
      getActiveSheetId,
      getSelectionRange: () => {
        const snap = this.selectionActor.getSnapshot();
        const ranges = selectionSelectors.ranges(snap);
        if (ranges.length === 0) return null;
        return ranges[0];
      },
      updateSelectionAfterPaste: (affectedRange) => {
        this.selectionActor.send({
          type: 'SET_SELECTION',
          ranges: [affectedRange],
          activeCell: { row: affectedRange.startRow, col: affectedRange.startCol },
        });
      },
      getProtectionInfo: async (sheetId, range) => {
        const ws = workbook.getSheetById(sheetId);
        const totalCount =
          (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
        const sheetProtected = await ws.protection.isProtected();
        const protectedCells = new Set<string>();

        if (!sheetProtected) {
          return {
            sheetProtected,
            protectedCount: 0,
            unprotectedCount: totalCount,
            totalCount,
            protectedCells,
          };
        }

        const checks: Promise<void>[] = [];
        for (let row = range.startRow; row <= range.endRow; row++) {
          for (let col = range.startCol; col <= range.endCol; col++) {
            checks.push(
              ws.protection.canEditCell(row, col).then((canEdit) => {
                if (!canEdit) protectedCells.add(`${row},${col}`);
              }),
            );
          }
        }
        await Promise.all(checks);

        return {
          sheetProtected,
          protectedCount: protectedCells.size,
          unprotectedCount: totalCount - protectedCells.size,
          totalCount,
          protectedCells,
        };
      },
      onCutPasteComplete: async (sourceSheetId, sourceRanges) => {
        // Clear source cells after cut-paste.
        // Must await so the setCells mutation lands inside the surrounding
        // undoGroup — fire-and-forget leaked the source-clear out of the
        // group, breaking single-step undo.
        for (const range of sourceRanges) {
          const updates: Array<{ row: number; col: number; value: null }> = [];
          for (let r = range.startRow; r <= range.endRow; r++) {
            for (let c = range.startCol; c <= range.endCol; c++) {
              updates.push({ row: r, col: c, value: null });
            }
          }
          await workbook.getSheetById(sourceSheetId).setCells(updates);
        }
      },
      batch: (fn) => workbook.undoGroup(() => fn()),
      onPasteComplete: clipboardDeps?.onPasteComplete,
      onSizeMismatch: clipboardDeps?.onSizeMismatch,
      onProtectionError: clipboardDeps?.onProtectionError,
      onCutOverwriteConfirm: clipboardDeps?.onCutOverwriteConfirm
        ? (pendingData) =>
            clipboardDeps.onCutOverwriteConfirm!({
              targetCell: pendingData.targetCell,
              sheetId: pendingData.sheetId as string,
            })
        : undefined,
      getHiddenRows: (sheetId) => workbook.getSheetById(sheetId).layout.getHiddenRowsBitmap(),
    });

    this.cleanupFns.push(cleanupPasteIntegration);
  }

  /**
   * Wire editor validation coordination.
   *
   * This observes editor state transitions and handles validation.
   * When the editor enters `validating` state, this coordination:
   * 1. Validates formula syntax (if validateFormulaSyntax provided)
   * 2. Validates cell value against schema (if validateCellValue provided)
   * 3. Sends VALIDATION_SUCCESS or VALIDATION_ERROR
   *
   * The actual cell write is handled by the editor machine's `commitCellValue` invoke.
   *
   * Without this coordination, the editor gets stuck in `validating` state
   * because no one sends VALIDATION_SUCCESS / VALIDATION_ERROR events.
   */
  private setupEditorCommitCoordination(): void {
    const editorDeps = this.config.editorDeps;

    const cleanupCommitCoordination = setupEditorCommitCoordination({
      editorActor: this.editorActor,
      selectionActor: this.selectionActor,
      validateCellValue: editorDeps?.validateCellValue,
      validateCircularReference: editorDeps?.validateCircularReference,
      onValidationError: editorDeps?.onValidationError,
      onValidationWarning: editorDeps?.onValidationWarning,
      onValidationInformation: editorDeps?.onValidationInformation,
      onFormulaError: editorDeps?.onFormulaError,
      onCircularReferenceWarning: editorDeps?.onCircularReferenceWarning,
      validateFormulaSyntax: editorDeps?.validateFormulaSyntax,
    });

    this.cleanupFns.push(cleanupCommitCoordination);
  }

  /**
   * Wire validation-circles auto-clear.
   *
   * The kernel's SchemaValidationBridge emits `validation:passed` whenever a
   * cell transitions from invalid to valid (triggered by Rust's per-mutation
   * re-validation inside `prepare_recalc_for_flush`). This coordination turns
   * that event into a UIStore `removeValidationCircle` call so the red oval
   * disappears the instant the cell becomes valid — without a full re-scan.
   *
   * Paired with the ribbon `TOGGLE_VALIDATION_CIRCLES` handler, which scans
   * once on toggle-on and populates the set.
   */
  private setupValidationCirclesCoordination(): void {
    const workbook = this.config.workbook;
    const uiStoreApi = this.config.uiStoreApi;
    if (!workbook || !uiStoreApi) return;

    const { cleanup } = setupValidationCirclesCoordination({
      workbook,
      uiStore: uiStoreApi,
    });

    this.cleanupFns.push(cleanup);
  }

  private setupTableSelectionCoordination(): void {
    const workbook = this.config.workbook;
    const uiStoreApi = this.config.uiStoreApi;
    if (!workbook || !uiStoreApi) return;

    const cleanups = new CleanupManager();
    setupTableSelectionCoordination(
      {
        actors: { selection: this.selectionActor as any },
        uiStoreApi,
        getActiveSheetId: () =>
          (this.config.getActiveSheetId ?? (() => this.config.initialSheetId))(),
        workbook,
      },
      cleanups,
    );

    this.cleanupFns.push(() => cleanups.dispose());
  }

  private setupPivotSelectionCoordination(): void {
    const workbook = this.config.workbook;
    const uiStoreApi = this.config.uiStoreApi;
    if (!workbook || !uiStoreApi) return;

    const cleanups = new CleanupManager();
    setupPivotSelectionCoordination(
      {
        actors: { selection: this.selectionActor as any },
        uiStoreApi,
        getActiveSheetId: () =>
          (this.config.getActiveSheetId ?? (() => this.config.initialSheetId))(),
        workbook,
      },
      cleanups,
    );

    this.cleanupFns.push(() => cleanups.dispose());
  }

  private setupCommentCoordination(): void {
    const workbook = this.config.workbook;
    if (!workbook) return;

    const getActiveSheetId = (): SheetId =>
      toSheetId((this.config.getActiveSheetId ?? (() => this.config.initialSheetId))());
    const getWorksheet = () => workbook.getSheetById(getActiveSheetId());

    const selectionCoordination = setupCommentSelectionCoordination({
      selectionActor: this.selectionActor,
      commentActor: this.commentActor,
      getWorksheet,
    });
    this.cleanupFns.push(selectionCoordination.cleanup);

    if (!this.config.getHitTest) return;

    this.commentHoverCoordination?.cleanup();
    this.commentHoverCoordination = setupCommentHoverCoordination({
      commentActor: this.commentActor,
      getActiveSheetId,
      getHitTest: this.config.getHitTest,
      getWorksheet,
    });
    this.cleanupFns.push(() => {
      this.commentHoverCoordination?.cleanup();
      this.commentHoverCoordination = null;
    });
  }

  /**
   * Wire editing input interception.
   *
   * This is THE critical coordination that prevents editor-selection divergence.
   * When the user clicks another cell while editing, we:
   * 1. Intercept the click
   * 2. Commit the current edit
   * 3. Move selection to the clicked cell AFTER commit completes
   */
  private setupEditingInputInterception(): void {
    const workbookForIntercept = this.config.workbook;
    this.editingInputInterception = setupEditingInputInterception({
      editorActor: this.editorActor,
      selectionActor: this.selectionActor,
      getCurrentSheetId: () =>
        (this.config.getActiveSheetId ?? (() => this.config.initialSheetId))(),
      getSheetName: workbookForIntercept
        ? (sid) => workbookForIntercept.getSheetById(toSheetId(sid)).name
        : undefined,
      onCommitAndMove: (targetCell: CellCoord, shiftKey?: boolean, _ctrlKey?: boolean) => {
        // After commit completes, move selection to the target cell
        if (shiftKey) {
          // Shift+click: extend selection
          const anchor = this.selectionActor.getSnapshot().context.anchor;
          const anchorCell = anchor ?? this.selectionActor.getSnapshot().context.activeCell;
          this.selectionActor.send({
            type: 'SET_SELECTION',
            ranges: [
              {
                startRow: Math.min(anchorCell.row, targetCell.row),
                startCol: Math.min(anchorCell.col, targetCell.col),
                endRow: Math.max(anchorCell.row, targetCell.row),
                endCol: Math.max(anchorCell.col, targetCell.col),
              },
            ],
            activeCell: targetCell,
            anchor: anchorCell,
          });
        } else {
          // Normal click: set selection to single cell
          this.selectionActor.send({
            type: 'SET_SELECTION',
            ranges: [
              {
                startRow: targetCell.row,
                startCol: targetCell.col,
                endRow: targetCell.row,
                endCol: targetCell.col,
              },
            ],
            activeCell: targetCell,
          });
        }
      },
    });

    this.cleanupFns.push(() => {
      this.editingInputInterception?.cleanup();
      this.editingInputInterception = null;
    });
  }

  // ===========================================================================
  // Private: State Change Notifications
  // ===========================================================================

  /**
   * Wire subscriptions that fire the public callback hooks:
   * - onSelectionActive: when selection transitions to an active state
   * - onEditStart: when editor transitions to editing
   * - onEditEnd: when editor transitions to inactive
   * - onStateChange: any change in selection, editor, or clipboard
   */
  private setupStateChangeNotifications(): void {
    // Track previous states for transition detection
    let prevSelectionActive = false;
    let prevEditorEditing = false;

    // Selection state change subscription
    const selSub = this.selectionActor.subscribe((state: SelectionState) => {
      // Notify generic state change
      for (const cb of this.stateChangeCallbacks) cb();

      // Detect transition TO active selection
      const isActive =
        state.matches('selecting') ||
        state.matches('extending') ||
        state.matches('multiSelecting') ||
        state.matches('selectingColumn') ||
        state.matches('selectingRow');

      if (isActive && !prevSelectionActive) {
        for (const cb of this.selectionActiveCallbacks) cb();
      }
      prevSelectionActive = isActive;
    });
    this.cleanupFns.push(() => selSub.unsubscribe());

    // Editor state change subscription
    const editorSub = this.editorActor.subscribe((state) => {
      // Notify generic state change
      for (const cb of this.stateChangeCallbacks) cb();

      const isEditing = !state.matches('inactive');

      // Detect transition TO editing
      if (isEditing && !prevEditorEditing) {
        for (const cb of this.editStartCallbacks) cb();
      }

      // Detect transition FROM editing to inactive
      if (!isEditing && prevEditorEditing) {
        for (const cb of this.editEndCallbacks) cb();
      }

      prevEditorEditing = isEditing;
    });
    this.cleanupFns.push(() => editorSub.unsubscribe());

    // Clipboard state change subscription
    const clipSub = this.clipboardActor.subscribe(() => {
      for (const cb of this.stateChangeCallbacks) cb();
    });
    this.cleanupFns.push(() => clipSub.unsubscribe());
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a GridEditingSystem instance.
 *
 * @param config - Configuration for the system
 * @returns A fully-constructed (but not yet started) GridEditingSystem
 */
export function createGridEditingSystem(config: GridEditingConfig): GridEditingSystem {
  return new GridEditingSystem(config);
}
