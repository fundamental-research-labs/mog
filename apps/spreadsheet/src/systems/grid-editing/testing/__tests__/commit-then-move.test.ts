/**
 * Commit-Then-Move Tests
 *
 * Tests the editing input interception pattern: when a user clicks another
 * cell while editing, the editor commits first, then selection moves to
 * the clicked cell.
 *
 * This is THE critical coordination that prevents editor-selection divergence.
 * The flow is:
 * 1. handleCellClick intercepts the click (returns true)
 * 2. Editor commits with direction='none'
 * 3. After commit completes (via async subscription), selection moves to clicked cell
 *
 * NOTE: The editor machine goes through validating -> committing -> inactive.
 * In the headless simulator, there is no external coordinator to send
 * VALIDATION_SUCCESS and COMMIT_COMPLETE events. We must send these manually
 * via the raw system access to drive the editor through the commit pipeline.
 *
 * @see ../../coordination/cross-coordination.ts - setupEditingInputInterception
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Drive the editor through validation -> committing -> inactive.
 *
 * In the real app, the coordinator sends VALIDATION_SUCCESS after checking
 * the value and COMMIT_COMPLETE after writing to Yjs. In headless testing,
 * we simulate this by sending the events directly.
 */
async function completeCommit(sim: GridSimulator): Promise<void> {
  const editorActor = sim.system.access.actors.editor;

  // After clickCell triggers COMMIT, the editor is in 'validating'.
  // Send VALIDATION_SUCCESS to move to 'committing'.
  editorActor.send({ type: 'VALIDATION_SUCCESS' });
  await sim.flush();

  // Now the editor is in 'committing'.
  // Send COMMIT_COMPLETE to move to 'inactive'.
  editorActor.send({ type: 'COMMIT_COMPLETE' });
  await sim.flush();
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Commit-Then-Move (Editing Input Interception)', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Click cell while editing commits first, then moves
  // ---------------------------------------------------------------------------

  it('click cell while editing commits first then moves selection', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // Start editing at (0,0)
    sim.startEditing('hello');
    expect(sim.isEditing()).toBe(true);

    // Click cell (5,5) while editing - this triggers commit-then-move
    sim.clickCell(5, 5);

    // Drive editor through the commit pipeline
    await completeCommit(sim);

    // Editor should be inactive after commit
    expect(sim.isEditing()).toBe(false);

    // Selection should have moved to the clicked cell (5,5)
    expect(sim.activeCell()).toEqual({ row: 5, col: 5 });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Shift+click while editing extends selection after commit
  // ---------------------------------------------------------------------------

  it('shift+click while editing commits then extends selection', async () => {
    sim = createGridSimulator({ activeCell: { row: 2, col: 2 } });

    // Start editing at (2,2)
    sim.startEditing('test');
    expect(sim.isEditing()).toBe(true);

    // Shift+click (5,5) while editing
    sim.clickCell(5, 5, { shift: true });

    // Drive editor through the commit pipeline
    await completeCommit(sim);

    // Editor should be inactive
    expect(sim.isEditing()).toBe(false);

    // Selection should extend to include both cells
    const ranges = sim.selectionRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startRow: 2,
      startCol: 2,
      endRow: 5,
      endCol: 5,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Click during formula enter mode inserts reference (no commit)
  // ---------------------------------------------------------------------------

  it('click during formula enter mode inserts reference instead of committing', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // Start editing with '=' to enter formula mode
    sim.startEditing('=');

    // Flush to allow formula mode transition (cross-coordination is async)
    await sim.flush();

    // Should be in formula editing mode
    expect(sim.isEditing()).toBe(true);
    expect(sim.isFormulaEditing()).toBe(true);

    // Click cell (2,2) during formula editing enter mode
    sim.clickCell(2, 2);

    // Flush again
    await sim.flush();

    // Editor should STILL be active (click inserts reference, not commit)
    expect(sim.isEditing()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Multiple commits keep selection moving correctly
  // ---------------------------------------------------------------------------

  it('multiple commit-then-move sequences end at correct position', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    // First edit cycle: edit (0,0), click (3,3)
    sim.startEditing('first');
    sim.clickCell(3, 3);
    await completeCommit(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });

    // Second edit cycle: edit (3,3), click (6,6)
    sim.startEditing('second');
    expect(sim.isEditing()).toBe(true);

    sim.clickCell(6, 6);
    await completeCommit(sim);

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 6, col: 6 });
  });
});
