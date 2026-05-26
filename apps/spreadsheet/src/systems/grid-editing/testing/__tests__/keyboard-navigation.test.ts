/**
 * Keyboard Navigation Tests (GridInteractionSimulator)
 *
 * Full-system integration tests for keyboard navigation using the
 * GridInteractionSimulator. Tests arrow keys, Home/End, Page Up/Down,
 * Tab, and Enter navigation.
 *
 * These are synchronous selection commands -- no flush() needed.
 *
 * @see ../grid-simulator.ts
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// TEST SETUP
// =============================================================================

let sim: GridSimulator;

afterEach(() => {
  sim?.destroy();
});

// =============================================================================
// ARROW KEY NAVIGATION
// =============================================================================

describe('Arrow key navigation', () => {
  it('arrow down moves active cell down by one row', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('down');

    expect(sim.activeCell()).toEqual({ row: 5, col: 1 });
  });

  it('arrow up moves active cell up by one row', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('up');

    expect(sim.activeCell()).toEqual({ row: 3, col: 1 });
  });

  it('arrow left moves active cell left by one column', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('left');

    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('arrow right moves active cell right by one column', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('right');

    expect(sim.activeCell()).toEqual({ row: 4, col: 2 });
  });

  it('arrow up from row 0 stays at row 0 (clamped)', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 3 } });

    sim.arrow('up');

    expect(sim.activeCell()).toEqual({ row: 0, col: 3 });
  });

  it('arrow left from column 0 stays at column 0 (clamped)', () => {
    sim = createGridSimulator({ activeCell: { row: 5, col: 0 } });

    sim.arrow('left');

    expect(sim.activeCell()).toEqual({ row: 5, col: 0 });
  });

  it('selection range collapses to single cell after arrow move', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('down');

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 5,
      startCol: 1,
      endRow: 5,
      endCol: 1,
    });
  });
});

// =============================================================================
// HOME / END NAVIGATION
// =============================================================================

describe('Home / End navigation', () => {
  it('Home moves to column 0 of current row', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 5 } });

    sim.home();

    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('Ctrl+Home moves to cell (0, 0)', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 5 } });

    sim.home({ ctrl: true });

    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });
  });

  it('End moves to last column of current row', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 5 } });

    sim.end();

    // MAX_COLS = 16384, so last column index = 16383
    expect(sim.activeCell().row).toBe(4);
    expect(sim.activeCell().col).toBe(16383);
  });

  it('Ctrl+End moves to last cell of sheet', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 5 } });

    sim.end({ ctrl: true });

    // MAX_ROWS = 1048576, MAX_COLS = 16384
    expect(sim.activeCell()).toEqual({ row: 1048575, col: 16383 });
  });
});

// =============================================================================
// TAB NAVIGATION
// =============================================================================

describe('Tab navigation', () => {
  it('Tab moves right by one column', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.tab();

    expect(sim.activeCell()).toEqual({ row: 4, col: 2 });
  });

  it('Shift+Tab moves left by one column', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.tab({ shift: true });

    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('Shift+Tab from column 0 stays at column 0', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 0 } });

    sim.tab({ shift: true });

    expect(sim.activeCell().col).toBe(0);
  });
});

// =============================================================================
// ENTER NAVIGATION
// =============================================================================

describe('Enter navigation', () => {
  it('Enter moves down by one row', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.enter();

    expect(sim.activeCell()).toEqual({ row: 5, col: 1 });
  });

  it('Shift+Enter moves up by one row', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.enter({ shift: true });

    expect(sim.activeCell()).toEqual({ row: 3, col: 1 });
  });

  it('Shift+Enter from row 0 stays at row 0', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 3 } });

    sim.enter({ shift: true });

    expect(sim.activeCell().row).toBe(0);
  });
});

// =============================================================================
// PAGE UP / PAGE DOWN NAVIGATION
// =============================================================================

describe('Page Up / Page Down navigation', () => {
  it('PageDown moves down by visible rows', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.pageDown(20);

    expect(sim.activeCell()).toEqual({ row: 24, col: 1 });
  });

  it('PageUp moves up by visible rows', () => {
    sim = createGridSimulator({ activeCell: { row: 24, col: 1 } });

    sim.pageUp(20);

    expect(sim.activeCell()).toEqual({ row: 4, col: 1 });
  });

  it('PageUp from near top clamps to row 0', () => {
    sim = createGridSimulator({ activeCell: { row: 5, col: 2 } });

    sim.pageUp(20);

    expect(sim.activeCell()).toEqual({ row: 0, col: 2 });
  });

  it('PageDown uses default visible rows of 20', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.pageDown();

    expect(sim.activeCell()).toEqual({ row: 20, col: 0 });
  });

  it('PageUp uses default visible rows of 20', () => {
    sim = createGridSimulator({ activeCell: { row: 30, col: 0 } });

    sim.pageUp();

    expect(sim.activeCell()).toEqual({ row: 10, col: 0 });
  });
});

// =============================================================================
// SELECT ALL
// =============================================================================

describe('Select All', () => {
  it('selectAll selects entire sheet range', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.selectAll();

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 0,
      startCol: 0,
      endRow: 1048575,
      endCol: 16383,
    });
  });
});

// =============================================================================
// SHIFT+ARROW (EXTEND SELECTION)
// =============================================================================

describe('Shift+Arrow extends selection', () => {
  it('Shift+Down extends selection range downward', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('down', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    // Range should span from original row to new row
    const range = ranges[0];
    expect(range.startCol).toBe(1);
    expect(range.endCol).toBe(1);
    // The range should now cover 2 rows
    const rowSpan = Math.abs(range.endRow - range.startRow) + 1;
    expect(rowSpan).toBe(2);
  });

  it('Shift+Right extends selection range rightward', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('right', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    const range = ranges[0];
    expect(range.startRow).toBe(4);
    expect(range.endRow).toBe(4);
    const colSpan = Math.abs(range.endCol - range.startCol) + 1;
    expect(colSpan).toBe(2);
  });
});
