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
import { buildAnnotationLayers } from './annotation-layers';
import { buildConfigSpec } from './config-spec';
import { chartDataToRows } from './data-rows';
import { buildEncoding } from './encoding';
import { buildComboLayers } from './layers/combo';
import { buildDataLabelLayer } from './layers/data-labels';
import { buildDataTableLayers } from './layers/data-table';
import { buildFunnelLayers } from './layers/funnel';
import { buildParetoLayers } from './layers/pareto';
import { buildPerSeriesLineLayers, shouldBuildPerSeriesLineLayers } from './layers/series-lines';
import { buildStockLayers, hasStockVolumeLayer } from './layers/stock';
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
  buildDataTableLayers,
  buildEncoding,
  buildDataLabelLayer,
  buildFunnelLayers,
  buildMark,
  buildParetoLayers,
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

  // 7. Build dimensions (cell units -> pixels)
  const dimensions = buildChartDimensions(config);

  // 8. Handle layered chart types (combo, stock, waterfall, dual-axis)
  if (config.type === 'combo' || hasSecondaryYAxis(config, data)) {
    const layers = buildComboLayers(config, data, rows);

    layers.push(...buildAnnotationLayers(config, data, encoding, rows, { includeMarkers: false }));

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
    layers.push(...buildAnnotationLayers(config, data, encoding, rows));
    const resolve = hasStockVolumeLayer(config, rows)
      ? {
          scale: { y: 'independent' as const },
          axis: { y: 'independent' as const },
        }
      : undefined;
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      title,
      config: configSpec,
      resolve,
    });
  }

  if (config.type === 'funnel') {
    const funnel = buildFunnelLayers(config, rows);
    return buildLayerSpec({
      dimensions,
      rows: funnel.rows,
      layers: funnel.layers,
      title,
      config: configSpec,
    });
  }

  if (config.type === 'waterfall') {
    const layers = buildWaterfallLayers(config, data, rows);
    layers.push(...buildDataTableLayers(config, data));
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      title,
      config: configSpec,
    });
  }

  if (config.type === 'pareto') {
    const pareto = buildParetoLayers(config, data);
    pareto.layers.push(...buildAnnotationLayers(config, data, encoding, pareto.rows));
    return buildLayerSpec({
      dimensions,
      rows: pareto.rows,
      layers: pareto.layers,
      title,
      config: configSpec,
      resolve: {
        scale: { y: 'independent' },
        axis: { y: 'independent' },
      },
    });
  }

  if (isPreservedOnlyChartExFamily(config.type)) {
    return buildLayerSpec({
      dimensions,
      rows: [],
      layers: [],
      title,
      config: configSpec,
    });
  }

  const annotationLayers = buildAnnotationLayers(config, data, encoding, rows);
  if (shouldBuildPerSeriesLineLayers(config, data)) {
    const layers: ChartSpec[] = [
      ...buildPerSeriesLineLayers(config, data, encoding),
      ...annotationLayers,
    ];
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      encoding: sharedLayerEncodingForLegend(encoding, config.legend),
      title,
      config: configSpec,
      transforms,
    });
  }

  if (annotationLayers.length > 0) {
    const mainLayer: ChartSpec = { mark, encoding };
    const layers: ChartSpec[] = [mainLayer, ...annotationLayers];
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

function isPreservedOnlyChartExFamily(type: ChartConfig['type']): boolean {
  return type === 'treemap' || type === 'sunburst' || type === 'regionMap';
}
