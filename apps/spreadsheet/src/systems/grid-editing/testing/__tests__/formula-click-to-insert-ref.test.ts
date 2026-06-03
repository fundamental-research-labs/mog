/**
 * Formula Click-to-Insert-Reference Tests
 *
 * Tests that clicking a cell while in formula editing Enter Mode inserts a
 * cell reference into the formula instead of navigating away.
 *
 * Regression tests for: typing `=`, clicking another cell should insert a
 * reference (e.g. "=A1") — not commit the edit and navigate to the clicked cell.
 *
 * The root cause was a focus/blur race in the browser: pointerdown on the
 * canvas stole focus from the editor input, triggering onBlur → commit before
 * the click interception could insert the reference. These tests verify the
 * state machine coordination that the fix relies on: interceptCellClick →
 * FORMULA_RANGE_SELECTED → insertFormulaRange.
 *
 * @module systems/grid-editing/testing/__tests__/formula-click-to-insert-ref
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

describe('Formula Click-to-Insert Reference', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim.destroy();
  });

  it('clicking a cell during formula Enter Mode inserts a cell reference', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    // Type "=" to start formula editing in Enter Mode
    sim.startEditing('=');
    await sim.flush();

    expect(sim.isFormulaEditing()).toBe(true);

    // Click cell B2 (row 1, col 1)
    sim.clickCell(1, 1);

    // Should still be in formula editing mode (not committed/navigated away)
    expect(sim.isFormulaEditing()).toBe(true);
    expect(sim.isEditing()).toBe(true);

    // Editor value should contain the cell reference
    expect(sim.editorValue()).toBe('=B2');
  });

  it('clicking a cell inserts reference and selection tracks the pointed cell', async () => {
    sim = createGridSimulator({ activeCell: { row: 3, col: 2 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    // Click cell A1 (row 0, col 0)
    sim.clickCell(0, 0);

    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });
    expect(sim.editorValue()).toBe('=A1');
  });

  it('clicking a cell during formula Edit Mode still inserts a reference', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM(');
    await sim.flush();
    sim.system.access.commands.editor.toggleEditMode();
    await sim.flush();

    sim.clickCell(1, 1);

    expect(sim.isFormulaEditing()).toBe(true);
    expect(sim.isEditing()).toBe(true);
    expect(sim.activeCell()).toEqual({ row: 1, col: 1 });
    expect(sim.editorValue()).toBe('=SUM(B2');
  });

  it('cancelling formula point mode restores selection to the formula origin', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();
    sim.arrow('down');
    await sim.flush();

    expect(sim.editorValue()).toBe('=A2');
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });

    sim.cancelEdit();
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });
  });

  it('cross-sheet point insert falls back to the formula end when cursor state is stale', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 1 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM(A1,');
    await sim.flush();

    sim.system.access.commands.editor.setCursor(0);
    sim.system.access.actors.editor.send({
      type: 'FORMULA_RANGE_SELECTED',
      range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      color: '#4285f4',
      sheetId: 'sheet-2',
      sheetName: 'Sheet2',
    });
    await sim.flush();

    expect(sim.editorValue()).toBe('=SUM(A1,Sheet2!A1');
  });

  it('clicking multiple cells inserts multiple references', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    // Click cell B1 (row 0, col 1)
    sim.clickCell(0, 1);
    expect(sim.editorValue()).toBe('=B1');

    // Type "+" operator
    sim.typeValue('=B1+');

    // Click cell C1 (row 0, col 2)
    sim.clickCell(0, 2);
    expect(sim.editorValue()).toBe('=B1+C1');

    // Still editing
    expect(sim.isFormulaEditing()).toBe(true);
  });

  it('clicking a cell after typing =SUM( inserts reference inside function', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM(');
    await sim.flush();

    // Click cell D5 (row 4, col 3)
    sim.clickCell(4, 3);

    expect(sim.editorValue()).toBe('=SUM(D5');
    expect(sim.isFormulaEditing()).toBe(true);
  });

  it('selection machine stays in selectingRangeForFormula after click', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    expect(sim.isSelectingRangeForFormula()).toBe(true);

    sim.clickCell(2, 2);

    // Should still be in formula range selection mode
    expect(sim.isSelectingRangeForFormula()).toBe(true);
  });

  it('clicking during regular (non-formula) editing commits rather than inserting reference', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    // Start editing with non-formula content
    sim.startEditing('hello');
    await sim.flush();

    expect(sim.isEditing()).toBe(true);
    expect(sim.isFormulaEditing()).toBe(false);

    // Click another cell — should commit the edit (not insert a reference)
    sim.clickCell(2, 2);

    // The interceptCellClick sends COMMIT for non-formula edits.
    // Key assertion: the editor should NOT be in formula editing mode,
    // and the value should NOT contain a cell reference like "C3".
    expect(sim.isFormulaEditing()).toBe(false);
    expect(sim.editorValue()).not.toContain('C3');
  });
});
