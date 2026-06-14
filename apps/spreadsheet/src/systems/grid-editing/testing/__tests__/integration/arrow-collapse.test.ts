/**
 * Integration Test: Arrow Key Collapse
 *
 * Verifies that arrow keys from a multi-cell selection move from the active
 * cell and collapse the selection at that destination.
 *
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
// Arrow Collapse from Multi-Cell Selection
// =============================================================================

describe('Arrow collapse from multi-cell selection', () => {
  it('ArrowDown steps down from the active cell and collapses there', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Create a multi-cell selection B2:D5 via shift+arrows
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Verify multi-cell selection exists (B2:D5 = rows 1-4, cols 1-3)
    let ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ startRow: 1, startCol: 1, endRow: 4, endCol: 3 });

    // Arrow down → step one row from active cell and collapse there.
    sim.pressKey('ArrowDown');

    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(sim.activeCell()).toEqual({ row: 2, col: 1 });
    // Should be single cell
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
    expect(ranges[0].startCol).toBe(ranges[0].endCol);
  });

  it('ArrowUp steps up from the active cell and collapses there', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Create selection B2:D5
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Arrow up → step one row from active cell and collapse there.
    sim.pressKey('ArrowUp');

    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });
    const ranges = sim.selectionRanges();
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
  });

  it('ArrowLeft steps left from the active cell and collapses there', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Create selection B2:D5
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Arrow left → step one column from active cell and collapse there.
    sim.pressKey('ArrowLeft');

    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });
    const ranges = sim.selectionRanges();
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
    expect(ranges[0].startCol).toBe(ranges[0].endCol);
  });

  it('ArrowRight steps right from the active cell and collapses there', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Create selection B2:D5
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Arrow right → step one column from active cell and collapse there.
    sim.pressKey('ArrowRight');

    expect(sim.activeCell()).toEqual({ row: 1, col: 2 });
    const ranges = sim.selectionRanges();
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
    expect(ranges[0].startCol).toBe(ranges[0].endCol);
  });
});

// =============================================================================
// Single-Cell Selection → Normal Movement
// =============================================================================

describe('Single-cell selection → normal movement', () => {
  it('ArrowDown from single cell moves one cell down', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 3, col: 2 } });

    sim.pressKey('ArrowDown');

    expect(sim.activeCell()).toEqual({ row: 4, col: 2 });
  });

  it('ArrowUp from single cell moves one cell up', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 3, col: 2 } });

    sim.pressKey('ArrowUp');

    expect(sim.activeCell()).toEqual({ row: 2, col: 2 });
  });

  it('ArrowLeft from single cell moves one cell left', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 3, col: 2 } });

    sim.pressKey('ArrowLeft');

    expect(sim.activeCell()).toEqual({ row: 3, col: 1 });
  });

  it('ArrowRight from single cell moves one cell right', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 3, col: 2 } });

    sim.pressKey('ArrowRight');

    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });
  });
});
