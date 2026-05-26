/**
 * Base Chart Builder - Shared logic for all chart builders.
 *
 * Provides a fluent API base that all chart types extend.
 * Pure TypeScript, no framework dependencies.
 */

import type {
  AxisSpec,
  ChannelSpec,
  ChartSpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  FieldType,
  LegendSpec,
  MarkSpec,
  MarkType,
  ScaleSpec,
  TitleSpec,
  Transform,
  UnitSpec,
} from '../grammar/spec';

// =============================================================================
// Builder Interface
// =============================================================================

/**
 * Common interface for all chart builders using fluent API.
 */
export interface ChartBuilder<T extends ChartBuilder<T>> {
  /** Set inline data */
  data(data: DataRow[]): T;
  /** Set data from cell range (A1 notation) */
  dataFromRange(range: string): T;
  /** Set chart width */
  width(w: number): T;
  /** Set chart height */
  height(h: number): T;
  /** Set chart title */
  title(title: string | TitleSpec): T;
  /** Set theme name */
  theme(theme: string): T;
  /** Add a transform */
  transform(transform: Transform): T;
  /** Set configuration options */
  config(config: Partial<ConfigSpec>): T;
  /** Convert to ChartSpec (UnitSpec for single-mark, ChartSpec for potentially layered) */
  toSpec(): ChartSpec;
}

// =============================================================================
// Base Chart Builder Implementation
// =============================================================================

/**
 * Abstract base class for chart builders.
 * Provides common functionality for all chart types.
 */
export abstract class BaseChartBuilder<T extends BaseChartBuilder<T>> implements ChartBuilder<T> {
  protected _spec: Partial<UnitSpec> = {};
  protected _encoding: EncodingSpec = {};
  protected _config: ConfigSpec = {};
  protected _transforms: Transform[] = [];

  /**
   * Get this builder instance with proper typing for fluent API.
   */
  protected abstract self(): T;

  /**
   * Get the default mark type for this chart builder.
   */
  protected abstract getDefaultMark(): MarkType | MarkSpec;

  // ---------------------------------------------------------------------------
  // Data Methods
  // ---------------------------------------------------------------------------

  /**
   * Set inline data values.
   */
  data(data: DataRow[]): T {
    this._spec.data = { values: data };
    return this.self();
  }

  /**
   * Set data from a cell range (A1 notation).
   * The range will be resolved to CellIdRange by the engine.
   */
  dataFromRange(range: string): T {
    this._spec.data = { range };
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Dimension Methods
  // ---------------------------------------------------------------------------

  /**
   * Set chart width.
   */
  width(w: number): T {
    this._spec.width = w;
    return this.self();
  }

  /**
   * Set chart height.
   */
  height(h: number): T {
    this._spec.height = h;
    return this.self();
  }

  /**
   * Set auto-sizing mode.
   */
  autosize(mode: 'pad' | 'fit' | 'fit-x' | 'fit-y' | 'none'): T {
    this._spec.autosize = mode;
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Title Methods
  // ---------------------------------------------------------------------------

  /**
   * Set chart title.
   */
  title(title: string | TitleSpec): T {
    this._spec.title = title;
    return this.self();
  }

  /**
   * Set chart description.
   */
  description(description: string): T {
    this._spec.description = description;
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Theme and Config Methods
  // ---------------------------------------------------------------------------

  /**
   * Set theme name.
   */
  theme(theme: string): T {
    this._spec.theme = theme;
    return this.self();
  }

  /**
   * Set configuration options.
   */
  config(config: Partial<ConfigSpec>): T {
    this._config = { ...this._config, ...config };
    return this.self();
  }

  /**
   * Set background color.
   */
  background(color: string): T {
    this._config.background = color;
    return this.self();
  }

  /**
   * Set padding around the chart.
   */
  padding(padding: number | { top?: number; right?: number; bottom?: number; left?: number }): T {
    this._config.padding = padding;
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Transform Methods
  // ---------------------------------------------------------------------------

  /**
   * Add a data transform.
   */
  transform(transform: Transform): T {
    this._transforms.push(transform);
    return this.self();
  }

  /**
   * Add a filter transform.
   */
  filter(
    field: string,
    predicate: {
      equal?: unknown;
      lt?: number;
      lte?: number;
      gt?: number;
      gte?: number;
      oneOf?: unknown[];
      range?: [number, number];
    },
  ): T {
    this._transforms.push({
      type: 'filter',
      filter: { field, ...predicate },
    });
    return this.self();
  }

  /**
   * Add a sort transform.
   */
  sortBy(field: string, order: 'ascending' | 'descending' = 'ascending'): T {
    this._transforms.push({
      type: 'sort',
      sort: [{ field, order }],
    });
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Helper Methods for Encoding
  // ---------------------------------------------------------------------------

  /**
   * Create a channel spec from shorthand notation.
   */
  protected createChannelSpec(field: string, options?: Partial<ChannelSpec>): ChannelSpec {
    return { field, ...options };
  }

  /**
   * Set the X encoding channel.
   */
  protected setX(field: string, options?: Partial<ChannelSpec>): T {
    this._encoding.x = { field, ...options };
    return this.self();
  }

  /**
   * Set the Y encoding channel.
   */
  protected setY(field: string, options?: Partial<ChannelSpec>): T {
    this._encoding.y = { field, ...options };
    return this.self();
  }

  /**
   * Set the color encoding channel.
   */
  protected setColor(field: string, options?: Partial<ChannelSpec>): T {
    this._encoding.color = { field, ...options };
    return this.self();
  }

  /**
   * Set the size encoding channel.
   */
  protected setSize(field: string, options?: Partial<ChannelSpec>): T {
    this._encoding.size = { field, ...options };
    return this.self();
  }

  /**
   * Set the tooltip encoding.
   */
  protected setTooltip(fields: string | string[] | ChannelSpec[]): T {
    if (typeof fields === 'string') {
      this._encoding.tooltip = { field: fields };
    } else if (Array.isArray(fields)) {
      if (fields.length > 0 && typeof fields[0] === 'string') {
        this._encoding.tooltip = (fields as string[]).map((field) => ({
          field,
        }));
      } else {
        this._encoding.tooltip = fields as ChannelSpec[];
      }
    }
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Axis Configuration
  // ---------------------------------------------------------------------------

  /**
   * Configure X axis.
   */
  xAxis(axis: Partial<AxisSpec> | null): T {
    if (this._encoding.x) {
      this._encoding.x = { ...this._encoding.x, axis };
    }
    return this.self();
  }

  /**
   * Configure Y axis.
   */
  yAxis(axis: Partial<AxisSpec> | null): T {
    if (this._encoding.y) {
      this._encoding.y = { ...this._encoding.y, axis };
    }
    return this.self();
  }

  /**
   * Enable or disable grid lines.
   */
  grid(enabled: boolean): T {
    const gridConfig: Partial<AxisSpec> = { grid: enabled };
    if (this._encoding.x) {
      this._encoding.x = {
        ...this._encoding.x,
        axis: { ...(this._encoding.x.axis ?? {}), ...gridConfig },
      };
    }
    if (this._encoding.y) {
      this._encoding.y = {
        ...this._encoding.y,
        axis: { ...(this._encoding.y.axis ?? {}), ...gridConfig },
      };
    }
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Legend Configuration
  // ---------------------------------------------------------------------------

  /**
   * Configure the legend.
   */
  legend(legend: Partial<LegendSpec> | null): T {
    if (this._encoding.color) {
      this._encoding.color = { ...this._encoding.color, legend };
    }
    return this.self();
  }

  /**
   * Hide the legend.
   */
  hideLegend(): T {
    return this.legend(null);
  }

  // ---------------------------------------------------------------------------
  // Scale Configuration
  // ---------------------------------------------------------------------------

  /**
   * Configure X scale.
   */
  xScale(scale: Partial<ScaleSpec>): T {
    if (this._encoding.x) {
      this._encoding.x = {
        ...this._encoding.x,
        scale: { ...(this._encoding.x.scale ?? {}), ...scale },
      };
    }
    return this.self();
  }

  /**
   * Configure Y scale.
   */
  yScale(scale: Partial<ScaleSpec>): T {
    if (this._encoding.y) {
      this._encoding.y = {
        ...this._encoding.y,
        scale: { ...(this._encoding.y.scale ?? {}), ...scale },
      };
    }
    return this.self();
  }

  /**
   * Configure color scale.
   */
  colorScale(scale: Partial<ScaleSpec>): T {
    if (this._encoding.color) {
      this._encoding.color = {
        ...this._encoding.color,
        scale: { ...(this._encoding.color.scale ?? {}), ...scale },
      };
    }
    return this.self();
  }

  /**
   * Set color scheme.
   */
  colorScheme(scheme: string): T {
    this._config.scheme = scheme;
    return this.self();
  }

  /**
   * Set custom color range.
   */
  colors(colors: string[]): T {
    if (!this._config.range) {
      this._config.range = {};
    }
    this._config.range.category = colors;
    return this.self();
  }

  // ---------------------------------------------------------------------------
  // Build Methods
  // ---------------------------------------------------------------------------

  /**
   * Convert to a UnitSpec (single-mark chart specification).
   *
   * Subclasses that produce layered specs (e.g., combo charts, scatter with
   * trendlines) override this to return `ChartSpec` (the union type).
   */
  toSpec(): UnitSpec {
    const spec: UnitSpec = {
      ...this._spec,
      mark: this._spec.mark ?? this.getDefaultMark(),
      encoding: this._encoding,
    };

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
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Infer field type from data values.
 */
export function inferFieldType(values: unknown[]): FieldType {
  if (values.length === 0) return 'nominal';

  // Check first non-null value
  const firstValue = values.find((v) => v != null);
  if (firstValue === undefined) return 'nominal';

  if (typeof firstValue === 'number') {
    return 'quantitative';
  }

  if (firstValue instanceof Date) {
    return 'temporal';
  }

  if (typeof firstValue === 'string') {
    // Check if it looks like a date
    const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}/;
    if (datePattern.test(firstValue)) {
      return 'temporal';
    }

    // Check if it's a parseable number
    const num = parseFloat(firstValue);
    if (!isNaN(num) && isFinite(num)) {
      // It could be a number stored as string
      // But treat as nominal by default for safety
      return 'nominal';
    }
  }

  return 'nominal';
}

/**
 * Get unique values from a field in the data.
 */
export function getUniqueValues(data: DataRow[], field: string): unknown[] {
  const seen = new Set<unknown>();
  for (const row of data) {
    if (row[field] !== undefined) {
      seen.add(row[field]);
    }
  }
  return Array.from(seen);
}

/**
 * Get numeric extent (min, max) from a field.
 */
export function getNumericExtent(data: DataRow[], field: string): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;

  for (const row of data) {
    const value = row[field];
    if (typeof value === 'number' && isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  if (min === Infinity || max === -Infinity) {
    return null;
  }

  return [min, max];
}
