/**
 * `Worksheet.cells.get(addr)` — typed cell readback API.
 *
 * Locks in the public-API surface introduced by:
 *
 * - Region cases: plain cell, formula cell, CSE anchor + member, dynamic-array
 *   spill anchor + member, Data Table master + body.
 * - Out-of-bounds → `undefined`.
 * - Lower-case input normalized in the returned `addr`.
 * - `valueType` discrimination across `Empty / String / Double / Boolean / Error`.
 *
 * Mocks the compute bridge the same way `cell-reads-region.test.ts` does — these
 * tests guard the projection seam in `WorksheetImpl`, not the Rust composition.
 */

import { jest } from '@jest/globals';
import type { DocumentContext } from '../../../context/types';
import { sheetId } from '@mog-sdk/contracts/core';
import { RangeValueType } from '@mog-sdk/contracts/api';
import { WorksheetImpl } from '../worksheet-impl';

type Bridge = DocumentContext['computeBridge'];

const SHEET_ID = sheetId('sheet-1');

function buildCtx(bridge: Partial<Bridge>): DocumentContext {
  return {
    computeBridge: bridge,
  } as unknown as DocumentContext;
}

function makeWs(bridge: Partial<Bridge>): WorksheetImpl {
  const ctx = buildCtx(bridge);
  return new WorksheetImpl(SHEET_ID, ctx);
}

function makeNamedWs(bridge: Partial<Bridge>, name = 'Sheet1'): WorksheetImpl {
  const ctx = buildCtx(bridge);
  return new WorksheetImpl(SHEET_ID, ctx, { name });
}

describe('Worksheet.cells.get(addr)', () => {
  // --------------------------------------------------------------------
  // Out-of-bounds + invalid-address handling
  // --------------------------------------------------------------------

  it('returns undefined for cells outside the sheet bounds (XFE1 — col >= MAX_COLS)', async () => {
    // Bridge should not be touched on the OOB path.
    const getCellIdAt = jest.fn();
    const ws = makeWs({ getCellIdAt } as unknown as Partial<Bridge>);

    // MAX_COLS is 16384 — XFD is 16383 (in bounds), XFE is 16384 (out of bounds).
    const result = await ws.cells.get('XFE1');
    expect(result).toBeUndefined();
    expect(getCellIdAt).not.toHaveBeenCalled();
  });

  it('throws KernelError on syntactically invalid addresses', async () => {
    const ws = makeWs({} as unknown as Partial<Bridge>);
    await expect(ws.cells.get('not-a-cell-address')).rejects.toThrow(/Invalid cell address/);
  });

  it('normalizes lower-case input — `b2` ⇒ `addr: "B2"`', async () => {
    const getCellIdAt = jest.fn(async () => 'cell-b2');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'cell-b2',
      value: 42,
      isFormulaHidden: false,
    }));
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('b2');
    expect(result?.addr).toBe('B2');
    expect(result?.row).toBe(1);
    expect(result?.col).toBe(1);
    expect(getCellIdAt).toHaveBeenCalledWith(SHEET_ID, 1, 1);
  });

  // --------------------------------------------------------------------
  // Region cases — these mirror cell-reads-region.test.ts at the API edge,
  // adding the `isArrayMember` derivation + `valueType` projection.
  // --------------------------------------------------------------------

  it('plain cell with formula and `region: null` ⇒ isArrayMember=false', async () => {
    const getCellIdAt = jest.fn(async () => 'plain-cell');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'plain-cell',
      value: 7,
      formula: '=A1+1',
      metadata: { region: null },
      isFormulaHidden: false,
    }));
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('B2');
    expect(result?.region).toBeNull();
    expect(result?.isArrayMember).toBe(false);
    expect(result?.formula).toBe('=A1+1');
    expect(result?.value).toBe(7);
    expect(result?.valueType).toBe(RangeValueType.Double);
  });

  it('plain literal-string cell ⇒ valueType=String', async () => {
    const getCellIdAt = jest.fn(async () => 'str-cell');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'str-cell',
      value: 'Revenue',
      isFormulaHidden: false,
    }));
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('A1');
    expect(result?.value).toBe('Revenue');
    expect(result?.valueType).toBe(RangeValueType.String);
    expect(result?.formula).toBeNull();
    expect(result?.region).toBeNull();
    expect(result?.isArrayMember).toBe(false);
  });

  it('CSE anchor (kind=cseArray, isAnchor=true) ⇒ isArrayMember=false', async () => {
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
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('D1');
    expect(result?.region?.kind).toBe('cseArray');
    expect(result?.region?.isAnchor).toBe(true);
    expect(result?.isArrayMember).toBe(false);
  });

  it('CSE member (kind=cseArray, isAnchor=false) ⇒ isArrayMember=true', async () => {
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
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('D3');
    expect(result?.region?.kind).toBe('cseArray');
    expect(result?.region?.isAnchor).toBe(false);
    expect(result?.isArrayMember).toBe(true);
  });

  it('dynamic-array spill anchor (kind=arraySpill) ⇒ isArrayMember=false', async () => {
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
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('A1');
    expect(result?.region?.kind).toBe('arraySpill');
    expect(result?.region?.isAnchor).toBe(true);
    expect(result?.isArrayMember).toBe(false);
    expect(result?.formula).toBe('=SEQUENCE(5)');
  });

  it('dynamic-array spill member (no CellId at member ⇒ projection-source path) ⇒ isArrayMember=true', async () => {
    // Member at (2,0) — has no CellId of its own. Bridge resolves projection
    // source to (0,0) which has the anchor's CellId.
    const getCellIdAt = jest.fn(async (_sheet: unknown, row: number, col: number) => {
      if (row === 0 && col === 0) return 'anchor-spill';
      return null;
    });
    const getProjectionSource = jest.fn(async () => ({ row: 0, col: 0 }));
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

    const ws = makeWs({
      getCellIdAt,
      getProjectionSource,
      getActiveCell,
      getCellData,
    } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('A3');
    expect(result?.region?.kind).toBe('arraySpill');
    expect(result?.region?.isAnchor).toBe(false);
    expect(result?.isArrayMember).toBe(true);
    expect(result?.formula).toBe('=SEQUENCE(5)');
  });

  // --------------------------------------------------------------------
  // Data Table — the case that motivates this plan.
  // --------------------------------------------------------------------

  it('Data Table master (kind=dataTable, isAnchor=true) ⇒ isArrayMember=false, valueType=Double for B2', async () => {
    const getCellIdAt = jest.fn(async () => 'master-dt');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'master-dt',
      value: 11,
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
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('B2');
    expect(result?.region?.kind).toBe('dataTable');
    expect(result?.region?.isAnchor).toBe(true);
    expect(result?.isArrayMember).toBe(false);
    expect(result?.valueType).toBe(RangeValueType.Double);
    expect(result?.formula).toBe('=TABLE($A$2,$A$1)');
  });

  it('Data Table body (kind=dataTable, isAnchor=false) ⇒ isArrayMember=true', async () => {
    const getCellIdAt = jest.fn(async () => 'body-dt');
    const getActiveCell = jest.fn(async () => ({
      cellId: 'body-dt',
      value: 22,
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
    const ws = makeWs({ getCellIdAt, getActiveCell } as unknown as Partial<Bridge>);

    const result = await ws.cells.get('C3');
    expect(result?.region?.kind).toBe('dataTable');
    expect(result?.region?.isAnchor).toBe(false);
    expect(result?.isArrayMember).toBe(true);
  });

  // --------------------------------------------------------------------
  // valueType discrimination — the 5 OfficeJS-aligned tags.
  // --------------------------------------------------------------------

  describe('valueType discrimination', () => {
    function bridgeForValue(value: unknown): Partial<Bridge> {
      const getCellIdAt = jest.fn(async () => 'v-cell');
      const getActiveCell = jest.fn(async () => ({
        cellId: 'v-cell',
        value,
        isFormulaHidden: false,
      }));
      return { getCellIdAt, getActiveCell } as unknown as Partial<Bridge>;
    }

    it('empty in-bounds cell (no CellId, no fallback hit) ⇒ valueType=Empty, value=null', async () => {
      // No getCellIdAt match, no projection, no getCellData hit ⇒ getData returns undefined.
      const getCellIdAt = jest.fn(async () => null);
      const getProjectionSource = jest.fn(async () => null);
      const getCellData = jest.fn(async () => null);
      const ws = makeWs({
        getCellIdAt,
        getProjectionSource,
        getCellData,
      } as unknown as Partial<Bridge>);

      const result = await ws.cells.get('Z99');
      expect(result).toBeDefined();
      expect(result?.value).toBeNull();
      expect(result?.valueType).toBe(RangeValueType.Empty);
      expect(result?.formula).toBeNull();
      expect(result?.region).toBeNull();
      expect(result?.isArrayMember).toBe(false);
    });

    it('number ⇒ valueType=Double', async () => {
      const ws = makeWs(bridgeForValue(3.14));
      const result = await ws.cells.get('A1');
      expect(result?.value).toBe(3.14);
      expect(result?.valueType).toBe(RangeValueType.Double);
    });

    it('string ⇒ valueType=String', async () => {
      const ws = makeWs(bridgeForValue('hello'));
      const result = await ws.cells.get('A1');
      expect(result?.value).toBe('hello');
      expect(result?.valueType).toBe(RangeValueType.String);
    });

    it('boolean ⇒ valueType=Boolean', async () => {
      const ws = makeWs(bridgeForValue(true));
      const result = await ws.cells.get('A1');
      expect(result?.value).toBe(true);
      expect(result?.valueType).toBe(RangeValueType.Boolean);
    });

    it('error display string ⇒ valueType=Error', async () => {
      // String values matching an Excel error display (e.g. "#DIV/0!") are
      // discriminated as Error by the public cell-read classifier.
      const ws = makeWs(bridgeForValue('#DIV/0!'));
      const result = await ws.cells.get('A1');
      expect(result?.value).toBe('#DIV/0!');
      expect(result?.valueType).toBe(RangeValueType.Error);
    });

    it('CellError object ⇒ valueType=Error, value normalized to display string', async () => {
      // The bridge can also surface errors as `{type:'error', value:'Na'}`
      // objects — the projection normalizes to the display string for the
      // public `value` field.
      const ws = makeWs(bridgeForValue({ type: 'error', value: 'Na' }));
      const result = await ws.cells.get('A1');
      expect(result?.valueType).toBe(RangeValueType.Error);
      expect(result?.value).toBe('#N/A');
    });
  });
});

describe('Worksheet address-bearing bulk cell reads', () => {
  it('getCells returns a dense flat list with sheet, address, absolute coordinates, and range origin', async () => {
    const queryRange = jest.fn(async () => ({
      cells: [
        {
          row: 1,
          col: 1,
          cellId: 'b2',
          value: 42,
          formatted: '42',
          format: { numberFormat: '0' },
        },
        {
          row: 2,
          col: 2,
          cellId: 'c3',
          value: true,
          formula: '=A1=1',
          formatted: 'TRUE',
        },
      ],
      merges: [],
    }));
    const ws = makeNamedWs({ queryRange } as unknown as Partial<Bridge>);

    const cells = await ws.getCells('B2:C3');

    expect(queryRange).toHaveBeenCalledWith(SHEET_ID, 1, 1, 2, 2);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({
      sheet: 'Sheet1',
      sheetId: SHEET_ID,
      address: 'B2',
      row: 1,
      col: 1,
      offsetRow: 0,
      offsetCol: 0,
      range: { address: 'B2:C3', startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      value: 42,
      valueType: RangeValueType.Double,
      formula: null,
      format: { numberFormat: '0' },
      formatted: '42',
    });
    expect(cells[1]).toMatchObject({
      address: 'C2',
      row: 1,
      col: 2,
      offsetRow: 0,
      offsetCol: 1,
      value: null,
      valueType: RangeValueType.Empty,
      formula: null,
    });
    expect(cells[3]).toMatchObject({
      address: 'C3',
      row: 2,
      col: 2,
      offsetRow: 1,
      offsetCol: 1,
      value: true,
      valueType: RangeValueType.Boolean,
      formula: '=A1=1',
      formatted: 'TRUE',
    });
  });

  it('getCells sparse mode omits empty coordinates but keeps formatted or formula cells', async () => {
    const queryRange = jest.fn(async () => ({
      cells: [
        { row: 0, col: 1, cellId: 'b1', value: null, formatted: '-' },
        { row: 1, col: 0, cellId: 'a2', value: null, formula: '=NA()' },
      ],
      merges: [],
    }));
    const ws = makeNamedWs({ queryRange } as unknown as Partial<Bridge>);

    const cells = await ws.getCells('A1:B2', { sparse: true });

    expect(cells.map((cell) => cell.address)).toEqual(['B1', 'A2']);
    expect(cells[0].formatted).toBe('-');
    expect(cells[1].formula).toBe('=NA()');
  });

  it('cells.list valuesOnly keeps address metadata without formula or format fields', async () => {
    const queryRange = jest.fn(async () => ({
      cells: [{ row: 0, col: 0, cellId: 'a1', value: 7, formula: '=3+4', formatted: '7' }],
      merges: [],
    }));
    const ws = makeNamedWs({ queryRange } as unknown as Partial<Bridge>);

    const cells = await ws.cells.list('A1:A1', { valuesOnly: true });

    expect(cells).toEqual([
      {
        sheet: 'Sheet1',
        sheetId: SHEET_ID,
        address: 'A1',
        row: 0,
        col: 0,
        offsetRow: 0,
        offsetCol: 0,
        range: { address: 'A1:A1', startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        value: 7,
        valueType: RangeValueType.Double,
        formatted: '7',
      },
    ]);
    expect(cells[0]).not.toHaveProperty('formula');
    expect(cells[0]).not.toHaveProperty('format');
  });

  it('getCells formulasOnly returns only formula cells with non-null formula text', async () => {
    const queryRange = jest.fn(async () => ({
      cells: [
        { row: 0, col: 0, cellId: 'a1', value: 10 },
        { row: 0, col: 1, cellId: 'b1', value: 20, formula: '=A1*2' },
      ],
      merges: [],
    }));
    const ws = makeNamedWs({ queryRange } as unknown as Partial<Bridge>);

    const cells = await ws.getCells('A1:B1', { formulasOnly: true });

    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      address: 'B1',
      value: 20,
      valueType: RangeValueType.Double,
      formula: '=A1*2',
    });
  });

  it('getCells rejects mutually exclusive valuesOnly and formulasOnly modes', async () => {
    const queryRange = jest.fn(async () => ({ cells: [], merges: [] }));
    const ws = makeNamedWs({ queryRange } as unknown as Partial<Bridge>);

    await expect(
      ws.getCells('A1:A1', { valuesOnly: true, formulasOnly: true } as never),
    ).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      path: ['options'],
    });
    expect(queryRange).not.toHaveBeenCalled();
  });

  it('forEachCell iterates full address-bearing cells sequentially', async () => {
    const queryRange = jest.fn(async () => ({
      cells: [{ row: 0, col: 1, cellId: 'b1', value: 'tail' }],
      merges: [],
    }));
    const ws = makeNamedWs({ queryRange } as unknown as Partial<Bridge>);
    const seen: string[] = [];

    await ws.forEachCell('A1:B1', async (cell, index) => {
      seen.push(`${index}:${cell.address}:${cell.value ?? ''}`);
    });

    expect(seen).toEqual(['0:A1:', '1:B1:tail']);
  });
});
