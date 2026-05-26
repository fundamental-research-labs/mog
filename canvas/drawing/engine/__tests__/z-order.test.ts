/**
 * Z-Order Management Tests
 */
import type { ZOrderedItem } from '../src/z-order/z-order-manager';
import {
  bringForward,
  bringToFront,
  insertAtZIndex,
  normalizeZOrder,
  removeFromZOrder,
  sendBackward,
  sendToBack,
  sortByZOrder,
} from '../src/z-order/z-order-manager';

// =============================================================================
// HELPERS
// =============================================================================

function makeItems(...ids: [string, number][]): ZOrderedItem[] {
  return ids.map(([id, zIndex]) => ({ id, zIndex }));
}

function zOf(items: ZOrderedItem[], id: string): number {
  return items.find((i) => i.id === id)!.zIndex;
}

// =============================================================================
// sortByZOrder
// =============================================================================

describe('sortByZOrder', () => {
  it('should sort items by z-index ascending', () => {
    const items = makeItems(['c', 3], ['a', 1], ['b', 2]);
    const sorted = sortByZOrder(items);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('should handle empty array', () => {
    expect(sortByZOrder([])).toEqual([]);
  });

  it('should handle single item', () => {
    const items = makeItems(['a', 5]);
    const sorted = sortByZOrder(items);
    expect(sorted).toEqual([{ id: 'a', zIndex: 5 }]);
  });

  it('should not mutate original array', () => {
    const items = makeItems(['c', 3], ['a', 1]);
    const sorted = sortByZOrder(items);
    expect(items[0].id).toBe('c'); // original unchanged
    expect(sorted[0].id).toBe('a');
  });
});

// =============================================================================
// bringToFront
// =============================================================================

describe('bringToFront', () => {
  it('should move item to front and normalize', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = bringToFront(items, 'a');
    // After normalization: b=0, c=1, a=2
    expect(zOf(result, 'a')).toBe(2);
    expect(zOf(result, 'b')).toBe(0);
    expect(zOf(result, 'c')).toBe(1);
  });

  it('should not change if already at front', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = bringToFront(items, 'c');
    // c is already at front, so items should be unchanged
    expect(result).toBe(items);
  });

  it('should handle non-existent ID', () => {
    const items = makeItems(['a', 0]);
    const result = bringToFront(items, 'nonexistent');
    expect(result).toBe(items);
  });

  it('should handle single item', () => {
    const items = makeItems(['a', 0]);
    const result = bringToFront(items, 'a');
    expect(result).toBe(items); // already at front
  });

  it('should work with non-contiguous z-indices', () => {
    const items = makeItems(['a', 0], ['b', 5], ['c', 10]);
    const result = bringToFront(items, 'a');
    // After normalization: b=0, c=1, a=2
    expect(zOf(result, 'a')).toBe(2);
    expect(zOf(result, 'b')).toBe(0);
    expect(zOf(result, 'c')).toBe(1);
  });
});

// =============================================================================
// sendToBack
// =============================================================================

describe('sendToBack', () => {
  it('should move item to back and normalize', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = sendToBack(items, 'c');
    // After normalization: c=0, a=1, b=2
    expect(zOf(result, 'c')).toBe(0);
    expect(zOf(result, 'a')).toBe(1);
    expect(zOf(result, 'b')).toBe(2);
  });

  it('should not change if already at back', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = sendToBack(items, 'a');
    expect(result).toBe(items);
  });

  it('should handle non-existent ID', () => {
    const items = makeItems(['a', 0]);
    const result = sendToBack(items, 'nonexistent');
    expect(result).toBe(items);
  });

  it('should handle single item', () => {
    const items = makeItems(['a', 5]);
    const result = sendToBack(items, 'a');
    expect(result).toBe(items);
  });
});

// =============================================================================
// bringForward
// =============================================================================

describe('bringForward', () => {
  it('should swap with item directly above', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = bringForward(items, 'a');
    expect(zOf(result, 'a')).toBe(1);
    expect(zOf(result, 'b')).toBe(0);
    expect(zOf(result, 'c')).toBe(2);
  });

  it('should not change if already at front', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = bringForward(items, 'c');
    expect(result).toBe(items);
  });

  it('should handle non-existent ID', () => {
    const items = makeItems(['a', 0]);
    const result = bringForward(items, 'nonexistent');
    expect(result).toBe(items);
  });

  it('should handle gap in z-indices', () => {
    const items = makeItems(['a', 0], ['b', 5], ['c', 10]);
    const result = bringForward(items, 'a');
    // After normalization: a:0, b:1, c:2, then swap a and b
    expect(zOf(result, 'a')).toBe(1);
    expect(zOf(result, 'b')).toBe(0);
  });

  it('should swap middle with top', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = bringForward(items, 'b');
    expect(zOf(result, 'b')).toBe(2);
    expect(zOf(result, 'c')).toBe(1);
    expect(zOf(result, 'a')).toBe(0);
  });
});

// =============================================================================
// sendBackward
// =============================================================================

describe('sendBackward', () => {
  it('should swap with item directly below', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = sendBackward(items, 'c');
    expect(zOf(result, 'c')).toBe(1);
    expect(zOf(result, 'b')).toBe(2);
    expect(zOf(result, 'a')).toBe(0);
  });

  it('should not change if already at back', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = sendBackward(items, 'a');
    expect(result).toBe(items);
  });

  it('should handle non-existent ID', () => {
    const items = makeItems(['a', 0]);
    const result = sendBackward(items, 'nonexistent');
    expect(result).toBe(items);
  });

  it('should swap middle with bottom', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = sendBackward(items, 'b');
    expect(zOf(result, 'b')).toBe(0);
    expect(zOf(result, 'a')).toBe(1);
    expect(zOf(result, 'c')).toBe(2);
  });
});

// =============================================================================
// normalizeZOrder
// =============================================================================

describe('normalizeZOrder', () => {
  it('should normalize z-indices to 0, 1, 2, ...', () => {
    const items = makeItems(['a', 5], ['b', 10], ['c', 15]);
    const result = normalizeZOrder(items);
    expect(zOf(result, 'a')).toBe(0);
    expect(zOf(result, 'b')).toBe(1);
    expect(zOf(result, 'c')).toBe(2);
  });

  it('should preserve relative order', () => {
    const items = makeItems(['c', 100], ['a', 1], ['b', 50]);
    const result = normalizeZOrder(items);
    const sorted = sortByZOrder(result);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('should not change already normalized items', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = normalizeZOrder(items);
    expect(result).toBe(items); // same reference if no change needed
  });

  it('should handle empty array', () => {
    expect(normalizeZOrder([])).toEqual([]);
  });

  it('should handle negative z-indices', () => {
    const items = makeItems(['a', -5], ['b', 0], ['c', 10]);
    const result = normalizeZOrder(items);
    expect(zOf(result, 'a')).toBe(0);
    expect(zOf(result, 'b')).toBe(1);
    expect(zOf(result, 'c')).toBe(2);
  });
});

// =============================================================================
// insertAtZIndex
// =============================================================================

describe('insertAtZIndex', () => {
  it('should insert at specified z-index and shift others', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = insertAtZIndex(items, { id: 'new', zIndex: 1 });
    expect(result.length).toBe(4);
    expect(zOf(result, 'new')).toBe(1);
    expect(zOf(result, 'a')).toBe(0);
    expect(zOf(result, 'b')).toBe(2);
    expect(zOf(result, 'c')).toBe(3);
  });

  it('should insert at end', () => {
    const items = makeItems(['a', 0], ['b', 1]);
    const result = insertAtZIndex(items, { id: 'new', zIndex: 5 });
    expect(result.length).toBe(3);
    expect(zOf(result, 'new')).toBe(5);
    expect(zOf(result, 'a')).toBe(0);
    expect(zOf(result, 'b')).toBe(1);
  });

  it('should insert into empty array', () => {
    const result = insertAtZIndex([], { id: 'new', zIndex: 0 });
    expect(result).toEqual([{ id: 'new', zIndex: 0 }]);
  });
});

// =============================================================================
// removeFromZOrder
// =============================================================================

describe('removeFromZOrder', () => {
  it('should remove and normalize', () => {
    const items = makeItems(['a', 0], ['b', 1], ['c', 2]);
    const result = removeFromZOrder(items, 'b');
    expect(result.length).toBe(2);
    expect(zOf(result, 'a')).toBe(0);
    expect(zOf(result, 'c')).toBe(1);
  });

  it('should handle removing non-existent ID', () => {
    const items = makeItems(['a', 0], ['b', 1]);
    const result = removeFromZOrder(items, 'nonexistent');
    expect(result.length).toBe(2);
  });

  it('should handle removing last item', () => {
    const items = makeItems(['a', 0]);
    const result = removeFromZOrder(items, 'a');
    expect(result).toEqual([]);
  });

  it('should normalize after removal', () => {
    const items = makeItems(['a', 0], ['b', 5], ['c', 10]);
    const result = removeFromZOrder(items, 'b');
    expect(zOf(result, 'a')).toBe(0);
    expect(zOf(result, 'c')).toBe(1);
  });
});
