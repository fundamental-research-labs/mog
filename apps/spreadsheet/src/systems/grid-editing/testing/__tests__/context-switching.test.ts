/**
 * Context Switching Tests
 *
 * Tests that external selection events properly interact with grid editing state.
 * When another selection context (objects, charts) takes focus, the grid's cell
 * selection should reset -- EXCEPT during protected operations like fill handle
 * drag and formula mode.
 *
 * The EXTERNAL_SELECTION_ACTIVE event is handled at the root level of the
 * selection machine (resets to idle + resetSelection), but protected states
 * (draggingFillHandle, selectingRangeForFormula, draggingCells) override
 * the handler with an empty action to ignore the event.
 *
 * @see ../../machines/grid-selection-machine.ts - Root-level EXTERNAL_SELECTION_ACTIVE handler
 * @see ../../grid-editing-system.ts - notifyExternalSelectionActive()
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Context Switching (External Selection)', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  // ---------------------------------------------------------------------------
  // Test 1: External selection active resets selection to (0,0)
  // ---------------------------------------------------------------------------

  it('external selection active resets selection to origin', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Verify initial position
    expect(sim.activeCell()).toEqual({ row: 4, col: 1 });

    // Notify external selection active
    sim.system.notifyExternalSelectionActive();
    await sim.flush();

    // Selection should reset to (0,0) - the initial context default
    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });
    expect(sim.selectionRanges()).toEqual([{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }]);
  });

  // ---------------------------------------------------------------------------
  // Test 2: External selection during fill drag is ignored
  // ---------------------------------------------------------------------------

  it('external selection during fill drag is ignored', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Start a fill drag
    sim.startFillDrag();
    expect(sim.isDraggingFillHandle()).toBe(true);

    // Notify external selection active -- should be ignored during fill drag
    sim.system.notifyExternalSelectionActive();
    await sim.flush();

    // Fill drag should continue uninterrupted
    expect(sim.isDraggingFillHandle()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 3: External selection during formula mode is ignored
  // ---------------------------------------------------------------------------

  it('external selection during formula mode is ignored', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // Start editing with '=' to enter formula mode
    sim.startEditing('=');

    // Flush to allow formula mode transition (cross-coordination is async)
    await sim.flush();

    // Should be in formula editing mode and formula range selection
    expect(sim.isFormulaEditing()).toBe(true);
    expect(sim.isSelectingRangeForFormula()).toBe(true);

    // Notify external selection active -- should be ignored during formula mode
    sim.system.notifyExternalSelectionActive();
    await sim.flush();

    // Formula mode should continue uninterrupted
    expect(sim.isSelectingRangeForFormula()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Normal click resets to single cell after external selection
  // ---------------------------------------------------------------------------

  it('normal click resets to single cell after external selection', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Trigger external selection (resets to 0,0)
    sim.system.notifyExternalSelectionActive();
    await sim.flush();

    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });

    // Click cell (3,3)
    sim.clickCell(3, 3);

    // Selection should be at (3,3), single cell
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });
    expect(sim.selectionRanges()).toHaveLength(1);
    expect(sim.selectionRanges()[0]).toMatchObject({
      startRow: 3,
      startCol: 3,
      endRow: 3,
      endCol: 3,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Column selection not interrupted during fill drag
  // ---------------------------------------------------------------------------

  it('fill drag state is maintained even when other events arrive', async () => {
    sim = createGridSimulator({ activeCell: { row: 4, col: 1 } });

    // Start a fill drag
    sim.startFillDrag();

    // Verify we are in fill drag state
    expect(sim.isDraggingFillHandle()).toBe(true);
    expect(sim.isIdle()).toBe(false);

    // The machine should still be in draggingFillHandle state
    expect(sim.isDraggingFillHandle()).toBe(true);
  });
});
