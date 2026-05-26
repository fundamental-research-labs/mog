/**
 * Editing Lifecycle Tests
 *
 * Tests the full edit lifecycle across editor and selection machines
 * through the GridInteractionSimulator. Validates that:
 * - Starting editing activates the editor
 * - Committing with a direction moves the active cell appropriately
 * - Cancelling keeps the active cell in place
 * - Double-click triggers editing at the clicked cell
 * - commitWithKey maps to correct directions
 *
 * Key architecture note:
 * In headless mode, commitEdit() sends COMMIT to the editor which transitions
 * to 'validating'. Since there is no external coordinator, we must manually
 * complete the commit cycle by sending VALIDATION_SUCCESS + COMMIT_COMPLETE
 * to the editor actor before the cross-coordination (editor -> selection move)
 * can fire.
 *
 * @module systems/grid-editing/testing/__tests__/editing-lifecycle
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Complete the commit cycle in headless mode.
 *
 * In headless mode (no coordinator), commitEdit() sends COMMIT which transitions
 * the editor to 'validating'. It stays there because nobody sends VALIDATION_SUCCESS.
 * We must manually complete: validating -> VALIDATION_SUCCESS -> committing -> COMMIT_COMPLETE -> inactive.
 * Then flush so cross-coordination (editor -> selection move) can fire.
 */
async function completeCommitCycle(sim: GridSimulator): Promise<void> {
  const editorActor = sim.system.access.actors.editor;
  editorActor.send({ type: 'VALIDATION_SUCCESS' });
  editorActor.send({ type: 'COMMIT_COMPLETE' });
  await sim.flush();
}

// =============================================================================
// TESTS
// =============================================================================

describe('Editing Lifecycle', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim.destroy();
  });

  // ===========================================================================
  // Basic editing start/stop
  // ===========================================================================

  it('startEditing sets editor to active', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');

    expect(sim.isEditing()).toBe(true);
  });

  it('double-click starts editing at the clicked cell', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.doubleClickCell(3, 3);

    expect(sim.isEditing()).toBe(true);
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });
  });

  it('escape cancels editing and keeps active cell unchanged', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    expect(sim.isEditing()).toBe(true);

    sim.cancelEdit();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 1 });
  });

  // ===========================================================================
  // Commit with explicit direction
  // ===========================================================================

  it('commitEdit("down") commits and moves active cell down', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    sim.commitEdit('down');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 5, col: 1 });
  });

  it('commitEdit("up") commits and moves active cell up', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    sim.commitEdit('up');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 3, col: 1 });
  });

  it('commitEdit("right") commits and moves active cell right', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    sim.commitEdit('right');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 2 });
  });

  it('commitEdit("left") commits and moves active cell left', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    sim.commitEdit('left');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('commitEdit("none") commits and keeps active cell in place', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    sim.commitEdit('none');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 1 });
  });

  // ===========================================================================
  // commitWithKey
  // ===========================================================================

  it('commitWithKey("enter") commits and moves active cell down', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    await sim.commitWithKey('enter');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 5, col: 1 });
  });

  it('commitWithKey("shift-enter") commits and moves active cell up', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    await sim.commitWithKey('shift-enter');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 3, col: 1 });
  });

  it('commitWithKey("tab") commits and moves active cell right', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    await sim.commitWithKey('tab');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 2 });
  });

  it('commitWithKey("shift-tab") commits and moves active cell left', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    await sim.commitWithKey('shift-tab');
    await completeCommitCycle(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });
});
