/**
 * Integration Test: Arrow Key Collapse
 *
 * Verifies that arrow keys from a multi-cell selection collapse to the edge
 * in the direction of the arrow. This is dispatched through real action
 * handlers (movement.ts → getCollapseTarget), NOT raw commands.
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
  it('ArrowDown collapses to bottom edge at active cell column', () => {
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

    // Arrow down → collapse to bottom edge at active cell's column
    sim.pressKey('ArrowDown');

    ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    // Active cell was at (1,1), bottom edge is row 4
    expect(sim.activeCell()).toEqual({ row: 4, col: 1 });
    // Should be single cell
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
    expect(ranges[0].startCol).toBe(ranges[0].endCol);
  });

  it('ArrowUp collapses to top edge at active cell column', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Create selection B2:D5
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Arrow up → collapse to top edge
    sim.pressKey('ArrowUp');

    expect(sim.activeCell()).toEqual({ row: 1, col: 1 });
    const ranges = sim.selectionRanges();
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
  });

  it('ArrowLeft collapses to left edge at active cell row', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Create selection B2:D5
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Arrow left → collapse to left edge
    sim.pressKey('ArrowLeft');

    expect(sim.activeCell()).toEqual({ row: 1, col: 1 });
    const ranges = sim.selectionRanges();
    expect(ranges[0].startRow).toBe(ranges[0].endRow);
    expect(ranges[0].startCol).toBe(ranges[0].endCol);
  });

  it('ArrowRight collapses to right edge at active cell row', () => {
    sim = createIntegrationSimulator({ activeCell: { row: 1, col: 1 } });

    // Create selection B2:D5
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });

    // Arrow right → collapse to right edge
    sim.pressKey('ArrowRight');

    expect(sim.activeCell()).toEqual({ row: 1, col: 3 });
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
