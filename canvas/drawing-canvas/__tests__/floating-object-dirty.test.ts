/**
 * Floating Object Dirty Rect Tests
 *
 * Tests that floating object changes (add, remove, move, resize) produce
 * correct per-object dirty rects through the SceneGraph → DrawingLayer pipeline,
 * instead of full-layer invalidation.
 * @module drawing-canvas/__tests__/floating-object-dirty
 */

import type { DirtyHint, DocSpaceRect, Rect } from '@mog/canvas-engine';
import { DirtyRectAccumulator } from '@mog/canvas-engine';
import { SceneGraph } from '../src/scene/scene-graph';
import type { PictureScene, ShapeScene } from '../src/scene/types';

// =============================================================================
// Helpers
// =============================================================================

function makePicture(id: string, bounds: Rect, zIndex = 0): PictureScene {
  return {
    id,
    type: 'picture',
    bounds,
    zIndex,
    visible: true,
    groupId: null,
    data: { src: 'test.png', naturalWidth: 100, naturalHeight: 100 },
  };
}

function makeShape(id: string, bounds: Rect, zIndex = 0): ShapeScene {
  return {
    id,
    type: 'shape',
    bounds,
    zIndex,
    visible: true,
    groupId: null,
    data: { shapeType: 'rect' },
  };
}

/**
 * Simulate the factory wiring: SceneGraph onDirty callback feeds bounds
 * into a DirtyRectAccumulator via DirtyHint, mirroring the production
 * DrawingLayer's markDirty() method.
 */
function createWiredGraph() {
  const accumulator = new DirtyRectAccumulator();
  const hints: DirtyHint[] = [];

  const sceneGraph = new SceneGraph((affectedBounds) => {
    let hint: DirtyHint;
    if (affectedBounds.length === 0) {
      hint = { type: 'full' };
    } else {
      hint = { type: 'rects', bounds: affectedBounds as DocSpaceRect[] };
    }
    hints.push(hint);
    accumulator.add(hint);
  });

  return { sceneGraph, accumulator, hints };
}

// =============================================================================
// Tests
// =============================================================================

describe('Floating object dirty rect tracking', () => {
  // ===========================================================================
  // Single object operations
  // ===========================================================================

  describe('object add', () => {
    it('dirty rect equals new object bounds', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      const bounds: Rect = { x: 100, y: 200, width: 300, height: 150 };
      sceneGraph.add(makePicture('pic1', bounds));

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(false);

      const rects = accumulator.getRects();
      expect(rects).toHaveLength(1);
      expect(rects[0]).toEqual(bounds);
    });
  });

  describe('object delete', () => {
    it('dirty rect equals old object bounds', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      const bounds: Rect = { x: 50, y: 60, width: 200, height: 100 };
      sceneGraph.add(makePicture('pic1', bounds));
      accumulator.clear();

      sceneGraph.remove('pic1');

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(false);

      const rects = accumulator.getRects();
      expect(rects).toHaveLength(1);
      expect(rects[0]).toEqual(bounds);
    });
  });

  describe('object move', () => {
    it('dirty rects cover old + new bounds', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      const oldBounds: Rect = { x: 100, y: 100, width: 200, height: 150 };
      const newBounds: Rect = { x: 400, y: 300, width: 200, height: 150 };

      sceneGraph.add(makePicture('pic1', oldBounds));
      accumulator.clear();

      // Move via update
      sceneGraph.update('pic1', { bounds: newBounds });

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(false);

      const rects = accumulator.getRects();
      expect(rects).toHaveLength(2);
      expect(rects[0]).toEqual(oldBounds);
      expect(rects[1]).toEqual(newBounds);
    });
  });

  describe('object resize', () => {
    it('dirty rects cover old + new bounds when size changes', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      const oldBounds: Rect = { x: 100, y: 100, width: 200, height: 150 };
      const newBounds: Rect = { x: 100, y: 100, width: 400, height: 300 };

      sceneGraph.add(makeShape('shape1', oldBounds));
      accumulator.clear();

      sceneGraph.update('shape1', { bounds: newBounds });

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(false);

      const rects = accumulator.getRects();
      expect(rects).toHaveLength(2);
      expect(rects[0]).toEqual(oldBounds);
      expect(rects[1]).toEqual(newBounds);
    });
  });

  describe('visual-only update (no bounds change)', () => {
    it('dirty rect equals existing bounds (single rect)', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      const bounds: Rect = { x: 50, y: 50, width: 100, height: 100 };
      sceneGraph.add(makeShape('shape1', bounds));
      accumulator.clear();

      // Visual-only change (visibility) — bounds don't change
      sceneGraph.update('shape1', { visible: false });

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(false);

      const rects = accumulator.getRects();
      // Only old bounds (since new bounds identical, not duplicated)
      expect(rects).toHaveLength(1);
      expect(rects[0]).toEqual(bounds);
    });
  });

  // ===========================================================================
  // Multiple object changes
  // ===========================================================================

  describe('multiple objects changed', () => {
    it('union of affected bounds from all changes', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      const bounds1: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const bounds2: Rect = { x: 500, y: 500, width: 200, height: 200 };
      const newBounds2: Rect = { x: 600, y: 600, width: 200, height: 200 };

      sceneGraph.add(makePicture('pic1', bounds1));
      sceneGraph.add(makeShape('shape1', bounds2));
      accumulator.clear();

      // Delete pic1, move shape1
      sceneGraph.remove('pic1');
      sceneGraph.update('shape1', { bounds: newBounds2 });

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(false);

      const rects = accumulator.getRects();
      // pic1 removal → 1 rect (old bounds)
      // shape1 move → 2 rects (old + new bounds)
      expect(rects).toHaveLength(3);
      expect(rects[0]).toEqual(bounds1); // pic1 old bounds
      expect(rects[1]).toEqual(bounds2); // shape1 old bounds
      expect(rects[2]).toEqual(newBounds2); // shape1 new bounds
    });
  });

  describe('add replacing existing object', () => {
    it('dirty rects cover old + new bounds', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      const oldBounds: Rect = { x: 10, y: 20, width: 100, height: 50 };
      const newBounds: Rect = { x: 200, y: 300, width: 150, height: 80 };

      sceneGraph.add(makePicture('pic1', oldBounds));
      accumulator.clear();

      // Replace with new position
      sceneGraph.add(makePicture('pic1', newBounds));

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(false);

      const rects = accumulator.getRects();
      expect(rects).toHaveLength(2);
      expect(rects[0]).toEqual(oldBounds);
      expect(rects[1]).toEqual(newBounds);
    });
  });

  // ===========================================================================
  // Fallback to full dirty
  // ===========================================================================

  describe('full dirty fallback', () => {
    it('clear() triggers full dirty', () => {
      const { sceneGraph, accumulator } = createWiredGraph();

      sceneGraph.add(makePicture('pic1', { x: 0, y: 0, width: 100, height: 100 }));
      sceneGraph.add(makeShape('shape1', { x: 200, y: 200, width: 100, height: 100 }));
      accumulator.clear();

      sceneGraph.clear();

      expect(accumulator.isDirty()).toBe(true);
      expect(accumulator.isFull()).toBe(true);
    });
  });

  // ===========================================================================
  // DirtyHint correctness
  // ===========================================================================

  describe('DirtyHint type verification', () => {
    it('add produces rects hint', () => {
      const { sceneGraph, hints } = createWiredGraph();
      const bounds: Rect = { x: 10, y: 20, width: 50, height: 30 };

      sceneGraph.add(makePicture('pic1', bounds));

      expect(hints).toHaveLength(1);
      expect(hints[0].type).toBe('rects');
      if (hints[0].type === 'rects') {
        expect(hints[0].bounds).toEqual([bounds]);
      }
    });

    it('remove produces rects hint with old bounds', () => {
      const { sceneGraph, hints } = createWiredGraph();
      const bounds: Rect = { x: 10, y: 20, width: 50, height: 30 };

      sceneGraph.add(makePicture('pic1', bounds));
      hints.length = 0;

      sceneGraph.remove('pic1');

      expect(hints).toHaveLength(1);
      expect(hints[0].type).toBe('rects');
      if (hints[0].type === 'rects') {
        expect(hints[0].bounds).toEqual([bounds]);
      }
    });

    it('clear produces full hint', () => {
      const { sceneGraph, hints } = createWiredGraph();

      sceneGraph.add(makePicture('pic1', { x: 0, y: 0, width: 100, height: 100 }));
      hints.length = 0;

      sceneGraph.clear();

      expect(hints).toHaveLength(1);
      expect(hints[0].type).toBe('full');
    });
  });
});
