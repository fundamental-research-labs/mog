/**
 * Violin Plot Component
 *
 * Renders violin plots for visualizing probability density distributions.
 * Combines KDE (kernel density estimation) with box plot statistics.
 *
 * Features:
 * - Smooth density curves using KDE
 * - Optional inner box plot overlay
 * - Single or grouped violin plots
 * - Horizontal or vertical orientation
 */

import type { UnitSpec } from '../../grammar/spec';
import { smoothClosedPath, type Point2D } from '../../math/geometry';
import { kde, quartiles, silvermanBandwidth, type KDEResult } from '../../math/statistics';
import type { Mark, MarkStyle, PathMark, RectMark, SymbolMark } from '../../primitives/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Data row format for violin plots.
 */
export interface ViolinPlotDataRow {
  [key: string]: unknown;
}

/**
 * Violin plot encoding specification.
 */
export interface ViolinPlotEncoding {
  /** Field containing numeric values to plot */
  y?: { field: string; type?: 'quantitative' };
  /** Optional category field for grouped violin plots */
  x?: { field: string; type?: 'nominal' | 'ordinal' };
}

/**
 * Violin plot configuration options.
 */
export interface ViolinPlotConfig {
  /** Violin width as fraction of available space (0-1) */
  violinWidth?: number;
  /** Whether to show inner box plot */
  showBox?: boolean;
  /** Whether to show median marker */
  showMedian?: boolean;
  /** KDE bandwidth (auto-calculated if not specified) */
  bandwidth?: number;
  /** Number of points for KDE curve */
  kdePoints?: number;
  /** Kernel type for KDE */
  kernel?: 'gaussian' | 'epanechnikov';
  /** Whether to show individual data points */
  showPoints?: boolean;
  /** Orientation: vertical (default) or horizontal */
  orientation?: 'vertical' | 'horizontal';
  /** Density scale: 'area' (all same area) or 'width' (same max width) */
  scale?: 'area' | 'width';
}

/**
 * Violin plot spec conforming to grammar.
 */
export interface ViolinPlotSpec {
  mark: 'violin';
  data: { values: ViolinPlotDataRow[] };
  encoding: ViolinPlotEncoding;
  config?: ViolinPlotConfig;
}

/**
 * Layout information for rendering.
 */
export interface ViolinPlotLayout {
  chartArea: { x: number; y: number; width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
}

/**
 * Scale map for coordinate transformations.
 */
export interface ViolinPlotScales {
  x: (value: string | number) => number;
  y: (value: number) => number;
  /** Bandwidth for categorical x scale */
  xBandwidth?: () => number;
}

/**
 * Style configuration for violin plot elements.
 */
export interface ViolinPlotStyles {
  violin?: MarkStyle;
  box?: MarkStyle;
  median?: MarkStyle;
  point?: MarkStyle;
}

/**
 * Statistics computed for a single violin.
 */
export interface ViolinStats {
  kde: KDEResult;
  q1: number;
  median: number;
  q3: number;
  min: number;
  max: number;
  category?: string;
  values: number[];
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: Required<ViolinPlotConfig> = {
  violinWidth: 0.8,
  showBox: true,
  showMedian: true,
  bandwidth: 0, // 0 means auto-calculate
  kdePoints: 100,
  kernel: 'gaussian',
  showPoints: false,
  orientation: 'vertical',
  scale: 'width',
};

const DEFAULT_STYLES: Required<ViolinPlotStyles> = {
  violin: {
    fill: '#4e79a7',
    stroke: '#333333',
    strokeWidth: 1,
    opacity: 0.7,
  },
  box: {
    fill: '#ffffff',
    stroke: '#333333',
    strokeWidth: 1,
    opacity: 0.9,
  },
  median: {
    fill: '#ffffff',
    stroke: '#333333',
    strokeWidth: 1,
  },
  point: {
    fill: '#333333',
    stroke: 'none',
    opacity: 0.5,
  },
};

// =============================================================================
// Violin Plot Builder (Fluent API)
// =============================================================================

/**
 * Fluent builder for creating violin plot specifications.
 *
 * @example
 * const spec = ViolinPlot()
 *   .data(myData)
 *   .values('score')
 *   .category('group')
 *   .showBox(true)
 *   .toSpec();
 */
export class ViolinPlotBuilder {
  private _data: ViolinPlotDataRow[] = [];
  private _encoding: ViolinPlotEncoding = {};
  private _config: ViolinPlotConfig = {};

  /**
   * Set the data source.
   */
  data(values: ViolinPlotDataRow[]): this {
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
   * Set the category field for grouped violin plots.
   */
  category(field: string): this {
    this._encoding.x = { field, type: 'nominal' };
    return this;
  }

  /**
   * Set horizontal orientation.
   */
  horizontal(): this {
    this._config.orientation = 'horizontal';
    return this;
  }

  /**
   * Enable or disable inner box plot.
   */
  showBox(show: boolean): this {
    this._config.showBox = show;
    return this;
  }

  /**
   * Enable or disable median marker.
   */
  showMedian(show: boolean): this {
    this._config.showMedian = show;
    return this;
  }

  /**
   * Enable or disable individual data points.
   */
  showPoints(show: boolean): this {
    this._config.showPoints = show;
    return this;
  }

  /**
   * Set violin width as fraction of space (0-1).
   */
  violinWidth(width: number): this {
    this._config.violinWidth = Math.max(0.1, Math.min(1, width));
    return this;
  }

  /**
   * Set KDE bandwidth.
   */
  bandwidth(bw: number): this {
    this._config.bandwidth = bw;
    return this;
  }

  /**
   * Set number of KDE points.
   */
  kdePoints(points: number): this {
    this._config.kdePoints = Math.max(10, points);
    return this;
  }

  /**
   * Set kernel type.
   */
  kernel(type: 'gaussian' | 'epanechnikov'): this {
    this._config.kernel = type;
    return this;
  }

  /**
   * Generate the chart specification (custom ViolinPlotSpec format).
   */
  toSpec(): ViolinPlotSpec {
    return {
      mark: 'violin',
      data: { values: this._data },
      encoding: this._encoding,
      config: this._config,
    };
  }

  /**
   * Generate a standard ChartSpec compatible with the grammar compiler.
   *
   * Returns a UnitSpec with mark: 'violin' and standard EncodingSpec
   * that can be passed directly to compile().
   *
   * @example
   * ```ts
   * const spec = ViolinPlot().data(myData).values('score').category('group').toChartSpec();
   * const result = compile(spec);
   * ```
   */
  toChartSpec(): UnitSpec {
    const spec: UnitSpec = {
      mark: 'violin',
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
 * Create a new ViolinPlot builder.
 */
export function ViolinPlot(): ViolinPlotBuilder {
  return new ViolinPlotBuilder();
}

// =============================================================================
// Statistics Calculation
// =============================================================================

/**
 * Calculate violin plot statistics for a set of values.
 */
export function calculateViolinStats(
  values: number[],
  bandwidth?: number,
  kdePoints: number = 100,
  kernel: 'gaussian' | 'epanechnikov' = 'gaussian',
  category?: string,
): ViolinStats {
  // Filter out non-finite values
  const validValues = values.filter((v) => isFinite(v));

  if (validValues.length === 0) {
    return {
      kde: { x: [], y: [] },
      q1: NaN,
      median: NaN,
      q3: NaN,
      min: NaN,
      max: NaN,
      category,
      values: [],
    };
  }

  // Calculate bandwidth if not provided
  const bw = bandwidth && bandwidth > 0 ? bandwidth : silvermanBandwidth(validValues);

  // Calculate KDE
  const kdeResult = kde(validValues, {
    bandwidth: bw,
    points: kdePoints,
    kernel,
  });

  // Calculate quartiles
  const q = quartiles(validValues);

  return {
    kde: kdeResult,
    q1: q.q1,
    median: q.median,
    q3: q.q3,
    min: validValues.reduce((m, v) => (v < m ? v : m), Infinity),
    max: validValues.reduce((m, v) => (v > m ? v : m), -Infinity),
    category,
    values: validValues,
  };
}

/**
 * Group data by category and calculate stats for each group.
 */
export function calculateGroupedViolinStats(
  data: ViolinPlotDataRow[],
  valueField: string,
  categoryField?: string,
  bandwidth?: number,
  kdePoints: number = 100,
  kernel: 'gaussian' | 'epanechnikov' = 'gaussian',
): ViolinStats[] {
  if (!categoryField) {
    // Single violin plot - all values together
    const values = data
      .map((row) => row[valueField])
      .filter((v): v is number => typeof v === 'number');
    return [calculateViolinStats(values, bandwidth, kdePoints, kernel)];
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
  const stats: ViolinStats[] = [];
  for (const [category, values] of groups) {
    stats.push(calculateViolinStats(values, bandwidth, kdePoints, kernel, category));
  }

  return stats;
}

// =============================================================================
// Mark Generation
// =============================================================================

/**
 * Generate the violin shape path from KDE results.
 */
function generateViolinShapePath(
  stats: ViolinStats,
  centerX: number,
  maxWidth: number,
  scaleY: (value: number) => number,
  maxDensityOverall?: number,
): string {
  const { kde: kdeResult } = stats;

  if (kdeResult.x.length === 0) {
    return '';
  }

  // Determine the max density for scaling
  let localMaxDensity = -Infinity;
  for (const v of kdeResult.y) {
    if (v > localMaxDensity) localMaxDensity = v;
  }
  const maxDensity = maxDensityOverall ?? localMaxDensity;

  if (maxDensity === 0) {
    return '';
  }

  const halfWidth = maxWidth / 2;

  // Generate points for the violin shape
  const rightPoints: Point2D[] = [];
  const leftPoints: Point2D[] = [];

  for (let i = 0; i < kdeResult.x.length; i++) {
    const dataValue = kdeResult.x[i];
    const density = kdeResult.y[i];
    const width = (density / maxDensity) * halfWidth;
    const y = scaleY(dataValue);

    rightPoints.push({ x: centerX + width, y });
    leftPoints.unshift({ x: centerX - width, y }); // Unshift to reverse order
  }

  // Combine into closed shape
  const allPoints = [...rightPoints, ...leftPoints];

  // Use smooth closed path for the violin shape
  return smoothClosedPath(allPoints, 0.3);
}

/**
 * Generate marks for rendering a violin plot.
 */
export function generateViolinPlotMarks(
  data: ViolinPlotDataRow[],
  encoding: ViolinPlotEncoding,
  scales: ViolinPlotScales,
  layout: ViolinPlotLayout,
  config: ViolinPlotConfig = {},
  styles: ViolinPlotStyles = {},
): Mark[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const stl = {
    violin: { ...DEFAULT_STYLES.violin, ...styles.violin },
    box: { ...DEFAULT_STYLES.box, ...styles.box },
    median: { ...DEFAULT_STYLES.median, ...styles.median },
    point: { ...DEFAULT_STYLES.point, ...styles.point },
  };

  const valueField = encoding.y?.field;
  const categoryField = encoding.x?.field;

  if (!valueField) {
    return []; // No value field specified
  }

  // Calculate statistics
  const allStats = calculateGroupedViolinStats(
    data,
    valueField,
    categoryField,
    cfg.bandwidth || undefined,
    cfg.kdePoints,
    cfg.kernel,
  );

  const marks: Mark[] = [];

  // Determine violin width
  const bandwidth = scales.xBandwidth?.() ?? layout.chartArea.width;
  const violinWidth = bandwidth * cfg.violinWidth;

  // Find max density across all violins if using 'width' scale
  let maxDensityOverall: number | undefined;
  if (cfg.scale === 'width') {
    maxDensityOverall = allStats.reduce((overall, s) => {
      const localMax = s.kde.y.reduce((m, v) => (v > m ? v : m), 0);
      return localMax > overall ? localMax : overall;
    }, 0);
  }

  for (const stats of allStats) {
    if (stats.kde.x.length === 0) continue;

    // Determine x position
    let centerX: number;
    if (stats.category && categoryField) {
      centerX = scales.x(stats.category) + bandwidth / 2;
    } else {
      centerX = layout.chartArea.x + layout.chartArea.width / 2;
    }

    // Generate violin shape
    const violinPathStr = generateViolinShapePath(
      stats,
      centerX,
      violinWidth,
      scales.y,
      maxDensityOverall,
    );

    // Create violin mark (using path with SVG d string)
    if (violinPathStr) {
      // Create a series of points for the violin outline
      const kdeResult = stats.kde;
      const halfWidth = violinWidth / 2;
      let maxDensity = maxDensityOverall ?? -Infinity;
      if (maxDensityOverall === undefined) {
        for (const v of kdeResult.y) {
          if (v > maxDensity) maxDensity = v;
        }
      }

      // Build SVG path string
      let pathString = '';
      let firstPoint = true;

      // Right side (top to bottom in data space, which could be bottom to top visually)
      for (let i = 0; i < kdeResult.x.length; i++) {
        const density = kdeResult.y[i];
        const width = (density / maxDensity) * halfWidth;
        const x = centerX + width;
        const y = scales.y(kdeResult.x[i]);

        if (firstPoint) {
          pathString += `M${x},${y}`;
          firstPoint = false;
        } else {
          pathString += ` L${x},${y}`;
        }
      }

      // Left side (bottom to top, continuing the path)
      for (let i = kdeResult.x.length - 1; i >= 0; i--) {
        const density = kdeResult.y[i];
        const width = (density / maxDensity) * halfWidth;
        const x = centerX - width;
        const y = scales.y(kdeResult.x[i]);
        pathString += ` L${x},${y}`;
      }

      // Close the path
      pathString += ' Z';

      const violinMark: PathMark = {
        type: 'path',
        x: 0,
        y: 0,
        path: pathString,
        style: stl.violin,
        datum: { stats, type: 'violin' },
      };
      marks.push(violinMark);
    }

    // Add inner box if requested
    if (cfg.showBox) {
      const boxWidth = violinWidth * 0.15; // Thin inner box
      const boxRect: RectMark = {
        type: 'rect',
        x: centerX - boxWidth / 2,
        y: Math.min(scales.y(stats.q1), scales.y(stats.q3)),
        width: boxWidth,
        height: Math.abs(scales.y(stats.q3) - scales.y(stats.q1)),
        style: stl.box,
        datum: { stats, type: 'box' },
      };
      marks.push(boxRect);
    }

    // Add median marker if requested
    if (cfg.showMedian) {
      const medianMark: SymbolMark = {
        type: 'symbol',
        x: centerX,
        y: scales.y(stats.median),
        size: 36, // Circle area
        shape: 'circle',
        style: stl.median,
        datum: { value: stats.median, type: 'median' },
      };
      marks.push(medianMark);
    }

    // Add individual points if requested
    if (cfg.showPoints) {
      // Use jittering to spread points horizontally
      const jitterWidth = violinWidth * 0.3;
      for (const value of stats.values) {
        // Simple random-ish jitter based on value
        const jitter = (Math.sin(value * 1000) * 0.5 + 0.5 - 0.5) * jitterWidth;
        const pointMark: SymbolMark = {
          type: 'symbol',
          x: centerX + jitter,
          y: scales.y(value),
          size: 16, // Small points
          shape: 'circle',
          style: stl.point,
          datum: { value, type: 'point' },
        };
        marks.push(pointMark);
      }
    }
  }

  return marks;
}

// =============================================================================
// Compile Violin Plot Spec to Marks
// =============================================================================

/**
 * Compile a violin plot specification into renderable marks.
 * This is the main entry point for the grammar compiler.
 */
export function compileViolinPlot(
  spec: ViolinPlotSpec,
  scales: ViolinPlotScales,
  layout: ViolinPlotLayout,
  styles?: ViolinPlotStyles,
): Mark[] {
  return generateViolinPlotMarks(
    spec.data.values,
    spec.encoding,
    scales,
    layout,
    spec.config,
    styles,
  );
}
