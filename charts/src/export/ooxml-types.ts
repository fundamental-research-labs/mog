/**
 * OOXML Type Definitions for Excel Chart Export
 *
 * These types define the structure of Excel-compatible chart XML elements.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Pure types only - no runtime code (except the DEFAULT_CHART_COLORS constant).
 */

import type { CompileResult } from '../grammar/compiler';

// =============================================================================
// Export Result Types
// =============================================================================

/**
 * Result of OOXML chart export.
 */
export interface OOXMLExportResult {
  /** Contents of xl/charts/chartN.xml */
  chartXml: string;
  /** Drawing relationship XML if needed */
  drawingXml?: string;
  /** Color scheme XML if custom colors used */
  colorsXml?: string;
}

/**
 * Result when using image fallback for unsupported chart types.
 */
export interface ImageFallbackResult {
  /** Indicates this is an image fallback */
  type: 'image';
  /** Image data as bytes */
  imageData: Uint8Array;
  /** MIME type (always PNG for now) */
  mimeType: 'image/png';
  /** Suggested path within XLSX package */
  path: string;
}

// =============================================================================
// Export Options
// =============================================================================

/**
 * Options for OOXML export.
 */
export interface ExportOptions {
  /** Chart index (for naming chartN.xml) */
  chartId?: number;
  /** Sheet ID for data references */
  sheetId?: string;
  /** Sheet name for data references (default: 'Sheet1') */
  sheetName?: string;
  /**
   * Pre-computed CompileResult from the grammar compiler.
   * When provided, the export pipeline can use the already-computed scale
   * domains and series structure instead of recomputing them from scratch.
   */
  compileResult?: CompileResult;
}

// =============================================================================
// Chart XML Options
// =============================================================================

/**
 * Options for wrapping chart content in chartSpace element.
 */
export interface ChartXMLOptions {
  /** Chart title */
  title?: string | { text: string; fontSize?: number; bold?: boolean };
  /** Axis XML strings to include */
  axes?: string[];
  /** Legend configuration */
  legend?: LegendPosition;
}

/**
 * Legend position configuration for OOXML.
 */
export interface LegendPosition {
  /** Position: 'b' (bottom), 't' (top), 'l' (left), 'r' (right), 'tr' (top-right) */
  position: 'b' | 't' | 'l' | 'r' | 'tr';
  /** Whether legend overlays the chart */
  overlay?: boolean;
}

// =============================================================================
// Series Data Types
// =============================================================================

/**
 * Extracted series data for chart generation.
 */
export interface SeriesData {
  /** Series name (for legend) */
  name: string;
  /** Category values (x-axis labels) */
  categories: (string | number | Date)[];
  /** Data values (y-axis values) */
  values: number[];
  /** Series color (hex without #) */
  color: string;
  /** Optional sizes for bubble charts */
  sizes?: number[];
}

/**
 * Extracted data point for scatter/XY charts.
 */
export interface XYPoint {
  x: number;
  y: number;
  /** Optional size for bubble charts */
  size?: number;
}

/**
 * Series data for scatter charts.
 */
export interface ScatterSeriesData {
  /** Series name */
  name: string;
  /** XY data points */
  points: XYPoint[];
  /** Series color (hex without #) */
  color: string;
}

// =============================================================================
// Axis Types
// =============================================================================

/**
 * Category axis configuration.
 */
export interface CategoryAxisConfig {
  /** Axis title */
  title?: string;
  /** Axis position: 'b' (bottom), 't' (top), 'l' (left), 'r' (right) */
  position?: 'b' | 't' | 'l' | 'r';
  /** Show axis labels */
  showLabels?: boolean;
  /** Label rotation angle in degrees */
  labelAngle?: number;
  /** Show gridlines */
  showGrid?: boolean;
}

/**
 * Value axis configuration.
 */
export interface ValueAxisConfig {
  /** Axis title */
  title?: string;
  /** Axis position: 'b' (bottom), 't' (top), 'l' (left), 'r' (right) */
  position?: 'b' | 't' | 'l' | 'r';
  /** Number format (Excel format code) */
  format?: string;
  /** Minimum value (null for auto) */
  min?: number | null;
  /** Maximum value (null for auto) */
  max?: number | null;
  /** Show gridlines */
  showGrid?: boolean;
}

/**
 * Date axis configuration.
 */
export interface DateAxisConfig {
  /** Axis title */
  title?: string;
  /** Date unit: 'days', 'months', 'years' */
  unit?: 'days' | 'months' | 'years';
  /** Show gridlines */
  showGrid?: boolean;
}

// =============================================================================
// Color Types
// =============================================================================

/**
 * Default color palette for charts (Excel's default accent colors).
 */
export const DEFAULT_CHART_COLORS = [
  '4472C4', // Blue
  'ED7D31', // Orange
  'A5A5A5', // Gray
  'FFC000', // Gold
  '5B9BD5', // Light blue
  '70AD47', // Green
  '264478', // Dark blue
  '9E480E', // Dark orange
  '636363', // Dark gray
  '997300', // Dark gold
  '255E91', // Steel blue
  '43682B', // Dark green
] as const;

/**
 * Theme color reference for OOXML.
 */
export interface ThemeColor {
  /** Scheme color value */
  val:
    | 'accent1'
    | 'accent2'
    | 'accent3'
    | 'accent4'
    | 'accent5'
    | 'accent6'
    | 'dk1'
    | 'lt1'
    | 'tx1'
    | 'bg1';
  /** Luminance modifier (percentage) */
  lumMod?: number;
  /** Luminance offset (percentage) */
  lumOff?: number;
}

// =============================================================================
// Bar Chart Specific Types
// =============================================================================

/**
 * Bar chart direction.
 */
export type BarDirection = 'col' | 'bar';

/**
 * Bar chart grouping mode.
 */
export type BarGrouping = 'clustered' | 'stacked' | 'percentStacked' | 'standard';

// =============================================================================
// Line Chart Specific Types
// =============================================================================

/**
 * Line chart grouping mode.
 */
export type LineGrouping = 'standard' | 'stacked' | 'percentStacked';

// =============================================================================
// Scatter Chart Specific Types
// =============================================================================

/**
 * Scatter chart style.
 */
export type ScatterStyle = 'lineMarker' | 'line' | 'marker' | 'smooth' | 'smoothMarker';

// =============================================================================
// Data Label Types
// =============================================================================

/**
 * Data label configuration.
 */
export interface DataLabelConfig {
  /** Show legend key */
  showLegendKey?: boolean;
  /** Show value */
  showVal?: boolean;
  /** Show category name */
  showCatName?: boolean;
  /** Show series name */
  showSerName?: boolean;
  /** Show percentage (pie/doughnut) */
  showPercent?: boolean;
  /** Show bubble size */
  showBubbleSize?: boolean;
}

// =============================================================================
// Trendline Types
// =============================================================================

/**
 * Trendline type.
 */
export type TrendlineType = 'linear' | 'exp' | 'log' | 'poly' | 'power' | 'movingAvg';

/**
 * Trendline configuration.
 */
export interface TrendlineConfig {
  /** Trendline type */
  type: TrendlineType;
  /** Polynomial order (for poly type) */
  order?: number;
  /** Moving average period */
  period?: number;
  /** Display equation on chart */
  dispEq?: boolean;
  /** Display R-squared value */
  dispRSqr?: boolean;
  /** Forward projection periods */
  forward?: number;
  /** Backward projection periods */
  backward?: number;
}
