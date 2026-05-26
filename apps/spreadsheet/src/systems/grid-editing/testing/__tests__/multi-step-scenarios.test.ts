/**
 * Multi-Step Scenario Tests (GridInteractionSimulator)
 *
 * Complex real-world workflows that exercise cross-machine coordination
 * between the selection and editor actors. These tests verify that
 * editing, navigation, and selection work together correctly.
 *
 * IMPORTANT: The editor machine has a multi-step commit lifecycle:
 * COMMIT -> validating -> (VALIDATION_SUCCESS) -> committing -> (COMMIT_COMPLETE) -> inactive
 * In headless testing without a coordinator, we must manually drive these
 * transitions using the editor commands API.
 *
 * @see ../grid-simulator.ts
 * @see ../../coordination/cross-coordination.ts
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Complete the editor commit lifecycle in headless testing.
 *
 * After calling sim.commitEdit(direction), the editor enters 'validating'.
 * We must manually send VALIDATION_SUCCESS and COMMIT_COMPLETE to drive
 * the editor through to 'inactive'. The cross-coordination then fires
 * to move the selection based on the commit direction.
 */
async function completeCommit(sim: GridSimulator): Promise<void> {
  const editorCommands = sim.system.access.commands.editor;
  editorCommands.validationSuccess();
  await sim.flush();
  editorCommands.commitComplete();
  await sim.flush();
}

// =============================================================================
// TEST SETUP
// =============================================================================

let sim: GridSimulator;

afterEach(() => {
  sim?.destroy();
});

// =============================================================================
// EDIT -> NAVIGATE -> EDIT CYCLES
// =============================================================================

describe('Edit -> Navigate -> Edit cycles', () => {
  it('edit, commit down, edit again, commit down', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // First edit at (0,0)
    sim.startEditing('hello');
    expect(sim.isEditing()).toBe(true);

    sim.commitEdit('down');
    await completeCommit(sim);

    // After commit-down, selection should move to (1,0)
    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });

    // Second edit at (1,0)
    sim.startEditing('world');
    expect(sim.isEditing()).toBe(true);

    sim.commitEdit('down');
    await completeCommit(sim);

    // After second commit-down, selection should be at (2,0)
    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 2, col: 0 });
  });

  it('edit, commit right, edit, commit right', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing('a');
    sim.commitEdit('right');
    await completeCommit(sim);

    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });

    sim.startEditing('b');
    sim.commitEdit('right');
    await completeCommit(sim);

    expect(sim.activeCell()).toEqual({ row: 0, col: 2 });
  });

  it('edit, commit with none direction, stays in place', async () => {
    sim = createGridSimulator({ activeCell: { row: 3, col: 3 } });

    sim.startEditing('value');
    sim.commitEdit('none');
    await completeCommit(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });
  });
});

// =============================================================================
// SELECT RANGE -> NAVIGATE EXITS
// =============================================================================

describe('Select range -> navigate exits', () => {
  it('shift+arrow to create range, then plain arrow collapses to single cell', () => {
    sim = createGridSimulator({ activeCell: { row: 2, col: 2 } });

    // Create a multi-cell range with shift+arrows
    sim.arrow('down', { shift: true });
    sim.arrow('down', { shift: true });

    // Should have a range spanning 3 rows
    let ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    const rowSpan = Math.abs(ranges[0].endRow - ranges[0].startRow) + 1;
    expect(rowSpan).toBe(3);

    // Plain arrow (no shift) should collapse selection
    sim.arrow('right');

    // After collapse, should be a single cell
    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    const newRange = ranges[0];
    expect(newRange.startRow).toBe(newRange.endRow);
    expect(newRange.startCol).toBe(newRange.endCol);
  });
});

// =============================================================================
// TAB ENTRY ACROSS ROW
// =============================================================================

describe('Tab entry across row', () => {
  it('tab commits move right sequentially', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // Edit and commit with right direction (simulating tab)
    sim.startEditing('a');
    sim.commitEdit('right');
    await completeCommit(sim);

    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });

    sim.startEditing('b');
    sim.commitEdit('right');
    await completeCommit(sim);

    expect(sim.activeCell()).toEqual({ row: 0, col: 2 });

    sim.startEditing('c');
    sim.commitEdit('down');
    await completeCommit(sim);

    // After commit-down from (0,2), should be at (1,2)
    expect(sim.activeCell()).toEqual({ row: 1, col: 2 });
  });
});

// =============================================================================
// SELECT ALL -> ESCAPE -> NAVIGATE
// =============================================================================

describe('Select All -> Escape -> Navigate', () => {
  it('selectAll creates sheet-wide range, escape resets, arrow navigates normally', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Select all
    sim.selectAll();

    let ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 0,
      startCol: 0,
      endRow: 1048575,
      endCol: 16383,
    });

    // Escape resets selection to single cell at (0,0) (initial context)
    sim.escape();

    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    // After reset, activeCell goes to (0,0) which is the initial selection context
    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });

    // Arrow down moves normally from reset position
    sim.arrow('down');
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });
  });
});

// =============================================================================
// COLUMN SELECT -> ARROW EXITS
// =============================================================================

describe('Column select -> arrow exits', () => {
  it('selectColumn selects full column, mouseUp finalizes, arrow moves to single cell', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // Select entire column 2 (mouse click enters selectingColumn drag state)
    sim.selectColumn(2);

    // The selection should cover all rows in column 2
    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startCol).toBe(2);
    expect(ranges[0].endCol).toBe(2);

    // Complete the column selection (simulate mouse up to return to idle)
    sim.system.access.commands.selection.mouseUp();

    // Now in idle state, arrow down should collapse to single cell navigation
    sim.arrow('down');

    const afterArrow = sim.selectionRanges();
    expect(afterArrow).toHaveLength(1);
    const range = afterArrow[0];
    // After arrow from full column selection, should be a single cell
    expect(range.startRow).toBe(range.endRow);
    expect(range.startCol).toBe(range.endCol);
  });
});

// =============================================================================
// DOUBLE-CLICK EDIT -> CLICK AWAY
// =============================================================================

describe('Double-click edit -> click away', () => {
  it('double-click starts editing, clicking another cell commits and moves', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // Double-click cell (3,3) to start editing
    sim.doubleClickCell(3, 3);
    await sim.flush();

    expect(sim.isEditing()).toBe(true);
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });

    // Click on a different cell (6,6) while editing
    // This triggers the editing input interception:
    // 1. Intercepts the click, stores (6,6) as pending target
    // 2. Sends COMMIT to editor (enters validating)
    sim.clickCell(6, 6);

    // Drive through the commit lifecycle
    // VALIDATION_SUCCESS -> committing
    sim.system.access.commands.editor.validationSuccess();
    await sim.flush();

    // COMMIT_COMPLETE -> inactive (triggers cross-coordination move to pending target)
    sim.system.access.commands.editor.commitComplete();
    await sim.flush();

    // Editor should have committed and selection should be at (6,6)
    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 6, col: 6 });
  });
});

// =============================================================================
// EDITING STATE TRANSITIONS
// =============================================================================

describe('Editing state transitions', () => {
  it('startEditing sets editing state, cancelEdit clears it', () => {
    sim = createGridSimulator({ activeCell: { row: 2, col: 2 } });

    expect(sim.isEditing()).toBe(false);

    sim.startEditing('test');
    expect(sim.isEditing()).toBe(true);

    sim.cancelEdit();
    expect(sim.isEditing()).toBe(false);
    // After cancel, activeCell should remain unchanged
    expect(sim.activeCell()).toEqual({ row: 2, col: 2 });
  });

  it('typeValue updates editor value', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing();
    sim.typeValue('hello world');

    expect(sim.editorValue()).toBe('hello world');
  });

  it('starting formula edit with = sets formula editing state', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing('=');

    expect(sim.isEditing()).toBe(true);
    expect(sim.isFormulaEditing()).toBe(true);
  });
});

// =============================================================================
// NAVIGATION AFTER EDITING
// =============================================================================

describe('Navigation after editing', () => {
  it('commit up moves selection upward', async () => {
    sim = createGridSimulator({ activeCell: { row: 5, col: 3 } });

    sim.startEditing('value');
    sim.commitEdit('up');
    await completeCommit(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 3 });
  });

  it('commit left moves selection left', async () => {
    sim = createGridSimulator({ activeCell: { row: 5, col: 3 } });

    sim.startEditing('value');
    sim.commitEdit('left');
    await completeCommit(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 5, col: 2 });
  });
});
