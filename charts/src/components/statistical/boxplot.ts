/**
 * Box Plot Component
 *
 * Renders box-and-whisker plots for visualizing statistical distributions.
 * Shows quartiles, median, whiskers (within 1.5*IQR), and outliers.
 *
 * Features:
 * - Single or grouped box plots
 * - Horizontal or vertical orientation
 * - Outlier detection and display
 * - Optional notched boxes
 */

import type { UnitSpec } from '../../grammar/spec';
import { boxPlotWhiskerPaths, type BoxPlotGeometry } from '../../math/geometry';
import { max as maxValue, min as minValue, outlierBounds, quartiles } from '../../math/statistics';
import type { Mark, MarkStyle, PathMark, RectMark, SymbolMark } from '../../primitives/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Data row format for box plots.
 */
export interface BoxPlotDataRow {
  [key: string]: unknown;
}

/**
 * Box plot encoding specification.
 */
export interface BoxPlotEncoding {
  /** Field containing numeric values to plot */
  y?: { field: string; type?: 'quantitative' };
  /** Optional category field for grouped box plots */
  x?: { field: string; type?: 'nominal' | 'ordinal' };
}

/**
 * Box plot configuration options.
 */
export interface BoxPlotConfig {
  /** Box width as fraction of available space (0-1) */
  boxWidth?: number;
  /** Whether to show outliers */
  showOutliers?: boolean;
  /** Outlier symbol size */
  outlierSize?: number;
  /** IQR multiplier for whisker bounds (default: 1.5) */
  whiskerMultiplier?: number;
  /** Whether to use notched boxes (for median CI) */
  notched?: boolean;
  /** Orientation: vertical (default) or horizontal */
  orientation?: 'vertical' | 'horizontal';
}

/**
 * Box plot spec conforming to grammar.
 */
export interface BoxPlotSpec {
  mark: 'boxplot';
  data: { values: BoxPlotDataRow[] };
  encoding: BoxPlotEncoding;
  config?: BoxPlotConfig;
}

/**
 * Layout information for rendering.
 */
export interface BoxPlotLayout {
  chartArea: { x: number; y: number; width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
}

/**
 * Scale map for coordinate transformations.
 */
export interface BoxPlotScales {
  x: (value: string | number) => number;
  y: (value: number) => number;
  /** Bandwidth for categorical x scale */
  xBandwidth?: () => number;
}

/**
 * Style configuration for box plot elements.
 */
export interface BoxPlotStyles {
  box?: MarkStyle;
  median?: MarkStyle;
  whisker?: MarkStyle;
  outlier?: MarkStyle;
}

/**
 * Statistics computed for a single box.
 */
export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  lowerWhisker: number;
  upperWhisker: number;
  outliers: number[];
  category?: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: Required<BoxPlotConfig> = {
  boxWidth: 0.6,
  showOutliers: true,
  outlierSize: 36, // Area in pixels^2
  whiskerMultiplier: 1.5,
  notched: false,
  orientation: 'vertical',
};

const DEFAULT_STYLES: Required<BoxPlotStyles> = {
  box: {
    fill: '#4e79a7',
    stroke: '#333333',
    strokeWidth: 1,
    opacity: 0.8,
  },
  median: {
    stroke: '#ffffff',
    strokeWidth: 2,
  },
  whisker: {
    stroke: '#333333',
    strokeWidth: 1,
  },
  outlier: {
    fill: '#4e79a7',
    stroke: '#333333',
    strokeWidth: 0.5,
    opacity: 0.8,
  },
};

// =============================================================================
// Box Plot Builder (Fluent API)
// =============================================================================

/**
 * Fluent builder for creating box plot specifications.
 *
 * @example
 * const spec = BoxPlot()
 *   .data(myData)
 *   .values('salary')
 *   .category('department')
 *   .showOutliers(true)
 *   .toSpec();
 */
export class BoxPlotBuilder {
  private _data: BoxPlotDataRow[] = [];
  private _encoding: BoxPlotEncoding = {};
  private _config: BoxPlotConfig = {};

  /**
   * Set the data source.
   */
  data(values: BoxPlotDataRow[]): this {
    this._data = values;
    return this;
  }

  /**
   * Set the values field (y-axis for vertical, x-axis for horizontal).
   */
  values(field: string): this {
    this._encoding.y = { field, type: 'quantitative' };
    return this;
  }

  /**
   * Set the category field for grouped box plots.
   */
  category(field: string): this {
    this._encoding.x = { field, type: 'nominal' };
    return this;
  }

  /**
   * Set horizontal orientation (swap x and y).
   */
  horizontal(): this {
    this._config.orientation = 'horizontal';
    return this;
  }

  /**
   * Enable or disable outlier display.
   */
  showOutliers(show: boolean): this {
    this._config.showOutliers = show;
    return this;
  }

  /**
   * Enable notched boxes.
   */
  notched(enabled: boolean = true): this {
    this._config.notched = enabled;
    return this;
  }

  /**
   * Set box width as fraction of space (0-1).
   */
  boxWidth(width: number): this {
    this._config.boxWidth = Math.max(0.1, Math.min(1, width));
    return this;
  }

  /**
   * Set the whisker multiplier (default 1.5).
   */
  whiskerMultiplier(multiplier: number): this {
    this._config.whiskerMultiplier = multiplier;
    return this;
  }

  /**
   * Generate the chart specification (custom BoxPlotSpec format).
   */
  toSpec(): BoxPlotSpec {
    return {
      mark: 'boxplot',
      data: { values: this._data },
      encoding: this._encoding,
      config: this._config,
    };
  }

  /**
   * Generate a standard ChartSpec compatible with the grammar compiler.
   *
   * Returns a UnitSpec with mark: 'boxplot' and standard EncodingSpec
   * that can be passed directly to compile().
   *
   * @example
   * ```ts
   * const spec = BoxPlot().data(myData).values('salary').category('dept').toChartSpec();
   * const result = compile(spec);
   * ```
   */
  toChartSpec(): UnitSpec {
    const spec: UnitSpec = {
      mark: 'boxplot',
      data: { values: this._data },
      encoding: {},
    };

    if (this._encoding.y) {
      spec.encoding!.y = {
        field: this._encoding.y.field,
        type: this._encoding.y.type ?? 'quantitative',
      };
    }

    if (this._encoding.x) {
      spec.encoding!.x = {
        field: this._encoding.x.field,
        type: this._encoding.x.type ?? 'nominal',
      };
    }

    return spec;
  }
}

/**
 * Create a new BoxPlot builder.
 */
export function BoxPlot(): BoxPlotBuilder {
  return new BoxPlotBuilder();
}

// =============================================================================
// Statistics Calculation
// =============================================================================

/**
 * Calculate box plot statistics for a set of values.
 */
export function calculateBoxStats(
  values: number[],
  whiskerMultiplier: number = 1.5,
  category?: string,
): BoxStats {
  // Filter out non-finite values
  const validValues = values.filter((v) => isFinite(v));

  if (validValues.length === 0) {
    return {
      q1: NaN,
      median: NaN,
      q3: NaN,
      lowerWhisker: NaN,
      upperWhisker: NaN,
      outliers: [],
      category,
    };
  }

  // Sort values for quantile calculation
  const sorted = [...validValues].sort((a, b) => a - b);

  // Calculate quartiles
  const q = quartiles(sorted);
  const bounds = outlierBounds(sorted, whiskerMultiplier);

  // Find whisker bounds (furthest non-outlier values)
  const nonOutliers = sorted.filter((v) => v >= bounds.lower && v <= bounds.upper);

  const lowerWhisker = nonOutliers.length > 0 ? minValue(nonOutliers) : q.q1;
  const upperWhisker = nonOutliers.length > 0 ? maxValue(nonOutliers) : q.q3;

  // Find outliers
  const outlierValues = sorted.filter((v) => v < bounds.lower || v > bounds.upper);

  return {
    q1: q.q1,
    median: q.median,
    q3: q.q3,
    lowerWhisker,
    upperWhisker,
    outliers: outlierValues,
    category,
  };
}

/**
 * Group data by category and calculate stats for each group.
 */
export function calculateGroupedStats(
  data: BoxPlotDataRow[],
  valueField: string,
  categoryField?: string,
  whiskerMultiplier: number = 1.5,
): BoxStats[] {
  if (!categoryField) {
    // Single box plot - all values together
    const values = data
      .map((row) => row[valueField])
      .filter((v): v is number => typeof v === 'number');
    return [calculateBoxStats(values, whiskerMultiplier)];
  }

  // Group by category
  const groups = new Map<string, number[]>();

  for (const row of data) {
    const category = String(row[categoryField] ?? 'Unknown');
    const value = row[valueField];

    if (typeof value === 'number' && isFinite(value)) {
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(value);
    }
  }

  // Calculate stats for each group
  const stats: BoxStats[] = [];
  for (const [category, values] of groups) {
    stats.push(calculateBoxStats(values, whiskerMultiplier, category));
  }

  return stats;
}

// =============================================================================
// Mark Generation
// =============================================================================

/**
 * Generate marks for rendering a box plot.
 */
export function generateBoxPlotMarks(
  data: BoxPlotDataRow[],
  encoding: BoxPlotEncoding,
  scales: BoxPlotScales,
  layout: BoxPlotLayout,
  config: BoxPlotConfig = {},
  styles: BoxPlotStyles = {},
): Mark[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const stl = {
    box: { ...DEFAULT_STYLES.box, ...styles.box },
    median: { ...DEFAULT_STYLES.median, ...styles.median },
    whisker: { ...DEFAULT_STYLES.whisker, ...styles.whisker },
    outlier: { ...DEFAULT_STYLES.outlier, ...styles.outlier },
  };

  const valueField = encoding.y?.field;
  const categoryField = encoding.x?.field;

  if (!valueField) {
    return []; // No value field specified
  }

  // Calculate statistics
  const allStats = calculateGroupedStats(data, valueField, categoryField, cfg.whiskerMultiplier);

  const marks: Mark[] = [];

  // Determine box width
  const bandwidth = scales.xBandwidth?.() ?? layout.chartArea.width;
  const boxWidth = bandwidth * cfg.boxWidth;

  for (const stats of allStats) {
    if (isNaN(stats.median)) continue;

    // Determine x position
    let centerX: number;
    if (stats.category && categoryField) {
      centerX = scales.x(stats.category) + bandwidth / 2;
    } else {
      centerX = layout.chartArea.x + layout.chartArea.width / 2;
    }

    // Create geometry
    const geom: BoxPlotGeometry = {
      centerX,
      boxWidth,
      q1Y: scales.y(stats.q1),
      medianY: scales.y(stats.median),
      q3Y: scales.y(stats.q3),
      lowerWhiskerY: scales.y(stats.lowerWhisker),
      upperWhiskerY: scales.y(stats.upperWhisker),
      outlierYs: stats.outliers.map((v) => scales.y(v)),
    };

    // Generate box mark (using rect mark instead of path for the box)
    // Note: boxPlotBoxPath returns an SVG path string, but we'll use RectMark for easier rendering

    // Actually create rect mark for the box (easier to render)
    const boxRect: RectMark = {
      type: 'rect',
      x: geom.centerX - geom.boxWidth / 2,
      y: Math.min(geom.q1Y, geom.q3Y),
      width: geom.boxWidth,
      height: Math.abs(geom.q3Y - geom.q1Y),
      style: stl.box,
      datum: { stats, type: 'box' },
    };
    marks.push(boxRect);

    // Generate median line mark
    const medianMark: PathMark = {
      type: 'path',
      x: 0,
      y: 0,
      path: `M${geom.centerX - geom.boxWidth / 2},${geom.medianY} L${geom.centerX + geom.boxWidth / 2},${geom.medianY}`,
      style: stl.median,
      datum: { stats, type: 'median' },
    };
    marks.push(medianMark);

    // Generate whisker marks
    const [lowerWhiskerPath, upperWhiskerPath] = boxPlotWhiskerPaths(geom);
    const whiskerCapWidth = geom.boxWidth * 0.5;

    // Lower whisker
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${geom.centerX},${Math.max(geom.q1Y, geom.q3Y)} L${geom.centerX},${geom.lowerWhiskerY}`,
      style: stl.whisker,
      datum: { stats, type: 'whisker-lower' },
    } as PathMark);

    // Lower whisker cap
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${geom.centerX - whiskerCapWidth / 2},${geom.lowerWhiskerY} L${geom.centerX + whiskerCapWidth / 2},${geom.lowerWhiskerY}`,
      style: stl.whisker,
      datum: { stats, type: 'whisker-cap-lower' },
    } as PathMark);

    // Upper whisker
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${geom.centerX},${Math.min(geom.q1Y, geom.q3Y)} L${geom.centerX},${geom.upperWhiskerY}`,
      style: stl.whisker,
      datum: { stats, type: 'whisker-upper' },
    } as PathMark);

    // Upper whisker cap
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${geom.centerX - whiskerCapWidth / 2},${geom.upperWhiskerY} L${geom.centerX + whiskerCapWidth / 2},${geom.upperWhiskerY}`,
      style: stl.whisker,
      datum: { stats, type: 'whisker-cap-upper' },
    } as PathMark);

    // Generate outlier marks
    if (cfg.showOutliers) {
      for (let i = 0; i < stats.outliers.length; i++) {
        const outlierY = geom.outlierYs[i];
        const outlierMark: SymbolMark = {
          type: 'symbol',
          x: geom.centerX,
          y: outlierY,
          size: cfg.outlierSize,
          shape: 'circle',
          style: stl.outlier,
          datum: { value: stats.outliers[i], type: 'outlier' },
        };
        marks.push(outlierMark);
      }
    }
  }

  // Return all marks (placeholder removal no longer needed since we use path strings)
  return marks;
}

// =============================================================================
// Compile Box Plot Spec to Marks
// =============================================================================

/**
 * Compile a box plot specification into renderable marks.
 * This is the main entry point for the grammar compiler.
 */
export function compileBoxPlot(
  spec: BoxPlotSpec,
  scales: BoxPlotScales,
  layout: BoxPlotLayout,
  styles?: BoxPlotStyles,
): Mark[] {
  return generateBoxPlotMarks(spec.data.values, spec.encoding, scales, layout, spec.config, styles);
}
