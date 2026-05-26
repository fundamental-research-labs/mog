/**
 * Cell Anchor Resolver
 *
 * The bridge between the cell grid coordinate system and the universal
 * pixel-based CanvasObjectPosition.
 *
 * THIS IS THE ONLY FILE in the entire system that performs cell-grid math:
 * - ObjectPosition.from (CellAnchor) -> (row, col) -> pixel bounds (resolveAnchorAsync)
 * - pixel (x, y, w, h) -> ObjectPosition with CellAnchor (fromPixelsAsync)
 * - ObjectPosition -> ObjectBounds (computeObjectBounds)
 * - Partial<ObjectPosition> -> ObjectPosition (normalizePosition)
 *
 * All operations are exported as standalone async functions that accept
 * CellAnchorResolverDeps (which wraps ComputeBridge).
 *
 * Uses ComputeBridge for dimension queries and CellId resolution.
 *
 * @see contracts/src/objects/floating-objects.ts - CellAnchor, ObjectPosition
 */

import { isProd } from '@mog/env';
import type { CanvasObjectPosition } from '@mog-sdk/contracts/canvas-object';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  CellAnchor,
  FloatingObject,
  ObjectPosition,
} from '@mog-sdk/contracts/floating-objects';

import type { ComputeBridge } from '../../bridges/compute/compute-bridge';

import { FloatingObjectError } from '../../errors/floating-object';
import type { ObjectBounds } from '../types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies required by cell anchor resolution functions.
 *
 * Uses ComputeBridge for dimension queries and CellId resolution.
 */
export interface CellAnchorResolverDeps {
  /** ComputeBridge for pixel calculations and CellId resolution */
  computeBridge: ComputeBridge | null;
}

// =============================================================================
// STANDALONE FUNCTIONS
// =============================================================================

/**
 * Convert absolute pixel position to a cell-anchored ObjectPosition (async).
 *
 * Uses ComputeBridge for dimension queries and CellId resolution.
 *
 * @param deps - Dependencies (computeBridge)
 * @param containerId - The document (sheet) for the position
 * @param x - Absolute X position in pixels
 * @param y - Absolute Y position in pixels
 * @param width - Object width in pixels
 * @param height - Object height in pixels
 * @returns ObjectPosition with cell anchor or absolute fallback
 */
export async function absoluteToAnchorPosition(
  deps: CellAnchorResolverDeps,
  containerId: SheetId,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<ObjectPosition> {
  const { computeBridge } = deps;

  if (!computeBridge) {
    const msg =
      '[CellAnchorResolver] INVARIANT VIOLATION: computeBridge must be set ' +
      'before converting absolute to anchor positions.';
    if (!isProd()) {
      throw new FloatingObjectError('OBJ_INVALID_CONFIG', 'position', msg);
    }
    console.error(msg);
    return {
      anchorType: 'absolute',
      from: { cellId: toCellId('__placeholder__'), xOffset: 0, yOffset: 0 },
      x,
      y,
      width,
      height,
    };
  }

  // Find the cell at position (x, y) via ComputeBridge
  const { col, xOffset } = await findColumnAtPixelAsync(computeBridge, containerId, x);
  const { row, yOffset } = await findRowAtPixelAsync(computeBridge, containerId, y);

  // Create CellId for the computed cell via ComputeBridge
  const cellId = await getOrCreateCellIdViaBridge(computeBridge, containerId, row, col);

  return {
    anchorType: 'oneCell',
    from: { cellId, xOffset, yOffset },
    width,
    height,
  };
}

/**
 * Compute the bounding box for a floating object in pixel coordinates (async).
 *
 * Uses ComputeBridge for dimension queries and CellId -> (row, col) resolution.
 *
 * NOTE: This function is NO LONGER used in the render pipeline. As of first-class range lifecycle/5,
 * the renderer receives pre-computed bounds from Rust via FloatingObjectChange.bounds
 * (for mutations) and computeAllObjectBounds (for sheet switch). This function is
 * still used by non-renderer callers: hit testing, drag-start capture, selection
 * bounds, group bounds, text editor overlays, etc.
 *
 * @param deps - Dependencies (computeBridge)
 * @param obj - The floating object to compute bounds for
 * @returns ObjectBounds with x, y, width, height, rotation, or null if bounds cannot be computed
 */
export async function computeObjectBounds(
  deps: CellAnchorResolverDeps,
  obj: FloatingObject,
): Promise<ObjectBounds | null> {
  const { computeBridge } = deps;
  const pos = obj.position;
  if (!pos) {
    return null;
  }

  // For absolute positioning, use direct coordinates
  if (pos.anchorType === 'absolute' && pos.x !== undefined && pos.y !== undefined) {
    return {
      x: pos.x,
      y: pos.y,
      width: pos.width ?? 100,
      height: pos.height ?? 100,
      rotation: pos.rotation ?? 0,
    };
  }

  // For cell-anchored, we need ComputeBridge
  if (!computeBridge) {
    const msg =
      '[CellAnchorResolver] INVARIANT VIOLATION: computeBridge must be set ' +
      'before computing object bounds.';
    if (!isProd()) {
      throw new FloatingObjectError('OBJ_INVALID_CONFIG', 'position', msg);
    }
    console.error(msg);
    return null;
  }

  const bridge = computeBridge;
  const containerId = obj.sheetId;

  // Resolve CellId -> (row, col) via ComputeBridge
  const fromPosition = await bridge.getCellPosition(containerId, pos.from.cellId);
  if (!fromPosition) {
    // CellId not found - anchor cell was deleted
    return null;
  }

  const fromRow = fromPosition.row;
  const fromCol = fromPosition.col;

  // Compute x, y from resolved position + offset via ComputeBridge
  const colLeft = await bridge.getColPosition(containerId, fromCol);
  const rowTop = await bridge.getRowPosition(containerId, fromRow);
  const x = colLeft + pos.from.xOffset;
  const y = rowTop + pos.from.yOffset;

  // Compute width, height
  let width: number;
  let height: number;

  if (pos.anchorType === 'twoCell' && pos.to) {
    // For two-cell anchor, resolve the 'to' CellId as well
    const toPosition = await bridge.getCellPosition(containerId, pos.to.cellId);
    if (!toPosition) {
      // End anchor cell was deleted - fall back to explicit dimensions
      width = pos.width ?? 100;
      height = pos.height ?? 100;
    } else {
      const toRow = toPosition.row;
      const toCol = toPosition.col;
      const toColLeft = await bridge.getColPosition(containerId, toCol);
      const toRowTop = await bridge.getRowPosition(containerId, toRow);
      const x2 = toColLeft + pos.to.xOffset;
      const y2 = toRowTop + pos.to.yOffset;
      width = x2 - x;
      height = y2 - y;
    }
  } else {
    // Use explicit dimensions
    width = pos.width ?? 100;
    height = pos.height ?? 100;
  }

  return {
    x,
    y,
    width,
    height,
    rotation: pos.rotation ?? 0,
  };
}

/**
 * Normalize a partial position configuration to a full ObjectPosition.
 *
 * This function does NOT require IPC — it uses a hardcoded default CellId
 * for the (0,0) anchor when no `from` is provided in the partial.
 *
 * @param _deps - Dependencies (unused, kept for API compatibility)
 * @param _containerId - The document containing the object (unused)
 * @param partial - Partial position configuration
 * @param defaultWidth - Default width if not specified
 * @param defaultHeight - Default height if not specified
 * @returns Complete ObjectPosition with all required fields
 */
export async function normalizePosition(
  _deps: CellAnchorResolverDeps,
  _containerId: SheetId,
  partial: Partial<ObjectPosition>,
  defaultWidth: number,
  defaultHeight: number,
): Promise<ObjectPosition> {
  const anchorType = partial.anchorType ?? 'oneCell';

  // Default anchor at (0,0) with a well-known CellId — no IPC needed.
  const defaultAnchor: CellAnchor = { cellId: toCellId('cell-0-0'), xOffset: 10, yOffset: 10 };

  return {
    anchorType,
    from: partial.from ?? defaultAnchor,
    to: partial.to,
    x: partial.x,
    y: partial.y,
    width: partial.width ?? defaultWidth,
    height: partial.height ?? defaultHeight,
    rotation: partial.rotation ?? 0,
    flipH: partial.flipH,
    flipV: partial.flipV,
  };
}

// =============================================================================
// STANDALONE ASYNC RESOLUTION FUNCTIONS
// =============================================================================

/**
 * Resolve an ObjectPosition anchor to pixel bounds (async).
 *
 * Extracts the `from` CellAnchor, resolves CellId -> (row, col) -> pixels
 * via ComputeBridge.
 *
 * @param deps - Dependencies (computeBridge)
 * @param containerId - Sheet/document containing the anchor
 * @param anchor - ObjectPosition with from.cellId and pixel offsets
 * @returns Pixel bounds, or null if the anchor cannot be resolved
 */
export async function resolveAnchorAsync(
  deps: CellAnchorResolverDeps,
  containerId: SheetId,
  anchor: ObjectPosition,
): Promise<CanvasObjectPosition | null> {
  const { computeBridge } = deps;

  if (!computeBridge) {
    return null;
  }

  const cellAnchor = anchor.from;

  // Resolve CellId -> (row, col) via ComputeBridge
  const cellPosition = await computeBridge.getCellPosition(containerId, cellAnchor.cellId);
  if (!cellPosition) {
    // CellId not found - anchor cell was deleted
    return null;
  }

  const { row, col } = cellPosition;

  // Convert (row, col) -> pixel position via ComputeBridge, then add anchor offsets
  const colLeft = await computeBridge.getColPosition(containerId, col);
  const rowTop = await computeBridge.getRowPosition(containerId, row);
  const x = colLeft + cellAnchor.xOffset;
  const y = rowTop + cellAnchor.yOffset;

  return { x, y, width: anchor.width ?? 0, height: anchor.height ?? 0 };
}

/**
 * Resolve a CellAnchor to pixel bounds (async).
 *
 * @param deps - Dependencies (computeBridge)
 * @param containerId - Sheet/document containing the anchor
 * @param cellAnchor - CellAnchor with cellId and pixel offsets
 * @returns Pixel bounds, or null if the anchor cannot be resolved
 */
export async function resolveCellAnchorAsync(
  deps: CellAnchorResolverDeps,
  containerId: SheetId,
  cellAnchor: CellAnchor,
): Promise<CanvasObjectPosition | null> {
  const { computeBridge } = deps;

  if (!computeBridge) {
    return null;
  }

  const cellPosition = await computeBridge.getCellPosition(containerId, cellAnchor.cellId);
  if (!cellPosition) {
    return null;
  }

  const { row, col } = cellPosition;

  const colLeft = await computeBridge.getColPosition(containerId, col);
  const rowTop = await computeBridge.getRowPosition(containerId, row);
  const x = colLeft + cellAnchor.xOffset;
  const y = rowTop + cellAnchor.yOffset;

  return { x, y, width: 0, height: 0 };
}

/**
 * Create an ObjectPosition from pixel coordinates (async).
 *
 * Uses ComputeBridge to find which cell contains the given (x, y) pixel
 * position, creates a CellId for that cell, and computes the pixel offset
 * from the cell's top-left corner.
 *
 * @param deps - Dependencies (computeBridge)
 * @param containerId - Sheet/document for the position
 * @param x - X position in pixels
 * @param y - Y position in pixels
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @returns ObjectPosition with a CellAnchor for the cell containing (x, y)
 * @throws Error if dependencies are not set (dev mode)
 */
export async function fromPixelsAsync(
  deps: CellAnchorResolverDeps,
  containerId: SheetId,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<ObjectPosition> {
  const { computeBridge } = deps;

  if (!computeBridge) {
    const msg = '[CellAnchorResolver] INVARIANT VIOLATION: computeBridge must be set.';
    if (!isProd()) {
      throw new FloatingObjectError('OBJ_INVALID_CONFIG', 'position', msg);
    }
    console.error(msg);
    return {
      anchorType: 'oneCell',
      from: { cellId: toCellId('__placeholder__'), xOffset: x, yOffset: y },
      width,
      height,
    };
  }

  // Find the column and row at pixel positions via ComputeBridge
  const { col, xOffset } = await findColumnAtPixelAsync(computeBridge, containerId, x);
  const { row, yOffset } = await findRowAtPixelAsync(computeBridge, containerId, y);

  // Create CellId for the resolved (row, col) via ComputeBridge
  const cellId = await getOrCreateCellIdViaBridge(computeBridge, containerId, row, col);

  return {
    anchorType: 'oneCell',
    from: { cellId, xOffset, yOffset },
    width,
    height,
  };
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Get or create a CellId for a (row, col) position via ComputeBridge.
 *
 * First tries getCellIdAt (read-only, fast), then falls back to
 * getOrCreateCellId (creates a marker cell if needed).
 *
 * @param bridge - ComputeBridge instance
 * @param containerId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns CellId
 */
async function getOrCreateCellIdViaBridge(
  bridge: ComputeBridge,
  containerId: SheetId,
  row: number,
  col: number,
): Promise<CellId> {
  // Try read-only lookup first (faster, no mutation)
  const existingId = await bridge.getCellIdAt(containerId, row, col);
  if (existingId) {
    return toCellId(existingId);
  }

  // Create marker cell — getOrCreateCellId returns MutationResult with .data = cellId
  const result = await bridge.getOrCreateCellId(containerId, row, col);
  return toCellId((result.data as string) ?? '__placeholder__');
}

// =============================================================================
// CELL GRID ITERATION HELPERS (async, using ComputeBridge)
// =============================================================================

/**
 * Find the column index and x-offset for a given pixel x-coordinate.
 *
 * Uses ComputeBridge.getColAtPixel() for efficient binary search in Rust,
 * then computes the offset within that column.
 *
 * @param bridge - ComputeBridge instance
 * @param containerId - Document (sheet) ID
 * @param x - X position in pixels
 * @returns Column index and pixel offset from column's left edge
 */
async function findColumnAtPixelAsync(
  bridge: ComputeBridge,
  containerId: SheetId,
  x: number,
): Promise<{ col: number; xOffset: number }> {
  const col = await bridge.getColAtPixel(containerId, x);
  const colLeft = await bridge.getColPosition(containerId, col);
  return { col, xOffset: x - colLeft };
}

/**
 * Find the row index and y-offset for a given pixel y-coordinate.
 *
 * Uses ComputeBridge.getRowAtPixel() for efficient binary search in Rust,
 * then computes the offset within that row.
 *
 * @param bridge - ComputeBridge instance
 * @param containerId - Document (sheet) ID
 * @param y - Y position in pixels
 * @returns Row index and pixel offset from row's top edge
 */
async function findRowAtPixelAsync(
  bridge: ComputeBridge,
  containerId: SheetId,
  y: number,
): Promise<{ row: number; yOffset: number }> {
  const row = await bridge.getRowAtPixel(containerId, y);
  const rowTop = await bridge.getRowPosition(containerId, row);
  return { row, yOffset: y - rowTop };
}
