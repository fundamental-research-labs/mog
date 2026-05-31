/**
 * Comprehensive ChartConfig -> ChartSpec bridge.
 *
 * Maps ALL ChartConfig fields (storage format) to the corresponding ChartSpec
 * constructs (Vega-Lite compatible grammar format). This replaces the lossy
 * `configToSpec` in chart-engine.ts which only mapped ~3 of 30+ fields.
 *
 * Notable fixes from the old implementation:
 * - Bar chart encoding bug: x is now nominal (category), y is quantitative (value)
 * - Column chart: x is quantitative (value), y is nominal (category) (horizontal bar)
 *
 * Pure function - no DOM dependencies.
 */
import type {
  ChartSpec,
  DataRow,
  EncodingSpec,
  LayerSpec,
  MarkSpec,
  Transform,
  UnitSpec,
} from '../grammar/spec';
import type { ChartConfig, ChartData, ChartType } from '../types';
import {
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_WIDTH,
  MARK_TYPE_MAP,
  PIXELS_PER_COLUMN,
  PIXELS_PER_ROW,
} from './config-to-spec/constants';
import {
  buildAxisScaleSpec,
  mapAxisConfigToAxisSpec,
} from './config-to-spec/axis';
import { buildConfigSpec } from './config-to-spec/config-spec';
import { chartDataToRows } from './config-to-spec/data-rows';
import { buildEncoding, isLegendShown } from './config-to-spec/encoding';
import { buildDataLabelLayer } from './config-to-spec/layers/data-labels';
import { buildStockLayers } from './config-to-spec/layers/stock';
import { buildWaterfallLayers } from './config-to-spec/layers/waterfall';
import { buildMark, buildSeriesMark } from './config-to-spec/marks';
import { hasSecondaryYAxis } from './config-to-spec/secondary-axis';
import { resolveStackMode, resolveSubTypeMarkProps } from './config-to-spec/subtypes';
import { buildTitle } from './config-to-spec/title';
import { buildTrendlineTransform, buildWaterfallTransforms } from './config-to-spec/transforms';

export {
  buildConfigSpec,
  buildEncoding,
  buildDataLabelLayer,
  buildMark,
  buildStockLayers,
  buildTitle,
  buildTrendlineTransform,
  buildWaterfallLayers,
  buildWaterfallTransforms,
  chartDataToRows,
  hasSecondaryYAxis,
  resolveStackMode,
  resolveSubTypeMarkProps,
};

// =============================================================================
// Layer Builders (Combo, Stock, Waterfall, Data Labels)
// =============================================================================

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

/**
 * Build the resolve spec for dual-axis charts.
 * When series have different yAxisIndex values, we need independent y scales.
 */
function buildResolve(config: ChartConfig, data?: ChartData): ChartSpec['resolve'] | undefined {
  if (!hasSecondaryYAxis(config, data)) return undefined;
  return {
    scale: { y: 'independent' },
    axis: { y: 'independent' },
  };
}

// =============================================================================
// Main: configToSpec
// =============================================================================

/**
 * Convert ChartConfig + ChartData to ChartSpec format.
 * LOSSLESS: maps every ChartConfig field to the appropriate ChartSpec construct.
 */
export function configToSpec(config: ChartConfig, data: ChartData): ChartSpec {
  // 1. Convert data
  const rows = chartDataToRows(data, config);

  // 2. Build title
  const title = buildTitle(config);

  // 3. Build encoding
  const encoding = buildEncoding(config, data);

  // 4. Build mark
  const mark = buildMark(config);

  // 5. Build config (stacking, colors)
  const configSpec = buildConfigSpec(config, encoding, data);

  // 6. Build transforms
  const transforms: Transform[] = [];

  // Trendline transforms (scatter)
  if (config.trendline?.show) {
    transforms.push(...buildTrendlineTransform(config.trendline));
  }

  // 7. Build dimensions (cell units -> pixels)
  const width = config.width ? config.width * PIXELS_PER_COLUMN : DEFAULT_CHART_WIDTH;
  const height = config.height ? config.height * PIXELS_PER_ROW : DEFAULT_CHART_HEIGHT;

  // 8. Handle layered chart types (combo, stock, waterfall, dual-axis)
  if (config.type === 'combo' || hasSecondaryYAxis(config, data)) {
    const layers = buildComboLayers(config, data, rows);

    // Data label layer for the whole chart
    if (config.dataLabels?.show) {
      const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
      if (labelLayer) layers.push(labelLayer);
    }

    const resolve = buildResolve(config, data);
    const sharedEncoding: EncodingSpec | undefined =
      encoding.color && isLegendShown(config.legend) ? { color: { ...encoding.color } } : undefined;
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      ...(sharedEncoding ? { encoding: sharedEncoding } : {}),
      title,
      config: configSpec,
      ...(resolve ? { resolve } : {}),
    };
    return spec;
  }

  if (config.type === 'stock') {
    const layers = buildStockLayers(config, data, rows);
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
    };
    return spec;
  }

  if (config.type === 'waterfall') {
    const layers = buildWaterfallLayers(config, data, rows);
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
    };
    return spec;
  }

  // 9. Handle data labels as overlay layer
  if (config.dataLabels?.show) {
    const mainLayer: UnitSpec = { mark, encoding };
    const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
    const layers: ChartSpec[] = [mainLayer];
    if (labelLayer) layers.push(labelLayer);

    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
      ...(transforms.length > 0 ? { transform: transforms } : {}),
    };
    return spec;
  }

  // 10. Simple single-mark spec
  const spec: UnitSpec = {
    width,
    height,
    mark,
    data: { values: rows },
    encoding,
    title,
    ...(configSpec ? { config: configSpec } : {}),
    ...(transforms.length > 0 ? { transform: transforms } : {}),
  };

  return spec;
}
