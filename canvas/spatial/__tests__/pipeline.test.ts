import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { SpatialEntry, NarrowPhaseTest } from '../src/types';
import { createSpatialIndex } from '../src/grid-index';
import { hitTestPipeline, selectInRect, findNearby } from '../src/pipeline';

function box(x: number, y: number, w: number, h: number): BoundingBox {
  return { x, y, width: w, height: h };
}

// =============================================================================
// hitTestPipeline
// =============================================================================

describe('hitTestPipeline', () => {
  test('empty index returns null', () => {
    const idx = createSpatialIndex<{ z: number }>();
    const result = hitTestPipeline(idx, { x: 50, y: 50 }, (e) => e.data.z);
    expect(result).toBeNull();
  });

  test('single item returns it', () => {
    const idx = createSpatialIndex<{ z: number }>();
    idx.insert('a', box(0, 0, 100, 100), { z: 1 });
    const result = hitTestPipeline(idx, { x: 50, y: 50 }, (e) => e.data.z);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('a');
  });

  test('z-order priority: highest z wins', () => {
    const idx = createSpatialIndex<{ z: number }>();
    idx.insert('low', box(0, 0, 100, 100), { z: 1 });
    idx.insert('high', box(0, 0, 100, 100), { z: 10 });
    idx.insert('mid', box(0, 0, 100, 100), { z: 5 });

    const result = hitTestPipeline(idx, { x: 50, y: 50 }, (e) => e.data.z);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('high');
  });

  test('narrow-phase rejection skips to next candidate', () => {
    const idx = createSpatialIndex<{ z: number }>();
    idx.insert('top', box(0, 0, 100, 100), { z: 10 });
    idx.insert('bottom', box(0, 0, 100, 100), { z: 1 });

    // Narrow phase rejects 'top', accepts 'bottom'
    const narrowPhase: NarrowPhaseTest<{ z: number }> = {
      test(entry: SpatialEntry<{ z: number }>) {
        return entry.id !== 'top';
      },
    };

    const result = hitTestPipeline(idx, { x: 50, y: 50 }, (e) => e.data.z, narrowPhase);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('bottom');
  });

  test('all rejected returns null', () => {
    const idx = createSpatialIndex<{ z: number }>();
    idx.insert('a', box(0, 0, 100, 100), { z: 1 });
    idx.insert('b', box(0, 0, 100, 100), { z: 2 });

    const narrowPhase: NarrowPhaseTest<{ z: number }> = {
      test() {
        return false;
      },
    };

    const result = hitTestPipeline(idx, { x: 50, y: 50 }, (e) => e.data.z, narrowPhase);
    expect(result).toBeNull();
  });

  test('point outside all items returns null', () => {
    const idx = createSpatialIndex<{ z: number }>();
    idx.insert('a', box(0, 0, 10, 10), { z: 1 });
    const result = hitTestPipeline(idx, { x: 500, y: 500 }, (e) => e.data.z);
    expect(result).toBeNull();
  });
});

// =============================================================================
// selectInRect
// =============================================================================

describe('selectInRect', () => {
  test('intersects mode returns overlapping items', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 50, 50), 'A');
    idx.insert('b', box(40, 40, 50, 50), 'B');
    idx.insert('c', box(200, 200, 10, 10), 'C');

    const results = selectInRect(idx, box(20, 20, 40, 40), 'intersects');
    const ids = results.map((r) => r.id).sort();
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('c');
  });

  test('contains mode filters to fully contained', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('inside', box(10, 10, 20, 20), 'in');
    idx.insert('partial', box(40, 40, 50, 50), 'part');
    idx.insert('outside', box(200, 200, 10, 10), 'out');

    const results = selectInRect(idx, box(0, 0, 100, 100), 'contains');
    const ids = results.map((r) => r.id);
    expect(ids).toContain('inside');
    expect(ids).toContain('partial'); // 40+50=90 <= 100, fully inside
    expect(ids).not.toContain('outside');
  });

  test('contains mode excludes partially overlapping items', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('sticking-out', box(80, 80, 50, 50), 'data'); // extends to 130, beyond 100

    const results = selectInRect(idx, box(0, 0, 100, 100), 'contains');
    expect(results).toHaveLength(0);
  });
});

// =============================================================================
// findNearby
// =============================================================================

describe('findNearby', () => {
  test('returns items within radius sorted by distance', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('near', box(10, 10, 5, 5), 'N');
    idx.insert('far', box(40, 40, 5, 5), 'F');

    const results = findNearby(idx, { x: 0, y: 0 }, 100);
    expect(results.length).toBe(2);
    // 'near' should be closer (distance to nearest edge)
    expect(results[0].entry.id).toBe('near');
    expect(results[1].entry.id).toBe('far');
    // Distance should be ascending
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  test('excludes items beyond radius', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('close', box(5, 5, 5, 5), 'C');
    idx.insert('far', box(200, 200, 5, 5), 'F');

    const results = findNearby(idx, { x: 0, y: 0 }, 20);
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe('close');
  });

  test('empty result for far-away point', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data');

    const results = findNearby(idx, { x: 1000, y: 1000 }, 10);
    expect(results).toHaveLength(0);
  });

  test('distance is zero when point is inside bounding box', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 100, 100), 'data');

    const results = findNearby(idx, { x: 50, y: 50 }, 10);
    expect(results).toHaveLength(1);
    expect(results[0].distance).toBe(0);
  });
});
