import { isLayerSpec, type LayerSpec } from '../../grammar/spec';
import { compile } from '../../grammar/compiler';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import { pieDoughnutArcFrame } from '../config-to-spec/pie-like';
import {
  DATA_LABEL_ANCHOR_X_FIELD,
  DATA_LABEL_DX_FIELD,
  DATA_LABEL_FONT_SIZE_FIELD,
  DATA_LABEL_LAYOUT_TARGET_FIELD,
  DATA_LABEL_LAYOUT_X_FIELD,
  DATA_LABEL_LAYOUT_Y_FIELD,
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  DATA_LABEL_X_FIELD,
  DATA_LABEL_Y_FIELD,
  DATA_TABLE_FILL_FIELD,
  DATA_TABLE_STROKE_WIDTH_FIELD,
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
  MARKER_SIZE_FIELD,
  MARKER_VISIBLE_FIELD,
  POINT_EXPLOSION_FIELD,
  POINT_FILL_FIELD,
  POINT_STYLE_VISIBLE_FIELD,
  PIE_SLICE_CENTER_X_FIELD,
  PIE_SLICE_CENTER_Y_FIELD,
  SCATTER_X_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
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

function labelAngle(x: number, y: number, centerX: number, centerY: number): number {
  const angle = Math.atan2(y - centerY, x - centerX) + Math.PI / 2;
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function arcMidAngle(arc: { startAngle: number; endAngle: number }): number {
  const angle = (arc.startAngle + arc.endAngle) / 2;
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
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
        [MARKER_SIZE_FIELD]: 36,
        [MARKER_FILL_FIELD]: '#FF0000',
      }),
    );

    const markerLayer = spec.layer.find(
      (layer) => layer.encoding?.size?.field === MARKER_SIZE_FIELD,
    );
    expect(markerLayer?.encoding?.size?.scale).toBeNull();

    const compiled = compile(spec, undefined, {
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const markerSymbol = compiled.marks.find(
      (mark) => mark.type === 'symbol' && mark.shape === 'x',
    );
    expect(markerSymbol?.size).toBe(36);

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

  it('keeps combo marker sizes absolute instead of rescaling them as bubble areas', () => {
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
        {
          name: 'Margin',
          data: [
            { x: 'A', y: 4 },
            { x: 'B', y: 5 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'combo',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        { type: 'column' },
        { type: 'line', showMarkers: true, markerSize: 4, markerStyle: 'diamond' },
      ],
    };

    const spec = asLayerSpec(config, data);
    const markerLayer = spec.layer.find(
      (layer) => layer.encoding?.size?.field === MARKER_SIZE_FIELD,
    );
    expect(markerLayer?.encoding?.size?.scale).toBeNull();

    const compiled = compile(spec, undefined, {
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const markerSymbols = compiled.marks.filter(
      (mark) => mark.type === 'symbol' && mark.shape === 'diamond',
    );
    expect(markerSymbols).toHaveLength(2);
    expect(markerSymbols.map((mark) => mark.size)).toEqual([16, 16]);
  });

  it('does not double-render marker-only scatter points behind imported markers', () => {
    const data: ChartData = {
      categories: [1, 2],
      series: [
        {
          name: 'Pressure',
          data: [
            { x: 1, y: 10 },
            { x: 2, y: 12 },
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
      series: [{ showMarkers: true, markerSize: 5, markerStyle: 'circle' }],
    };

    const spec = asLayerSpec(config, data);
    const compiled = compile(spec, undefined, {
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const symbols = compiled.marks.filter((mark) => mark.type === 'symbol');
    expect(symbols).toHaveLength(2);
    expect(symbols.map((mark) => mark.size)).toEqual([25, 25]);
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
    expect(
      movingAverageLayer?.transform?.some((transform) => transform.type === 'regression'),
    ).not.toBe(true);
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
    expect(
      projectedLayer?.transform?.some((transform) => transform.type === 'regression'),
    ).not.toBe(true);
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
        {
          trendlines: [
            { show: true, type: 'exp' },
            { show: true, type: 'log' },
          ],
        },
        {
          trendlines: [
            { show: true, type: 'poly', order: 3 },
            { show: true, type: 'pow' },
          ],
        },
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
        (mark.datum as Record<string, unknown> | undefined)?.[TRENDLINE_LABEL_TEXT_FIELD] === 'Fit',
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

    const compiled = compile(spec, undefined, {
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const arcMarks = compiled.marks.filter((mark) => mark.type === 'arc');
    const explodedArc = arcMarks.find((mark) => mark.datum?.[POINT_EXPLOSION_FIELD] === 12)!;
    const centerX = Number(explodedArc.datum?.[PIE_SLICE_CENTER_X_FIELD]);
    const centerY = Number(explodedArc.datum?.[PIE_SLICE_CENTER_Y_FIELD]);
    expect(Math.hypot(centerX - 0.5, centerY - 0.5)).toBeCloseTo(0.06);
    const frame = pieDoughnutArcFrame(
      compiled.layout.plotArea,
      spec.config?.layoutHints?.pieDoughnut,
    );
    expect(explodedArc.x).toBeCloseTo(frame.centerX + (centerX - 0.5) * frame.radius * 2);
    expect(explodedArc.y).toBeCloseTo(frame.centerY + (centerY - 0.5) * frame.radius * 2);
  });

  it('aligns imported doughnut labels with rotated slices and hole-size geometry', () => {
    const data: ChartData = {
      categories: ['North', 'South'],
      series: [
        {
          name: 'Share',
          data: [
            { x: 'North', y: 10 },
            { x: 'South', y: 10 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'doughnut',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      doughnutHoleSize: 65,
      firstSliceAngle: 90,
      legend: { show: true, visible: true, position: 'left' },
      series: [
        {
          dataLabels: {
            show: true,
            showCategoryName: true,
            showPercentage: true,
            visualFormat: { font: { size: 9 } },
          },
          points: [
            { idx: 0, fill: '#2F75B5' },
            { idx: 1, fill: '#70AD47' },
          ],
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const primaryMark = spec.layer[0]?.mark;
    expect(primaryMark).toEqual(
      expect.objectContaining({
        type: 'arc',
        innerRadius: 0.65,
        startAngle: Math.PI / 2,
      }),
    );

    const rows = 'values' in spec.data! ? spec.data.values : [];
    expect(spec.layer[0]?.encoding?.color?.scale?.range).toEqual(['#2F75B5', '#70AD47']);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        [DATA_LABEL_TEXT_FIELD]: 'North, 50%',
        [DATA_LABEL_FONT_SIZE_FIELD]: 12,
      }),
    );
    expect(rows[0][DATA_LABEL_X_FIELD]).toBeCloseTo(0.5, 6);
    expect(Number(rows[0][DATA_LABEL_Y_FIELD])).toBeGreaterThan(0.5);

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 300,
      skipAxes: true,
      skipTitle: true,
    });
    const arcs = compiled.marks.filter((mark) => mark.type === 'arc');
    const firstArc = compiled.marks.find(
      (mark) => mark.type === 'arc' && mark.datum?.category === 'North',
    );
    const firstLabel = compiled.marks.find(
      (mark) => mark.type === 'text' && mark.datum?.[DATA_LABEL_TEXT_FIELD] === 'North, 50%',
    );

    expect(arcs.map((arc) => arc.style.fill)).toEqual(['#2F75B5', '#70AD47']);
    expect(firstArc?.innerRadius).toBeCloseTo(firstArc!.outerRadius * 0.65, 6);
    expect(firstLabel?.fontSize).toBe(12);
    expect(
      compiled.legends.filter((mark) => mark.type === 'rect').map((mark) => mark.style.fill),
    ).toEqual(['#2F75B5', '#70AD47']);
    expect(
      Math.cos(
        labelAngle(firstLabel!.x, firstLabel!.y, firstArc!.x, firstArc!.y) - arcMidAngle(firstArc!),
      ),
    ).toBeGreaterThan(0.99);
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

  it('keeps imported column data-label layers out of the category domain', () => {
    const categories = ['Bridge A', 'Bridge B', 'Bridge C'];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Good',
          color: '#70AD47',
          data: [
            { x: 'Bridge A', y: 91 },
            { x: 'Bridge B', y: 0, valueState: 'blank' },
            { x: 'Bridge C', y: 0, valueState: 'blank' },
          ],
        },
        {
          name: 'Watch',
          color: '#FFC000',
          data: [
            { x: 'Bridge A', y: 0, valueState: 'blank' },
            { x: 'Bridge B', y: 64 },
            { x: 'Bridge C', y: 0, valueState: 'blank' },
          ],
        },
        {
          name: 'Critical',
          color: '#C00000',
          data: [
            { x: 'Bridge A', y: 0, valueState: 'blank' },
            { x: 'Bridge B', y: 0, valueState: 'blank' },
            { x: 'Bridge C', y: 38 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'column',
      subType: 'clustered',
      anchorRow: 0,
      anchorCol: 0,
      width: 10,
      height: 8,
      displayBlanksAs: 'zero',
      dataLabels: {
        show: true,
        showValue: true,
      },
      series: [
        { name: 'Good', color: '#70AD47', format: { fill: { type: 'solid', color: '#70AD47' } } },
        { name: 'Watch', color: '#FFC000', format: { fill: { type: 'solid', color: '#FFC000' } } },
        {
          name: 'Critical',
          color: '#C00000',
          format: { fill: { type: 'solid', color: '#C00000' } },
        },
      ],
    };

    const spec = asLayerSpec(config, data);
    const compiled = compile(spec, undefined, { width: 640, height: 360 });

    expect(compiled.scales.x?.domain?.()).toEqual(categories);
    expect(compiled.scales.color?.domain?.()).toEqual(['Good', 'Watch', 'Critical']);

    const xAxisLabels = compiled.axes
      .filter((mark) => {
        const datum = mark.datum as Record<string, unknown> | undefined;
        return mark.type === 'text' && datum?.role === 'x-axis' && datum.axisPart === 'label';
      })
      .map((mark) => (mark.type === 'text' ? mark.text : ''));
    expect(xAxisLabels).toEqual(categories);

    const positiveBars = compiled.marks.filter((mark) => {
      const datum = mark.datum as Record<string, unknown> | undefined;
      return mark.type === 'rect' && typeof datum?.value === 'number' && datum.value > 0;
    });
    expect(
      positiveBars.map((mark) => (mark.type === 'rect' ? mark.style.fill : undefined)),
    ).toEqual(['#70AD47', '#FFC000', '#C00000']);
    expect(
      positiveBars.every((mark) => mark.type === 'rect' && mark.style.fillPaint === undefined),
    ).toBe(true);

    const dataLabelTexts = compiled.marks
      .filter((mark) => {
        const datum = mark.datum as Record<string, unknown> | undefined;
        return mark.type === 'text' && datum?.[DATA_LABEL_TEXT_FIELD] !== undefined;
      })
      .map((mark) => (mark.type === 'text' ? mark.text : ''));
    expect(dataLabelTexts).toEqual(['91', '64', '38']);
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
        {
          name: 'Revenue',
          data: [
            { x: 'Q1', y: 10 },
            { x: 'Q2', y: 20 },
          ],
        },
        {
          name: 'Cost',
          data: [
            { x: 'Q1', y: 4 },
            { x: 'Q2', y: 7 },
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
      dataTable: {
        visible: true,
        showHorzBorder: true,
        showVertBorder: true,
        showOutline: true,
        showKeys: true,
      },
    };

    const spec = asLayerSpec(config, data);
    expect(spec.config?.layoutHints?.dataTable).toEqual(expect.objectContaining({ rowCount: 3 }));
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
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_TABLE_TEXT_FIELD] === 'Revenue',
    );
    expect(tableLabel?.y).toBeGreaterThan(
      compiled.layout.plotArea.y + compiled.layout.plotArea.height,
    );
    const key = compiled.marks.find(
      (mark) =>
        mark.type === 'rect' &&
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_TABLE_FILL_FIELD],
    );
    expect(key?.clip).toBeUndefined();
    expect(key?.x).toBeLessThan(tableLabel?.x ?? 0);
    expect((key?.x ?? 0) + (key?.width ?? 0)).toBeLessThan(tableLabel?.x ?? 0);
    const border = compiled.marks.find(
      (mark) =>
        mark.type === 'path' &&
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_TABLE_STROKE_FIELD],
    );
    expect(border?.clip).toBeUndefined();
    expect(border?.style.strokeWidth).toBe(1);
  });

  it('does not reserve a data table band when there are no category columns', () => {
    const data: ChartData = {
      categories: [],
      series: [{ name: 'Revenue', data: [{ x: 1, y: 10 }] }],
    };
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      dataTable: { visible: true, showKeys: true },
    };

    const spec = configToSpec(config, data);

    expect(spec.config?.layoutHints?.dataTable).toBeUndefined();
    expect(
      isLayerSpec(spec) &&
        spec.layer.some((layer) => layer.mark.coordinateSystem === 'dataTableFraction'),
    ).toBe(false);
  });

  it('uses datum-driven direct rect stroke widths for table key marks', () => {
    const data: ChartData = {
      categories: ['Q1'],
      series: [{ name: 'Revenue', data: [{ x: 'Q1', y: 10 }], color: '#123456' }],
    };
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      dataTable: { visible: true, showKeys: true },
    };
    const spec = asLayerSpec(config, data);
    const keyLayer = spec.layer.find(
      (layer) => layer.mark.type === 'rect' && layer.mark.coordinateSystem === 'dataTableFraction',
    );
    expect(keyLayer).toBeDefined();
    const keyRows = 'values' in keyLayer!.data! ? keyLayer!.data.values : [];
    keyRows[0][DATA_TABLE_STROKE_WIDTH_FIELD] = 3;

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 240,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const key = compiled.marks.find(
      (mark) =>
        mark.type === 'rect' &&
        (mark.datum as Record<string, unknown> | undefined)?.[DATA_TABLE_FILL_FIELD],
    );

    expect(key?.style.strokeWidth).toBe(3);
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

  it('consumes stock up/down bars as native stock glyph visual metadata', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Price',
          data: [
            {
              x: 'A',
              y: 12,
              [STOCK_OPEN_FIELD]: 10,
              [STOCK_HIGH_FIELD]: 13,
              [STOCK_LOW_FIELD]: 9,
              [STOCK_CLOSE_FIELD]: 12,
            },
            {
              x: 'B',
              y: 9,
              [STOCK_OPEN_FIELD]: 11,
              [STOCK_HIGH_FIELD]: 12,
              [STOCK_LOW_FIELD]: 8,
              [STOCK_CLOSE_FIELD]: 9,
            },
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
    const stockLayer = spec.layer.find(
      (layer) => typeof layer.mark === 'object' && layer.mark.type === 'stockGlyph',
    );

    expect(stockLayer?.mark).toEqual(
      expect.objectContaining({
        type: 'stockGlyph',
        stockVisual: expect.objectContaining({
          importedUpDownBars: true,
          priceGlyphMode: 'upDownBody',
          gapWidth: 150,
          upBody: expect.objectContaining({ fill: '#ffffff' }),
          downBody: expect.objectContaining({ fill: '#333333' }),
        }),
      }),
    );
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
      expect.arrayContaining([
        expect.objectContaining({ mark: expect.objectContaining({ type: 'point' }) }),
      ]),
    );
  });
});
