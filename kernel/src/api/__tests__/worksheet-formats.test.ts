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
      clearFormatForRanges: jest.fn().mockResolvedValue({}),
      setRowFormat: jest.fn().mockResolvedValue({}),
      setColFormat: jest.fn().mockResolvedValue({}),
      setCellPropertiesBatch: jest.fn().mockResolvedValue({}),
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

    expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 0, 0]],
      { bold: true },
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

    expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 1, 1]],
      { bold: true },
      expectFormatAdmission('formats.setRange', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );
    expect(ctx.computeBridge.setCellPropertiesBatch).toHaveBeenCalledWith(
      SHEET_ID,
      [[2, 3, { italic: true }]],
      expectFormatAdmission('formats.setCellProperties', DIRECT_CELL_FORMAT_DOMAIN_IDS),
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

    expect(ctx.computeBridge.setColFormat).toHaveBeenCalledWith(
      SHEET_ID,
      1,
      format,
      expectFormatAdmission('formats.setRanges'),
    );
    expect(ctx.computeBridge.setColFormat).toHaveBeenCalledWith(
      SHEET_ID,
      2,
      format,
      expectFormatAdmission('formats.setRanges'),
    );
    expect(ctx.computeBridge.setRowFormat).toHaveBeenCalledWith(
      SHEET_ID,
      3,
      format,
      expectFormatAdmission('formats.setRanges'),
    );
    expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[4, 4, 5, 5]],
      format,
      expectFormatAdmission('formats.setRanges', DIRECT_CELL_FORMAT_DOMAIN_IDS),
    );

    const groupId = ctx.computeBridge.setColFormat.mock.calls[0][3].operationContext.groupId;
    expect(groupId).toEqual(expect.any(String));
    for (const call of [
      ...ctx.computeBridge.setColFormat.mock.calls,
      ...ctx.computeBridge.setRowFormat.mock.calls,
      ...ctx.computeBridge.setFormatForRanges.mock.calls,
    ]) {
      expect(call[call.length - 1].operationContext.groupId).toBe(groupId);
    }
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
