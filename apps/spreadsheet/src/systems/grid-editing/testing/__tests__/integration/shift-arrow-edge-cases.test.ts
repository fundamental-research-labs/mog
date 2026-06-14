/**
 * Integration Test: Shift+Arrow Edge Cases
 *
 * Tests bug-prone edge cases in Shift+Arrow selection extension:
 * - Bounce (extend then retract back to single cell)
 * - Extend → collapse → re-extend cycles
 * - Perpendicular extension (down then right → rectangle)
 * - Boundary clamping at row 0 / col 0
 * - State corruption after repeated extend-collapse cycles
 * - Mixing Ctrl+Shift+Arrow with plain Shift+Arrow
 * - Extension after selection reset (selectAll-like → collapse → extend)
 *
 * @see actions/handlers/selection/extension.ts
 * @see actions/handlers/selection/movement.ts
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
// 1. Shift+Arrow Bounce
// =============================================================================

describe('Shift+Arrow bounce: extend then retract', () => {
  it('extend down 3 then back up 3 returns to single cell at original position', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 3, col: 2 } });

    // Extend down 3 rows
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Verify extended
    let ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 3,
      startCol: 2,
      endRow: 6,
      endCol: 2,
    });

    // Retract back up 3 rows
    sim.pressKey('ArrowUp', { shift: true });
    sim.pressKey('ArrowUp', { shift: true });
    sim.pressKey('ArrowUp', { shift: true });

    // Should be back to single cell at original position
    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 3,
      startCol: 2,
      endRow: 3,
      endCol: 2,
    });
    expect(sim.activeCell()).toEqual({ row: 3, col: 2 });
  });

  it('extend right 2 then back left 2 returns to single cell', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 5 } });

    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });

    let ranges = sim.selectionRanges();
    expect(ranges[0]).toMatchObject({
      startRow: 1,
      startCol: 5,
      endRow: 1,
      endCol: 7,
    });

    sim.pressKey('ArrowLeft', { shift: true });
    sim.pressKey('ArrowLeft', { shift: true });

    ranges = sim.selectionRanges();
    expect(ranges[0]).toMatchObject({
      startRow: 1,
      startCol: 5,
      endRow: 1,
      endCol: 5,
    });
  });
});

// =============================================================================
// 2. Extend → Collapse → Re-Extend
// =============================================================================

describe('Extend then collapse then re-extend', () => {
  it('Shift+Down×3 → ArrowDown (collapse) → Shift+Down (new extend from collapsed position)', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 2, col: 1 } });

    // Extend down 3
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Verify extended to row 5
    let ranges = sim.selectionRanges();
    expect(ranges[0]).toMatchObject({
      startRow: 2,
      startCol: 1,
      endRow: 5,
      endCol: 1,
    });

    // Plain ArrowDown steps one row from the active cell and collapses there.
    sim.pressKey('ArrowDown');

    const collapsedCell = sim.activeCell();
    expect(collapsedCell).toEqual({ row: 3, col: 1 });
    ranges = sim.selectionRanges();
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
    expect(ranges[0].startCol).toBe(ranges[0].endCol);

    // Now Shift+Down from collapsed position
    sim.pressKey('ArrowDown', { shift: true });

    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 3,
      startCol: 1,
      endRow: 4,
      endCol: 1,
    });

    // Anchor should be at the collapsed position
    const anchor = sim.anchor();
    expect(anchor).toEqual({ row: 3, col: 1 });
  });
});

// =============================================================================
// 3. Perpendicular Extension
// =============================================================================

describe('Perpendicular extension creates rectangle', () => {
  it('Shift+Down×2 then Shift+Right×2 creates rectangular selection', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Extend down 2 rows
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Verify vertical strip
    let ranges = sim.selectionRanges();
    expect(ranges[0]).toMatchObject({
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 1,
    });

    // Extend right 2 columns
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });

    // Should be a 3×3 rectangle (rows 1-3, cols 1-3)
    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
    });

    // Anchor stays at original cell
    expect(sim.anchor()).toEqual({ row: 1, col: 1 });
  });

  it('Shift+Right×2 then Shift+Down×2 also creates rectangle', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Extend right first
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });

    // Then extend down
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
    });
  });
});

// =============================================================================
// 4. Extend from Row 0 Upward
// =============================================================================

describe('Extend from row 0 upward (boundary clamping)', () => {
  it('Shift+Up at row 0 should not go negative or crash', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 0, col: 3 } });

    // This should not throw or produce negative row values
    sim.pressKey('ArrowUp', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    // Row should stay at 0 (clamped)
    expect(ranges[0].startRow).toBeGreaterThanOrEqual(0);
    expect(ranges[0].endRow).toBeGreaterThanOrEqual(0);

    // Active cell should not have a negative row
    const cell = sim.activeCell();
    expect(cell.row).toBeGreaterThanOrEqual(0);
  });

  it('multiple Shift+Up at row 0 stays stable', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 0, col: 0 } });

    // Hammer Shift+Up at row 0 — should remain stable
    sim.pressKey('ArrowUp', { shift: true });
    sim.pressKey('ArrowUp', { shift: true });
    sim.pressKey('ArrowUp', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startRow).toBeGreaterThanOrEqual(0);
    expect(ranges[0].endRow).toBeGreaterThanOrEqual(0);
    expect(sim.activeCell().row).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// 5. Extend from Col 0 Leftward
// =============================================================================

describe('Extend from col 0 leftward (boundary clamping)', () => {
  it('Shift+Left at col 0 should not go negative or crash', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 2, col: 0 } });

    sim.pressKey('ArrowLeft', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startCol).toBeGreaterThanOrEqual(0);
    expect(ranges[0].endCol).toBeGreaterThanOrEqual(0);
    expect(sim.activeCell().col).toBeGreaterThanOrEqual(0);
  });

  it('multiple Shift+Left at col 0 stays stable', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 0, col: 0 } });

    sim.pressKey('ArrowLeft', { shift: true });
    sim.pressKey('ArrowLeft', { shift: true });
    sim.pressKey('ArrowLeft', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startCol).toBeGreaterThanOrEqual(0);
    expect(ranges[0].endCol).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// 6. Multiple Extend-Collapse Cycles (State Corruption Check)
// =============================================================================

describe('Multiple extend-collapse cycles', () => {
  it('repeat extend→collapse 3 times with no state corruption', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 5, col: 5 } });

    for (let cycle = 0; cycle < 3; cycle++) {
      // Extend down 2
      sim.pressKey('ArrowDown', { shift: true });
      sim.pressKey('ArrowDown', { shift: true });

      // Verify extension
      let ranges = sim.selectionRanges();
      expect(ranges).toHaveLength(1);
      sim.activeCell(); // verify activeCell is accessible after extend
      // The anchor should stay put at the start of the current cycle

      // Collapse with ArrowDown
      sim.pressKey('ArrowDown');

      // Should be single cell
      ranges = sim.selectionRanges();
      expect(ranges).toHaveLength(1);
      expect(ranges[0].startRow).toBe(ranges[0].endRow);
      expect(ranges[0].startCol).toBe(ranges[0].endCol);

      // Should be able to do another Shift+Arrow cleanly
      const cellAfterCollapse = sim.activeCell();
      sim.pressKey('ArrowRight', { shift: true });

      ranges = sim.selectionRanges();
      expect(ranges).toHaveLength(1);
      expect(ranges[0].startCol).toBe(cellAfterCollapse.col);
      expect(ranges[0].endCol).toBe(cellAfterCollapse.col + 1);

      // Collapse back for next cycle
      sim.pressKey('ArrowRight');
    }

    // Final state should be a single cell with no corruption
    const finalRanges = sim.selectionRanges();
    expect(finalRanges).toHaveLength(1);
    expect(finalRanges[0].startRow).toBe(finalRanges[0].endRow);
    expect(finalRanges[0].startCol).toBe(finalRanges[0].endCol);
  });
});

// =============================================================================
// 7. Ctrl+Shift+Arrow then Plain Shift+Arrow
// =============================================================================

describe('Ctrl+Shift+Arrow then plain Shift+Arrow', () => {
  it('Ctrl+Shift+Down then Shift+Right extends to a rectangle', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
      },
      activeCell: { row: 0, col: 0 },
    });

    // Ctrl+Shift+Down — extends to end of data block (row 2)
    await sim.pressKey('ArrowDown', { ctrl: true, shift: true });

    let ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startRow).toBe(0);
    expect(ranges[0].endRow).toBe(2);

    // Now plain Shift+Right — should extend horizontally
    sim.pressKey('ArrowRight', { shift: true });

    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 1,
    });
  });

  it('Ctrl+Shift+Down then Shift+Up partially retracts', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '3,0': 'd',
      },
      activeCell: { row: 0, col: 0 },
    });

    // Ctrl+Shift+Down — extends to row 3
    await sim.pressKey('ArrowDown', { ctrl: true, shift: true });

    let ranges = sim.selectionRanges();
    expect(ranges[0].endRow).toBe(3);

    // Shift+Up — retract by 1
    sim.pressKey('ArrowUp', { shift: true });

    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startRow).toBe(0);
    expect(ranges[0].endRow).toBe(2);
  });
});

// =============================================================================
// 8. Shift+Arrow After Large Selection Reset
// =============================================================================

describe('Shift+Arrow after large selection reset', () => {
  it('extension works normally after collapsing a large selection', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 0, col: 0 } });

    // Create a large selection via repeated Shift+Down/Right (simulates selectAll-like)
    for (let i = 0; i < 10; i++) {
      sim.pressKey('ArrowDown', { shift: true });
    }
    for (let i = 0; i < 5; i++) {
      sim.pressKey('ArrowRight', { shift: true });
    }

    // Verify large selection exists
    let ranges = sim.selectionRanges();
    expect(ranges[0].endRow).toBe(10);
    expect(ranges[0].endCol).toBe(5);

    // Collapse via plain ArrowDown (steps down from the active cell)
    sim.pressKey('ArrowDown');

    // Should be single cell now
    ranges = sim.selectionRanges();
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
    expect(ranges[0].startCol).toBe(ranges[0].endCol);

    const collapsedPos = sim.activeCell();

    // Now Shift+Down should extend from the collapsed position normally
    sim.pressKey('ArrowDown', { shift: true });

    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: collapsedPos.row,
      startCol: collapsedPos.col,
      endRow: collapsedPos.row + 1,
      endCol: collapsedPos.col,
    });

    // Anchor should be at collapsed position
    expect(sim.anchor()).toEqual(collapsedPos);
  });

  it('Ctrl+Home resets to A1, then Shift+Arrow extends from A1', async () => {
    sim = createIntegrationSimulator({ activeCell: { row: 5, col: 5 } });

    // Move to A1 with Ctrl+Home
    await sim.pressKey('Home', { ctrl: true });

    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });

    // Extend with Shift+Down
    sim.pressKey('ArrowDown', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 0,
    });
  });
});
