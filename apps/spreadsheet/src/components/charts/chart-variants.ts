/**
 * Chart Variant Definitions
 *
 * Defines all chart subtypes for Excel 365 parity. Each chart category
 * (column, line, pie, etc.) has multiple variants that users can choose from.
 *
 * These definitions power:
 * - ChartGallery dropdown UI
 * - ChartVariantThumbnail previews
 * - Chart insertion with correct subtype
 *
 * @module components/charts/chart-variants
 */

import type {
  AreaSubType,
  BarSubType,
  ChartType,
  LineSubType,
  RadarSubType,
  StockSubType,
} from '@mog/charts';

// =============================================================================
// Types
// =============================================================================

/**
 * Combined subtype for all chart variants
 */
export type ChartSubType =
  | BarSubType
  | LineSubType
  | AreaSubType
  | RadarSubType
  | StockSubType
  | 'standard'
  | 'smooth'
  | 'marker';

/**
 * A single chart variant within a category
 */
export interface ChartVariant {
  /** Unique identifier for this variant */
  id: string;
  /** Display label */
  label: string;
  /** Short description for tooltip */
  description: string;
  /** The base chart type */
  type: ChartType;
  /** Optional subtype (clustered, stacked, etc.) */
  subType?: ChartSubType;
  /** Additional configuration for this variant */
  config?: Record<string, unknown>;
}

/**
 * A category of charts (Column, Line, etc.)
 */
export interface ChartCategory {
  /** Category identifier (matches ChartType) */
  id: ChartType;
  /** Display label for the button */
  label: string;
  /** Tooltip description */
  description: string;
  /** Available variants in this category */
  variants: ChartVariant[];
}

// =============================================================================
// Chart Categories with Variants (Excel 365 parity)
// =============================================================================

/**
 * Column chart variants
 * Excel has: Clustered, Stacked, 100% Stacked, 3D variants
 */
export const COLUMN_VARIANTS: ChartVariant[] = [
  {
    id: 'column-clustered',
    label: 'Clustered Column',
    description: 'Compare values across categories',
    type: 'column',
    subType: 'clustered',
  },
  {
    id: 'column-stacked',
    label: 'Stacked Column',
    description: 'Show composition and comparison',
    type: 'column',
    subType: 'stacked',
  },
  {
    id: 'column-100-stacked',
    label: '100% Stacked Column',
    description: 'Compare percentage contribution',
    type: 'column',
    subType: 'percentStacked',
  },
];

/**
 * Bar chart variants (horizontal column)
 */
export const BAR_VARIANTS: ChartVariant[] = [
  {
    id: 'bar-clustered',
    label: 'Clustered Bar',
    description: 'Horizontal comparison',
    type: 'bar',
    subType: 'clustered',
  },
  {
    id: 'bar-stacked',
    label: 'Stacked Bar',
    description: 'Show composition horizontally',
    type: 'bar',
    subType: 'stacked',
  },
  {
    id: 'bar-100-stacked',
    label: '100% Stacked Bar',
    description: 'Compare percentage horizontally',
    type: 'bar',
    subType: 'percentStacked',
  },
];

/**
 * Line chart variants
 * Includes stacked variants (D.12)
 */
export const LINE_VARIANTS: ChartVariant[] = [
  {
    id: 'line-straight',
    label: 'Line',
    description: 'Show trends over time',
    type: 'line',
    subType: 'straight',
  },
  {
    id: 'line-smooth',
    label: 'Smooth Line',
    description: 'Smoothed trend line',
    type: 'line',
    subType: 'smooth',
  },
  {
    id: 'line-markers',
    label: 'Line with Markers',
    description: 'Line with data point markers',
    type: 'line',
    subType: 'straight',
    config: { showMarkers: true },
  },
  {
    id: 'line-stepped',
    label: 'Stepped Line',
    description: 'Show discrete changes',
    type: 'line',
    subType: 'stepped',
  },
  {
    id: 'line-stacked',
    label: 'Stacked Line',
    description: 'Show cumulative trends',
    type: 'line',
    subType: 'stacked',
  },
  {
    id: 'line-100-stacked',
    label: '100% Stacked Line',
    description: 'Show percentage trends over time',
    type: 'line',
    subType: 'percentStacked',
  },
];

/**
 * Area chart variants
 */
export const AREA_VARIANTS: ChartVariant[] = [
  {
    id: 'area-standard',
    label: 'Area',
    description: 'Show magnitude over time',
    type: 'area',
    subType: 'standard',
  },
  {
    id: 'area-stacked',
    label: 'Stacked Area',
    description: 'Show cumulative magnitude',
    type: 'area',
    subType: 'stacked',
  },
  {
    id: 'area-100-stacked',
    label: '100% Stacked Area',
    description: 'Show percentage contribution over time',
    type: 'area',
    subType: 'percentStacked',
  },
];

/**
 * Pie chart variants
 */
export const PIE_VARIANTS: ChartVariant[] = [
  {
    id: 'pie-standard',
    label: 'Pie',
    description: 'Show parts of a whole',
    type: 'pie',
  },
  {
    id: 'doughnut',
    label: 'Doughnut',
    description: 'Pie with center hole',
    type: 'doughnut',
  },
];

/**
 * Scatter chart variants
 */
export const SCATTER_VARIANTS: ChartVariant[] = [
  {
    id: 'scatter-points',
    label: 'Scatter',
    description: 'Show correlation between values',
    type: 'scatter',
  },
  {
    id: 'scatter-lines',
    label: 'Scatter with Lines',
    description: 'Connected scatter points',
    type: 'scatter',
    config: { showLines: true },
  },
  {
    id: 'scatter-smooth-lines',
    label: 'Scatter with Smooth Lines',
    description: 'Connected scatter points with smooth curves',
    type: 'scatter',
    config: { showLines: true, smoothLines: true },
  },
  {
    id: 'bubble',
    label: 'Bubble',
    description: 'Three-dimensional scatter',
    type: 'bubble',
  },
];

/**
 * Combo chart variants
 */
export const COMBO_VARIANTS: ChartVariant[] = [
  {
    id: 'combo-column-line',
    label: 'Column & Line',
    description: 'Mix columns and lines',
    type: 'combo',
  },
];

/**
 * Radar chart variants (D.8)
 */
export const RADAR_VARIANTS: ChartVariant[] = [
  {
    id: 'radar-basic',
    label: 'Radar',
    description: 'Compare multiple variables',
    type: 'radar',
    subType: 'basic',
  },
  {
    id: 'radar-filled',
    label: 'Filled Radar',
    description: 'Radar with filled area',
    type: 'radar',
    subType: 'filled',
    config: { radarFilled: true },
  },
  {
    id: 'radar-markers',
    label: 'Radar with Markers',
    description: 'Radar with data point markers',
    type: 'radar',
    subType: 'markers',
    config: { radarMarkers: true },
  },
];

/**
 * Stock chart variants (D.9)
 * OHLC = Open-High-Low-Close, HLC = High-Low-Close
 */
export const STOCK_VARIANTS: ChartVariant[] = [
  {
    id: 'stock-ohlc',
    label: 'OHLC',
    description: 'Open-High-Low-Close candlestick',
    type: 'stock',
    subType: 'ohlc',
  },
  {
    id: 'stock-hlc',
    label: 'HLC',
    description: 'High-Low-Close bars',
    type: 'stock',
    subType: 'hlc',
  },
  {
    id: 'stock-volume-ohlc',
    label: 'OHLC with Volume',
    description: 'Candlestick with volume bars',
    type: 'stock',
    subType: 'volume-ohlc',
  },
  {
    id: 'stock-volume-hlc',
    label: 'HLC with Volume',
    description: 'HLC with volume bars',
    type: 'stock',
    subType: 'volume-hlc',
  },
];

/**
 * Funnel chart variants (D.10)
 */
export const FUNNEL_VARIANTS: ChartVariant[] = [
  {
    id: 'funnel-standard',
    label: 'Funnel',
    description: 'Show conversion pipeline',
    type: 'funnel',
  },
];

/**
 * Waterfall chart variants (D.11)
 */
export const WATERFALL_VARIANTS: ChartVariant[] = [
  {
    id: 'waterfall-standard',
    label: 'Waterfall',
    description: 'Show cumulative effect of changes',
    type: 'waterfall',
  },
];

/**
 * Treemap chart variants
 */
export const TREEMAP_VARIANTS: ChartVariant[] = [
  {
    id: 'treemap-standard',
    label: 'Treemap',
    description: 'Show hierarchical data as nested rectangles',
    type: 'treemap',
  },
];

/**
 * Sunburst chart variants
 */
export const SUNBURST_VARIANTS: ChartVariant[] = [
  {
    id: 'sunburst-standard',
    label: 'Sunburst',
    description: 'Show hierarchical data as concentric rings',
    type: 'sunburst',
  },
];

/**
 * Region map chart variants
 */
export const REGION_MAP_VARIANTS: ChartVariant[] = [
  {
    id: 'regionmap-standard',
    label: 'Region Map',
    description: 'Show data values on a geographic map',
    type: 'regionMap',
  },
];

/**
 * Surface chart variants
 */
export const SURFACE_VARIANTS: ChartVariant[] = [
  {
    id: 'surface-standard',
    label: 'Surface',
    description: 'Show values as a 3D surface',
    type: 'surface',
  },
  {
    id: 'surface-wireframe',
    label: 'Wireframe Surface',
    description: 'Show a wireframe surface',
    type: 'surfaceWireframe',
  },
  {
    id: 'surface-top-view',
    label: 'Contour',
    description: 'Show surface from above',
    type: 'surfaceTopView',
  },
  {
    id: 'surface-top-view-wireframe',
    label: 'Wireframe Contour',
    description: 'Show wireframe surface from above',
    type: 'surfaceTopViewWireframe',
  },
];

/**
 * Statistical chart variants
 */
export const HISTOGRAM_VARIANTS: ChartVariant[] = [
  {
    id: 'histogram-standard',
    label: 'Histogram',
    description: 'Show distribution bins',
    type: 'histogram',
  },
];

// =============================================================================
// All Chart Categories
// =============================================================================

/**
 * All chart categories with their variants.
 * Order matches Excel 365 ribbon (Column, Line, Pie, Bar, Area, Scatter, Combo, then specialized)
 */
export const CHART_CATEGORIES: ChartCategory[] = [
  {
    id: 'column',
    label: 'Column',
    description: 'Compare values across categories',
    variants: COLUMN_VARIANTS,
  },
  {
    id: 'line',
    label: 'Line',
    description: 'Show trends over time',
    variants: LINE_VARIANTS,
  },
  {
    id: 'pie',
    label: 'Pie',
    description: 'Show parts of a whole',
    variants: PIE_VARIANTS,
  },
  {
    id: 'bar',
    label: 'Bar',
    description: 'Horizontal comparison',
    variants: BAR_VARIANTS,
  },
  {
    id: 'area',
    label: 'Area',
    description: 'Show magnitude over time',
    variants: AREA_VARIANTS,
  },
  {
    id: 'scatter',
    label: 'Scatter',
    description: 'Show relationships between values',
    variants: SCATTER_VARIANTS,
  },
  {
    id: 'combo',
    label: 'Combo',
    description: 'Mix chart types',
    variants: COMBO_VARIANTS,
  },
  // New chart types
  {
    id: 'radar',
    label: 'Radar',
    description: 'Compare multiple variables',
    variants: RADAR_VARIANTS,
  },
  {
    id: 'stock',
    label: 'Stock',
    description: 'Financial OHLC/HLC charts',
    variants: STOCK_VARIANTS,
  },
  {
    id: 'funnel',
    label: 'Funnel',
    description: 'Show conversion pipeline',
    variants: FUNNEL_VARIANTS,
  },
  {
    id: 'waterfall',
    label: 'Waterfall',
    description: 'Show cumulative effect of changes',
    variants: WATERFALL_VARIANTS,
  },
  {
    id: 'treemap',
    label: 'Treemap',
    description: 'Show hierarchical data as nested rectangles',
    variants: TREEMAP_VARIANTS,
  },
  {
    id: 'sunburst',
    label: 'Sunburst',
    description: 'Show hierarchical data as concentric rings',
    variants: SUNBURST_VARIANTS,
  },
  {
    id: 'regionMap',
    label: 'Region Map',
    description: 'Show data values on a geographic map',
    variants: REGION_MAP_VARIANTS,
  },
  {
    id: 'histogram',
    label: 'Histogram',
    description: 'Show distribution bins',
    variants: HISTOGRAM_VARIANTS,
  },
  {
    id: 'surface',
    label: 'Surface',
    description: 'Show matrix values as a surface',
    variants: SURFACE_VARIANTS,
  },
];

/**
 * Get the default variant for a chart type
 */
export function getDefaultVariant(type: ChartType): ChartVariant | undefined {
  const category = CHART_CATEGORIES.find((c) => c.id === type);
  return category?.variants[0];
}

/**
 * Get a specific variant by ID
 */
export function getVariantById(variantId: string): ChartVariant | undefined {
  for (const category of CHART_CATEGORIES) {
    const variant = category.variants.find((v) => v.id === variantId);
    if (variant) return variant;
  }
  return undefined;
}
