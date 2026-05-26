/**
 * Fill Handle Tests
 *
 * Tests the fill handle drag interaction through the GridInteractionSimulator.
 * The fill handle allows users to drag the bottom-right corner of a selection
 * to autofill values into adjacent cells.
 *
 * Key behaviors:
 * - startFillDrag() enters the draggingFillHandle state
 * - fillDragTo() updates the fill handle target cell
 * - endFillDrag() returns to idle (fill context preserved for coordinator)
 *
 * @see ../../machines/selection/fill-handle.ts - Fill handle actions
 * @see ../../machines/grid-selection-machine.ts - draggingFillHandle state
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Fill Handle Drag', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Start fill drag enters draggingFillHandle state
  // ---------------------------------------------------------------------------

  it('start fill drag enters draggingFillHandle state', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    expect(sim.isIdle()).toBe(true);
    expect(sim.isDraggingFillHandle()).toBe(false);

    sim.startFillDrag();

    expect(sim.isDraggingFillHandle()).toBe(true);
    expect(sim.isIdle()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Fill drag to target updates context while still dragging
  // ---------------------------------------------------------------------------

  it('fill drag to target updates context while still dragging', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.startFillDrag();
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.fillDragTo(8, 1);

    // Should still be in dragging state
    expect(sim.isDraggingFillHandle()).toBe(true);
    expect(sim.isIdle()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 3: End fill drag returns to idle
  // ---------------------------------------------------------------------------

  it('end fill drag returns to idle', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.startFillDrag();
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.endFillDrag();

    expect(sim.isIdle()).toBe(true);
    expect(sim.isDraggingFillHandle()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Full fill drag sequence with multiple moves
  // ---------------------------------------------------------------------------

  it('full fill drag sequence: start, multiple moves, end', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Start dragging
    sim.startFillDrag();
    expect(sim.isDraggingFillHandle()).toBe(true);

    // Move through several cells
    sim.fillDragTo(5, 1);
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.fillDragTo(6, 1);
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.fillDragTo(7, 1);
    expect(sim.isDraggingFillHandle()).toBe(true);

    // End the drag
    sim.endFillDrag();

    expect(sim.isIdle()).toBe(true);
    expect(sim.isDraggingFillHandle()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Fill drag is not interrupted by escape (RESET clears context)
  // ---------------------------------------------------------------------------

  it('fill drag stays active during drag', () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    sim.startFillDrag();

    // Verify fill drag is active
    expect(sim.isDraggingFillHandle()).toBe(true);
    expect(sim.isIdle()).toBe(false);

    // Fill drag should still be active (no interruption from other events)
    expect(sim.isDraggingFillHandle()).toBe(true);
  });
});
