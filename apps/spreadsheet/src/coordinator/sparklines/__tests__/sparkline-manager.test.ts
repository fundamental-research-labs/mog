import { jest } from '@jest/globals';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { Sparkline } from '@mog-sdk/contracts/sparklines';
import { createSparklineManager } from '../sparkline-manager';

const SHEET_ID = 'sheet-1' as SheetId;

function createSparkline(overrides: Partial<Sparkline> = {}): Sparkline {
  return {
    id: 'sparkline-1',
    sheetId: SHEET_ID,
    cell: { sheetId: SHEET_ID, row: 6, col: 0 },
    dataRange: { startRow: 0, startCol: 1, endRow: 2, endCol: 1 },
    type: 'line',
    dataInRows: false,
    visual: { color: '#4472C4' },
    axis: { minValue: 'auto', maxValue: 'auto', displayEmptyCells: 'gaps' },
    createdAt: 1,
    ...overrides,
  };
}

function createWorkbook(sparklines: {
  add?: jest.Mock;
  getAtCell?: jest.Mock;
  list?: jest.Mock;
  listGroups?: jest.Mock;
  getGroup?: jest.Mock;
}) {
  const worksheet = {
    sparklines: {
      add: sparklines.add ?? jest.fn(),
      getAtCell: sparklines.getAtCell ?? jest.fn(),
      list: sparklines.list ?? jest.fn(async () => []),
      listGroups: sparklines.listGroups ?? jest.fn(async () => []),
      getGroup: sparklines.getGroup ?? jest.fn(async () => null),
    },
  };

  return {
    worksheet,
    workbook: {
      getSheetById: jest.fn(() => worksheet),
    },
  };
}

function createEventBus() {
  return {
    emit: jest.fn(),
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SparklineManager', () => {
  it('awaits Worksheet.sparklines.add before hydrating the sync render cache', async () => {
    const sparkline = createSparkline();
    let resolveAdd: (value: Sparkline) => void = () => undefined;
    const add = jest.fn(
      () =>
        new Promise<Sparkline>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    const { workbook } = createWorkbook({ add });
    const eventBus = createEventBus();
    const manager = createSparklineManager({
      workbook: workbook as any,
      eventBus: eventBus as any,
      getCellValue: () => null,
    });

    const pendingCreate = manager.createSparkline(
      SHEET_ID,
      { sheetId: SHEET_ID, row: 6, col: 0 },
      sparkline.dataRange,
      'line',
    );

    expect(manager.getSparklineAtCell(SHEET_ID, 6, 0)).toBeUndefined();

    resolveAdd(sparkline);
    await pendingCreate;

    expect(manager.getSparklineAtCell(SHEET_ID, 6, 0)).toEqual(sparkline);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sparkline:created',
        sparklineId: sparkline.id,
        sheetId: SHEET_ID,
      }),
    );
  });

  it('hydrates render data from Worksheet.sparklines.getAtCell on a render cache miss', async () => {
    const sparkline = createSparkline();
    const { workbook } = createWorkbook({
      getAtCell: jest.fn(async () => sparkline),
    });
    const eventBus = createEventBus();
    const values = new Map([
      ['0:1', 10],
      ['1:1', 20],
      ['2:1', 30],
    ]);
    const manager = createSparklineManager({
      workbook: workbook as any,
      eventBus: eventBus as any,
      getCellValue: (_sheetId, row, col) => values.get(`${row}:${col}`) ?? null,
    });

    expect(manager.getRenderDataAtCell(SHEET_ID, 6, 0)).toBeUndefined();

    await flushPromises();

    const renderData = manager.getRenderDataAtCell(SHEET_ID, 6, 0);
    expect(renderData?.sparklineId).toBe(sparkline.id);
    expect(renderData?.points.map((point) => point.value)).toEqual([10, 20, 30]);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sparkline:dataChanged',
        sparklineId: sparkline.id,
        sheetId: SHEET_ID,
      }),
    );
  });
});
