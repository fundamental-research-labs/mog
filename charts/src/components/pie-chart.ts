/**
 * Pie Chart Component - Fluent API for pie and doughnut charts.
 *
 * Supports:
 * - Pie charts (full circle)
 * - Doughnut charts (with inner radius)
 * - Labels and tooltips
 * - Slice sorting and ordering
 *
 * Pure TypeScript, no framework dependencies.
 */

import type { ChannelSpec, ChartSpec, LayerSpec, MarkSpec, MarkType } from '../grammar/spec';
import { BaseChartBuilder } from './base-chart';

// =============================================================================
// Pie Chart Builder
// =============================================================================

/**
 * Builder for pie and doughnut charts with fluent API.
 *
 * @example
 * ```ts
 * const spec = PieChart()
 *   .data(salesData)
 *   .theta('value')
 *   .category('region')
 *   .title('Sales by Region')
 *   .toSpec();
 *
 * const doughnutSpec = PieChart()
 *   .data(data)
 *   .theta('amount')
 *   .category('type')
 *   .donut(0.5)
 *   .toSpec();
 * ```
 */
export class PieChartBuilder extends BaseChartBuilder<PieChartBuilder> {
  private _markOptions: Partial<MarkSpec> = {};
  private _showLabels: boolean = false;
  private _labelOptions: {
    field?: string;
    format?: string;
    fontSize?: number;
    color?: string;
    offset?: number;
  } = {};

  protected self(): PieChartBuilder {
    return this;
  }

  protected getDefaultMark(): MarkType | MarkSpec {
    if (Object.keys(this._markOptions).length > 0) {
      return { type: 'arc', ...this._markOptions };
    }
    return 'arc';
  }

  // ---------------------------------------------------------------------------
  // Encoding Methods
  // ---------------------------------------------------------------------------

  /**
   * Set the theta (angle) encoding.
   * This determines the size of each slice based on the field values.
   *
   * @param field - Field name for slice sizes
   * @param options - Channel options (type defaults to 'quantitative')
   */
  theta(field: string, options?: Partial<ChannelSpec>): PieChartBuilder {
    this._encoding.theta = {
      field,
      type: 'quantitative',
      ...options,
    };
    return this;
  }

  /**
   * Alias for theta - set the value field that determines slice sizes.
   */
  value(field: string, options?: Partial<ChannelSpec>): PieChartBuilder {
    return this.theta(field, options);
  }

  /**
   * Set the category (color) encoding.
   * This determines the color of each slice and the legend entries.
   *
   * @param field - Field name for categories
   * @param options - Channel options (type defaults to 'nominal')
   */
  category(field: string, options?: Partial<ChannelSpec>): PieChartBuilder {
    this._encoding.color = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  /**
   * Alias for category - set the color field.
   */
  color(field: string, options?: Partial<ChannelSpec>): PieChartBuilder {
    return this.category(field, options);
  }

  /**
   * Set tooltip fields.
   */
  tooltip(fields: string | string[] | ChannelSpec[]): PieChartBuilder {
    return this.setTooltip(fields);
  }

  /**
   * Set the order encoding (controls slice order).
   */
  order(field: string, options?: Partial<ChannelSpec>): PieChartBuilder {
    this._encoding.order = {
      field,
      ...options,
    };
    return this;
  }

  // ---------------------------------------------------------------------------
  // Doughnut Methods
  // ---------------------------------------------------------------------------

  /**
   * Convert to a doughnut chart by setting inner radius.
   *
   * @param innerRadius - Inner radius as ratio (0-1) or pixels
   *   - Values 0-1 are treated as ratios of outer radius
   *   - Values > 1 are treated as pixel values
   */
  donut(innerRadius: number = 0.5): PieChartBuilder {
    this._markOptions.innerRadius = innerRadius;
    return this;
  }

  /**
   * Alias for donut.
   */
  doughnut(innerRadius: number = 0.5): PieChartBuilder {
    return this.donut(innerRadius);
  }

  /**
   * Set the inner radius explicitly.
   */
  innerRadius(radius: number): PieChartBuilder {
    this._markOptions.innerRadius = radius;
    return this;
  }

  /**
   * Set the outer radius.
   */
  outerRadius(radius: number): PieChartBuilder {
    this._markOptions.outerRadius = radius;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Style Methods
  // ---------------------------------------------------------------------------

  /**
   * Set corner radius for slices.
   */
  cornerRadius(radius: number): PieChartBuilder {
    this._markOptions.cornerRadius = radius;
    return this;
  }

  /**
   * Set pad angle between slices.
   *
   * @param angle - Angle in radians
   */
  padAngle(angle: number): PieChartBuilder {
    this._markOptions.padAngle = angle;
    return this;
  }

  /**
   * Add spacing between slices (convenience for padAngle).
   *
   * @param pixels - Approximate pixel spacing (converted to radians)
   */
  spacing(pixels: number = 2): PieChartBuilder {
    // Approximate conversion: assume 100px radius
    const angle = pixels / 100;
    this._markOptions.padAngle = angle;
    return this;
  }

  /**
   * Set slice stroke color.
   */
  stroke(color: string): PieChartBuilder {
    this._markOptions.stroke = color;
    return this;
  }

  /**
   * Set slice stroke width.
   */
  strokeWidth(width: number): PieChartBuilder {
    this._markOptions.strokeWidth = width;
    return this;
  }

  /**
   * Set overall opacity.
   */
  opacity(value: number): PieChartBuilder {
    this._markOptions.opacity = value;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Label Methods
  // ---------------------------------------------------------------------------

  /**
   * Show labels on slices.
   *
   * @param options - Label configuration
   */
  withLabels(options?: {
    field?: string;
    format?: string;
    fontSize?: number;
    color?: string;
    offset?: number;
  }): PieChartBuilder {
    this._showLabels = true;
    if (options) {
      this._labelOptions = options;
    }
    return this;
  }

  /**
   * Hide labels.
   */
  hideLabels(): PieChartBuilder {
    this._showLabels = false;
    return this;
  }

  /**
   * Show percentage labels.
   */
  percentLabels(options?: {
    decimals?: number;
    fontSize?: number;
    color?: string;
  }): PieChartBuilder {
    this._showLabels = true;
    this._labelOptions = {
      format: `.${options?.decimals ?? 1}%`,
      fontSize: options?.fontSize,
      color: options?.color,
    };
    return this;
  }

  // ---------------------------------------------------------------------------
  // Angle Methods
  // ---------------------------------------------------------------------------

  /**
   * Sort slices by value.
   *
   * @param order - Sort order ('ascending' or 'descending')
   */
  sortSlices(order: 'ascending' | 'descending' = 'descending'): PieChartBuilder {
    if (this._encoding.theta) {
      this._encoding.order = {
        field: this._encoding.theta.field,
        sort: order,
      };
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Build Override
  // ---------------------------------------------------------------------------

  /**
   * Convert to ChartSpec, optionally creating a layered spec for labels.
   */
  toSpec(): ChartSpec {
    if (this._showLabels) {
      return this.toLayeredSpec();
    }
    return super.toSpec();
  }

  /**
   * Convert to a layered spec with arc and text labels.
   */
  private toLayeredSpec(): LayerSpec {
    // Determine the label field
    const labelField =
      this._labelOptions.field ?? this._encoding.theta?.field ?? this._encoding.color?.field;

    const baseSpec: LayerSpec = {
      ...this._spec,
      encoding: this._encoding,
      layer: [
        {
          mark: {
            type: 'arc',
            ...this._markOptions,
          },
        },
        {
          mark: {
            type: 'text',
            // Use size for font size in grammar spec (compiler interprets for text marks)
            size: this._labelOptions.fontSize ?? 12,
            color: this._labelOptions.color ?? '#000000',
          },
          encoding: {
            text: {
              field: labelField,
              type: 'quantitative',
              format: this._labelOptions.format,
            },
            // Position text at arc centroid (handled by compiler)
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
 * Create a new pie chart builder.
 *
 * @example
 * ```ts
 * // Simple pie chart
 * const spec = PieChart()
 *   .data([
 *     { category: 'A', value: 30 },
 *     { category: 'B', value: 50 },
 *     { category: 'C', value: 20 },
 *   ])
 *   .theta('value')
 *   .category('category')
 *   .toSpec();
 *
 * // Doughnut with labels
 * const spec = PieChart()
 *   .data(salesData)
 *   .theta('amount')
 *   .category('region')
 *   .donut(0.6)
 *   .percentLabels({ decimals: 0 })
 *   .title('Sales Distribution')
 *   .toSpec();
 * ```
 */
export function PieChart(): PieChartBuilder {
  return new PieChartBuilder();
}

/**
 * Create a doughnut chart (shortcut).
 *
 * @param innerRadius - Inner radius ratio (default 0.5)
 */
export function DonutChart(innerRadius: number = 0.5): PieChartBuilder {
  return new PieChartBuilder().donut(innerRadius);
}

/**
 * Alias for DonutChart.
 */
export function DoughnutChart(innerRadius: number = 0.5): PieChartBuilder {
  return DonutChart(innerRadius);
}
