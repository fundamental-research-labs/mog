/**
 * Machine Snapshot Types
 *
 * Snapshot interfaces for state machines. These define the output contracts
 * that machines expose to consumers.
 *
 * @module @mog-sdk/contracts/machines/snapshots
 */

import type { CellRange } from '@mog/types-core';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';
import type { ChartUIState, FocusLayerType, RendererStatus, SelectionDirection } from './types';

// =============================================================================
// SELECTION SNAPSHOT
// =============================================================================

/**
 * What the selection machine exposes to consumers.
 *
 * Includes pre-computed derived state for efficient rendering.
 * Consumers should use the derived state (hasFullRowSelection, selectedCols, etc.)
 * instead of iterating over ranges themselves.
 */
export interface SelectionSnapshot {
  ranges: CellRange[];
  activeCell: CellCoord;
  isSelecting: boolean;
  isFormulaMode: boolean;
  isDraggingFillHandle: boolean;
  // Track 5.6: Right-click fill handle drag (shows context menu on release)
  isRightDraggingFillHandle: boolean;

  // Selection direction for Tab/Enter cycling
  /** Direction the selection was created in (from anchor to active cell) */
  direction: SelectionDirection;

  // Pre-computed derived state for efficient rendering
  // These avoid O(16384) iteration when full rows/columns are selected

  /** True if any range has isFullRow (all columns selected) */
  hasFullRowSelection: boolean;
  /** True if any range has isFullColumn (all rows selected) */
  hasFullColumnSelection: boolean;
  /** Rows touched by any selection (efficient - excludes full-column row iteration) */
  selectedRows: ReadonlySet<number>;
  /** Cols touched by any selection (efficient - excludes full-row col iteration) */
  selectedCols: ReadonlySet<number>;
  /** Rows with isFullRow (entire row selected) */
  fullySelectedRows: ReadonlySet<number>;
  /** Cols with isFullColumn (entire column selected) */
  fullySelectedCols: ReadonlySet<number>;

  // ===========================================================================
  // Cell Drag-Drop State
  // ===========================================================================

  /** True if user is dragging cells for move/copy operation */
  isDraggingCells: boolean;
  /** Source range being dragged (null if not dragging) */
  dragSourceRange: CellRange | null;
  /** Current target cell for the drop (null if not dragging) */
  dragTargetCell: CellCoord | null;
  /** Drag mode: 'move' (default) or 'copy' (Ctrl held) */
  dragMode: 'move' | 'copy';

  // ===========================================================================
  // Header Resize State
  // ===========================================================================

  /** True if user is resizing a column or row header */
  isResizingHeader: boolean;
  /** Type of resize: 'column' or 'row' (null if not resizing) */
  resizeType: 'column' | 'row' | null;
  /** Index of the column or row being resized (null if not resizing) */
  resizeIndex: number | null;
  /** Current size during resize in pixels (null if not resizing) */
  resizeCurrentSize: number | null;

  // ===========================================================================
  // Table Resize State (Track 10: Tables - 10.4)
  // ===========================================================================

  /** True if user is resizing a table via the resize handle */
  isResizingTable: boolean;
  /** ID of the table being resized (null if not resizing) */
  tableResizeId: string | null;
  /** Original table bounds when resize started */
  tableResizeStartBounds: CellRange | null;
  /** Target row for the bottom-right corner during resize */
  tableResizeTargetRow: number | null;
  /** Target column for the bottom-right corner during resize */
  tableResizeTargetCol: number | null;
}

// =============================================================================
// EDITOR SNAPSHOT
// =============================================================================

/**
 * What the editor machine exposes to consumers.
 *
 * ARCHITECTURE NOTE: editingCell is included in the snapshot for convenience,
 * but it is DERIVED from selection.activeCell - NOT from EditorContext.
 * This implements the single source of truth pattern.
 */
export interface EditorSnapshot {
  isEditing: boolean;
  isFormulaEditing: boolean;
  /**
   * The cell being edited, derived from selection.activeCell.
   * SINGLE SOURCE OF TRUTH: This is NOT stored in EditorContext,
   * it's derived from selection.activeCell when building the snapshot.
   */
  editingCell: CellCoord | null;
  /** Sheet ID being edited (null if not editing) */
  sheetId: string | null;
  /** Merged region bounds if editing a merged cell (for in-cell editor sizing) */
  mergeBounds: CellRange | null;
  value: string;
  hasConflict: boolean;
  isIMEComposing: boolean;
}

// =============================================================================
// CLIPBOARD SNAPSHOT
// =============================================================================

/**
 * What the clipboard machine exposes to consumers.
 * G1/G2: Extended with copySource for marching ants on copy operations.
 */
export interface ClipboardSnapshot {
  hasCopy: boolean;
  hasCut: boolean;
  cutSource: CellRange[] | null;
  /** G1: Source ranges when copy is active (for marching ants on copy) */
  copySource: CellRange[] | null;
  isPasting: boolean;
  /**
   * Sheet ID where the copy/cut originated.
   * Used for sheet-scoped marching ants: ants only render on the source sheet.
   * Null for external clipboard data or when clipboard is empty.
   */
  sourceSheetId: string | null;
}

// =============================================================================
// RENDERER SNAPSHOT
// =============================================================================

/**
 * What the renderer machine exposes to consumers.
 */
export interface RendererSnapshot {
  status: RendererStatus;
  currentSheetId: string | null;
  isSwitching: boolean;
}

// =============================================================================
// CHART SNAPSHOT
// =============================================================================

/**
 * What the chart machine exposes to consumers.
 * Used for chart UI state (editing, creation wizard, element selection).
 *
 * NOTE: Selection/drag/resize is now handled by objectInteractionActor.
 * This snapshot contains chart-specific UI state only.
 *
 * Note: For full snapshot with all fields, import getChartSnapshot from chart-machine.ts.
 * This interface provides a minimal subset for backwards compatibility.
 */
export interface ChartSnapshot {
  /** Current UI state (derived from machine state) */
  state: ChartUIState;
  /** Selected chart ID (synced from objectInteractionActor) */
  selectedChartId: string | null;
  editingChartId: string | null;
  isCreating: boolean;
  creationStep: number;
  isEditing: boolean;
  /** True if charts are selected (synced from objectInteractionActor) */
  hasSelection: boolean;
}

// =============================================================================
// FOCUS LAYER
// =============================================================================

/**
 * A layer in the focus stack.
 * Stores the layer type, an ID for debugging, and a target for focus restoration.
 */
export interface FocusLayer {
  /** Type of focus layer */
  type: FocusLayerType;
  /** Unique identifier for this layer instance (for debugging/tracking) */
  id: string;
  /** CSS selector to restore focus to when this layer is popped (captured by coordinator) */
  returnFocusTarget: string | null;
}

// =============================================================================
// FOCUS SNAPSHOT
// =============================================================================

/**
 * What the focus machine exposes to consumers.
 */
export interface FocusSnapshot {
  /** Current focus state */
  state: FocusLayerType;
  /** Current top layer */
  currentLayer: FocusLayer;
  /** Full stack (for debugging) */
  stack: readonly FocusLayer[];
  /** Whether grid should handle keyboard events */
  shouldGridHandle: boolean;
  /** Whether focus is in an overlay (dialog, commandPalette, contextMenu, formulaPicker) */
  isInOverlay: boolean;
}
