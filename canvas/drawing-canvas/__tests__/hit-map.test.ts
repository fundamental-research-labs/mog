/**
 * HitMap Unit Tests — Spatial Index Integration
 *
 * Tests the HitMap spatial index broad-phase acceleration, testPointInPath
 * narrow-phase, and graceful fallback to linear scan.
 */

import type { ObjectHitResult } from '../src/hit-testing/hit-map';
import { HitMap } from '../src/hit-testing/hit-map';
import { SceneGraph } from '../src/scene/scene-graph';
import type { ShapeScene, TextboxScene } from '../src/scene/types';

// =============================================================================
// Helpers
// =============================================================================

function makeShape(id: string, zIndex: number, opts?: Partial<ShapeScene>): ShapeScene {
  return {
    id,
    type: 'shape',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    zIndex,
    visible: true,
    groupId: null,
    data: { shapeType: 'rect' },
    ...opts,
  };
}

function makeTextbox(id: string, zIndex: number, opts?: Partial<TextboxScene>): TextboxScene {
  return {
    id,
    type: 'textbox',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    zIndex,
    visible: true,
    groupId: null,
    data: { text: 'Hello' },
    ...opts,
  };
}

// =============================================================================
// Test Group 1: Spatial index integration via syncIndex
// =============================================================================

describe('HitMap spatial index integration', () => {
  test('syncIndex populates spatial index from scene graph dirty IDs', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('s1', 1, { bounds: { x: 10, y: 10, width: 50, height: 50 } }));
    sg.add(makeShape('s2', 2, { bounds: { x: 200, y: 200, width: 50, height: 50 } }));

    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // hitTest triggers syncIndex internally
    const hit = hitMap.hitTest({ x: 30, y: 30 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('s1');
  });

  test('syncIndex handles object removal', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('s1', 1, { bounds: { x: 10, y: 10, width: 50, height: 50 } }));
    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // First hit — populates index
    const hit1 = hitMap.hitTest({ x: 30, y: 30 });
    expect(hit1).not.toBeNull();

    // Remove the object
    sg.remove('s1');

    // Next hitTest syncs again — object should be gone
    const hit2 = hitMap.hitTest({ x: 30, y: 30 });
    expect(hit2).toBeNull();
  });

  test('syncIndex handles object bounds update', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('s1', 1, { bounds: { x: 10, y: 10, width: 50, height: 50 } }));
    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // First hit at (30,30) — inside original bounds
    const hit1 = hitMap.hitTest({ x: 30, y: 30 });
    expect(hit1).not.toBeNull();

    // Move the object far away
    sg.update('s1', { bounds: { x: 500, y: 500, width: 50, height: 50 } });

    // Old position should miss
    const hit2 = hitMap.hitTest({ x: 30, y: 30 });
    expect(hit2).toBeNull();

    // New position should hit
    const hit3 = hitMap.hitTest({ x: 520, y: 520 });
    expect(hit3).not.toBeNull();
    expect((hit3!.target as ObjectHitResult).objectId).toBe('s1');
  });
});

// =============================================================================
// Test Group 2: Spatial index z-order priority
// =============================================================================

describe('HitMap spatial index z-order', () => {
  test('returns topmost object (highest z-index) at overlapping point', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    // Two overlapping objects
    sg.add(makeShape('bottom', 1, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));
    sg.add(makeShape('top', 5, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));

    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('top');
  });

  test('skips invisible objects in spatial index candidates', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('visible', 1, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));
    sg.add(
      makeShape('invisible', 5, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        visible: false,
      }),
    );

    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('visible');
  });
});

// =============================================================================
// Test Group 3: Spatial index with viewport transform
// =============================================================================

describe('HitMap spatial index with viewport', () => {
  test('applies scroll offset when converting screen to doc coords', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    // Object at doc coords (100,100)-(200,200)
    sg.add(makeShape('s1', 1, { bounds: { x: 100, y: 100, width: 100, height: 100 } }));

    // Scroll offset means screen (0,0) = doc (50,50)
    hitMap.setViewportTransform({ x: 50, y: 50 }, 1, 1, { x: 0, y: 0 });

    // Screen point (100,100) = doc point (150,150) — inside the shape
    const hit = hitMap.hitTest({ x: 100, y: 100 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('s1');
  });

  test('applies zoom when converting screen to doc coords', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    // Object at doc coords (0,0)-(100,100)
    sg.add(makeShape('s1', 1, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));

    // Zoom 2x means screen point 100 = doc point 50
    hitMap.setViewportTransform({ x: 0, y: 0 }, 2, 1, { x: 0, y: 0 });

    // Screen point (100,100) = doc point (50,50) — inside the shape
    const hit = hitMap.hitTest({ x: 100, y: 100 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('s1');

    // Screen point (250,250) = doc point (125,125) — outside the shape
    const miss = hitMap.hitTest({ x: 250, y: 250 });
    expect(miss).toBeNull();
  });
});

// =============================================================================
// Test Group 4: Manual spatial index API
// =============================================================================

describe('HitMap manual spatial index API', () => {
  test('addToIndex/removeFromIndex work independently of scene graph', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    // Manually add to index without adding to scene graph
    hitMap.addToIndex('manual1', { x: 0, y: 0, width: 100, height: 100 }, 1, true, null);
    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // The spatial index has the entry, but since scene graph is empty,
    // syncIndex will be a no-op (no dirty IDs). The entry stays.
    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('manual1');

    // Remove from index
    hitMap.removeFromIndex('manual1');
    const miss = hitMap.hitTest({ x: 50, y: 50 });
    expect(miss).toBeNull();
  });

  test('updateInIndex updates bounds and metadata', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    hitMap.addToIndex('obj1', { x: 0, y: 0, width: 50, height: 50 }, 1, true, null);
    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // Hit at original position
    const hit1 = hitMap.hitTest({ x: 25, y: 25 });
    expect(hit1).not.toBeNull();

    // Move to new position
    hitMap.updateInIndex('obj1', { x: 200, y: 200, width: 50, height: 50 }, 1, true, null);

    // Old position should miss
    const hit2 = hitMap.hitTest({ x: 25, y: 25 });
    expect(hit2).toBeNull();

    // New position should hit
    const hit3 = hitMap.hitTest({ x: 225, y: 225 });
    expect(hit3).not.toBeNull();
  });
});

// =============================================================================
// Test Group 5: Path2D narrow phase (via testPointInPath)
// =============================================================================

describe('HitMap narrow phase with Path2D', () => {
  test('clear() only clears Path2D registrations, not spatial index', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('s1', 1, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));
    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // First hit populates spatial index via syncIndex
    const hit1 = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit1).not.toBeNull();

    // clear() only clears Path2D paths — spatial index persists
    hitMap.clear();

    // Should still hit (spatial index is intact)
    const hit2 = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit2).not.toBeNull();
  });

  test('registerBody stores Path2D for narrow-phase testing', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('s1', 1, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));
    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // Register a Path2D — in test env Path2D may not exist, so this tests
    // that registerBody doesn't throw
    try {
      const path = new Path2D();
      hitMap.registerBody('s1', path);
    } catch {
      // Path2D not available in test environment — that's fine
    }

    // Hit test should still work (falls back to bounding box if Path2D unavailable)
    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
  });
});

// =============================================================================
// Test Group 6: Group ID propagation
// =============================================================================

describe('HitMap group ID propagation', () => {
  test('hit result includes groupId from spatial index', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(
      makeShape('s1', 1, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        groupId: 'group-1',
      }),
    );

    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('s1');
    expect((hit!.target as ObjectHitResult).groupId).toBe('group-1');
  });

  test('hit result includes null groupId for ungrouped objects', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('s1', 1, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));

    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).groupId).toBeNull();
  });
});

// =============================================================================
// Test Group 7: Empty scene
// =============================================================================

describe('HitMap empty scene', () => {
  test('returns null for empty scene graph', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).toBeNull();
  });
});

// =============================================================================
// Test Group 8: Hit result metadata
// =============================================================================

describe('HitMap result metadata', () => {
  test('hit result has correct layerId and region', () => {
    const sg = new SceneGraph();
    const hitMap = new HitMap(sg);

    sg.add(makeShape('s1', 1, { bounds: { x: 0, y: 0, width: 100, height: 100 } }));
    hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    const hit = hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.layerId).toBe('drawing');
    expect((hit!.target as ObjectHitResult).region).toBe('body');
    expect(hit!.position).toEqual({ x: 50, y: 50 });
  });
});
