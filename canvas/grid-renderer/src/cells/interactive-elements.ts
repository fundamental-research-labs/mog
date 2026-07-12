/**
 * Interactive Element Collection
 *
 * During the cell rendering pass, interactive elements (checkboxes, comment
 * indicators, filter buttons, validation dropdowns) are detected and emitted
 * in the same unzoomed region-local coordinate space used to draw the cell.
 * Region placement and the public DOM-overlay collector live at separate
 * boundaries so this module remains independent of pane topology.
 *
 * @module grid-renderer/cells/interactive-elements
 */

import { regionLocalRect, type RegionLocalRect } from '@mog/canvas-engine';
import type { InteractiveElement } from '@mog-sdk/contracts/rendering';
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

export type RegionLocalInteractiveElement = Omit<InteractiveElement, 'bounds'> & {
  localBounds: RegionLocalRect;
};
export interface RegionLocalInteractiveElementCollector {
  addRegionLocal(element: RegionLocalInteractiveElement): void;
}
export interface RegionLocalInteractiveCell {
  row: number;
  col: number;
  localBounds: RegionLocalRect;
}

/** Brand the documented region-local geometry carried by CellRenderInfo. */
export function toRegionLocalInteractiveCell(
  cell: Pick<CellRenderInfo, 'row' | 'col' | 'x' | 'y' | 'width' | 'height'>,
): RegionLocalInteractiveCell {
  return {
    row: cell.row,
    col: cell.col,
    localBounds: regionLocalRect(cell.x, cell.y, cell.width, cell.height),
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
 * @param collector - Region-local collector supplied by the current render region
 */
export function collectInteractiveElements(
  cell: RegionLocalInteractiveCell,
  info: InteractiveCellInfo,
  collector: RegionLocalInteractiveElementCollector,
): void {
  const { row, col } = cell;
  const { x, y, width, height } = cell.localBounds;
  const { sheetId } = info;

  // Comment indicator — bounds cover only the top-right triangle + hit padding
  if (info.hasComment) {
    const COMMENT_TRIANGLE_SIZE = 6;
    const COMMENT_HIT_PADDING = 4;
    const indicatorWidth = COMMENT_TRIANGLE_SIZE + COMMENT_HIT_PADDING * 2;
    const indicatorHeight = COMMENT_TRIANGLE_SIZE + COMMENT_HIT_PADDING * 2;
    const element: RegionLocalInteractiveElement = {
      id: elementId('comment-indicator', sheetId, row, col),
      type: 'comment-indicator',
      localBounds: regionLocalRect(
        x + width - COMMENT_TRIANGLE_SIZE - COMMENT_HIT_PADDING,
        y - COMMENT_HIT_PADDING,
        indicatorWidth,
        indicatorHeight,
      ),
      metadata: {
        type: 'comment-indicator',
        cellId: cellId(row, col),
        sheetId,
        row,
        col,
      },
    };
    collector.addRegionLocal(element);
  }

  // Checkbox
  if (info.isCheckbox) {
    const element: RegionLocalInteractiveElement = {
      id: elementId('checkbox', sheetId, row, col),
      type: 'checkbox',
      localBounds: regionLocalRect(x, y, width, height),
      metadata: {
        type: 'checkbox',
        cellId: cellId(row, col),
        sheetId,
        checked: info.isChecked,
        row,
        col,
      },
    };
    collector.addRegionLocal(element);
  }

  // Filter button
  if (info.filterInfo) {
    const { filterId, headerCellId, hasActiveFilter } = info.filterInfo;
    const bounds = getFilterButtonHitBounds(x, y, width, height);
    const element: RegionLocalInteractiveElement = {
      id: elementId('filter-button', sheetId, row, col),
      type: 'filter-button',
      localBounds: regionLocalRect(bounds.x, bounds.y, bounds.width, bounds.height),
      metadata: {
        type: 'filter-button',
        filterId,
        headerCellId,
        hasActiveFilter,
        col,
      },
    };
    collector.addRegionLocal(element);
  }

  // Validation dropdown
  if (info.validationDropdown) {
    const element: RegionLocalInteractiveElement = {
      id: elementId('validation-dropdown', sheetId, row, col),
      type: 'validation-dropdown',
      localBounds: regionLocalRect(x, y, width, height),
      metadata: {
        type: 'validation-dropdown',
        cellId: cellId(row, col),
        sheetId,
        row,
        col,
        options: info.validationDropdown.options,
      },
    };
    collector.addRegionLocal(element);
  }
}
