import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetStructureImpl } from '../structure';

const SHEET_ID = sheetId('00000000-0000-0000-0000-000000000001');

function createCtx() {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    computeBridge: {
      removeDuplicates: jest.fn().mockResolvedValue({
        data: {
          duplicatesRemoved: 2,
          uniqueValuesRemaining: 3,
        },
      }),
      invalidateAllViewportPrefetch: jest.fn(),
      forceRefreshAllViewports: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('WorksheetStructureImpl.removeDuplicates', () => {
  it('uses Rust full-viewport patches without a redundant force refresh', async () => {
    const ctx = createCtx();
    const structure = new WorksheetStructureImpl(ctx as never, SHEET_ID);

    const result = await structure.removeDuplicates('N21:O26', [13, 14], true);

    expect(ctx.writeGate.assertWritable).toHaveBeenCalledWith('structure.removeDuplicates');
    expect(ctx.computeBridge.removeDuplicates).toHaveBeenCalledWith(
      SHEET_ID,
      20,
      13,
      25,
      14,
      [13, 14],
      true,
    );
    expect(ctx.computeBridge.invalidateAllViewportPrefetch).not.toHaveBeenCalled();
    expect(ctx.computeBridge.forceRefreshAllViewports).not.toHaveBeenCalled();
    expect(result).toEqual({ removedCount: 2, remainingCount: 3 });
  });
});
