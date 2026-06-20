import { jest } from '@jest/globals';

import type { ChartFloatingObject, ComputeBridge } from '../../../bridges/compute/compute-bridge';
import { convertChartToFloatingObject } from '../chart-manager';

function chart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: 'chart-1',
    type: 'chart',
    sheetId: 'sheet-1',
    anchor: {
      anchorRow: 2,
      anchorCol: 3,
      anchorRowOffset: 0,
      anchorColOffset: 0,
      anchorMode: 'oneCell',
    },
    width: 100,
    height: 40,
    zIndex: 9,
    rotation: 37,
    flipH: true,
    flipV: false,
    locked: true,
    visible: false,
    printable: false,
    opacity: 1,
    name: 'Imported Chart Frame',
    createdAt: 11,
    updatedAt: 22,
    chartType: 'column',
    title: 'Revenue',
    ...overrides,
  } as unknown as ChartFloatingObject;
}

function computeBridge(): ComputeBridge {
  return {
    getColPosition: jest.fn(async () => 30),
    getRowPosition: jest.fn(async () => 40),
    getColWidthFromIndex: jest.fn(async () => 50),
    getRowHeightFromIndex: jest.fn(async () => 20),
  } as unknown as ComputeBridge;
}

describe('chart manager', () => {
  it('preserves imported chart frame transform and object flags', async () => {
    const obj = await convertChartToFloatingObject(chart(), { computeBridge: computeBridge() });

    expect(obj).not.toBeNull();
    expect(obj!.position).toEqual(
      expect.objectContaining({
        x: 30,
        y: 40,
        width: 100,
        height: 40,
        rotation: 37,
        flipH: true,
        flipV: false,
      }),
    );
    expect(obj).toEqual(
      expect.objectContaining({
        zIndex: 9,
        locked: true,
        printable: false,
        visible: false,
        name: 'Imported Chart Frame',
      }),
    );
  });
});
