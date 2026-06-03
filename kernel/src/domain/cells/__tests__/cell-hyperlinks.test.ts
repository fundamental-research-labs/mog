import { jest } from '@jest/globals';
import { sheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../../context/types';
import { getHyperlink } from '../cell-hyperlinks';

type Bridge = DocumentContext['computeBridge'];

function buildCtx(bridge: Partial<Bridge>): DocumentContext {
  return {
    computeBridge: bridge,
  } as unknown as DocumentContext;
}

describe('cell hyperlinks', () => {
  it('falls back to queryRange for formula-derived hyperlink metadata', async () => {
    const getHyperlinkBridge = jest.fn(async () => null);
    const queryRange = jest.fn(async () => ({
      cells: [{ row: 0, col: 1, hyperlinkUrl: 'https://example.com' }],
      merges: [],
    }));

    const ctx = buildCtx({
      getHyperlink: getHyperlinkBridge,
      queryRange,
    } as unknown as Partial<Bridge>);

    await expect(getHyperlink(ctx, sheetId('S1'), 0, 1)).resolves.toBe('https://example.com');
    expect(queryRange).toHaveBeenCalledWith(sheetId('S1'), 0, 1, 0, 1);
  });

  it('does not queryRange when explicit hyperlink metadata exists', async () => {
    const getHyperlinkBridge = jest.fn(async () => 'https://example.com');
    const queryRange = jest.fn(async () => ({
      cells: [],
      merges: [],
    }));

    const ctx = buildCtx({
      getHyperlink: getHyperlinkBridge,
      queryRange,
    } as unknown as Partial<Bridge>);

    await expect(getHyperlink(ctx, sheetId('S1'), 0, 1)).resolves.toBe('https://example.com');
    expect(queryRange).not.toHaveBeenCalled();
  });
});
