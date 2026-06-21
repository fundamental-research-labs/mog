import { jest } from '@jest/globals';

import { MAX_COLS, MAX_ROWS, sheetId } from '@mog-sdk/contracts/core';
import type { MutationAdmissionOptions } from '../../../../bridges/compute';
import {
  applyFormatToRange,
  clearFormat,
  setCellProperties,
  setColumnProperties,
  setFormat,
  setFormatForRanges,
  setRowProperties,
} from '../format-operations';

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
    clock: {
      now: jest.fn(() => 1_797_779_600_000),
    },
    computeBridge: {
      canDoStructureOp: jest.fn().mockResolvedValue(true),
      setFormatForRanges: jest.fn().mockResolvedValue({}),
      clearFormatForRanges: jest.fn().mockResolvedValue({}),
      setRowFormat: jest.fn().mockResolvedValue({}),
      setColFormat: jest.fn().mockResolvedValue({}),
      setRowFormats: jest.fn().mockResolvedValue({}),
      setColFormats: jest.fn().mockResolvedValue({}),
      setCellPropertiesBatch: jest.fn().mockResolvedValue({}),
      queryRange: jest.fn().mockResolvedValue({ cells: [], merges: [] }),
    },
  };
}

function mutationOptions(operationId = 'formats.test:1'): MutationAdmissionOptions {
  return {
    operationContext: {
      operationId,
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      sheetIds: [SHEET_ID],
      domainIds: ['formats'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    },
  };
}

function expectFormatAdmission(operationIdPrefix?: string) {
  const operationContext: Record<string, unknown> = {
    kind: 'mutation',
    sheetIds: [SHEET_ID],
    domainIds: ['formats'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  };
  if (operationIdPrefix) {
    operationContext.operationId = expect.stringMatching(
      new RegExp(`^${escapeRegExp(operationIdPrefix)}:`),
    );
  }
  return expect.objectContaining({
    operationContext: expect.objectContaining(operationContext),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('format operations admission options', () => {
  it('passes provided admission options through representative set and clear operations', async () => {
    const ctx = createMockCtx();
    const options = mutationOptions();

    await setFormat(ctx, SHEET_ID, 0, 1, { bold: true }, options);
    await clearFormat(ctx, SHEET_ID, 2, 3, options);

    expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 1, 0, 1]],
      { bold: true },
      options,
    );
    expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[2, 3, 2, 3]],
      options,
    );
  });

  it('passes grouped options through full row, full column, and bounded range routing', async () => {
    const ctx = createMockCtx();
    const options = mutationOptions('formats.setRanges:1');
    const format = { italic: true };

    await setFormatForRanges(
      ctx,
      SHEET_ID,
      [
        {
          sheetId: SHEET_ID,
          startRow: 0,
          startCol: 1,
          endRow: MAX_ROWS - 1,
          endCol: 1,
          isFullColumn: true,
        },
        {
          sheetId: SHEET_ID,
          startRow: 4,
          startCol: 0,
          endRow: 4,
          endCol: MAX_COLS - 1,
          isFullRow: true,
        },
        { sheetId: SHEET_ID, startRow: 5, startCol: 5, endRow: 6, endCol: 6 },
      ],
      format,
      options,
    );

    expect(ctx.computeBridge.setColFormat).toHaveBeenCalledWith(
      SHEET_ID,
      1,
      format,
      expectFormatAdmission(),
    );
    expect(ctx.computeBridge.setRowFormat).toHaveBeenCalledWith(
      SHEET_ID,
      4,
      format,
      expectFormatAdmission('formats.setRanges'),
    );
    expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[5, 5, 6, 6]],
      format,
      expectFormatAdmission('formats.setRanges'),
    );

    const colOptions = ctx.computeBridge.setColFormat.mock.calls[0][3];
    const rowOptions = ctx.computeBridge.setRowFormat.mock.calls[0][3];
    const rangeOptions = ctx.computeBridge.setFormatForRanges.mock.calls[0][3];
    expect(colOptions.operationContext.groupId).toBe(options.operationContext?.operationId);
    expect(rowOptions.operationContext.groupId).toBe(colOptions.operationContext.groupId);
    expect(rangeOptions.operationContext.groupId).toBe(colOptions.operationContext.groupId);
    expect(rowOptions.operationContext.operationId).not.toBe(
      colOptions.operationContext.operationId,
    );
  });

  it('passes admission options to row, column, and cell property batch writes', async () => {
    const ctx = createMockCtx();
    const rowOptions = mutationOptions('formats.setRowProperties:1');
    const colOptions = mutationOptions('formats.setColumnProperties:1');
    const cellOptions = mutationOptions('formats.setCellProperties:1');

    await setRowProperties(ctx, SHEET_ID, new Map([[2, { bold: true }]]), rowOptions);
    await setColumnProperties(ctx, SHEET_ID, new Map([[3, { italic: true }]]), colOptions);
    await setCellProperties(
      ctx,
      SHEET_ID,
      [{ row: 4, col: 5, format: { underlineType: 'single' } }],
      cellOptions,
    );

    expect(ctx.computeBridge.setRowFormats).toHaveBeenCalledWith(
      SHEET_ID,
      [[2, { bold: true }]],
      rowOptions,
    );
    expect(ctx.computeBridge.setColFormats).toHaveBeenCalledWith(
      SHEET_ID,
      [[3, { italic: true }]],
      colOptions,
    );
    expect(ctx.computeBridge.setCellPropertiesBatch).toHaveBeenCalledWith(
      SHEET_ID,
      [[4, 5, { underlineType: 'single' }]],
      cellOptions,
    );
  });

  it('groups multi-format applyFormatToRange bridge writes under one command', async () => {
    const ctx = createMockCtx();
    const options = mutationOptions('formats.applyFormatToRange:1');
    ctx.computeBridge.queryRange.mockResolvedValueOnce({
      cells: [
        { row: 0, col: 0, format: { bold: true } },
        { row: 0, col: 1, format: { italic: true } },
      ],
      merges: [],
    });

    await applyFormatToRange(
      ctx,
      SHEET_ID,
      { bold: true },
      { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
      { sheetId: SHEET_ID, startRow: 2, startCol: 0, endRow: 2, endCol: 1 },
      options,
    );

    expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 0, 1);
    expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledTimes(2);
    const firstOptions = ctx.computeBridge.setFormatForRanges.mock.calls[0][3];
    const secondOptions = ctx.computeBridge.setFormatForRanges.mock.calls[1][3];
    expect(firstOptions).toEqual(expectFormatAdmission());
    expect(secondOptions).toEqual(expectFormatAdmission('formats.applyFormatToRange'));
    expect(firstOptions.operationContext.groupId).toBe(options.operationContext?.operationId);
    expect(secondOptions.operationContext.groupId).toBe(firstOptions.operationContext.groupId);
    expect(secondOptions.operationContext.operationId).not.toBe(
      firstOptions.operationContext.operationId,
    );
  });
});
