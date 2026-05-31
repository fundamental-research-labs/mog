import {
  HIDDEN_CHART_CELL,
  extractChartData,
  extractChartDataFromRange,
  ObjectCellAccessor,
  parseRange,
} from '../data-extractor';
import { configToSpec } from '../config-to-spec';
import { SCATTER_X_FIELD, VALUE_FIELD } from '../config-to-spec/fields';
import type { StoredChartConfig } from '../../types';

function specRows(spec: ReturnType<typeof configToSpec>) {
  return spec.data && 'values' in spec.data ? spec.data.values : [];
}

describe('chart data point value provenance', () => {
  it('marks blank and invalid cell values without changing rendered y values', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Zero', 'Null', 'Undefined', 'Empty', 'NaN', 'Infinity', 'Text'],
      [0, null, undefined, '', Number.NaN, Number.POSITIVE_INFINITY, 'not numeric'],
    ]);

    const config: StoredChartConfig = {
      id: 'provenance-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:G2',
      seriesOrientation: 'columns',
    };

    const data = extractChartData(accessor, config);
    const points = data.series[0].data;

    expect(points.map((point) => point.y)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(points.map((point) => point.valueState)).toEqual([
      undefined,
      'blank',
      'blank',
      'blank',
      'nonFinite',
      'nonFinite',
      'nonNumeric',
    ]);
  });

  it('applies provenance to resolved range extraction', () => {
    const accessor = ObjectCellAccessor.fromArray([[0], [null], [Number.NEGATIVE_INFINITY], [5]]);

    const data = extractChartDataFromRange(accessor, parseRange('A1:A4'));

    expect(data.series[0].data.map((point) => point.y)).toEqual([0, 0, 0, 5]);
    expect(data.series[0].data.map((point) => point.valueState)).toEqual([
      undefined,
      'blank',
      'nonFinite',
      undefined,
    ]);
  });

  it('applies provenance to imported series value ranges', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [0, null, '', Number.POSITIVE_INFINITY, 'oops'],
      ['Real zero', 'Null blank', 'Empty blank', 'Infinity', 'Text'],
    ]);
    const config: StoredChartConfig = {
      id: 'imported-series-provenance-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:E1',
          categories: 'A2:E2',
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['Real zero', 'Null blank', 'Empty blank', 'Infinity', 'Text']);
    expect(data.series[0].data.map((point) => point.y)).toEqual([0, 0, 0, 0, 0]);
    expect(data.series[0].data.map((point) => point.valueState)).toEqual([
      undefined,
      'blank',
      'blank',
      'nonFinite',
      'nonNumeric',
    ]);
  });

  it('uses OOXML idx and order for unnamed imported series labels', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [10, 20],
      [30, 40],
    ]);
    const config: StoredChartConfig = {
      id: 'imported-series-label-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          values: 'A1:B1',
          idx: 2,
          order: 1,
        },
        {
          values: 'A2:B2',
          idx: 1,
          order: 0,
        },
        {
          values: 'A1:A2',
          order: 2,
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.series.map((series) => series.name)).toEqual(['Series 2', 'Series 1', 'Series 3']);
  });

  it('uses live imported series values before stale caches', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [99, null, 77, 'bad'],
      ['A', 'B', 'C', 'D'],
    ]);
    const config: StoredChartConfig = {
      id: 'imported-live-wins-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:D1',
          categories: 'A2:D2',
          valueCache: {
            pointCount: 4,
            points: [
              { idx: 0, value: '1' },
              { idx: 1, value: '2' },
              { idx: 2, value: '3' },
              { idx: 3, value: '4' },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((point) => point.y)).toEqual([99, 0, 77, 0]);
    expect(data.series[0].data.map((point) => point.valueState)).toEqual([
      undefined,
      'blank',
      undefined,
      'nonNumeric',
    ]);
  });

  it('does not reintroduce hidden live points from imported caches', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [10, HIDDEN_CHART_CELL, null],
      ['A', 'B', 'C'],
    ]);
    const config: StoredChartConfig = {
      id: 'hidden-live-wins-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:C1',
          categories: 'A2:C2',
          valueCache: {
            pointCount: 3,
            points: [
              { idx: 1, value: '200' },
              { idx: 2, value: '300' },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((point) => point.y)).toEqual([10, 0, 0]);
    expect(data.series[0].data.map((point) => point.valueState)).toEqual([
      undefined,
      'hidden',
      'blank',
    ]);
  });

  it('uses imported sparse value caches for literal/cache-backed series without live ranges', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [99, 'na', 77, null],
      ['A', 'B', 'C', 'D'],
    ]);
    const config: StoredChartConfig = {
      id: 'imported-cache-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          categories: 'A2:D2',
          valueSourceKind: 'literal',
          valueCache: {
            pointCount: 4,
            points: [
              { idx: 1, value: '0' },
              { idx: 3, value: '4.5' },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((point) => point.y)).toEqual([0, 0, 0, 4.5]);
    expect(data.series[0].data.map((point) => point.valueState)).toEqual([
      'blank',
      undefined,
      'blank',
      undefined,
    ]);
  });

  it('uses live category labels before stale imported category caches', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [1, 2],
      ['Live A', 'Live B'],
    ]);
    const config: StoredChartConfig = {
      id: 'imported-category-cache-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:B1',
          categories: 'A2:B2',
          categoryCache: {
            pointCount: 2,
            points: [
              { idx: 0, value: '45292' },
              { idx: 1, value: 'Cached B' },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['Live A', 'Live B']);
    expect(data.series[0].data.map((point) => point.x)).toEqual(['Live A', 'Live B']);
  });

  it('uses imported category caches as chart-domain labels when no live category range exists', () => {
    const accessor = ObjectCellAccessor.fromArray([[1, 2]]);
    const config: StoredChartConfig = {
      id: 'imported-category-cache-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:B1',
          categorySourceKind: 'literal',
          categoryCache: {
            pointCount: 2,
            points: [
              { idx: 0, value: '45292' },
              { idx: 1, value: 'Cached B' },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual([45292, 'Cached B']);
    expect(data.series[0].data.map((point) => point.x)).toEqual([45292, 'Cached B']);
  });

  it('does not place blank or text scatter x values on fallback category positions', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [10, 20, 30],
      [1, null, 'not-x'],
    ]);
    const config: StoredChartConfig = {
      id: 'scatter-live-x-authority-chart',
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:C1',
          categories: 'A2:C2',
        },
      ],
    };

    const data = extractChartData(accessor, config);
    const rows = specRows(configToSpec(config, data));

    expect(data.categories).toEqual([1, '', 'not-x']);
    expect(data.series[0].data.map((point) => point.x)).toEqual([1, '', 'not-x']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[SCATTER_X_FIELD]).toBe(1);
    expect(rows[0]?.[VALUE_FIELD]).toBe(10);
  });

  it('treats omitted scatter x cache indices as blanks instead of fallback positions', () => {
    const accessor = ObjectCellAccessor.fromArray([[10, 20, 30]]);
    const config: StoredChartConfig = {
      id: 'scatter-cache-x-authority-chart',
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:C1',
          categorySourceKind: 'literal',
          categoryCache: {
            pointCount: 3,
            points: [
              { idx: 0, value: '1' },
              { idx: 2, value: 'not-x' },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);
    const rows = specRows(configToSpec(config, data));

    expect(data.categories).toEqual([1, '', 'not-x']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[SCATTER_X_FIELD]).toBe(1);
    expect(rows[0]?.[VALUE_FIELD]).toBe(10);
  });

  it('uses imported multi-level category caches as composed chart-domain labels', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [10, 20, 30],
      ['Live A', 'Live B', 'Live C'],
    ]);
    const config: StoredChartConfig = {
      id: 'imported-category-levels-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'A1:C1',
          categories: 'A2:C2',
          categoryLevels: {
            pointCount: 3,
            levels: [
              {
                level: 0,
                pointCount: 3,
                points: [
                  { idx: 0, value: 'North' },
                  { idx: 1, value: 'North' },
                  { idx: 2, value: 'South' },
                ],
              },
              {
                level: 1,
                pointCount: 3,
                points: [
                  { idx: 0, value: 'Q1' },
                  { idx: 1, value: 'Q2' },
                  { idx: 2, value: 'Q1' },
                ],
              },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['North / Q1', 'North / Q2', 'South / Q1']);
    expect(data.categoryLevels).toEqual([
      { level: 0, labels: ['North', 'North', 'South'] },
      { level: 1, labels: ['Q1', 'Q2', 'Q1'] },
    ]);
    expect(data.series[0].data.map((point) => point.x)).toEqual([
      'North / Q1',
      'North / Q2',
      'South / Q1',
    ]);
  });

  it('uses the configured multi-level category label level for imported labels', () => {
    const accessor = ObjectCellAccessor.fromArray([[10, 20, 30]]);
    const config: StoredChartConfig = {
      id: 'selected-category-level-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      categoryLabelLevel: 1,
      series: [
        {
          name: 'Imported',
          values: 'A1:C1',
          categoryLevels: {
            pointCount: 3,
            levels: [
              {
                level: 0,
                points: [
                  { idx: 0, value: 'North' },
                  { idx: 1, value: 'North' },
                  { idx: 2, value: 'South' },
                ],
              },
              {
                level: 1,
                points: [
                  { idx: 0, value: 'Q1' },
                  { idx: 1, value: 'Q2' },
                  { idx: 2, value: 'Q1' },
                ],
              },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['Q1', 'Q2', 'Q1']);
    expect(data.series[0].data.map((point) => point.name)).toEqual(['Q1', 'Q2', 'Q1']);
    expect(data.categoryLevels?.[0].labels).toEqual(['North', 'North', 'South']);
  });

  it('uses live bubble size ranges before stale caches', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [10, 20, 30],
      [1, 2, 3],
      [100, null, 300],
    ]);
    const config: StoredChartConfig = {
      id: 'bubble-size-chart',
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Bubbles',
          values: 'A1:C1',
          categories: 'A2:C2',
          bubbleSize: 'A3:C3',
          bubbleSizeCache: {
            points: [{ idx: 1, value: '200' }],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((point) => point.size)).toEqual([100, undefined, 300]);
  });

  it('uses imported bubble size caches when no live size range exists', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [10, 20, 30],
      [1, 2, 3],
    ]);
    const config: StoredChartConfig = {
      id: 'bubble-size-cache-chart',
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Bubbles',
          values: 'A1:C1',
          categories: 'A2:C2',
          bubbleSizeSourceKind: 'literal',
          bubbleSizeCache: {
            pointCount: 3,
            points: [{ idx: 1, value: '200' }],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((point) => point.size)).toEqual([undefined, 200, undefined]);
  });
});
