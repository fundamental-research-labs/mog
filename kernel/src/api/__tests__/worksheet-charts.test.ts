import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { WorksheetChartsImpl } from '../worksheet/charts';
import { WorksheetImpl } from '../worksheet/worksheet-impl';

const SHEET_ID = sheetId('sheet-1');

function makeChart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: 'chart-1',
    sheetId: SHEET_ID,
    type: 'chart',
    chartType: 'scatter',
    anchor: {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffsetEmu: 0,
      anchorColOffsetEmu: 0,
      anchorMode: 'twoCell',
    },
    width: 8,
    height: 15,
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
  };
}

function createChartsApi(charts: ChartFloatingObject[]): WorksheetChartsImpl {
  const ctx = {
    computeBridge: {
      getChart: jest.fn(async (_sheetId: string, chartId: string) => {
        return charts.find((chart) => chart.id === chartId) ?? null;
      }),
      getAllCharts: jest.fn(async () => charts),
    },
  };
  return new WorksheetChartsImpl(ctx as any, SHEET_ID);
}

function chartOoxmlWithAnchorIndex(anchorIndex: number): ChartFloatingObject['ooxml'] {
  return {
    drawingFrame: {
      anchorIndex,
    },
  } as unknown as ChartFloatingObject['ooxml'];
}

describe('WorksheetChartsImpl chart list ordering', () => {
  it('orders imported charts by drawing frame anchorIndex before serialization', async () => {
    const anchor7 = makeChart({
      id: 'anchor-7',
      name: 'Chart anchor 7',
      ooxml: chartOoxmlWithAnchorIndex(7),
    });
    const anchor3 = makeChart({
      id: 'anchor-3',
      name: 'Chart anchor 3',
      ooxml: chartOoxmlWithAnchorIndex(3),
    });
    const charts = createChartsApi([anchor7, anchor3]);

    await expect(charts.list()).resolves.toEqual([
      expect.objectContaining({ id: 'anchor-3', name: 'Chart anchor 3' }),
      expect.objectContaining({ id: 'anchor-7', name: 'Chart anchor 7' }),
    ]);
  });

  it('preserves computeBridge order for charts without imported anchor metadata', async () => {
    const first = makeChart({ id: 'first-chart', name: 'First chart' });
    const second = makeChart({ id: 'second-chart', name: 'Second chart' });
    const charts = createChartsApi([first, second]);

    await expect(charts.list()).resolves.toEqual([
      expect.objectContaining({ id: 'first-chart', name: 'First chart' }),
      expect.objectContaining({ id: 'second-chart', name: 'Second chart' }),
    ]);
  });
});

describe('WorksheetChartsImpl chart ref read normalization', () => {
  it('normalizes imported absolute A1 refs from get and list without changing malformed refs', async () => {
    const imported = makeChart({
      id: 'imported',
      dataRange: "'Data'!$A$1:$B$6",
      seriesRange: "'Data'!$A$1:$A$6",
      categoryRange: "'Data'!$A$2:$A$6",
      series: [
        {
          values: "'Data'!$B$2:$B$6",
          categories: "'Data'!$A$2:$A$6",
          bubbleSize: "'Q1 Data''s'!$C$2:$C$6",
        },
      ],
    });
    const malformed = makeChart({
      id: 'malformed',
      dataRange: 'NamedRange',
      seriesRange: '=SERIES(Sheet1!$A$1,Sheet1!$A$2:$A$6,Sheet1!$B$2:$B$6,1)',
      categoryRange: 'Table1[Category]',
      series: [
        {
          values: 'Table1[Value]',
          categories: '',
          bubbleSize: 'Data!$C$2:$C',
        },
      ],
    });
    const charts = createChartsApi([imported, malformed]);

    await expect(charts.get('imported')).resolves.toEqual(
      expect.objectContaining({
        dataRange: 'Data!A1:B6',
        seriesRange: 'Data!A1:A6',
        categoryRange: 'Data!A2:A6',
        series: [
          expect.objectContaining({
            values: 'Data!B2:B6',
            categories: 'Data!A2:A6',
            bubbleSize: "'Q1 Data''s'!C2:C6",
          }),
        ],
      }),
    );

    await expect(charts.list()).resolves.toEqual([
      expect.objectContaining({
        dataRange: 'Data!A1:B6',
        series: [
          expect.objectContaining({
            values: 'Data!B2:B6',
            categories: 'Data!A2:A6',
            bubbleSize: "'Q1 Data''s'!C2:C6",
          }),
        ],
      }),
      expect.objectContaining({
        dataRange: 'NamedRange',
        seriesRange: '=SERIES(Sheet1!$A$1,Sheet1!$A$2:$A$6,Sheet1!$B$2:$B$6,1)',
        categoryRange: 'Table1[Category]',
        series: [
          expect.objectContaining({
            values: 'Table1[Value]',
            categories: '',
            bubbleSize: 'Data!$C$2:$C',
          }),
        ],
      }),
    ]);
  });
});

describe('WorksheetChartsImpl waterfall config mapping', () => {
  it('preserves imported waterfall subtotal and connector-line options on read', async () => {
    const charts = createChartsApi([
      makeChart({
        chartType: 'waterfall',
        waterfall: {
          subtotalIndices: [1, 3],
          showConnectorLines: false,
        },
      }),
    ]);

    await expect(charts.get('chart-1')).resolves.toEqual(
      expect.objectContaining({
        waterfall: {
          subtotalIndices: [1, 3],
          totalIndices: [1, 3],
          showConnectorLines: false,
        },
      }),
    );
  });

  it('writes waterfall subtotal options through the generated compute bridge shape', async () => {
    const chart = makeChart({ chartType: 'waterfall' });
    const updateChart = jest.fn(async () => undefined);
    const charts = new WorksheetChartsImpl(
      {
        computeBridge: {
          getChart: jest.fn(async () => chart),
          updateChart,
        },
      } as any,
      SHEET_ID,
    );

    await charts.update('chart-1', {
      waterfall: {
        subtotalIndices: [2],
        totalIndices: [9],
        showConnectorLines: true,
      },
    });

    expect(updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({
        waterfall: {
          subtotalIndices: [2],
          showConnectorLines: true,
        },
      }),
    );
  });
});

describe('Worksheet chart image export', () => {
  it('delegates worksheet.charts.exportImage through the context chart image exporter', async () => {
    const chart = makeChart();
    const options = {
      format: 'png' as const,
      width: 640,
      height: 360,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    };
    const dataUrl = 'data:image/png;base64,ZmFrZS1wbmc=';
    const exporter = {
      exportImage: jest.fn(async () => dataUrl),
    };
    const ctx = {
      chartImageExporter: exporter,
      computeBridge: {
        getChart: jest.fn(async () => chart),
      },
    };

    const worksheet = new WorksheetImpl(SHEET_ID, ctx as any);

    await expect(worksheet.charts.exportImage(chart.id, options)).resolves.toBe(dataUrl);
    expect(exporter.exportImage).toHaveBeenCalledWith(SHEET_ID, chart.id, options);
  });

  it('uses a chart image exporter registered after the worksheet charts API is cached', async () => {
    const chart = makeChart();
    const dataUrl = 'data:image/png;base64,cmVnaXN0ZXJlZC1sYXRl';
    const ctx: any = {
      chartImageExporter: null,
      computeBridge: {
        getChart: jest.fn(async () => chart),
      },
    };
    const charts = new WorksheetChartsImpl(ctx, SHEET_ID);
    const exporter = {
      exportImage: jest.fn(async () => dataUrl),
    };

    ctx.chartImageExporter = exporter;

    await expect(charts.exportImage(chart.id)).resolves.toBe(dataUrl);
    expect(exporter.exportImage).toHaveBeenCalledWith(SHEET_ID, chart.id, undefined);
  });
});
