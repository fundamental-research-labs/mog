/**
 * Area Chart Component - Fluent API for area charts.
 *
 * Supports:
 * - Standard area charts
 * - Stacked area charts
 * - Percent stacked (normalized) area charts
 * - Stream graphs (centered stacking)
 * - Multiple interpolation modes
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
// Area Chart Builder
// =============================================================================

/**
 * Builder for area charts with fluent API.
 *
 * @example
 * ```ts
 * const spec = AreaChart()
 *   .data(timeSeriesData)
 *   .x('date', { type: 'temporal' })
 *   .y('value', { type: 'quantitative' })
 *   .color('category')
 *   .stacked()
 *   .smooth()
 *   .title('Values Over Time')
 *   .toSpec();
 * ```
 */
export class AreaChartBuilder extends BaseChartBuilder<AreaChartBuilder> {
  private _markOptions: Partial<MarkSpec> = {};
  private _withLine: boolean = false;
  private _lineOptions: Partial<MarkSpec> = {};

  protected self(): AreaChartBuilder {
    return this;
  }

  protected getDefaultMark(): MarkType | MarkSpec {
    if (Object.keys(this._markOptions).length > 0) {
      return { type: 'area', ...this._markOptions };
    }
    return 'area';
  }

  // ---------------------------------------------------------------------------
  // Encoding Methods
  // ---------------------------------------------------------------------------

  /**
   * Set the X encoding (typically time or sequence).
   *
   * @param field - Field name for X axis
   * @param options - Channel options
   */
  x(field: string, options?: Partial<ChannelSpec>): AreaChartBuilder {
    this._encoding.x = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Set the Y encoding (the area height).
   *
   * @param field - Field name for Y axis
   * @param options - Channel options (type defaults to 'quantitative')
   */
  y(field: string, options?: Partial<ChannelSpec>): AreaChartBuilder {
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
  color(field: string, options?: Partial<ChannelSpec>): AreaChartBuilder {
    this._encoding.color = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set the detail encoding (for grouping without color).
   */
  detail(field: string, options?: Partial<ChannelSpec>): AreaChartBuilder {
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
  tooltip(fields: string | string[] | ChannelSpec[]): AreaChartBuilder {
    return this.setTooltip(fields);
  }

  /**
   * Set the order encoding (controls stacking order).
   */
  order(field: string, options?: Partial<ChannelSpec>): AreaChartBuilder {
    this._encoding.order = {
      field,
      ...options,
    };
    return this;
  }

  // ---------------------------------------------------------------------------
  // Stack Methods
  // ---------------------------------------------------------------------------

  /**
   * Enable stacking (zero baseline).
   * Areas are stacked on top of each other.
   */
  stacked(): AreaChartBuilder {
    this._config.stack = 'zero';
    return this;
  }

  /**
   * Enable percent stacking (normalized to 100%).
   * Areas stack to 100% of the total.
   */
  percentStacked(): AreaChartBuilder {
    this._config.stack = 'normalize';
    return this;
  }

  /**
   * Enable stream graph (centered stacking).
   * Creates a symmetric view around the center baseline.
   */
  streamgraph(): AreaChartBuilder {
    this._config.stack = 'center';
    return this;
  }

  /**
   * Disable stacking (overlapping areas).
   */
  overlapping(): AreaChartBuilder {
    this._config.stack = false;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Line Style Methods
  // ---------------------------------------------------------------------------

  /**
   * Use straight line segments (linear interpolation - default).
   */
  straight(): AreaChartBuilder {
    this._markOptions.interpolate = 'linear';
    return this;
  }

  /**
   * Use smooth curves (monotone interpolation).
   */
  smooth(): AreaChartBuilder {
    this._markOptions.interpolate = 'monotone';
    return this;
  }

  /**
   * Use stepped lines (step interpolation).
   */
  stepped(): AreaChartBuilder {
    this._markOptions.interpolate = 'step';
    return this;
  }

  /**
   * Use stepped lines with step before the value.
   */
  stepBefore(): AreaChartBuilder {
    this._markOptions.interpolate = 'step-before';
    return this;
  }

  /**
   * Use stepped lines with step after the value.
   */
  stepAfter(): AreaChartBuilder {
    this._markOptions.interpolate = 'step-after';
    return this;
  }

  /**
   * Use basis spline interpolation.
   */
  basis(): AreaChartBuilder {
    this._markOptions.interpolate = 'basis';
    return this;
  }

  /**
   * Use cardinal spline interpolation.
   *
   * @param tension - Tension value (0-1)
   */
  cardinal(tension?: number): AreaChartBuilder {
    this._markOptions.interpolate = 'cardinal';
    if (tension !== undefined) {
      this._markOptions.tension = tension;
    }
    return this;
  }

  /**
   * Set custom interpolation method.
   */
  interpolate(method: Interpolate): AreaChartBuilder {
    this._markOptions.interpolate = method;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Style Methods
  // ---------------------------------------------------------------------------

  /**
   * Set area fill color.
   */
  fill(color: string): AreaChartBuilder {
    this._markOptions.fill = color;
    return this;
  }

  /**
   * Set area fill opacity.
   */
  fillOpacity(value: number): AreaChartBuilder {
    this._markOptions.fillOpacity = value;
    return this;
  }

  /**
   * Set overall opacity.
   */
  opacity(value: number): AreaChartBuilder {
    this._markOptions.opacity = value;
    return this;
  }

  /**
   * Set stroke color for the area outline.
   */
  stroke(color: string): AreaChartBuilder {
    this._markOptions.stroke = color;
    return this;
  }

  /**
   * Set stroke width for the area outline.
   */
  strokeWidth(width: number): AreaChartBuilder {
    this._markOptions.strokeWidth = width;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Line Overlay Methods
  // ---------------------------------------------------------------------------

  /**
   * Add a line overlay on top of the area.
   *
   * @param options - Line style options
   */
  withLine(options?: { color?: string; strokeWidth?: number; opacity?: number }): AreaChartBuilder {
    this._withLine = true;
    if (options) {
      this._lineOptions = {
        stroke: options.color,
        strokeWidth: options.strokeWidth,
        opacity: options.opacity,
      };
    }
    return this;
  }

  /**
   * Remove line overlay.
   */
  withoutLine(): AreaChartBuilder {
    this._withLine = false;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Build Override
  // ---------------------------------------------------------------------------

  /**
   * Convert to ChartSpec, optionally creating a layered spec for line overlay.
   */
  toSpec(): ChartSpec {
    if (this._withLine) {
      return this.toLayeredSpec();
    }
    return super.toSpec();
  }

  /**
   * Convert to a layered spec with area and line as separate layers.
   */
  private toLayeredSpec(): LayerSpec {
    const baseSpec: LayerSpec = {
      ...this._spec,
      encoding: this._encoding,
      layer: [
        {
          mark: {
            type: 'area',
            ...this._markOptions,
          },
        },
        {
          mark: {
            type: 'line',
            interpolate: this._markOptions.interpolate,
            ...this._lineOptions,
          },
        },
      ],
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
 * Create a new area chart builder.
 *
 * @example
 * ```ts
 * // Simple area chart
 * const spec = AreaChart()
 *   .data(data)
 *   .x('date', { type: 'temporal' })
 *   .y('value')
 *   .toSpec();
 *
 * // Stacked area chart
 * const spec = AreaChart()
 *   .data(categoryData)
 *   .x('month', { type: 'ordinal' })
 *   .y('amount')
 *   .color('category')
 *   .stacked()
 *   .smooth()
 *   .title('Monthly Breakdown')
 *   .toSpec();
 *
 * // Stream graph
 * const spec = AreaChart()
 *   .data(data)
 *   .x('date', { type: 'temporal' })
 *   .y('value')
 *   .color('series')
 *   .streamgraph()
 *   .smooth()
 *   .toSpec();
 * ```
 */
export function AreaChart(): AreaChartBuilder {
  return new AreaChartBuilder();
}

/**
 * Create a stacked area chart (shortcut).
 */
export function StackedAreaChart(): AreaChartBuilder {
  return new AreaChartBuilder().stacked();
}

/**
 * Create a stream graph (shortcut).
 */
export function StreamGraph(): AreaChartBuilder {
  return new AreaChartBuilder().streamgraph().smooth();
}
