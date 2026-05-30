import {
  extractChartData,
  extractChartDataFromRange,
  ObjectCellAccessor,
  parseRange,
} from '../data-extractor';
import type { StoredChartConfig } from '../../types';

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

  it('uses imported sparse value caches to distinguish blanks from explicit zeroes', () => {
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
          values: 'A1:D1',
          categories: 'A2:D2',
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

  it('uses imported category caches as chart-domain labels when present', () => {
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

    expect(data.categories).toEqual([45292, 'Cached B']);
    expect(data.series[0].data.map((point) => point.x)).toEqual([45292, 'Cached B']);
  });
});
