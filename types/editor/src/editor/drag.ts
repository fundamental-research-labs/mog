/**
 * Drag & Drop Types
 *
 * Types for cell drag-drop operations (move/copy cells via dragging).
 * Part of Stream C4: UI Micro-Polish.
 *
 */

import type { CellRange, SheetId } from '@mog/types-core/core';

// =============================================================================
// Cell Drag-Drop Types
// =============================================================================

/**
 * Mode of the drag operation.
 * - 'move': Cut and paste (default, removes source)
 * - 'copy': Copy and paste (Ctrl held, keeps source)
 */
export type DragMode = 'move' | 'copy';

/**
 * Cell coordinate for drag operations.
 */
export interface DragCellCoord {
  row: number;
  col: number;
}

/**
 * Context for an active cell drag operation.
 * Stored in selection machine context during drag.
 */
export interface DragCellsContext {
  /** Source range being dragged */
  sourceRange: CellRange;
  /** Current target cell (top-left of drop location) */
  targetCell: DragCellCoord | null;
  /** Drag mode: move (default) or copy (Ctrl held) */
  mode: DragMode;
  /** Offset from mouse position to range top-left (for visual ghost positioning) */
  dragOffset: { rows: number; cols: number };
}

/**
 * Options for Insert Cells operation.
 * Excel behavior: when inserting cells (not full rows/cols), user chooses shift direction.
 */
export interface InsertCellsOptions {
  /** Range where cells will be inserted */
  range: CellRange;
  /** Direction to shift existing cells */
  direction: 'right' | 'down';
}

/**
 * Result of an insert cells operation.
 */
export interface InsertCellsResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message if failed (e.g., merge conflict) */
  error?: string;
  /** Number of cells shifted */
  cellsShifted?: number;
}

// =============================================================================
// Drag Visual State (for UI layer rendering)
// =============================================================================

/**
 * Visual state for rendering drag feedback.
 * Passed to UI layer for ghost/indicator rendering.
 */
export interface DragVisualState {
  /** Is drag currently active? */
  active: boolean;
  /** Source range being dragged */
  sourceRange: CellRange | null;
  /** Current drop target (top-left cell) */
  dropTarget: DragCellCoord | null;
  /** Drag mode for visual indication */
  mode: DragMode;
  /** Mouse position relative to canvas (for ghost positioning) */
  mousePosition: { x: number; y: number } | null;
}

// =============================================================================
// Cell Tooltip Types (C4.2)
// =============================================================================

/**
 * State for cell overflow tooltip.
 */
export interface CellTooltipState {
  /** Cell being hovered */
  cell: DragCellCoord;
  /** Full content of the clipped cell */
  content: string;
  /** Position to show tooltip (screen coordinates) */
  position: { x: number; y: number };
}

// =============================================================================
// Events
// =============================================================================

/**
 * Event emitted when cells are inserted (partial range shift).
 * Note: This is different from RowsInsertedEvent/ColumnsInsertedEvent
 * which affect entire rows/columns.
 */
export interface CellsInsertedEvent {
  type: 'cells:inserted';
  timestamp: number;
  /** Sheet where cells were inserted */
  sheetId: SheetId;
  /** Range where cells were inserted */
  range: CellRange;
  /** Direction cells were shifted */
  direction: 'right' | 'down';
  /** Source of the operation */
  source: 'user' | 'api';
}

/**
 * Event emitted when cells are deleted (partial range shift).
 */
export interface CellsDeletedEvent {
  type: 'cells:deleted';
  timestamp: number;
  /** Sheet where cells were deleted */
  sheetId: SheetId;
  /** Range where cells were deleted */
  range: CellRange;
  /** Direction remaining cells were shifted */
  direction: 'left' | 'up';
  /** Source of the operation */
  source: 'user' | 'api';
}

/**
 * Event emitted when cells are moved via drag-drop.
 */
export interface CellsMovedEvent {
  type: 'cells:moved';
  timestamp: number;
  /** Sheet ID */
  sheetId: SheetId;
  /** Original source range */
  sourceRange: CellRange;
  /** Target range after move */
  targetRange: CellRange;
  /** Source of the operation */
  source: 'user' | 'api';
}

/**
 * Event emitted when cells are copied via drag-drop (Ctrl+drag).
 */
export interface CellsCopiedEvent {
  type: 'cells:copied';
  timestamp: number;
  /** Sheet ID */
  sheetId: SheetId;
  /** Source range (unchanged) */
  sourceRange: CellRange;
  /** Target range after copy */
  targetRange: CellRange;
  /** Source of the operation */
  source: 'user' | 'api';
}

// =============================================================================
// Header Resize Types
// =============================================================================

/**
 * Type of header resize operation.
 */
export type HeaderResizeType = 'column' | 'row';

/**
 * State for an active header resize operation.
 * Stored in selection machine context during drag.
 */
export interface HeaderResizeState {
  /** Type of resize (column or row) */
  type: HeaderResizeType;
  /** Index of the column or row being resized */
  index: number;
  /** Starting position of the resize (screen coordinates) */
  startPosition: number;
  /** Starting size of the column/row (in pixels) */
  startSize: number;
  /** Current size during resize (in pixels) */
  currentSize: number;
  /** Minimum allowed size */
  minSize: number;
}
