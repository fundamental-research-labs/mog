/**
 * Line Chart Component - Fluent API for line charts.
 *
 * Supports:
 * - Straight lines (linear interpolation)
 * - Smooth lines (monotone interpolation)
 * - Stepped lines (step interpolation)
 * - Multiple series (via color encoding)
 * - Points on lines
 *
 * Pure TypeScript, no framework dependencies.
 */

import type {
  ChannelSpec,
  ChartSpec,
  Interpolate,
  LayerSpec,
  MarkSpec,
  MarkType,
} from '../grammar/spec';
import { BaseChartBuilder } from './base-chart';

// =============================================================================
// Line Chart Builder
// =============================================================================

/**
 * Builder for line charts with fluent API.
 *
 * @example
 * ```ts
 * const spec = LineChart()
 *   .data(timeSeriesData)
 *   .x('date', { type: 'temporal' })
 *   .y('price', { type: 'quantitative' })
 *   .color('symbol')
 *   .smooth()
 *   .withPoints()
 *   .title('Stock Prices')
 *   .toSpec();
 * ```
 */
export class LineChartBuilder extends BaseChartBuilder<LineChartBuilder> {
  private _markOptions: Partial<MarkSpec> = {};
  private _withPoints: boolean = false;
  private _pointOptions: { color?: string; size?: number; filled?: boolean } = {};

  protected self(): LineChartBuilder {
    return this;
  }

  protected getDefaultMark(): MarkType | MarkSpec {
    if (this._withPoints || Object.keys(this._markOptions).length > 0) {
      return {
        type: 'line',
        ...this._markOptions,
        ...(this._withPoints ? { point: this._pointOptions } : {}),
      };
    }
    return 'line';
  }

  // ---------------------------------------------------------------------------
  // Encoding Methods
  // ---------------------------------------------------------------------------

  /**
   * Set the X encoding (typically time or sequence).
   *
   * @param field - Field name for X axis
   * @param options - Channel options (type defaults to 'temporal' for time data)
   */
  x(field: string, options?: Partial<ChannelSpec>): LineChartBuilder {
    this._encoding.x = {
      field,
      type: 'quantitative', // Will be overridden by options if provided
      ...options,
    };
    return this;
  }

  /**
   * Set the Y encoding (typically the value).
   *
   * @param field - Field name for Y axis
   * @param options - Channel options (type defaults to 'quantitative')
   */
  y(field: string, options?: Partial<ChannelSpec>): LineChartBuilder {
    this._encoding.y = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Set the color encoding (for multiple series).
   *
   * @param field - Field name for series grouping
   * @param options - Channel options (type defaults to 'nominal')
   */
  color(field: string, options?: Partial<ChannelSpec>): LineChartBuilder {
    this._encoding.color = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set the stroke dash encoding (for line styles).
   */
  strokeDash(field: string, options?: Partial<ChannelSpec>): LineChartBuilder {
    this._encoding.stroke = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set the detail encoding (for grouping without color).
   * Useful when you want separate lines but same color.
   */
  detail(field: string, options?: Partial<ChannelSpec>): LineChartBuilder {
    this._encoding.detail = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set tooltip fields.
   */
  tooltip(fields: string | string[] | ChannelSpec[]): LineChartBuilder {
    return this.setTooltip(fields);
  }

  // ---------------------------------------------------------------------------
  // Line Style Methods
  // ---------------------------------------------------------------------------

  /**
   * Use straight line segments (linear interpolation - default).
   */
  straight(): LineChartBuilder {
    this._markOptions.interpolate = 'linear';
    return this;
  }

  /**
   * Use smooth curves (monotone interpolation).
   * Curves pass through all data points smoothly.
   */
  smooth(): LineChartBuilder {
    this._markOptions.interpolate = 'monotone';
    return this;
  }

  /**
   * Use stepped lines (step interpolation).
   * Horizontal segments with vertical jumps.
   */
  stepped(): LineChartBuilder {
    this._markOptions.interpolate = 'step';
    return this;
  }

  /**
   * Use stepped lines with step before the value.
   */
  stepBefore(): LineChartBuilder {
    this._markOptions.interpolate = 'step-before';
    return this;
  }

  /**
   * Use stepped lines with step after the value.
   */
  stepAfter(): LineChartBuilder {
    this._markOptions.interpolate = 'step-after';
    return this;
  }

  /**
   * Use basis spline interpolation.
   */
  basis(): LineChartBuilder {
    this._markOptions.interpolate = 'basis';
    return this;
  }

  /**
   * Use cardinal spline interpolation.
   *
   * @param tension - Tension value (0-1)
   */
  cardinal(tension?: number): LineChartBuilder {
    this._markOptions.interpolate = 'cardinal';
    if (tension !== undefined) {
      this._markOptions.tension = tension;
    }
    return this;
  }

  /**
   * Set custom interpolation method.
   */
  interpolate(method: Interpolate): LineChartBuilder {
    this._markOptions.interpolate = method;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Point Methods
  // ---------------------------------------------------------------------------

  /**
   * Show points on the line.
   *
   * @param options - Point style options
   */
  withPoints(options?: { color?: string; size?: number; filled?: boolean }): LineChartBuilder {
    this._withPoints = true;
    if (options) {
      this._pointOptions = options;
    } else {
      this._pointOptions = { filled: true };
    }
    return this;
  }

  /**
   * Hide points on the line.
   */
  hidePoints(): LineChartBuilder {
    this._withPoints = false;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Stroke Style Methods
  // ---------------------------------------------------------------------------

  /**
   * Set line stroke color.
   */
  stroke(color: string): LineChartBuilder {
    this._markOptions.stroke = color;
    return this;
  }

  /**
   * Set line stroke width.
   */
  strokeWidth(width: number): LineChartBuilder {
    this._markOptions.strokeWidth = width;
    return this;
  }

  /**
   * Set line opacity.
   */
  opacity(value: number): LineChartBuilder {
    this._markOptions.opacity = value;
    return this;
  }

  /**
   * Set dashed line style.
   *
   * @param dashArray - Array of dash/gap lengths (e.g., [4, 2])
   */
  dashed(dashArray: number[] = [4, 4]): LineChartBuilder {
    this._markOptions.strokeDash = dashArray;
    return this;
  }

  /**
   * Set dotted line style.
   */
  dotted(): LineChartBuilder {
    this._markOptions.strokeDash = [2, 2];
    return this;
  }

  // ---------------------------------------------------------------------------
  // Layer Methods
  // ---------------------------------------------------------------------------

  /**
   * Convert to a layered spec with line and points as separate layers.
   * Alternative to using the point property on marks.
   */
  toLayeredSpec(): LayerSpec {
    const layers: ChartSpec[] = [
      {
        mark: {
          type: 'line',
          ...this._markOptions,
        },
      },
    ];

    if (this._withPoints) {
      const pointMark: MarkSpec = {
        type: 'point',
        size: this._pointOptions.size,
        color: this._pointOptions.color,
      };
      // Express "filled" via fill property - if filled is true/default, use fill; otherwise stroke only
      if (this._pointOptions.filled !== false) {
        pointMark.fill = this._pointOptions.color;
      }
      layers.push({ mark: pointMark });
    }

    const baseSpec: LayerSpec = {
      ...this._spec,
      encoding: this._encoding,
      layer: layers,
    };

    // Add transforms if any
    if (this._transforms.length > 0) {
      baseSpec.transform = this._transforms;
    }

    // Add config if any options set
    if (Object.keys(this._config).length > 0) {
      baseSpec.config = this._config;
    }

    return baseSpec;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new line chart builder.
 *
 * @example
 * ```ts
 * // Simple line chart
 * const spec = LineChart()
 *   .data(data)
 *   .x('month', { type: 'ordinal' })
 *   .y('value')
 *   .toSpec();
 *
 * // Multi-series smooth line chart with points
 * const spec = LineChart()
 *   .data(stockData)
 *   .x('date', { type: 'temporal' })
 *   .y('price')
 *   .color('symbol')
 *   .smooth()
 *   .withPoints({ size: 30 })
 *   .title('Stock Prices Over Time')
 *   .toSpec();
 *
 * // Step chart (for discrete changes)
 * const spec = LineChart()
 *   .data(levelData)
 *   .x('time', { type: 'temporal' })
 *   .y('level')
 *   .stepped()
 *   .toSpec();
 * ```
 */
export function LineChart(): LineChartBuilder {
  return new LineChartBuilder();
}

/**
 * Create a smooth line chart (shortcut).
 */
export function SmoothLineChart(): LineChartBuilder {
  return new LineChartBuilder().smooth();
}

/**
 * Create a stepped line chart (shortcut).
 */
export function StepChart(): LineChartBuilder {
  return new LineChartBuilder().stepped();
}
