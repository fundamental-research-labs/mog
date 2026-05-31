import { jest } from '@jest/globals';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type {
  ChartFloatingObject,
  MutationResult,
} from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import { getChartPosition } from '../chart-position';
import {
  create,
  get,
  getAll,
  remove,
  update,
} from '../chart-store';
import {
  isChartLinkedToTable,
  linkChartToTable,
  refreshChartTableLink,
  unlinkChartFromTable,
} from '../chart-table-links';
import { bringToFront, getChartsInZOrder } from '../chart-z-order';

const SHEET_ID: SheetId = toSheetId('sheet-1');

type ChartOverrides = Omit<Partial<ChartFloatingObject>, 'anchor'> & {
  anchor?: Partial<ChartFloatingObject['anchor']>;
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
    width: 4,
    height: 10,
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

    expect(bridge.createChart).toHaveBeenCalledWith(SHEET_ID, config);
    expect(bridge.updateChart).toHaveBeenCalledWith(SHEET_ID, config.id, updates);
    expect(bridge.deleteChart).toHaveBeenCalledWith(SHEET_ID, config.id);
    expect(bridge.getChart).toHaveBeenCalledWith(SHEET_ID, config.id);
    expect(bridge.getAllCharts).toHaveBeenCalledWith(SHEET_ID);
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(eventBus.emitBatch).not.toHaveBeenCalled();
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
      getCellPosition: jest.fn(async (_sheetId: SheetId, cellId: string) =>
        positions.get(cellId) ?? null,
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
        cellId === 'from-cell'
          ? { sheetId: SHEET_ID, sheetName: 'Sheet 1', row: 5, col: 6 }
          : null,
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
});

describe('chart-z-order', () => {
  it('sorts by zIndex and uses createdAt as the tie-breaker', async () => {
    const earlyTie = chart({ id: 'early-tie', zIndex: 2, createdAt: 10 });
    const laterTie = chart({ id: 'later-tie', zIndex: 2, createdAt: 20 });
    const back = chart({ id: 'back', zIndex: 1, createdAt: 30 });
    const { ctx } = createMockContext({
      getAllCharts: jest.fn(async () => [laterTie, back, earlyTie]),
    });

    await expect(getChartsInZOrder(ctx, SHEET_ID)).resolves.toEqual([
      back,
      earlyTie,
      laterTie,
    ]);
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
    expect(bridge.updateChart).toHaveBeenCalledWith(SHEET_ID, selected.id, { zIndex: 10 });
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

    expect(bridge.linkChartToTable).toHaveBeenCalledWith(SHEET_ID, 'chart-1', 'table-1');
    expect(bridge.updateChart).toHaveBeenCalledWith(SHEET_ID, 'chart-1', {
      tableDataColumns: ['Revenue', 'Cost'],
      tableCategoryColumn: 'Month',
      useTableColumnNamesAsLabels: false,
    });
    expect(bridge.unlinkChartFromTable).toHaveBeenCalledWith(SHEET_ID, 'chart-1');
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

    expect(bridge.updateChart).toHaveBeenCalledWith(SHEET_ID, linkedChart.id, {
      dataRange: 'AA2:AC10',
      tableColumnNames: ['AA Header', 'AB Header', 'AC Header'],
    });
  });
});
