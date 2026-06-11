/**
 * Cross-System Integration: Selection-Object Mutual Exclusion
 *
 * Tests that grid selection and object selection are mutually exclusive,
 * exactly as wired by SheetCoordinator.wireCrossSystemEvents():
 * grid.onSelectionActive -> objects.notifyExternalSelectionActive
 * objects.onObjectSelectionActive -> grid.notifyExternalSelectionActive
 *
 * Uses createSheetSimulator with { grid: true, objects: true }.
 *
 * @see coordinator/sheet-coordinator.ts - wireCrossSystemEvents
 * @module systems/testing-foundation/__tests__/integration
 */

import { createSheetSimulator, type SheetSimulator } from '../../index';

describe('Selection-Object mutual exclusion', () => {
  let sim: SheetSimulator;

  beforeEach(() => {
    sim = createSheetSimulator({
      systems: { grid: true, objects: true, renderer: false },
      objects: [
        { id: 'obj-1', type: 'shape', position: { x: 100, y: 100, width: 200, height: 150 } },
        { id: 'obj-2', type: 'chart', position: { x: 400, y: 100, width: 300, height: 200 } },
      ],
    });
    sim.start();
  });

  afterEach(() => {
    sim.destroy();
  });

  test('selecting an object deselects grid selection context', () => {
    // Grid starts with an active selection
    const gridSnap = sim.grid.getSelectionSnapshot();
    expect(gridSnap).toBeDefined();

    // Click object-1 via the objects system
    sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 150, y: 150 });

    // Object should be selected
    const objSnap = sim.objects!.getObjectInteractionSnapshot();
    expect(objSnap.selectedIds).toContain('obj-1');
  });

  test('grid.onSelectionActive deselects objects', () => {
    // First select an object
    sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 150, y: 150 });
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-1');

    // Now perform a grid selection action (mouseDown + mouseUp via commands)
    sim.grid.access.commands.selection.mouseDown({ row: 2, col: 3 }, false, false);
    sim.grid.access.commands.selection.mouseUp();

    // Object should be deselected because grid.onSelectionActive fires
    // and calls objects.notifyExternalSelectionActive()
    const objSnap = sim.objects!.getObjectInteractionSnapshot();
    expect(objSnap.selectedIds).toEqual([]);
  });

  test('programmatic user setSelection deselects objects', () => {
    sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 150, y: 150 });
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-1');

    sim.grid.access.commands.selection.setSelection(
      [{ startRow: 2, startCol: 11, endRow: 20, endCol: 27 }],
      { row: 2, col: 11 },
    );

    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toEqual([]);
  });

  test('objects.onObjectSelectionActive deselects grid via notifyExternalSelectionActive', () => {
    // Trigger a grid selection first
    sim.grid.access.commands.selection.mouseDown({ row: 0, col: 0 }, false, false);
    sim.grid.access.commands.selection.mouseUp();

    // Now select an object -- this should fire objects.onObjectSelectionActive
    // which calls grid.notifyExternalSelectionActive()
    sim.objects!.handleObjectMouseDown('obj-2', 'body', { x: 450, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 450, y: 150 });

    // Object should be selected
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-2');
  });

  test('rapid switching between grid and object selection maintains consistency', () => {
    // Select object
    sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 150, y: 150 });
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-1');

    // Select grid cell
    sim.grid.access.commands.selection.mouseDown({ row: 1, col: 1 }, false, false);
    sim.grid.access.commands.selection.mouseUp();
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toEqual([]);

    // Select object again
    sim.objects!.handleObjectMouseDown('obj-2', 'body', { x: 450, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 450, y: 150 });
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-2');

    // Select grid cell again
    sim.grid.access.commands.selection.mouseDown({ row: 3, col: 3 }, false, false);
    sim.grid.access.commands.selection.mouseUp();
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toEqual([]);
  });

  test('object selected then grid click deselects object', () => {
    // Select an object
    sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 150, y: 150 });
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds.length).toBeGreaterThan(0);

    // Grid click deselects ALL objects via the cross-system wiring
    sim.grid.access.commands.selection.mouseDown({ row: 5, col: 5 }, false, false);
    sim.grid.access.commands.selection.mouseUp();
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toEqual([]);
  });

  test('switching between different objects, then grid click deselects', () => {
    // Select first object
    sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 150, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 150, y: 150 });
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-1');

    // Click second object (replaces selection)
    sim.objects!.handleObjectMouseDown('obj-2', 'body', { x: 450, y: 150 }, false, false);
    sim.objects!.handleObjectMouseUp({ x: 450, y: 150 });
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-2');

    // Grid click deselects via cross-system wiring
    sim.grid.access.commands.selection.mouseDown({ row: 5, col: 5 }, false, false);
    sim.grid.access.commands.selection.mouseUp();
    expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toEqual([]);
  });
});
