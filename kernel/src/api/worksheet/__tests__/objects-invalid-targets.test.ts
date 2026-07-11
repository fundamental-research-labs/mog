import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetObjectsImpl } from '../objects';

const SHEET_ID = sheetId('sheet-1');

function createCtx(object: unknown = null) {
  return {
    computeBridge: {
      getFloatingObjectTyped: jest.fn().mockResolvedValue(object),
    },
  } as any;
}

describe('WorksheetObjectsImpl invalid targets', () => {
  it('rejects a missing group member before invoking the grouping manager', async () => {
    const ctx = createCtx();
    const manager = { groupObjects: jest.fn() } as any;
    const objects = new WorksheetObjectsImpl(ctx, SHEET_ID, manager);

    await expect(objects.group(['missing-object'])).rejects.toMatchObject({
      code: 'OBJ_NOT_FOUND',
    });
    expect(manager.groupObjects).not.toHaveBeenCalled();
  });
});
