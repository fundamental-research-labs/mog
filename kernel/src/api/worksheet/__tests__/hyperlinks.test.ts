import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetHyperlinksImpl } from '../hyperlinks';

const SHEET_ID = sheetId('sheet-1');

function createCtx(hyperlinks: unknown[]) {
  return {
    computeBridge: {
      getHyperlinks: jest.fn().mockResolvedValue(hyperlinks),
      getHyperlink: jest.fn().mockResolvedValue(null),
      removeHyperlink: jest.fn().mockResolvedValue({}),
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

  it('throws HYPERLINK_NOT_FOUND without dispatching a remove for an empty target', async () => {
    const ctx = createCtx([]);
    const hyperlinks = new WorksheetHyperlinksImpl(ctx, SHEET_ID);

    await expect(hyperlinks.remove('Z99')).rejects.toMatchObject({
      code: 'HYPERLINK_NOT_FOUND',
    });
    expect(ctx.computeBridge.removeHyperlink).not.toHaveBeenCalled();
  });

  it('removes an existing hyperlink and enforces the write gate', async () => {
    const ctx = createCtx([]);
    ctx.computeBridge.getHyperlink.mockResolvedValue('https://example.com');
    const hyperlinks = new WorksheetHyperlinksImpl(ctx, SHEET_ID);

    await expect(hyperlinks.remove('A1')).resolves.toBeUndefined();
    expect(ctx.writeGate.assertWritable).toHaveBeenCalledWith('hyperlinks.remove');
    expect(ctx.computeBridge.removeHyperlink).toHaveBeenCalledWith(SHEET_ID, 0, 0);
  });
});
