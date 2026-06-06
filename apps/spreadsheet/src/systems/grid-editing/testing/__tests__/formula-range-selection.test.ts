/**
 * Formula Range Selection Tests
 *
 * Tests the signature scenario: type `=` then navigate to build a formula reference.
 * Validates cross-coordination between editor (formulaEditing) and selection
 * (selectingRangeForFormula) machines through the GridInteractionSimulator.
 *
 * Key behavior:
 * - startEditing('=') transitions editor to formulaEditing state
 * - Cross-coordination fires async: editor formulaEditing -> selection selectingRangeForFormula
 * - Shift+arrow in formula mode extends the formula range
 * - Commit/cancel exits formula mode in both machines
 *
 * @module systems/grid-editing/testing/__tests__/formula-range-selection
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

describe('Formula Range Selection', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim.destroy();
  });

  it('type "=" enters formula mode and selectingRangeForFormula', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    expect(sim.isFormulaEditing()).toBe(true);
    expect(sim.isSelectingRangeForFormula()).toBe(true);
  });

  it('plain arrow in formula point-mode moves the point cursor while editor owns the edited cell', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    sim.arrow('right');
    await sim.flush();

    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });
    expect(sim.editingCell()).toEqual({ row: 0, col: 0 });
    expect(sim.selectionRanges()[0]).toEqual({ startRow: 0, startCol: 1, endRow: 0, endCol: 1 });
    expect(sim.editorValue()).toBe('=B1');
  });

  it('Shift+Up extends formula range upward', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    expect(sim.isSelectingRangeForFormula()).toBe(true);

    sim.arrow('up', { shift: true });

    // After shift+arrow in formula range mode, the selection range should extend
    const ranges = sim.selectionRanges();
    expect(ranges.length).toBeGreaterThanOrEqual(1);

    // The range should include rows above the starting position
    const range = ranges[0];
    const minRow = Math.min(range.startRow, range.endRow);
    expect(minRow).toBeLessThan(4);
  });

  it('multiple Shift+Up extends range further up', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    sim.arrow('up', { shift: true });
    sim.arrow('up', { shift: true });
    sim.arrow('up', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges.length).toBeGreaterThanOrEqual(1);

    // Range should extend at least 3 rows up from the starting position (row 4)
    const range = ranges[0];
    const minRow = Math.min(range.startRow, range.endRow);
    expect(minRow).toBeLessThanOrEqual(1);
  });

  it('Shift+Right extends formula range horizontally', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    sim.arrow('right', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges.length).toBeGreaterThanOrEqual(1);

    // Range should now span 2 columns
    const range = ranges[0];
    const minCol = Math.min(range.startCol, range.endCol);
    const maxCol = Math.max(range.startCol, range.endCol);
    expect(maxCol - minCol).toBeGreaterThanOrEqual(1);
  });

  it('commit exits formula mode and moves selection', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    expect(sim.isFormulaEditing()).toBe(true);
    expect(sim.isSelectingRangeForFormula()).toBe(true);

    // Commit with direction down
    sim.commitEdit('down');
    await completeCommitCycle(sim);

    // Editor should be inactive
    expect(sim.isEditing()).toBe(false);

    // Selection should no longer be in formula range mode
    expect(sim.isSelectingRangeForFormula()).toBe(false);

    // Active cell should have moved down from (4, 1) to (5, 1)
    expect(sim.activeCell()).toEqual({ row: 5, col: 1 });
  });

  it('cancel exits formula mode and keeps selection position', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    expect(sim.isFormulaEditing()).toBe(true);

    sim.cancelEdit();
    await sim.flush();

    // Editor should be inactive
    expect(sim.isEditing()).toBe(false);

    // Selection should no longer be in formula range mode
    expect(sim.isSelectingRangeForFormula()).toBe(false);

    // Active cell should remain at original position
    expect(sim.activeCell()).toEqual({ row: 4, col: 1 });
  });

  it('cancel after point-mode reference restores edited cell selection', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    sim.arrow('down');
    await sim.flush();

    expect(sim.editorValue()).toBe('=B6');
    expect(sim.activeCell()).toEqual({ row: 5, col: 1 });
    expect(sim.editingCell()).toEqual({ row: 4, col: 1 });
    expect(sim.selectionRanges()).toEqual([{ startRow: 5, startCol: 1, endRow: 5, endCol: 1 }]);

    sim.cancelEdit();
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.isSelectingRangeForFormula()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 1 });
    expect(sim.selectionRanges()).toEqual([{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }]);
  });
});
