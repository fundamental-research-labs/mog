/**
 * Bar Chart Component - Fluent API for bar and column charts.
 *
 * Supports:
 * - Vertical bars (column chart)
 * - Horizontal bars (bar chart)
 * - Clustered (grouped) bars
 * - Stacked bars
 * - Percent stacked (normalized) bars
 *
 * Pure TypeScript, no framework dependencies.
 */

import type { ChannelSpec, ChartSpec, MarkSpec, MarkType } from '../grammar/spec';
import { BaseChartBuilder } from './base-chart';

// =============================================================================
// Bar Chart Builder
// =============================================================================

/**
 * Builder for bar/column charts with fluent API.
 *
 * @example
 * ```ts
 * const spec = BarChart()
 *   .data(myData)
 *   .x('category', { type: 'nominal' })
 *   .y('value', { type: 'quantitative' })
 *   .color('group')
 *   .stacked()
 *   .title('Sales by Category')
 *   .toSpec();
 * ```
 */
export class BarChartBuilder extends BaseChartBuilder<BarChartBuilder> {
  private _horizontal: boolean = false;
  private _markOptions: Partial<MarkSpec> = {};

  protected self(): BarChartBuilder {
    return this;
  }

  protected getDefaultMark(): MarkType | MarkSpec {
    if (Object.keys(this._markOptions).length > 0) {
      return { type: 'bar', ...this._markOptions };
    }
    return 'bar';
  }

  // ---------------------------------------------------------------------------
  // Encoding Methods
  // ---------------------------------------------------------------------------

  /**
   * Set the X encoding (typically the category axis).
   *
   * @param field - Field name for X axis
   * @param options - Channel options (type defaults to 'nominal')
   */
  x(field: string, options?: Partial<ChannelSpec>): BarChartBuilder {
    this._encoding.x = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set the Y encoding (typically the value axis).
   *
   * @param field - Field name for Y axis
   * @param options - Channel options (type defaults to 'quantitative')
   */
  y(field: string, options?: Partial<ChannelSpec>): BarChartBuilder {
    this._encoding.y = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Set the color encoding (for grouping).
   *
   * @param field - Field name for color grouping
   * @param options - Channel options (type defaults to 'nominal')
   */
  color(field: string, options?: Partial<ChannelSpec>): BarChartBuilder {
    this._encoding.color = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set tooltip fields.
   */
  tooltip(fields: string | string[] | ChannelSpec[]): BarChartBuilder {
    return this.setTooltip(fields);
  }

  // ---------------------------------------------------------------------------
  // Bar Variant Methods
  // ---------------------------------------------------------------------------

  /**
   * Make bars horizontal (rotates x/y encodings).
   * Results in a horizontal bar chart instead of vertical column chart.
   */
  horizontal(): BarChartBuilder {
    this._horizontal = true;
    return this;
  }

  /**
   * Make bars vertical (column chart - default).
   */
  vertical(): BarChartBuilder {
    this._horizontal = false;
    return this;
  }

  /**
   * Enable stacking (zero baseline).
   * Bars with the same x value are stacked on top of each other.
   */
  stacked(): BarChartBuilder {
    this._config.stack = 'zero';
    return this;
  }

  /**
   * Enable percent stacking (normalized to 100%).
   * Bars with the same x value stack to 100%.
   */
  percentStacked(): BarChartBuilder {
    this._config.stack = 'normalize';
    return this;
  }

  /**
   * Enable centered stacking.
   * Bars are stacked around a center baseline (diverging).
   */
  streamgraph(): BarChartBuilder {
    this._config.stack = 'center';
    return this;
  }

  /**
   * Disable stacking (grouped bars).
   * Uses xOffset for grouped bars when color encoding is set.
   */
  grouped(): BarChartBuilder {
    this._config.stack = false;
    // Use xOffset for grouped bars
    if (this._encoding.color) {
      this._encoding.xOffset = {
        field: this._encoding.color.field,
        type: 'nominal',
      };
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Style Methods
  // ---------------------------------------------------------------------------

  /**
   * Set corner radius for bars.
   */
  cornerRadius(radius: number): BarChartBuilder {
    this._markOptions.cornerRadius = radius;
    return this;
  }

  /**
   * Set corner radius for top of bars only.
   */
  cornerRadiusTop(radius: number): BarChartBuilder {
    this._markOptions.cornerRadiusTopLeft = radius;
    this._markOptions.cornerRadiusTopRight = radius;
    return this;
  }

  /**
   * Set bar opacity.
   */
  opacity(value: number): BarChartBuilder {
    this._markOptions.opacity = value;
    return this;
  }

  /**
   * Set bar stroke color.
   */
  stroke(color: string): BarChartBuilder {
    this._markOptions.stroke = color;
    return this;
  }

  /**
   * Set bar stroke width.
   */
  strokeWidth(width: number): BarChartBuilder {
    this._markOptions.strokeWidth = width;
    return this;
  }

  /**
   * Set bar fill color (overrides color encoding).
   */
  fill(color: string): BarChartBuilder {
    this._markOptions.fill = color;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Build Override
  // ---------------------------------------------------------------------------

  /**
   * Convert to ChartSpec, handling horizontal bars.
   * This is a pure read operation — it does NOT mutate builder state.
   */
  toSpec(): ChartSpec {
    const spec = super.toSpec();

    // If horizontal, return a new spec with x and y encodings swapped
    // (without mutating this._encoding)
    if (this._horizontal && spec.encoding) {
      const { x, y, xOffset, ...rest } = spec.encoding;
      spec.encoding = {
        ...rest,
        x: y,
        y: x,
        // Also swap xOffset to yOffset if using grouped
        ...(xOffset ? { yOffset: xOffset } : {}),
      };
    }

    return spec;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new bar chart builder.
 *
 * @example
 * ```ts
 * // Simple bar chart
 * const spec = BarChart()
 *   .data([
 *     { category: 'A', value: 10 },
 *     { category: 'B', value: 20 },
 *   ])
 *   .x('category')
 *   .y('value')
 *   .toSpec();
 *
 * // Grouped bar chart
 * const spec = BarChart()
 *   .data(salesData)
 *   .x('quarter', { type: 'ordinal' })
 *   .y('sales')
 *   .color('product')
 *   .grouped()
 *   .title('Quarterly Sales by Product')
 *   .toSpec();
 *
 * // Stacked horizontal bar chart
 * const spec = BarChart()
 *   .data(surveyData)
 *   .x('count')
 *   .y('question', { type: 'nominal' })
 *   .color('response')
 *   .horizontal()
 *   .stacked()
 *   .toSpec();
 * ```
 */
export function BarChart(): BarChartBuilder {
  return new BarChartBuilder();
}

/**
 * Alias for BarChart that creates a column chart (same as BarChart, vertical by default).
 */
export function ColumnChart(): BarChartBuilder {
  return new BarChartBuilder();
}

/**
 * Alias for BarChart that creates a horizontal bar chart.
 */
export function HorizontalBarChart(): BarChartBuilder {
  return new BarChartBuilder().horizontal();
}
