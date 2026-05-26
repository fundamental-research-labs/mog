/**
 * Z-Order Management for Floating Objects
 *
 * Pure computation logic for managing the z-order (stacking order) of floating objects.
 * Extracted from kernel/src/floating-objects/operations/z-order.ts - all Yjs operations removed.
 *
 * Each sheet maintains its own z-order stack. Objects in different sheets are independent.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Minimal interface for items participating in z-order.
 */
export interface ZOrderedItem {
  id: string;
  zIndex: number;
}

// =============================================================================
// QUERY OPERATIONS
// =============================================================================

/**
 * Get items sorted by z-index in ascending order (lowest first / back-to-front).
 */
export function sortByZOrder(items: ZOrderedItem[]): ZOrderedItem[] {
  return [...items].sort((a, b) => a.zIndex - b.zIndex);
}

// =============================================================================
// MUTATION OPERATIONS
// =============================================================================

/**
 * Move an item to the front (highest z-index).
 * Returns a new array with updated z-indices.
 * If the item is already at the front, returns items unchanged.
 */
export function bringToFront(items: ZOrderedItem[], targetId: string): ZOrderedItem[] {
  const target = items.find((item) => item.id === targetId);
  if (!target) return items;

  const maxZ = items.reduce((max, i) => Math.max(max, i.zIndex), -Infinity);
  if (target.zIndex >= maxZ) {
    // Already at front
    return items;
  }

  const updated = items.map((item) =>
    item.id === targetId ? { ...item, zIndex: maxZ + 1 } : item,
  );
  return normalizeZOrder(updated);
}

/**
 * Move an item to the back (lowest z-index).
 * Returns a new array with updated z-indices.
 * If the item is already at the back, returns items unchanged.
 */
export function sendToBack(items: ZOrderedItem[], targetId: string): ZOrderedItem[] {
  const target = items.find((item) => item.id === targetId);
  if (!target) return items;

  const minZ = items.reduce((min, i) => Math.min(min, i.zIndex), Infinity);
  if (target.zIndex <= minZ) {
    // Already at back
    return items;
  }

  const updated = items.map((item) =>
    item.id === targetId ? { ...item, zIndex: minZ - 1 } : item,
  );
  return normalizeZOrder(updated);
}

/**
 * Move an item one step forward in z-order (swap with the item directly above it).
 * If the item is already at the front, returns items unchanged.
 */
export function bringForward(items: ZOrderedItem[], targetId: string): ZOrderedItem[] {
  const normalized = normalizeZOrder(items);
  const target = normalized.find((item) => item.id === targetId);
  if (!target) return items;

  const sorted = [...normalized].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((item) => item.id === targetId);
  if (idx >= sorted.length - 1) return items;

  // Swap with next
  const next = sorted[idx + 1];
  return normalized.map((item) => {
    if (item.id === target.id) return { ...item, zIndex: next.zIndex };
    if (item.id === next.id) return { ...item, zIndex: target.zIndex };
    return item;
  });
}

/**
 * Move an item one step backward in z-order (swap with the item directly below it).
 * If the item is already at the back, returns items unchanged.
 */
export function sendBackward(items: ZOrderedItem[], targetId: string): ZOrderedItem[] {
  const normalized = normalizeZOrder(items);
  const target = normalized.find((item) => item.id === targetId);
  if (!target) return items;

  const sorted = [...normalized].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((item) => item.id === targetId);
  if (idx <= 0) return items;

  // Swap with previous
  const prev = sorted[idx - 1];
  return normalized.map((item) => {
    if (item.id === target.id) return { ...item, zIndex: prev.zIndex };
    if (item.id === prev.id) return { ...item, zIndex: target.zIndex };
    return item;
  });
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Normalize z-indices to be contiguous starting from 0 (0, 1, 2, ...).
 * Preserves relative order. Useful after deleting objects to remove gaps.
 */
export function normalizeZOrder(items: ZOrderedItem[]): ZOrderedItem[] {
  if (items.length === 0) return [];

  // Check for duplicate IDs
  const seenIds = new Set<string>();
  for (const item of items) {
    if (seenIds.has(item.id)) {
      throw new Error(
        `normalizeZOrder: duplicate ID "${item.id}" found. All items must have unique IDs.`,
      );
    }
    seenIds.add(item.id);
  }

  // Stable sort: use original index as tiebreaker for equal z-indices
  const indexed = items.map((item, i) => ({ item, origIdx: i }));
  indexed.sort((a, b) => a.item.zIndex - b.item.zIndex || a.origIdx - b.origIdx);

  // Check if normalization is needed
  const needsNormalization = indexed.some(({ item }, index) => item.zIndex !== index);
  if (!needsNormalization) return items;

  // Build a mapping from old id to new z-index
  const newZMap = new Map<string, number>();
  indexed.forEach(({ item }, index) => {
    newZMap.set(item.id, index);
  });

  return items.map((item) => ({
    ...item,
    zIndex: newZMap.get(item.id)!,
  }));
}

/**
 * Insert a new item at its specified z-index position.
 * Shifts existing items at or above the target z-index up by 1.
 */
export function insertAtZIndex(items: ZOrderedItem[], newItem: ZOrderedItem): ZOrderedItem[] {
  const shifted = items.map((item) =>
    item.zIndex >= newItem.zIndex ? { ...item, zIndex: item.zIndex + 1 } : item,
  );
  return [...shifted, { ...newItem }];
}

/**
 * Remove an item from the z-order and normalize the remaining indices.
 */
export function removeFromZOrder(items: ZOrderedItem[], targetId: string): ZOrderedItem[] {
  const filtered = items.filter((item) => item.id !== targetId);
  return normalizeZOrder(filtered);
}
