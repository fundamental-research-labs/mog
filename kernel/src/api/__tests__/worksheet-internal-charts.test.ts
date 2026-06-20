import { jest } from '@jest/globals';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import { WorksheetInternalImpl } from '../worksheet/internal';

const SHEET_ID: SheetId = toSheetId('sheet-1');

function chart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: 'chart-1',
    sheetId: SHEET_ID,
    type: 'chart',
    chartType: 'column',
    anchor: {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffsetEmu: 0,
      anchorColOffsetEmu: 0,
      anchorMode: 'oneCell',
    },
    width: 640,
    height: 300,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: 'Chart 1',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as ChartFloatingObject;
}

describe('WorksheetInternalImpl chart reads', () => {
  it('returns stored chart metadata in z-order', async () => {
    const back = chart({ id: 'back', zIndex: 1, createdAt: 30 });
    const earlyTie = chart({ id: 'early-tie', zIndex: 2, createdAt: 10 });
    const laterTie = chart({ id: 'later-tie', zIndex: 2, createdAt: 20 });
    const ctx = {
      computeBridge: {
        getAllCharts: jest.fn(async () => [laterTie, back, earlyTie]),
      },
    } as unknown as DocumentContext;

    const internal = new WorksheetInternalImpl(ctx, SHEET_ID);

    await expect(internal.listStoredCharts()).resolves.toMatchObject([
      { id: 'back', zIndex: 1 },
      { id: 'early-tie', zIndex: 2 },
      { id: 'later-tie', zIndex: 2 },
    ]);
    expect(ctx.computeBridge.getAllCharts).toHaveBeenCalledWith(SHEET_ID);
  });
});
