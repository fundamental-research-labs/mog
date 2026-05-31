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
});
