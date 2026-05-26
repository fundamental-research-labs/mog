/**
 * Object Operations Tests
 *
 * Tests for drag, resize, rotate operations via the ObjectSimulator.
 * Covers operation lifecycle, DragTerminator, effective state during operations,
 * and state change events during operations.
 *
 * @see SYSTEM-TESTING-HARNESS.md
 */

import { jest } from '@jest/globals';

jest.mock('@mog/env', () => ({ isProd: () => false }));

import {
  createObjectSimulator,
  type ObjectSimulator,
  type TestFloatingObject,
} from '../object-simulator';

(globalThis as unknown as { jest: typeof jest }).jest = jest;

// =============================================================================
// TEST FIXTURES
// =============================================================================

const TEST_OBJECTS: TestFloatingObject[] = [
  { id: 'shape-1', type: 'shape', position: { x: 50, y: 50, width: 100, height: 80 } },
  { id: 'shape-2', type: 'shape', position: { x: 250, y: 50, width: 100, height: 80 } },
  {
    id: 'locked-shape',
    type: 'shape',
    position: { x: 50, y: 200, width: 100, height: 80 },
    locked: true,
  },
];

// =============================================================================
// HELPERS
// =============================================================================

function createMockSheetViewObjects(objects: TestFloatingObject[]) {
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
      boundsMap.set(objectId, { ...bounds });
    },
  );

  return {
    hitTest: jest.fn().mockReturnValue(null),
    getBounds: jest.fn((objectId: string) => boundsMap.get(objectId) ?? null),
    getSceneObjectsByZOrder: jest.fn().mockReturnValue([]),
    getSceneObject: jest.fn().mockReturnValue(null),
    applyPatches: jest.fn(),
    updateTransientBounds,
    clearTransientBounds: jest.fn(),
    resyncScene: jest.fn(),
    invalidate: jest.fn(),
  };
}

function createStartedSimulator(objects: TestFloatingObject[] = TEST_OBJECTS): ObjectSimulator {
  const mockObjects = createMockSheetViewObjects(objects);
  const sim = createObjectSimulator({ objects, getObjects: () => mockObjects as any });
  sim.start();
  return sim;
}

async function flushOperationCommit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// =============================================================================
// TESTS
// =============================================================================

describe('Object operations', () => {
  let sim: ObjectSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  test('drag starts operation and transitions to operating state', () => {
    sim = createStartedSimulator();

    // First select the object
    sim.clickObject('shape-1');
    expect(sim.snapshot().state).toBe('selected');

    // Start drag
    sim.startDrag('shape-1', { x: 80, y: 70 });

    expect(sim.snapshot().isOperating).toBe(true);
    expect(sim.snapshot().state).toBe('operating');
  });

  test('dragTo updates position during operation', () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });

    expect(sim.snapshot().isOperating).toBe(true);

    // Drag to a new position
    sim.dragTo({ x: 180, y: 170 });

    // Still in operating state
    expect(sim.snapshot().isOperating).toBe(true);
  });

  test('endDrag commits operation and returns to selected state', () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 180, y: 170 });

    expect(sim.snapshot().isOperating).toBe(true);

    // End the drag
    sim.endDrag();

    // Should return to selected (not operating)
    expect(sim.snapshot().isOperating).toBe(false);
    expect(sim.selectedObjectIds()).toContain('shape-1');
  });

  test('cancelDrag via DragTerminator reverts operation', () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 300, y: 300 });

    expect(sim.snapshot().isOperating).toBe(true);

    // Cancel the drag
    sim.cancelDrag();

    // Should return to selected state with operation cancelled
    expect(sim.snapshot().isOperating).toBe(false);
    // Operation should be null after cancel
    expect(sim.snapshot().activeHandle).toBeNull();
  });

  test('isObjectInOperation returns true during drag', () => {
    sim = createStartedSimulator();

    expect(sim.isObjectInOperation('shape-1')).toBe(false);

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });

    expect(sim.isObjectInOperation('shape-1')).toBe(true);

    sim.endDrag();
    expect(sim.isObjectInOperation('shape-1')).toBe(false);
  });

  test('effective state reflects delta during drag', async () => {
    sim = createStartedSimulator();

    // Get initial effective state
    const initialState = await sim.getEffectiveObjectState('shape-1');
    expect(initialState).not.toBeNull();
    expect(initialState!.source).toBe('persisted');

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 180, y: 170 });

    const duringDrag = await sim.getEffectiveObjectState('shape-1');
    expect(duringDrag).not.toBeNull();
    expect(duringDrag!.isEffective).toBe(true);
    expect(duringDrag!.source).toBe('local');
  });

  test('onStateChange fires during operation', () => {
    sim = createStartedSimulator();

    const stateChanges = jest.fn();
    const unsub = sim.system.onStateChange(stateChanges);

    sim.clickObject('shape-1');
    const countAfterSelect = stateChanges.mock.calls.length;

    sim.startDrag('shape-1', { x: 80, y: 70 });
    expect(stateChanges.mock.calls.length).toBeGreaterThan(countAfterSelect);

    unsub();
  });

  test('drag terminator endDrag completes active operation', () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 180, y: 170 });

    expect(sim.snapshot().isOperating).toBe(true);

    // Use the drag terminator directly (simulating coordinator pointer-up dispatch)
    sim.system.dragTerminator.endDrag();

    expect(sim.snapshot().isOperating).toBe(false);
  });

  test('drag terminator cancelDrag cancels active operation', () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 400, y: 400 });

    expect(sim.snapshot().isOperating).toBe(true);

    // Use the drag terminator directly
    sim.system.dragTerminator.cancelDrag();

    expect(sim.snapshot().isOperating).toBe(false);
  });

  test('endDrag when not operating is a no-op', () => {
    sim = createStartedSimulator();

    // Should not throw when called in idle state
    expect(() => sim.endDrag()).not.toThrow();

    // Select but don't drag
    sim.clickObject('shape-1');
    expect(() => sim.endDrag()).not.toThrow();
  });

  test('cancelDrag when not operating is a no-op', () => {
    sim = createStartedSimulator();

    // Should not throw when called in idle state
    expect(() => sim.cancelDrag()).not.toThrow();
  });

  test('operation on selected-then-dragged object commits via mutations', async () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 180, y: 170 });
    sim.endDrag();

    // commitOperation is async — flush microtasks so the awaited mutation calls resolve
    await flushOperationCommit();

    // The coordination module should have committed the operation
    // Check that move mutation was called (for a non-chart shape, it calls moveObject)
    expect(sim.mockMutations.moveObject).toHaveBeenCalled();
  });

  test('clicking a chart completes zero-delta drag without mutation', async () => {
    sim = createStartedSimulator([
      { id: 'chart-1', type: 'chart', position: { x: 50, y: 50, width: 240, height: 160 } },
    ]);

    sim.clickObject('chart-1');
    await flushOperationCommit();

    expect(sim.mockMutations.moveChart).not.toHaveBeenCalled();
    expect(sim.mockMutations.resizeChart).not.toHaveBeenCalled();
    expect(sim.mockMutations.moveObject).not.toHaveBeenCalled();
    expect(sim.snapshot().isOperating).toBe(false);
  });

  test('chart drag commits through floating-object delta mutation', async () => {
    sim = createStartedSimulator([
      { id: 'chart-1', type: 'chart', position: { x: 50, y: 50, width: 240, height: 160 } },
    ]);

    sim.clickObject('chart-1');
    sim.startDrag('chart-1', { x: 100, y: 100 });
    sim.dragTo({ x: 180, y: 170 });
    sim.endDrag();
    await flushOperationCommit();

    expect(sim.mockMutations.moveChart).toHaveBeenCalledWith(
      expect.anything(),
      'sheet-1',
      'chart-1',
      80,
      70,
    );
    expect(sim.mockMutations.resizeChart).not.toHaveBeenCalled();
    expect(sim.mockMutations.moveObject).not.toHaveBeenCalled();
  });

  test('chart resize commits size through floating-object resize mutation', async () => {
    sim = createStartedSimulator([
      { id: 'chart-1', type: 'chart', position: { x: 50, y: 50, width: 240, height: 160 } },
    ]);

    sim.clickObject('chart-1');
    sim.system.handleObjectMouseDown('chart-1', 'resize-se', { x: 290, y: 210 }, false, false);
    sim.system.handleObjectMouseMove({ x: 350, y: 260 }, false);
    sim.system.handleObjectMouseUp({ x: 350, y: 260 });
    await flushOperationCommit();

    expect(sim.mockMutations.resizeChart).toHaveBeenCalledWith(
      expect.anything(),
      'sheet-1',
      'chart-1',
      { width: 300, height: 210 },
    );
    expect(sim.mockMutations.moveChart).not.toHaveBeenCalled();
    expect(sim.mockMutations.resizeObject).not.toHaveBeenCalled();
  });

  test('zero-delta resize and rotate complete without mutation', async () => {
    sim = createStartedSimulator();
    const pos = { x: 150, y: 130 };

    sim.clickObject('shape-1');
    sim.system.handleObjectMouseDown('shape-1', 'resize-se', pos, false, false);
    sim.system.handleObjectMouseUp(pos);
    await flushOperationCommit();

    expect(sim.mockMutations.resizeObject).not.toHaveBeenCalled();
    expect(sim.mockMutations.moveObject).not.toHaveBeenCalled();

    sim.clickObject('shape-1');
    sim.system.handleObjectMouseDown('shape-1', 'rotation', pos, false, false);
    sim.system.handleObjectMouseUp(pos);
    await flushOperationCommit();

    expect(sim.mockMutations.rotateObject).not.toHaveBeenCalled();
    expect(sim.snapshot().isOperating).toBe(false);
  });

  test('real resize and rotate operations still commit', async () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.system.handleObjectMouseDown('shape-1', 'resize-se', { x: 150, y: 130 }, false, false);
    sim.system.handleObjectMouseMove({ x: 180, y: 160 }, false);
    sim.system.handleObjectMouseUp({ x: 180, y: 160 });
    await flushOperationCommit();

    expect(sim.mockMutations.resizeObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'shape-1',
      130,
      110,
    );

    sim.clickObject('shape-1');
    sim.system.handleObjectMouseDown('shape-1', 'rotation', { x: 100, y: 40 }, false, false);
    sim.system.handleObjectMouseMove({ x: 160, y: 90 }, false);
    sim.system.handleObjectMouseUp({ x: 160, y: 90 });
    await flushOperationCommit();

    expect(sim.mockMutations.rotateObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'shape-1',
      expect.any(Number),
    );
  });
});
