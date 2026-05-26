/**
 * Integration Test: Data-Edge Navigation (Ctrl+Arrow)
 *
 * Verifies that Ctrl+Arrow navigates to data boundaries using real cell data
 * from the test context. The handler calls findDataEdge() with a real
 * createCellValueGetter().
 *
 * @see actions/handlers/selection/data-edge.ts
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
// Ctrl+Arrow Data-Edge Navigation
// =============================================================================

describe('Ctrl+Arrow data-edge navigation', () => {
  it('jumps to end of data block going down', async () => {
    // A1:A3 have data, A4 empty, A5:A7 have data
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        // row 3 is empty
        '4,0': 'd',
        '5,0': 'e',
        '6,0': 'f',
      },
      activeCell: { row: 0, col: 0 },
    });

    // From A1 (data), Ctrl+Down → jumps to A3 (end of first data block)
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 2, col: 0 });
  });

  it('jumps from data to empty boundary going down', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '4,0': 'd',
        '5,0': 'e',
        '6,0': 'f',
      },
      activeCell: { row: 2, col: 0 },
    });

    // From A3 (end of data), Ctrl+Down → jumps to A5 (start of next data block)
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('jumps from empty cell to next data block going down', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '4,0': 'd',
        '5,0': 'e',
        '6,0': 'f',
      },
      activeCell: { row: 3, col: 0 },
    });

    // From A4 (empty), Ctrl+Down → jumps to A5 (start of next data block)
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('jumps to end of data block going up', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
        '4,0': 'd',
        '5,0': 'e',
        '6,0': 'f',
      },
      activeCell: { row: 6, col: 0 },
    });

    // From A7 (data), Ctrl+Up → jumps to A5 (start of data block)
    await sim.pressKey('ArrowUp', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 4, col: 0 });
  });

  it('jumps horizontally to end of data block', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '0,1': 'b',
        '0,2': 'c',
        // col 3 is empty
      },
      activeCell: { row: 0, col: 0 },
    });

    // From A1 (data), Ctrl+Right → jumps to C1 (end of data block)
    await sim.pressKey('ArrowRight', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 0, col: 2 });
  });
});

// =============================================================================
// Ctrl+Shift+Arrow extends selection to data boundary
// =============================================================================

describe('Ctrl+Shift+Arrow extends to data boundary', () => {
  it('extends selection to end of data block', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        '2,0': 'c',
      },
      activeCell: { row: 0, col: 0 },
    });

    // Ctrl+Shift+Down → extends selection from A1 to A3
    await sim.pressKey('ArrowDown', { ctrl: true, shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    // Selection should span from row 0 to row 2
    expect(ranges[0].startRow).toBe(0);
    expect(ranges[0].endRow).toBe(2);
  });

  it('extends from empty cell to next data block', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '2,0': 'a',
        '3,0': 'b',
        '4,0': 'c',
      },
      activeCell: { row: 0, col: 0 },
    });

    // From empty A1, Ctrl+Shift+Down → extends to A3 (start of data)
    await sim.pressKey('ArrowDown', { ctrl: true, shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startRow).toBe(0);
    expect(ranges[0].endRow).toBe(2);
  });
});

// =============================================================================
// Data-edge across gap
// =============================================================================

describe('Data-edge across gap', () => {
  it('Ctrl+Down from end of data jumps to start of next data block', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'a',
        '1,0': 'b',
        // rows 2-4 empty
        '5,0': 'c',
        '6,0': 'd',
      },
      activeCell: { row: 1, col: 0 },
    });

    // From A2 (end of first block), Ctrl+Down → jumps to A6 (start of next block)
    await sim.pressKey('ArrowDown', { ctrl: true });
    expect(sim.activeCell()).toEqual({ row: 5, col: 0 });
  });
});
