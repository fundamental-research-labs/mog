import type { ChartConfig, ChartData, ChartDataSeries } from '@mog/charts';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ResolvedChartRangeReference } from '../chart-range-references';
import {
  hasRenderableChartExData,
  snapshotSeries,
  snapshotSeriesProjection,
} from '../bridge/resolved-spec-series-snapshot';

describe('resolved spec series snapshot helpers', () => {
  it('detects renderable ChartEx series data from references or caches', () => {
    expect(
      hasRenderableChartExData({
        type: 'column',
        series: [{ values: ' Sheet1!A1:A2 ' }],
      } as ChartConfig),
    ).toBe(true);
    expect(
      hasRenderableChartExData({
        type: 'column',
        series: [
          {
            values: '',
            valueCache: {
              pointCount: 2,
              points: [{ idx: 0, value: '10' }],
            },
          },
        ],
      } as ChartConfig),
    ).toBe(true);
    expect(
      hasRenderableChartExData({
        type: 'column',
        series: [
          {
            values: '',
            valueCache: {
              pointCount: 0,
              points: [{ idx: 0, value: '10' }],
            },
          },
        ],
      } as ChartConfig),
    ).toBe(false);
  });

  it('snapshots series data, render authority, projection authority, and hashes', () => {
    const sheetId = toSheetId('sheet-1');
    const categoryRange: ResolvedChartRangeReference = {
      kind: 'seriesCategories',
      source: 'a1',
      ref: 'Sheet1!A1:A3',
      range: {
        sheetId,
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 0,
      },
    };
    const config: ChartConfig = {
      type: 'scatter',
      showLines: false,
      series: [
        {
          name: 'Configured',
          type: 'scatter',
          values: 'Missing!B1:B3',
          valueSourceKind: 'cacheFallback',
          valueCache: {
            pointCount: 3,
            points: [
              { idx: 0, value: '5' },
              { idx: 1, value: 'not-a-number' },
              { idx: 2, value: '7' },
            ],
          },
          categories: 'Sheet1!A1:A3',
          categorySourceKind: 'ref',
          showMarkers: true,
          order: 2,
        },
      ],
    };
    const dataSeries: ChartDataSeries = {
      name: '',
      data: [
        { x: 1, y: 5 },
        { x: 2, y: Number.POSITIVE_INFINITY },
        { y: 7, valueState: 'blank' },
      ],
    };

    const series = snapshotSeries(dataSeries, 0, ['fallback'], config, true, {
      index: 0,
      values: null,
      categories: categoryRange,
      bubbleSizes: null,
    });

    expect(series).toMatchObject({
      index: 0,
      order: 2,
      name: 'Configured',
      type: 'scatter',
      xRole: 'quantitative',
      showMarkers: true,
      renderLayerCount: 1,
      projectionAuthority: 'explicitSeries',
      source: {
        values: 'Missing!B1:B3',
        valueSourceKind: 'cacheFallback',
        categories: 'Sheet1!A1:A3',
        categorySourceKind: 'ref',
      },
      renderAuthority: {
        values: 'fallbackCache',
        categories: 'live',
        bubbleSize: 'unavailable',
      },
      categories: [1, 2, null],
      values: [5, null, null],
      blankMask: [false, true, true],
      pointCount: 3,
      renderedPointCount: 1,
    });
    expect(series.dataHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('summarizes rendered and dropped series projection state', () => {
    const config: ChartConfig = {
      type: 'column',
      dataRange: 'Sheet1!A1:B2',
      series: [
        { name: 'Rendered', values: 'Sheet1!A1:A2' },
        {
          name: 'Dropped projected source',
          values: 'Sheet1!F1:F2',
          sourceSeriesIndex: 5,
          projectionDiagnostics: [
            { reason: 'allItemsFiltered', message: 'Source field filtered out' },
          ],
        },
      ],
    };
    const data: ChartData = {
      categories: ['A'],
      series: [{ name: 'Rendered', data: [{ x: 'A', y: 1 }] }],
    };
    const rendered = snapshotSeries(data.series[0], 0, ['A'], config, true, undefined);

    expect(snapshotSeriesProjection(config, data, [rendered])).toEqual({
      authority: 'explicitSeries',
      expectedImportedSeriesCount: 2,
      projectedSeriesCount: 1,
      renderedSeriesCount: 1,
      renderedPointCountBySourceSeriesKey: {
        [rendered.sourceSeriesKey]: 1,
      },
      droppedSeries: [
        {
          sourceSeriesIndex: 5,
          sourceSeriesKey: 'series:5',
          name: 'Dropped projected source',
          reason: 'allItemsFiltered',
          message: 'Source field filtered out',
        },
      ],
    });
  });
});
