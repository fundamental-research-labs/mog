/**
 * Cross-System Integration: Ink Mode Isolation
 *
 * Tests that ink system activation/deactivation fires callbacks
 * and that ink state changes trigger renderer invalidation via
 * the cross-system wiring:
 * ink.onStateChange -> renderer.invalidate('ink')
 *
 * Uses createSheetSimulator with { ink: true, renderer: true }.
 *
 * @see coordinator/sheet-coordinator.ts - wireCrossSystemEvents
 * @module systems/testing-foundation/__tests__/integration
 */

import { createSheetSimulator, type SheetSimulator } from '../../index';

describe('Ink mode isolation', () => {
  let sim: SheetSimulator;

  beforeEach(() => {
    sim = createSheetSimulator({
      systems: { grid: true, renderer: true, ink: true, objects: false },
    });
    sim.start();
  });

  afterEach(() => {
    sim.destroy();
  });

  test('ink activation fires onActivate callback', () => {
    let activated = false;
    sim.ink!.onActivate(() => {
      activated = true;
    });

    sim.ink!.activate('drawing-1');

    expect(activated).toBe(true);
    expect(sim.ink!.isActive()).toBe(true);
  });

  test('ink deactivation fires onDeactivate callback', () => {
    let deactivated = false;
    sim.ink!.onDeactivate(() => {
      deactivated = true;
    });

    sim.ink!.activate('drawing-1');
    sim.ink!.deactivate();

    expect(deactivated).toBe(true);
    expect(sim.ink!.isActive()).toBe(false);
  });

  test('ink state change triggers renderer invalidation with reason "ink"', () => {
    sim.clearInvalidations();

    // Activate ink (state change: idle -> drawing)
    sim.ink!.activate('drawing-1');

    const invalidations = sim.getInvalidations();
    const inkInvalidations = invalidations.filter((i) => i.reason === 'ink');
    expect(inkInvalidations.length).toBeGreaterThan(0);
  });

  test('ink deactivation also triggers renderer invalidation', () => {
    sim.ink!.activate('drawing-1');
    sim.clearInvalidations();

    sim.ink!.deactivate();

    const invalidations = sim.getInvalidations();
    const inkInvalidations = invalidations.filter((i) => i.reason === 'ink');
    expect(inkInvalidations.length).toBeGreaterThan(0);
  });
});
