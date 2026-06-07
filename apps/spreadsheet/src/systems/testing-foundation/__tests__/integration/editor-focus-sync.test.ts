/**
 * Cross-System Integration: Editor-Focus Synchronization
 *
 * Tests that grid edit start/end events are wired to input focus management,
 * exactly as wired by SheetCoordinator.wireCrossSystemEvents():
 * grid.onEditStart -> input.focusEditor
 * grid.onEditEnd -> input.focusGrid
 *
 * Uses createSheetSimulator with { grid: true, input: true }.
 *
 * NOTE ON COMMIT vs CANCEL:
 * The editor machine's COMMIT event goes to a 'validating' state that
 * requires editorDeps (validation, cell write) to complete the transition
 * to 'inactive'. Without editorDeps, the machine stays in 'validating'.
 * In integration tests without editorDeps, we use cancelEdit() to test
 * the onEditEnd -> focusGrid wiring, since CANCEL transitions directly
 * to 'inactive'. The cross-system wiring is the same either way.
 *
 * @see coordinator/sheet-coordinator.ts - wireCrossSystemEvents
 * @module systems/testing-foundation/__tests__/integration
 */

import { jest } from '@jest/globals';

import { createSheetSimulator, type SheetSimulator } from '../../index';

describe('Editor-Focus synchronization', () => {
  let sim: SheetSimulator;

  beforeEach(() => {
    sim = createSheetSimulator({
      systems: { grid: true, input: true, renderer: false },
    });
    sim.start();
  });

  afterEach(() => {
    sim.destroy();
  });

  test('grid.onEditStart triggers input.focusEditor', async () => {
    const focusEditorSpy = jest.spyOn(sim.input!, 'focusEditor');

    sim.grid.startEditing({ row: 0, col: 0 }, 'sheet-1');
    await sim.flush();

    expect(focusEditorSpy).toHaveBeenCalled();

    focusEditorSpy.mockRestore();
  });

  test('grid.onEditEnd triggers input.focusGrid (via cancelEdit)', async () => {
    // cancelEdit sends CANCEL which transitions directly to 'inactive',
    // triggering onEditEnd -> input.focusGrid cross-system wiring.
    const focusGridSpy = jest.spyOn(sim.input!, 'focusGrid');

    sim.grid.startEditing({ row: 0, col: 0 }, 'sheet-1');
    await sim.flush();
    sim.grid.cancelEdit();
    await sim.flush();

    expect(focusGridSpy).toHaveBeenCalled();

    focusGridSpy.mockRestore();
  });

  test('cancel edit returns focus to grid', async () => {
    const focusEditorSpy = jest.spyOn(sim.input!, 'focusEditor');
    const focusGridSpy = jest.spyOn(sim.input!, 'focusGrid');

    sim.grid.startEditing({ row: 0, col: 0 }, 'sheet-1');
    await sim.flush();
    expect(focusEditorSpy).toHaveBeenCalledTimes(1);

    sim.grid.cancelEdit();
    await sim.flush();
    expect(focusGridSpy).toHaveBeenCalledTimes(1);

    focusEditorSpy.mockRestore();
    focusGridSpy.mockRestore();
  });

  test('edit-cancel-edit cycle maintains focus consistency', async () => {
    const focusEditorSpy = jest.spyOn(sim.input!, 'focusEditor');
    const focusGridSpy = jest.spyOn(sim.input!, 'focusGrid');

    // First edit cycle
    sim.grid.startEditing({ row: 0, col: 0 }, 'sheet-1');
    await sim.flush();
    expect(focusEditorSpy).toHaveBeenCalledTimes(1);

    sim.grid.cancelEdit();
    await sim.flush();
    expect(focusGridSpy).toHaveBeenCalledTimes(1);

    // Second edit cycle
    sim.grid.startEditing({ row: 1, col: 0 }, 'sheet-1');
    await sim.flush();
    expect(focusEditorSpy).toHaveBeenCalledTimes(2);

    sim.grid.cancelEdit();
    await sim.flush();
    expect(focusGridSpy).toHaveBeenCalledTimes(2);

    focusEditorSpy.mockRestore();
    focusGridSpy.mockRestore();
  });

  test('focus state accessible via input system after edit start', () => {
    // Verify that the focus actor is properly connected
    // (input.setFocusActor was called during start())
    const snapshot = sim.input!.getFocusSnapshot();
    expect(snapshot).toBeDefined();
  });
});
