/**
 * Hit Tester - Spatial indexing for efficient mark hit testing
 *
 * Uses @mog/spatial GridSpatialIndex for O(1) average-case point queries.
 * Supports finding marks at a point or within a radius.
 *
 * No framework dependencies - pure geometry operations.
 */

import { createSpatialIndex, findNearby, type SpatialIndex } from '@mog/spatial';
import { getArcCentroid, hitTestArc } from '../marks/arc';
import { parsePath } from '../marks/path';
import { hitTestRect } from '../marks/rect';
import { hitTestSymbol } from '../marks/symbol';
import type { AnyMark, ArcMark, PathMark, RectMark, SymbolMark, TextMark } from '../types';

// =============================================================================
// Hit Test Result Types
// =============================================================================

/**
 * Result of a hit test operation.
 */
export interface HitTestResult {
  /** The mark that was hit */
  mark: AnyMark;
  /** The associated data datum (if any) */
  datum: unknown;
  /** Distance from the test point to the mark center */
  distance: number;
}

/**
 * Hit tester interface.
 */
export interface HitTester {
  /** Build the spatial index from marks */
  build(marks: AnyMark[]): void;
  /** Find the closest mark at a point */
  hitTest(x: number, y: number, radius?: number): HitTestResult | null;
  /** Find all marks within a radius of a point */
  hitTestAll(x: number, y: number, radius?: number): HitTestResult[];
  /** Clear the spatial index */
  clear(): void;
}

// =============================================================================
// Bounding Box Type
// =============================================================================

// BoundingBox imported from contracts - canonical single source of truth
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
export type { BoundingBox };

// =============================================================================
// Bounding Box Calculations
// =============================================================================

/**
 * Get the bounding box of a mark.
 */
export function getBoundingBox(mark: AnyMark): BoundingBox {
  switch (mark.type) {
    case 'rect':
      return getRectBounds(mark);
    case 'arc':
      return getArcBounds(mark);
    case 'symbol':
      return getSymbolBounds(mark);
    case 'text':
      return getTextBounds(mark);
    case 'path':
      return getPathBounds(mark);
    default:
      // Fallback for unknown types
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function getRectBounds(mark: RectMark): BoundingBox {
  return {
    x: mark.x,
    y: mark.y,
    width: mark.width,
    height: mark.height,
  };
}

function getArcBounds(mark: ArcMark): BoundingBox {
  // Conservative bounding box using outer radius
  const r = mark.outerRadius;
  return {
    x: mark.x - r,
    y: mark.y - r,
    width: r * 2,
    height: r * 2,
  };
}

function getSymbolBounds(mark: SymbolMark): BoundingBox {
  // Size is area, calculate radius
  const r = Math.sqrt(mark.size / Math.PI) * 1.5; // Padding for non-circle shapes
  return {
    x: mark.x - r,
    y: mark.y - r,
    width: r * 2,
    height: r * 2,
  };
}

function getTextBounds(mark: TextMark): BoundingBox {
  // Approximate text bounds (actual measurement requires canvas context)
  const approximateRawWidth = mark.text.length * mark.fontSize * 0.6;
  const maxWidth =
    typeof mark.maxWidth === 'number' && Number.isFinite(mark.maxWidth) && mark.maxWidth > 0
      ? mark.maxWidth
      : undefined;
  const width =
    maxWidth !== undefined ? Math.min(approximateRawWidth, maxWidth) : approximateRawWidth;
  const lineCount =
    maxWidth !== undefined && maxWidth > 0
      ? Math.max(1, Math.ceil(approximateRawWidth / maxWidth))
      : 1;
  const lineHeight =
    typeof mark.lineHeight === 'number' && Number.isFinite(mark.lineHeight) && mark.lineHeight > 0
      ? mark.lineHeight
      : mark.fontSize * 1.2;
  const height = mark.fontSize + Math.max(0, lineCount - 1) * lineHeight;

  let x = mark.x;
  let y = mark.y;

  // Adjust based on alignment
  if (mark.textAlign === 'center') {
    x -= width / 2;
  } else if (mark.textAlign === 'right') {
    x -= width;
  }

  if (mark.textBaseline === 'middle') {
    y -= height / 2;
  } else if (mark.textBaseline === 'top') {
    // y is at top
  } else if (mark.textBaseline === 'bottom') {
    y -= height;
  }

  return { x, y, width, height };
}

function getPathBounds(mark: PathMark): BoundingBox {
  const commands = parsePath(mark.path);

  if (commands.length === 0) {
    return { x: mark.x, y: mark.y, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cmd of commands) {
    if ('x' in cmd) {
      minX = Math.min(minX, cmd.x);
      maxX = Math.max(maxX, cmd.x);
    }
    if ('y' in cmd) {
      minY = Math.min(minY, cmd.y);
      maxY = Math.max(maxY, cmd.y);
    }
    // Include control points for curves
    if ('x1' in cmd) {
      minX = Math.min(minX, cmd.x1);
      maxX = Math.max(maxX, cmd.x1);
    }
    if ('y1' in cmd) {
      minY = Math.min(minY, cmd.y1);
      maxY = Math.max(maxY, cmd.y1);
    }
    if ('x2' in cmd) {
      minX = Math.min(minX, cmd.x2);
      maxX = Math.max(maxX, cmd.x2);
    }
    if ('y2' in cmd) {
      minY = Math.min(minY, cmd.y2);
      maxY = Math.max(maxY, cmd.y2);
    }
  }

  if (!isFinite(minX)) {
    return { x: mark.x, y: mark.y, width: 0, height: 0 };
  }

  return {
    x: mark.x + minX,
    y: mark.y + minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// =============================================================================
// Mark Center Calculations
// =============================================================================

/**
 * Get the center point of a mark.
 */
export function getMarkCenter(mark: AnyMark): { x: number; y: number } {
  switch (mark.type) {
    case 'rect':
      return {
        x: mark.x + mark.width / 2,
        y: mark.y + mark.height / 2,
      };
    case 'arc':
      return getArcCentroid(mark);
    case 'symbol':
      return { x: mark.x, y: mark.y };
    case 'text':
      return { x: mark.x, y: mark.y };
    case 'path': {
      const bounds = getPathBounds(mark);
      return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
    }
    default:
      return { x: 0, y: 0 };
  }
}

// =============================================================================
// Point-in-Mark Testing
// =============================================================================

/**
 * Check if a point is inside a mark.
 */
export function pointInMark(x: number, y: number, mark: AnyMark): boolean {
  switch (mark.type) {
    case 'rect':
      return hitTestRect(mark, x, y);
    case 'arc':
      return hitTestArc(mark, x, y);
    case 'symbol':
      return hitTestSymbol(mark, x, y);
    case 'text':
      return pointInTextBounds(x, y, mark);
    case 'path':
      return pointInPathBounds(x, y, mark);
    default:
      return false;
  }
}

function pointInTextBounds(x: number, y: number, mark: TextMark): boolean {
  const bounds = getTextBounds(mark);
  return (
    x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  );
}

function pointInPathBounds(x: number, y: number, mark: PathMark): boolean {
  // Use bounding box for path hit testing (simplified)
  // For accurate path hit testing, we would need to use Canvas2D isPointInPath
  const bounds = getPathBounds(mark);
  return (
    x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  );
}

// =============================================================================
// Grid-Based Hit Tester Implementation
// =============================================================================

/**
 * Grid-based spatial index for efficient hit testing.
 *
 * Delegates to @mog/spatial GridSpatialIndex for the spatial indexing,
 * then applies mark-specific narrow-phase geometry tests.
 * Provides O(1) average-case point queries for uniformly distributed marks.
 */
export class GridHitTester implements HitTester {
  private readonly cellSize: number;
  private index: SpatialIndex<AnyMark>;
  private marks: AnyMark[] = [];
  private _bounds: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

  /**
   * Create a grid-based hit tester.
   *
   * @param cellSize - Size of each grid cell (default: 50 pixels)
   */
  constructor(cellSize: number = 50) {
    this.cellSize = cellSize;
    this.index = createSpatialIndex<AnyMark>(cellSize);
  }

  /**
   * Build the spatial index from an array of marks.
   */
  build(marks: AnyMark[]): void {
    this.clear();
    this.marks = marks;

    if (marks.length === 0) return;

    // Calculate overall bounds and insert marks into spatial index
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i];
      const b = getBoundingBox(mark);

      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);

      // Use index as string ID for the spatial index
      this.index.insert(String(i), b, mark);
    }

    this._bounds = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Find the closest mark at a point, optionally within a radius.
   *
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param radius - Search radius (default: 0, exact point)
   * @returns The closest hit result, or null if no mark was hit
   */
  hitTest(x: number, y: number, radius: number = 0): HitTestResult | null {
    const results = this.hitTestAll(x, y, radius);
    if (results.length === 0) return null;

    // Return the closest result
    return results.reduce((closest, current) =>
      current.distance < closest.distance ? current : closest,
    );
  }

  /**
   * Find all marks within a radius of a point.
   *
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param radius - Search radius (default: 0, exact point)
   * @returns Array of hit results, sorted by distance
   */
  hitTestAll(x: number, y: number, radius: number = 0): HitTestResult[] {
    const results: HitTestResult[] = [];
    const point = { x, y };

    if (radius > 0) {
      // Use findNearby from @mog/spatial for radius-based queries
      const nearby = findNearby(this.index, point, radius);
      const checked = new Set<string>();

      for (const { entry } of nearby) {
        if (checked.has(entry.id)) continue;
        checked.add(entry.id);

        const mark = entry.data;
        const center = getMarkCenter(mark);
        const dx = x - center.x;
        const dy = y - center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const inMark = pointInMark(x, y, mark);
        const withinRadius = distance <= radius;

        if (inMark || withinRadius) {
          results.push({
            mark,
            datum: mark.datum,
            distance: inMark ? 0 : distance,
          });
        }
      }

      // Also check exact point candidates (findNearby may miss items
      // whose bounding box edge-distance > radius but which contain the point)
      const pointCandidates = this.index.queryPoint(point);
      for (const entry of pointCandidates) {
        if (checked.has(entry.id)) continue;
        checked.add(entry.id);

        const mark = entry.data;
        if (pointInMark(x, y, mark)) {
          results.push({
            mark,
            datum: mark.datum,
            distance: 0,
          });
        }
      }
    } else {
      // Exact point query - use queryPoint from spatial index
      const candidates = this.index.queryPoint(point);

      for (const entry of candidates) {
        const mark = entry.data;

        // Narrow phase: check if point is actually in the mark
        if (pointInMark(x, y, mark)) {
          results.push({
            mark,
            datum: mark.datum,
            distance: 0,
          });
        }
      }
    }

    // Sort by distance
    results.sort((a, b) => a.distance - b.distance);

    return results;
  }

  /**
   * Clear the spatial index.
   */
  clear(): void {
    this.index.clear();
    this.marks = [];
    this._bounds = { x: 0, y: 0, width: 0, height: 0 };
  }

  /**
   * Get all indexed marks.
   */
  getMarks(): AnyMark[] {
    return this.marks;
  }

  /**
   * Get the overall bounds of all marks.
   */
  getBounds(): BoundingBox {
    return this._bounds;
  }

  /**
   * Get the grid cell size.
   */
  getCellSize(): number {
    return this.cellSize;
  }

  /**
   * Get the number of cells in the grid.
   */
  getCellCount(): number {
    // The spatial index doesn't expose cell count directly,
    // so we compute it from the bounds and cell size.
    if (this.marks.length === 0) return 0;
    const cols = Math.ceil(this._bounds.width / this.cellSize) + 1;
    const rows = Math.ceil(this._bounds.height / this.cellSize) + 1;
    return cols * rows;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a hit tester with the specified cell size.
 */
export function createHitTester(cellSize: number = 50): GridHitTester {
  return new GridHitTester(cellSize);
}
