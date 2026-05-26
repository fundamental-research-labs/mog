/**
 * Regression tests for `queryByProperties` — guards against the empty-cellId
 * UUID-parse failure surfaced by the app-eval `real-files` round on
 * 2026-04-27 (FIX-004 cluster: `[compute_get_active_cell] Error: invalid
 * length: expected length 32 for simple format, found 0`).
 *
 * Background: `RangeQueryResult` returned by `compute_query_range` carries
 * `cell_id: String` for every visited cell, including format-only cells
 * with no `CellMirror` entry. Rust's `compute/core/src/storage/engine/
 * queries.rs:1588` emits `String::new()` (empty string) for such cells.
 * Forwarding the empty string into `getActiveCell` triggers a Rust UUID
 * parse error on the WASM/NAPI boundary — the test below ensures
 * `queryByProperties` skips the metadata fetch instead.
 */
import { jest } from '@jest/globals';
import type { DocumentContext } from '../../../context/types';
import { queryByProperties } from '../cell-properties';
import { sheetId } from '@mog-sdk/contracts/core';

type Bridge = DocumentContext['computeBridge'];

function buildCtx(bridge: Partial<Bridge>): DocumentContext {
  return {
    computeBridge: bridge,
  } as unknown as DocumentContext;
}

describe('queryByProperties — empty cellId guard', () => {
  it('skips getActiveCell when RangeCellData.cellId is the empty string', async () => {
    // A format-only cell at (0,0) — Rust emits cellId="" because no
    // CellMirror entry exists for it. A real cell at (0,1) has a
    // populated cellId. Predicate matches any cell with a `format`.
    const cells = [
      { row: 0, col: 0, cellId: '', value: null, format: { fontWeight: 'bold' } },
      {
        row: 0,
        col: 1,
        cellId: 'a1b2c3d4e5f67890abcdef1234567890',
        value: null,
        format: { fontWeight: 'bold' },
      },
    ];

    const getDataBounds = jest.fn(async () => ({
      minRow: 0,
      minCol: 0,
      maxRow: 0,
      maxCol: 1,
    }));
    const queryRange = jest.fn(async () => ({ cells, merges: [] }));
    const getActiveCell = jest.fn(async () => ({ metadata: undefined }) as unknown);

    const ctx = buildCtx({
      getDataBounds,
      queryRange,
      getActiveCell,
    } as unknown as Partial<Bridge>);

    const results = await queryByProperties(ctx, sheetId('S1'), (props) => !!props.format);

    // Both cells matched (predicate looks at format).
    expect(results).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ]);

    // Critically: getActiveCell was called ONCE, with the populated cellId
    // — never with the empty string. Calling with "" triggers the Rust
    // panic this test guards against.
    expect(getActiveCell).toHaveBeenCalledTimes(1);
    expect(getActiveCell).toHaveBeenCalledWith(sheetId('S1'), 'a1b2c3d4e5f67890abcdef1234567890');
  });

  it('returns empty array on bounds=null without ever calling getActiveCell', async () => {
    const getDataBounds = jest.fn(async () => null);
    const queryRange = jest.fn(async () => ({ cells: [], merges: [] }));
    const getActiveCell = jest.fn(async () => null);

    const ctx = buildCtx({
      getDataBounds,
      queryRange,
      getActiveCell,
    } as unknown as Partial<Bridge>);

    const results = await queryByProperties(ctx, sheetId('S1'), () => true);
    expect(results).toEqual([]);
    expect(getActiveCell).not.toHaveBeenCalled();
  });
});
