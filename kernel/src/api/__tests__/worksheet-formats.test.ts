import { jest } from '@jest/globals';

import { MAX_COLS, MAX_ROWS, sheetId } from '@mog-sdk/contracts/core';
import { WorksheetFormatsImpl } from '../worksheet/formats';

const SHEET_ID = sheetId('sheet-1');
const FORMAT_DOMAIN_IDS = ['formats'] as const;
const DIRECT_CELL_FORMAT_DOMAIN_IDS = ['cells.formats.direct'] as const;

function createMockCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    computeBridge: {
      canDoStructureOp: jest.fn().mockResolvedValue(true),
      setFormatForRanges: jest.fn().mockResolvedValue({ propertyChanges: [{}] }),
      patchFormatForRanges: jest.fn().mockResolvedValue({ propertyChanges: [{}] }),
      patchBorders: jest.fn().mockResolvedValue({ propertyChanges: [{}] }),
      clearFormatForRanges: jest.fn().mockResolvedValue({}),
      patchRowFormat: jest.fn().mockResolvedValue({}),
      patchColFormat: jest.fn().mockResolvedValue({}),
      patchRowFormats: jest.fn().mockResolvedValue({}),
      patchColFormats: jest.fn().mockResolvedValue({}),
      patchCellPropertiesBatch: jest.fn().mockResolvedValue({}),
      queryRange: jest.fn().mockResolvedValue({ cells: [], merges: [] }),
      getResolvedFormat: jest.fn().mockResolvedValue({}),
    },
  };
}

function expectFormatAdmission(
  operationIdPrefix: string,
  domainIds: readonly string[] = FORMAT_DOMAIN_IDS,
) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(new RegExp(`^${escapeRegExp(operationIdPrefix)}:`)),
      kind: 'mutation',
      author: expect.objectContaining({ actorKind: 'user' }),
      sheetIds: [SHEET_ID],
      domainIds,
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('WorksheetFormatsImpl admission options', () => {
  let ctx: any;
  let formats: WorksheetFormatsImpl;

  beforeEach(() => {
    ctx = createMockCtx();
    formats = new WorksheetFormatsImpl(ctx, SHEET_ID);
  });

  it('passes format operation context to set and clear bridge calls', async () => {
    await formats.set('A1', { bold: true });
    await formats.clearCell('B2');

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 0, 0]],
      { bold: true },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[1, 1, 1, 1]],
      expectFormatAdmission('formats.clearCell', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
  });

  it('uses the direct cell format domain for range and cell-property writes', async () => {
    await formats.setRange('A1:B2', { bold: true });
    await formats.setCellProperties([{ row: 2, col: 3, format: { italic: true } }]);

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 1, 1]],
      { bold: true },
      [],
      expectFormatAdmission('formats.setRange', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.patchCellPropertiesBatch).toHaveBeenCalledWith(
      SHEET_ID,
      [[2, 3, { italic: true }, []]],
      expectFormatAdmission('formats.setCellProperties', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
  });

  it('normalizes supported compatibility format containers before bridge writes', async () => {
    await formats.set('A1', {
      font: { bold: true, color: '#FF0000', underline: true },
      fill: { color: '#ADD8E6' },
      alignment: { horizontalAlignment: 'Center', verticalAlignment: 'Center', indentLevel: 2 },
      protection: { locked: true },
      border: {
        style: 'thin',
        color: '#111111',
        bottom: { style: 'thick', color: '#222222' },
      },
    } as any);

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 0, 0]],
      {
        bold: true,
        fontColor: '#FF0000',
        underlineType: 'single',
        backgroundColor: '#ADD8E6',
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        indent: 2,
        locked: true,
        borders: {
          top: { style: 'thin', color: '#111111' },
          right: { style: 'thin', color: '#111111' },
          bottom: { style: 'thick', color: '#222222' },
          left: { style: 'thin', color: '#111111' },
        },
      },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
  });

  it('normalizes supported top-level aliases to canonical bridge fields', async () => {
    await formats.set('A1', {
      fillColor: '#D9EAF7',
      horizontalAlignment: 'Center',
      verticalAlignment: 'Center',
    } as any);

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 0, 0]],
      {
        backgroundColor: '#D9EAF7',
        horizontalAlign: 'center',
        verticalAlign: 'middle',
      },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
  });

  it('uses canonical fields before aliases and aliases before containers regardless of order', async () => {
    const canonicalLast = Object.fromEntries([
      ['fill', { color: '#111111' }],
      ['fillColor', '#222222'],
      ['backgroundColor', '#333333'],
      ['alignment', { horizontalAlignment: 'left', verticalAlignment: 'top' }],
      ['horizontalAlignment', 'center'],
      ['verticalAlignment', 'center'],
      ['horizontalAlign', 'right'],
      ['verticalAlign', 'bottom'],
    ]);
    const aliasLast = Object.fromEntries([
      ['fill', { color: '#111111' }],
      ['alignment', { horizontalAlignment: 'left', verticalAlignment: 'top' }],
      ['backgroundColor', '#333333'],
      ['horizontalAlign', 'right'],
      ['verticalAlign', 'bottom'],
      ['fillColor', '#222222'],
      ['horizontalAlignment', 'center'],
      ['verticalAlignment', 'center'],
    ]);

    await formats.set('A1', canonicalLast as any);
    await formats.set('B1', aliasLast as any);
    await formats.set('C1', {
      fill: { color: '#111111' },
      alignment: { horizontalAlignment: 'left', verticalAlignment: 'top' },
      fillColor: '#222222',
      horizontalAlignment: 'center',
      verticalAlignment: 'center',
    } as any);
    await formats.set('D1', {
      fillColor: '#222222',
      horizontalAlignment: 'center',
      verticalAlignment: 'center',
      fill: { color: '#111111' },
      alignment: { horizontalAlignment: 'left', verticalAlignment: 'top' },
    } as any);

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenNthCalledWith(
      1,
      SHEET_ID,
      [[0, 0, 0, 0]],
      {
        backgroundColor: '#333333',
        horizontalAlign: 'right',
        verticalAlign: 'bottom',
      },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenNthCalledWith(
      2,
      SHEET_ID,
      [[0, 1, 0, 1]],
      {
        backgroundColor: '#333333',
        horizontalAlign: 'right',
        verticalAlign: 'bottom',
      },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenNthCalledWith(
      3,
      SHEET_ID,
      [[0, 2, 0, 2]],
      {
        backgroundColor: '#222222',
        horizontalAlign: 'center',
        verticalAlign: 'middle',
      },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenNthCalledWith(
      4,
      SHEET_ID,
      [[0, 3, 0, 3]],
      {
        backgroundColor: '#222222',
        horizontalAlign: 'center',
        verticalAlign: 'middle',
      },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
  });

  it('preserves alias clear and undefined no-op semantics', async () => {
    await formats.set('A1', {
      fillColor: null,
      horizontalAlignment: null,
      verticalAlignment: null,
      fill: { color: '#111111' },
      alignment: { horizontalAlignment: 'left', verticalAlignment: 'top' },
    } as any);
    await formats.set('B1', {
      fillColor: undefined,
      verticalAlignment: undefined,
      fill: { color: '#111111' },
      alignment: { verticalAlignment: 'Top' },
    } as any);

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenNthCalledWith(
      1,
      SHEET_ID,
      [[0, 0, 0, 0]],
      {},
      ['backgroundColor', 'horizontalAlign', 'verticalAlign'],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenNthCalledWith(
      2,
      SHEET_ID,
      [[0, 1, 0, 1]],
      { backgroundColor: '#111111', verticalAlign: 'top' },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
  });

  it('keeps canonical flat keys authoritative when compatibility containers overlap', async () => {
    await formats.set('A1', {
      bold: false,
      fontColor: '#111111',
      backgroundColor: '#222222',
      font: { bold: true, color: '#FF0000' },
      fill: { color: '#ADD8E6' },
    } as any);

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 0, 0]],
      {
        bold: false,
        fontColor: '#111111',
        backgroundColor: '#222222',
      },
      [],
      expectFormatAdmission('formats.set', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
  });

  it('rejects unsupported top-level and nested format keys before bridge writes', async () => {
    await expect(
      formats.set('A1', {
        fill: { color: '#ADD8E6', themeColor: 'accent1' },
      } as any),
    ).rejects.toThrow('Unsupported format property "formats.set.format.fill.themeColor".');

    await expect(
      formats.set('A1', {
        font: { bold: true },
        richText: { bold: true },
      } as any),
    ).rejects.toThrow('Unsupported format property "formats.set.format.richText".');

    expect(ctx.computeBridge.patchFormatForRanges).not.toHaveBeenCalled();
  });

  it('normalizes compatibility inputs for bulk row and column properties', async () => {
    await formats.setRowProperties(
      new Map([
        [
          2,
          {
            font: { bold: true },
            fill: { color: '#ADD8E6' },
          } as any,
        ],
      ]),
    );
    await formats.setColumnProperties(
      new Map([
        [
          3,
          {
            alignment: { verticalAlignment: 'Center' },
            protection: { hidden: true },
          } as any,
        ],
      ]),
    );

    expect(ctx.computeBridge.patchRowFormats).toHaveBeenCalledWith(
      SHEET_ID,
      [
        [
          2,
          {
            bold: true,
            backgroundColor: '#ADD8E6',
          },
          [],
        ],
      ],
      expectFormatAdmission('formats.setRowProperties'),
    );
    expect(ctx.computeBridge.patchColFormats).toHaveBeenCalledWith(
      SHEET_ID,
      [
        [
          3,
          {
            verticalAlign: 'middle',
            hidden: true,
          },
          [],
        ],
      ],
      expectFormatAdmission('formats.setColumnProperties'),
    );
  });

  it('normalizes top-level aliases for bulk row properties', async () => {
    await formats.setRowProperties(
      new Map([
        [
          4,
          {
            fillColor: '#D9EAF7',
            horizontalAlignment: 'Center',
            verticalAlignment: 'Center',
          } as any,
        ],
      ]),
    );

    expect(ctx.computeBridge.patchRowFormats).toHaveBeenCalledWith(
      SHEET_ID,
      [
        [
          4,
          {
            backgroundColor: '#D9EAF7',
            horizontalAlign: 'center',
            verticalAlign: 'middle',
          },
          [],
        ],
      ],
      expectFormatAdmission('formats.setRowProperties'),
    );
  });

  it('passes grouped context to full row, full column, and bounded setRanges writes', async () => {
    const format = { italic: true };

    await formats.setRanges(
      [
        {
          sheetId: SHEET_ID,
          startRow: 0,
          startCol: 1,
          endRow: MAX_ROWS - 1,
          endCol: 2,
          isFullColumn: true,
        },
        {
          sheetId: SHEET_ID,
          startRow: 3,
          startCol: 0,
          endRow: 3,
          endCol: MAX_COLS - 1,
          isFullRow: true,
        },
        { sheetId: SHEET_ID, startRow: 4, startCol: 4, endRow: 5, endCol: 5 },
      ],
      format,
    );

    expect(ctx.computeBridge.patchColFormat).toHaveBeenCalledWith(
      SHEET_ID,
      1,
      format,
      [],
      expectFormatAdmission('formats.setRanges'),
    );
    expect(ctx.computeBridge.patchColFormat).toHaveBeenCalledWith(
      SHEET_ID,
      2,
      format,
      [],
      expectFormatAdmission('formats.setRanges'),
    );
    expect(ctx.computeBridge.patchRowFormat).toHaveBeenCalledWith(
      SHEET_ID,
      3,
      format,
      [],
      expectFormatAdmission('formats.setRanges'),
    );
    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[4, 4, 5, 5]],
      format,
      [],
      expectFormatAdmission('formats.setRanges', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );

    const groupId = ctx.computeBridge.patchColFormat.mock.calls[0][4].operationContext.groupId;
    expect(groupId).toEqual(expect.any(String));
    for (const call of [
      ...ctx.computeBridge.patchColFormat.mock.calls,
      ...ctx.computeBridge.patchRowFormat.mock.calls,
      ...ctx.computeBridge.patchFormatForRanges.mock.calls,
    ]) {
      expect(call[call.length - 1].operationContext.groupId).toBe(groupId);
    }
  });

  it('routes one ordered border batch across cell, row, and column targets', async () => {
    const fullColumns = {
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 1,
      endRow: MAX_ROWS - 1,
      endCol: 2,
      isFullColumn: true,
    };
    const fullRow = {
      sheetId: SHEET_ID,
      startRow: 3,
      startCol: 0,
      endRow: 3,
      endCol: MAX_COLS - 1,
      isFullRow: true,
    };
    const cells = { sheetId: SHEET_ID, startRow: 4, startCol: 4, endRow: 5, endCol: 5 };

    await formats.patchBorders([
      {
        ranges: [fullColumns, fullRow, cells],
        borders: {
          top: null,
          diagonal: { style: 'thin', color: '#000000', direction: 'up' },
        },
      },
    ]);

    const borders = {
      diagonal: { style: 'thin', color: '#000000' },
      diagonalUp: true,
      diagonalDown: false,
    };
    expect(ctx.computeBridge.patchBorders).toHaveBeenCalledWith(
      SHEET_ID,
      [
        {
          target: { kind: 'column', col: 1 },
          borders,
          clearFields: ['top'],
        },
        {
          target: { kind: 'column', col: 2 },
          borders,
          clearFields: ['top'],
        },
        {
          target: { kind: 'row', row: 3 },
          borders,
          clearFields: ['top'],
        },
        {
          target: {
            kind: 'cells',
            startRow: 4,
            startCol: 4,
            endRow: 5,
            endCol: 5,
          },
          borders,
          clearFields: ['top'],
        },
      ],
      expectFormatAdmission('formats.patchBorders', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.patchFormatForRanges).not.toHaveBeenCalled();
    expect(ctx.computeBridge.patchRowFormat).not.toHaveBeenCalled();
    expect(ctx.computeBridge.patchColFormat).not.toHaveBeenCalled();
  });

  it('groups clearFill clear and reapply bridge writes under one command', async () => {
    ctx.computeBridge.queryRange.mockResolvedValueOnce({
      cells: [{ row: 0, col: 0, format: { bold: true, backgroundColor: '#FF0000' } }],
      merges: [],
    });

    await formats.clearFill('A1');

    expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 0, 0);
    expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 0, 0]],
      expectFormatAdmission('formats.clearFill', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 0, 0]],
      { bold: true },
      expectFormatAdmission('formats.clearFill', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );

    const clearOptions = ctx.computeBridge.clearFormatForRanges.mock.calls[0][2];
    const reapplyOptions = ctx.computeBridge.setFormatForRanges.mock.calls[0][3];
    expect(clearOptions.operationContext.groupId).toBe(clearOptions.operationContext.operationId);
    expect(reapplyOptions.operationContext.groupId).toBe(clearOptions.operationContext.groupId);
    expect(reapplyOptions.operationContext.operationId).not.toBe(
      clearOptions.operationContext.operationId,
    );
  });
});
