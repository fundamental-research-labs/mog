/**
 * Merge Anchor Coordination Tests
 *
 * Verifies that after a `merges:changed` event whose `regions` payload
 * includes a Set region containing the current activeCell, the coordinator
 * dispatches SET_SELECTION snapping activeCell to the region's top-left
 * while preserving the existing range.
 *
 * @see ../merge-anchor-coordination.ts
 */

import { createActor } from 'xstate';

import { selectionSelectors } from '../../../../selectors';
import { selectionMachine } from '../../machines/grid-selection-machine';
import { setupMergeAnchorCoordination } from '../merge-anchor-coordination';

// =============================================================================
// Test Helpers
// =============================================================================

interface MergeRegion {
  kind?: 'Set' | 'Removed';
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Build a minimal stub workbook that exposes:
 * - workbook.on('merges:changed', handler) so we can fire events
 *
 * Returns the workbook and a `fireMergesChanged()` helper that synthesises a
 * `merges:changed` event with the given sheetId and regions.
 */
function createStubs(defaultSheetId: string) {
  const handlers: Array<(event: unknown) => void> = [];

  const workbook = {
    on: (event: string, handler: (event: unknown) => void) => {
      if (event === 'merges:changed') {
        handlers.push(handler);
      }
      return Object.assign(
        () => {
          const idx = handlers.indexOf(handler);
          if (idx !== -1) handlers.splice(idx, 1);
        },
        { [Symbol.dispose]: () => {} },
      );
    },
  } as unknown as import('@mog-sdk/contracts/api').Workbook;

  return {
    workbook,
    fireMergesChanged: (regions: MergeRegion[], sheetId: string = defaultSheetId) => {
      const normalized = regions.map((r) => ({
        kind: r.kind ?? 'Set',
        startRow: r.startRow,
        startCol: r.startCol,
        endRow: r.endRow,
        endCol: r.endCol,
      }));
      for (const h of handlers) {
        h({
          type: 'merges:changed',
          timestamp: Date.now(),
          sheetId,
          mergeCount: normalized.filter((r) => r.kind === 'Set').length,
          regions: normalized,
          source: 'user',
        });
      }
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('setupMergeAnchorCoordination', () => {
  const sheetId = 'sheet-1';

  it('snaps activeCell to merge top-left when merge contains activeCell', () => {
    const selectionActor = createActor(selectionMachine);
    selectionActor.start();

    // Simulate shift-click A1 → B2: range A1:B2, activeCell at the moving
    // edge B2 = (1, 1).
    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      activeCell: { row: 1, col: 1 },
    });

    expect(selectionActor.getSnapshot().context.activeCell).toEqual({
      row: 1,
      col: 1,
    });

    const stubs = createStubs(sheetId);
    const { cleanup } = setupMergeAnchorCoordination({
      workbook: stubs.workbook,
      selectionActor: selectionActor as unknown as Parameters<
        typeof setupMergeAnchorCoordination
      >[0]['selectionActor'],
      getActiveSheetId: () => sheetId as never,
    });

    // Now the merge happens — workbook fires `merges:changed` with the new region.
    stubs.fireMergesChanged([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]);

    expect(selectionActor.getSnapshot().context.activeCell).toEqual({
      row: 0,
      col: 0,
    });

    expect(selectionSelectors.ranges(selectionActor.getSnapshot())).toEqual([
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
    ]);

    cleanup();
  });

  it('does not move activeCell when no Set region contains it', () => {
    const selectionActor = createActor(selectionMachine);
    selectionActor.start();

    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 }],
      activeCell: { row: 5, col: 5 },
    });

    const stubs = createStubs(sheetId);
    const { cleanup } = setupMergeAnchorCoordination({
      workbook: stubs.workbook,
      selectionActor: selectionActor as unknown as Parameters<
        typeof setupMergeAnchorCoordination
      >[0]['selectionActor'],
      getActiveSheetId: () => sheetId as never,
    });

    // Merge happens elsewhere on the sheet.
    stubs.fireMergesChanged([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]);

    expect(selectionActor.getSnapshot().context.activeCell).toEqual({
      row: 5,
      col: 5,
    });

    cleanup();
  });

  it('ignores Removed regions (unmerge does not move activeCell)', () => {
    const selectionActor = createActor(selectionMachine);
    selectionActor.start();

    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      activeCell: { row: 1, col: 1 },
    });

    const stubs = createStubs(sheetId);
    const { cleanup } = setupMergeAnchorCoordination({
      workbook: stubs.workbook,
      selectionActor: selectionActor as unknown as Parameters<
        typeof setupMergeAnchorCoordination
      >[0]['selectionActor'],
      getActiveSheetId: () => sheetId as never,
    });

    stubs.fireMergesChanged([{ kind: 'Removed', startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]);

    expect(selectionActor.getSnapshot().context.activeCell).toEqual({
      row: 1,
      col: 1,
    });

    cleanup();
  });

  it('is a no-op when activeCell is already at merge top-left', () => {
    const selectionActor = createActor(selectionMachine);
    selectionActor.start();

    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      activeCell: { row: 0, col: 0 },
    });

    const before = selectionActor.getSnapshot();

    const stubs = createStubs(sheetId);
    const { cleanup } = setupMergeAnchorCoordination({
      workbook: stubs.workbook,
      selectionActor: selectionActor as unknown as Parameters<
        typeof setupMergeAnchorCoordination
      >[0]['selectionActor'],
      getActiveSheetId: () => sheetId as never,
    });

    stubs.fireMergesChanged([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]);

    const after = selectionActor.getSnapshot();
    expect(after.context.activeCell).toEqual(before.context.activeCell);
    expect(selectionSelectors.ranges(after)).toEqual(selectionSelectors.ranges(before));

    cleanup();
  });

  it('ignores merges:changed events from non-active sheets', () => {
    const selectionActor = createActor(selectionMachine);
    selectionActor.start();

    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      activeCell: { row: 1, col: 1 },
    });

    const stubs = createStubs(sheetId);
    const { cleanup } = setupMergeAnchorCoordination({
      workbook: stubs.workbook,
      selectionActor: selectionActor as unknown as Parameters<
        typeof setupMergeAnchorCoordination
      >[0]['selectionActor'],
      getActiveSheetId: () => sheetId as never,
    });

    // Fire on a different sheet — the listener should ignore it.
    stubs.fireMergesChanged([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }], 'other-sheet');

    expect(selectionActor.getSnapshot().context.activeCell).toEqual({
      row: 1,
      col: 1,
    });

    cleanup();
  });

  it('preserves multi-range selection when snapping activeCell', () => {
    const selectionActor = createActor(selectionMachine);
    selectionActor.start();

    // Multi-range selection: primary range A1:B2 plus secondary D3.
    // activeCell sits at the moving edge of the primary range.
    const ranges = [
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
      { startRow: 0, startCol: 3, endRow: 2, endCol: 3 },
    ];
    selectionActor.send({
      type: 'SET_SELECTION',
      ranges,
      activeCell: { row: 1, col: 1 },
    });

    const stubs = createStubs(sheetId);
    const { cleanup } = setupMergeAnchorCoordination({
      workbook: stubs.workbook,
      selectionActor: selectionActor as unknown as Parameters<
        typeof setupMergeAnchorCoordination
      >[0]['selectionActor'],
      getActiveSheetId: () => sheetId as never,
    });

    stubs.fireMergesChanged([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]);

    expect(selectionActor.getSnapshot().context.activeCell).toEqual({
      row: 0,
      col: 0,
    });
    expect(selectionSelectors.ranges(selectionActor.getSnapshot())).toEqual(ranges);

    cleanup();
  });

  it('handles empty regions payload gracefully', () => {
    const selectionActor = createActor(selectionMachine);
    selectionActor.start();

    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      activeCell: { row: 1, col: 1 },
    });

    const stubs = createStubs(sheetId);
    const { cleanup } = setupMergeAnchorCoordination({
      workbook: stubs.workbook,
      selectionActor: selectionActor as unknown as Parameters<
        typeof setupMergeAnchorCoordination
      >[0]['selectionActor'],
      getActiveSheetId: () => sheetId as never,
    });

    stubs.fireMergesChanged([]);

    expect(selectionActor.getSnapshot().context.activeCell).toEqual({
      row: 1,
      col: 1,
    });

    cleanup();
  });
});
