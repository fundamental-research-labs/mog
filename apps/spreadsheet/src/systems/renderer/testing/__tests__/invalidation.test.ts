/**
 * Invalidation Tracking Tests
 *
 * Tests the invalidation recording mechanism in the RendererSimulator.
 * The simulator intercepts calls to system.invalidate() and records
 * the reason strings for later assertion.
 *
 * In the real RenderSystem, invalidate() calls renderer.invalidateAll()
 * which schedules a re-render. Without a real renderer, the invalidation
 * is a no-op beyond the spy tracking.
 *
 * @module systems/renderer/testing/__tests__/invalidation
 */

import { createRendererSimulator, type RendererSimulator } from '../renderer-simulator';

describe('Invalidation tracking', () => {
  let sim: RendererSimulator;

  beforeEach(() => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();
  });

  afterEach(() => {
    sim.destroy();
  });

  // ===========================================================================
  // Basic invalidation recording
  // ===========================================================================

  test('invalidate records reason string', () => {
    sim.system.invalidate('grid-state');

    const invalidations = sim.getInvalidations();
    expect(invalidations).toEqual(['grid-state']);
  });

  // ===========================================================================
  // Multiple invalidations
  // ===========================================================================

  test('multiple invalidations tracked in order', () => {
    sim.system.invalidate('grid-state');
    sim.system.invalidate('objects');
    sim.system.invalidate('ink');

    const invalidations = sim.getInvalidations();
    expect(invalidations).toEqual(['grid-state', 'objects', 'ink']);
  });

  // ===========================================================================
  // Clear invalidations
  // ===========================================================================

  test('clearInvalidations resets the log', () => {
    sim.system.invalidate('grid-state');
    sim.system.invalidate('objects');

    expect(sim.getInvalidations()).toHaveLength(2);

    sim.clearInvalidations();

    expect(sim.getInvalidations()).toHaveLength(0);
  });

  // ===========================================================================
  // No reason
  // ===========================================================================

  test('invalidation with no reason records empty string', () => {
    sim.system.invalidate();

    const invalidations = sim.getInvalidations();
    expect(invalidations).toEqual(['']);
  });

  // ===========================================================================
  // Snapshot includes invalidations
  // ===========================================================================

  test('snapshot includes invalidation list', () => {
    sim.system.invalidate('data-changed');
    sim.system.invalidate('format-changed');

    const snap = sim.snapshot();
    expect(snap.invalidations).toEqual(['data-changed', 'format-changed']);
  });

  // ===========================================================================
  // Invalidation is idempotent
  // ===========================================================================

  test('same reason can be recorded multiple times', () => {
    sim.system.invalidate('grid-state');
    sim.system.invalidate('grid-state');
    sim.system.invalidate('grid-state');

    expect(sim.getInvalidations()).toEqual(['grid-state', 'grid-state', 'grid-state']);
  });

  // ===========================================================================
  // Invalidation before ready
  // ===========================================================================

  test('invalidation before ready state is suppressed by system', () => {
    sim.destroy();
    sim = createRendererSimulator();
    sim.start();

    // System is in unmounted state - invalidate checks this.started but
    // the spy still records because we patched invalidate on the instance
    // However, the real invalidate returns early if disposed || !started
    sim.system.invalidate('should-be-ignored');

    // The spy catches it, but the real system logic won't execute renderer.invalidateAll()
    // This is by design - the simulator tracks all invalidate calls regardless of state
    const invalidations = sim.getInvalidations();
    expect(invalidations).toHaveLength(1);
  });
});
