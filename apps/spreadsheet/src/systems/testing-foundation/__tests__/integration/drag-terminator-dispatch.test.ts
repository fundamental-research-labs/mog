/**
 * Cross-System Integration: Pointer-Up/Cancel Dispatch via DragTerminators
 *
 * Tests that pointerUp() and pointerCancel() dispatch to all systems'
 * DragTerminators, exactly as SheetCoordinator.handlePointerUp/handlePointerCancel:
 * grid.dragTerminator.endDrag
 * objects.dragTerminator.endDrag
 * renderer.pageBreakDragTerminator.endDrag
 * ink.dragTerminator.endDrag
 * input.clearActivePointerId
 *
 * Uses createSheetSimulator with various system combinations.
 *
 * @see coordinator/sheet-coordinator.ts - handlePointerUp, handlePointerCancel
 * @module systems/testing-foundation/__tests__/integration
 */

import { createSheetSimulator, type SheetSimulator } from '../../index';

describe('Pointer-up dispatch via DragTerminators', () => {
  describe('with grid + objects + renderer + ink + input', () => {
    let sim: SheetSimulator;

    beforeEach(() => {
      sim = createSheetSimulator({
        systems: { grid: true, objects: true, renderer: true, ink: true, input: true },
        objects: [
          { id: 'obj-1', type: 'shape', position: { x: 100, y: 100, width: 200, height: 150 } },
        ],
      });
      sim.start();
    });

    afterEach(() => {
      sim.destroy();
    });

    test('pointerUp dispatches endDrag to all systems without errors', () => {
      // Should not throw even when no drags are active
      expect(() => sim.pointerUp()).not.toThrow();
    });

    test('pointerCancel dispatches cancelDrag to all systems without errors', () => {
      expect(() => sim.pointerCancel()).not.toThrow();
    });

    test('pointerUp clears input active pointer ID', () => {
      // Set an active pointer
      sim.input!.setActivePointerId(42);
      expect(sim.input!.getActivePointerId()).toBe(42);

      // pointerUp should clear it
      sim.pointerUp();
      expect(sim.input!.getActivePointerId()).toBeNull();
    });

    test('pointerCancel clears input active pointer ID', () => {
      sim.input!.setActivePointerId(99);
      expect(sim.input!.getActivePointerId()).toBe(99);

      sim.pointerCancel();
      expect(sim.input!.getActivePointerId()).toBeNull();
    });
  });

  describe('object drag ended by pointerUp', () => {
    let sim: SheetSimulator;

    beforeEach(() => {
      sim = createSheetSimulator({
        systems: { grid: true, objects: true, renderer: false },
        objects: [
          { id: 'obj-1', type: 'shape', position: { x: 100, y: 100, width: 200, height: 150 } },
        ],
      });
      sim.start();
    });

    afterEach(() => {
      sim.destroy();
    });

    test('pointerUp ends an active object drag', () => {
      // Start an object drag
      sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
      sim.objects!.handleObjectMouseMove({ x: 160, y: 160 }, false);

      // Object should be in operating state
      expect(sim.objects!.isObjectInOperation('obj-1')).toBe(true);

      // pointerUp dispatches endDrag to all systems including objects
      sim.pointerUp();

      // Object should no longer be in operation
      expect(sim.objects!.isObjectInOperation('obj-1')).toBe(false);
    });
  });

  describe('grid fill drag ended by pointerUp', () => {
    let sim: SheetSimulator;

    beforeEach(() => {
      sim = createSheetSimulator({
        systems: { grid: true, renderer: false, objects: false },
      });
      sim.start();
    });

    afterEach(() => {
      sim.destroy();
    });

    test('pointerUp ends grid fill handle drag', () => {
      // Start a fill handle drag
      sim.grid.access.commands.selection.startFillHandleDrag();
      expect(sim.grid.access.accessors.selection.isDraggingFillHandle()).toBe(true);

      // pointerUp dispatches endDrag to grid's drag terminator
      sim.pointerUp();

      // Fill handle drag should be ended
      expect(sim.grid.access.accessors.selection.isDraggingFillHandle()).toBe(false);
    });
  });
});
