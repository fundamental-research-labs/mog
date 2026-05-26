/**
 * Scatter Chart Component - Fluent API for scatter and bubble charts.
 *
 * Supports:
 * - Scatter plots (point marks)
 * - Bubble charts (with size encoding)
 * - Multiple series (via color encoding)
 * - Trendlines
 *
 * Pure TypeScript, no framework dependencies.
 */

import type { ChannelSpec, ChartSpec, LayerSpec, MarkSpec, MarkType } from '../grammar/spec';
import { BaseChartBuilder } from './base-chart';

// =============================================================================
// Scatter Chart Builder
// =============================================================================

/**
 * Builder for scatter and bubble charts with fluent API.
 *
 * @example
 * ```ts
 * const spec = ScatterChart()
 *   .data(irisData)
 *   .x('sepalLength')
 *   .y('sepalWidth')
 *   .color('species')
 *   .size('petalLength')
 *   .title('Iris Dataset')
 *   .toSpec();
 * ```
 */
export class ScatterChartBuilder extends BaseChartBuilder<ScatterChartBuilder> {
  private _markOptions: Partial<MarkSpec> = {};
  private _withTrendline: boolean = false;
  private _trendlineOptions: {
    method?: 'linear' | 'log' | 'exp' | 'pow' | 'quad' | 'poly';
    order?: number;
    color?: string;
    strokeWidth?: number;
    strokeDash?: number[];
  } = {};

  protected self(): ScatterChartBuilder {
    return this;
  }

  protected getDefaultMark(): MarkType | MarkSpec {
    const mark: MarkSpec = {
      type: 'point',
      ...this._markOptions,
    };
    return mark;
  }

  // ---------------------------------------------------------------------------
  // Encoding Methods
  // ---------------------------------------------------------------------------

  /**
   * Set the X encoding.
   *
   * @param field - Field name for X axis
   * @param options - Channel options (type defaults to 'quantitative')
   */
  x(field: string, options?: Partial<ChannelSpec>): ScatterChartBuilder {
    this._encoding.x = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Set the Y encoding.
   *
   * @param field - Field name for Y axis
   * @param options - Channel options (type defaults to 'quantitative')
   */
  y(field: string, options?: Partial<ChannelSpec>): ScatterChartBuilder {
    this._encoding.y = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Set the color encoding (for grouping points).
   *
   * @param field - Field name for color grouping
   * @param options - Channel options (type defaults to 'nominal')
   */
  color(field: string, options?: Partial<ChannelSpec>): ScatterChartBuilder {
    this._encoding.color = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set the size encoding (creates a bubble chart).
   *
   * @param field - Field name for point sizes
   * @param options - Channel options (type defaults to 'quantitative')
   */
  size(field: string, options?: Partial<ChannelSpec>): ScatterChartBuilder {
    this._encoding.size = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Set the shape encoding.
   *
   * @param field - Field name for point shapes
   * @param options - Channel options (type defaults to 'nominal')
   */
  shape(field: string, options?: Partial<ChannelSpec>): ScatterChartBuilder {
    this._encoding.shape = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Set the opacity encoding.
   *
   * @param field - Field name for opacity
   * @param options - Channel options
   */
  opacity(field: string, options?: Partial<ChannelSpec>): ScatterChartBuilder {
    this._encoding.opacity = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Set tooltip fields.
   */
  tooltip(fields: string | string[] | ChannelSpec[]): ScatterChartBuilder {
    return this.setTooltip(fields);
  }

  // ---------------------------------------------------------------------------
  // Style Methods
  // ---------------------------------------------------------------------------

  /**
   * Set point size (for all points).
   *
   * @param size - Size in square pixels (area of the point)
   */
  pointSize(size: number): ScatterChartBuilder {
    this._markOptions.size = size;
    return this;
  }

  /**
   * Use filled points (default).
   */
  filled(): ScatterChartBuilder {
    // Remove fillOpacity restriction to show filled points
    delete this._markOptions.fillOpacity;
    return this;
  }

  /**
   * Use unfilled (outline only) points.
   */
  unfilled(): ScatterChartBuilder {
    // Set fillOpacity to 0 to show outline only
    this._markOptions.fillOpacity = 0;
    return this;
  }

  /**
   * Set point fill color.
   */
  fill(color: string): ScatterChartBuilder {
    this._markOptions.fill = color;
    return this;
  }

  /**
   * Set point stroke color.
   */
  stroke(color: string): ScatterChartBuilder {
    this._markOptions.stroke = color;
    return this;
  }

  /**
   * Set point stroke width.
   */
  strokeWidth(width: number): ScatterChartBuilder {
    this._markOptions.strokeWidth = width;
    return this;
  }

  /**
   * Set overall opacity (constant value).
   */
  opacityValue(value: number): ScatterChartBuilder {
    this._markOptions.opacity = value;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Trendline Methods
  // ---------------------------------------------------------------------------

  /**
   * Add a trendline.
   *
   * @param options - Trendline configuration
   */
  trendline(options?: {
    method?: 'linear' | 'log' | 'exp' | 'pow' | 'quad' | 'poly';
    order?: number;
    color?: string;
    strokeWidth?: number;
    strokeDash?: number[];
  }): ScatterChartBuilder {
    this._withTrendline = true;
    if (options) {
      this._trendlineOptions = options;
    } else {
      this._trendlineOptions = { method: 'linear' };
    }
    return this;
  }

  /**
   * Add a linear trendline (shortcut).
   */
  linearTrendline(color?: string): ScatterChartBuilder {
    return this.trendline({ method: 'linear', color });
  }

  /**
   * Add a polynomial trendline.
   *
   * @param order - Polynomial order (2 for quadratic, 3 for cubic, etc.)
   */
  polynomialTrendline(order: number = 2, color?: string): ScatterChartBuilder {
    return this.trendline({ method: 'poly', order, color });
  }

  /**
   * Remove trendline.
   */
  noTrendline(): ScatterChartBuilder {
    this._withTrendline = false;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Build Override
  // ---------------------------------------------------------------------------

  /**
   * Convert to ChartSpec, optionally creating a layered spec for trendline.
   */
  toSpec(): ChartSpec {
    if (this._withTrendline) {
      return this.toLayeredSpec();
    }
    return super.toSpec();
  }

  /**
   * Convert to a layered spec with points and trendline.
   */
  private toLayeredSpec(): ChartSpec {
    const xField = this._encoding.x?.field;
    const yField = this._encoding.y?.field;

    if (!xField || !yField) {
      // Can't create trendline without x and y fields
      return super.toSpec();
    }

    const baseSpec: LayerSpec = {
      ...this._spec,
      layer: [
        // Points layer
        {
          mark: this.getDefaultMark(),
          encoding: { ...this._encoding },
        },
        // Trendline layer
        {
          mark: {
            type: 'line',
            stroke: this._trendlineOptions.color ?? '#888888',
            strokeWidth: this._trendlineOptions.strokeWidth ?? 2,
            strokeDash: this._trendlineOptions.strokeDash ?? [4, 4],
          },
          transform: [
            {
              type: 'regression',
              regression: yField,
              on: xField,
              method: this._trendlineOptions.method ?? 'linear',
              order: this._trendlineOptions.order,
            },
          ],
          encoding: {
            x: { field: xField, type: 'quantitative' },
            y: { field: yField, type: 'quantitative' },
          },
        },
      ],
    };

    // Add data at root level
    if (this._spec.data) {
      baseSpec.data = this._spec.data;
    }

    // Add transforms at root level if any
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
 * Create a new scatter chart builder.
 *
 * @example
 * ```ts
 * // Simple scatter plot
 * const spec = ScatterChart()
 *   .data(data)
 *   .x('height')
 *   .y('weight')
 *   .toSpec();
 *
 * // Colored scatter plot with trendline
 * const spec = ScatterChart()
 *   .data(data)
 *   .x('x')
 *   .y('y')
 *   .color('category')
 *   .linearTrendline()
 *   .toSpec();
 *
 * // Bubble chart
 * const spec = ScatterChart()
 *   .data(countryData)
 *   .x('gdp')
 *   .y('lifeExpectancy')
 *   .size('population')
 *   .color('continent')
 *   .title('Gapminder')
 *   .toSpec();
 * ```
 */
export function ScatterChart(): ScatterChartBuilder {
  return new ScatterChartBuilder();
}

/**
 * Create a bubble chart (scatter with size encoding).
 */
export function BubbleChart(): ScatterChartBuilder {
  return new ScatterChartBuilder();
}

/**
 * Create a scatter plot with a linear trendline.
 */
export function ScatterWithTrendline(): ScatterChartBuilder {
  return new ScatterChartBuilder().linearTrendline();
}
