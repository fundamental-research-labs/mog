import { jest } from '@jest/globals';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type {
  ChartFloatingObject,
  ComputeBridge,
  MutationResult,
} from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import { calculateChartPixelBounds, convertChartToFloatingObject } from '../chart-manager';
import { getChartPosition, updatePosition } from '../chart-position';
import { create, get, getAll, remove, update } from '../chart-store';
import {
  isChartLinkedToTable,
  getChartsLinkedToTable,
  getChartSourceTableId,
  linkChartToTable,
  refreshChartTableLink,
  unlinkChartFromTable,
} from '../chart-table-links';
import {
  bringForward,
  bringToFront,
  getChartsInZOrder,
  getMaxZIndex,
  getMinZIndex,
  sendBackward,
  sendToBack,
} from '../chart-z-order';

const SHEET_ID: SheetId = toSheetId('sheet-1');

type ChartOverrides = Omit<Partial<ChartFloatingObject>, 'anchor'> & {
  anchor?: Partial<ChartFloatingObject['anchor']>;
};

type ChartMutationOptionsRecord = {
  operationContext: {
    groupId?: string;
  };
};

function chart(overrides: ChartOverrides = {}): ChartFloatingObject {
  const { anchor: anchorOverrides, ...rest } = overrides;
  const base: ChartFloatingObject = {
    id: 'chart-1',
    sheetId: SHEET_ID,
    type: 'chart',
    chartType: 'bar',
    anchor: {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffsetEmu: 0,
      anchorColOffsetEmu: 0,
      anchorMode: 'oneCell',
    },
    width: 0,
    height: 0,
    widthCells: 4,
    heightCells: 10,
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
  };

  return {
    ...base,
    ...rest,
    anchor: {
      ...base.anchor,
      ...anchorOverrides,
    },
  };
}

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: {} as MutationResult['recalc'],
    ...overrides,
  };
}

function createBridgeMock() {
  const existingChart = chart();
  return {
    createChart: jest.fn(async () =>
      mutationResult({
        floatingObjectChanges: [
          {
            sheetId: SHEET_ID,
            objectId: 'created-by-compute',
            kind: { type: 'created' },
            objectType: 'chart',
            data: chart({ id: 'created-by-compute' }),
          },
        ],
      }),
    ),
    updateChart: jest.fn(async () => mutationResult()),
    deleteChart: jest.fn(async () => mutationResult()),
    getChart: jest.fn(async (_sheetId: SheetId, chartId: string) =>
      chartId === existingChart.id ? existingChart : null,
    ),
    getAllCharts: jest.fn(async () => [existingChart]),
    getCellPosition: jest.fn(async () => null),
    getColPosition: jest.fn(async (_sheetId: SheetId, col: number) => col * 80),
    getRowPosition: jest.fn(async (_sheetId: SheetId, row: number) => row * 20),
    getColWidthFromIndex: jest.fn(async () => 80),
    getRowHeightFromIndex: jest.fn(async () => 20),
    linkChartToTable: jest.fn(async () => mutationResult()),
    unlinkChartFromTable: jest.fn(async () => mutationResult()),
    isChartLinkedToTable: jest.fn(async () => true),
  };
}

function createMockContext(overrides: Partial<ReturnType<typeof createBridgeMock>> = {}): {
  ctx: DocumentContext;
  bridge: ReturnType<typeof createBridgeMock>;
  eventBus: { emit: jest.Mock; emitBatch: jest.Mock };
} {
  const bridge = {
    ...createBridgeMock(),
    ...overrides,
  };
  const eventBus = {
    emit: jest.fn(),
    emitBatch: jest.fn(),
  };

  return {
    ctx: {
      computeBridge: bridge,
      eventBus,
    } as unknown as DocumentContext,
    bridge,
    eventBus,
  };
}

function expectChartMutationOptions(operationIdPrefix: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(new RegExp(`^${escapeRegExp(operationIdPrefix)}:`)),
      kind: 'mutation',
      sheetIds: [SHEET_ID],
      domainIds: ['charts.source-range'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('chart-store', () => {
  it('delegates CRUD reads and writes to computeBridge without manual events', async () => {
    const config = chart();
    const updates: Partial<ChartFloatingObject> = { title: 'Revenue', zIndex: 3 };
    const { ctx, bridge, eventBus } = createMockContext();

    await expect(create(ctx, SHEET_ID, config)).resolves.toBe('created-by-compute');
    await update(ctx, SHEET_ID, config.id, updates);
    await remove(ctx, SHEET_ID, config.id);
    await expect(get(ctx, SHEET_ID, config.id)).resolves.toEqual(chart());
    await expect(getAll(ctx, SHEET_ID)).resolves.toEqual([chart()]);

    expect(bridge.createChart).toHaveBeenCalledWith(
      SHEET_ID,
      config,
      expectChartMutationOptions('charts.create'),
    );
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      config.id,
      updates,
      expectChartMutationOptions('charts.update'),
    );
    expect(bridge.deleteChart).toHaveBeenCalledWith(
      SHEET_ID,
      config.id,
      expectChartMutationOptions('charts.delete'),
    );
    expect(bridge.getChart).toHaveBeenCalledWith(SHEET_ID, config.id);
    expect(bridge.getAllCharts).toHaveBeenCalledWith(SHEET_ID);
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(eventBus.emitBatch).not.toHaveBeenCalled();
  });
});

describe('chart-manager geometry consumers', () => {
  it('calculates pixel bounds from point-backed size ahead of stale cell spans', async () => {
    const { bridge } = createMockContext({
      getColWidthFromIndex: jest.fn(async () => 100),
      getRowHeightFromIndex: jest.fn(async () => 30),
    });
    const importedChart = chart({
      anchor: { anchorRow: 2, anchorCol: 3 },
      width: 640,
      height: 300,
      widthPt: 480,
      heightPt: 225,
      widthCells: 4,
      heightCells: 5,
    });

    await expect(
      calculateChartPixelBounds(importedChart, SHEET_ID, bridge as unknown as ComputeBridge),
    ).resolves.toEqual({
      x: 240,
      y: 40,
      width: 640,
      height: 300,
    });
    expect(bridge.getColWidthFromIndex).not.toHaveBeenCalled();
    expect(bridge.getRowHeightFromIndex).not.toHaveBeenCalled();
  });

  it('converts chart floating objects from point-backed size ahead of stale cell spans', async () => {
    const { bridge } = createMockContext({
      getColWidthFromIndex: jest.fn(async () => 100),
      getRowHeightFromIndex: jest.fn(async () => 30),
    });
    const importedChart = chart({
      anchor: { anchorRow: 2, anchorCol: 3 },
      width: 640,
      height: 300,
      widthPt: 480,
      heightPt: 225,
      widthCells: 4,
      heightCells: 5,
    });

    const object = await convertChartToFloatingObject(importedChart, {
      computeBridge: bridge as unknown as ComputeBridge,
    });

    expect(object?.position).toMatchObject({
      x: 240,
      y: 40,
      width: 640,
      height: 300,
    });
    expect(bridge.getColWidthFromIndex).not.toHaveBeenCalled();
    expect(bridge.getRowHeightFromIndex).not.toHaveBeenCalled();
  });
});

describe('chart-position', () => {
  it('resolves one-cell anchors through computeBridge and keeps fixed size', async () => {
    const { ctx, bridge } = createMockContext({
      getCellPosition: jest.fn(async (_sheetId: SheetId, cellId: string) =>
        cellId === 'anchor-cell'
          ? { sheetId: SHEET_ID, sheetName: 'Sheet 1', row: 7, col: 3 }
          : null,
      ),
    });

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchorCellId: 'anchor-cell',
          widthCells: 6,
          heightCells: 8,
          anchor: { anchorRow: 1, anchorCol: 1, anchorMode: 'oneCell' },
        }),
      ),
    ).resolves.toEqual({ anchorRow: 7, anchorCol: 3, width: 6, height: 8 });

    expect(bridge.getCellPosition).toHaveBeenCalledWith(SHEET_ID, 'anchor-cell');
  });

  it('resolves two-cell anchors into inclusive cell dimensions', async () => {
    const positions = new Map([
      ['from-cell', { sheetId: SHEET_ID, sheetName: 'Sheet 1', row: 2, col: 4 }],
      ['to-cell', { sheetId: SHEET_ID, sheetName: 'Sheet 1', row: 6, col: 9 }],
    ]);
    const { ctx } = createMockContext({
      getCellPosition: jest.fn(
        async (_sheetId: SheetId, cellId: string) => positions.get(cellId) ?? null,
      ),
    });

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchorCellId: 'from-cell',
          toAnchorCellId: 'to-cell',
          anchor: { anchorMode: 'twoCell' },
        }),
      ),
    ).resolves.toEqual({ anchorRow: 2, anchorCol: 4, width: 6, height: 5 });
  });

  it('falls back to stored size when the two-cell end anchor was deleted', async () => {
    const { ctx } = createMockContext({
      getCellPosition: jest.fn(async (_sheetId: SheetId, cellId: string) =>
        cellId === 'from-cell' ? { sheetId: SHEET_ID, sheetName: 'Sheet 1', row: 5, col: 6 } : null,
      ),
    });

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchorCellId: 'from-cell',
          toAnchorCellId: 'deleted-to-cell',
          widthCells: 11,
          heightCells: 12,
          anchor: { anchorMode: 'twoCell' },
        }),
      ),
    ).resolves.toEqual({ anchorRow: 5, anchorCol: 6, width: 11, height: 12 });
  });

  it('falls back to stored coordinates when the primary anchor cell was deleted', async () => {
    const { ctx, bridge } = createMockContext({
      getCellPosition: jest.fn(async () => null),
    });

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchorCellId: 'deleted-from-cell',
          toAnchorCellId: 'to-cell',
          widthCells: 11,
          heightCells: 12,
          anchor: { anchorMode: 'twoCell' },
        }),
      ),
    ).resolves.toEqual({ anchorRow: 0, anchorCol: 0, width: 11, height: 12 });

    expect(bridge.getCellPosition).toHaveBeenCalledWith(SHEET_ID, 'deleted-from-cell');
  });

  it('uses legacy stored coordinates when no anchor cell identity exists', async () => {
    const { ctx, bridge } = createMockContext();

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchor: { anchorRow: 9, anchorCol: 10 },
          widthCells: 13,
          heightCells: 14,
        }),
      ),
    ).resolves.toEqual({ anchorRow: 9, anchorCol: 10, width: 13, height: 14 });

    expect(bridge.getCellPosition).not.toHaveBeenCalled();
  });

  it('uses point-backed geometry ahead of stale cell spans for fixed size', async () => {
    const { ctx, bridge } = createMockContext();

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchor: { anchorRow: 9, anchorCol: 10 },
          width: 640,
          height: 300,
          widthPt: 480,
          heightPt: 225,
          widthCells: 4,
          heightCells: 5,
        }),
      ),
    ).resolves.toEqual({ anchorRow: 9, anchorCol: 10, width: 8, height: 15 });

    expect(bridge.getCellPosition).not.toHaveBeenCalled();
  });

  it('treats two-cell mode without an end anchor as one-cell anchored fixed size', async () => {
    const { ctx } = createMockContext({
      getCellPosition: jest.fn(async () => ({
        sheetId: SHEET_ID,
        sheetName: 'Sheet 1',
        row: 3,
        col: 4,
      })),
    });

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchorCellId: 'from-cell',
          toAnchorCellId: undefined,
          widthCells: 8,
          heightCells: 9,
          anchor: { anchorMode: 'twoCell' },
        }),
      ),
    ).resolves.toEqual({ anchorRow: 3, anchorCol: 4, width: 8, height: 9 });
  });

  it('clamps reversed two-cell anchors to a one-cell footprint', async () => {
    const positions = new Map([
      ['from-cell', { sheetId: SHEET_ID, sheetName: 'Sheet 1', row: 6, col: 9 }],
      ['to-cell', { sheetId: SHEET_ID, sheetName: 'Sheet 1', row: 2, col: 4 }],
    ]);
    const { ctx } = createMockContext({
      getCellPosition: jest.fn(
        async (_sheetId: SheetId, cellId: string) => positions.get(cellId) ?? null,
      ),
    });

    await expect(
      getChartPosition(
        ctx,
        chart({
          anchorCellId: 'from-cell',
          toAnchorCellId: 'to-cell',
          anchor: { anchorMode: 'twoCell' },
        }),
      ),
    ).resolves.toEqual({ anchorRow: 6, anchorCol: 9, width: 1, height: 1 });
  });

  it('updates drag and resize coordinates through chart-store without emitting events', async () => {
    const { ctx, bridge, eventBus } = createMockContext();

    await updatePosition(ctx, SHEET_ID, 'chart-1', {
      anchorRow: 5,
      anchorCol: 6,
      width: 7,
      height: 8,
    });

    expect(bridge.getChart).toHaveBeenCalledWith(SHEET_ID, 'chart-1');
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      {
        anchor: {
          ...chart().anchor,
          anchorRow: 5,
          anchorCol: 6,
        },
        widthCells: 7,
        heightCells: 8,
      },
      expectChartMutationOptions('charts.update'),
    );
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(eventBus.emitBatch).not.toHaveBeenCalled();
  });
});

describe('chart-z-order', () => {
  it('sorts by zIndex and uses createdAt as the tie-breaker', async () => {
    const earlyTie = chart({ id: 'early-tie', zIndex: 2, createdAt: 10 });
    const laterTie = chart({ id: 'later-tie', zIndex: 2, createdAt: 20 });
    const back = chart({ id: 'back', zIndex: 1, createdAt: 30 });
    const { ctx } = createMockContext({
      getAllCharts: jest.fn(async () => [laterTie, back, earlyTie]),
    });

    await expect(getChartsInZOrder(ctx, SHEET_ID)).resolves.toEqual([back, earlyTie, laterTie]);
  });

  it('delegates bring-to-front updates through chart-store and computeBridge', async () => {
    const selected = chart({ id: 'selected', zIndex: 2 });
    const front = chart({ id: 'front', zIndex: 9 });
    const { ctx, bridge } = createMockContext({
      getChart: jest.fn(async (_sheetId: SheetId, chartId: string) =>
        chartId === selected.id ? selected : null,
      ),
      getAllCharts: jest.fn(async () => [selected, front]),
    });

    await bringToFront(ctx, SHEET_ID, selected.id);

    expect(bridge.getChart).toHaveBeenCalledWith(SHEET_ID, selected.id);
    expect(bridge.getAllCharts).toHaveBeenCalledWith(SHEET_ID);
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      selected.id,
      { zIndex: 10 },
      expectChartMutationOptions('charts.bringToFront'),
    );
  });

  it('computes z-order bounds and delegates relative layer changes', async () => {
    const back = chart({ id: 'back', zIndex: 1 });
    const selected = chart({ id: 'selected', zIndex: 2 });
    const front = chart({ id: 'front', zIndex: 9 });
    const { ctx, bridge } = createMockContext({
      getChart: jest.fn(async (_sheetId: SheetId, chartId: string) =>
        chartId === selected.id ? selected : chartId === front.id ? front : back,
      ),
      getAllCharts: jest.fn(async () => [back, selected, front]),
    });

    await expect(getMinZIndex(ctx, SHEET_ID)).resolves.toBe(1);
    await expect(getMaxZIndex(ctx, SHEET_ID)).resolves.toBe(9);
    await sendToBack(ctx, SHEET_ID, selected.id);
    await bringForward(ctx, SHEET_ID, selected.id);
    await sendBackward(ctx, SHEET_ID, selected.id);

    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      selected.id,
      { zIndex: 0 },
      expectChartMutationOptions('charts.sendToBack'),
    );
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      selected.id,
      { zIndex: 9 },
      expectChartMutationOptions('charts.bringForward'),
    );
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      front.id,
      { zIndex: 2 },
      expectChartMutationOptions('charts.bringForward'),
    );
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      selected.id,
      { zIndex: 1 },
      expectChartMutationOptions('charts.sendBackward'),
    );
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      back.id,
      { zIndex: 2 },
      expectChartMutationOptions('charts.sendBackward'),
    );
    const bringForwardFirst = bridge.updateChart.mock.calls[1][3] as ChartMutationOptionsRecord;
    const bringForwardSecond = bridge.updateChart.mock.calls[2][3] as ChartMutationOptionsRecord;
    const sendBackwardFirst = bridge.updateChart.mock.calls[3][3] as ChartMutationOptionsRecord;
    const sendBackwardSecond = bridge.updateChart.mock.calls[4][3] as ChartMutationOptionsRecord;
    expect(bringForwardFirst.operationContext.groupId).toBe(
      bringForwardSecond.operationContext.groupId,
    );
    expect(sendBackwardFirst.operationContext.groupId).toBe(
      sendBackwardSecond.operationContext.groupId,
    );
  });
});

describe('chart-table-links', () => {
  it('delegates link, optional metadata update, unlink, and linked checks to computeBridge', async () => {
    const { ctx, bridge } = createMockContext();

    await linkChartToTable(ctx, SHEET_ID, 'chart-1', 'table-1', {
      dataColumns: ['Revenue', 'Cost'],
      categoryColumn: 'Month',
      useColumnNamesAsLabels: false,
    });
    await unlinkChartFromTable(ctx, SHEET_ID, 'chart-1');
    await expect(isChartLinkedToTable(ctx, SHEET_ID, 'chart-1')).resolves.toBe(true);

    expect(bridge.linkChartToTable).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      'table-1',
      expectChartMutationOptions('charts.linkToTable'),
    );
    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      {
        tableDataColumns: ['Revenue', 'Cost'],
        tableCategoryColumn: 'Month',
        useTableColumnNamesAsLabels: false,
      },
      expectChartMutationOptions('charts.linkToTable'),
    );
    expect(bridge.unlinkChartFromTable).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expectChartMutationOptions('charts.unlinkFromTable'),
    );
    const linkOptions = bridge.linkChartToTable.mock.calls[0][3] as ChartMutationOptionsRecord;
    const metadataOptions = bridge.updateChart.mock.calls[0][3] as ChartMutationOptionsRecord;
    expect(linkOptions.operationContext.groupId).toBe(metadataOptions.operationContext.groupId);
    expect(bridge.isChartLinkedToTable).toHaveBeenCalledWith(SHEET_ID, 'chart-1');
  });

  it('refreshes table data ranges with multi-letter columns', async () => {
    const linkedChart = chart({
      sourceTableId: 'table-1',
      useTableColumnNamesAsLabels: true,
    });
    const { ctx, bridge } = createMockContext({
      getChart: jest.fn(async (_sheetId: SheetId, chartId: string) =>
        chartId === linkedChart.id ? linkedChart : null,
      ),
    });

    await refreshChartTableLink(
      ctx,
      SHEET_ID,
      linkedChart.id,
      {
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 26,
        endRow: 9,
        endCol: 28,
      },
      ['AA Header', 'AB Header', 'AC Header'],
    );

    expect(bridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      linkedChart.id,
      {
        dataRange: 'AA2:AC10',
        tableColumnNames: ['AA Header', 'AB Header', 'AC Header'],
      },
      expectChartMutationOptions('charts.update'),
    );
  });

  it('reads chart source table IDs and filters charts linked to one table', async () => {
    const tableOneA = chart({ id: 'table-one-a', sourceTableId: 'table-1' });
    const tableOneB = chart({ id: 'table-one-b', sourceTableId: 'table-1' });
    const tableTwo = chart({ id: 'table-two', sourceTableId: 'table-2' });
    const { ctx } = createMockContext({
      getChart: jest.fn(async (_sheetId: SheetId, chartId: string) =>
        chartId === tableOneA.id ? tableOneA : null,
      ),
      getAllCharts: jest.fn(async () => [tableTwo, tableOneB, tableOneA]),
    });

    await expect(getChartSourceTableId(ctx, SHEET_ID, tableOneA.id)).resolves.toBe('table-1');
    await expect(getChartsLinkedToTable(ctx, SHEET_ID, 'table-1')).resolves.toEqual([
      tableOneB,
      tableOneA,
    ]);
  });
});
