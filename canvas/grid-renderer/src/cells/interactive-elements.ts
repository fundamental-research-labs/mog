/**
 * Interactive Element Collection
 *
 * During the cell rendering pass, interactive elements (checkboxes, comment
 * indicators, filter buttons, validation dropdowns) are detected and emitted
 * to an InteractiveElementCollector. The collector bridges the canvas coordinate
 * system to React's DOM overlay system for tooltips, popovers, and click handlers.
 *
 * @module grid-renderer/cells/interactive-elements
 */

import { canvasToDocXY, docToCanvasXY, type RenderRegion } from '@mog/canvas-engine';
import type { InteractiveElement, InteractiveElementCollector } from '@mog-sdk/contracts/rendering';
import { getFilterButtonHitBounds } from './indicators';
import type { CellRenderInfo } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Cell metadata used to determine which interactive elements to emit.
 */
export interface InteractiveCellInfo {
  /** Whether this cell has a comment */
  hasComment: boolean;
  /** Whether this cell is a checkbox cell */
  isCheckbox: boolean;
  /** Whether this cell's value is truthy (for checkbox state) */
  isChecked: boolean;
  /** Filter header info (present if cell is a filter header) */
  filterInfo?: {
    filterId: string;
    headerCellId: string;
    hasActiveFilter: boolean;
  };
  /** Validation dropdown info (present if cell has list validation) */
  validationDropdown?: {
    options: string[];
  };
  /** Sheet ID */
  sheetId: string;
}

type Bounds = { x: number; y: number; width: number; height: number };
export type InteractiveBoundsMapper = (bounds: Bounds) => Bounds;

export function toInteractiveViewportBounds(bounds: Bounds, region: RenderRegion): Bounds {
  const zoom = region.zoom || 1;
  const viewportSpaceRegion = {
    bounds: { x: 0, y: 0 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: region.scrollOffset,
    zoom,
  };
  const doc = canvasToDocXY(
    region.bounds.x + bounds.x * zoom,
    region.bounds.y + bounds.y * zoom,
    region,
  );
  const viewport = docToCanvasXY(doc.x, doc.y, viewportSpaceRegion);
  return {
    x: viewport.x,
    y: viewport.y,
    width: bounds.width * zoom,
    height: bounds.height * zoom,
  };
}

// =============================================================================
// Element ID Generation
// =============================================================================

/**
 * Create a unique element ID for an interactive element.
 * Format: "{type}:{sheetId}:{row},{col}"
 */
function elementId(type: string, sheetId: string, row: number, col: number): string {
  return `${type}:${sheetId}:${row},${col}`;
}

/**
 * Create a cell ID string from row and column.
 * Format: "{row},{col}"
 */
function cellId(row: number, col: number): string {
  return `${row},${col}`;
}

// =============================================================================
// Interactive Element Collection
// =============================================================================

/**
 * Collect interactive elements from a cell during rendering.
 *
 * Called for each visible cell during the render pass. Examines cell metadata
 * and emits interactive elements to the collector for DOM overlay positioning.
 *
 * @param cell - The cell render info (position and dimensions)
 * @param info - Cell metadata for determining interactive elements
 * @param collector - The interactive element collector to emit elements to
 */
export function collectInteractiveElements(
  cell: CellRenderInfo,
  info: InteractiveCellInfo,
  collector: InteractiveElementCollector,
  mapBounds?: InteractiveBoundsMapper,
): void {
  const { row, col, x, y, width, height } = cell;
  const { sheetId } = info;
  const addElement = (element: InteractiveElement): void => {
    collector.add(
      mapBounds
        ? {
            ...element,
            bounds: mapBounds(element.bounds),
          }
        : element,
    );
  };

  // Comment indicator — bounds cover only the top-right triangle + hit padding
  if (info.hasComment) {
    const COMMENT_TRIANGLE_SIZE = 6;
    const COMMENT_HIT_PADDING = 4;
    const indicatorWidth = COMMENT_TRIANGLE_SIZE + COMMENT_HIT_PADDING * 2;
    const indicatorHeight = COMMENT_TRIANGLE_SIZE + COMMENT_HIT_PADDING * 2;
    const element: InteractiveElement = {
      id: elementId('comment-indicator', sheetId, row, col),
      type: 'comment-indicator',
      bounds: {
        x: x + width - COMMENT_TRIANGLE_SIZE - COMMENT_HIT_PADDING,
        y: y - COMMENT_HIT_PADDING,
        width: indicatorWidth,
        height: indicatorHeight,
      },
      metadata: {
        type: 'comment-indicator',
        cellId: cellId(row, col),
        sheetId,
        row,
        col,
      },
    };
    addElement(element);
  }

  // Checkbox
  if (info.isCheckbox) {
    const element: InteractiveElement = {
      id: elementId('checkbox', sheetId, row, col),
      type: 'checkbox',
      bounds: { x, y, width, height },
      metadata: {
        type: 'checkbox',
        cellId: cellId(row, col),
        sheetId,
        checked: info.isChecked,
        row,
        col,
      },
    };
    addElement(element);
  }

  // Filter button
  if (info.filterInfo) {
    const { filterId, headerCellId, hasActiveFilter } = info.filterInfo;
    const bounds = getFilterButtonHitBounds(x, y, width, height);
    const element: InteractiveElement = {
      id: elementId('filter-button', sheetId, row, col),
      type: 'filter-button',
      bounds,
      metadata: {
        type: 'filter-button',
        filterId,
        headerCellId,
        hasActiveFilter,
        col,
      },
    };
    addElement(element);
  }

  // Validation dropdown
  if (info.validationDropdown) {
    const element: InteractiveElement = {
      id: elementId('validation-dropdown', sheetId, row, col),
      type: 'validation-dropdown',
      bounds: { x, y, width, height },
      metadata: {
        type: 'validation-dropdown',
        cellId: cellId(row, col),
        sheetId,
        row,
        col,
        options: info.validationDropdown.options,
      },
    };
    addElement(element);
  }
}

// =============================================================================
// Interactive Element Collector Implementation
// =============================================================================

/**
 * Collector that gathers interactive element positions during canvas render
 * and provides them to React for DOM overlay rendering.
 *
 * Key characteristics:
 * - Cleared at start of each render frame
 * - Elements added during render pass
 * - Subscribers notified once per frame (batched via rAF)
 * - Uses Map with composite keys for O(1) lookup
 */
export class InteractiveElementCollectorImpl implements InteractiveElementCollector {
  /** Map of element ID to element data for O(1) lookup and deduplication */
  private elements = new Map<string, InteractiveElement>();

  /** Set of callbacks to notify when elements change */
  private subscribers = new Set<(elements: InteractiveElement[]) => void>();

  /** Flag to prevent multiple rAF callbacks in the same frame */
  private pendingNotify = false;

  /**
   * Clear all collected elements.
   * Called at the start of each render frame before any layers paint.
   * Schedules a notification so subscribers learn about the empty state
   * even when no elements are added in the new frame.
   */
  clear(): void {
    this.elements.clear();
    this.scheduleNotify();
  }

  /**
   * Add an interactive element to the collection.
   * If an element with the same ID already exists, it will be replaced.
   *
   * @param element - The interactive element with position and metadata
   */
  add(element: InteractiveElement): void {
    this.elements.set(element.id, element);
    this.scheduleNotify();
  }

  /**
   * Get all collected elements as an array.
   * Returns a new array each time to ensure React detects changes.
   */
  getAll(): InteractiveElement[] {
    return Array.from(this.elements.values());
  }

  /**
   * Subscribe to element updates.
   * The callback will be invoked once per render frame (batched via rAF).
   *
   * @param callback - Function to call with updated element list
   * @returns Unsubscribe function
   */
  subscribe(callback: (elements: InteractiveElement[]) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Schedule subscriber notification for end of the current render task.
   * Uses a microtask (Promise.resolve) so the notification fires after all
   * add() calls in the same render pass complete, but before the next rAF.
   * This keeps DOM overlays in sync within the same animation frame that
   * the canvas render ran in, avoiding an extra rAF hop.
   */
  private scheduleNotify(): void {
    if (this.pendingNotify) {
      return;
    }

    this.pendingNotify = true;

    Promise.resolve().then(() => {
      this.pendingNotify = false;
      const all = this.getAll();
      for (const callback of this.subscribers) {
        callback(all);
      }
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new interactive element collector instance.
 */
export function createInteractiveElementCollector(): InteractiveElementCollector {
  return new InteractiveElementCollectorImpl();
}
