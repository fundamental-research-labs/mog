/**
 * Spatial operations for floating objects.
 *
 * Pure functions that delegate to @mog/drawing-engine.
 * Extracted from FloatingObjectBridge to enable direct use
 * without a bridge instance.
 */

import {
  alignObjects,
  distributeObjects,
  bringForward as drawingBringForward,
  bringToFront as drawingBringToFront,
  createGroup as drawingCreateGroup,
  hitTest as drawingHitTest,
  selectInRect as drawingSelectInRect,
  sendBackward as drawingSendBackward,
  sendToBack as drawingSendToBack,
  ungroup as drawingUngroup,
  normalizeZOrder,
  resolveAnchor,
  snapToGrid,
  sortByZOrder,
  type AlignType,
  type Anchor,
  type CellDimensionLookup,
  type DistributeType,
  type GroupHierarchy,
  type SnapResult,
  type SpatialObject,
  type ZOrderedItem,
} from '@mog/drawing-engine';
import type { BoundingBox } from '@mog-sdk/contracts/geometry';

// =============================================================================
// Types
// =============================================================================

/** Z-order operation result. */
export interface ZOrderResult {
  /** Updated items with new zIndex values */
  items: ZOrderedItem[];
}

/** Hit test result. */
export interface BridgeHitTestResult {
  /** The object that was hit, or null */
  objectId: string | null;
}

// Re-export drawing-engine types for consumers
export type {
  AlignType,
  Anchor,
  CellDimensionLookup,
  DistributeType,
  GroupHierarchy,
  SnapResult,
  SpatialObject,
  ZOrderedItem,
};

// =============================================================================
// Z-Order Operations
// =============================================================================

/**
 * Reorder items so the target is at the front (highest z-index).
 *
 * Pure computation: takes items in, returns reordered items out.
 * The kernel is responsible for persisting the new zIndex values to the store.
 */
export function computeBringToFront(items: ZOrderedItem[], targetId: string): ZOrderResult {
  return { items: drawingBringToFront(items, targetId) };
}

/** Reorder items so the target is at the back (lowest z-index). */
export function computeSendToBack(items: ZOrderedItem[], targetId: string): ZOrderResult {
  return { items: drawingSendToBack(items, targetId) };
}

/** Move the target one step forward in z-order. */
export function computeBringForward(items: ZOrderedItem[], targetId: string): ZOrderResult {
  return { items: drawingBringForward(items, targetId) };
}

/** Move the target one step backward in z-order. */
export function computeSendBackward(items: ZOrderedItem[], targetId: string): ZOrderResult {
  return { items: drawingSendBackward(items, targetId) };
}

/** Normalize z-order values to be contiguous starting from 0. */
export function computeNormalizeZOrder(items: ZOrderedItem[]): ZOrderResult {
  return { items: normalizeZOrder(items) };
}

/** Sort items by their z-order. */
export function computeSortByZOrder(items: ZOrderedItem[]): ZOrderResult {
  return { items: sortByZOrder(items) };
}

// =============================================================================
// Grouping Operations
// =============================================================================

/**
 * Create a group using @mog/drawing-engine.
 *
 * @param hierarchy - Current group hierarchy
 * @param objectIds - IDs of objects to group (minimum 2)
 * @param bounds - Bounding box for the new group
 * @param idGenerator - Function to generate the group ID
 * @returns Updated hierarchy and the new group ID
 */
export function computeCreateGroup(
  hierarchy: GroupHierarchy,
  objectIds: string[],
  bounds: BoundingBox,
  idGenerator: () => string,
): { hierarchy: GroupHierarchy; groupId: string } {
  return drawingCreateGroup(hierarchy, objectIds, bounds, idGenerator);
}

/**
 * Ungroup using @mog/drawing-engine.
 *
 * @param hierarchy - Current group hierarchy
 * @param groupId - ID of the group to ungroup
 * @returns Updated hierarchy
 */
export function computeUngroup(hierarchy: GroupHierarchy, groupId: string): GroupHierarchy {
  return drawingUngroup(hierarchy, groupId);
}

// =============================================================================
// Hit Testing & Selection
// =============================================================================

/** Hit test against spatial objects using @mog/drawing-engine. */
export function computeHitTest(
  objects: SpatialObject[],
  x: number,
  y: number,
): BridgeHitTestResult {
  const hit = drawingHitTest(objects, { x, y });
  return { objectId: hit?.id ?? null };
}

/**
 * Select objects within a rectangle using @mog/drawing-engine.
 *
 * @param objects - Array of spatial objects to test
 * @param rect - Selection rectangle
 * @param mode - 'intersects' returns objects that overlap, 'contains' returns only fully enclosed
 */
export function computeSelectInRect(
  objects: SpatialObject[],
  rect: { x: number; y: number; width: number; height: number },
  mode: 'intersects' | 'contains' = 'intersects',
): string[] {
  const selected = drawingSelectInRect(objects, rect, mode);
  return selected.map((obj) => obj.id);
}

// =============================================================================
// Anchor & Grid
// =============================================================================

/**
 * Resolve an anchor to pixel coordinates using @mog/drawing-engine.
 *
 * This is where CellId -> {row, col} translation happens.
 * The kernel's CellId anchoring is translated to the drawing-engine's
 * row/col-based anchor resolution.
 */
export function resolveObjectAnchor(
  anchor: Anchor,
  cellDimensions: CellDimensionLookup,
): { x: number; y: number; width: number; height: number } | null {
  return resolveAnchor(anchor, cellDimensions);
}

/** Snap an object position to grid using @mog/drawing-engine. */
export function computeSnapToGrid(x: number, y: number, gridSize: number): SnapResult {
  return snapToGrid({ x, y }, gridSize);
}

// =============================================================================
// Alignment & Distribution
// =============================================================================

/** Align objects using @mog/drawing-engine. */
export function computeAlign(
  objects: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  alignType: AlignType,
) {
  const engineObjects = objects.map(({ id, x, y, width, height }) => ({
    id,
    bounds: { x, y, width, height },
  }));
  return alignObjects(engineObjects, alignType);
}

/** Distribute objects using @mog/drawing-engine. */
export function computeDistribute(
  objects: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  distributeType: DistributeType,
) {
  const engineObjects = objects.map(({ id, x, y, width, height }) => ({
    id,
    bounds: { x, y, width, height },
  }));
  return distributeObjects(engineObjects, distributeType);
}
