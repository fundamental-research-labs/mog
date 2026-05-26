/**
 * Histogram Component
 *
 * Renders histograms for visualizing frequency distributions.
 * Supports automatic or manual binning and optional density curve overlay.
 *
 * Features:
 * - Automatic bin calculation (Sturges' or Freedman-Diaconis)
 * - Manual bin width or count specification
 * - Optional KDE density curve overlay
 * - Stacked or grouped histograms for multiple categories
 */

import type { UnitSpec } from '../../grammar/spec';
import {
  bin as binData,
  freedmanDiaconisBins,
  kde,
  type Bin,
  type KDEResult,
} from '../../math/statistics';
import type { Mark, MarkStyle, PathMark, RectMark } from '../../primitives/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Data row format for histograms.
 */
export interface HistogramDataRow {
  [key: string]: unknown;
}

/**
 * Histogram encoding specification.
 */
export interface HistogramEncoding {
  /** Field containing numeric values to bin */
  x?: { field: string; type?: 'quantitative'; bin?: boolean | BinParams };
  /** Optional category field for grouped/stacked histograms */
  color?: { field: string; type?: 'nominal' | 'ordinal' };
}

/**
 * Bin parameters for the encoding.
 */
export interface BinParams {
  /** Maximum number of bins */
  maxbins?: number;
  /** Exact bin width */
  step?: number;
  /** Whether to use nice round values */
  nice?: boolean;
}

/**
 * Histogram configuration options.
 */
export interface HistogramConfig {
  /** Number of bins (overrides automatic calculation) */
  binCount?: number;
  /** Bin width (overrides binCount) */
  binWidth?: number;
  /** Whether to use nice round bin boundaries */
  nice?: boolean;
  /** Gap between bars as fraction of bar width (0-1) */
  gap?: number;
  /** Whether to show density curve overlay */
  showDensity?: boolean;
  /** KDE bandwidth for density curve */
  densityBandwidth?: number;
  /** Stacking mode: none, stack, or normalize */
  stack?: 'none' | 'stack' | 'normalize';
  /** Whether y-axis shows count or density */
  yType?: 'count' | 'density';
}

/**
 * Histogram spec conforming to grammar.
 */
export interface HistogramSpec {
  mark: 'bar';
  data: { values: HistogramDataRow[] };
  encoding: HistogramEncoding;
  transform?: Array<{ bin: true; field: string; as: string }>;
  config?: HistogramConfig;
}

/**
 * Layout information for rendering.
 */
export interface HistogramLayout {
  chartArea: { x: number; y: number; width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
}

/**
 * Scale map for coordinate transformations.
 */
export interface HistogramScales {
  x: (value: number) => number;
  y: (value: number) => number;
  color?: (value: string) => string;
}

/**
 * Style configuration for histogram elements.
 */
export interface HistogramStyles {
  bar?: MarkStyle;
  density?: MarkStyle;
}

/**
 * Processed histogram data for a single category.
 */
export interface HistogramData {
  bins: Bin[];
  kde?: KDEResult;
  category?: string;
  color?: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: Required<HistogramConfig> = {
  binCount: 0, // 0 means auto-calculate
  binWidth: 0, // 0 means use binCount
  nice: true,
  gap: 0.05,
  showDensity: false,
  densityBandwidth: 0, // 0 means auto-calculate
  stack: 'none',
  yType: 'count',
};

const DEFAULT_STYLES: Required<HistogramStyles> = {
  bar: {
    fill: '#4e79a7',
    stroke: '#ffffff',
    strokeWidth: 0.5,
    opacity: 0.8,
  },
  density: {
    fill: 'none',
    stroke: '#e45756',
    strokeWidth: 2,
    opacity: 1,
  },
};

// Default color palette for categories
const DEFAULT_COLORS = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

// =============================================================================
// Histogram Builder (Fluent API)
// =============================================================================

/**
 * Fluent builder for creating histogram specifications.
 *
 * @example
 * const spec = Histogram()
 *   .data(myData)
 *   .x('age')
 *   .bins(20)
 *   .showDensity()
 *   .toSpec();
 */
export class HistogramBuilder {
  private _data: HistogramDataRow[] = [];
  private _encoding: HistogramEncoding = {};
  private _config: HistogramConfig = {};

  /**
   * Set the data source.
   */
  data(values: HistogramDataRow[]): this {
    this._data = values;
    return this;
  }

  /**
   * Set the field to histogram (x-axis).
   */
  x(field: string): this {
    this._encoding.x = { field, type: 'quantitative', bin: true };
    return this;
  }

  /**
   * Set the category field for grouped histograms.
   */
  color(field: string): this {
    this._encoding.color = { field, type: 'nominal' };
    return this;
  }

  /**
   * Set the number of bins.
   */
  bins(count: number): this {
    this._config.binCount = Math.max(1, count);
    return this;
  }

  /**
   * Set the bin width.
   */
  binWidth(width: number): this {
    this._config.binWidth = width;
    return this;
  }

  /**
   * Enable nice round bin boundaries.
   */
  nice(enabled: boolean = true): this {
    this._config.nice = enabled;
    return this;
  }

  /**
   * Set gap between bars (0-1).
   */
  gap(ratio: number): this {
    this._config.gap = Math.max(0, Math.min(1, ratio));
    return this;
  }

  /**
   * Enable density curve overlay.
   */
  showDensity(enabled: boolean = true): this {
    this._config.showDensity = enabled;
    return this;
  }

  /**
   * Set density curve bandwidth.
   */
  densityBandwidth(bw: number): this {
    this._config.densityBandwidth = bw;
    return this;
  }

  /**
   * Enable stacking for grouped histograms.
   */
  stack(mode: 'none' | 'stack' | 'normalize' = 'stack'): this {
    this._config.stack = mode;
    return this;
  }

  /**
   * Set y-axis type to density instead of count.
   */
  density(): this {
    this._config.yType = 'density';
    return this;
  }

  /**
   * Generate the chart specification (custom HistogramSpec format).
   */
  toSpec(): HistogramSpec {
    return {
      mark: 'bar',
      data: { values: this._data },
      encoding: this._encoding,
      config: this._config,
    };
  }

  /**
   * Generate a standard ChartSpec compatible with the grammar compiler.
   *
   * Returns a UnitSpec with mark: 'histogram' and standard EncodingSpec
   * that can be passed directly to compile(). The grammar compiler's
   * histogram mark generator handles binning and bar creation internally.
   *
   * @example
   * ```ts
   * const spec = Histogram().data(myData).x('age').toChartSpec();
   * const result = compile(spec);
   * ```
   */
  toChartSpec(): UnitSpec {
    const spec: UnitSpec = {
      mark: 'histogram',
      data: { values: this._data },
      encoding: {},
    };

    if (this._encoding.x) {
      spec.encoding!.x = {
        field: this._encoding.x.field,
        type: this._encoding.x.type ?? 'quantitative',
        ...(this._encoding.x.bin ? { bin: this._encoding.x.bin } : {}),
      };
    }

    if (this._encoding.color) {
      spec.encoding!.color = {
        field: this._encoding.color.field,
        type: this._encoding.color.type ?? 'nominal',
      };
    }

    return spec;
  }
}

/**
 * Create a new Histogram builder.
 */
export function Histogram(): HistogramBuilder {
  return new HistogramBuilder();
}

// =============================================================================
// Data Processing
// =============================================================================

/**
 * Calculate histogram bins and optional density curve.
 */
export function calculateHistogramData(
  values: number[],
  config: HistogramConfig = {},
  category?: string,
  color?: string,
): HistogramData {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Filter out non-finite values
  const validValues = values.filter((v) => isFinite(v));

  if (validValues.length === 0) {
    return { bins: [], category, color };
  }

  // Determine bin count
  let binCount: number | undefined;
  let binWidth: number | undefined;

  if (cfg.binWidth > 0) {
    binWidth = cfg.binWidth;
  } else if (cfg.binCount > 0) {
    binCount = cfg.binCount;
  } else {
    // Auto-calculate using Freedman-Diaconis rule
    binCount = freedmanDiaconisBins(validValues);
  }

  // Create bins
  const bins = binData(validValues, {
    binCount,
    binWidth,
    nice: cfg.nice,
  });

  // Calculate KDE if density curve is requested
  let kdeResult: KDEResult | undefined;
  if (cfg.showDensity) {
    kdeResult = kde(validValues, {
      bandwidth: cfg.densityBandwidth || undefined,
      points: 100,
    });
  }

  return { bins, kde: kdeResult, category, color };
}

/**
 * Process grouped histogram data.
 */
export function processHistogramData(
  data: HistogramDataRow[],
  valueField: string,
  categoryField?: string,
  config: HistogramConfig = {},
): HistogramData[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!categoryField) {
    // Single histogram - all values together
    const values = data
      .map((row) => row[valueField])
      .filter((v): v is number => typeof v === 'number');
    return [calculateHistogramData(values, cfg)];
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

  // Calculate histogram for each group
  const results: HistogramData[] = [];
  let colorIndex = 0;

  for (const [category, values] of groups) {
    const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
    results.push(calculateHistogramData(values, cfg, category, color));
    colorIndex++;
  }

  return results;
}

/**
 * Align bins across multiple categories.
 * Ensures all histograms use the same bin boundaries.
 */
export function alignBins(
  histogramData: HistogramData[],
  config: HistogramConfig = {},
): HistogramData[] {
  if (histogramData.length <= 1) {
    return histogramData;
  }

  // Find global min and max across all values
  let globalMin = Infinity;
  let globalMax = -Infinity;
  const allValues: number[] = [];

  for (const hist of histogramData) {
    for (const bin of hist.bins) {
      globalMin = Math.min(globalMin, bin.x0);
      globalMax = Math.max(globalMax, bin.x1);
      allValues.push(...bin.values);
    }
  }

  // Determine unified bin parameters
  let binCount = config.binCount;
  if (!binCount || binCount <= 0) {
    binCount = freedmanDiaconisBins(allValues);
  }

  const binWidth = config.binWidth || (globalMax - globalMin) / binCount;

  // Re-bin each category with aligned parameters
  return histogramData.map((hist) => {
    const values = hist.bins.flatMap((b) => b.values);
    const bins = binData(values, {
      binWidth,
      minValue: globalMin,
      maxValue: globalMax,
      nice: config.nice ?? true,
    });

    return {
      ...hist,
      bins,
    };
  });
}

// =============================================================================
// Mark Generation
// =============================================================================

/**
 * Generate marks for rendering a histogram.
 */
export function generateHistogramMarks(
  data: HistogramDataRow[],
  encoding: HistogramEncoding,
  scales: HistogramScales,
  layout: HistogramLayout,
  config: HistogramConfig = {},
  styles: HistogramStyles = {},
): Mark[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const stl = {
    bar: { ...DEFAULT_STYLES.bar, ...styles.bar },
    density: { ...DEFAULT_STYLES.density, ...styles.density },
  };

  const valueField = encoding.x?.field;
  const categoryField = encoding.color?.field;

  if (!valueField) {
    return []; // No value field specified
  }

  // Process data
  let histogramData = processHistogramData(data, valueField, categoryField, cfg);

  // Align bins for grouped histograms
  if (histogramData.length > 1) {
    histogramData = alignBins(histogramData, cfg);
  }

  const marks: Mark[] = [];
  const baselineY = layout.chartArea.y + layout.chartArea.height;

  // Find max count for y-scale
  let maxCount = 0;
  for (const hist of histogramData) {
    for (const bin of hist.bins) {
      maxCount = Math.max(maxCount, bin.count);
    }
  }

  // Handle stacking
  if (cfg.stack === 'stack' || cfg.stack === 'normalize') {
    // For stacking, we need to track cumulative heights per bin
    const binStacks = new Map<string, number>();

    // Find max stacked height for normalization
    let maxStackHeight = 0;
    if (cfg.stack === 'normalize') {
      const stackTotals = new Map<string, number>();
      for (const hist of histogramData) {
        for (const bin of hist.bins) {
          const key = `${bin.x0}-${bin.x1}`;
          stackTotals.set(key, (stackTotals.get(key) || 0) + bin.count);
        }
      }
      maxStackHeight = [...stackTotals.values()].reduce((m, v) => (v > m ? v : m), -Infinity);
    }

    for (const hist of histogramData) {
      const barColor = hist.color || stl.bar.fill || DEFAULT_COLORS[0];

      for (const bin of hist.bins) {
        const key = `${bin.x0}-${bin.x1}`;
        const stackBase = binStacks.get(key) || 0;

        let barHeight = bin.count;
        if (cfg.stack === 'normalize' && maxStackHeight > 0) {
          barHeight = (barHeight / maxStackHeight) * maxCount;
        }

        const x0 = scales.x(bin.x0);
        const x1 = scales.x(bin.x1);
        const fullWidth = x1 - x0;
        const gap = fullWidth * cfg.gap;
        const barWidth = fullWidth - gap;

        const y0 = scales.y(stackBase);
        const y1 = scales.y(stackBase + barHeight);

        const barMark: RectMark = {
          type: 'rect',
          x: x0 + gap / 2,
          y: Math.min(y0, y1),
          width: barWidth,
          height: Math.abs(y1 - y0),
          style: { ...stl.bar, fill: barColor },
          datum: { bin, category: hist.category },
        };
        marks.push(barMark);

        binStacks.set(key, stackBase + barHeight);
      }
    }
  } else {
    // No stacking - side by side or overlapped
    const numCategories = histogramData.length;

    for (let catIndex = 0; catIndex < histogramData.length; catIndex++) {
      const hist = histogramData[catIndex];
      const barColor = hist.color || stl.bar.fill || DEFAULT_COLORS[catIndex];

      for (const bin of hist.bins) {
        const x0 = scales.x(bin.x0);
        const x1 = scales.x(bin.x1);
        const fullWidth = x1 - x0;
        const gap = fullWidth * cfg.gap;

        // For grouped bars, divide width among categories
        const categoryWidth =
          numCategories > 1 ? (fullWidth - gap) / numCategories : fullWidth - gap;
        const barX = numCategories > 1 ? x0 + gap / 2 + catIndex * categoryWidth : x0 + gap / 2;

        const yValue =
          cfg.yType === 'density' && bin.x1 !== bin.x0
            ? bin.count /
              ((bin.x1 - bin.x0) *
                histogramData[catIndex].bins.reduce((sum, b) => sum + b.count, 0))
            : bin.count;

        const barMark: RectMark = {
          type: 'rect',
          x: barX,
          y: scales.y(yValue),
          width: categoryWidth,
          height: baselineY - scales.y(yValue),
          style: { ...stl.bar, fill: barColor },
          datum: { bin, category: hist.category },
        };
        marks.push(barMark);
      }
    }
  }

  // Add density curves if requested
  if (cfg.showDensity) {
    for (const hist of histogramData) {
      if (!hist.kde) continue;

      const { x: kdeX, y: kdeY } = hist.kde;
      if (kdeX.length === 0) continue;

      // Scale density to match histogram height
      let maxDensity = -Infinity;
      for (const v of kdeY) {
        if (v > maxDensity) maxDensity = v;
      }
      const scaleFactor = maxCount / maxDensity;

      // Generate path points
      const pathPoints = kdeX.map((xVal, i) => ({
        x: scales.x(xVal),
        y: scales.y(kdeY[i] * scaleFactor),
      }));

      // Build SVG path string
      let pathString = '';
      for (let i = 0; i < pathPoints.length; i++) {
        if (i === 0) {
          pathString += `M${pathPoints[i].x},${pathPoints[i].y}`;
        } else {
          pathString += ` L${pathPoints[i].x},${pathPoints[i].y}`;
        }
      }

      const densityMark: PathMark = {
        type: 'path',
        x: 0,
        y: 0,
        path: pathString,
        style: {
          ...stl.density,
          stroke: hist.color || stl.density.stroke,
        },
        datum: { kde: hist.kde, category: hist.category },
      };

      marks.push(densityMark);
    }
  }

  return marks;
}

// =============================================================================
// Compile Histogram Spec to Marks
// =============================================================================

/**
 * Compile a histogram specification into renderable marks.
 * This is the main entry point for the grammar compiler.
 */
export function compileHistogram(
  spec: HistogramSpec,
  scales: HistogramScales,
  layout: HistogramLayout,
  styles?: HistogramStyles,
): Mark[] {
  return generateHistogramMarks(
    spec.data.values,
    spec.encoding,
    scales,
    layout,
    spec.config,
    styles,
  );
}
