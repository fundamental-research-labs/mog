/**
 * Integration Test: Commit-Navigation Edge Cases
 *
 * Verifies edge cases combining editing commits with navigation.
 * These tests exercise the full commit-then-move pipeline including
 * boundary clamping, rapid cycling, click-away interception, cancel
 * recovery, formula→navigation transitions, and range→edit→commit flows.
 *
 * @see coordination/editor-commit-coordination.ts
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
// 1. Commit then immediate arrow
// =============================================================================

describe('Commit then immediate arrow', () => {
  it('edit, commit down, then ArrowRight moves correctly after commit', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 3, col: 3 },
    });

    // Edit and commit down
    sim.startEditing('value');
    sim.commitEdit('down');
    await sim.flush();

    // Should have moved down to (4,3)
    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 4, col: 3 });

    // Now press ArrowRight (not editing, pure navigation)
    sim.pressKey('ArrowRight');
    expect(sim.activeCell()).toEqual({ row: 4, col: 4 });
  });
});

// =============================================================================
// 2. Commit up at row 0 (boundary clamping)
// =============================================================================

describe('Commit up at row 0', () => {
  it('commit up from row 0 stays at row 0', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 2 },
    });

    sim.startEditing('top-edge');
    sim.commitEdit('up');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    // Can't go above row 0, should stay at row 0
    expect(sim.activeCell()).toEqual({ row: 0, col: 2 });
  });
});

// =============================================================================
// 3. Commit left at col 0 (boundary clamping)
// =============================================================================

describe('Commit left at col 0', () => {
  it('commit left from col 0 stays at col 0', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 5, col: 0 },
    });

    sim.startEditing('left-edge');
    sim.commitEdit('left');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    // Can't go left of col 0, should stay at col 0
    expect(sim.activeCell()).toEqual({ row: 5, col: 0 });
  });
});

// =============================================================================
// 4. Rapid commit cycle (5 consecutive edit→commit→flush)
// =============================================================================

describe('Rapid commit cycle', () => {
  it('5 consecutive edit-commit-down cycles increment row correctly', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 0 },
    });

    for (let i = 0; i < 5; i++) {
      sim.startEditing(`value-${i}`);
      sim.commitEdit('down');
      await sim.flush();
      expect(sim.isEditing()).toBe(false);
      expect(sim.activeCell()).toEqual({ row: i + 1, col: 0 });
    }

    // After 5 cycles starting from row 0, should be at row 5
    expect(sim.activeCell()).toEqual({ row: 5, col: 0 });
  });

  it('5 consecutive edit-commit-right cycles increment col correctly', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 2, col: 0 },
    });

    for (let i = 0; i < 5; i++) {
      sim.startEditing(`col-${i}`);
      sim.commitEdit('right');
      await sim.flush();
      expect(sim.isEditing()).toBe(false);
      expect(sim.activeCell()).toEqual({ row: 2, col: i + 1 });
    }

    expect(sim.activeCell()).toEqual({ row: 2, col: 5 });
  });
});

// =============================================================================
// 5. Click-away during edit (editing interception)
// =============================================================================

describe('Click-away during edit', () => {
  it('clicking another cell while editing commits and moves to clicked cell', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 2, col: 2 },
    });

    sim.startEditing('editing-here');
    expect(sim.isEditing()).toBe(true);

    // Click cell (5,5) while editing — should trigger commit-then-move
    sim.clickCell(5, 5);
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 5, col: 5 });
  });
});

// =============================================================================
// 6. Cancel then navigate
// =============================================================================

describe('Cancel then navigate', () => {
  it('cancel edit then ArrowDown moves normally from original cell', () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 3, col: 3 },
    });

    sim.startEditing('will-cancel');
    expect(sim.isEditing()).toBe(true);

    sim.cancelEdit();
    expect(sim.isEditing()).toBe(false);
    // Should still be at original cell
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });

    // Now navigate down normally
    sim.pressKey('ArrowDown');
    expect(sim.activeCell()).toEqual({ row: 4, col: 3 });
  });

  it('cancel edit then ArrowRight moves normally from original cell', () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 1, col: 1 },
    });

    sim.startEditing('cancel-me');
    sim.cancelEdit();

    sim.pressKey('ArrowRight');
    expect(sim.activeCell()).toEqual({ row: 1, col: 2 });
  });
});

// =============================================================================
// 7. Edit formula then commit then navigate
// =============================================================================

describe('Edit formula then commit then navigate', () => {
  it('formula commit down then Ctrl+Arrow transitions cleanly', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': '1',
        '1,0': '2',
        '2,0': '3',
        '3,0': '4',
        '4,0': '5',
      },
      activeCell: { row: 0, col: 0 },
    });

    // Start formula editing
    sim.startEditing('=A1+B1');
    expect(sim.isFormulaEditing()).toBe(true);

    // Commit down
    sim.commitEdit('down');
    await sim.flush();

    // Should have exited formula mode and moved down
    expect(sim.isEditing()).toBe(false);
    expect(sim.isFormulaEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });

    // Ctrl+Down should now work as pure navigation (data-edge jump)
    await sim.pressKey('ArrowDown', { ctrl: true });
    // From row 1 in a data block (rows 0-4 have data in col 0),
    // Ctrl+Down should jump to the end of the data block at row 4
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });
});

// =============================================================================
// 8. Commit direction after Shift+Arrow range
// =============================================================================

describe('Commit direction after Shift+Arrow range', () => {
  it('Shift+Down to create range, then edit, commit right moves from active cell', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 2, col: 2 },
    });

    // Create a range with Shift+Down (extends selection from row 2 to row 4)
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Verify we have a multi-row range
    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startRow).toBe(2);
    expect(ranges[0].endRow).toBe(4);

    // Active cell should still be at the anchor (2,2)
    expect(sim.activeCell()).toEqual({ row: 2, col: 2 });

    // Start editing (this is on the active cell)
    sim.startEditing('range-edit');
    expect(sim.isEditing()).toBe(true);

    // Commit right — should move right from the active cell position
    sim.commitEdit('right');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 2, col: 3 });
  });
});

// =============================================================================
// 9. Multiple edits same cell
// =============================================================================

describe('Multiple edits same cell', () => {
  it('edit at (0,0) commit none, edit again, commit down', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 0 },
    });

    // First edit: commit with none (stays in place)
    sim.startEditing('first');
    sim.commitEdit('none');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });

    // Second edit at same cell: commit down
    sim.startEditing('second');
    sim.commitEdit('down');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });
  });

  it('three edits at same cell with none, then commit right', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 3, col: 3 },
    });

    // Edit 1: commit none
    sim.startEditing('a');
    sim.commitEdit('none');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });

    // Edit 2: commit none
    sim.startEditing('b');
    sim.commitEdit('none');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });

    // Edit 3: commit right
    sim.startEditing('c');
    sim.commitEdit('right');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 3, col: 4 });
  });
});
