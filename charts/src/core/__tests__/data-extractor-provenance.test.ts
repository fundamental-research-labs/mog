import {
  HIDDEN_CHART_CELL,
  extractChartData,
  extractChartDataFromRange,
  ObjectCellAccessor,
  parseRange,
} from '../data-extractor';
import { configToSpec } from '../config-to-spec';
import {
  BUBBLE_SIZE_FIELD,
  POINT_INDEX_FIELD,
  SCATTER_X_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_DIRECTION_FIELD,
  STOCK_HIGH_LOW_MAX_FIELD,
  STOCK_HIGH_LOW_MIN_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  STOCK_VOLUME_FIELD,
  VALUE_FIELD,
} from '../config-to-spec/fields';
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

  it('keeps first-row values when the first column contains row labels', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Revenue', 100500, 100900, 100000],
      ['yoy', null, 0.003980099502487455, -0.008919722497522264],
      ['OP', 4400, 7800, 7400],
      ['yoy', null, 0.7727272727272727, -0.05128205128205132],
      ['OPM', 0.04378109452736319, 0.07730426164519326, 0.074],
    ]);

    const data = extractChartDataFromRange(accessor, parseRange('A1:D5'));

    expect(data.categories).toEqual(['Revenue', 'yoy', 'OP', 'yoy', 'OPM']);
    expect(data.series[0].data.map((point) => point.y)).toEqual([
      100500, 0, 4400, 0, 0.04378109452736319,
    ]);
    expect(data.series[1].data.map((point) => point.y)).toEqual([
      100900, 0.003980099502487455, 7800, 0.7727272727272727, 0.07730426164519326,
    ]);
    expect(data.series[2].data.map((point) => point.y)).toEqual([
      100000, -0.008919722497522264, 7400, -0.05128205128205132, 0.074,
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

  it('uses zero-based OOXML idx and order for unnamed imported series labels', () => {
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
          idx: 0,
          order: 0,
        },
        {
          values: 'A2:B2',
          idx: 1,
          order: 1,
        },
        {
          values: 'A1:A2',
          order: 2,
        },
      ],
    };

    const data = extractChartData(accessor, config);

    expect(data.series.map((series) => series.name)).toEqual(['Series 1', 'Series 2', 'Series 3']);
  });

  it('resolves imported live series-name references before default labels', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['North', 'South', 'East', 'West'],
      [10, 20],
      [30, 40],
      [50, 60],
      [70, 80],
      ['Q1', 'Q2'],
    ]);
    const config: StoredChartConfig = {
      id: 'imported-series-name-ref-chart',
      type: 'bar3d',
      subType: 'percentStacked',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      legend: { show: true, position: 'right' },
      series: [
        { name: 'Series 1', nameRef: 'A1', values: 'A2:B2', categories: 'A6:B6', idx: 0 },
        { name: 'Series 2', nameRef: 'B1', values: 'A3:B3', categories: 'A6:B6', idx: 1 },
        { name: 'Series 3', nameRef: 'C1', values: 'A4:B4', categories: 'A6:B6', idx: 2 },
        { name: 'Series 4', nameRef: 'D1', values: 'A5:B5', categories: 'A6:B6', idx: 3 },
      ],
    };

    const data = extractChartData(accessor, config);
    const spec = configToSpec(config, data);
    const legend = spec.encoding?.color?.legend as { values?: string[] } | undefined;

    expect(data.series.map((series) => series.name)).toEqual(['North', 'South', 'East', 'West']);
    expect(legend?.values).toEqual(['North', 'South', 'East', 'West']);
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

  it('uses live multi-level category refs before stale imported caches', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['North', 'Q1', 10],
      ['North', 'Q2', 20],
      ['South', 'Q1', 30],
    ]);
    const config: StoredChartConfig = {
      id: 'live-category-levels-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'C1:C3',
          categories: 'A1:B3',
          categorySourceKind: 'ref',
          categoryLevels: {
            pointCount: 3,
            levels: [
              {
                level: 0,
                pointCount: 3,
                points: [
                  { idx: 0, value: 'Stale North' },
                  { idx: 1, value: 'Stale North' },
                  { idx: 2, value: 'Stale South' },
                ],
              },
              {
                level: 1,
                pointCount: 3,
                points: [
                  { idx: 0, value: 'Stale Q1' },
                  { idx: 1, value: 'Stale Q2' },
                  { idx: 2, value: 'Stale Q1' },
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
  });

  it('does not reintroduce hidden live multi-level category points from caches', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['North', 'Q1', 10],
      [HIDDEN_CHART_CELL, 'Q2', 20],
      ['South', 'Q1', 30],
    ]);
    const config: StoredChartConfig = {
      id: 'hidden-live-category-levels-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'Imported',
          values: 'C1:C3',
          categories: 'A1:B3',
          categorySourceKind: 'ref',
          categoryLevels: {
            pointCount: 3,
            levels: [
              {
                level: 0,
                pointCount: 3,
                points: [
                  { idx: 0, value: 'Stale North' },
                  { idx: 1, value: 'Stale North' },
                  { idx: 2, value: 'Stale South' },
                ],
              },
              {
                level: 1,
                pointCount: 3,
                points: [
                  { idx: 0, value: 'Stale Q1' },
                  { idx: 1, value: 'Stale Q2' },
                  { idx: 2, value: 'Stale Q1' },
                ],
              },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);
    const rows = specRows(configToSpec(config, data));

    expect(data.categoryLevels).toEqual([
      { level: 0, labels: ['North', null, 'South'] },
      { level: 1, labels: ['Q1', 'Q2', 'Q1'] },
    ]);
    expect(data.series[0].data.map((point) => point.valueState)).toEqual([
      undefined,
      'hidden',
      undefined,
    ]);
    expect(rows.map((row) => row[VALUE_FIELD])).toEqual([10, 30]);
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

  it('extracts bubble x, y, and size dimensions from a dataRange table', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['X', 'Revenue', 'Revenue Size'],
      [1, 10, 4],
      [2, 20, 9],
      [10, 30, 16],
    ]);
    const config: StoredChartConfig = {
      id: 'bubble-data-range-chart',
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:C4',
    };

    const data = extractChartData(accessor, config);
    const rows = specRows(configToSpec(config, data));

    expect(data.categories).toEqual([1, 2, 10]);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Revenue');
    expect(data.series[0].data.map((point) => point.x)).toEqual([1, 2, 10]);
    expect(data.series[0].data.map((point) => point.y)).toEqual([10, 20, 30]);
    expect(data.series[0].data.map((point) => point.size)).toEqual([4, 9, 16]);
    expect(rows.map((row) => row[SCATTER_X_FIELD])).toEqual([1, 2, 10]);
    expect(rows.map((row) => row[BUBBLE_SIZE_FIELD])).toEqual([4, 9, 16]);
  });

  it('extracts transposed bubble dimensions from a dataRange table', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['X', 1, 2, 10],
      ['Revenue', 10, 20, 30],
      ['Revenue Size', 4, 9, 16],
    ]);
    const config: StoredChartConfig = {
      id: 'bubble-data-range-rows-chart',
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:D3',
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual([1, 2, 10]);
    expect(data.series[0].name).toBe('Revenue');
    expect(data.series[0].data.map((point) => point.y)).toEqual([10, 20, 30]);
    expect(data.series[0].data.map((point) => point.size)).toEqual([4, 9, 16]);
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

  it('maps imported OHLC stock source series into one stock data series', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [10, 11, 12],
      [15, 14, 16],
      [8, 9, 10],
      [12, 9, 15],
      ['Jan', 'Feb', 'Mar'],
    ]);
    const config: StoredChartConfig = {
      id: 'stock-ohlc-chart',
      type: 'stock',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        { name: 'Open', values: 'A1:C1', categories: 'A5:C5' },
        { name: 'High', values: 'A2:C2', categories: 'A5:C5' },
        { name: 'Low', values: 'A3:C3', categories: 'A5:C5' },
        { name: 'Close', values: 'A4:C4', categories: 'A5:C5' },
      ],
    };

    const data = extractChartData(accessor, config);
    const spec = configToSpec(config, data);
    const rows = specRows(spec);

    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Close');
    expect(data.series[0].data.map((point) => point.y)).toEqual([12, 9, 15]);
    expect(data.series[0].data.map((point) => point.open)).toEqual([10, 11, 12]);
    expect(data.series[0].data.map((point) => point.high)).toEqual([15, 14, 16]);
    expect(data.series[0].data.map((point) => point.low)).toEqual([8, 9, 10]);
    expect(data.series[0].data.map((point) => point.close)).toEqual([12, 9, 15]);
    expect(rows.map((row) => row[STOCK_OPEN_FIELD])).toEqual([10, 11, 12]);
    expect(rows.map((row) => row[STOCK_HIGH_FIELD])).toEqual([15, 14, 16]);
    expect(rows.map((row) => row[STOCK_LOW_FIELD])).toEqual([8, 9, 10]);
    expect(rows.map((row) => row[STOCK_CLOSE_FIELD])).toEqual([12, 9, 15]);
    expect(rows.map((row) => row[STOCK_DIRECTION_FIELD])).toEqual(['up', 'down', 'up']);
    expect('layer' in spec ? spec.layer : []).toEqual([
      expect.objectContaining({
        mark: expect.objectContaining({
          type: 'stockGlyph',
          stockSubType: 'ohlc',
          stockOpenField: STOCK_OPEN_FIELD,
          stockHighField: STOCK_HIGH_LOW_MAX_FIELD,
          stockLowField: STOCK_HIGH_LOW_MIN_FIELD,
          stockCloseField: STOCK_CLOSE_FIELD,
        }),
        encoding: expect.objectContaining({
          y: expect.objectContaining({ field: STOCK_HIGH_LOW_MIN_FIELD, type: 'quantitative' }),
          y2: expect.objectContaining({ field: STOCK_HIGH_LOW_MAX_FIELD, type: 'quantitative' }),
        }),
      }),
    ]);
  });

  it('maps imported HLC stock source series without requiring open values', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [15, HIDDEN_CHART_CELL, 16],
      [8, 9, 10],
      [12, 9, 15],
      ['Jan', 'Feb', 'Mar'],
    ]);
    const config: StoredChartConfig = {
      id: 'stock-hlc-chart',
      type: 'stock',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        { name: 'High', values: 'A1:C1', categories: 'A4:C4' },
        { name: 'Low', values: 'A2:C2', categories: 'A4:C4' },
        { name: 'Close', values: 'A3:C3', categories: 'A4:C4' },
      ],
    };

    const data = extractChartData(accessor, config);
    const spec = configToSpec(config, data);
    const rows = specRows(spec);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].data.map((point) => point.open)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(rows.map((row) => row[STOCK_CLOSE_FIELD])).toEqual([12, 15]);
    expect(rows.map((row) => row[STOCK_OPEN_FIELD])).toEqual([undefined, undefined]);
    expect('layer' in spec ? spec.layer.map((layer) => layer.mark) : []).toEqual([
      expect.objectContaining({ type: 'stockGlyph', stockSubType: 'hlc' }),
    ]);
  });

  it('maps imported volume-OHLC stock combo source series into stock rows', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [1000, 1500, 1200],
      [10, 11, 12],
      [15, 14, 16],
      [8, 9, 10],
      [12, 9, 15],
      ['Jan', 'Feb', 'Mar'],
    ]);
    const config: StoredChartConfig = {
      id: 'stock-volume-ohlc-chart',
      type: 'stock',
      subType: 'volume-ohlc',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        { name: 'Volume', type: 'column', values: 'A1:C1', categories: 'A6:C6' },
        { name: 'Open', type: 'stock', values: 'A2:C2', categories: 'A6:C6' },
        { name: 'High', type: 'stock', values: 'A3:C3', categories: 'A6:C6' },
        { name: 'Low', type: 'stock', values: 'A4:C4', categories: 'A6:C6' },
        { name: 'Close', type: 'stock', values: 'A5:C5', categories: 'A6:C6' },
      ],
    };

    const data = extractChartData(accessor, config);
    const spec = configToSpec(config, data);
    const rows = specRows(spec);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Close');
    expect(data.series[0].data.map((point) => point.volume)).toEqual([1000, 1500, 1200]);
    expect(data.series[0].data.map((point) => point.open)).toEqual([10, 11, 12]);
    expect(data.series[0].data.map((point) => point.high)).toEqual([15, 14, 16]);
    expect(data.series[0].data.map((point) => point.low)).toEqual([8, 9, 10]);
    expect(data.series[0].data.map((point) => point.close)).toEqual([12, 9, 15]);
    expect(rows.map((row) => row[STOCK_VOLUME_FIELD])).toEqual([1000, 1500, 1200]);
    expect(rows.map((row) => row[STOCK_DIRECTION_FIELD])).toEqual(['up', 'down', 'up']);
    expect('layer' in spec ? spec.layer.map((layer) => layer.mark) : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'stockGlyph',
          stockSubType: 'volume-ohlc',
          stockVolumeField: STOCK_VOLUME_FIELD,
        }),
      ]),
    );
  });

  it('uses stock projection for volume-stock combo configs before kernel normalization', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [1000, 1500, 1200],
      [10, 11, 12],
      [15, 14, 16],
      [8, 9, 10],
      [12, 9, 15],
      ['Jan', 'Feb', 'Mar'],
    ]);
    const config: StoredChartConfig = {
      id: 'stock-volume-ohlc-combo-chart',
      type: 'combo',
      subType: 'volume-ohlc',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        { name: 'Volume', type: 'column', values: 'A1:C1', categories: 'A6:C6' },
        { name: 'Open', type: 'stock', values: 'A2:C2', categories: 'A6:C6' },
        { name: 'High', type: 'stock', values: 'A3:C3', categories: 'A6:C6' },
        { name: 'Low', type: 'stock', values: 'A4:C4', categories: 'A6:C6' },
        { name: 'Close', type: 'stock', values: 'A5:C5', categories: 'A6:C6' },
      ],
    };

    const data = extractChartData(accessor, config);
    const spec = configToSpec(config, data);
    const rows = specRows(spec);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].type).toBe('stock');
    expect(rows.map((row) => row[STOCK_VOLUME_FIELD])).toEqual([1000, 1500, 1200]);
    expect(rows.map((row) => row[STOCK_OPEN_FIELD])).toEqual([10, 11, 12]);
    expect(rows.map((row) => row[STOCK_CLOSE_FIELD])).toEqual([12, 9, 15]);
    expect('layer' in spec ? spec.layer.map((layer) => layer.mark) : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'stockGlyph',
          stockSubType: 'volume-ohlc',
          stockVolumeField: STOCK_VOLUME_FIELD,
        }),
      ]),
    );
  });

  it('maps imported volume-HLC stock combo source series by typed roles, not raw order', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [15, 14, 16],
      [8, 9, 10],
      [12, 9, 15],
      [1000, 1500, 1200],
      ['Jan', 'Feb', 'Mar'],
    ]);
    const config: StoredChartConfig = {
      id: 'stock-volume-hlc-chart',
      type: 'stock',
      subType: 'volume-hlc',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        { name: 'High', type: 'stock', values: 'A1:C1', categories: 'A5:C5' },
        { name: 'Low', type: 'stock', values: 'A2:C2', categories: 'A5:C5' },
        { name: 'Close', type: 'stock', values: 'A3:C3', categories: 'A5:C5' },
        { name: 'Volume', type: 'column', values: 'A4:C4', categories: 'A5:C5' },
      ],
    };

    const data = extractChartData(accessor, config);
    const spec = configToSpec(config, data);
    const rows = specRows(spec);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Close');
    expect(data.series[0].data.map((point) => point.open)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(data.series[0].data.map((point) => point.volume)).toEqual([1000, 1500, 1200]);
    expect(rows.map((row) => row[STOCK_HIGH_FIELD])).toEqual([15, 14, 16]);
    expect(rows.map((row) => row[STOCK_LOW_FIELD])).toEqual([8, 9, 10]);
    expect(rows.map((row) => row[STOCK_CLOSE_FIELD])).toEqual([12, 9, 15]);
    expect(rows.map((row) => row[STOCK_VOLUME_FIELD])).toEqual([1000, 1500, 1200]);
    expect('layer' in spec ? spec.layer.map((layer) => layer.mark) : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'stockGlyph',
          stockSubType: 'volume-hlc',
          stockVolumeField: STOCK_VOLUME_FIELD,
        }),
      ]),
    );
  });

  it('maps stock source series by explicit stockRole before order heuristics', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [12, 9, 15],
      [1000, 1500, 1200],
      [8, 9, 10],
      [15, 14, 16],
      ['Jan', 'Feb', 'Mar'],
    ]);
    const config: StoredChartConfig = {
      id: 'stock-explicit-role-chart',
      type: 'stock',
      subType: 'volume-hlc',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        { name: 'Close', stockRole: 'close', values: 'A1:C1', categories: 'A5:C5' },
        { name: 'Volume', stockRole: 'volume', values: 'A2:C2', categories: 'A5:C5' },
        { name: 'Low', stockRole: 'low', values: 'A3:C3', categories: 'A5:C5' },
        { name: 'High', stockRole: 'high', values: 'A4:C4', categories: 'A5:C5' },
      ],
    };

    const data = extractChartData(accessor, config);
    const spec = configToSpec(config, data);
    const rows = specRows(spec);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Close');
    expect(data.series[0].data.map((point) => point.high)).toEqual([15, 14, 16]);
    expect(data.series[0].data.map((point) => point.low)).toEqual([8, 9, 10]);
    expect(data.series[0].data.map((point) => point.close)).toEqual([12, 9, 15]);
    expect(data.series[0].data.map((point) => point.volume)).toEqual([1000, 1500, 1200]);
    expect(rows.map((row) => row[STOCK_HIGH_FIELD])).toEqual([15, 14, 16]);
    expect(rows.map((row) => row[STOCK_LOW_FIELD])).toEqual([8, 9, 10]);
    expect(rows.map((row) => row[STOCK_CLOSE_FIELD])).toEqual([12, 9, 15]);
    expect(rows.map((row) => row[STOCK_VOLUME_FIELD])).toEqual([1000, 1500, 1200]);
  });

  it('does not append stale stock cache points beyond a resolved live close range', () => {
    const accessor = ObjectCellAccessor.fromArray([
      [12, 15],
      ['Jan', 'Feb', 'Mar'],
    ]);
    const config: StoredChartConfig = {
      id: 'stock-live-close-cardinality-chart',
      type: 'stock',
      subType: 'hlc',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
      series: [
        {
          name: 'High',
          stockRole: 'high',
          valueSourceKind: 'literal',
          valueCache: {
            pointCount: 3,
            points: [
              { idx: 0, value: '15' },
              { idx: 1, value: '16' },
              { idx: 2, value: '17' },
            ],
          },
        },
        {
          name: 'Low',
          stockRole: 'low',
          valueSourceKind: 'literal',
          valueCache: {
            pointCount: 3,
            points: [
              { idx: 0, value: '8' },
              { idx: 1, value: '10' },
              { idx: 2, value: '11' },
            ],
          },
        },
        {
          name: 'Close',
          stockRole: 'close',
          values: 'A1:B1',
          categories: 'A2:C2',
          valueSourceKind: 'ref',
          valueCache: {
            pointCount: 3,
            points: [
              { idx: 0, value: '90' },
              { idx: 1, value: '91' },
              { idx: 2, value: '92' },
            ],
          },
        },
      ],
    };

    const data = extractChartData(accessor, config);
    const rows = specRows(configToSpec(config, data));

    expect(data.categories).toEqual(['Jan', 'Feb']);
    expect(data.series[0].data.map((point) => point.close)).toEqual([12, 15]);
    expect(data.series[0].data.map((point) => point.high)).toEqual([15, 16]);
    expect(data.series[0].data).toHaveLength(2);
    expect(rows.map((row) => row[STOCK_CLOSE_FIELD])).toEqual([12, 15]);
    expect(rows.map((row) => row[POINT_INDEX_FIELD])).toEqual([0, 1]);
  });
});
