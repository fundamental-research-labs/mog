import type { MarkType } from '../../grammar/spec';
import type { ChartType } from '../../types';

// =============================================================================
// Layout Constants
// =============================================================================

/** Default chart width in pixels when no width is specified. */
export const DEFAULT_CHART_WIDTH = 600;

/** Default chart height in pixels when no height is specified. */
export const DEFAULT_CHART_HEIGHT = 400;

/** Pixel width of OHLC candlestick body bars. */
export const CANDLESTICK_BAR_WIDTH = 14;

/** Tick count used to simulate minor gridlines. */
export const MINOR_GRIDLINE_TICK_COUNT = 10;

export const SERIES_OPACITY_FIELD = '__mogSeriesOpacity';
export const CATEGORY_KEY_PREFIX = '__mogCategory';

// =============================================================================
// Mark Type Mapping
// =============================================================================

/** Map ChartConfig.type to the base MarkType for simple (non-layered) charts. */
export const MARK_TYPE_MAP: Record<ChartType, MarkType> = {
  bar: 'bar',
  column: 'bar',
  line: 'line',
  area: 'area',
  pie: 'arc',
  doughnut: 'arc',
  scatter: 'point',
  bubble: 'point',
  combo: 'bar', // default layer mark; combo uses layers
  radar: 'radar',
  stock: 'stockGlyph',
  funnel: 'bar',
  waterfall: 'bar',
  // 3D variants lower to path-based projected marks while preserving the shared ChartMark IR.
  bar3d: 'bar3d',
  column3d: 'bar3d',
  line3d: 'line3d',
  pie3d: 'arc3d',
  area3d: 'area3d',
  // Top-view surface charts are contour plots; 3-D surface charts project a surface mesh.
  surface: 'contour',
  surface3d: 'surface3d',
  ofPie: 'arc',
  // Statistical chart types
  histogram: 'histogram',
  boxplot: 'boxplot',
  heatmap: 'rect',
  violin: 'violin',
  pareto: 'bar',
  // Exploded pie variants (visual config, same base marks)
  pieExploded: 'arc',
  pie3dExploded: 'arc3d',
  doughnutExploded: 'arc',
  // Bubble with 3D effect
  bubble3DEffect: 'point',
  // Surface variants
  surfaceWireframe: 'surface3d',
  surfaceTopView: 'contour',
  surfaceTopViewWireframe: 'contour',
  // Line with markers variants
  lineMarkers: 'line',
  lineMarkersStacked: 'line',
  lineMarkersStacked100: 'line',
  // Decorative 3D bar shape variants.
  cylinderColClustered: 'bar3d',
  cylinderColStacked: 'bar3d',
  cylinderColStacked100: 'bar3d',
  cylinderBarClustered: 'bar3d',
  cylinderBarStacked: 'bar3d',
  cylinderBarStacked100: 'bar3d',
  cylinderCol: 'bar3d',
  coneColClustered: 'bar3d',
  coneColStacked: 'bar3d',
  coneColStacked100: 'bar3d',
  coneBarClustered: 'bar3d',
  coneBarStacked: 'bar3d',
  coneBarStacked100: 'bar3d',
  coneCol: 'bar3d',
  pyramidColClustered: 'bar3d',
  pyramidColStacked: 'bar3d',
  pyramidColStacked100: 'bar3d',
  pyramidBarClustered: 'bar3d',
  pyramidBarStacked: 'bar3d',
  pyramidBarStacked100: 'bar3d',
  pyramidCol: 'bar3d',
  // Hierarchical chart types
  treemap: 'rect',
  sunburst: 'arc',
  // Geographic chart types
  regionMap: 'rect',
};
