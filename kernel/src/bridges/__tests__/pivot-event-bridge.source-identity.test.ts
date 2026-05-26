import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { connectPivotToEventBus } from '../pivot-event-bridge';

describe('PivotEventBridge source identity', () => {
  it('matches sourceSheetId after source sheet rename instead of stale sourceSheetName', async () => {
    const outputSheetId = sheetId('output-sheet');
    const sourceSheetId = sheetId('source-sheet');
    const handlers = new Map<string, (event: any) => void>();
    const refresh = jest.fn().mockResolvedValue(null);
    const onPivotRefresh = jest.fn();

    connectPivotToEventBus({
      sheetId: outputSheetId,
      pivotBridge: {
        getAllPivots: jest.fn().mockResolvedValue([
          {
            id: 'pivot-1',
            sourceSheetId,
            sourceSheetName: 'Old Name',
            sourceRange: { startRow: 0, startCol: 0, endRow: 5, endCol: 2 },
          },
        ]),
        refresh,
      } as any,
      eventBus: {
        on: jest.fn((type: string, handler: (event: any) => void) => {
          handlers.set(type, handler);
          return () => {};
        }),
      } as any,
      getSheetName: jest.fn().mockResolvedValue('Renamed Source'),
      onPivotRefresh,
    });

    handlers.get('cell:changed')?.({
      sheetId: sourceSheetId,
      row: 2,
      col: 1,
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(refresh).toHaveBeenCalledWith(outputSheetId, 'pivot-1');
    expect(onPivotRefresh).toHaveBeenCalledWith('pivot-1');
  });
});
