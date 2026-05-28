import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { WorksheetChartsImpl } from '../worksheet/charts';

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
