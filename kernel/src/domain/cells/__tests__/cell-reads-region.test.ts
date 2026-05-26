/**
 * Tests for `getData` region surfacing — Stream D4 of
 *
 * Round-trips representative wire-shape responses (CSE anchor, CSE
 * member, Data Table master, Data Table body, dynamic-array spill
 * anchor, plain cell outside any region) and asserts that
 * `getData(...)` exposes `region` correctly on `StoreCellData`.
 *
 * Mocks the ComputeBridge — these tests guard the kernel-side
 * extraction logic, not the Rust composition (which is covered by
 * `compute/core/tests/data_table_active_cell_metadata.rs` and
 * `cse_viewport_has_formula_flag.rs`).
 */
import { jest } from '@jest/globals';
import type { DocumentContext } from '../../../context/types';
import { getData } from '../cell-reads';
import { sheetId } from '@mog-sdk/contracts/core';

type Bridge = DocumentContext['computeBridge'];

function buildCtx(bridge: Partial<Bridge>): DocumentContext {
  return {
    computeBridge: bridge,
  } as unknown as DocumentContext;
}

describe('getData — region surfacing (D4)', () => {
  // --------------------------------------------------------------------
  // Plain cell — no region, getActiveCell path
  // --------------------------------------------------------------------

  it('returns region: null for a plain cell with formula but no region', async () => {
    const getCellIdAt = jest.fn(async () => 'cell-1234');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'cell-1234',
      value: 42,
      formula: '=A1+1',
      metadata: { region: null },
      isFormulaHidden: false,
    }));

    const ctx = buildCtx({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 0, 0);

    expect(result?.region).toBeNull();
    expect(result?.formula).toBe('=A1+1');
  });

  it('omits region (undefined) when metadata is absent entirely', async () => {
    const getCellIdAt = jest.fn(async () => 'cell-1234');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'cell-1234',
      value: 7,
      isFormulaHidden: false,
    }));

    const ctx = buildCtx({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 0, 0);

    // No region info at all → field should be absent, not null.
    expect(result?.region).toBeUndefined();
  });

  it('falls back to range-backed data when an imported active cell has a null payload', async () => {
    const getCellIdAt = jest.fn(async () => 'cell-1234');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'cell-1234',
      value: null,
      metadata: { originalValue: 'mixed-0-0' },
      isFormulaHidden: false,
    }));
    const getCellData = jest.fn(async () => ({
      cell_id: null,
      row: 0,
      col: 0,
      value: { type: 'text', value: 'mixed-0-0' },
      formula: null,
      region: null,
    }));

    const ctx = buildCtx({
      getCellIdAt,
      getActiveCell,
      getCellData,
    } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 0, 0);

    expect(result?.raw).toBe('mixed-0-0');
    expect(result?.region).toBeNull();
    expect(getCellData).toHaveBeenCalledWith(sheetId('S1'), 0, 0);
  });

  // --------------------------------------------------------------------
  // CSE — anchor + member
  // --------------------------------------------------------------------

  it('surfaces region on a CSE anchor (kind=cseArray, isAnchor=true)', async () => {
    const getCellIdAt = jest.fn(async () => 'anchor-cse');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'anchor-cse',
      value: 5,
      formula: '=A1:A3*B1:B3',
      metadata: {
        region: {
          kind: 'cseArray',
          isAnchor: true,
          anchorRow: 0,
          anchorCol: 3,
          bounds: { rows: 3, cols: 1 },
        },
      },
      isFormulaHidden: false,
    }));

    const ctx = buildCtx({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 0, 3);

    expect(result?.region).toEqual({
      kind: 'cseArray',
      isAnchor: true,
      anchorRow: 0,
      anchorCol: 3,
      bounds: { rows: 3, cols: 1 },
    });
    expect(result?.formula).toBe('=A1:A3*B1:B3');
  });

  it('surfaces region on a CSE member (kind=cseArray, isAnchor=false)', async () => {
    const getCellIdAt = jest.fn(async () => 'member-cse');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'member-cse',
      value: 12,
      formula: '=A1:A3*B1:B3',
      metadata: {
        region: {
          kind: 'cseArray',
          isAnchor: false,
          anchorRow: 0,
          anchorCol: 3,
          bounds: { rows: 3, cols: 1 },
        },
        isArrayMember: true,
      },
      isFormulaHidden: false,
    }));

    const ctx = buildCtx({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 2, 3);

    expect(result?.region).toEqual({
      kind: 'cseArray',
      isAnchor: false,
      anchorRow: 0,
      anchorCol: 3,
      bounds: { rows: 3, cols: 1 },
    });
  });

  // --------------------------------------------------------------------
  // Data Table — master + body
  // --------------------------------------------------------------------

  it('surfaces region on a Data Table master (kind=dataTable, isAnchor=true)', async () => {
    const getCellIdAt = jest.fn(async () => 'master-dt');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'master-dt',
      value: { type: 'error', value: '#CALC!' },
      formula: '=TABLE($A$2,$A$1)',
      metadata: {
        region: {
          kind: 'dataTable',
          isAnchor: true,
          anchorRow: 1,
          anchorCol: 1,
          bounds: { rows: 2, cols: 2 },
        },
      },
      isFormulaHidden: false,
    }));

    const ctx = buildCtx({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 1, 1);

    expect(result?.region).toEqual({
      kind: 'dataTable',
      isAnchor: true,
      anchorRow: 1,
      anchorCol: 1,
      bounds: { rows: 2, cols: 2 },
    });
    expect(result?.formula).toBe('=TABLE($A$2,$A$1)');
  });

  it('surfaces region on a Data Table body cell (kind=dataTable, isAnchor=false)', async () => {
    const getCellIdAt = jest.fn(async () => 'body-dt');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'body-dt',
      value: 11,
      formula: '=TABLE($A$2,$A$1)',
      metadata: {
        region: {
          kind: 'dataTable',
          isAnchor: false,
          anchorRow: 1,
          anchorCol: 1,
          bounds: { rows: 2, cols: 2 },
        },
        isArrayMember: true,
      },
      isFormulaHidden: false,
    }));

    const ctx = buildCtx({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 2, 2);

    expect(result?.region).toEqual({
      kind: 'dataTable',
      isAnchor: false,
      anchorRow: 1,
      anchorCol: 1,
      bounds: { rows: 2, cols: 2 },
    });
    expect(result?.formula).toBe('=TABLE($A$2,$A$1)');
  });

  // --------------------------------------------------------------------
  // Dynamic-array spill anchor (kind=arraySpill — NOT brace-wrapped by D5)
  // --------------------------------------------------------------------

  it('surfaces region on a dynamic-array spill anchor (kind=arraySpill)', async () => {
    const getCellIdAt = jest.fn(async () => 'anchor-spill');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'anchor-spill',
      value: 1,
      formula: '=SEQUENCE(5)',
      metadata: {
        region: {
          kind: 'arraySpill',
          isAnchor: true,
          anchorRow: 0,
          anchorCol: 0,
          bounds: { rows: 5, cols: 1 },
        },
      },
      isFormulaHidden: false,
    }));

    const ctx = buildCtx({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 0, 0);

    expect(result?.region?.kind).toBe('arraySpill');
    expect(result?.region?.isAnchor).toBe(true);
  });

  // --------------------------------------------------------------------
  // Spill member (no Yrs CellId — projection-source path)
  // --------------------------------------------------------------------

  it('surfaces region on a spill member (no CellId path)', async () => {
    // Spill member at (2,0) — has no CellId of its own, but
    // `getProjectionSource` resolves to (0,0). The
    // `getCellData` fallback returns the region info.
    const getCellIdAt = jest.fn(async (_sheet: unknown, row: number, col: number) => {
      if (row === 0 && col === 0) return 'anchor-spill';
      return null;
    });
    const getProjectionSource = jest.fn(async (_sheet: unknown, _row: number, _col: number) => ({
      row: 0,
      col: 0,
    }));
    const getActiveCell = jest.fn(async () => ({
      cellId: 'anchor-spill',
      value: 1,
      formula: '=SEQUENCE(5)',
      metadata: {
        region: {
          kind: 'arraySpill',
          isAnchor: true,
          anchorRow: 0,
          anchorCol: 0,
          bounds: { rows: 5, cols: 1 },
        },
      },
      isFormulaHidden: false,
    }));
    const getCellData = jest.fn(async () => ({
      cell_id: null,
      row: 2,
      col: 0,
      value: { type: 'number', value: 3 },
      region: {
        kind: 'arraySpill',
        isAnchor: false,
        anchorRow: 0,
        anchorCol: 0,
        bounds: { rows: 5, cols: 1 },
      },
    }));

    const ctx = buildCtx({
      getCellIdAt,
      getProjectionSource,
      getActiveCell,
      getCellData,
    } as unknown as Partial<Bridge>);
    const result = await getData(ctx, sheetId('S1'), 2, 0);

    expect(result?.region).toEqual({
      kind: 'arraySpill',
      isAnchor: false,
      anchorRow: 0,
      anchorCol: 0,
      bounds: { rows: 5, cols: 1 },
    });
    expect(result?.formula).toBe('=SEQUENCE(5)');
  });
});
