import { jest } from '@jest/globals';

import { compile, configToSpec, type ChartData, type TextMark } from '@mog/charts';
import { sheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { WorksheetChartsImpl } from '../worksheet/charts';

const SHEET_ID = sheetId('sheet-1');

function makeChart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: 'chart-axis-1',
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
    width: 480,
    height: 300,
    widthCells: 6,
    heightCells: 15,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: 'Axis Regression Chart',
    dataRange: 'Sheet1!A1:B4',
    title: 'Quarterly Revenue',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createChartsApi(initialChart: ChartFloatingObject): {
  charts: WorksheetChartsImpl;
  currentChart: () => ChartFloatingObject;
} {
  let chart = initialChart;
  const computeBridge = {
    getChart: jest.fn(async (_sheetId: string, chartId: string) =>
      chart.id === chartId ? chart : null,
    ),
    getAllCharts: jest.fn(async () => [chart]),
    updateChart: jest.fn(
      async (_sheetId: string, chartId: string, updates: Partial<ChartFloatingObject>) => {
        if (chart.id !== chartId) return { floatingObjectChanges: [] };
        chart = {
          ...chart,
          ...updates,
          anchor: updates.anchor ? { ...chart.anchor, ...updates.anchor } : chart.anchor,
        };
        return { floatingObjectChanges: [{ objectId: chartId, data: chart }] };
      },
    ),
  };

  return {
    charts: new WorksheetChartsImpl({ computeBridge } as any, SHEET_ID),
    currentChart: () => chart,
  };
}

function textForRole(marks: unknown[], role: string): string[] {
  return marks
    .filter((mark): mark is TextMark => {
      const candidate = mark as Partial<TextMark> & { datum?: { role?: string } };
      return candidate.type === 'text' && candidate.datum?.role === role;
    })
    .map((mark) => String(mark.text));
}

describe('WorksheetChartsImpl value-axis render regression', () => {
  it('persists valueAxis updates and renders configured numeric ticks plus title', async () => {
    const { charts, currentChart } = createChartsApi(makeChart());

    await charts.update('chart-axis-1', {
      axis: {
        valueAxis: {
          visible: true,
          min: 0,
          max: 100,
          majorUnit: 25,
          title: 'Revenue',
          titleVisible: true,
          gridLines: true,
        },
      },
    });

    expect(currentChart().axis?.valueAxis).toMatchObject({
      min: 0,
      max: 100,
      majorUnit: 25,
      title: 'Revenue',
      titleVisible: true,
    });

    const [listedChart] = await charts.list();
    expect(listedChart.axis?.valueAxis).toMatchObject({
      min: 0,
      max: 100,
      majorUnit: 25,
      title: 'Revenue',
      titleVisible: true,
    });

    const data: ChartData = {
      categories: ['Q1', 'Q2', 'Q3'],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 'Q1', y: 25 },
            { x: 'Q2', y: 50 },
            { x: 'Q3', y: 75 },
          ],
        },
      ],
    };

    const spec = configToSpec(listedChart, data);
    const compiled = compile(spec, undefined, { width: 480, height: 300 });
    const yAxisText = textForRole(compiled.axes, 'y-axis');

    expect(yAxisText).toEqual(
      expect.arrayContaining(['0', '25', '50', '75', '100', 'Revenue']),
    );
  });
});
