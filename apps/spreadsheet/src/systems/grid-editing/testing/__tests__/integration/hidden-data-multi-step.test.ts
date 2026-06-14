/**
 * Integration Test: Hidden Data Multi-Step Scenarios
 *
 * Tests multi-step scenarios combining hidden rows/cols with data-aware
 * navigation. Covers Ctrl+Arrow with hidden data cells, arrow navigation
 * through multiple hidden groups, Tab cycling, Shift+Arrow extension,
 * and edit-commit direction with hidden rows.
 *
 * @see actions/handlers/selection/data-edge.ts (hidden-aware findDataEdge)
 * @see actions/handlers/selection/tab-enter.ts (hidden-aware tab cycling)
 * @see coordination/cross-coordination.ts (commit-direction navigation)
 */

import { createIntegrationSimulator, type IntegrationSimulator } from '../../integration-simulator';

// =============================================================================
// Test Setup
// =============================================================================

let sim: IntegrationSimulator;

afterEach(() => {
  sim?.destroy();
});

// =============================================================================
// 1. Ctrl+Down skips hidden data cells
// =============================================================================

describe('Ctrl+Down skips hidden data cells', () => {
  it('stops at last visible cell before hidden boundary (data in rows 0-5, rows 2-3 hidden)', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c', // hidden
        '3,0': 'd', // hidden
        '4,0': 'e',
        '5,0': 'f',
      },
      hiddenRows: [2, 3],
      activeCell: { row: 0, col: 0 },
    });

    // Ctrl+Down from row 0: findDataEdge walks data block.
    // Row 0 has data, row 1 has data (Case 4: both have data, walk contiguous).
    // Next after row 1 is row 2 which is hidden → stops at boundary.
    // So it should stop at row 1 (last visible before hidden).
    await sim.pressKey('ArrowDown', { ctrl: true });

    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });
  });
});

// =============================================================================
// 2. Ctrl+Shift+Down with hidden rows in data block
// =============================================================================

describe('Ctrl+Shift+Down with hidden rows in data block', () => {
  it('extends selection to boundary before hidden rows (data rows 0-6, rows 3-4 hidden)', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '3,0': 'd', // hidden
        '4,0': 'e', // hidden
        '5,0': 'f',
        '6,0': 'g',
      },
      hiddenRows: [3, 4],
      activeCell: { row: 0, col: 0 },
    });

    // Ctrl+Shift+Down from row 0: extends selection to data edge.
    // findDataEdge walks contiguous data. Row 0-2 visible with data,
    // row 3 is hidden → boundary at row 2.
    await sim.pressKey('ArrowDown', { ctrl: true, shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startRow).toBe(0);
    expect(ranges[0].startCol).toBe(0);
    // Should extend to row 2 (last visible before hidden boundary)
    expect(ranges[0].endRow).toBe(2);
  });
});

// =============================================================================
// 3. Arrow down through multiple hidden groups
// =============================================================================

describe('Arrow down through multiple hidden groups', () => {
  it('skips first hidden group: row 1 → row 4', () => {
    sim = createIntegrationSimulator({
      hiddenRows: [2, 3, 6, 7],
      activeCell: { row: 1, col: 0 },
    });

    // Arrow down from row 1: rows 2,3 hidden → skips to row 4
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('skips second hidden group: row 5 → row 8', () => {
    sim = createIntegrationSimulator({
      hiddenRows: [2, 3, 6, 7],
      activeCell: { row: 5, col: 0 },
    });

    // Arrow down from row 5: row 6,7 hidden → skips to row 8
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 8, col: 0 });
  });

  it('sequential navigation through both hidden groups', () => {
    sim = createIntegrationSimulator({
      hiddenRows: [2, 3, 6, 7],
      activeCell: { row: 0, col: 0 },
    });

    // Row 0 → 1
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });

    // Row 1 → 4 (skips 2,3)
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });

    // Row 4 → 5
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 5, col: 0 });

    // Row 5 → 8 (skips 6,7)
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 8, col: 0 });
  });
});

// =============================================================================
// 4. Hidden row at data block boundary
// =============================================================================

describe('Hidden row at data block boundary', () => {
  it('Ctrl+Down stops before hidden row at end of data block', async () => {
    // Data at rows 0-3, row 3 hidden, data at rows 5-8
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '3,0': 'd', // hidden (at boundary)
        '5,0': 'e',
        '6,0': 'f',
        '7,0': 'g',
        '8,0': 'h',
      },
      hiddenRows: [3],
      activeCell: { row: 0, col: 0 },
    });

    // Ctrl+Down from row 0: walking data block.
    // Row 0,1,2 have data and are visible. Row 3 is hidden → boundary.
    // Should stop at row 2 (last visible data cell before hidden).
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 2, col: 0 });
  });

  it('Ctrl+Down from row 2 does NOT jump over hidden row 3 to row 5 data block', async () => {
    // After stopping at row 2, another Ctrl+Down:
    // Current cell (row 2) has data. Next cell (row 3) is hidden.
    // findDataEdge returns current cell since next is hidden.
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '3,0': 'd', // hidden
        '5,0': 'e',
        '6,0': 'f',
        '7,0': 'g',
        '8,0': 'h',
      },
      hiddenRows: [3],
      activeCell: { row: 2, col: 0 },
    });

    // Ctrl+Down from row 2: next (row 3) is hidden → stays at row 2
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 2, col: 0 });
  });
});

// =============================================================================
// 5. Tab cycling with hidden rows in selection
// =============================================================================

describe('Tab cycling with hidden rows in selection', () => {
  it('Tab skips hidden rows when cycling through multi-cell selection', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c', // hidden
        '3,0': 'd', // hidden
        '4,0': 'e',
      },
      hiddenRows: [2, 3],
      activeCell: { row: 0, col: 0 },
    });

    // Create a multi-cell selection spanning rows 0-4, col 0
    // by using Shift+ArrowDown multiple times.
    // Shift+Down from row 0 should skip hidden rows:
    // first press → extend to row 1
    // second press → skip 2,3, extend to row 4
    // But let's set the selection explicitly via the system
    // Actually, let's build it with shift+arrows:
    sim.pressKey('ArrowDown', { shift: true }); // extends to row 1
    // Row 1 → next visible is row 4 (skips 2,3)
    sim.pressKey('ArrowDown', { shift: true }); // extends to row 4

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    // Selection should span row 0 to row 4
    expect(ranges[0].startRow).toBe(0);
    expect(ranges[0].endRow).toBe(4);

    // Active cell is at row 0 (the anchor). Tab should cycle through visible cells.
    // Tab cycling in row-major order within selection:
    // Visible cells in the selection: (0,0), (1,0), (4,0) — rows 2,3 hidden
    // Currently at (0,0), Tab → (1,0)
    // TAB_FORWARD uses fire-and-forget async; flush microtasks to let setSelection resolve.
    const flush = () => new Promise((r) => setTimeout(r, 0));
    sim.pressKey('Tab');
    await flush();
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });

    // Tab → (4,0) — skips hidden rows 2,3
    sim.pressKey('Tab');
    await flush();
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });

    // Tab wraps → (0,0)
    sim.pressKey('Tab');
    await flush();
    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });
  });
});

// =============================================================================
// 6. Shift+Arrow extend then collapse with hidden rows
// =============================================================================

describe('Shift+Arrow extend then collapse with hidden rows', () => {
  it('extends down through hidden rows, then steps from active cell to collapse', () => {
    sim = createIntegrationSimulator({
      hiddenRows: [2, 3],
      activeCell: { row: 1, col: 0 },
    });

    // Shift+Down x3 to extend selection downward through hidden rows
    // First Shift+Down: extends to row 4 (skips 2,3)
    sim.pressKey('ArrowDown', { shift: true });
    let ranges = sim.selectionRanges();
    expect(ranges[0].endRow).toBe(4);

    // Second Shift+Down: extends to row 5
    sim.pressKey('ArrowDown', { shift: true });
    ranges = sim.selectionRanges();
    expect(ranges[0].endRow).toBe(5);

    // Third Shift+Down: extends to row 6
    sim.pressKey('ArrowDown', { shift: true });
    ranges = sim.selectionRanges();
    expect(ranges[0].endRow).toBe(6);

    // Selection is now rows 1-6, with rows 2-3 hidden
    // Active cell is at row 1 (the anchor)
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });

    // Plain ArrowDown steps from the active cell, skipping hidden rows.
    sim.pressKey('ArrowDown');

    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
    ranges = sim.selectionRanges();
    // Should be single-cell selection
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
  });
});

// =============================================================================
// 7. Edit, commit down through hidden row
// =============================================================================

describe('Edit, commit down through hidden row', () => {
  it('commit-down from row 1 with rows 2-3 hidden skips to first visible row 4', async () => {
    sim = createIntegrationSimulator({
      hiddenRows: [2, 3],
      activeCell: { row: 1, col: 0 },
    });

    sim.startEditing('value');
    expect(sim.isEditing()).toBe(true);

    sim.commitEdit('down');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);

    // Fixed: cross-coordination.ts now uses moveCellSkipHidden() which skips
    // hidden rows. Commit-down from row 1 skips hidden rows 2-3 and lands on row 4.
    const cell = sim.activeCell();

    expect(cell.row).toBe(4); // Fixed: skips hidden rows 2-3, lands on visible row 4
    expect(cell.col).toBe(0);
  });
});

// =============================================================================
// 8. Ctrl+Arrow with alternating data/empty + hidden cells
// =============================================================================

describe('Ctrl+Arrow with alternating data and empty mixed with hidden', () => {
  it('navigates complex pattern: data 0-2, hidden 3-4, data 5-6, empty 7, data 8', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '3,0': 'd', // hidden
        '4,0': 'e', // hidden
        '5,0': 'f',
        '6,0': 'g',
        // row 7 empty
        '8,0': 'h',
      },
      hiddenRows: [3, 4],
      activeCell: { row: 0, col: 0 },
    });

    // Step 1: Ctrl+Down from row 0
    // Walking data block (Case 4). Rows 0,1,2 have data.
    // Row 3 is hidden → boundary. Stops at row 2.
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 2, col: 0 });

    // Step 2: Ctrl+Down from row 2
    // Row 2 has data. Next (row 3) is hidden → stays at row 2.
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 2, col: 0 });

    // Step 3: Navigate past hidden rows manually with ArrowDown
    // Regular ArrowDown from row 2 → skips hidden 3,4 → row 5
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 5, col: 0 });

    // Step 4: Ctrl+Down from row 5
    // Row 5 has data, row 6 has data (Case 4: walk data).
    // Row 7 is empty → stops at row 6 (last data before empty).
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 6, col: 0 });

    // Step 5: Ctrl+Down from row 6
    // Row 6 has data, row 7 is empty (Case 3: data→empty, jump to next data).
    // Scans empty rows until row 8 (has data) → lands on row 8.
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 8, col: 0 });
  });
});

// =============================================================================
// 9. Hidden columns + Ctrl+Right
// =============================================================================

describe('Hidden columns + Ctrl+Right', () => {
  it('stops at last visible column before hidden boundary in data block', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '0,1': 'b',
        '0,2': 'c', // hidden
        '0,3': 'd', // hidden
        '0,4': 'e',
        '0,5': 'f',
      },
      hiddenCols: [2, 3],
      activeCell: { row: 0, col: 0 },
    });

    // Ctrl+Right from col 0: walking data block.
    // Col 0 has data, col 1 has data (Case 4: walk contiguous).
    // Col 2 is hidden → boundary. Stops at col 1.
    await sim.pressKey('ArrowRight', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });
  });

  it('Ctrl+Right from boundary stays put when next col is hidden', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '0,1': 'b',
        '0,2': 'c', // hidden
        '0,3': 'd', // hidden
        '0,4': 'e',
        '0,5': 'f',
      },
      hiddenCols: [2, 3],
      activeCell: { row: 0, col: 1 },
    });

    // Ctrl+Right from col 1: next (col 2) is hidden → stays at col 1.
    await sim.pressKey('ArrowRight', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });
  });

  it('regular ArrowRight skips hidden columns', () => {
    sim = createIntegrationSimulator({
      hiddenCols: [2, 3],
      activeCell: { row: 0, col: 1 },
    });

    // ArrowRight from col 1 → skips hidden 2,3 → col 4
    sim.pressKey('ArrowRight');
    expect(sim.activeCell()).toEqual({ row: 0, col: 4 });
  });
});
