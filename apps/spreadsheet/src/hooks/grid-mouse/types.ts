/**
 * Grid Mouse Types
 *
 * Type definitions for the grid mouse hook.
 * These are extracted from use-grid-mouse.ts to enable modular composition.
 *
 * @see use-grid-mouse.ts - Main hook implementation
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { SheetCoordinator } from '../../coordinator';
import type { SparklineManager } from '../../coordinator/sparklines/sparkline-manager';

// =============================================================================
// Hook Options
// =============================================================================

/**
 * Options for the useGridMouse hook.
 */
export interface UseGridMouseOptions {
  /** Active sheet ID */
  activeSheetId: SheetId;
  /** Container element ref (for calculating positions) */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Coordinator for hit testing floating objects and outlines */
  coordinator: SheetCoordinator;
  /** Callback for hyperlink Ctrl+click */
  onHyperlinkClick?: (cell: CellCoord) => boolean;
  /** Callback for context menu */
  onContextMenu?: (options: ContextMenuOptions) => void;
  /** Grouping actions for outline hit testing */
  groupingActions?: {
    maxRowLevel: number;
    maxColLevel: number;
    setLevelCollapsed: (axis: 'row' | 'column', level: number, collapsed: boolean) => void;
    toggleGroupCollapsed: (groupId: string) => void;
  };
  /** Sparkline manager for double-click on sparkline cells */
  sparklineManager?: SparklineManager;
  /** Callback for editing sparklines */
  onEditSparkline?: (sparklineId: string, row: number, col: number) => void;
  /**
   * Callback for cell hover events.
   * Called when mouse hovers over a cell. Use this for hyperlink tooltips.
   *
   * @param cell - The hovered cell coordinates, or null if mouse left the grid
   * @param screenPosition - Screen coordinates for tooltip positioning
   */
  onCellHover?: (
    cell: { row: number; col: number } | null,
    screenPosition: { x: number; y: number },
  ) => void;
  /**
   * Callback for comment indicator click.
   * Called when user clicks on the red comment indicator triangle.
   *
   * @param cell - The cell coordinates
   * @param screenPosition - Screen position for comment popover placement
   */
  onCommentIndicatorClick?: (
    cell: { row: number; col: number },
    screenPosition: { x: number; y: number },
  ) => void;
}

// =============================================================================
// Context Menu Options
// =============================================================================

/**
 * Options passed to the context menu callback.
 */
export interface ContextMenuOptions {
  /** X position in screen coordinates */
  x: number;
  /** Y position in screen coordinates */
  y: number;
  /** What was right-clicked */
  target: 'cell' | 'row-header' | 'column-header' | 'selection';
  /** Target row index (for row-header or cell clicks) */
  targetRow?: number;
  /** Target column index (for column-header or cell clicks) */
  targetCol?: number;
}

// =============================================================================
// Shared Mouse Event Interface
// =============================================================================

/**
 * Minimal mouse event interface shared by React MouseEvent and native PointerEvent.
 *
 * The grid uses native pointer event listeners (for setPointerCapture support)
 * that delegate to handlers originally typed for React.MouseEvent. Both event
 * types expose these properties, so we use this common interface to avoid
 * unsafe casts between the two.
 *
 * `pointerType` is only present on PointerEvent; React MouseEvent does not
 * expose it. Callers may use it to tighten hit tolerances for mouse vs touch
 * (e.g. drag-handle proximity around the selection border).
 */
export interface GridMouseEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** Optional: 'mouse' | 'pen' | 'touch'. Present only on PointerEvent. */
  readonly pointerType?: string;
}

// =============================================================================
// Hook Return Value
// =============================================================================

/**
 * Return value from the useGridMouse hook.
 */
export interface UseGridMouseReturn {
  /** Handle mouse down - called from native pointer listeners and React handlers */
  handleMouseDown: (e: GridMouseEvent) => void;
  /** Handle mouse move - called from native pointer listeners and React handlers */
  handleMouseMove: (e: GridMouseEvent) => void;
  /** Handle mouse up - attach to container's onMouseUp */
  handleMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Handle mouse leave */
  handleMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Handle double click - attach to container's onDoubleClick */
  handleDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Handle context menu - attach to container's onContextMenu */
  handleContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Current cursor style based on hover/interaction state */
  cursor: string | undefined;
}
