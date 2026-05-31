import type { DataRow, EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData, ChartType } from '../../../types';
import {
  buildAxisScaleSpec,
  mapAxisConfigToAxisSpec,
} from '../axis';
import { MARK_TYPE_MAP } from '../constants';
import { buildEncoding } from '../encoding';
import { buildSeriesMark } from '../marks';
import { buildTrendlineTransform } from '../transforms';

/**
 * Build layers for combo charts where each series can have its own mark type.
 * Handles per-series encoding overrides: color, lineWidth, markerSize,
 * dataLabels, and trendline (3b + 3c).
 */
export function buildComboLayers(
  config: ChartConfig,
  data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const seriesConfigs = config.series ?? [];
  const baseEncoding = buildEncoding(config, data);
  const xEncoding = baseEncoding.x ?? { field: 'category', type: 'nominal' };
  const yEncoding = baseEncoding.y ?? { field: 'value', type: 'quantitative' };
  const secondaryYAxis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;

  for (let i = 0; i < data.series.length; i++) {
    const series = data.series[i];
    const seriesConf = seriesConfigs[i];
    const fallbackComboType =
      config.type === 'combo' ? (i === 0 ? 'column' : 'line') : (config.type ?? 'line');
    const seriesType = (seriesConf?.type ?? series.type ?? fallbackComboType) as ChartType;
    const markType = MARK_TYPE_MAP[seriesType] ?? 'bar';
    const yAxisIndex = seriesConf?.yAxisIndex ?? series.yAxisIndex;

    const layerEncoding: EncodingSpec = {
      x: { ...xEncoding },
      y: { ...yEncoding, field: 'value', type: 'quantitative' },
    };

    // Per-series y-axis encoding for dual-axis support
    if (yAxisIndex === 1) {
      const secondaryAxis = secondaryYAxis;
      const secondaryAxisSpec = secondaryAxis ? mapAxisConfigToAxisSpec(secondaryAxis) : {};
      layerEncoding.y = {
        field: 'value',
        type: 'quantitative',
        axis: {
          ...secondaryAxisSpec,
          orient: 'right',
          grid: secondaryAxisSpec.grid ?? false,
          title: secondaryAxisSpec.title ?? secondaryAxis?.title ?? null,
        },
      };
      // Apply secondary axis scale domain if configured
      if (secondaryAxis) {
        const scaleSpec = buildAxisScaleSpec(secondaryAxis, false);
        if (scaleSpec) layerEncoding.y.scale = scaleSpec;
      }
    }

    const layerSpec: UnitSpec = {
      mark: buildSeriesMark(markType, seriesConf, i, config.type),
      encoding: layerEncoding,
      transform: [
        {
          type: 'filter',
          filter: { field: 'series', equal: series.name },
        },
      ],
    };

    layers.push(layerSpec);

    // Per-series data labels: add a text overlay layer for this series
    if (seriesConf?.dataLabels?.show) {
      const labelLayer: UnitSpec = {
        mark: { type: 'text' },
        encoding: {
          ...layerEncoding,
          text: { field: 'value', type: 'quantitative' },
        },
        transform: [
          {
            type: 'filter',
            filter: { field: 'series', equal: series.name },
          },
        ],
      };
      layers.push(labelLayer);
    }

    // Per-series trendline: add a regression layer for this series
    if (seriesConf?.trendline?.show) {
      const trendTransforms = buildTrendlineTransform(seriesConf.trendline);
      const trendMark: MarkSpec = { type: 'line' };
      if (seriesConf.trendline.color) trendMark.color = seriesConf.trendline.color;
      if (seriesConf.trendline.lineWidth) trendMark.strokeWidth = seriesConf.trendline.lineWidth;
      trendMark.strokeDash = [4, 4]; // dashed for trendlines

      const trendLayer: UnitSpec = {
        mark: trendMark,
        encoding: {
          x: { ...xEncoding },
          y: { field: 'value', type: 'quantitative' },
        },
        transform: [
          {
            type: 'filter',
            filter: { field: 'series', equal: series.name },
          },
          ...trendTransforms,
        ],
      };
      layers.push(trendLayer);
    }
  }

  return layers;
}
