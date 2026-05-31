import { compile } from '../../grammar/compiler';
import { isLayerSpec, type ChartSpec, type LayerSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { chartDataToRows, configToSpec } from '../config-to-spec';
import {
  FUNNEL_X2_FIELD,
  FUNNEL_X_FIELD,
  FUNNEL_Y2_FIELD,
  FUNNEL_Y_FIELD,
  WATERFALL_END_FIELD,
  WATERFALL_RUNNING_TOTAL_FIELD,
  WATERFALL_START_FIELD,
  WATERFALL_TYPE_FIELD,
} from '../config-to-spec/fields';

function asLayerSpec(spec: ChartSpec): LayerSpec {
  expect(isLayerSpec(spec)).toBe(true);
  return spec as LayerSpec;
}

describe('configToSpec ChartEx-family semantics', () => {
  it.each(['treemap', 'sunburst', 'regionMap'] as const)(
    'does not render %s as generic placeholder geometry',
    (type) => {
      const data: ChartData = {
        categories: ['A', 'B'],
        series: [
          {
            name: 'Values',
            data: [
              { x: 'A', y: 1 },
              { x: 'B', y: 2 },
            ],
          },
        ],
      };
      const config: ChartConfig = {
        type,
        anchorRow: 0,
        anchorCol: 0,
        width: 6,
        height: 4,
      };

      const spec = asLayerSpec(configToSpec(config, data));
      expect(spec.layer).toEqual([]);
      expect('values' in spec.data!).toBe(true);
      expect('values' in spec.data! ? spec.data.values : []).toEqual([]);

      const compiled = compile(spec, undefined, {
        width: 400,
        height: 240,
        skipAxes: true,
        skipLegend: true,
        skipTitle: true,
      });
      expect(compiled.marks).toEqual([]);
    },
  );

  it('renders funnel as centered proportional bars in source order', () => {
    const data: ChartData = {
      categories: ['Qualified', 'Proposal', 'Closed'],
      series: [
        {
          name: 'Pipeline',
          data: [
            { x: 'Qualified', y: 100 },
            { x: 'Proposal', y: 60 },
            { x: 'Closed', y: 30 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'funnel',
      anchorRow: 0,
      anchorCol: 0,
      width: 6,
      height: 4,
      colors: ['#111111', '#222222', '#333333'],
    };

    const spec = asLayerSpec(configToSpec(config, data));
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows.map((row) => [row.category, row.value])).toEqual([
      ['Qualified', 100],
      ['Proposal', 60],
      ['Closed', 30],
    ]);
    expect(rows.map((row) => row[FUNNEL_X_FIELD])).toEqual([0, 0.2, 0.35]);
    expect(rows.map((row) => row[FUNNEL_X2_FIELD])).toEqual([1, 0.8, 0.65]);
    expect(rows.map((row) => row[FUNNEL_Y_FIELD])).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(rows[0][FUNNEL_Y_FIELD]).toBeLessThan(rows[1][FUNNEL_Y_FIELD] as number);
    expect(rows[1][FUNNEL_Y_FIELD]).toBeLessThan(rows[2][FUNNEL_Y_FIELD] as number);
    expect(spec.layer).toEqual([
      expect.objectContaining({
        mark: expect.objectContaining({
          type: 'rect',
          coordinateSystem: 'plotFraction',
          xField: FUNNEL_X_FIELD,
          x2Field: FUNNEL_X2_FIELD,
          yField: FUNNEL_Y_FIELD,
          y2Field: FUNNEL_Y2_FIELD,
        }),
      }),
    ]);

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 240,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const funnelRects = compiled.marks.filter((mark) => mark.type === 'rect');

    expect(funnelRects.map((mark) => mark.datum?.category)).toEqual([
      'Qualified',
      'Proposal',
      'Closed',
    ]);
    expect(funnelRects[0].width).toBeGreaterThan(funnelRects[1].width);
    expect(funnelRects[1].width).toBeGreaterThan(funnelRects[2].width);
    expect(funnelRects[1].x).toBeGreaterThan(funnelRects[0].x);
    expect(funnelRects[2].x).toBeGreaterThan(funnelRects[1].x);
  });

  it('renders Pareto as sorted bars plus a cumulative percentage line', () => {
    const data: ChartData = {
      categories: ['B', 'A', 'C'],
      series: [
        {
          name: 'Defects',
          data: [
            { x: 'B', y: 2 },
            { x: 'A', y: 5 },
            { x: 'C', y: 3 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'pareto',
      anchorRow: 0,
      anchorCol: 0,
      width: 6,
      height: 4,
    };

    const spec = asLayerSpec(configToSpec(config, data));
    const rows = 'values' in spec.data! ? spec.data.values : [];

    expect(rows.map((row) => [row.category, row.value, row.__mogParetoCumulativePercent])).toEqual(
      [
        ['A', 5, 50],
        ['C', 3, 80],
        ['B', 2, 100],
      ],
    );
    expect(spec.resolve).toEqual({
      scale: { y: 'independent' },
      axis: { y: 'independent' },
    });
    expect(spec.layer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mark: expect.objectContaining({ type: 'bar' }) }),
        expect.objectContaining({
          mark: expect.objectContaining({ type: 'line' }),
          encoding: expect.objectContaining({
            y: expect.objectContaining({
              field: '__mogParetoCumulativePercent',
              axis: expect.objectContaining({ orient: 'right' }),
            }),
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
    const barValues = compiled.marks
      .filter((mark) => mark.type === 'rect')
      .map((mark) => mark.datum?.value);
    const cumulativeLine = compiled.marks.find((mark) => mark.type === 'path');

    expect(barValues).toEqual([5, 3, 2]);
    expect(cumulativeLine?.datum).toEqual(
      rows.map((row) =>
        expect.objectContaining({
          __mogParetoCumulativePercent: row.__mogParetoCumulativePercent,
        }),
      ),
    );
  });

  it('projects waterfall subtotal rows and connector visibility into render layers', () => {
    const data: ChartData = {
      categories: ['Start', 'Loss', 'Subtotal'],
      series: [
        {
          name: 'Cash',
          data: [
            { x: 'Start', y: 10 },
            { x: 'Loss', y: -3 },
            { x: 'Subtotal', y: 7 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'waterfall',
      anchorRow: 0,
      anchorCol: 0,
      width: 6,
      height: 4,
      waterfall: {
        subtotalIndices: [2],
        showConnectorLines: true,
      },
    };

    const rows = chartDataToRows(data, config);
    expect(rows.map((row) => row[WATERFALL_TYPE_FIELD])).toEqual([
      'increase',
      'decrease',
      'total',
    ]);
    expect(rows.map((row) => row[WATERFALL_START_FIELD])).toEqual([0, 10, 0]);
    expect(rows.map((row) => row[WATERFALL_END_FIELD])).toEqual([10, 7, 7]);
    expect(rows.map((row) => row[WATERFALL_RUNNING_TOTAL_FIELD])).toEqual([10, 7, 7]);

    const spec = asLayerSpec(configToSpec(config, data));
    expect(spec.layer[0]).toEqual(
      expect.objectContaining({
        mark: expect.objectContaining({ type: 'bar' }),
        encoding: expect.objectContaining({
          y: expect.objectContaining({ field: WATERFALL_END_FIELD }),
          y2: expect.objectContaining({ field: WATERFALL_START_FIELD }),
        }),
      }),
    );
    expect(spec.layer.some((layer) => layer.mark === 'line' || layer.mark?.type === 'line')).toBe(
      true,
    );

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 240,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const waterfallRects = compiled.marks.filter((mark) => mark.type === 'rect');
    expect(waterfallRects).toHaveLength(3);
    expect(waterfallRects[1].y).toBeCloseTo(waterfallRects[0].y);
    expect(waterfallRects[1].height).toBeGreaterThan(0);
    expect(waterfallRects[1].datum).toEqual(
      expect.objectContaining({
        [WATERFALL_START_FIELD]: 10,
        [WATERFALL_END_FIELD]: 7,
      }),
    );

    const noConnectorSpec = asLayerSpec(
      configToSpec(
        {
          ...config,
          waterfall: {
            ...config.waterfall,
            showConnectorLines: false,
          },
        },
        data,
      ),
    );
    expect(
      noConnectorSpec.layer.some((layer) => layer.mark === 'line' || layer.mark?.type === 'line'),
    ).toBe(false);
  });

  it('honors imported histogram bin width and explicit bounds during compilation', () => {
    const data: ChartData = {
      categories: Array.from({ length: 10 }, (_, index) => index),
      series: [
        {
          name: 'Values',
          data: Array.from({ length: 10 }, (_, index) => ({ x: index, y: index })),
        },
      ],
    };
    const config: ChartConfig = {
      type: 'histogram',
      anchorRow: 0,
      anchorCol: 0,
      width: 6,
      height: 4,
      histogram: {
        binWidth: 2.5,
        underflowBinValue: 0,
        overflowBinValue: 10,
      },
    };

    const spec = configToSpec(config, data);
    expect(spec.mark).toEqual(
      expect.objectContaining({
        type: 'histogram',
        binWidth: 2.5,
        underflowBinValue: 0,
        overflowBinValue: 10,
      }),
    );

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 240,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const bins = compiled.marks
      .filter((mark) => mark.type === 'rect')
      .map((mark) => (mark.datum as { bin?: { x0: number; x1: number; count: number } })?.bin)
      .filter((bin): bin is { x0: number; x1: number; count: number } => Boolean(bin));

    expect(bins.map((bin) => [bin.x0, bin.x1, bin.count])).toEqual([
      [0, 2.5, 3],
      [2.5, 5, 2],
      [5, 7.5, 3],
      [7.5, 10, 2],
    ]);
  });

  it('honors imported boxplot quartile and visibility options during compilation', () => {
    const data: ChartData = {
      categories: ['Group', 'Group', 'Group', 'Group', 'Group'],
      series: [
        {
          name: 'Samples',
          data: [1, 2, 3, 4, 100].map((value) => ({ x: 'Group', y: value })),
        },
      ],
    };
    const config: ChartConfig = {
      type: 'boxplot',
      anchorRow: 0,
      anchorCol: 0,
      width: 6,
      height: 4,
      boxplot: {
        quartileMethod: 'exclusive',
        showMeanMarkers: true,
        showMeanLine: true,
        showOutlierPoints: false,
      },
    };

    const spec = configToSpec(config, data);
    expect(spec.mark).toEqual(
      expect.objectContaining({
        type: 'boxplot',
        quartileMethod: 'exclusive',
        showMeanMarkers: true,
        showMeanLine: true,
        showOutlierPoints: false,
      }),
    );

    const compiled = compile(spec, undefined, {
      width: 400,
      height: 240,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const boxMark = compiled.marks.find(
      (mark) => mark.type === 'rect' && mark.datum?.type === 'box',
    );
    const boxStats = boxMark?.datum?.stats as { q1: number; q3: number } | undefined;

    expect(boxStats?.q1).toBeCloseTo(1.5, 5);
    expect(boxStats?.q3).toBeCloseTo(52, 5);
    expect(compiled.marks.some((mark) => mark.datum?.type === 'mean')).toBe(true);
    expect(compiled.marks.some((mark) => mark.datum?.type === 'mean-line')).toBe(true);
    expect(compiled.marks.some((mark) => mark.datum?.type === 'outlier')).toBe(false);
  });
});
