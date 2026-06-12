import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetHyperlinksImpl } from '../hyperlinks';

const SHEET_ID = sheetId('sheet-1');

function createCtx(hyperlinks: unknown[]) {
  return {
    computeBridge: {
      getHyperlinks: jest.fn().mockResolvedValue(hyperlinks),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
  } as any;
}

describe('WorksheetHyperlinksImpl', () => {
  it('list returns domain hyperlink metadata from the compute bridge', async () => {
    const ctx = createCtx([
      {
        cellRef: 'A1',
        target: 'https://example.com',
        location: null,
        display: 'Open docs',
        tooltip: 'Docs',
      },
      {
        cellRef: 'A2',
        target: null,
        location: 'Target!B2',
        display: 'Jump',
        tooltip: null,
      },
    ]);
    const hyperlinks = new WorksheetHyperlinksImpl(ctx, SHEET_ID);

    await expect(hyperlinks.list()).resolves.toEqual([
      {
        address: 'A1',
        ref: 'A1',
        url: 'https://example.com',
        display: 'Open docs',
        tooltip: 'Docs',
      },
      {
        address: 'A2',
        ref: 'A2',
        url: 'Target!B2',
        display: 'Jump',
      },
    ]);
    expect(ctx.computeBridge.getHyperlinks).toHaveBeenCalledWith(SHEET_ID);
  });
});
