/**
 * Comprehensive ChartConfig -> ChartSpec bridge.
 *
 * Maps ChartConfig fields to the corresponding ChartSpec constructs
 * (Vega-Lite compatible grammar format).
 *
 * Pure function - no DOM dependencies.
 */
import type { ChartFrameSpec, ChartSpec, ConfigSpec, Transform } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { buildAnnotationLayers, composePrimaryAndAnnotationLayers } from './annotation-layers';
import { buildConfigSpec } from './config-spec';
import { chartDataToRows } from './data-rows';
import { buildEncoding } from './encoding';
import { withExcelAreaBaseline } from './excel-cartesian-geometry';
import { buildComboLayers } from './layers/combo';
import { buildDataLabelLayer } from './layers/data-labels';
import { buildDataTableLayers } from './layers/data-table';
import { buildDoughnutRingLayers, shouldBuildDoughnutRingLayers } from './layers/doughnut-rings';
import { buildFunnelLayers } from './layers/funnel';
import { buildParetoLayers } from './layers/pareto';
import { buildPerSeriesLineLayers, shouldBuildPerSeriesLineLayers } from './layers/series-lines';
import { buildStockLayers, hasStockVolumeLayer } from './layers/stock';
import { buildSurface3DSpec, shouldRenderSurface3D } from './layers/surface-3d';
import { buildSurfaceContourSpec, shouldRenderSurfaceContour } from './layers/surface-contour';
import { buildWaterfallLayers } from './layers/waterfall';
import { buildMark } from './marks';
import { buildResolve, hasSecondaryYAxis } from './secondary-axis';
import {
  buildChartDimensions,
  buildLayerSpec,
  buildUnitSpec,
  sharedLayerEncodingForLegend,
} from './spec-assembly';
import { asStockConfig, shouldRenderStockChart } from '../stock-semantics';
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
  buildSurface3DSpec,
  buildSurfaceContourSpec,
  buildTitle,
  buildTrendlineTransform,
  buildWaterfallLayers,
  buildWaterfallTransforms,
  chartDataToRows,
  hasSecondaryYAxis,
  resolveStackMode,
  resolveSubTypeMarkProps,
  shouldRenderSurfaceContour,
  shouldRenderSurface3D,
};
export {
  buildPieDoughnutGeometry,
  maxEffectivePieDoughnutExplosionPercent,
  pieDoughnutLayoutHintsForConfig,
  pieDoughnutRowsFromGeometry,
  type PieDoughnutGeometry,
  type PieDoughnutGeometryFamily,
  type PieDoughnutGeometryInput,
  type PieDoughnutGeometryRing,
  type PieDoughnutGeometrySlice,
} from './pie-doughnut-geometry';

/**
 * Convert ChartConfig + ChartData to ChartSpec format.
 * LOSSLESS: maps every ChartConfig field to the appropriate ChartSpec construct.
 */
export function configToSpec(config: ChartConfig, data: ChartData): ChartSpec {
  const renderConfig = shouldRenderStockChart(config, data) ? asStockConfig(config, data) : config;

  // 1. Convert data
  const rows = chartDataToRows(data, renderConfig);

  // 2. Build title
  const title = buildTitle(renderConfig);

  // 3. Build encoding
  const encoding = buildEncoding(renderConfig, data);

  // 4. Build mark
  const mark = withExcelAreaBaseline(buildMark(renderConfig), renderConfig, encoding.y);

  // 5. Build config (stacking, colors)
  const configSpec = buildConfigSpec(renderConfig, encoding, data);

  // 6. Build transforms
  const transforms: Transform[] = [];

  // 7. Build dimensions (cell units -> pixels)
  const dimensions = buildChartDimensions(renderConfig);

  if (shouldRenderSurfaceContour(renderConfig)) {
    return buildSurfaceContourSpec({
      config: renderConfig,
      data,
      dimensions,
      title,
    });
  }

  if (shouldRenderSurface3D(renderConfig)) {
    return buildSurface3DSpec({
      config: renderConfig,
      data,
      dimensions,
      title,
    });
  }

  if (renderConfig.type === 'radar') {
    return buildUnitSpec({
      dimensions,
      rows,
      mark,
      encoding,
      title,
      config: withRadarDefaultChartBackground(configSpec),
      transforms,
    });
  }

  // 8. Handle layered chart types (combo, stock, waterfall, dual-axis)
  if (renderConfig.type === 'combo' || hasSecondaryYAxis(renderConfig, data)) {
    const layers = buildComboLayers(renderConfig, data, rows);

    layers.push(
      ...buildAnnotationLayers(renderConfig, data, encoding, rows, { includeMarkers: false }),
    );

    const resolve = buildResolve(renderConfig, data);
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      encoding: sharedLayerEncodingForLegend(encoding, renderConfig.legend),
      title,
      config: configSpec,
      resolve,
    });
  }

  if (renderConfig.type === 'stock') {
    const layers = buildStockLayers(renderConfig, data, rows);
    layers.push(...buildAnnotationLayers(renderConfig, data, encoding, rows));
    const resolve = hasStockVolumeLayer(renderConfig, rows)
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

  if (renderConfig.type === 'funnel') {
    const funnel = buildFunnelLayers(renderConfig, rows);
    return buildLayerSpec({
      dimensions,
      rows: funnel.rows,
      layers: funnel.layers,
      title,
      config: configSpec,
    });
  }

  if (renderConfig.type === 'waterfall') {
    const layers = buildWaterfallLayers(renderConfig, data, rows);
    layers.push(...buildDataTableLayers(renderConfig, data));
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      title,
      config: configSpec,
    });
  }

  if (renderConfig.type === 'pareto') {
    const pareto = buildParetoLayers(renderConfig, data);
    pareto.layers.push(...buildAnnotationLayers(renderConfig, data, encoding, pareto.rows));
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

  if (isPreservedOnlyChartExFamily(renderConfig.type)) {
    return buildLayerSpec({
      dimensions,
      rows: [],
      layers: [],
      title,
      config: configSpec,
    });
  }

  const annotationLayers = buildAnnotationLayers(renderConfig, data, encoding, rows);
  if (shouldBuildDoughnutRingLayers(renderConfig, data)) {
    return buildLayerSpec({
      dimensions,
      rows,
      layers: [
        ...buildDoughnutRingLayers({ config: renderConfig, data, mark, encoding }),
        ...annotationLayers,
      ],
      encoding: sharedLayerEncodingForLegend(encoding, renderConfig.legend),
      title,
      config: configSpec,
      transforms,
    });
  }

  if (shouldBuildPerSeriesLineLayers(renderConfig, data)) {
    const layers: ChartSpec[] = [
      ...buildPerSeriesLineLayers(renderConfig, data, encoding),
      ...annotationLayers,
    ];
    return buildLayerSpec({
      dimensions,
      rows,
      layers,
      encoding: sharedLayerEncodingForLegend(encoding, renderConfig.legend),
      title,
      config: configSpec,
      transforms,
    });
  }

  if (annotationLayers.length > 0) {
    const layers = composePrimaryAndAnnotationLayers({
      config: renderConfig,
      mark,
      encoding,
      rows,
      annotationLayers,
    });
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

function withRadarDefaultChartBackground(config: ConfigSpec | undefined): ConfigSpec {
  const defaultFill: ChartFrameSpec['fill'] = { type: 'solid', color: '#ffffff' };
  const chartFrame = config?.chartFrame
    ? {
        ...config.chartFrame,
        fill: config.chartFrame.fill ?? defaultFill,
      }
    : { fill: defaultFill };

  return {
    ...(config ?? {}),
    background: config?.background ?? '#ffffff',
    chartFrame,
  };
}
