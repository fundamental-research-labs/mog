/**
 * Grid Editing System Types
 *
 * of Stream 1: Spreadsheet Subsystem Architecture
 *
 * The GridEditingSystem owns the grid's editing model:
 * - Cell selection (selection machine)
 * - Editing lifecycle (editor machine)
 * - Clipboard operations (clipboard machine)
 * - Selection-triggered tools (find-replace, draw-border, comment-hover)
 * - Cell-operating tool modes (table resize, slicer cache management)
 *
 * @module apps/spreadsheet/src/systems/grid-editing
 */

import type { StoreApi } from 'zustand';

import type {
  ClipboardAccessor,
  ClipboardCommands,
  CommentAccessor,
  CommentCommands,
  DrawBorderAccessor,
  DrawBorderCommands,
  EditorAccessor,
  EditorCommands,
  FindReplaceAccessor,
  FindReplaceCommands,
  SelectionAccessor,
  SelectionCommands,
  SelectionState,
} from '@mog-sdk/contracts/actors';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { FlashFillPreviewValue } from '@mog-sdk/contracts/fill';
import type {
  ClipboardSnapshot,
  Direction,
  EditorSnapshot,
  SelectionSnapshot,
} from '@mog-sdk/contracts/machines';
import type { MutationResult } from '@mog-sdk/contracts/protection';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { SlicerCache } from '@mog-sdk/contracts/slicers';
import type { DragTerminator } from '../shared/drag-terminator';
import type { Metric, ReadableStoreApi } from '../shared/types';
import type { BeginEditSessionRequest } from './edit-entry-service';

// =============================================================================
// NARROW UI STORE INTERFACE (DAG: systems/ must not import ui-store/)
// =============================================================================

/**
 * Narrow interface describing ONLY the UIStore properties needed by the GridEditing system.
 * Replaces direct import of UIState to satisfy DAG constraints.
 *
 * Each property/method is used by one or more coordination modules within this system.
 */
export interface GridEditingUIStore {
  // --- Active sheet ---
  /** Currently active sheet ID */
  activeSheetId: SheetId;

  // --- Range selection mode (range-selection-coordination) ---
  /** Range selection mode state */
  rangeSelectionMode: { active: boolean };
  /** Update the range selection string (A1 notation) */
  updateRangeSelection: (range: string) => void;

  // --- Table auto-expansion (table-auto-expansion, calculated-column) ---
  /** Show table expansion auto-correct options button */
  showTableExpansionAutoCorrect?: (info: {
    tableId: string;
    tableName: string;
    direction: 'bottom' | 'right';
    sheetId: string;
    triggerCell: { row: number; col: number };
  }) => void;
  /** Show calculated column auto-correct options button */
  showCalculatedColumnAutoCorrect?: (info: {
    tableId: string;
    tableName: string;
    columnIndex: number;
    columnName: string;
    formula: string;
    cellsFilled: number;
    sheetId: string;
    hasMixedContent: boolean;
    sourceRow: number;
    sourceCol: number;
  }) => void;
  /** Hide table auto-correct options */
  hideTableAutoCorrectOptions?: () => void;

  // --- Toolbar format coordination ---
  /** Set the active cell format for toolbar display */
  setActiveCellFormat: (format: import('@mog-sdk/contracts/core').CellFormat | null) => void;
  /** Set toolbar selection ranges */
  setToolbarRanges: (ranges: import('@mog-sdk/contracts/core').CellRange[]) => void;

  // --- Table selection coordination ---
  /** Table design state */
  tableDesign: { selectedTableId: string | null };
  /** Set the currently selected table */
  setSelectedTable: (tableId: string | null) => void;

  // --- Pivot selection coordination ---
  /** Pivot field-panel state */
  pivot: { selectedPivotId: string | null; editingPivotId: string | null };
  /** Set the currently selected pivot */
  selectPivot: (pivotId: string | null) => void;
  /** Open pivot field editing */
  startEditingPivot: (pivotId: string) => void;
  /** Close pivot field editing */
  stopEditingPivot: () => void;

  // --- Validation circles coordination ---
  /** Remove a validation circle for a cell */
  removeValidationCircle: (sheetId: string, row: number, col: number) => void;
  /** Check if a cell currently has a validation circle displayed */
  hasValidationCircle: (sheetId: string, row: number, col: number) => boolean;

  // --- Flash fill coordination ---
  /** Flash fill preview state */
  flashFillPreview: {
    isShowingPreview: boolean;
    targetColumn: number | null;
    previewValues: FlashFillPreviewValue[];
  };
  /** Show flash fill preview */
  showFlashFillPreview: (info: {
    sheetId: SheetId;
    sourceColumn: number;
    targetColumn: number;
    previewValues: FlashFillPreviewValue[];
    patternDescription: string;
    confidence: number;
    startRow: number;
    endRow: number;
  }) => void;
  /** Hide flash fill preview */
  hideFlashFillPreview: () => void;

  // --- Fill coordination ---
  /** Open fill merge conflict dialog */
  openFillMergeConflictDialog?: () => void;
  /** Show large fill confirmation dialog */
  showLargeFillConfirmation?: (info: {
    sourceRange: CellRange;
    targetRange: CellRange;
    direction: import('@mog-sdk/contracts/fill').FillDirection;
    options: import('@mog-sdk/contracts/fill').FillOptions;
    cellCount: number;
    estimatedDuration: number;
  }) => void;
  /** Show autofill options button */
  showAutofillOptionsButton: (info: {
    sourceRange: CellRange;
    targetRange: CellRange;
    sheetId: SheetId;
    originalOptions: import('@mog-sdk/contracts/fill').FillOptions;
  }) => void;
  /** Show fill context menu */
  showFillContextMenu: (info: {
    position: { x: number; y: number };
    sourceRange: CellRange;
    targetCorners: {
      topLeft: import('@mog-sdk/contracts/cell-identity').CellId;
      bottomRight: import('@mog-sdk/contracts/cell-identity').CellId;
    };
    direction: import('@mog-sdk/contracts/fill').FillDirection;
    hasDateValues: boolean;
  }) => void;
}

/** Store API type for GridEditingUIStore */
export type GridEditingUIStoreApi = StoreApi<GridEditingUIStore>;

// Actor types (for useSelector hook subscriptions)
import type { ClipboardActor } from './machines/clipboard-machine';
import type { CommentActor } from './machines/comment-machine';
import type { DrawBorderActor } from './machines/draw-border-machine';
import type { FindReplaceActor } from './machines/find-replace-machine';
import type { EditorActor } from './machines/grid-editor-machine';
import type { SelectionActor } from './machines/grid-selection-machine';
import type { SlicerActor } from './machines/slicer-machine';

// Re-export selectors for external use
import { clipboardSelectors, editorSelectors, selectionSelectors } from '../../selectors';

// =============================================================================
// ACTOR ACCESS LAYER
// =============================================================================

/**
 * Complete actor-access layer exposed by GridEditingSystem.
 *
 * This is the opaque boundary that other systems interact with.
 * All actor state reads/writes go through this interface.
 */
export interface GridEditingActorAccess {
  /** Accessor interfaces (point-in-time reads) */
  accessors: {
    selection: SelectionAccessor;
    editor: EditorAccessor;
    clipboard: ClipboardAccessor;
    findReplace?: FindReplaceAccessor;
    comment?: CommentAccessor;
    drawBorder?: DrawBorderAccessor;
  };

  /** Command interfaces (event sending) */
  commands: {
    selection: SelectionCommands;
    editor: EditorCommands;
    clipboard: ClipboardCommands;
    findReplace?: FindReplaceCommands;
    comment?: CommentCommands;
    drawBorder?: DrawBorderCommands;
  };

  /** Selector functions (for use with useSelector hooks) */
  selectors: {
    selection: typeof selectionSelectors;
    editor: typeof editorSelectors;
    clipboard: typeof clipboardSelectors;
  };

  /**
   * Actor refs for useSelector hook subscriptions.
   * Use accessors/commands for programmatic reads/writes.
   * These are exposed solely for React hooks that need reactive subscriptions.
   */
  actors: {
    selection: SelectionActor;
    editor: EditorActor;
    clipboard: ClipboardActor;
    findReplace: FindReplaceActor;
    comment: CommentActor;
    drawBorder: DrawBorderActor;
    slicer: SlicerActor;
  };
}

// =============================================================================
// FEATURE CONFIGURATION INTERFACES
// =============================================================================

/**
 * Narrow interface for most internal features.
 *
 * Provides only what features need to coordinate with selection/navigation
 * without exposing full actor access or deep system internals.
 */
export interface GridFeatureConfig {
  /** Get the currently active cell (null if none) */
  getActiveCell(): CellCoord | null;

  /** Get all currently selected ranges */
  getSelectedRanges(): CellRange[];

  /** Navigate to a specific cell (updates selection and scrolls into view) */
  navigateToCell(cell: CellCoord): void;

  /**
   * Subscribe to active cell changes (debounced, fires only when idle).
   * Used by features that need to react to cell navigation without flooding.
   */
  onIdleActiveCellChange(callback: (cell: CellCoord | null) => void): () => void;

  /** Workbook for unified API access */
  workbook: WorkbookInternal;

  /** UI store API for reading/writing UI state */
  uiStoreApi: StoreApi<GridEditingUIStore>;

  /** Optional metrics callback for observability */
  onMetric?: (metric: Metric) => void;
}

/**
 * Extended configuration for deeply-coupled features.
 *
 * Features that need direct actor access (e.g., drag-drop coordination)
 * receive SelectionActor directly. This is the exception, not the rule.
 */
export interface DragFeatureConfig extends GridFeatureConfig {
  /**
   * Selection actor for deep coupling.
   * Only provided to features that absolutely need direct actor access.
   */
  selectionActor: { getSnapshot(): SelectionState; send(event: unknown): void };
}

// =============================================================================
// CONSTRUCTOR CONFIGURATION
// =============================================================================

/**
 * Configuration for creating a GridEditingSystem.
 *
 * Passed to constructor. All dependencies needed for full initialization.
 */
export interface GridEditingConfig {
  /** Initial sheet ID to display */
  initialSheetId: string;

  /**
   * Live getter for the currently active sheet ID.
   * Reads from UIStore.activeSheetId when provided.
   * Falls back to initialSheetId for tests/minimal usage.
   */
  getActiveSheetId?: () => string;

  /**
   * Get the direction to move after Enter key commit.
   * Reads from workbook settings via ComputeBridge in the real app.
   * Falls back to 'down' if not provided.
   * May be async (ComputeBridge reads) or sync (tests/defaults).
   */
  getEnterKeyDirection?: () => Direction | Promise<Direction>;

  /** Dependencies for editor operations (commit, validation, schema lookup) */
  editorDeps?: EditorDependencies;

  /** Dependencies for clipboard paste operations */
  clipboardDeps?: ClipboardDependencies;

  /**
   * Workbook for unified API access.
   * Used by coordinators that need access to spreadsheet data (resize, merged cells, etc.)
   */
  workbook?: WorkbookInternal;

  /**
   * UI store API for reading UI state.
   * Uses ReadableStoreApi (covariant) so StoreApi<UIState> can be passed
   * when UIState is a superset of GridEditingUIStore.
   */
  uiStoreApi?: ReadableStoreApi<GridEditingUIStore>;

  /**
   * Get the geometry capability (for grid-to-screen conversions).
   * Used by features that need to convert cell coordinates to pixel positions.
   */
  getGeometry?: () => import('@mog-sdk/sheet-view').ISheetViewGeometry | null;

  /**
   * Get the viewport capability (for scroll position and viewport bounds).
   * Used by scroll coordination features.
   */
  getViewport?: () => import('@mog-sdk/sheet-view').ISheetViewViewport | null;

  /**
   * Get the hit-test capability (for comment indicator hover detection).
   * Used by comment hover coordination to detect comment indicator triangles.
   */
  getHitTest?: () => import('@mog-sdk/sheet-view').ISheetViewHitTest | null;

  /** Callback for metrics/observability */
  onMetric?: (metric: Metric) => void;

  /** Callback when row/column dimensions change (e.g. resize). Triggers render invalidation. */
  onDimensionsChanged?: (sheetId: SheetId) => void;

  /** When true, blocks fill, resize, and other mutating operations (read-only mode). */
  readOnly?: boolean;
}

// =============================================================================
// SUB-COORDINATOR TYPES (Tool Modes)
// =============================================================================

/**
 * Find & Replace Coordinator.
 * Manages find/replace search execution, navigation, and replace operations.
 * Wired to the FindReplaceCoordinator class from find-replace-coordination.ts.
 */
export interface FindReplaceCoordinator {
  /** Cleanup function */
  cleanup(): void;
}

/**
 * Draw Border Coordinator.
 * Manages draw-border mode (draw border, draw border grid, erase border).
 *
 * TODO: Define full interface during implementation.
 * For now, placeholder type based on existing coordinator pattern.
 */
export interface DrawBorderCoordinator {
  /** Cleanup function */
  cleanup(): void;
}

/**
 * Comment Hover Coordinator.
 * Manages comment popover interactions (viewing, editing, composing, deleting).
 *
 * TODO: Define full interface during implementation.
 * For now, placeholder type based on existing coordinator pattern.
 */
export interface CommentHoverCoordinator {
  /** Cleanup function */
  cleanup(): void;
  /** Notify that mouse entered the comment popover (cancel hide timer) */
  notifyPopoverMouseEnter?(): void;
  /** Notify that mouse left the comment popover (start hide timer) */
  notifyPopoverMouseLeave?(): void;
  /** Notify that mouse entered a DOM comment-indicator overlay. */
  handleIndicatorMouseEnter?(info: { sheetId: string; row: number; col: number }): void;
  /** Notify that mouse left a DOM comment-indicator overlay. */
  handleIndicatorMouseLeave?(info: { sheetId: string; row: number; col: number }): void;
  /** Handle mouse move events from the grid - for comment indicator detection */
  handleMouseMove?(info: { x: number; y: number }): void;
  /** Handle mouse leave events from the grid container */
  handleMouseLeave?(): void;
}

// =============================================================================
// PUBLIC SYSTEM INTERFACE
// =============================================================================

/**
 * GridEditingSystem - Public API
 *
 * The grid editing system owns the grid's editing model and exposes a clean API
 * for other systems to interact with selection, editing, and clipboard operations.
 *
 * PHILOSOPHY: No slow migrations. Build the RIGHT solution.
 * Copy existing types — don't reinvent.
 */
export interface IGridEditingSystem {
  // ===========================================================================
  // Snapshots (on-demand reads)
  // ===========================================================================

  /**
   * Get current selection snapshot.
   * Returns derived state optimized for rendering (hasFullRowSelection, selectedRows, etc.)
   */
  getSelectionSnapshot(): SelectionSnapshot;

  /**
   * Get current editor snapshot.
   * Returns editing state (isEditing, editingCell, value, etc.)
   */
  getEditorSnapshot(): EditorSnapshot;

  /**
   * Get current clipboard snapshot.
   * Returns clipboard state (hasCopy, hasCut, cutSource, etc.)
   */
  getClipboardSnapshot(): ClipboardSnapshot;

  // ===========================================================================
  // Editing Lifecycle
  // ===========================================================================

  /**
   * Start editing a cell.
   * @param cell - Cell to edit
   * @param sheetId - Sheet containing the cell
   * @param initialValue - Optional initial value (for typing entry mode)
   */
  startEditing(cell: CellCoord, sheetId: string, initialValue?: string): void;

  beginEditSession(request: BeginEditSessionRequest): Promise<MutationResult>;

  invalidateEditSessions(reason: string): void;

  /**
   * Handle cell click (updates selection, may start editing on double-click).
   * @param cell - Clicked cell
   * @param shiftKey - Whether shift key is held (extend selection)
   * @param ctrlKey - Whether ctrl/cmd key is held (multi-select)
   * @returns true if handled, false otherwise
   */
  handleCellClick(cell: CellCoord, shiftKey?: boolean, ctrlKey?: boolean): boolean;

  /**
   * Start a cell drag operation from a selection border.
   * @param cell - The cell where the drag started
   * @param ctrlKey - Whether ctrl/cmd key is held (copy mode)
   */
  handleStartDragCells(cell: CellCoord, ctrlKey: boolean): void;

  /**
   * Update a cell drag operation as the mouse moves.
   * @param cell - The cell currently under the cursor
   * @param isCopyMode - Whether in copy mode (ctrl/cmd held)
   */
  handleDragCellsMove(cell: CellCoord, isCopyMode: boolean): void;

  /**
   * Commit the current edit.
   * @param direction - Direction to move after commit (or 'none' to stay in place)
   */
  commitEdit(direction?: Direction | 'none'): void;

  /**
   * Commit the current edit using a commit key.
   * Resolves the key to a direction using workbook settings (enter key direction).
   * Async because enter key direction is read from ComputeBridge.
   * Callers treat this as fire-and-forget.
   * @param commitKey - The key used to commit
   */
  commitWithKey(commitKey: 'enter' | 'shift-enter' | 'tab' | 'shift-tab'): void | Promise<void>;

  /**
   * Cancel the current edit.
   */
  cancelEdit(): void;

  // ===========================================================================
  // Clipboard Operations
  // ===========================================================================

  /**
   * Copy cells to clipboard.
   * @param data - Clipboard data to copy
   */
  copy(data: import('@mog-sdk/contracts/actors').ClipboardData): void;

  /**
   * Cut cells to clipboard.
   * @param data - Clipboard data to cut
   */
  cut(data: import('@mog-sdk/contracts/actors').ClipboardData): void;

  /**
   * Paste clipboard contents to active cell.
   */
  paste(): void;

  // ===========================================================================
  // Tool Modes (sub-coordinators)
  // ===========================================================================

  /** Find & Replace coordinator (search, replace, navigate matches) */
  readonly findReplace: FindReplaceCoordinator;

  /** Draw Border coordinator (draw border, draw border grid, erase border) */
  readonly drawBorder: DrawBorderCoordinator;

  /** Comment Hover coordinator (comment popover interactions) */
  readonly commentHover: CommentHoverCoordinator;

  // ===========================================================================
  // Feature Configuration (React component wiring)
  // ===========================================================================

  /**
   * Set checkbox coordination config.
   * Called from useEditorIntegration hook to wire checkbox cell toggling.
   */
  setCheckboxCoordination(
    config: import('./features/checkbox/checkbox-coordination').CheckboxCoordinationConfig,
  ): void;

  /**
   * Check if a cell is a checkbox cell.
   * Returns false if checkbox coordination not yet configured.
   */
  isCheckboxCell(sheetId: string, row: number, col: number): boolean;

  /**
   * Toggle a checkbox cell value.
   * Returns true if toggled, false if not a checkbox or not configured.
   */
  toggleCheckbox(cell: CellCoord, sheetId: string): boolean;

  // ===========================================================================
  // Table/Slicer Domain Logic
  // ===========================================================================

  /**
   * Get slicer cache for a slicer.
   * Returns null if slicer does not exist.
   * @param slicerId - Slicer ID
   */
  getSlicerCache(slicerId: string): SlicerCache | null;

  /**
   * Rebuild all slicer caches.
   * Called when data changes that could affect slicer items.
   */
  rebuildAllSlicerCaches(): void;

  // ===========================================================================
  // Actor Access Layer (complete, opaque)
  // ===========================================================================

  /**
   * Complete actor-access layer.
   * Other systems use this to read actor state and send commands.
   */
  readonly access: GridEditingActorAccess;

  // ===========================================================================
  // Cross-System Integration
  // ===========================================================================

  /**
   * Drag terminator for pointer-up dispatch.
   * Coordinator calls endDrag() on pointer-up to complete any active drag operations.
   */
  readonly dragTerminator: DragTerminator;

  /**
   * Notify that an external selection context is active (objects, chart, etc.).
   * GridEditingSystem may deactivate its own selection UI in response.
   */
  notifyExternalSelectionActive(): void;

  /**
   * Push the active sheet's layout-predicate callbacks (isRowHidden /
   * isColHidden / getMergedRegionAt) into the selection machine via
   * SET_LAYOUT_CALLBACKS.
   *
   * Called once at machine bootstrap and on every sheet switch so the
   * machine's merge-escape / hidden-skip navigation paths track the
   * currently active sheet. Previously, only the integration simulator
   * pushed visibility callbacks; production left them undefined, which
   * silently disabled merge-escape on every keyboard navigation.
   *
   * Async because hidden-row / hidden-column bitmaps are fetched from the
   * workbook via Promise-returning APIs (`getHiddenRowsBitmap` /
   * `getHiddenColumnsBitmap`). Callers that don't need to coordinate with
   * the fetch landing (e.g. sheet switch) may fire-and-forget with `void`.
   *
   */
  refreshLayoutCallbacks(): Promise<void>;

  /**
   * Subscribe to selection becoming active.
   * Called when selection transitions from inactive to active.
   * @param callback - Called when selection becomes active
   * @returns Unsubscribe function
   */
  onSelectionActive(callback: () => void): () => void;

  /**
   * Subscribe to edit start.
   * Called when editor transitions to editing state.
   * @param callback - Called when editing starts
   * @returns Unsubscribe function
   */
  onEditStart(callback: () => void): () => void;

  /**
   * Subscribe to edit end.
   * Called when editor transitions out of editing state.
   * @param callback - Called when editing ends
   * @returns Unsubscribe function
   */
  onEditEnd(callback: () => void): () => void;

  /**
   * Subscribe to any state change.
   * Called when selection, editor, or clipboard state changes.
   * @param callback - Called on state change
   * @returns Unsubscribe function
   */
  onStateChange(callback: () => void): () => void;

  /**
   * Subscribe to cell property changes for a specific cell.
   * Called when the cell's value, format, or other properties change.
   * @param sheetId - Sheet containing the cell
   * @param row - Cell row
   * @param col - Cell column
   * @param onChange - Called when properties change
   * @returns Unsubscribe function
   */
  subscribeToCellPropertyChanges(
    sheetId: string,
    row: number,
    col: number,
    onChange: () => void,
  ): () => void;

  /**
   * Subscribe to slicer cache changes.
   * Called when any slicer cache is invalidated or rebuilt.
   * @param callback - Called on cache change
   * @returns Unsubscribe function
   */
  onSlicerCacheChange(callback: () => void): () => void;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the system.
   * Initializes actors, wires subscriptions, starts coordination.
   */
  start(): void;

  /**
   * Dispose the system.
   * Cleans up actors, subscriptions, sub-coordinators.
   */
  dispose(): void;
}

// =============================================================================
// DEPENDENCY INTERFACES (moved from coordinator/types.ts)
// =============================================================================

/**
 * Dependencies for clipboard paste operations.
 * Passed via SheetCoordinatorConfig.clipboardDependencies at construction time.
 *
 * Needed by clipboard to:
 * - Access store context for cell/format operations
 * - Get active sheet ID for paste target
 * - Show UI dialogs (size mismatch, protection errors)
 * - Notify when paste completes
 */
export interface ClipboardDependencies {
  /** Get the currently active sheet ID */
  getActiveSheetId: () => string;
  /**
   * Callback when paste operation completes (for render invalidation).
   * Enhanced with cellCount for accessibility announcements.
   */
  onPasteComplete?: (
    affectedRange: import('@mog-sdk/contracts/core').CellRange,
    cellCount?: number,
  ) => void;
  /** Callback to show size mismatch dialog */
  onSizeMismatch?: (
    sourceSize: { rows: number; cols: number },
    targetSize: { rows: number; cols: number },
    pendingData: {
      targetCell: { row: number; col: number };
      sheetId: string;
      targetRange: import('@mog-sdk/contracts/core').CellRange;
    },
  ) => void;
  /** Callback to show protection error dialog */
  onProtectionError?: (message: string) => void;
  /**
   * Callback to show the cut-paste overwrite confirmation dialog.
   *
   * Invoked when a CUT-paste's destination contains existing non-empty cells,
   * so the user can confirm/cancel the overwrite before any writes happen.
   * The host stores `pendingData` so the Confirm path can re-trigger the
   * paste with `skipOverwriteCheck=true`.
   */
  onCutOverwriteConfirm?: (pendingData: {
    targetCell: { row: number; col: number };
    sheetId: string;
  }) => void;
}

/**
 * Dependencies for editor (editing) operations.
 * Passed via SheetCoordinatorConfig.editorDependencies at construction time.
 *
 * Needed by editor to:
 * - Write cell values to store
 * - Validate cell values against schemas
 * - Show validation/formula error dialogs
 * - Look up cell schemas for editor type resolution
 * - Set cell metadata (array formulas)
 */
export interface EditorDependencies {
  // Editor config (commit coordination)
  /** Write a cell value to the store */
  setCellValue: (sheetId: SheetId, row: number, col: number, value: string) => void | Promise<void>;
  /** Write a date picker calendar date through the typed date API. */
  setDateValue?: (
    sheetId: SheetId,
    row: number,
    col: number,
    isoDate: string,
    kind: 'date' | 'datetime',
  ) => void | Promise<void>;
  /** Set pending undo description for next action */
  setPendingUndoDescription?: (description: string) => void;
  /** Validate cell value against schema */
  validateCellValue?: (
    sheetId: SheetId,
    row: number,
    col: number,
    value: string,
  ) => Promise<import('./coordination/editor-commit-coordination').EditorValidationResult | null>;
  /** Validate direct circular references before the formula reaches the mutation path. */
  validateCircularReference?: (
    sheetId: SheetId,
    row: number,
    col: number,
    formula: string,
  ) => Promise<
    import('./coordination/editor-commit-coordination').CircularReferenceValidationResult | null
  >;
  /**
   * Show validation error dialog for strict enforcement.
   * Called when a value fails validation with enforcement='strict'.
   * Excel shows "Retry" and "Cancel" buttons.
   */
  onValidationError?: (
    message: string,
    title: string,
    onRetry: () => void,
    onCancel: () => void,
  ) => void;
  /**
   * Show validation warning dialog.
   * Added onRetry callback for "No" button (return to edit mode).
   */
  onValidationWarning?: (
    message: string,
    title: string,
    onProceed: () => void,
    onCancel: () => void,
    onRetry: () => void,
  ) => void;
  /**
   * Show validation information dialog (errorStyle='information').
   * Two-button dialog (OK / Cancel):
   * - OK: commit the value
   * - Cancel: discard the edit
   */
  onValidationInformation?: (
    message: string,
    title: string,
    onProceed: () => void,
    onCancel: () => void,
  ) => void;
  /**
   * Show formula syntax error dialog.
   * G.2: Now includes optional errorPosition for cursor positioning.
   */
  onFormulaError?: (
    formula: string,
    errorMessage: string,
    onEdit: () => void,
    onAcceptAsText: () => void,
    /** G.2: Optional error position for cursor placement (0-based character index) */
    errorPosition?: number,
  ) => void;
  /**
   * Show direct circular-reference warning dialog. Enable proceeds after the
   * host enables iterative calculation; cancel discards the edit.
   */
  onCircularReferenceWarning?: (
    cellAddress: string,
    formula: string,
    onEnableIterative: () => void,
    onCancel: () => void,
  ) => void;
  /**
   * Validate formula syntax.
   * G.2: Can return an object with errorPosition for cursor placement.
   * @returns null if valid, string for legacy error, or object with errorMessage and optional errorPosition
   */
  validateFormulaSyntax?: (
    sheetId: SheetId,
    formula: string,
    row: number,
    col: number,
  ) =>
    | string
    | { errorMessage: string; errorPosition?: number }
    | null
    | Promise<string | { errorMessage: string; errorPosition?: number } | null>;
  /** Set cell metadata (e.g., isArrayFormula flag) */
  setCellMetadata?: (
    sheetId: string,
    row: number,
    col: number,
    metadata: { isArrayFormula?: boolean },
  ) => void;
  /**
   * Set a CSE (`Ctrl+Shift+Enter`) array formula on a rectangular
   * range. Routes to Rust `compute-core::set_array_formula` which
   * marks the anchor in `mirror.cse_anchors` and registers the
   * projection extent — the formula bar then renders `{=…}` braces
   * via `metadata.region.kind === 'cseArray'` (D5), and partial
   * writes are rejected by Rust as `ComputeError::PartialArrayWrite`.
   */
  setArrayFormula?: (
    sheetId: SheetId,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
    formulaValue: string,
  ) => void | Promise<void>;
  /** Atomic write of value + format (forced text mode) */
  setCellValueWithFormat?: (
    sheetId: string,
    row: number,
    col: number,
    value: string,
    format: import('@mog-sdk/contracts/core').CellFormat | null,
  ) => void;
  /**
   * E.5: Suggest cell format based on input.
   * Allows auto-detecting currency ($100), percentage (50%), etc. from user input.
   */
  suggestFormat?: (
    input: string,
  ) => Partial<import('@mog-sdk/contracts/core').CellFormat> | undefined;
}
