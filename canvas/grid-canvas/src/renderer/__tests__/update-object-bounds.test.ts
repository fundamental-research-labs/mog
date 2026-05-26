/**
 * updateObjectBounds Tests
 *
 * Verifies that GridRendererImpl.updateObjectBounds():
 * 1. Updates scene graph bounds for existing objects
 * 2. Marks drawing layer dirty via scene graph onDirty callback
 * 3. Marks overlay layer dirty so handles follow the shape
 * 4. Is a no-op for nonexistent objects (no dirty marking, no error)
 * 5. Fires requestFrame via scene graph onDirty callback
 *
 * @module grid-canvas/renderer/__tests__/update-object-bounds
 */

import { jest } from '@jest/globals';
import type { Rect } from '@mog/canvas-engine';
import { SceneGraph, type ShapeScene } from '@mog/drawing-canvas';
import { GridRendererImpl } from '../grid-renderer';

// =============================================================================
// Helpers
// =============================================================================

function createTestSceneObject(id: string, bounds: Rect, rotation?: number): ShapeScene {
  return {
    id,
    type: 'shape',
    bounds,
    zIndex: 0,
    visible: true,
    groupId: null,
    rotation: rotation ?? 0,
    data: {
      shapeType: 'rect',
    },
  };
}

/**
 * Create a minimal fake with a real SceneGraph and mock engine,
 * then bind updateObjectBounds from the prototype.
 */
function createFakeForUpdateObjectBounds() {
  const markDirty = jest.fn();
  const onDirtyCallback = jest.fn();

  const sceneGraph = new SceneGraph(onDirtyCallback);

  const fake: {
    drawing: { sceneGraph: SceneGraph };
    engine: { markDirty: jest.Mock };
    updateObjectBounds: GridRendererImpl['updateObjectBounds'];
  } = {
    drawing: {
      sceneGraph,
    },
    engine: {
      markDirty,
    },
    updateObjectBounds: null!,
  };

  // Bind the prototype method to our fake
  const proto = GridRendererImpl.prototype;
  fake.updateObjectBounds = proto.updateObjectBounds.bind(
    fake,
  ) as GridRendererImpl['updateObjectBounds'];

  return { fake, markDirty, onDirtyCallback, sceneGraph };
}

// =============================================================================
// Tests
// =============================================================================

describe('updateObjectBounds', () => {
  it('updates scene graph bounds for an existing object', () => {
    const { fake, sceneGraph } = createFakeForUpdateObjectBounds();
    const obj = createTestSceneObject('obj-1', { x: 10, y: 20, width: 100, height: 50 }, 0);
    sceneGraph.add(obj);

    fake.updateObjectBounds('obj-1', {
      x: 30,
      y: 40,
      width: 200,
      height: 100,
      rotation: 45,
    });

    const updated = sceneGraph.getById('obj-1');
    expect(updated).toBeDefined();
    if (!updated) return;
    expect(updated.bounds).toEqual({ x: 30, y: 40, width: 200, height: 100 });
    expect(updated.rotation).toBe(45);
  });

  it('marks drawing layer dirty via scene graph onDirty callback', () => {
    const { fake, onDirtyCallback, sceneGraph } = createFakeForUpdateObjectBounds();
    const obj = createTestSceneObject('obj-1', { x: 10, y: 20, width: 100, height: 50 });
    sceneGraph.add(obj);
    onDirtyCallback.mockClear(); // clear the add() call

    fake.updateObjectBounds('obj-1', {
      x: 30,
      y: 40,
      width: 200,
      height: 100,
      rotation: 0,
    });

    // Scene graph's onDirty fires with old + new bounds
    expect(onDirtyCallback).toHaveBeenCalledTimes(1);
    const affectedBounds = onDirtyCallback.mock.calls[0][0];
    // Old bounds
    expect(affectedBounds).toContainEqual({ x: 10, y: 20, width: 100, height: 50 });
    // New bounds
    expect(affectedBounds).toContainEqual({ x: 30, y: 40, width: 200, height: 100 });
  });

  it('marks overlay layer dirty so handles follow the shape', () => {
    const { fake, markDirty, sceneGraph } = createFakeForUpdateObjectBounds();
    const obj = createTestSceneObject('obj-1', { x: 10, y: 20, width: 100, height: 50 });
    sceneGraph.add(obj);
    markDirty.mockClear();

    fake.updateObjectBounds('obj-1', {
      x: 30,
      y: 40,
      width: 200,
      height: 100,
      rotation: 0,
    });

    expect(markDirty).toHaveBeenCalledWith('overlay');
  });

  it('is a no-op for nonexistent object — no dirty marking, no error', () => {
    const { fake, markDirty, onDirtyCallback } = createFakeForUpdateObjectBounds();
    // No objects in scene graph — onDirtyCallback was never called
    onDirtyCallback.mockClear();
    markDirty.mockClear();

    // Should not throw
    expect(() => {
      fake.updateObjectBounds('nonexistent', {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
      });
    }).not.toThrow();

    // Neither callback should fire
    expect(onDirtyCallback).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('fires onDirty (which triggers requestFrame) via scene graph callback', () => {
    const { fake, onDirtyCallback, sceneGraph } = createFakeForUpdateObjectBounds();
    const obj = createTestSceneObject('obj-1', { x: 0, y: 0, width: 50, height: 50 });
    sceneGraph.add(obj);
    onDirtyCallback.mockClear();

    fake.updateObjectBounds('obj-1', {
      x: 10,
      y: 10,
      width: 60,
      height: 60,
      rotation: 90,
    });

    // The onDirty callback is what the drawing layer uses to call requestFrame()
    expect(onDirtyCallback).toHaveBeenCalledTimes(1);
  });
});
