import type { MarkType } from '../../grammar/spec';
import type { ChartType } from '../../types';

// =============================================================================
// Layout Constants
// =============================================================================

/** Default column width in pixels, used to convert cell-unit width to pixels. */
export const PIXELS_PER_COLUMN = 80;

/** Default row height in pixels, used to convert cell-unit height to pixels. */
export const PIXELS_PER_ROW = 20;

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
  radar: 'line',
  stock: 'rule', // stock uses rule marks for OHLC ranges
  funnel: 'bar',
  waterfall: 'bar',
  // 3D variants map to same marks as 2D counterparts (3D is visual-only in grammar)
  bar3d: 'bar',
  column3d: 'bar',
  line3d: 'line',
  pie3d: 'arc',
  area3d: 'area',
  // Surface and ofPie have no grammar equivalents yet; use placeholder marks
  surface: 'rect',
  surface3d: 'rect',
  ofPie: 'arc',
  // Statistical chart types
  histogram: 'histogram',
  boxplot: 'boxplot',
  heatmap: 'rect',
  violin: 'violin',
  pareto: 'bar',
  // Exploded pie variants (visual config, same base marks)
  pieExploded: 'arc',
  pie3dExploded: 'arc',
  doughnutExploded: 'arc',
  // Bubble with 3D effect
  bubble3DEffect: 'point',
  // Surface variants
  surfaceWireframe: 'rect',
  surfaceTopView: 'rect',
  surfaceTopViewWireframe: 'rect',
  // Line with markers variants
  lineMarkers: 'line',
  lineMarkersStacked: 'line',
  lineMarkersStacked100: 'line',
  // Decorative 3D bar shape variants - all map to bar marks
  cylinderColClustered: 'bar',
  cylinderColStacked: 'bar',
  cylinderColStacked100: 'bar',
  cylinderBarClustered: 'bar',
  cylinderBarStacked: 'bar',
  cylinderBarStacked100: 'bar',
  cylinderCol: 'bar',
  coneColClustered: 'bar',
  coneColStacked: 'bar',
  coneColStacked100: 'bar',
  coneBarClustered: 'bar',
  coneBarStacked: 'bar',
  coneBarStacked100: 'bar',
  coneCol: 'bar',
  pyramidColClustered: 'bar',
  pyramidColStacked: 'bar',
  pyramidColStacked100: 'bar',
  pyramidBarClustered: 'bar',
  pyramidBarStacked: 'bar',
  pyramidBarStacked100: 'bar',
  pyramidCol: 'bar',
  // Hierarchical chart types
  treemap: 'rect',
  sunburst: 'arc',
  // Geographic chart types
  regionMap: 'rect',
};
