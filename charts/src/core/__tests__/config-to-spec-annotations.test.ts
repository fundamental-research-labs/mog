import { isLayerSpec, type LayerSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import {
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  ERROR_BAR_VISIBLE_FIELD,
  ERROR_BAR_Y_MAX_FIELD,
  ERROR_BAR_Y_MIN_FIELD,
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_VISIBLE_FIELD,
  SCATTER_X_FIELD,
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
});
