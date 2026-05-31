import { isLayerSpec, type LayerSpec } from '../../grammar/spec';
import { compile } from '../../grammar/compiler';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import {
  DATA_LABEL_ANCHOR_X_FIELD,
  DATA_LABEL_DX_FIELD,
  DATA_LABEL_LAYOUT_TARGET_FIELD,
  DATA_LABEL_LAYOUT_X_FIELD,
  DATA_LABEL_LAYOUT_Y_FIELD,
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  DATA_LABEL_X_FIELD,
  DATA_TABLE_FILL_FIELD,
  DATA_TABLE_STROKE_FIELD,
  DATA_TABLE_TEXT_FIELD,
  ERROR_BAR_X_MAX_CAP_VISIBLE_FIELD,
  ERROR_BAR_X_MAX_FIELD,
  ERROR_BAR_X_MIN_CAP_VISIBLE_FIELD,
  ERROR_BAR_X_MIN_FIELD,
  ERROR_BAR_VISIBLE_FIELD,
  ERROR_BAR_Y_MAX_FIELD,
  ERROR_BAR_Y_MIN_FIELD,
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_VISIBLE_FIELD,
  POINT_EXPLOSION_FIELD,
  POINT_FILL_FIELD,
  POINT_STYLE_VISIBLE_FIELD,
  SCATTER_X_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_OPEN_FIELD,
  TRENDLINE_LABEL_LAYOUT_X_FIELD,
  TRENDLINE_LABEL_LAYOUT_Y_FIELD,
  TRENDLINE_LABEL_TEXT_FIELD,
  VALUE_FIELD,
} from '../config-to-spec/fields';

function asLayerSpec(config: ChartConfig, data: ChartData): LayerSpec {
  const spec = configToSpec(config, data);
  expect(isLayerSpec(spec)).toBe(true);
  return spec as LayerSpec;
}

describe('configToSpec annotation layers', () => {
  it('lowers point labels, markers, error bars, and trendlines into renderable layers', () => {
    const data: ChartData = {
      categories: [1, 2],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 1, y: 10 },
            { x: 2, y: 20 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        {
          showMarkers: true,
          markerStyle: 'x',
          markerSize: 6,
          markerBackgroundColor: 'FF0000',
          errorBars: {
            visible: true,
            direction: 'y',
            valueType: 'fixedVal',
            value: 2,
          },
          dataLabels: {
            show: true,
            showValue: true,
            position: 'top',
          },
          trendlines: [
            {
              show: true,
              type: 'linear',
              color: '#111111',
              lineWidth: 2,
            },
          ],
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows[0]).toEqual(
      expect.objectContaining({
        [DATA_LABEL_VISIBLE_FIELD]: true,
        [DATA_LABEL_TEXT_FIELD]: '10',
        [ERROR_BAR_VISIBLE_FIELD]: true,
        [ERROR_BAR_Y_MIN_FIELD]: 8,
        [ERROR_BAR_Y_MAX_FIELD]: 12,
        [MARKER_VISIBLE_FIELD]: true,
        [MARKER_SHAPE_FIELD]: 'x',
        [MARKER_FILL_FIELD]: '#FF0000',
      }),
    );

    expect(spec.layer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mark: expect.objectContaining({ type: 'text' }) }),
        expect.objectContaining({ mark: expect.objectContaining({ type: 'point' }) }),
        expect.objectContaining({ mark: expect.objectContaining({ type: 'rule' }) }),
      ]),
    );

    const trendlineLayer = spec.layer.find((layer) =>
      layer.transform?.some((transform) => transform.type === 'regression'),
    );
    expect(trendlineLayer).toBeDefined();
    expect(trendlineLayer?.transform).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'regression',
          regression: VALUE_FIELD,
          on: SCATTER_X_FIELD,
          as: [SCATTER_X_FIELD, VALUE_FIELD],
        }),
      ]),
    );
  });

  it('renders moving-average trendlines from computed rows instead of regression transforms', () => {
    const data: ChartData = {
      categories: [0, 1, 2, 3],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 0, y: 10 },
            { x: 1, y: 20 },
            { x: 2, y: 30 },
            { x: 3, y: 50 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        {
          trendlines: [{ show: true, type: 'moving-average', period: 2 }],
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const movingAverageLayer = spec.layer.find(
      (layer) =>
        layer.mark &&
        typeof layer.mark === 'object' &&
        layer.mark.type === 'line' &&
        layer.data &&
        'values' in layer.data,
    );

    expect(movingAverageLayer).toBeDefined();
    expect(movingAverageLayer?.transform?.some((transform) => transform.type === 'regression')).not.toBe(
      true,
    );
    expect(movingAverageLayer!.data).toEqual({
      values: [
        { __mogPointIndex: 1, value: 15 },
        { __mogPointIndex: 2, value: 25 },
        { __mogPointIndex: 3, value: 40 },
      ],
    });
  });

  it('renders projected linear trendlines from computed rows when forward, backward, or intercept are set', () => {
    const data: ChartData = {
      categories: [1, 2],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 1, y: 3 },
            { x: 2, y: 5 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        {
          trendlines: [{ show: true, type: 'linear', intercept: 1, backward: 1, forward: 2 }],
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const projectedLayer = spec.layer.find(
      (layer) =>
        layer.mark &&
        typeof layer.mark === 'object' &&
        layer.mark.type === 'line' &&
        layer.data &&
        'values' in layer.data,
    );

    expect(projectedLayer).toBeDefined();
    expect(projectedLayer?.transform?.some((transform) => transform.type === 'regression')).not.toBe(
      true,
    );
    expect(projectedLayer!.data).toEqual({
      values: [
        { [SCATTER_X_FIELD]: 0, [VALUE_FIELD]: 1 },
        { [SCATTER_X_FIELD]: 4, [VALUE_FIELD]: 9 },
      ],
    });
  });

  it('normalizes trendline type aliases and filters each series trendline independently', () => {
    const data: ChartData = {
      categories: [1, 2, 3, 4],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 1, y: 2 },
            { x: 2, y: 4 },
            { x: 3, y: 8 },
            { x: 4, y: 16 },
          ],
        },
        {
          name: 'Cost',
          data: [
            { x: 1, y: 1 },
            { x: 2, y: 3 },
            { x: 3, y: 9 },
            { x: 4, y: 27 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        { trendlines: [{ show: true, type: 'exp' }, { show: true, type: 'log' }] },
        { trendlines: [{ show: true, type: 'poly', order: 3 }, { show: true, type: 'pow' }] },
      ],
    };

    const spec = asLayerSpec(config, data);
    const regressionTransforms = spec.layer.flatMap((layer) =>
      (layer.transform ?? []).filter((transform) => transform.type === 'regression'),
    );

    expect(regressionTransforms.map((transform) => transform.method)).toEqual([
      'exp',
      'log',
      'poly',
      'pow',
    ]);
    expect(
      spec.layer.filter((layer) =>
        layer.transform?.some(
          (transform) =>
            transform.type === 'filter' &&
            typeof transform.filter === 'object' &&
            transform.filter.field === 'series',
        ),
      ),
    ).toHaveLength(4);
  });

  it('adds trendline label layers for equation, R2, and explicit label text', () => {
    const data: ChartData = {
      categories: [1, 2, 3],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 1, y: 2 },
            { x: 2, y: 4 },
            { x: 3, y: 6 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        {
          trendlines: [
            {
              show: true,
              type: 'linear',
              displayEquation: true,
              displayRSquared: true,
              label: { text: 'Fit', numberFormat: '0.00' },
            },
          ],
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const labelLayer = spec.layer.find(
      (layer) => layer.encoding?.text?.field === TRENDLINE_LABEL_TEXT_FIELD,
    );

    expect(labelLayer).toBeDefined();
    expect(labelLayer!.data).toEqual({
      values: [
        expect.objectContaining({
          [TRENDLINE_LABEL_TEXT_FIELD]: expect.stringContaining('Fit'),
        }),
      ],
    });
    const labelText = (labelLayer!.data as { values: Record<string, string>[] }).values[0][
      TRENDLINE_LABEL_TEXT_FIELD
    ];
    expect(labelText).toContain('y =');
    expect(labelText).toContain('R^2 = 1.00');
  });

  it('renders manual trendline label layout as chart-relative text coordinates', () => {
    const data: ChartData = {
      categories: [1, 2, 3],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 1, y: 2 },
            { x: 2, y: 4 },
            { x: 3, y: 6 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      trendlines: [
        {
          show: true,
          type: 'linear',
          label: { text: 'Fit', layout: { x: 0.25, y: 0.3 } },
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const labelLayer = spec.layer.find(
      (layer) => layer.encoding?.text?.field === TRENDLINE_LABEL_TEXT_FIELD,
    );

    expect(labelLayer).toBeDefined();
    expect(labelLayer!.mark).toEqual(
      expect.objectContaining({
        type: 'text',
        xField: TRENDLINE_LABEL_LAYOUT_X_FIELD,
        yField: TRENDLINE_LABEL_LAYOUT_Y_FIELD,
        coordinateSystem: 'chartFraction',
        dx: 0,
        dy: 0,
        textBaseline: 'top',
      }),
    );
    expect(labelLayer!.data).toEqual({
      values: [
        expect.objectContaining({
          [TRENDLINE_LABEL_LAYOUT_X_FIELD]: 0.25,
          [TRENDLINE_LABEL_LAYOUT_Y_FIELD]: 0.3,
          [TRENDLINE_LABEL_TEXT_FIELD]: 'Fit',
        }),
      ],
    });

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 200,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const labelMark = compiled.marks.find(
      (mark) =>
        mark.type === 'text' &&
        (mark.datum as Record<string, unknown> | undefined)?.[TRENDLINE_LABEL_TEXT_FIELD] ===
          'Fit',
    );
    expect(labelMark?.x).toBeCloseTo(100, 5);
    expect(labelMark?.y).toBeCloseTo(60, 5);
  });

  it('lowers pie labels, leader lines, point fill, and explosion into row geometry', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Share',
          data: [
            { x: 'A', y: 25 },
            { x: 'B', y: 75 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'pie',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      dataLabels: {
        show: true,
        showCategoryName: true,
        showPercentage: true,
        position: 'outsideEnd',
        showLeaderLines: true,
      },
      series: [
        {
          points: [{ idx: 1, fill: '#00ff00', explosion: 12 }],
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows[0]).toEqual(
      expect.objectContaining({
        [DATA_LABEL_VISIBLE_FIELD]: true,
        [DATA_LABEL_TEXT_FIELD]: 'A, 25%',
        [DATA_LABEL_X_FIELD]: expect.any(Number),
        [DATA_LABEL_ANCHOR_X_FIELD]: expect.any(Number),
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        [POINT_FILL_FIELD]: '#00ff00',
        [POINT_EXPLOSION_FIELD]: 12,
      }),
    );
    expect(spec.layer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mark: expect.objectContaining({ type: 'text', xField: DATA_LABEL_X_FIELD }),
        }),
        expect.objectContaining({
          mark: expect.objectContaining({ type: 'rule', xField: DATA_LABEL_ANCHOR_X_FIELD }),
        }),
      ]),
    );

    const compiled = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    const arcMarks = compiled.marks.filter((mark) => mark.type === 'arc');
    const explodedArc = arcMarks.find((mark) => mark.datum?.[POINT_EXPLOSION_FIELD] === 12)!;
    const centerX = compiled.layout.plotArea.x + compiled.layout.plotArea.width / 2;
    const centerY = compiled.layout.plotArea.y + compiled.layout.plotArea.height / 2;
    expect(Math.hypot(explodedArc.x - centerX, explodedArc.y - centerY)).toBeCloseTo(
      Math.min(explodedArc.outerRadius * 0.25, 12),
    );
  });

  it('renders chart and point manual data-label layouts through direct coordinates', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 'A', y: 10 },
            { x: 'B', y: 20 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      dataLabels: {
        show: true,
        showValue: true,
        layout: { x: 0.1, y: 0.2 },
      },
      series: [
        {
          points: [{ idx: 1, dataLabel: { layout: { layoutTarget: 'inner', x: 0.3, y: 0.4 } } }],
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows[0]).toEqual(
      expect.objectContaining({
        [DATA_LABEL_VISIBLE_FIELD]: true,
        [DATA_LABEL_LAYOUT_TARGET_FIELD]: 'outer',
        [DATA_LABEL_LAYOUT_X_FIELD]: 0.1,
        [DATA_LABEL_LAYOUT_Y_FIELD]: 0.2,
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        [DATA_LABEL_VISIBLE_FIELD]: true,
        [DATA_LABEL_LAYOUT_TARGET_FIELD]: 'inner',
        [DATA_LABEL_LAYOUT_X_FIELD]: 0.3,
        [DATA_LABEL_LAYOUT_Y_FIELD]: 0.4,
      }),
    );
    expect(spec.layer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mark: expect.objectContaining({
            type: 'text',
            xField: DATA_LABEL_LAYOUT_X_FIELD,
            yField: DATA_LABEL_LAYOUT_Y_FIELD,
            coordinateSystem: 'chartFraction',
          }),
        }),
        expect.objectContaining({
          mark: expect.objectContaining({
            type: 'text',
            xField: DATA_LABEL_LAYOUT_X_FIELD,
            yField: DATA_LABEL_LAYOUT_Y_FIELD,
            coordinateSystem: 'plotFraction',
          }),
        }),
      ]),
    );

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 200,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const chartRelativeLabel = compiled.marks.find(
      (mark) =>
        mark.type === 'text' &&
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_LABEL_TEXT_FIELD] === '10',
    );
    expect(chartRelativeLabel?.x).toBeCloseTo(40, 5);
    expect(chartRelativeLabel?.y).toBeCloseTo(40, 5);
  });

  it('uses the text displacement fields as leader-line endpoint offsets', () => {
    const data: ChartData = {
      categories: ['A'],
      series: [{ name: 'Revenue', data: [{ x: 'A', y: 10 }] }],
    };
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      dataLabels: {
        show: true,
        showValue: true,
        position: 'outsideEnd',
        showLeaderLines: true,
      },
    };

    const spec = asLayerSpec(config, data);
    const leaderLayer = spec.layer.find(
      (layer) =>
        layer.mark &&
        typeof layer.mark === 'object' &&
        layer.mark.type === 'rule' &&
        layer.mark.dxField === DATA_LABEL_DX_FIELD,
    );

    expect(leaderLayer).toBeDefined();
  });

  it('carries imported manual layouts into render layout hints', () => {
    const data: ChartData = {
      categories: ['A'],
      series: [{ name: 'Revenue', data: [{ x: 'A', y: 10 }] }],
    };
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      plotLayout: { layoutTarget: 'inner', xMode: 'factor', x: 0.12, w: 0.7 },
      titleLayout: { xMode: 'edge', y: 0.04 },
      legend: { show: true, layout: { layoutTarget: 'outer', yMode: 'factor', h: 0.2 } },
    };

    const spec = configToSpec(config, data);

    expect(spec.config?.layoutHints).toEqual(
      expect.objectContaining({
        manualPlotArea: { layoutTarget: 'inner', xMode: 'factor', x: 0.12, w: 0.7 },
        manualTitle: { xMode: 'edge', y: 0.04 },
        manualLegend: { layoutTarget: 'outer', yMode: 'factor', h: 0.2 },
      }),
    );
  });

  it('renders a chart data table band with text, borders, and legend keys', () => {
    const data: ChartData = {
      categories: ['Q1', 'Q2'],
      series: [
        { name: 'Revenue', data: [{ x: 'Q1', y: 10 }, { x: 'Q2', y: 20 }] },
        { name: 'Cost', data: [{ x: 'Q1', y: 4 }, { x: 'Q2', y: 7 }] },
      ],
    };
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      dataTable: {
        visible: true,
        showHorzBorder: true,
        showVertBorder: true,
        showOutline: true,
        showKeys: true,
      },
    };

    const spec = asLayerSpec(config, data);
    expect(spec.config?.layoutHints?.dataTable).toEqual(
      expect.objectContaining({ rowCount: 3 }),
    );
    expect(spec.layer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mark: expect.objectContaining({
            type: 'text',
            coordinateSystem: 'dataTableFraction',
          }),
        }),
        expect.objectContaining({
          mark: expect.objectContaining({
            type: 'rule',
            coordinateSystem: 'dataTableFraction',
          }),
        }),
        expect.objectContaining({
          mark: expect.objectContaining({
            type: 'rect',
            coordinateSystem: 'dataTableFraction',
          }),
        }),
      ]),
    );

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 240,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    expect(compiled.layout.dataTable).toBeDefined();
    const tableLabel = compiled.marks.find(
      (mark) =>
        mark.type === 'text' &&
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_TABLE_TEXT_FIELD] ===
          'Revenue',
    );
    expect(tableLabel?.y).toBeGreaterThan(compiled.layout.plotArea.y + compiled.layout.plotArea.height);
    const key = compiled.marks.find(
      (mark) =>
        mark.type === 'rect' &&
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_TABLE_FILL_FIELD],
    );
    expect(key?.clip).toBeUndefined();
    const border = compiled.marks.find(
      (mark) =>
        mark.type === 'path' &&
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_TABLE_STROKE_FIELD],
    );
    expect(border?.clip).toBeUndefined();
  });

  it('renders x error bars from xErrorBars defaults and preserves one-sided custom sources', () => {
    const data: ChartData = {
      categories: [1, 2],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 1, y: 10 },
            { x: 2, y: 20 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        {
          xErrorBars: {
            visible: true,
            valueType: 'cust',
            noEndCap: true,
            plusSource: { cache: { points: [{ idx: 0, value: 0.5 }] } },
          },
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows[0]).toEqual(
      expect.objectContaining({
        [ERROR_BAR_VISIBLE_FIELD]: true,
        [ERROR_BAR_X_MIN_FIELD]: 1,
        [ERROR_BAR_X_MAX_FIELD]: 1.5,
      }),
    );
    expect(rows[0][ERROR_BAR_X_MIN_CAP_VISIBLE_FIELD]).toBeUndefined();
    expect(rows[0][ERROR_BAR_X_MAX_CAP_VISIBLE_FIELD]).toBeUndefined();
    expect(rows[1][ERROR_BAR_VISIBLE_FIELD]).toBeUndefined();
  });

  it('defaults generic error bars to the horizontal value axis for bar charts', () => {
    const data: ChartData = {
      categories: ['A'],
      series: [{ name: 'Revenue', data: [{ x: 'A', y: 10 }] }],
    };
    const config: ChartConfig = {
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [{ errorBars: { visible: true, valueType: 'fixedVal', value: 2 } }],
    };

    const spec = asLayerSpec(config, data);
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows[0]).toEqual(
      expect.objectContaining({
        [ERROR_BAR_X_MIN_FIELD]: 8,
        [ERROR_BAR_X_MAX_FIELD]: 12,
      }),
    );
    expect(rows[0][ERROR_BAR_Y_MIN_FIELD]).toBeUndefined();
    expect(rows[0][ERROR_BAR_Y_MAX_FIELD]).toBeUndefined();
  });

  it('adds analysis-line and up/down-bar annotation layers, including stock charts', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Price',
          data: [
            { x: 'A', y: 12, [STOCK_OPEN_FIELD]: 10, [STOCK_CLOSE_FIELD]: 12 },
            { x: 'B', y: 9, [STOCK_OPEN_FIELD]: 11, [STOCK_CLOSE_FIELD]: 9 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'stock',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      upDownBars: {
        gapWidth: 150,
        upFormat: { fill: { type: 'solid', color: '#ffffff' } },
        downFormat: { fill: { type: 'solid', color: '#333333' } },
      },
    };

    const spec = asLayerSpec(config, data);
    const upDownLayers = spec.layer.filter((layer) =>
      layer.transform?.some(
        (transform) =>
          transform.type === 'filter' &&
          typeof transform.filter === 'object' &&
          (transform.filter.equal === 'up' || transform.filter.equal === 'down'),
      ),
    );

    expect(upDownLayers).toHaveLength(2);
    expect(upDownLayers[0].data).toEqual({
      values: expect.arrayContaining([
        expect.objectContaining({ __mogAnalysisDirection: 'up' }),
        expect.objectContaining({ __mogAnalysisDirection: 'down' }),
      ]),
    });
  });

  it('renders area point style overrides as datum-level point overlays', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 'A', y: 10 },
            { x: 'B', y: 12 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'area',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [{ points: [{ idx: 1, fill: '#00ff00' }] }],
    };

    const spec = asLayerSpec(config, data);
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows[1]).toEqual(
      expect.objectContaining({
        [POINT_FILL_FIELD]: '#00ff00',
        [POINT_STYLE_VISIBLE_FIELD]: true,
      }),
    );
    expect(spec.layer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mark: expect.objectContaining({ type: 'point', fillField: POINT_FILL_FIELD }),
        }),
      ]),
    );
  });

  it('keeps explicit no-line series marker-only while suppressing the connecting path', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 'A', y: 10 },
            { x: 'B', y: 12 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        {
          showMarkers: true,
          markerStyle: 'diamond',
          format: { line: { noFill: true } },
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const rows = 'values' in spec.data! ? spec.data.values : [];
    const mainLayer = spec.layer[0];

    expect(rows[0]).toEqual(
      expect.objectContaining({
        [MARKER_VISIBLE_FIELD]: true,
        [MARKER_SHAPE_FIELD]: 'diamond',
      }),
    );
    expect(mainLayer.mark).toEqual(expect.objectContaining({ type: 'line', opacity: 0 }));
    expect(spec.layer).toEqual(
      expect.arrayContaining([expect.objectContaining({ mark: expect.objectContaining({ type: 'point' }) })]),
    );
  });
});
