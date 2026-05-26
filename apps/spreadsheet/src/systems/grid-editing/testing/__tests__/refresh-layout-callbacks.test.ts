/**
 * Refresh-Layout-Callbacks — Production-Shape Bitmap Test
 *
 * Pins the production behavior of `GridEditingSystem.refreshLayoutCallbacks`
 * against a workbook mock whose `layout.getHiddenRowsBitmap` /
 * `getHiddenColumnsBitmap` return `Promise<Set<number>>` — the actual
 * shape declared in `types/api/src/api/worksheet/layout.ts`.
 *
 * Before the fix, refreshLayoutCallbacks built sync
 * predicates by invoking the worksheet's per-row `isRowHidden(row)` and
 * runtime-checking `typeof result === 'boolean' ? result : false`. Because
 * the production API returns `Promise<boolean>`, the guard always fell to
 * `false` — silently disabling hidden-row skipping in the Tab/Enter cycle
 * and `moveCellSkipHidden` paths. This file fails specifically on that
 * regression by:
 *
 * 1. Constructing a workbook mock with the real Promise-bitmap shape.
 * 2. Calling `refreshLayoutCallbacks` against it.
 * 3. Asserting that `actor.getSnapshot.context.isRowHidden(row)`
 * reports `true` for a hidden row.
 *
 * @see ../grid-editing-system.ts refreshLayoutCallbacks
 * @see ../../../actions/handlers/selection/helpers.ts createVisibilityChecker
 */

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import { GridEditingSystem } from '../../grid-editing-system';

// =============================================================================
// MOCKS
// =============================================================================

/**
 * Build a `WorkbookInternal`-shaped mock whose layout API mirrors the real
 * Promise-returning contract in `types/api/src/api/worksheet/layout.ts`.
 * Only the surface used by `refreshLayoutCallbacks` is implemented; the rest
 * is `as unknown as WorkbookInternal` (per the project's existing mock
 * pattern in `find-replace-wiring.test.ts`).
 */
function createWorkbookMock(opts: {
  sheetId: SheetId;
  hiddenRows?: number[];
  hiddenCols?: number[];
  merges?: Array<{ start_row: number; start_col: number; end_row: number; end_col: number }>;
}): WorkbookInternal {
  const hiddenRowSet = new Set(opts.hiddenRows ?? []);
  const hiddenColSet = new Set(opts.hiddenCols ?? []);
  const merges = opts.merges ?? [];

  const mockWorksheet = {
    layout: {
      // Promise-returning shape — matches production contract.
      getHiddenRowsBitmap: () => Promise.resolve(hiddenRowSet),
      getHiddenColumnsBitmap: () => Promise.resolve(hiddenColSet),
      isRowHidden: (row: number) => Promise.resolve(hiddenRowSet.has(row)),
      isColumnHidden: (col: number) => Promise.resolve(hiddenColSet.has(col)),
    },
    viewport: {
      getMerges: () => merges,
      getCellData: () => null,
      hasComment: () => false,
    },
    structure: {
      getMergedRegions: () =>
        Promise.resolve(
          merges.map((m) => ({
            startRow: m.start_row,
            startCol: m.start_col,
            endRow: m.end_row,
            endCol: m.end_col,
          })),
        ),
    },
  };

  return {
    getSheetById: (_sid: SheetId) => mockWorksheet,
    on: () => () => {},
  } as unknown as WorkbookInternal;
}

// =============================================================================
// TESTS
// =============================================================================

describe('GridEditingSystem.refreshLayoutCallbacks (production-shape bitmaps)', () => {
  const SHEET_ID = toSheetId('00000000-0000-4000-8000-000000000001');

  it('hidden_row_bitmap_drives_isRowHidden_predicate_after_start', async () => {
    // Production-shape regression test. With a workbook mock whose
    // `layout.getHiddenRowsBitmap` returns
    // `Promise<Set<number>>` containing row 3, the selection machine's
    // `context.isRowHidden(3)` must return `true` after start() resolves.
    //
    // Pre-fix, refreshLayoutCallbacks consulted `ws.layout.isRowHidden(row)`
    // (Promise-returning) through a sync `typeof === 'boolean'` guard,
    // which always fell to `false`. This test pins the bitmap pre-fetch
    // path that replaces it.
    const workbook = createWorkbookMock({
      sheetId: SHEET_ID,
      hiddenRows: [3],
    });

    const system = new GridEditingSystem({
      initialSheetId: SHEET_ID,
      workbook,
    });
    system.start();

    // start() fires refreshLayoutCallbacks() fire-and-forget. Await it
    // explicitly here so the assertion runs after the bitmap fetch
    // resolves and SET_LAYOUT_CALLBACKS lands.
    await system.refreshLayoutCallbacks();

    const ctx = system.access.actors.selection.getSnapshot().context;
    expect(typeof ctx.isRowHidden).toBe('function');
    expect(ctx.isRowHidden!(3)).toBe(true);
    expect(ctx.isRowHidden!(2)).toBe(false);

    system.dispose();
  });

  it('hidden_col_bitmap_drives_isColHidden_predicate', async () => {
    const workbook = createWorkbookMock({
      sheetId: SHEET_ID,
      hiddenCols: [5],
    });

    const system = new GridEditingSystem({
      initialSheetId: SHEET_ID,
      workbook,
    });
    system.start();
    await system.refreshLayoutCallbacks();

    const ctx = system.access.actors.selection.getSnapshot().context;
    expect(typeof ctx.isColHidden).toBe('function');
    expect(ctx.isColHidden!(5)).toBe(true);
    expect(ctx.isColHidden!(4)).toBe(false);

    system.dispose();
  });

  it('viewport_merges_drive_getMergedRegionAt', async () => {
    const workbook = createWorkbookMock({
      sheetId: SHEET_ID,
      merges: [{ start_row: 1, start_col: 1, end_row: 3, end_col: 3 }],
    });

    const system = new GridEditingSystem({
      initialSheetId: SHEET_ID,
      workbook,
    });
    system.start();
    await system.refreshLayoutCallbacks();

    const ctx = system.access.actors.selection.getSnapshot().context;
    expect(typeof ctx.getMergedRegionAt).toBe('function');
    // Inside merge
    expect(ctx.getMergedRegionAt!(2, 2)).toEqual({
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
    });
    // Outside merge
    expect(ctx.getMergedRegionAt!(0, 0)).toBeNull();
    expect(ctx.getMergedRegionAt!(5, 5)).toBeNull();

    system.dispose();
  });

  it('headless_no_workbook_clears_layout_callbacks', async () => {
    // Without a workbook, refreshLayoutCallbacks must clear all three
    // callbacks. (The integration simulator relies on this — it constructs
    // GridEditingSystem with no workbook, then explicitly pushes its own
    // callbacks via setLayoutCallbacks afterward.)
    const system = new GridEditingSystem({ initialSheetId: SHEET_ID });
    system.start();
    await system.refreshLayoutCallbacks();

    const ctx = system.access.actors.selection.getSnapshot().context;
    expect(ctx.isRowHidden).toBeUndefined();
    expect(ctx.isColHidden).toBeUndefined();
    expect(ctx.getMergedRegionAt).toBeUndefined();

    system.dispose();
  });

  it('subsequent_refresh_picks_up_new_bitmap_state', async () => {
    // Sheet switches re-fire refreshLayoutCallbacks. Verify a follow-up
    // refresh against a workbook with different hidden rows updates the
    // predicate accordingly.
    const sharedHidden = new Set<number>([3]);
    const mockWs = {
      layout: {
        getHiddenRowsBitmap: () => Promise.resolve(sharedHidden),
        getHiddenColumnsBitmap: () => Promise.resolve(new Set<number>()),
        isRowHidden: (row: number) => Promise.resolve(sharedHidden.has(row)),
        isColumnHidden: () => Promise.resolve(false),
      },
      viewport: { getMerges: () => [], getCellData: () => null, hasComment: () => false },
      structure: { getMergedRegions: () => Promise.resolve([]) },
    };
    const workbook = {
      getSheetById: () => mockWs,
      on: () => () => {},
    } as unknown as WorkbookInternal;

    const system = new GridEditingSystem({
      initialSheetId: SHEET_ID,
      workbook,
    });
    system.start();
    await system.refreshLayoutCallbacks();

    const ctx1 = system.access.actors.selection.getSnapshot().context;
    expect(ctx1.isRowHidden!(3)).toBe(true);
    expect(ctx1.isRowHidden!(7)).toBe(false);

    // Mutate the shared set to simulate a new sheet (or a layout change),
    // then re-fire. The bitmap snapshot inside the predicate is taken at
    // refresh time, so the predicate from before still reflects the old
    // state — but a fresh refresh picks up the new state. (This mirrors
    // the documented limitation in refreshLayoutCallbacks: the snapshot is
    // sheet-switch-scoped, not live.)
    sharedHidden.delete(3);
    sharedHidden.add(7);
    await system.refreshLayoutCallbacks();

    const ctx2 = system.access.actors.selection.getSnapshot().context;
    expect(ctx2.isRowHidden!(3)).toBe(false);
    expect(ctx2.isRowHidden!(7)).toBe(true);

    system.dispose();
  });
});
