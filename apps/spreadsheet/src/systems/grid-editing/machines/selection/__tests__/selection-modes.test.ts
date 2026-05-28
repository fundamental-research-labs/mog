/**
 * Selection-Mode Lifecycle Tests (the related wiring)
 *
 * Drives the selection machine end-to-end (createActor + send) instead of
 * extracting individual assign() functions, because the contract under test
 * spans the priority matrix (KEY_ARROW guards) plus source-aware setSelection
 * plus the SET_MODE / EXIT_ALL_MODES / COMMIT_PENDING transitions. Each test
 * locks one row of the selection-mode contract so a regression in the guard
 * graph fails specifically.
 *
 */

import { createActor } from 'xstate';

import { selectionMachine } from '../../grid-selection-machine';
import { initialSelectionModes } from '../helpers';

// =============================================================================
// HELPERS
// =============================================================================

const cell = (row: number, col: number) => ({ row, col });
const rng = (startRow: number, startCol: number, endRow: number, endCol: number) => ({
  startRow,
  startCol,
  endRow,
  endCol,
});

function startActorAt(activeRow = 0, activeCol = 0) {
  const actor = createActor(selectionMachine);
  actor.start();
  // Plant the initial position via SET_SELECTION (default source: 'user').
  actor.send({
    type: 'SET_SELECTION',
    ranges: [rng(activeRow, activeCol, activeRow, activeCol)],
    activeCell: cell(activeRow, activeCol),
  });
  return actor;
}

// =============================================================================
// TEST 1: literal-bug regression (selection/shift-f8-add-to-selection)
// =============================================================================

describe('selection-mode lifecycle', () => {
  it('1. additive_first_arrow_with_no_committed_collapses_pending_to_new_cell', () => {
    // Reproduces the literal Shift+F8 → arrow bug: with additive on but no
    // committed range yet, an arrow press collapses pendingRange to the new
    // active cell and committedRanges stays empty.
    const actor = startActorAt(2, 2); // C3
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });

    const before = actor.getSnapshot().context;
    expect(before.modes.additive).toBe(true);
    expect(before.committedRanges).toEqual([]);

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.modes.additive).toBe(true);
    expect(after.committedRanges).toEqual([rng(2, 2, 2, 2)]); // original C3 auto-committed
    expect(after.pendingRange).toEqual(rng(2, 3, 2, 3)); // collapsed to D3
    expect(after.activeCell).toEqual(cell(2, 3));
    actor.stop();
  });

  it('2. additive_mode_arrow_preserves_committed_ranges', () => {
    const actor = startActorAt(0, 0);
    // Build a multi-range selection: [A1:A1, B1:B1] then turn additive on
    // such that A1 is committed and B1 is pending.
    actor.send({
      type: 'SET_SELECTION',
      ranges: [rng(0, 0, 0, 0), rng(0, 1, 0, 1)],
      activeCell: cell(0, 1),
    });
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });

    actor.send({ type: 'KEY_ARROW', direction: 'down', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.committedRanges).toEqual([rng(0, 0, 0, 0)]); // untouched
    expect(after.pendingRange).toEqual(rng(1, 1, 1, 1)); // moved
    expect(after.activeCell).toEqual(cell(1, 1));
    actor.stop();
  });

  it('3. additive_mode_shift_arrow_extends_pending_only', () => {
    const actor = startActorAt(0, 0);
    actor.send({
      type: 'SET_SELECTION',
      ranges: [rng(0, 0, 0, 0), rng(2, 2, 2, 2)],
      activeCell: cell(2, 2),
    });
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: true });

    const after = actor.getSnapshot().context;
    expect(after.committedRanges).toEqual([rng(0, 0, 0, 0)]);
    // pendingRange extended from C3 to D3 (anchor stays at C3)
    expect(after.pendingRange.startRow).toBe(2);
    expect(after.pendingRange.startCol).toBe(2);
    expect(after.pendingRange.endRow).toBe(2);
    expect(after.pendingRange.endCol).toBe(3);
    actor.stop();
  });

  it('4. additive_mode_second_toggle_commits_pending_and_starts_new', () => {
    // Excel commit-and-continue: pendingRange moves into committedRanges,
    // a new single-cell pendingRange opens at the active cell, additive stays on.
    const actor = startActorAt(2, 2);
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });
    // Drag-build pending to a 2x2 block
    actor.send({
      type: 'SET_SELECTION',
      ranges: [rng(2, 2, 3, 3)],
      activeCell: cell(2, 2),
    });
    // Re-set additive (it would have been cleared by the user-source set above
    // — we explicitly restore the mode for this scenario).
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });
    actor.send({ type: 'COMMIT_PENDING' });

    const after = actor.getSnapshot().context;
    expect(after.modes.additive).toBe(true);
    expect(after.committedRanges).toEqual([rng(2, 2, 3, 3)]);
    expect(after.pendingRange).toEqual(rng(2, 2, 2, 2)); // new single-cell pending at activeCell
    actor.stop();
  });

  it('5. additive_mode_esc_clears_modes_and_flattens_to_single_range', () => {
    const actor = startActorAt(0, 0);
    actor.send({
      type: 'SET_SELECTION',
      ranges: [rng(0, 0, 0, 0), rng(2, 2, 3, 3)],
      activeCell: cell(2, 2),
    });
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });
    actor.send({ type: 'EXIT_ALL_MODES' });

    const after = actor.getSnapshot().context;
    expect(after.modes).toEqual(initialSelectionModes);
    expect(after.committedRanges).toEqual([]);
    expect(after.pendingRange).toEqual(rng(2, 2, 2, 2)); // single cell at activeCell
    actor.stop();
  });

  // ===========================================================================
  // 6. REMOTE_SELECTION_CHANGED no-op under any mode (parameterized)
  // ===========================================================================

  describe('6. remote_selection_changed_is_a_no_op_under_any_mode', () => {
    type ModeSetup = { name: string; setup: (a: ReturnType<typeof startActorAt>) => void };
    const setups: ModeSetup[] = [
      { name: 'default', setup: () => {} },
      {
        name: 'extend',
        setup: (a) => a.send({ type: 'SET_MODE', mode: 'extend', value: true }),
      },
      {
        name: 'additive (empty committed)',
        setup: (a) => a.send({ type: 'SET_MODE', mode: 'additive', value: true }),
      },
      {
        name: 'additive (non-empty committed)',
        setup: (a) => {
          a.send({
            type: 'SET_SELECTION',
            ranges: [rng(0, 0, 0, 0), rng(2, 2, 2, 2)],
            activeCell: cell(2, 2),
          });
          a.send({ type: 'SET_MODE', mode: 'additive', value: true });
        },
      },
      {
        name: 'end',
        setup: (a) => a.send({ type: 'SET_MODE', mode: 'end', value: true }),
      },
    ];

    for (const { name, setup } of setups) {
      it(`is a no-op when in ${name}`, () => {
        const actor = startActorAt(2, 2);
        setup(actor);
        const before = JSON.parse(
          JSON.stringify({
            committedRanges: actor.getSnapshot().context.committedRanges,
            pendingRange: actor.getSnapshot().context.pendingRange,
            modes: actor.getSnapshot().context.modes,
            activeCell: actor.getSnapshot().context.activeCell,
          }),
        );

        actor.send({
          type: 'REMOTE_SELECTION_CHANGED',
          ranges: [rng(50, 50, 50, 50)],
        });

        const after = actor.getSnapshot().context;
        expect(after.committedRanges).toEqual(before.committedRanges);
        expect(after.pendingRange).toEqual(before.pendingRange);
        expect(after.modes).toEqual(before.modes);
        expect(after.activeCell).toEqual(before.activeCell);
        actor.stop();
      });
    }
  });

  // ===========================================================================
  // 7. set_selection_with_non_user_source clears modes (parameterized)
  // ===========================================================================

  describe('7. set_selection_with_non_user_source_clears_modes_and_replaces', () => {
    for (const source of ['remote', 'agent', 'restore'] as const) {
      it(`source=${source} clears modes and drops committedRanges`, () => {
        const actor = startActorAt(0, 0);
        actor.send({
          type: 'SET_SELECTION',
          ranges: [rng(0, 0, 0, 0), rng(2, 2, 3, 3)],
          activeCell: cell(2, 2),
        });
        actor.send({ type: 'SET_MODE', mode: 'additive', value: true });

        // Sanity: pre-event state has additive on + a committed range.
        expect(actor.getSnapshot().context.modes.additive).toBe(true);
        expect(actor.getSnapshot().context.committedRanges).toEqual([rng(0, 0, 0, 0)]);

        actor.send({
          type: 'SET_SELECTION',
          ranges: [rng(5, 5, 5, 5)],
          activeCell: cell(5, 5),
          source,
        });

        const after = actor.getSnapshot().context;
        expect(after.modes).toEqual(initialSelectionModes);
        expect(after.committedRanges).toEqual([]);
        expect(after.pendingRange).toEqual(rng(5, 5, 5, 5));
        expect(after.activeCell).toEqual(cell(5, 5));
        actor.stop();
      });
    }
  });

  // ===========================================================================
  // 8 & 9: extend mode behavior + Esc
  // ===========================================================================

  it('8. extend_mode_arrow_extends_without_shift', () => {
    const actor = startActorAt(2, 2);
    actor.send({ type: 'SET_MODE', mode: 'extend', value: true });

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.modes.extend).toBe(true); // sticky
    expect(after.pendingRange.startRow).toBe(2);
    expect(after.pendingRange.startCol).toBe(2);
    expect(after.pendingRange.endRow).toBe(2);
    expect(after.pendingRange.endCol).toBe(3); // extended to D3
    actor.stop();
  });

  it('9. extend_mode_esc_clears', () => {
    const actor = startActorAt(2, 2);
    actor.send({ type: 'SET_MODE', mode: 'extend', value: true });
    actor.send({ type: 'EXIT_ALL_MODES' });

    expect(actor.getSnapshot().context.modes).toEqual(initialSelectionModes);
    actor.stop();
  });

  // ===========================================================================
  // 10. extend ⊕ additive mutual exclusion
  // ===========================================================================

  it('10. extend_mode_setting_additive_clears_extend', () => {
    const actor = startActorAt(0, 0);
    actor.send({ type: 'SET_MODE', mode: 'extend', value: true });
    expect(actor.getSnapshot().context.modes.extend).toBe(true);

    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });

    const after = actor.getSnapshot().context.modes;
    expect(after.additive).toBe(true);
    expect(after.extend).toBe(false); // mutually exclusive
    actor.stop();

    // Symmetric: turning extend on while additive is on clears additive.
    const actor2 = startActorAt(0, 0);
    actor2.send({ type: 'SET_MODE', mode: 'additive', value: true });
    actor2.send({ type: 'SET_MODE', mode: 'extend', value: true });
    const after2 = actor2.getSnapshot().context.modes;
    expect(after2.extend).toBe(true);
    expect(after2.additive).toBe(false);
    actor2.stop();
  });

  // ===========================================================================
  // 11/12/13: end-mode + matrix rows 1a/1b
  // ===========================================================================

  it('11. end_mode_arrow_jumps_to_edge_and_deactivates', () => {
    const actor = startActorAt(2, 2);
    actor.send({ type: 'SET_MODE', mode: 'end', value: true });
    expect(actor.getSnapshot().context.modes.end).toBe(true);

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.modes.end).toBe(false); // auto-deactivated
    // Matrix row 1b: in-machine fallback uses JUMP_AMOUNT=10 — the active
    // cell jumps far right, not just one cell.
    expect(after.activeCell.col).toBeGreaterThan(3);
    actor.stop();
  });

  it('12. end_mode_plus_extend_arrow_extends_to_edge (matrix row 1a)', () => {
    const actor = startActorAt(2, 2);
    actor.send({ type: 'SET_MODE', mode: 'extend', value: true });
    actor.send({ type: 'SET_MODE', mode: 'end', value: true });
    // Verify both flags are on and not mutually exclusive
    expect(actor.getSnapshot().context.modes.extend).toBe(true);
    expect(actor.getSnapshot().context.modes.end).toBe(true);

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.modes.end).toBe(false); // end auto-deactivates
    expect(after.modes.extend).toBe(true); // extend sticky
    // Range got extended to a far edge; pendingRange.endCol > 3.
    expect(after.pendingRange.endCol).toBeGreaterThan(3);
    expect(after.pendingRange.startRow).toBe(2);
    expect(after.pendingRange.endRow).toBe(2);
    actor.stop();
  });

  it('13. end_mode_plus_additive_arrow_jumps_pending_to_edge (matrix row 1b under additive)', () => {
    const actor = startActorAt(0, 0);
    actor.send({
      type: 'SET_SELECTION',
      ranges: [rng(0, 0, 0, 0), rng(2, 2, 2, 2)],
      activeCell: cell(2, 2),
    });
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });
    actor.send({ type: 'SET_MODE', mode: 'end', value: true });

    expect(actor.getSnapshot().context.committedRanges).toEqual([rng(0, 0, 0, 0)]);

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.modes.end).toBe(false); // auto-deactivated
    expect(after.modes.additive).toBe(true); // sticky
    expect(after.committedRanges).toEqual([rng(0, 0, 0, 0)]); // untouched
    // pendingRange collapsed to a single far-right cell on the same row.
    expect(after.pendingRange.startRow).toBe(2);
    expect(after.pendingRange.endRow).toBe(2);
    expect(after.pendingRange.startCol).toBe(after.pendingRange.endCol);
    expect(after.pendingRange.endCol).toBeGreaterThan(3);
    actor.stop();
  });

  // ===========================================================================
  // 14/15/16: merge × mode
  //
  // These tests pin merge-aware selection behavior, composed with the priority
  // matrix from 1a. `getMergedRegionAt` is pushed via SET_LAYOUT_CALLBACKS so
  // in-machine navigation resolves merges. Without the layout-callback wiring,
  // merge resolution degrades gracefully — so these tests fail specifically
  // when (a) the callback is not wired or (b) the merge logic is wrong.
  // ===========================================================================

  /**
   * Helper: push a single-merge `getMergedRegionAt` into the actor.
   * Mirrors the production wiring shape from
   * `GridEditingSystem.refreshLayoutCallbacks`.
   */
  function pushMerge(actor: ReturnType<typeof startActorAt>, merge: ReturnType<typeof rng>) {
    actor.send({
      type: 'SET_LAYOUT_CALLBACKS',
      getMergedRegionAt: (row, col) => {
        if (
          row >= merge.startRow &&
          row <= merge.endRow &&
          col >= merge.startCol &&
          col <= merge.endCol
        ) {
          return merge;
        }
        return null;
      },
    });
  }

  it('14a. layout_callbacks_wired_after_set_layout_callbacks (verification gate #10b)', () => {
    // verification gate #10b runtime assertion: after
    // SET_LAYOUT_CALLBACKS lands, `ctx.getMergedRegionAt` is a function.
    // This complements the production-side assertion (`refreshLayoutCallbacks`
    // fires from GridEditingSystem.start()); the unit test covers the
    // machine's response to the event in isolation.
    const actor = startActorAt(0, 0);
    pushMerge(actor, rng(0, 0, 0, 0)); // any merge — content doesn't matter
    expect(typeof actor.getSnapshot().context.getMergedRegionAt).toBe('function');
    actor.stop();
  });

  it('14. arrow_into_merge_enters_origin_then_exits_to_far_side', () => {
    // Bare arrow into merge B2:D4 (rows 1-3, cols 1-3). No mode set.
    // From A2 (1, 0) arrow right → step into (1, 1) which is the merge
    // origin. The next ArrowRight exits to one past the merge's endCol.
    const actor = startActorAt(1, 0); // A2
    pushMerge(actor, rng(1, 1, 3, 3));

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const entered = actor.getSnapshot().context;
    expect(entered.activeCell).toEqual(cell(1, 1)); // B2 — merge origin
    expect(entered.pendingRange).toEqual(rng(1, 1, 1, 1));
    expect(entered.committedRanges).toEqual([]);
    expect(entered.modes.additive).toBe(false);

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const exited = actor.getSnapshot().context;
    expect(exited.activeCell).toEqual(cell(1, 4)); // E2 — past the merge
    expect(exited.pendingRange).toEqual(rng(1, 4, 1, 4));
    expect(exited.committedRanges).toEqual([]);
    expect(exited.modes.additive).toBe(false);
    actor.stop();
  });

  it('14b. arrow_into_adjacent_merges_enters_then_escapes_until_stable', () => {
    const actor = startActorAt(0, 4); // E1
    const leftMerge = rng(0, 0, 1, 1); // A1:B2
    const rightMerge = rng(0, 2, 1, 3); // C1:D2
    actor.send({
      type: 'SET_LAYOUT_CALLBACKS',
      getMergedRegionAt: (row, col) => {
        for (const merge of [leftMerge, rightMerge]) {
          if (
            row >= merge.startRow &&
            row <= merge.endRow &&
            col >= merge.startCol &&
            col <= merge.endCol
          ) {
            return merge;
          }
        }
        return null;
      },
    });

    actor.send({ type: 'KEY_ARROW', direction: 'left', shiftKey: false });

    const entered = actor.getSnapshot().context;
    expect(entered.activeCell).toEqual(cell(0, 2));
    expect(entered.pendingRange).toEqual(rng(0, 2, 0, 2));

    actor.send({ type: 'KEY_ARROW', direction: 'left', shiftKey: false });

    const exited = actor.getSnapshot().context;
    expect(exited.activeCell).toEqual(cell(0, 0));
    expect(exited.pendingRange).toEqual(rng(0, 0, 0, 0));
    actor.stop();
  });

  it('14c. multi_cell_arrow_collapse_escapes_when_edge_is_inside_merge', () => {
    const actor = startActorAt(0, 0);
    actor.send({
      type: 'SET_SELECTION',
      ranges: [rng(0, 0, 2, 0)],
      activeCell: cell(0, 0),
    });
    pushMerge(actor, rng(2, 0, 3, 1)); // A3:B4

    actor.send({ type: 'KEY_ARROW', direction: 'down', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.activeCell).toEqual(cell(4, 0));
    expect(after.pendingRange).toEqual(rng(4, 0, 4, 0));
    actor.stop();
  });

  it('15. additive_mode_arrow_into_merge_enters_origin', () => {
    // Additive on with one committed range. Arrow into merge → pending
    // collapses to the merge origin; committed untouched.
    const actor = startActorAt(0, 0);
    actor.send({
      type: 'SET_SELECTION',
      ranges: [rng(0, 0, 0, 0), rng(1, 0, 1, 0)], // A1 committed, A2 pending
      activeCell: cell(1, 0),
    });
    actor.send({ type: 'SET_MODE', mode: 'additive', value: true });
    pushMerge(actor, rng(1, 1, 3, 3)); // B2:D4

    expect(actor.getSnapshot().context.committedRanges).toEqual([rng(0, 0, 0, 0)]);

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.modes.additive).toBe(true); // sticky
    expect(after.committedRanges).toEqual([rng(0, 0, 0, 0)]); // untouched
    expect(after.activeCell).toEqual(cell(1, 1)); // merge origin
    expect(after.pendingRange).toEqual(rng(1, 1, 1, 1)); // collapsed pending
    actor.stop();
  });

  it('16. end_mode_arrow_into_merge_lands_on_far_edge', () => {
    // End + arrow when the data-edge JUMP_AMOUNT path lands inside a
    // merge. The in-machine fallback uses JUMP_AMOUNT=10 (not the real
    // findDataEdge, which lives in the keyboard coordinator path) — so
    // from A2 (1, 0) with JUMP_AMOUNT=10 → step right to (1, 10), which
    // is outside any merge. To exercise the merge × End interaction, set
    // the merge bounds so JUMP_AMOUNT lands inside it.
    const actor = startActorAt(1, 0); // A2
    actor.send({ type: 'SET_MODE', mode: 'end', value: true });
    // Merge spanning columns 5-12 on row 1 — JUMP_AMOUNT=10 lands at col
    // 10, inside the merge → escape to (1, 13).
    pushMerge(actor, rng(1, 5, 1, 12));

    actor.send({ type: 'KEY_ARROW', direction: 'right', shiftKey: false });

    const after = actor.getSnapshot().context;
    expect(after.modes.end).toBe(false); // auto-deactivated
    expect(after.activeCell).toEqual(cell(1, 13)); // post-merge column
    expect(after.pendingRange).toEqual(rng(1, 13, 1, 13));
    actor.stop();
  });
});
