/**
 * Cross-System Integration: Render Invalidation from State Changes
 *
 * Tests that system state changes trigger renderer.invalidate() with
 * correct reason strings, exactly as wired by SheetCoordinator.wireCrossSystemEvents():
 * grid.onStateChange -> renderer.invalidate('grid-state')
 * objects.onStateChange -> renderer.invalidate('objects')
 * ink.onStateChange -> renderer.invalidate('ink')
 *
 * Uses createSheetSimulator with varying system combinations.
 *
 * @see coordinator/sheet-coordinator.ts - wireCrossSystemEvents
 * @module systems/testing-foundation/__tests__/integration
 */

import { createSheetSimulator, type SheetSimulator } from '../../index';

describe('Render invalidation from state changes', () => {
  describe('grid state changes', () => {
    let sim: SheetSimulator;

    beforeEach(() => {
      sim = createSheetSimulator({
        systems: { grid: true, renderer: true, objects: false, ink: false },
      });
      sim.start();
      // Clear invalidations from start/mount/init sequence
      sim.clearInvalidations();
    });

    afterEach(() => {
      sim.destroy();
    });

    test('grid selection change invalidates renderer with reason "grid-state"', () => {
      sim.grid.access.commands.selection.mouseDown({ row: 2, col: 3 }, false, false);
      sim.grid.access.commands.selection.mouseUp();

      const invalidations = sim.getInvalidations();
      const gridInvalidations = invalidations.filter((i) => i.reason === 'grid-state');
      expect(gridInvalidations.length).toBeGreaterThan(0);
    });

    test('grid edit start invalidates renderer', () => {
      sim.grid.startEditing({ row: 0, col: 0 }, 'sheet-1');

      const invalidations = sim.getInvalidations();
      const gridInvalidations = invalidations.filter((i) => i.reason === 'grid-state');
      expect(gridInvalidations.length).toBeGreaterThan(0);
    });
  });

  describe('objects state changes', () => {
    let sim: SheetSimulator;

    beforeEach(() => {
      sim = createSheetSimulator({
        systems: { grid: true, renderer: true, objects: true },
        objects: [
          { id: 'obj-1', type: 'shape', position: { x: 100, y: 100, width: 200, height: 150 } },
        ],
      });
      sim.start();
      sim.clearInvalidations();
    });

    afterEach(() => {
      sim.destroy();
    });

    test('object selection change invalidates renderer with reason "objects"', () => {
      sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
      sim.objects!.handleObjectMouseUp({ x: 150, y: 150 });

      const invalidations = sim.getInvalidations();
      const objectInvalidations = invalidations.filter((i) => i.reason === 'objects');
      expect(objectInvalidations.length).toBeGreaterThan(0);
    });
  });

  describe('ink state changes', () => {
    let sim: SheetSimulator;

    beforeEach(() => {
      sim = createSheetSimulator({
        systems: { grid: true, renderer: true, ink: true, objects: false },
      });
      sim.start();
      sim.clearInvalidations();
    });

    afterEach(() => {
      sim.destroy();
    });

    test('ink activation invalidates renderer with reason "ink"', () => {
      sim.ink!.activate('test-drawing');

      const invalidations = sim.getInvalidations();
      const inkInvalidations = invalidations.filter((i) => i.reason === 'ink');
      expect(inkInvalidations.length).toBeGreaterThan(0);
    });

    test('ink deactivation invalidates renderer with reason "ink"', () => {
      sim.ink!.activate('test-drawing');
      sim.clearInvalidations();

      sim.ink!.deactivate();

      const invalidations = sim.getInvalidations();
      const inkInvalidations = invalidations.filter((i) => i.reason === 'ink');
      expect(inkInvalidations.length).toBeGreaterThan(0);
    });
  });

  describe('multiple system state changes', () => {
    let sim: SheetSimulator;

    beforeEach(() => {
      sim = createSheetSimulator({
        systems: { grid: true, renderer: true, objects: true, ink: true },
        objects: [
          { id: 'obj-1', type: 'shape', position: { x: 100, y: 100, width: 200, height: 150 } },
        ],
      });
      sim.start();
      sim.clearInvalidations();
    });

    afterEach(() => {
      sim.destroy();
    });

    test('multiple state changes produce multiple invalidations with distinct reasons', () => {
      // Trigger grid state change
      sim.grid.access.commands.selection.mouseDown({ row: 1, col: 1 }, false, false);
      sim.grid.access.commands.selection.mouseUp();

      // Trigger ink state change
      sim.ink!.activate('test-drawing');

      const invalidations = sim.getInvalidations();
      const reasons = invalidations.map((i) => i.reason);

      // Should have both grid-state and ink reasons
      expect(reasons).toContain('grid-state');
      expect(reasons).toContain('ink');
    });
  });
});
