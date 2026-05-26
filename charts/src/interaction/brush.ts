/**
 * Brush Utilities - Rectangular selection for chart interactions
 *
 * Pure functions for brush selection of data points within a rectangular area.
 * Used for zooming to selection, filtering, and multi-select operations.
 *
 * No framework dependencies - pure geometry calculations.
 */

import type { ArcMark, Mark, PathMark, RectMark, SymbolMark, TextMark } from '../primitives/types';
import { symbolRadius, type DataRow } from './shared';
export type { DataRow } from './shared';

// =============================================================================
// Types
// =============================================================================

/**
 * Brush selection bounds in pixel coordinates
 */
export interface BrushSelection {
  /** X-axis bounds [min, max] in pixels */
  x: [number, number];
  /** Y-axis bounds [min, max] in pixels */
  y: [number, number];
}

/**
 * Result of a brush selection operation
 */
export interface BrushResult {
  /** Indices of selected data rows in the original array */
  indices: number[];
  /** The selected data rows */
  data: DataRow[];
  /** The brush bounds used for selection */
  bounds: BrushSelection;
}

/**
 * Brush mode determining which marks are selected
 */
export type BrushMode = 'intersect' | 'contain' | 'center';

/**
 * Options for brush selection
 */
export interface BrushOptions {
  /** Selection mode (default: 'center') */
  mode?: BrushMode;
}

/**
 * Parse SVG path string to extract coordinates for bounding box calculation.
 */
function parsePathCoordinates(pathString: string): { x: number; y: number }[] {
  const coords: { x: number; y: number }[] = [];
  // Simple regex to extract coordinates from path commands (M, L, etc.)
  const regex = /([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi;
  let match;
  let currentX = 0;
  let currentY = 0;

  while ((match = regex.exec(pathString)) !== null) {
    const cmd = match[1].toUpperCase();
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    switch (cmd) {
      case 'M':
      case 'L':
        for (let i = 0; i < args.length; i += 2) {
          currentX = args[i];
          currentY = args[i + 1];
          coords.push({ x: currentX, y: currentY });
        }
        break;
      case 'H':
        for (const arg of args) {
          currentX = arg;
          coords.push({ x: currentX, y: currentY });
        }
        break;
      case 'V':
        for (const arg of args) {
          currentY = arg;
          coords.push({ x: currentX, y: currentY });
        }
        break;
      case 'Z':
        // Close path - no coordinates
        break;
      // For curves, we simplify by just using the endpoint
      case 'C':
        for (let i = 0; i < args.length; i += 6) {
          currentX = args[i + 4];
          currentY = args[i + 5];
          coords.push({ x: currentX, y: currentY });
        }
        break;
      case 'Q':
        for (let i = 0; i < args.length; i += 4) {
          currentX = args[i + 2];
          currentY = args[i + 3];
          coords.push({ x: currentX, y: currentY });
        }
        break;
    }
  }

  return coords;
}

/**
 * Get the bounding box of a mark
 */
function getMarkBounds(
  mark: Mark,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  switch (mark.type) {
    case 'rect': {
      const rectMark = mark as RectMark;
      return {
        minX: rectMark.x,
        minY: rectMark.y,
        maxX: rectMark.x + rectMark.width,
        maxY: rectMark.y + rectMark.height,
      };
    }

    case 'symbol': {
      const symbolMark = mark as SymbolMark;
      const r = symbolRadius(symbolMark.size);
      return {
        minX: symbolMark.x - r,
        minY: symbolMark.y - r,
        maxX: symbolMark.x + r,
        maxY: symbolMark.y + r,
      };
    }

    case 'arc': {
      const arcMark = mark as ArcMark;
      // Simplified bounding box for arc (uses outer radius)
      return {
        minX: arcMark.x - arcMark.outerRadius,
        minY: arcMark.y - arcMark.outerRadius,
        maxX: arcMark.x + arcMark.outerRadius,
        maxY: arcMark.y + arcMark.outerRadius,
      };
    }

    case 'text': {
      const textMark = mark as TextMark;
      // Approximate text bounds, accounting for alignment
      const fontSize = textMark.fontSize;
      const width = textMark.text.length * fontSize * 0.6;
      const height = fontSize;

      // Adjust for horizontal alignment
      let offsetX = 0;
      const align = textMark.textAlign ?? 'left';
      if (align === 'center') offsetX = -width / 2;
      else if (align === 'right') offsetX = -width;

      // Adjust for vertical baseline
      let offsetY = 0;
      const baseline = textMark.textBaseline ?? 'bottom';
      if (baseline === 'middle') offsetY = -height / 2;
      else if (baseline === 'top') offsetY = 0;
      else offsetY = -height; // 'bottom'

      return {
        minX: textMark.x + offsetX,
        minY: textMark.y + offsetY,
        maxX: textMark.x + offsetX + width,
        maxY: textMark.y + offsetY + height,
      };
    }

    case 'path': {
      const pathMark = mark as PathMark;
      // Calculate bounds from path string
      const coords = parsePathCoordinates(pathMark.path);
      if (coords.length === 0) return null;

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const coord of coords) {
        minX = Math.min(minX, coord.x);
        maxX = Math.max(maxX, coord.x);
        minY = Math.min(minY, coord.y);
        maxY = Math.max(maxY, coord.y);
      }

      if (minX === Infinity) return null;
      return { minX, minY, maxX, maxY };
    }

    default:
      return null;
  }
}

/**
 * Get the center point of a mark
 */
function getMarkCenter(mark: Mark): { x: number; y: number } {
  switch (mark.type) {
    case 'rect': {
      const rectMark = mark as RectMark;
      return {
        x: rectMark.x + rectMark.width / 2,
        y: rectMark.y + rectMark.height / 2,
      };
    }

    case 'symbol':
    case 'text':
      return { x: mark.x, y: mark.y };

    case 'arc':
      return { x: mark.x, y: mark.y };

    case 'path': {
      const pathMark = mark as PathMark;
      // Extract first coordinate from path string
      const coords = parsePathCoordinates(pathMark.path);
      if (coords.length > 0) {
        return { x: coords[0].x, y: coords[0].y };
      }
      return { x: pathMark.x, y: pathMark.y };
    }

    default:
      return { x: 0, y: 0 };
  }
}

// =============================================================================
// Selection Tests
// =============================================================================

/**
 * Test if a mark's center is inside the brush selection
 */
function isCenterInBrush(mark: Mark, selection: BrushSelection): boolean {
  const center = getMarkCenter(mark);
  const [xMin, xMax] = selection.x;
  const [yMin, yMax] = selection.y;

  return center.x >= xMin && center.x <= xMax && center.y >= yMin && center.y <= yMax;
}

/**
 * Test if a mark intersects the brush selection (any overlap)
 */
function intersectsBrush(mark: Mark, selection: BrushSelection): boolean {
  const bounds = getMarkBounds(mark);
  if (!bounds) return false;

  const [xMin, xMax] = selection.x;
  const [yMin, yMax] = selection.y;

  // Check for non-intersection (if any of these is true, boxes don't intersect)
  if (bounds.maxX < xMin || bounds.minX > xMax || bounds.maxY < yMin || bounds.minY > yMax) {
    return false;
  }

  return true;
}

/**
 * Test if a mark is completely contained within the brush selection
 */
function isContainedInBrush(mark: Mark, selection: BrushSelection): boolean {
  const bounds = getMarkBounds(mark);
  if (!bounds) return false;

  const [xMin, xMax] = selection.x;
  const [yMin, yMax] = selection.y;

  return bounds.minX >= xMin && bounds.maxX <= xMax && bounds.minY >= yMin && bounds.maxY <= yMax;
}

/**
 * Test if a mark is in the brush selection based on mode
 */
function isMarkInBrush(mark: Mark, selection: BrushSelection, mode: BrushMode): boolean {
  switch (mode) {
    case 'center':
      return isCenterInBrush(mark, selection);
    case 'intersect':
      return intersectsBrush(mark, selection);
    case 'contain':
      return isContainedInBrush(mark, selection);
    default:
      return isCenterInBrush(mark, selection);
  }
}

// =============================================================================
// Brush Selection Functions
// =============================================================================

/**
 * Create a brush selection from start and end points.
 * Automatically normalizes to ensure min < max.
 *
 * @param start - Starting point of the brush
 * @param end - Ending point of the brush
 * @returns Normalized BrushSelection
 */
export function createBrushSelection(
  start: { x: number; y: number },
  end: { x: number; y: number },
): BrushSelection {
  return {
    x: [Math.min(start.x, end.x), Math.max(start.x, end.x)],
    y: [Math.min(start.y, end.y), Math.max(start.y, end.y)],
  };
}

/**
 * Find all data points within the brush selection.
 *
 * @param marks - Array of marks to test
 * @param data - Array of data rows corresponding to marks
 * @param selection - The brush selection bounds
 * @param options - Options for brush selection
 * @returns BrushResult with selected indices and data
 */
export function brushSelect(
  marks: Mark[],
  data: DataRow[],
  selection: BrushSelection,
  options?: BrushOptions,
): BrushResult {
  const mode = options?.mode ?? 'center';
  const selectedIndices: number[] = [];

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];

    // Skip non-interactive marks
    if (mark.interactive === false) {
      continue;
    }

    if (isMarkInBrush(mark, selection, mode)) {
      selectedIndices.push(i);
    }
  }

  return {
    indices: selectedIndices,
    data: selectedIndices.map((i) => data[i]).filter((d): d is DataRow => d !== undefined),
    bounds: selection,
  };
}

/**
 * Find marks within the brush selection.
 * Similar to brushSelect but returns marks instead of data.
 *
 * @param marks - Array of marks to test
 * @param selection - The brush selection bounds
 * @param options - Options for brush selection
 * @returns Array of marks within the selection
 */
export function brushSelectMarks(
  marks: Mark[],
  selection: BrushSelection,
  options?: BrushOptions,
): Mark[] {
  const mode = options?.mode ?? 'center';
  const selectedMarks: Mark[] = [];

  for (const mark of marks) {
    // Skip non-interactive marks
    if (mark.interactive === false) {
      continue;
    }

    if (isMarkInBrush(mark, selection, mode)) {
      selectedMarks.push(mark);
    }
  }

  return selectedMarks;
}

/**
 * Expand a brush selection by a given amount.
 *
 * @param selection - The brush selection to expand
 * @param amount - Amount to expand in pixels (positive expands, negative contracts)
 * @returns Expanded BrushSelection
 */
export function expandBrushSelection(selection: BrushSelection, amount: number): BrushSelection {
  return {
    x: [selection.x[0] - amount, selection.x[1] + amount],
    y: [selection.y[0] - amount, selection.y[1] + amount],
  };
}

/**
 * Calculate the area of a brush selection.
 *
 * @param selection - The brush selection
 * @returns Area in square pixels
 */
export function getBrushArea(selection: BrushSelection): number {
  const width = selection.x[1] - selection.x[0];
  const height = selection.y[1] - selection.y[0];
  return width * height;
}

/**
 * Check if a brush selection is valid (has non-zero area).
 *
 * @param selection - The brush selection
 * @param minSize - Minimum size in pixels (default: 1)
 * @returns True if the selection is valid
 */
export function isValidBrushSelection(selection: BrushSelection, minSize: number = 1): boolean {
  const width = selection.x[1] - selection.x[0];
  const height = selection.y[1] - selection.y[0];
  return width >= minSize && height >= minSize;
}

/**
 * Constrain a brush selection to bounds.
 *
 * @param selection - The brush selection to constrain
 * @param bounds - The bounds to constrain to
 * @returns Constrained BrushSelection
 */
export function constrainBrushSelection(
  selection: BrushSelection,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): BrushSelection {
  return {
    x: [Math.max(selection.x[0], bounds.minX), Math.min(selection.x[1], bounds.maxX)],
    y: [Math.max(selection.y[0], bounds.minY), Math.min(selection.y[1], bounds.maxY)],
  };
}

/**
 * Calculate the intersection of two brush selections.
 *
 * @param a - First brush selection
 * @param b - Second brush selection
 * @returns Intersection BrushSelection, or null if no intersection
 */
export function intersectBrushSelections(
  a: BrushSelection,
  b: BrushSelection,
): BrushSelection | null {
  const xMin = Math.max(a.x[0], b.x[0]);
  const xMax = Math.min(a.x[1], b.x[1]);
  const yMin = Math.max(a.y[0], b.y[0]);
  const yMax = Math.min(a.y[1], b.y[1]);

  if (xMin >= xMax || yMin >= yMax) {
    return null;
  }

  return {
    x: [xMin, xMax],
    y: [yMin, yMax],
  };
}

/**
 * Calculate the union (bounding box) of two brush selections.
 *
 * @param a - First brush selection
 * @param b - Second brush selection
 * @returns Union BrushSelection
 */
export function unionBrushSelections(a: BrushSelection, b: BrushSelection): BrushSelection {
  return {
    x: [Math.min(a.x[0], b.x[0]), Math.max(a.x[1], b.x[1])],
    y: [Math.min(a.y[0], b.y[0]), Math.max(a.y[1], b.y[1])],
  };
}

/**
 * Check if a point is inside a brush selection.
 *
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param selection - The brush selection
 * @returns True if the point is inside
 */
export function isPointInBrush(x: number, y: number, selection: BrushSelection): boolean {
  return x >= selection.x[0] && x <= selection.x[1] && y >= selection.y[0] && y <= selection.y[1];
}

/**
 * Get the center point of a brush selection.
 *
 * @param selection - The brush selection
 * @returns Center point
 */
export function getBrushCenter(selection: BrushSelection): { x: number; y: number } {
  return {
    x: (selection.x[0] + selection.x[1]) / 2,
    y: (selection.y[0] + selection.y[1]) / 2,
  };
}

/**
 * Get the dimensions of a brush selection.
 *
 * @param selection - The brush selection
 * @returns Width and height
 */
export function getBrushDimensions(selection: BrushSelection): { width: number; height: number } {
  return {
    width: selection.x[1] - selection.x[0],
    height: selection.y[1] - selection.y[0],
  };
}
