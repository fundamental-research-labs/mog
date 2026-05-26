/**
 * Heatmap Component
 *
 * Renders heatmaps (correlation matrices, grid visualizations).
 * Uses color encoding to represent values in a 2D grid.
 *
 * Features:
 * - Row and column categorical axes
 * - Sequential, diverging, or categorical color scales
 * - Optional cell labels
 * - Optional dendrograms for clustering
 */

import type { UnitSpec } from '../../grammar/spec';
import { correlation, max as maxValue, min as minValue } from '../../math/statistics';
import { getColorScheme, interpolateColor } from '../../primitives/scales/color';
import type { ColorSchemeName } from '../../primitives/scales/types';
import type { Mark, MarkStyle, RectMark, TextMark } from '../../primitives/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Data row format for heatmaps.
 * Can be either a flat format (x, y, value) or a matrix format.
 */
export interface HeatmapDataRow {
  [key: string]: unknown;
}

/**
 * Heatmap encoding specification.
 */
export interface HeatmapEncoding {
  /** Row field (y-axis category) */
  y?: { field: string; type?: 'ordinal' | 'nominal' };
  /** Column field (x-axis category) */
  x?: { field: string; type?: 'ordinal' | 'nominal' };
  /** Color field (the value to colorize) */
  color?: { field: string; type?: 'quantitative'; scale?: ColorScaleSpec };
}

/**
 * Color scale specification.
 */
export interface ColorScaleSpec {
  /** Color scheme name */
  scheme?: ColorScheme;
  /** Domain for the color scale */
  domain?: [number, number] | [number, number, number];
  /** Explicit range colors */
  range?: string[];
  /** Type of color scale */
  type?: 'sequential' | 'diverging' | 'threshold';
  /** For diverging scales, the midpoint */
  domainMid?: number;
}

/**
 * Built-in color schemes.
 */
export type ColorScheme =
  | 'blues'
  | 'greens'
  | 'greys'
  | 'oranges'
  | 'purples'
  | 'reds'
  | 'viridis'
  | 'inferno'
  | 'magma'
  | 'plasma'
  | 'warm'
  | 'cool'
  | 'rdylgn'
  | 'rdylbu'
  | 'rdbu'
  | 'spectral'
  | 'brbg'
  | 'piyg'
  | 'prgn';

/**
 * Heatmap configuration options.
 */
export interface HeatmapConfig {
  /** Whether to show cell value labels */
  showLabels?: boolean;
  /** Label format function or string format */
  labelFormat?: string | ((value: number) => string);
  /** Cell gap/padding as fraction (0-1) */
  cellGap?: number;
  /** Cell corner radius */
  cellRadius?: number;
  /** Whether to sort rows/columns by clustering */
  cluster?: boolean;
  /** Whether this is a correlation matrix (special formatting) */
  correlationMatrix?: boolean;
  /** Whether to show color scale legend */
  showLegend?: boolean;
}

/**
 * Heatmap spec conforming to grammar.
 */
export interface HeatmapSpec {
  mark: 'rect';
  data: { values: HeatmapDataRow[] };
  encoding: HeatmapEncoding;
  config?: HeatmapConfig;
}

/**
 * Layout information for rendering.
 */
export interface HeatmapLayout {
  chartArea: { x: number; y: number; width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
}

/**
 * Scale map for coordinate transformations.
 */
export interface HeatmapScales {
  x: (value: string) => number;
  y: (value: string) => number;
  color: (value: number) => string;
  xBandwidth?: () => number;
  yBandwidth?: () => number;
}

/**
 * Style configuration for heatmap label text.
 */
export interface HeatmapLabelStyle extends MarkStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | number;
  textAlign?: 'left' | 'center' | 'right';
  textBaseline?: 'top' | 'middle' | 'bottom';
}

/**
 * Style configuration for heatmap elements.
 */
export interface HeatmapStyles {
  cell?: MarkStyle;
  label?: HeatmapLabelStyle;
}

/**
 * Processed heatmap cell data.
 */
export interface HeatmapCellData {
  x: string;
  y: string;
  value: number;
  color: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: Required<HeatmapConfig> = {
  showLabels: false,
  labelFormat: '.2f',
  cellGap: 0.02,
  cellRadius: 0,
  cluster: false,
  correlationMatrix: false,
  showLegend: true,
};

const DEFAULT_STYLES: Required<HeatmapStyles> = {
  cell: {
    strokeWidth: 1,
    opacity: 1,
  },
  label: {
    fill: '#ffffff',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 10,
    fontWeight: 'normal',
    textAlign: 'center',
    textBaseline: 'middle',
  },
};

// =============================================================================
// Color Scale Utilities
// =============================================================================

/**
 * RdBu color scheme - not in the shared scales/color.ts registry.
 * Kept here for backward compat until the scales registry adds it.
 */
const RDBU_FALLBACK: string[] = ['#b2182b', '#f7f7f7', '#2166ac'];

/**
 * Resolve a ColorScheme name to its color array.
 * Uses the canonical multi-stop schemes from scales/color.ts when available,
 * falling back to a 3-stop RdBu definition for the one scheme not in the registry.
 */
function resolveColorScheme(scheme: ColorScheme): string[] {
  if (scheme === 'rdbu') return RDBU_FALLBACK;
  return getColorScheme(scheme as ColorSchemeName);
}

/**
 * Create a color scale function.
 * Uses OKLab perceptually uniform interpolation from scales/color.ts.
 */
export function createColorScale(
  domain: [number, number] | [number, number, number],
  scheme: ColorScheme = 'blues',
  type: 'sequential' | 'diverging' = 'sequential',
): (value: number) => string {
  const colors = resolveColorScheme(scheme);

  if (type === 'diverging' && domain.length === 3) {
    const [min, mid, max] = domain;

    return (value: number) => {
      if (value <= min) return colors[0];
      if (value >= max) return colors[colors.length - 1];

      if (value < mid) {
        // Interpolate between colors[0] and colors[1]
        const t = (value - min) / (mid - min);
        return interpolateColor(colors[0], colors[1], t);
      } else {
        // Interpolate between colors[1] and colors[2]
        const t = (value - mid) / (max - mid);
        return interpolateColor(colors[1], colors[colors.length - 1], t);
      }
    };
  }

  // Sequential scale
  const [min, max] = domain;

  return (value: number) => {
    if (value <= min) return colors[0];
    if (value >= max) return colors[colors.length - 1];

    const t = (value - min) / (max - min);
    const segment = t * (colors.length - 1);
    const index = Math.floor(segment);
    const localT = segment - index;

    if (index >= colors.length - 1) {
      return colors[colors.length - 1];
    }

    return interpolateColor(colors[index], colors[index + 1], localT);
  };
}

// =============================================================================
// Heatmap Builder (Fluent API)
// =============================================================================

/**
 * Fluent builder for creating heatmap specifications.
 *
 * @example
 * const spec = Heatmap()
 *   .data(correlationData)
 *   .x('variable1')
 *   .y('variable2')
 *   .color('correlation')
 *   .colorScale('rdbu')
 *   .showLabels()
 *   .toSpec();
 */
export class HeatmapBuilder {
  private _data: HeatmapDataRow[] = [];
  private _encoding: HeatmapEncoding = {};
  private _config: HeatmapConfig = {};

  /**
   * Set the data source.
   */
  data(values: HeatmapDataRow[]): this {
    this._data = values;
    return this;
  }

  /**
   * Set the x-axis (column) field.
   */
  x(field: string): this {
    this._encoding.x = { field, type: 'ordinal' };
    return this;
  }

  /**
   * Set the y-axis (row) field.
   */
  y(field: string): this {
    this._encoding.y = { field, type: 'ordinal' };
    return this;
  }

  /**
   * Set the color (value) field.
   */
  color(field: string): this {
    this._encoding.color = { field, type: 'quantitative' };
    return this;
  }

  /**
   * Set the color scheme.
   */
  colorScheme(scheme: ColorScheme): this {
    if (!this._encoding.color) {
      this._encoding.color = { field: 'value', type: 'quantitative' };
    }
    this._encoding.color.scale = {
      ...this._encoding.color.scale,
      scheme,
    };
    return this;
  }

  /**
   * Set a diverging color scale with custom domain.
   */
  divergingScale(min: number, mid: number, max: number): this {
    if (!this._encoding.color) {
      this._encoding.color = { field: 'value', type: 'quantitative' };
    }
    this._encoding.color.scale = {
      ...this._encoding.color.scale,
      type: 'diverging',
      domain: [min, mid, max],
    };
    return this;
  }

  /**
   * Enable cell value labels.
   */
  showLabels(enabled: boolean = true): this {
    this._config.showLabels = enabled;
    return this;
  }

  /**
   * Set label format.
   */
  labelFormat(format: string | ((value: number) => string)): this {
    this._config.labelFormat = format;
    return this;
  }

  /**
   * Set cell gap/padding.
   */
  cellGap(gap: number): this {
    this._config.cellGap = Math.max(0, Math.min(0.5, gap));
    return this;
  }

  /**
   * Set cell corner radius.
   */
  cellRadius(radius: number): this {
    this._config.cellRadius = Math.max(0, radius);
    return this;
  }

  /**
   * Mark as correlation matrix.
   */
  correlationMatrix(enabled: boolean = true): this {
    this._config.correlationMatrix = enabled;
    return this;
  }

  /**
   * Generate the chart specification (custom HeatmapSpec format).
   */
  toSpec(): HeatmapSpec {
    return {
      mark: 'rect',
      data: { values: this._data },
      encoding: this._encoding,
      config: this._config,
    };
  }

  /**
   * Generate a standard ChartSpec compatible with the grammar compiler.
   *
   * Returns a UnitSpec with mark: 'rect' and standard EncodingSpec
   * that can be passed directly to compile(). The 'rect' mark with
   * x/y ordinal encodings and color quantitative encoding produces
   * a heatmap visualization.
   *
   * @example
   * ```ts
   * const spec = Heatmap().data(myData).x('col').y('row').color('value').toChartSpec();
   * const result = compile(spec);
   * ```
   */
  toChartSpec(): UnitSpec {
    const spec: UnitSpec = {
      mark: 'rect',
      data: { values: this._data },
      encoding: {},
    };

    if (this._encoding.x) {
      spec.encoding!.x = {
        field: this._encoding.x.field,
        type: this._encoding.x.type ?? 'ordinal',
      };
    }

    if (this._encoding.y) {
      spec.encoding!.y = {
        field: this._encoding.y.field,
        type: this._encoding.y.type ?? 'ordinal',
      };
    }

    if (this._encoding.color) {
      spec.encoding!.color = {
        field: this._encoding.color.field,
        type: this._encoding.color.type ?? 'quantitative',
      };
    }

    return spec;
  }
}

/**
 * Create a new Heatmap builder.
 */
export function Heatmap(): HeatmapBuilder {
  return new HeatmapBuilder();
}

// =============================================================================
// Correlation Matrix Helper
// =============================================================================

/**
 * Create a correlation matrix from columnar data.
 *
 * @param data - Array of data rows
 * @param fields - Array of field names to include in the correlation matrix
 * @returns Array of {x, y, value} for heatmap
 */
export function createCorrelationMatrix(
  data: HeatmapDataRow[],
  fields: string[],
): Array<{ x: string; y: string; value: number }> {
  const result: Array<{ x: string; y: string; value: number }> = [];

  for (const fieldY of fields) {
    for (const fieldX of fields) {
      // Extract values for both fields
      const valuesX: number[] = [];
      const valuesY: number[] = [];

      for (const row of data) {
        const vx = row[fieldX];
        const vy = row[fieldY];
        if (typeof vx === 'number' && typeof vy === 'number') {
          valuesX.push(vx);
          valuesY.push(vy);
        }
      }

      // Calculate correlation
      const corr = fieldX === fieldY ? 1 : correlation(valuesX, valuesY);

      result.push({
        x: fieldX,
        y: fieldY,
        value: isNaN(corr) ? 0 : corr,
      });
    }
  }

  return result;
}

// =============================================================================
// Data Processing
// =============================================================================

/**
 * Process heatmap data into cell data.
 */
export function processHeatmapData(
  data: HeatmapDataRow[],
  encoding: HeatmapEncoding,
  colorScale: (value: number) => string,
): HeatmapCellData[] {
  const xField = encoding.x?.field;
  const yField = encoding.y?.field;
  const colorField = encoding.color?.field;

  if (!xField || !yField || !colorField) {
    return [];
  }

  return data
    .filter((row) => {
      const value = row[colorField];
      return typeof value === 'number' && isFinite(value);
    })
    .map((row) => ({
      x: String(row[xField]),
      y: String(row[yField]),
      value: row[colorField] as number,
      color: colorScale(row[colorField] as number),
    }));
}

/**
 * Extract unique categories from data.
 */
export function extractCategories(data: HeatmapDataRow[], field: string): string[] {
  const categories = new Set<string>();
  for (const row of data) {
    const value = row[field];
    if (value !== undefined && value !== null) {
      categories.add(String(value));
    }
  }
  return Array.from(categories).sort();
}

/**
 * Calculate value domain from data.
 */
export function calculateDomain(
  data: HeatmapDataRow[],
  field: string,
  type: 'sequential' | 'diverging' = 'sequential',
): [number, number] | [number, number, number] {
  const values = data
    .map((row) => row[field])
    .filter((v): v is number => typeof v === 'number' && isFinite(v));

  if (values.length === 0) {
    return type === 'diverging' ? [-1, 0, 1] : [0, 1];
  }

  const min = minValue(values);
  const max = maxValue(values);

  if (type === 'diverging') {
    // For diverging scales, use symmetric domain around 0 or the midpoint
    const absMax = Math.max(Math.abs(min), Math.abs(max));
    return [-absMax, 0, absMax];
  }

  return [min, max];
}

// =============================================================================
// Mark Generation
// =============================================================================

/**
 * Format cell value for label display.
 */
function formatValue(value: number, format: string | ((value: number) => string)): string {
  if (typeof format === 'function') {
    return format(value);
  }

  // Parse format string (simplified - supports .Nf)
  const match = format.match(/\.(\d+)f/);
  if (match) {
    return value.toFixed(parseInt(match[1], 10));
  }

  return String(value);
}

/**
 * Determine label color based on background.
 */
function getLabelColor(backgroundColor: string): string {
  // Parse RGB color
  const rgbMatch = backgroundColor.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  const hexMatch = backgroundColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);

  let r = 128,
    g = 128,
    b = 128;

  if (rgbMatch) {
    r = parseInt(rgbMatch[1], 10);
    g = parseInt(rgbMatch[2], 10);
    b = parseInt(rgbMatch[3], 10);
  } else if (hexMatch) {
    r = parseInt(hexMatch[1], 16);
    g = parseInt(hexMatch[2], 16);
    b = parseInt(hexMatch[3], 16);
  }

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Use white text for dark backgrounds, black for light
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Generate marks for rendering a heatmap.
 */
export function generateHeatmapMarks(
  data: HeatmapDataRow[],
  encoding: HeatmapEncoding,
  scales: HeatmapScales,
  layout: HeatmapLayout,
  config: HeatmapConfig = {},
  styles: HeatmapStyles = {},
): Mark[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const stl = {
    cell: { ...DEFAULT_STYLES.cell, ...styles.cell },
    label: { ...DEFAULT_STYLES.label, ...styles.label },
  };

  const xField = encoding.x?.field;
  const yField = encoding.y?.field;
  const colorField = encoding.color?.field;

  if (!xField || !yField || !colorField) {
    return [];
  }

  // Process data
  const cellData = processHeatmapData(data, encoding, scales.color);
  const marks: Mark[] = [];

  // Get cell dimensions
  const cellWidth = scales.xBandwidth?.() ?? 50;
  const cellHeight = scales.yBandwidth?.() ?? 50;
  const gapX = cellWidth * cfg.cellGap;
  const gapY = cellHeight * cfg.cellGap;

  for (const cell of cellData) {
    const x = scales.x(cell.x);
    const y = scales.y(cell.y);

    // Create cell rectangle
    const cellMark: RectMark = {
      type: 'rect',
      x: x + gapX / 2,
      y: y + gapY / 2,
      width: cellWidth - gapX,
      height: cellHeight - gapY,
      style: {
        ...stl.cell,
        fill: cell.color,
        cornerRadius: cfg.cellRadius,
      },
      datum: { x: cell.x, y: cell.y, value: cell.value },
    };
    marks.push(cellMark);

    // Add label if requested
    if (cfg.showLabels) {
      const labelColor = getLabelColor(cell.color);
      const labelText = formatValue(cell.value, cfg.labelFormat);

      const labelMark: TextMark = {
        type: 'text',
        x: x + cellWidth / 2,
        y: y + cellHeight / 2,
        text: labelText,
        fontFamily: stl.label.fontFamily ?? 'system-ui, sans-serif',
        fontSize: stl.label.fontSize ?? 10,
        fontWeight: stl.label.fontWeight,
        textAlign: 'center',
        textBaseline: 'middle',
        style: {
          fill: labelColor,
          opacity: stl.label.opacity,
        },
        datum: { x: cell.x, y: cell.y, value: cell.value },
      };
      marks.push(labelMark);
    }
  }

  return marks;
}

// =============================================================================
// Compile Heatmap Spec to Marks
// =============================================================================

/**
 * Compile a heatmap specification into renderable marks.
 * This is the main entry point for the grammar compiler.
 */
export function compileHeatmap(
  spec: HeatmapSpec,
  scales: HeatmapScales,
  layout: HeatmapLayout,
  styles?: HeatmapStyles,
): Mark[] {
  return generateHeatmapMarks(spec.data.values, spec.encoding, scales, layout, spec.config, styles);
}
