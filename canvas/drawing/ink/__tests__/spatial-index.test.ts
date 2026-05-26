import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { SpatialIndex } from '../src/spatial-index';
import { createSpatialIndex } from '../src/spatial-index';

// =============================================================================
// Helpers
// =============================================================================

function box(x: number, y: number, w: number, h: number): BoundingBox {
  return { x, y, width: w, height: h };
}

function createPopulatedIndex(): SpatialIndex<string> {
  const idx = createSpatialIndex<string>(50);
  idx.insert('a', box(0, 0, 30, 30), 'itemA');
  idx.insert('b', box(40, 40, 30, 30), 'itemB');
  idx.insert('c', box(200, 200, 30, 30), 'itemC');
  return idx;
}

// =============================================================================
// Basic Operations
// =============================================================================

describe('SpatialIndex - basic operations', () => {
  test('starts empty', () => {
    const idx = createSpatialIndex<string>();
    expect(idx.size()).toBe(0);
    expect(idx.all()).toHaveLength(0);
  });

  test('insert increases size', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data');
    expect(idx.size()).toBe(1);
  });

  test('insert stores data correctly', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(5, 5, 20, 20), 'myData');
    const all = idx.all();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('a');
    expect(all[0].data).toBe('myData');
    expect(all[0].bounds).toEqual(box(5, 5, 20, 20));
  });

  test('insert multiple items', () => {
    const idx = createPopulatedIndex();
    expect(idx.size()).toBe(3);
  });

  test('remove decreases size', () => {
    const idx = createPopulatedIndex();
    idx.remove('a');
    expect(idx.size()).toBe(2);
  });

  test('remove non-existent id is no-op', () => {
    const idx = createPopulatedIndex();
    idx.remove('nonexistent');
    expect(idx.size()).toBe(3);
  });

  test('remove makes item unfindable', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data');
    idx.remove('a');
    const results = idx.query(box(0, 0, 10, 10));
    expect(results).toHaveLength(0);
  });

  test('clear empties the index', () => {
    const idx = createPopulatedIndex();
    idx.clear();
    expect(idx.size()).toBe(0);
    expect(idx.all()).toHaveLength(0);
  });
});

// =============================================================================
// Update
// =============================================================================

describe('SpatialIndex - update', () => {
  test('update changes bounds', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data');
    idx.updateBounds('a', box(100, 100, 10, 10));

    // Old location should not find it
    const old = idx.query(box(0, 0, 10, 10));
    expect(old).toHaveLength(0);

    // New location should find it
    const fresh = idx.query(box(95, 95, 20, 20));
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).toBe('a');
  });

  test('update non-existent id is no-op', () => {
    const idx = createSpatialIndex<string>();
    idx.updateBounds('nonexistent', box(0, 0, 10, 10));
    expect(idx.size()).toBe(0);
  });

  test('update preserves data', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'original');
    idx.updateBounds('a', box(50, 50, 10, 10));
    const all = idx.all();
    expect(all[0].data).toBe('original');
  });
});

// =============================================================================
// Query (rect)
// =============================================================================

describe('SpatialIndex - query rect', () => {
  test('finds items that overlap query', () => {
    const idx = createPopulatedIndex();
    const results = idx.query(box(10, 10, 50, 50));
    const ids = results.map((r) => r.id).sort();
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('c');
  });

  test('finds items fully inside query', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('x', box(10, 10, 5, 5), 'data');
    const results = idx.query(box(0, 0, 100, 100));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('x');
  });

  test('finds items that fully contain query', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('big', box(0, 0, 1000, 1000), 'data');
    const results = idx.query(box(50, 50, 10, 10));
    expect(results).toHaveLength(1);
  });

  test('returns empty for non-overlapping query', () => {
    const idx = createPopulatedIndex();
    const results = idx.query(box(500, 500, 10, 10));
    expect(results).toHaveLength(0);
  });

  test('finds items at exact boundary (edge-touching is intersecting)', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data');
    // Query touching the right edge - edge-touching IS intersecting (inclusive bounds, matching boxesOverlap)
    const results = idx.query(box(10, 0, 10, 10));
    expect(results).toHaveLength(1);
  });

  test('handles zero-size query (point inside box)', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 100, 100), 'data');
    // A zero-size query box at a point strictly inside another box still intersects
    const results = idx.query(box(50, 50, 0, 0));
    expect(results).toHaveLength(1);
  });
});

// =============================================================================
// Query Point
// =============================================================================

describe('SpatialIndex - queryPoint', () => {
  test('finds item containing point', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 100, 100), 'data');
    const results = idx.queryPoint({ x: 50, y: 50 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  test('returns empty when point outside all items', () => {
    const idx = createPopulatedIndex();
    const results = idx.queryPoint({ x: 500, y: 500 });
    expect(results).toHaveLength(0);
  });

  test('finds multiple overlapping items at point', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 100, 100), 'data1');
    idx.insert('b', box(50, 50, 100, 100), 'data2');
    const results = idx.queryPoint({ x: 75, y: 75 });
    expect(results).toHaveLength(2);
  });

  test('finds item at boundary point', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(10, 10, 20, 20), 'data');
    // Point at top-left corner
    const results = idx.queryPoint({ x: 10, y: 10 });
    expect(results).toHaveLength(1);
  });

  test('finds item at bottom-right corner', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(10, 10, 20, 20), 'data');
    const results = idx.queryPoint({ x: 30, y: 30 });
    expect(results).toHaveLength(1);
  });

  test('does not find item just outside boundary', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(10, 10, 20, 20), 'data');
    const results = idx.queryPoint({ x: 31, y: 31 });
    expect(results).toHaveLength(0);
  });
});

// =============================================================================
// Bulk Operations
// =============================================================================

describe('SpatialIndex - bulk operations', () => {
  test('handles many inserts and queries', () => {
    const idx = createSpatialIndex<number>(25);

    for (let i = 0; i < 100; i++) {
      idx.insert(`item-${i}`, box(i * 10, i * 10, 20, 20), i);
    }

    expect(idx.size()).toBe(100);

    // Query should find a subset
    const results = idx.query(box(0, 0, 50, 50));
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(100);
  });

  test('handles rapid insert/remove cycles', () => {
    const idx = createSpatialIndex<string>();
    for (let i = 0; i < 50; i++) {
      idx.insert(`item-${i}`, box(i, i, 10, 10), 'data');
    }
    for (let i = 0; i < 50; i++) {
      idx.remove(`item-${i}`);
    }
    expect(idx.size()).toBe(0);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('SpatialIndex - edge cases', () => {
  test('handles zero-size bounds', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('point', box(50, 50, 0, 0), 'data');
    expect(idx.size()).toBe(1);

    const results = idx.queryPoint({ x: 50, y: 50 });
    expect(results).toHaveLength(1);
  });

  test('handles very large bounds', () => {
    const idx = createSpatialIndex<string>(100);
    idx.insert('huge', box(-10000, -10000, 20000, 20000), 'data');
    expect(idx.size()).toBe(1);

    const results = idx.queryPoint({ x: 0, y: 0 });
    expect(results).toHaveLength(1);
  });

  test('handles negative coordinates', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('neg', box(-50, -50, 20, 20), 'data');
    const results = idx.queryPoint({ x: -40, y: -40 });
    expect(results).toHaveLength(1);
  });

  test('overlapping bounds inserted correctly', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 100, 100), 'data1');
    idx.insert('b', box(0, 0, 100, 100), 'data2');
    expect(idx.size()).toBe(2);

    const results = idx.queryPoint({ x: 50, y: 50 });
    expect(results).toHaveLength(2);
  });

  test('different cell sizes affect performance but not correctness', () => {
    const smallCell = createSpatialIndex<string>(10);
    const largeCell = createSpatialIndex<string>(200);

    for (let i = 0; i < 20; i++) {
      const b = box(i * 20, i * 20, 15, 15);
      smallCell.insert(`item-${i}`, b, 'data');
      largeCell.insert(`item-${i}`, b, 'data');
    }

    const q = box(50, 50, 100, 100);
    const smallResults = smallCell.query(q);
    const largeResults = largeCell.query(q);

    // Both should find the same items
    const smallIds = smallResults.map((r) => r.id).sort();
    const largeIds = largeResults.map((r) => r.id).sort();
    expect(smallIds).toEqual(largeIds);
  });
});

// =============================================================================
// all()
// =============================================================================

describe('SpatialIndex - all()', () => {
  test('returns all entries', () => {
    const idx = createPopulatedIndex();
    const all = idx.all();
    expect(all).toHaveLength(3);
    const ids = all.map((e) => e.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  test('returns empty array when empty', () => {
    const idx = createSpatialIndex<string>();
    expect(idx.all()).toEqual([]);
  });
});

describe('5ad tests', () => {
  test('oversized item found by query', () => {
    const idx = createSpatialIndex<string>(10);
    idx.insert('huge', box(-5000, -5000, 10000, 10000), 'big');
    expect(idx.query(box(0, 0, 10, 10))).toHaveLength(1);
  });
  test('oversized item found by queryPoint', () => {
    const idx = createSpatialIndex<string>(10);
    idx.insert('huge', box(-5000, -5000, 10000, 10000), 'big');
    expect(idx.queryPoint({ x: 0, y: 0 })).toHaveLength(1);
  });
  test('updateBounds normal to oversized', () => {
    const idx = createSpatialIndex<string>(10);
    idx.insert('a', box(0, 0, 5, 5), 'd');
    idx.updateBounds('a', box(-5000, -5000, 10000, 10000));
    expect(idx.queryPoint({ x: 0, y: 0 })).toHaveLength(1);
  });
  test('updateBounds oversized to normal', () => {
    const idx = createSpatialIndex<string>(10);
    idx.insert('a', box(-5000, -5000, 10000, 10000), 'd');
    idx.updateBounds('a', box(0, 0, 5, 5));
    expect(idx.queryPoint({ x: 2, y: 2 })).toHaveLength(1);
    expect(idx.queryPoint({ x: -4000, y: -4000 })).toHaveLength(0);
  });
  test('dup ID overwrites', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('dup', box(0, 0, 10, 10), 'first');
    idx.insert('dup', box(50, 50, 10, 10), 'second');
    expect(idx.size()).toBe(1);
    expect(idx.all()[0].data).toBe('second');
  });
  test('dup ID insert removes stale grid cells from old position', () => {
    const idx = createSpatialIndex<string>(50);
    // Insert at position (0,0)
    idx.insert('moving', box(0, 0, 10, 10), 'data');
    // Re-insert same ID at a far-away position (100,100)
    idx.insert('moving', box(100, 100, 10, 10), 'data');

    // Old position should NOT find the item
    expect(idx.query(box(0, 0, 10, 10))).toHaveLength(0);
    expect(idx.queryPoint({ x: 5, y: 5 })).toHaveLength(0);

    // New position SHOULD find the item
    expect(idx.query(box(100, 100, 10, 10))).toHaveLength(1);
    expect(idx.queryPoint({ x: 105, y: 105 })).toHaveLength(1);
    expect(idx.queryPoint({ x: 105, y: 105 })[0].id).toBe('moving');
  });
});
