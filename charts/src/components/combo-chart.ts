/**
 * Combo Chart Component - Fluent API for mixed bar + line charts.
 *
 * Supports:
 * - Bar + line combinations
 * - Dual Y-axis
 * - Multiple series with different mark types
 *
 * Pure TypeScript, no framework dependencies.
 */

import type {
  ChannelSpec,
  ChartSpec,
  LayerSpec,
  MarkSpec,
  MarkType,
  UnitSpec,
} from '../grammar/spec';
import { BaseChartBuilder } from './base-chart';

// =============================================================================
// Types
// =============================================================================

/**
 * Series definition for combo charts.
 */
interface SeriesConfig {
  field: string;
  type: 'bar' | 'line' | 'area' | 'point';
  options?: Partial<MarkSpec>;
  axis?: 'left' | 'right';
  name?: string;
}

// =============================================================================
// Combo Chart Builder
// =============================================================================

/**
 * Builder for combo (mixed) charts with fluent API.
 *
 * @example
 * ```ts
 * const spec = ComboChart()
 *   .data(salesData)
 *   .x('month', { type: 'ordinal' })
 *   .bar('revenue', { axis: 'left' })
 *   .line('profit', { axis: 'right' })
 *   .title('Revenue vs Profit')
 *   .toSpec();
 * ```
 */
export class ComboChartBuilder extends BaseChartBuilder<ComboChartBuilder> {
  private _series: SeriesConfig[] = [];
  private _dualAxis: boolean = false;
  private _leftAxisTitle?: string;
  private _rightAxisTitle?: string;

  protected self(): ComboChartBuilder {
    return this;
  }

  protected getDefaultMark(): MarkType | MarkSpec {
    // Combo charts use layers, not a single mark
    return 'bar';
  }

  // ---------------------------------------------------------------------------
  // X Encoding Method
  // ---------------------------------------------------------------------------

  /**
   * Set the X encoding (shared across all series).
   *
   * @param field - Field name for X axis
   * @param options - Channel options
   */
  x(field: string, options?: Partial<ChannelSpec>): ComboChartBuilder {
    this._encoding.x = {
      field,
      type: 'nominal',
      ...options,
    };
    return this;
  }

  // ---------------------------------------------------------------------------
  // Series Methods
  // ---------------------------------------------------------------------------

  /**
   * Add a bar series.
   *
   * @param field - Field name for bar values
   * @param options - Series options
   */
  bar(
    field: string,
    options?: {
      axis?: 'left' | 'right';
      color?: string;
      opacity?: number;
      name?: string;
    },
  ): ComboChartBuilder {
    this._series.push({
      field,
      type: 'bar',
      axis: options?.axis ?? 'left',
      name: options?.name ?? field,
      options: {
        fill: options?.color,
        opacity: options?.opacity,
      },
    });
    if (options?.axis === 'right') {
      this._dualAxis = true;
    }
    return this;
  }

  /**
   * Add a line series.
   *
   * @param field - Field name for line values
   * @param options - Series options
   */
  line(
    field: string,
    options?: {
      axis?: 'left' | 'right';
      color?: string;
      strokeWidth?: number;
      smooth?: boolean;
      withPoints?: boolean;
      name?: string;
    },
  ): ComboChartBuilder {
    const markOptions: Partial<MarkSpec> = {
      stroke: options?.color,
      strokeWidth: options?.strokeWidth ?? 2,
    };
    if (options?.smooth) {
      markOptions.interpolate = 'monotone';
    }
    if (options?.withPoints) {
      markOptions.point = { filled: true };
    }

    this._series.push({
      field,
      type: 'line',
      axis: options?.axis ?? 'right',
      name: options?.name ?? field,
      options: markOptions,
    });
    if (options?.axis === 'right' || options?.axis === undefined) {
      this._dualAxis = true;
    }
    return this;
  }

  /**
   * Add an area series.
   *
   * @param field - Field name for area values
   * @param options - Series options
   */
  area(
    field: string,
    options?: {
      axis?: 'left' | 'right';
      color?: string;
      opacity?: number;
      smooth?: boolean;
      name?: string;
    },
  ): ComboChartBuilder {
    const markOptions: Partial<MarkSpec> = {
      fill: options?.color,
      fillOpacity: options?.opacity ?? 0.3,
    };
    if (options?.smooth) {
      markOptions.interpolate = 'monotone';
    }

    this._series.push({
      field,
      type: 'area',
      axis: options?.axis ?? 'left',
      name: options?.name ?? field,
      options: markOptions,
    });
    if (options?.axis === 'right') {
      this._dualAxis = true;
    }
    return this;
  }

  /**
   * Add a point (scatter) series.
   *
   * @param field - Field name for point values
   * @param options - Series options
   */
  point(
    field: string,
    options?: {
      axis?: 'left' | 'right';
      color?: string;
      size?: number;
      name?: string;
    },
  ): ComboChartBuilder {
    this._series.push({
      field,
      type: 'point',
      axis: options?.axis ?? 'left',
      name: options?.name ?? field,
      options: {
        fill: options?.color,
        size: options?.size,
      },
    });
    if (options?.axis === 'right') {
      this._dualAxis = true;
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Axis Configuration
  // ---------------------------------------------------------------------------

  /**
   * Set the title for the left Y axis.
   */
  leftAxisTitle(title: string): ComboChartBuilder {
    this._leftAxisTitle = title;
    return this;
  }

  /**
   * Set the title for the right Y axis.
   */
  rightAxisTitle(title: string): ComboChartBuilder {
    this._rightAxisTitle = title;
    return this;
  }

  /**
   * Enable dual Y-axis mode.
   * This is automatically enabled when series are assigned to different axes.
   */
  dualAxis(): ComboChartBuilder {
    this._dualAxis = true;
    return this;
  }

  /**
   * Disable dual Y-axis mode (all series on left axis).
   */
  singleAxis(): ComboChartBuilder {
    this._dualAxis = false;
    // Reset all series to left axis
    for (const series of this._series) {
      series.axis = 'left';
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Build Override
  // ---------------------------------------------------------------------------

  /**
   * Convert to ChartSpec with layered structure.
   */
  toSpec(): ChartSpec {
    if (this._series.length === 0) {
      // No series added - return basic spec
      return super.toSpec();
    }

    // Build layers from series
    const layers: UnitSpec[] = this._series.map((series, index) => {
      const layer: UnitSpec = {
        mark: {
          type: series.type,
          ...series.options,
        } as MarkSpec,
        encoding: {
          y: {
            field: series.field,
            type: 'quantitative',
            axis: this.buildAxisConfig(series, index),
          },
        },
      };
      return layer;
    });

    const spec: LayerSpec = {
      ...this._spec,
      layer: layers,
    };

    // Add shared X encoding at root level
    if (this._encoding.x) {
      spec.encoding = {
        x: this._encoding.x,
      };
    }

    // Add transforms if any
    if (this._transforms.length > 0) {
      spec.transform = this._transforms;
    }

    // Add config if any options set
    if (Object.keys(this._config).length > 0) {
      spec.config = this._config;
    }

    return spec;
  }

  /**
   * Build axis configuration for a series.
   */
  private buildAxisConfig(
    series: SeriesConfig,
    index: number,
  ): Partial<ChannelSpec['axis']> | null {
    if (!this._dualAxis) {
      // Single axis - only first series shows axis
      if (index === 0) {
        return {
          title: this._leftAxisTitle,
        };
      }
      return null;
    }

    // Dual axis mode
    const isRight = series.axis === 'right';
    const isFirstOfAxis = this._series.findIndex((s) => s.axis === series.axis) === index;

    if (!isFirstOfAxis) {
      // Not the first series on this axis - hide axis
      return null;
    }

    return {
      orient: isRight ? 'right' : 'left',
      title: isRight ? this._rightAxisTitle : this._leftAxisTitle,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new combo chart builder.
 *
 * @example
 * ```ts
 * // Bar + Line combo
 * const spec = ComboChart()
 *   .data(monthlyData)
 *   .x('month')
 *   .bar('sales')
 *   .line('profit', { axis: 'right', color: '#ff0000' })
 *   .leftAxisTitle('Sales ($)')
 *   .rightAxisTitle('Profit (%)')
 *   .title('Monthly Performance')
 *   .toSpec();
 *
 * // Multiple series
 * const spec = ComboChart()
 *   .data(data)
 *   .x('quarter')
 *   .bar('revenue', { color: '#4e79a7' })
 *   .bar('costs', { color: '#e15759' })
 *   .line('margin', { axis: 'right', smooth: true })
 *   .toSpec();
 * ```
 */
export function ComboChart(): ComboChartBuilder {
  return new ComboChartBuilder();
}

/**
 * Create a bar + line combo chart (shortcut).
 *
 * @param barField - Field for bar series
 * @param lineField - Field for line series
 */
export function BarLineCombo(barField?: string, lineField?: string): ComboChartBuilder {
  const builder = new ComboChartBuilder();
  if (barField) {
    builder.bar(barField);
  }
  if (lineField) {
    builder.line(lineField);
  }
  return builder;
}
