import { jest } from '@jest/globals';

import { applyConditionalFormatsFromClipboard } from '../conditional-format-paste';

const SHEET_ID = 'sheet-cf-copy-paste' as any;
const CLIPBOARD_CF = {
  ranges: [{ startRowOffset: 0, startColOffset: 0, endRowOffset: 0, endColOffset: 0 }],
  rules: [
    {
      priority: 0,
      type: 'cellValue',
      operator: 'greaterThan',
      value1: 100,
      style: { backgroundColor: '#FF0000' },
    },
  ],
};

describe('clipboard conditional formatting', () => {
  it('recreates relative CF rules at the paste target', async () => {
    const createConditionalFormat = jest.fn(async () => 'fmt-pasted');

    await applyConditionalFormatsFromClipboard(
      [CLIPBOARD_CF],
      { row: 0, col: 1 },
      SHEET_ID,
      createConditionalFormat,
      false,
    );

    expect(createConditionalFormat).toHaveBeenCalledTimes(1);
    expect(createConditionalFormat).toHaveBeenCalledWith(
      SHEET_ID,
      [{ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }],
      [
        {
          priority: 0,
          type: 'cellValue',
          operator: 'greaterThan',
          value1: 100,
          style: { backgroundColor: '#FF0000' },
        },
      ],
    );
  });
});
