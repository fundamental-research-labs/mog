/**
 * Shift+Arrow Selection Extension Tests
 *
 * Integration-level tests for Shift+Arrow key behavior across the full
 * GridEditingSystem via the GridInteractionSimulator.
 *
 * These tests verify that:
 * - Shift+Arrow extends the selection range from the anchor
 * - Repeated Shift+Arrow keeps extending (no oscillation bug)
 * - Mixed directions correctly grow/shrink the range
 * - Ctrl+Shift+Arrow extends by jump amount
 *
 * @see ../../machines/selection/__tests__/extend-selection.test.ts - Unit-level tests
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Shift+Arrow Selection Extension', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Shift+Down from B5 extends down
  // ---------------------------------------------------------------------------

  it('Shift+Down from B5 extends selection downward', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Shift+Down to extend
    sim.arrow('down', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);

    // Range should extend from row 4 to row 5
    expect(ranges[0]).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 5,
      endCol: 1,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Repeated Shift+Down keeps extending
  // ---------------------------------------------------------------------------

  it('repeated Shift+Down extends by 3 rows', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // 3x Shift+Down
    sim.arrow('down', { shift: true });
    sim.arrow('down', { shift: true });
    sim.arrow('down', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);

    // Range should extend from row 4 to row 7 (3 rows down)
    expect(ranges[0]).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 7,
      endCol: 1,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Shift+Up after Shift+Down shrinks back
  // ---------------------------------------------------------------------------

  it('Shift+Up after Shift+Down shrinks selection by 1 row', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // 2x Shift+Down
    sim.arrow('down', { shift: true });
    sim.arrow('down', { shift: true });

    // Verify extended to row 6
    expect(sim.selectionRanges()[0]).toMatchObject({
      startRow: 4,
      endRow: 6,
    });

    // 1x Shift+Up (should shrink back)
    sim.arrow('up', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);

    // Range should shrink back: rows 4 to 5
    expect(ranges[0]).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 5,
      endCol: 1,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: Shift+Right extends column
  // ---------------------------------------------------------------------------

  it('Shift+Right extends selection by one column', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.arrow('right', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);

    expect(ranges[0]).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 4,
      endCol: 2,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Ctrl+Shift+Down jumps and extends
  // ---------------------------------------------------------------------------

  it('Ctrl+Shift+Down extends selection by jump amount', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Ctrl+Shift+Down jumps to the boundary (end of data or end of grid)
    sim.arrow('down', { shift: true, ctrl: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);

    // The range should extend downward. With an empty grid, ctrl+down typically
    // jumps to the maximum row. The exact boundary depends on the grid size
    // configured in the selection machine. We just verify it extended beyond row 5.
    expect(ranges[0].startRow).toBe(4);
    expect(ranges[0].startCol).toBe(1);
    expect(ranges[0].endRow).toBeGreaterThan(5);
    expect(ranges[0].endCol).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Shift+Arrow from single cell creates range
  // ---------------------------------------------------------------------------

  it('Shift+Right from single cell creates range with anchor', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Verify starts as single cell
    expect(sim.selectionRanges()[0]).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 4,
      endCol: 1,
    });

    // Shift+Right creates a 2-cell range
    sim.arrow('right', { shift: true });

    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);

    // Range from (4,1) to (4,2)
    expect(ranges[0]).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 4,
      endCol: 2,
    });

    // Anchor should be at the starting cell
    const anchor = sim.anchor();
    expect(anchor).toEqual({ row: 4, col: 1 });
  });
});
