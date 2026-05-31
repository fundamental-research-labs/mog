/**
 * Comprehensive ChartConfig -> ChartSpec bridge.
 *
 * Maps ChartConfig fields to the corresponding ChartSpec constructs
 * (Vega-Lite compatible grammar format).
 *
 * Pure function - no DOM dependencies.
 */
import type { ChartSpec, Transform } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { buildConfigSpec } from './config-spec';
import { chartDataToRows } from './data-rows';
import { buildEncoding } from './encoding';
import { buildComboLayers } from './layers/combo';
import { buildDataLabelLayer } from './layers/data-labels';
import { buildStockLayers } from './layers/stock';
import { buildWaterfallLayers } from './layers/waterfall';
import { buildMark } from './marks';
import { buildResolve, hasSecondaryYAxis } from './secondary-axis';
import {
  buildChartDimensions,
  buildLayerSpec,
  buildUnitSpec,
  sharedLayerEncodingForLegend,
} from './spec-assembly';
import { resolveStackMode, resolveSubTypeMarkProps } from './subtypes';
import { buildTitle } from './title';
import { buildTrendlineTransform, buildWaterfallTransforms } from './transforms';

export {
  buildConfigSpec,
  buildComboLayers,
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
  const dimensions = buildChartDimensions(config);

  // 8. Handle layered chart types (combo, stock, waterfall, dual-axis)
  if (config.type === 'combo' || hasSecondaryYAxis(config, data)) {
    const layers = buildComboLayers(config, data, rows);

    // Data label layer for the whole chart
    if (config.dataLabels?.show) {
      const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
      if (labelLayer) layers.push(labelLayer);
    }

    const resolve = buildResolve(config, data);
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      encoding: sharedLayerEncodingForLegend(encoding, config.legend),
      title,
      config: configSpec,
      resolve,
    });
  }

  if (config.type === 'stock') {
    const layers = buildStockLayers(config, data, rows);
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      title,
      config: configSpec,
    });
  }

  if (config.type === 'waterfall') {
    const layers = buildWaterfallLayers(config, data, rows);
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      title,
      config: configSpec,
    });
  }

  // 9. Handle data labels as overlay layer
  if (config.dataLabels?.show) {
    const mainLayer: ChartSpec = { mark, encoding };
    const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
    const layers: ChartSpec[] = [mainLayer];
    if (labelLayer) layers.push(labelLayer);

    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      title,
      config: configSpec,
      transforms,
    });
  }

  // 10. Simple single-mark spec
  return buildUnitSpec({
    dimensions,
    rows,
    mark,
    encoding,
    title,
    config: configSpec,
    transforms,
  });
}
