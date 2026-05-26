/**
 * Scene Graph Updates During Drag Tests
 *
 * Verifies that handleMouseMove writes to the scene graph on every pointer event
 * during drag/resize/rotate operations, making the scene graph the single authority
 * for object position throughout the operation lifecycle.
 *
 * This eliminates the flash bug where clearing the operation would fall back to
 * stale scene graph position.
 *
 * @see 01-SCENE-GRAPH-SINGLE-AUTHORITY.md
 * @see SYSTEM-TESTING-HARNESS.md
 */

import { jest } from '@jest/globals';

jest.mock('@mog/env', () => ({ isProd: () => false }));

import {
  createObjectSimulator,
  type ObjectSimulator,
  type TestFloatingObject,
} from '../object-simulator';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const TEST_OBJECTS: TestFloatingObject[] = [
  { id: 'shape-1', type: 'shape', position: { x: 50, y: 50, width: 100, height: 80 } },
  { id: 'shape-2', type: 'shape', position: { x: 250, y: 50, width: 100, height: 80 } },
];

// =============================================================================
// MOCK SHEETVIEW OBJECTS FACTORY
// =============================================================================

/**
 * Create a mock SheetView object capability with a spy on updateTransientBounds.
 *
 * Also provides getBounds for handleMouseDown (which reads initial
 * bounds from the scene graph to populate originalStates).
 */
function createMockSheetViewObjects(objects: TestFloatingObject[]) {
  // Build a bounds lookup from test objects
  const boundsMap = new Map<
    string,
    { x: number; y: number; width: number; height: number; rotation: number }
  >();
  for (const obj of objects) {
    boundsMap.set(obj.id, {
      x: obj.position.x,
      y: obj.position.y,
      width: obj.position.width,
      height: obj.position.height,
      rotation: obj.rotation ?? 0,
    });
  }

  const updateTransientBounds = jest.fn(
    (
      objectId: string,
      bounds: { x: number; y: number; width: number; height: number; rotation: number },
    ) => {
      // Update the internal map so subsequent reads reflect the latest bounds
      boundsMap.set(objectId, { ...bounds });
    },
  );

  const getBounds = jest.fn((objectId: string) => boundsMap.get(objectId) ?? null);

  const mockObjects = {
    hitTest: jest.fn().mockReturnValue(null),
    getBounds,
    getSceneObjectsByZOrder: jest.fn().mockReturnValue([]),
    getSceneObject: jest.fn().mockReturnValue(null),
    applyPatches: jest.fn(),
    updateTransientBounds,
    clearTransientBounds: jest.fn(),
    resyncScene: jest.fn(),
    invalidate: jest.fn(),
  };

  return { mockObjects, updateTransientBounds, getBounds, boundsMap };
}

// =============================================================================
// HELPERS
// =============================================================================

function createSimulatorWithRenderer(objects: TestFloatingObject[] = TEST_OBJECTS) {
  const { mockObjects, updateTransientBounds, boundsMap } = createMockSheetViewObjects(objects);
  const sim = createObjectSimulator({
    objects,
    getObjects: () => mockObjects as any,
  });
  sim.start();
  return { sim, updateTransientBounds, boundsMap, mockObjects };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Scene graph updates during drag', () => {
  let sim: ObjectSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  test('calls updateTransientBounds on every mouse move during drag', () => {
    const { sim: s, updateTransientBounds } = createSimulatorWithRenderer();
    sim = s;

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });

    // Clear calls from startDrag's initial move
    updateTransientBounds.mockClear();

    // First drag
    sim.dragTo({ x: 130, y: 120 });
    expect(updateTransientBounds).toHaveBeenCalledTimes(1);
    expect(updateTransientBounds).toHaveBeenCalledWith(
      'shape-1',
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        width: 100,
        height: 80,
      }),
    );

    // Second drag
    updateTransientBounds.mockClear();
    sim.dragTo({ x: 200, y: 180 });
    expect(updateTransientBounds).toHaveBeenCalledTimes(1);
  });

  test('computes bounds using explicit currentPosition, not stale XState context', () => {
    const { sim: s, updateTransientBounds } = createSimulatorWithRenderer();
    sim = s;

    sim.clickObject('shape-1');
    // startDrag clicks at (80,70) then moves to (81,71) — original position is (50,50)
    sim.startDrag('shape-1', { x: 80, y: 70 });
    updateTransientBounds.mockClear();

    // Drag to (180, 170) — delta from start is (100, 100)
    // Expected position: original (50,50) + delta (100,100) = (150, 150)
    sim.dragTo({ x: 180, y: 170 });

    expect(updateTransientBounds).toHaveBeenCalledWith(
      'shape-1',
      expect.objectContaining({
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );
  });

  test('updates all objects in multi-object drag', () => {
    const { sim: s, updateTransientBounds } = createSimulatorWithRenderer();
    sim = s;

    // Multi-select via Ctrl-click (the XState machine uses isCtrlClick guard for addToSelection).
    // Click shape-1 first (selects it + starts/completes zero-delta drag).
    sim.clickObject('shape-1');

    // Ctrl-click shape-2 to add to selection.
    // The mouseDown handler sees shape-1 selected, calls selectObject('shape-2', false, true).
    // The isCtrlClick guard triggers addToSelection, adding shape-2 to selectedIds.
    sim.system.handleObjectMouseDown('shape-2', 'body', { x: 260, y: 60 }, false, true);
    sim.system.handleObjectMouseUp({ x: 260, y: 60 });

    // Verify both are selected
    expect(sim.selectedObjectIds()).toContain('shape-1');
    expect(sim.selectedObjectIds()).toContain('shape-2');

    // Start drag on shape-1 — since both are selected, the operation should
    // include both objects.
    sim.startDrag('shape-1', { x: 80, y: 70 });
    expect(sim.snapshot().isOperating).toBe(true);

    updateTransientBounds.mockClear();
    sim.dragTo({ x: 130, y: 120 });

    // Both objects should be updated with the same delta
    const calledIds = updateTransientBounds.mock.calls.map((call: any[]) => call[0]);
    expect(calledIds).toContain('shape-1');
    expect(calledIds).toContain('shape-2');

    // Verify both moved by the same delta — shapes start at different positions
    // but the drag delta should be identical for all objects in the group
    const shape1Call = updateTransientBounds.mock.calls.find((c: any[]) => c[0] === 'shape-1');
    const shape2Call = updateTransientBounds.mock.calls.find((c: any[]) => c[0] === 'shape-2');
    expect(shape1Call).toBeTruthy();
    expect(shape2Call).toBeTruthy();
    // shape-1 original: (50,50), shape-2 original: (250,50)
    // Both should move by the same delta from the drag
    const dx1 = shape1Call![1].x - 50;
    const dy1 = shape1Call![1].y - 50;
    const dx2 = shape2Call![1].x - 250;
    const dy2 = shape2Call![1].y - 50;
    expect(dx1).toBe(dx2);
    expect(dy1).toBe(dy2);
  });

  test('does not call updateTransientBounds when not operating', () => {
    const { sim: s, updateTransientBounds } = createSimulatorWithRenderer();
    sim = s;

    // Move without starting an operation
    sim.system.handleObjectMouseMove({ x: 100, y: 100 }, false);

    expect(updateTransientBounds).not.toHaveBeenCalled();
  });

  test('gracefully handles null gridRenderer', () => {
    // Create simulator with null gridRenderer (default)
    const nullSim = createObjectSimulator({ objects: TEST_OBJECTS });
    nullSim.start();
    sim = nullSim;

    // Select and attempt to drag — with null gridRenderer, startDrag won't
    // actually enter operating state (handleMouseDown returns early without
    // bounds), but handleMouseMove should not throw either way.
    expect(() => {
      sim.system.handleObjectMouseMove({ x: 100, y: 100 }, false);
    }).not.toThrow();
  });
});

// =============================================================================
// COMMIT FLOW — NO POSITION REGRESSION
// =============================================================================

describe('Commit flow — no position regression', () => {
  let sim: ObjectSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  /**
   * Helper: send CLEAR_OPERATION to the object interaction actor.
   *
   * In production, commitOperation() fires mutations to Rust (fire-and-forget)
   * then calls commands.clearOperation(). Since the actor and commands are private,
   * we reach through via (system as any) to send the event directly.
   */
  function sendClearOperation(simulator: ObjectSimulator): void {
    // Access the private objectActor to send CLEAR_OPERATION directly
    (simulator.system as any).objectActor.send({ type: 'CLEAR_OPERATION' });
  }

  test('scene graph retains final position after clearOperation', () => {
    // This is THE core regression test for the flash bug.
    //
    // Before the fix: clearOperation would null out the operation, and the
    // renderer would fall back to the stale scene graph position (which was
    // never updated during drag). The object would flash back to its original
    // position for one frame.
    //
    // After the fix: handleMouseMove updates the scene graph on every pointer
    // event. When clearOperation fires, the scene graph already has the final
    // position — no flash.
    const { sim: s, updateTransientBounds, boundsMap } = createSimulatorWithRenderer();
    sim = s;

    // 1. Select object and start drag from (80, 70)
    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });

    // 2. Drag to final position — delta from start is (100, 100)
    // Expected final position: original (50,50) + delta (100,100) = (150, 150)
    updateTransientBounds.mockClear();
    sim.dragTo({ x: 180, y: 170 });

    // 3. Verify scene graph has the final position DURING the drag
    expect(updateTransientBounds).toHaveBeenCalledWith(
      'shape-1',
      expect.objectContaining({
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );

    const boundsDuringDrag = boundsMap.get('shape-1');
    expect(boundsDuringDrag).toEqual(
      expect.objectContaining({
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );

    // 4. Complete the operation (simulates mouseUp → completeOperation)
    sim.endDrag();

    // 5. Clear the operation (simulates commitOperation → clearOperation)
    sendClearOperation(sim);

    // 6. CRITICAL: Scene graph STILL has the final position — not the original.
    // This is what prevents the flash bug.
    const boundsAfterClear = boundsMap.get('shape-1');
    expect(boundsAfterClear).toEqual(
      expect.objectContaining({
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );
  });

  test('scene graph retains position during resize operation', () => {
    const { sim: s, updateTransientBounds, boundsMap } = createSimulatorWithRenderer();
    sim = s;

    // Select the object first
    sim.clickObject('shape-1');

    // Start resize on 'se' (south-east) handle
    // handleObjectMouseDown with 'resize-se' region reads bounds from scene graph
    sim.system.handleObjectMouseDown('shape-1', 'resize-se', { x: 150, y: 130 }, false, false);

    // First move to enter operating state
    sim.system.handleObjectMouseMove({ x: 151, y: 131 }, false);
    expect(sim.snapshot().isOperating).toBe(true);

    // Resize by dragging SE handle — delta (50, 40) from start
    updateTransientBounds.mockClear();
    sim.system.handleObjectMouseMove({ x: 200, y: 170 }, false);

    // Scene graph should be updated with resized bounds
    expect(updateTransientBounds).toHaveBeenCalledTimes(1);
    expect(updateTransientBounds).toHaveBeenCalledWith(
      'shape-1',
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );

    // Verify the bounds map was updated (scene graph reflects the resize)
    const resizedBounds = boundsMap.get('shape-1');
    expect(resizedBounds).toBeTruthy();
    // SE handle resize: delta (50, 40) adds directly to width/height
    // Original: 100x80, expected: 150x120
    expect(resizedBounds!.width).toBe(150);
    expect(resizedBounds!.height).toBe(120);
    // Position stays anchored at top-left for SE resize
    expect(resizedBounds!.x).toBe(50);
    expect(resizedBounds!.y).toBe(50);
  });

  test('scene graph retains position during rotate operation', () => {
    const { sim: s, updateTransientBounds, boundsMap } = createSimulatorWithRenderer();
    sim = s;

    // Select the object first
    sim.clickObject('shape-1');

    // Start rotate — handleObjectMouseDown with 'rotation' region
    // Object is at (50, 50, 100x80), center is (100, 90)
    sim.system.handleObjectMouseDown('shape-1', 'rotation', { x: 100, y: 20 }, false, false);

    // First move to enter operating state
    sim.system.handleObjectMouseMove({ x: 101, y: 21 }, false);
    expect(sim.snapshot().isOperating).toBe(true);

    // Rotate by moving to a new position
    updateTransientBounds.mockClear();
    sim.system.handleObjectMouseMove({ x: 150, y: 50 }, false);

    // Scene graph should be updated with new rotation
    expect(updateTransientBounds).toHaveBeenCalledTimes(1);
    expect(updateTransientBounds).toHaveBeenCalledWith(
      'shape-1',
      expect.objectContaining({
        rotation: expect.any(Number),
      }),
    );

    // Verify the bounds map was updated — rotation should be positive (clockwise)
    // Moving from top-center (100,20) to right (150,50) is a clockwise rotation
    const rotatedBounds = boundsMap.get('shape-1');
    expect(rotatedBounds).toBeTruthy();
    expect(rotatedBounds!.rotation).toBeGreaterThan(0);
    // Bounds should be unchanged during rotation (only rotation changes)
    expect(rotatedBounds!.width).toBe(100);
    expect(rotatedBounds!.height).toBe(80);
  });
});
