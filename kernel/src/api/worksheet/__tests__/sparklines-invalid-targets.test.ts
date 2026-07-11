import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetSparklinesImpl } from '../sparklines';

const SHEET_ID = sheetId('sheet-1');

function createCtx(options?: { sparkline?: any; group?: any }) {
  return {
    clock: { now: jest.fn(() => 123) },
    computeBridge: {
      getSparkline: jest.fn().mockResolvedValue(options?.sparkline ?? null),
      getSparklineGroup: jest.fn().mockResolvedValue(options?.group ?? null),
      updateSparkline: jest.fn().mockResolvedValue({}),
      deleteSparkline: jest.fn().mockResolvedValue({}),
      deleteSparklineGroup: jest.fn().mockResolvedValue({}),
      addSparklineGroup: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('WorksheetSparklinesImpl invalid targets', () => {
  it.each([
    ['update', (api: WorksheetSparklinesImpl) => api.update('missing', { type: 'line' })],
    ['remove', (api: WorksheetSparklinesImpl) => api.remove('missing')],
    ['removeFromGroup', (api: WorksheetSparklinesImpl) => api.removeFromGroup('missing')],
  ])('%s throws SPARKLINE_NOT_FOUND before mutation', async (_name, invoke) => {
    const ctx = createCtx();
    const api = new WorksheetSparklinesImpl(ctx, SHEET_ID);

    await expect(invoke(api)).rejects.toMatchObject({ code: 'SPARKLINE_NOT_FOUND' });
    expect(ctx.computeBridge.updateSparkline).not.toHaveBeenCalled();
    expect(ctx.computeBridge.deleteSparkline).not.toHaveBeenCalled();
  });

  it.each([
    ['updateGroup', (api: WorksheetSparklinesImpl) => api.updateGroup('missing-group', {})],
    ['removeGroup', (api: WorksheetSparklinesImpl) => api.removeGroup('missing-group')],
    ['ungroupAll', (api: WorksheetSparklinesImpl) => api.ungroupAll('missing-group')],
  ])('%s throws SPARKLINE_GROUP_NOT_FOUND before mutation', async (_name, invoke) => {
    const ctx = createCtx();
    const api = new WorksheetSparklinesImpl(ctx, SHEET_ID);

    await expect(invoke(api)).rejects.toMatchObject({ code: 'SPARKLINE_GROUP_NOT_FOUND' });
    expect(ctx.computeBridge.updateSparkline).not.toHaveBeenCalled();
    expect(ctx.computeBridge.deleteSparklineGroup).not.toHaveBeenCalled();
  });

  it('validates both addToGroup targets before creating group membership', async () => {
    const ctx = createCtx({
      sparkline: { id: 'spark-1', sheetId: SHEET_ID, groupId: null },
    });
    const api = new WorksheetSparklinesImpl(ctx, SHEET_ID);

    await expect(api.addToGroup('spark-1', 'missing-group')).rejects.toMatchObject({
      code: 'SPARKLINE_GROUP_NOT_FOUND',
    });
    expect(ctx.computeBridge.updateSparkline).not.toHaveBeenCalled();
    expect(ctx.computeBridge.addSparklineGroup).not.toHaveBeenCalled();
  });
});
