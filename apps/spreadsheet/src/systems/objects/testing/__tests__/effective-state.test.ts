/**
 * Effective State Tests
 *
 * Tests for effective state computation via the ObjectSimulator.
 * Covers idle state, during-operation state, after-commit state,
 * non-selected object behavior, and snapshot correctness.
 *
 * @see SYSTEM-TESTING-HARNESS.md
 */

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
// HELPERS
// =============================================================================

function createStartedSimulator(objects: TestFloatingObject[] = TEST_OBJECTS): ObjectSimulator {
  const sim = createObjectSimulator({ objects });
  sim.start();
  return sim;
}

// =============================================================================
// TESTS
// =============================================================================

describe('Effective state', () => {
  let sim: ObjectSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  test('idle state returns persisted state for existing object', async () => {
    sim = createStartedSimulator();

    const state = await sim.getEffectiveObjectState('shape-1');

    expect(state).not.toBeNull();
    expect(state!.source).toBe('persisted');
    expect(state!.isEffective).toBe(false);
    expect(state!.bounds.x).toBe(50);
    expect(state!.bounds.y).toBe(50);
    expect(state!.bounds.width).toBe(100);
    expect(state!.bounds.height).toBe(80);
  });

  test('idle state returns null for non-existent object', async () => {
    sim = createStartedSimulator();

    const state = await sim.getEffectiveObjectState('non-existent');

    expect(state).toBeNull();
  });

  test('during operation reflects delta as local effective state', async () => {
    sim = createStartedSimulator();

    // Verify initial persisted state
    const before = await sim.getEffectiveObjectState('shape-1');
    expect(before!.source).toBe('persisted');
    expect(before!.bounds.x).toBe(50);

    // Start drag operation
    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });

    // Drag 100px to the right and 50px down
    sim.dragTo({ x: 180, y: 120 });

    const during = await sim.getEffectiveObjectState('shape-1');
    expect(during).not.toBeNull();
    expect(during!.isEffective).toBe(true);
    expect(during!.source).toBe('local');

    // The effective position should reflect the drag delta
    // Original position: (50, 50)
    // Start drag at: (80, 70)
    // Current position: (180, 120)
    // Delta: (100, 50)
    // Expected effective position: (50 + 100, 50 + 50) = (150, 100)
    expect(during!.bounds.x).toBe(150);
    expect(during!.bounds.y).toBe(100);
  });

  test('non-selected object unaffected during another objects operation', async () => {
    sim = createStartedSimulator();

    // Drag shape-1
    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 280, y: 270 });

    // shape-2 should still have persisted state
    const shape2State = await sim.getEffectiveObjectState('shape-2');
    expect(shape2State).not.toBeNull();
    expect(shape2State!.source).toBe('persisted');
    expect(shape2State!.isEffective).toBe(false);
    expect(shape2State!.bounds.x).toBe(250);
  });

  test('getObjectInteractionSnapshot shows correct state during lifecycle', () => {
    sim = createStartedSimulator();

    // Idle
    const idle = sim.snapshot();
    expect(idle.state).toBe('idle');
    expect(idle.selectedIds).toEqual([]);
    expect(idle.isOperating).toBe(false);
    expect(idle.activeHandle).toBeNull();

    // Selected
    sim.clickObject('shape-1');
    const selected = sim.snapshot();
    expect(selected.state).toBe('selected');
    expect(selected.selectedIds).toEqual(['shape-1']);
    expect(selected.isOperating).toBe(false);

    // Operating
    sim.startDrag('shape-1', { x: 80, y: 70 });
    const operating = sim.snapshot();
    expect(operating.state).toBe('operating');
    expect(operating.isOperating).toBe(true);
    expect(operating.selectedIds).toContain('shape-1');

    // Back to selected after endDrag
    sim.endDrag();
    const afterDrag = sim.snapshot();
    expect(afterDrag.state).toBe('selected');
    expect(afterDrag.isOperating).toBe(false);
  });

  test('after endDrag, effective state returns to persisted', async () => {
    sim = createStartedSimulator();

    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });
    sim.dragTo({ x: 180, y: 120 });

    // During drag: effective state is local
    expect((await sim.getEffectiveObjectState('shape-1'))!.source).toBe('local');

    // End drag
    sim.endDrag();

    // After commit, the effective state should no longer be 'local'
    // (The mock FloatingObjectManager doesn't actually update position,
    // so the effective state goes back to persisted from the map.)
    const after = await sim.getEffectiveObjectState('shape-1');
    expect(after).not.toBeNull();
    // isObjectInOperation should be false
    expect(sim.isObjectInOperation('shape-1')).toBe(false);
  });

  test('isObjectInOperation tracks operation lifecycle', () => {
    sim = createStartedSimulator();

    // Not in operation initially
    expect(sim.isObjectInOperation('shape-1')).toBe(false);
    expect(sim.isObjectInOperation('shape-2')).toBe(false);

    // Select and drag shape-1
    sim.clickObject('shape-1');
    sim.startDrag('shape-1', { x: 80, y: 70 });

    // shape-1 is in operation, shape-2 is not
    expect(sim.isObjectInOperation('shape-1')).toBe(true);
    expect(sim.isObjectInOperation('shape-2')).toBe(false);

    // End drag
    sim.endDrag();

    // Neither in operation
    expect(sim.isObjectInOperation('shape-1')).toBe(false);
    expect(sim.isObjectInOperation('shape-2')).toBe(false);
  });
});
