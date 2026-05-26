/**
 * Ink Lifecycle Tests
 * Tests the ink system's modal lifecycle: start, activate, deactivate, dispose.
 *
 * @module systems/ink/testing/__tests__
 */

import { createInkSimulator } from '../ink-simulator';

describe('Ink lifecycle', () => {
  // ==========================================================================
  // INITIAL STATE
  // ==========================================================================

  test('starts inactive', () => {
    const sim = createInkSimulator();
    sim.start();

    expect(sim.isActive()).toBe(false);
    expect(sim.actorState()).toBe('idle');
    expect(sim.activateCount).toBe(0);
    expect(sim.deactivateCount).toBe(0);

    sim.destroy();
  });

  // ==========================================================================
  // ACTIVATION
  // ==========================================================================

  test('activate transitions to drawing state', () => {
    const sim = createInkSimulator();
    sim.start();

    sim.activate('drawing-1');

    expect(sim.isActive()).toBe(true);
    expect(sim.actorState()).toBe('drawing');

    sim.destroy();
  });

  test('onActivate callback fires on activation', () => {
    const sim = createInkSimulator();
    sim.start();

    expect(sim.activateCount).toBe(0);

    sim.activate('drawing-1');

    expect(sim.activateCount).toBe(1);

    sim.destroy();
  });

  // ==========================================================================
  // DEACTIVATION
  // ==========================================================================

  test('deactivate returns to idle', () => {
    const sim = createInkSimulator();
    sim.start();

    sim.activate('drawing-1');
    expect(sim.isActive()).toBe(true);

    sim.deactivate();
    expect(sim.isActive()).toBe(false);
    expect(sim.actorState()).toBe('idle');

    sim.destroy();
  });

  test('onDeactivate callback fires on deactivation', () => {
    const sim = createInkSimulator();
    sim.start();

    sim.activate('drawing-1');
    expect(sim.deactivateCount).toBe(0);

    sim.deactivate();
    expect(sim.deactivateCount).toBe(1);

    sim.destroy();
  });

  test('deactivate while already idle is a no-op', () => {
    const sim = createInkSimulator();
    sim.start();

    // Already idle, deactivate should not fire callback
    sim.deactivate();
    expect(sim.deactivateCount).toBe(0);
    expect(sim.actorState()).toBe('idle');

    sim.destroy();
  });

  // ==========================================================================
  // IDEMPOTENCY / EDGE CASES
  // ==========================================================================

  test('double-activate for same drawing is idempotent', () => {
    const sim = createInkSimulator();
    sim.start();

    sim.activate('drawing-1');
    expect(sim.activateCount).toBe(1);
    expect(sim.actorState()).toBe('drawing');

    // Second activate for the same drawing should be a no-op
    sim.activate('drawing-1');
    // The system checks: if not idle AND targetDrawingId matches, return early
    // So the activate callback should NOT fire again
    expect(sim.activateCount).toBe(1);
    expect(sim.actorState()).toBe('drawing');

    sim.destroy();
  });

  test('activate different drawing deactivates first', () => {
    const sim = createInkSimulator();
    sim.start();

    sim.activate('drawing-1');
    expect(sim.activateCount).toBe(1);
    expect(sim.deactivateCount).toBe(0);

    // Switching to a different drawing should deactivate first, then activate
    sim.activate('drawing-2');
    expect(sim.deactivateCount).toBe(1);
    expect(sim.activateCount).toBe(2);
    expect(sim.actorState()).toBe('drawing');

    // Verify the new drawing is the target
    const snap = sim.system.access.actors.ink.getSnapshot();
    expect(snap.context.targetDrawingId).toBe('drawing-2');

    sim.destroy();
  });

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  test('dispose cleans up', () => {
    const sim = createInkSimulator();
    sim.start();

    sim.activate('drawing-1');
    expect(sim.isActive()).toBe(true);

    sim.destroy();

    // After dispose, the system should report inactive
    // (isActive returns false when disposed)
    expect(sim.isActive()).toBe(false);
  });

  test('dispose while idle is safe', () => {
    const sim = createInkSimulator();
    sim.start();

    // Should not throw
    expect(() => sim.destroy()).not.toThrow();
  });

  // ==========================================================================
  // SNAPSHOT
  // ==========================================================================

  test('snapshot captures current state', () => {
    const sim = createInkSimulator();
    sim.start();

    const idleSnap = sim.snapshot();
    expect(idleSnap).toEqual({
      isActive: false,
      actorState: 'idle',
      activateCount: 0,
      deactivateCount: 0,
    });

    sim.activate('drawing-1');
    const activeSnap = sim.snapshot();
    expect(activeSnap).toEqual({
      isActive: true,
      actorState: 'drawing',
      activateCount: 1,
      deactivateCount: 0,
    });

    sim.deactivate();
    const deactivatedSnap = sim.snapshot();
    expect(deactivatedSnap).toEqual({
      isActive: false,
      actorState: 'idle',
      activateCount: 1,
      deactivateCount: 1,
    });

    sim.destroy();
  });

  // ==========================================================================
  // STATE CHANGE SUBSCRIPTION
  // ==========================================================================

  test('onStateChange fires on transitions', () => {
    const sim = createInkSimulator();
    sim.start();

    let stateChangeCount = 0;
    sim.system.onStateChange(() => {
      stateChangeCount++;
    });

    sim.activate('drawing-1');
    expect(stateChangeCount).toBeGreaterThan(0);

    const countAfterActivate = stateChangeCount;
    sim.deactivate();
    expect(stateChangeCount).toBeGreaterThan(countAfterActivate);

    sim.destroy();
  });
});
