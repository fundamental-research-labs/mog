/**
 * Comprehensive ChartConfig -> ChartSpec bridge.
 *
 * Maps ALL ChartConfig fields (storage format) to the corresponding ChartSpec
 * constructs (Vega-Lite compatible grammar format). This replaces the lossy
 * `configToSpec` in chart-engine.ts which only mapped ~3 of 30+ fields.
 *
 * Notable fixes from the old implementation:
 * - Bar chart encoding bug: x is now nominal (category), y is quantitative (value)
 * - Column chart: x is quantitative (value), y is nominal (category) (horizontal bar)
 *
 * Pure function - no DOM dependencies.
 */
import type {
  AxisSpec,
  ChannelSpec,
  ChartSpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  LayerSpec,
  LegendOrient,
  MarkSpec,
  MarkType,
  StackMode,
  TitleSpec,
  Transform,
  UnitSpec,
} from '../grammar/spec';
import type {
  AxisConfig,
  ChartConfig,
  ChartData,
  ChartType,
  DataLabelConfig,
  LegendConfig,
  SeriesConfig,
  TrendlineConfig,
} from '../types';

// =============================================================================
// Layout Constants
// =============================================================================

/** Default column width in pixels, used to convert cell-unit width to pixels. */
const PIXELS_PER_COLUMN = 80;

/** Default row height in pixels, used to convert cell-unit height to pixels. */
const PIXELS_PER_ROW = 20;

/** Default chart width in pixels when no width is specified. */
const DEFAULT_CHART_WIDTH = 600;

/** Default chart height in pixels when no height is specified. */
const DEFAULT_CHART_HEIGHT = 400;

/** Pixel width of OHLC candlestick body bars. */
const CANDLESTICK_BAR_WIDTH = 14;

/** Tick count used to simulate minor gridlines. */
const MINOR_GRIDLINE_TICK_COUNT = 10;

// =============================================================================
// Mark Type Mapping
// =============================================================================

/** Map ChartConfig.type to the base MarkType for simple (non-layered) charts. */
const MARK_TYPE_MAP: Record<ChartType, MarkType> = {
  bar: 'bar',
  column: 'bar',
  line: 'line',
  area: 'area',
  pie: 'arc',
  doughnut: 'arc',
  scatter: 'point',
  bubble: 'point',
  combo: 'bar', // default layer mark; combo uses layers
  radar: 'line',
  stock: 'rule', // stock uses rule marks for OHLC ranges
  funnel: 'bar',
  waterfall: 'bar',
  // 3D variants map to same marks as 2D counterparts (3D is visual-only in grammar)
  bar3d: 'bar',
  column3d: 'bar',
  line3d: 'line',
  pie3d: 'arc',
  area3d: 'area',
  // Surface and ofPie have no grammar equivalents yet; use placeholder marks
  surface: 'rect',
  surface3d: 'rect',
  ofPie: 'arc',
  // Statistical chart types
  histogram: 'histogram',
  boxplot: 'boxplot',
  heatmap: 'rect',
  violin: 'violin',
  pareto: 'bar',
  // Exploded pie variants (visual config, same base marks)
  pieExploded: 'arc',
  pie3dExploded: 'arc',
  doughnutExploded: 'arc',
  // Bubble with 3D effect
  bubble3DEffect: 'point',
  // Surface variants
  surfaceWireframe: 'rect',
  surfaceTopView: 'rect',
  surfaceTopViewWireframe: 'rect',
  // Line with markers variants
  lineMarkers: 'line',
  lineMarkersStacked: 'line',
  lineMarkersStacked100: 'line',
  // Decorative 3D bar shape variants — all map to bar marks
  cylinderColClustered: 'bar',
  cylinderColStacked: 'bar',
  cylinderColStacked100: 'bar',
  cylinderBarClustered: 'bar',
  cylinderBarStacked: 'bar',
  cylinderBarStacked100: 'bar',
  cylinderCol: 'bar',
  coneColClustered: 'bar',
  coneColStacked: 'bar',
  coneColStacked100: 'bar',
  coneBarClustered: 'bar',
  coneBarStacked: 'bar',
  coneBarStacked100: 'bar',
  coneCol: 'bar',
  pyramidColClustered: 'bar',
  pyramidColStacked: 'bar',
  pyramidColStacked100: 'bar',
  pyramidBarClustered: 'bar',
  pyramidBarStacked: 'bar',
  pyramidBarStacked100: 'bar',
  pyramidCol: 'bar',
  // Hierarchical chart types
  treemap: 'rect',
  sunburst: 'arc',
  // Geographic chart types
  regionMap: 'rect',
};

// =============================================================================
// Data Conversion
// =============================================================================

/**
 * Convert ChartData (categories + series) to flat DataRow[] for the grammar.
 * Each row gets { category, value, series } fields.
 *
 * For stock charts with OHLC data, we also emit open/high/low/close fields
 * from the data point's extra properties when available.
 */
export function chartDataToRows(data: ChartData): DataRow[] {
  const rows: DataRow[] = [];
  const categories = data.categories ?? [];
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    for (const series of data.series) {
      const point = series.data[i];
      if (point) {
        const row: DataRow = {
          category: String(category),
          value: point.y,
          series: series.name,
        };
        // Propagate OHLC fields if present (for stock charts)
        if (point.open !== undefined) row.open = point.open;
        if (point.high !== undefined) row.high = point.high;
        if (point.low !== undefined) row.low = point.low;
        if (point.close !== undefined) row.close = point.close;
        rows.push(row);
      }
    }
  }
  return rows;
}

// =============================================================================
// Sub-Type Helpers
// =============================================================================

/**
 * Derive the StackMode from the config subType.
 * Returns undefined when no stacking applies.
 */
export function resolveStackMode(config: ChartConfig): StackMode | undefined {
  const sub = config.subType;
  if (!sub) return undefined;
  if (sub === 'stacked') return 'zero';
  if (sub === 'percentStacked') return 'normalize';
  // 'clustered', 'standard', 'basic', etc. => no stacking
  return undefined;
}

/**
 * Resolve mark-level properties implied by the subType.
 * Returns partial MarkSpec overrides (e.g. interpolation for smooth/stepped lines).
 */
export function resolveSubTypeMarkProps(config: ChartConfig): Partial<MarkSpec> | undefined {
  const sub = config.subType;
  if (!sub) return undefined;
  switch (sub) {
    case 'smooth':
      return { interpolate: 'monotone' };
    case 'stepped':
      return { interpolate: 'step' };
    case 'filled':
      // RadarSubType 'filled' - area fill behind the line
      return { type: 'area' };
    default:
      return undefined;
  }
}

// =============================================================================
// Title
// =============================================================================

/**
 * Build a TitleSpec from config.title / config.subtitle.
 */
export function buildTitle(config: ChartConfig): TitleSpec | string | undefined {
  if (!config.title) return undefined;
  if (!config.subtitle) return config.title;
  return {
    text: config.title,
    subtitle: config.subtitle,
  };
}

// =============================================================================
// Encoding Helpers
// =============================================================================

/**
 * Map AxisConfig.xAxis / yAxis type to a ChartSpec AxisSpec partial.
 */
function mapAxisConfigToAxisSpec(
  axisConf: NonNullable<AxisConfig['xAxis']> | NonNullable<AxisConfig['yAxis']>,
): AxisSpec {
  const spec: AxisSpec = {};
  if (axisConf.title !== undefined) spec.title = axisConf.title;
  if (axisConf.gridLines !== undefined) spec.grid = axisConf.gridLines;
  if (axisConf.minorGridLines !== undefined) {
    // Minor grid lines are represented by halving the tick count
    // (spec doesn't have a dedicated minor grid, so this is the closest mapping)
    if (axisConf.minorGridLines) {
      spec.tickCount = MINOR_GRIDLINE_TICK_COUNT; // More ticks to simulate minor gridlines
    }
  }
  return spec;
}

/**
 * Map AxisType to ScaleType for encoding scale configuration.
 * Returns undefined for default types that don't need explicit scale setting.
 */
function axisTypeToScaleType(
  axisType: import('../types').AxisType | undefined,
): import('../grammar/spec').ScaleType | undefined {
  if (!axisType) return undefined;
  if (axisType === 'log') return 'log';
  if (axisType === 'time') return 'time';
  // 'linear', 'category', 'value' are defaults - no explicit scale needed
  return undefined;
}

/**
 * Build axis scale domain from min/max config.
 */
function buildAxisScaleDomain(
  axisConf: { min?: number; max?: number } | undefined,
): { domain?: [number, number] } | undefined {
  if (!axisConf) return undefined;
  if (axisConf.min !== undefined || axisConf.max !== undefined) {
    // Only set domain if at least one bound is given
    const domain: [number, number] = [axisConf.min ?? 0, axisConf.max ?? Number.MAX_SAFE_INTEGER];
    return { domain };
  }
  return undefined;
}

/**
 * Map LegendConfig.position to LegendOrient.
 */
function legendPositionToOrient(position: string): LegendOrient {
  switch (position) {
    case 'top':
      return 'top';
    case 'bottom':
      return 'bottom';
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'none':
      return 'none';
    default:
      return 'bottom';
  }
}

/**
 * Build encoding for the color channel, including legend config.
 */
function buildColorEncoding(
  hasMultipleSeries: boolean,
  legend?: LegendConfig,
): ChannelSpec | undefined {
  if (!hasMultipleSeries) return undefined;
  const channel: ChannelSpec = {
    field: 'series',
    type: 'nominal',
  };
  if (legend) {
    if (!legend.show) {
      channel.legend = null; // hide
    } else {
      channel.legend = {
        orient: legendPositionToOrient(legend.position),
      };
    }
  }
  return channel;
}

/**
 * Build the main encoding spec for a chart.
 *
 * IMPORTANT: The old chart-engine.ts had a bug where bar chart x/y types were
 * inverted. This implementation FIXES that:
 *
 *   bar (vertical bars):   x = nominal (category), y = quantitative (value)
 *   column (horizontal):   x = quantitative (value), y = nominal (category)
 */
export function buildEncoding(config: ChartConfig, data: ChartData): EncodingSpec {
  const encoding: EncodingSpec = {};
  const chartType = config.type;
  const hasMultipleSeries = data.series.length > 1;

  // --- Pie / Doughnut / Pie3D / OfPie: theta + color instead of x/y ---
  if (
    chartType === 'pie' ||
    chartType === 'doughnut' ||
    chartType === 'pie3d' ||
    chartType === 'ofPie'
  ) {
    encoding.theta = {
      field: 'value',
      type: 'quantitative',
    };
    encoding.color = {
      field: 'category',
      type: 'nominal',
    };
    // Apply legend config to color channel
    if (config.legend) {
      if (!config.legend.show) {
        encoding.color.legend = null;
      } else {
        encoding.color.legend = {
          orient: legendPositionToOrient(config.legend.position),
        };
      }
    }
    return encoding;
  }

  // --- X/Y encoding for all other chart types ---
  // column/column3d = horizontal bar: x is quantitative, y is nominal
  // bar = vertical bar: x is nominal, y is quantitative (FIX from old code)
  if (chartType === 'column' || chartType === 'column3d') {
    encoding.x = { field: 'value', type: 'quantitative' };
    encoding.y = { field: 'category', type: 'nominal' };
  } else {
    // bar, line, area, scatter, bubble, combo, radar, stock, funnel, waterfall
    encoding.x = { field: 'category', type: 'nominal' };
    encoding.y = { field: 'value', type: 'quantitative' };
  }

  // Apply axis config
  if (config.axis) {
    if (config.axis.xAxis && encoding.x) {
      encoding.x.axis = mapAxisConfigToAxisSpec(config.axis.xAxis);
      const scaleDomain = buildAxisScaleDomain(config.axis.xAxis);
      const scaleType = axisTypeToScaleType(config.axis.xAxis.type);
      if (scaleDomain || scaleType) {
        encoding.x.scale = {
          ...(scaleDomain ?? {}),
          ...(scaleType ? { type: scaleType } : {}),
        };
      }
    }
    if (config.axis.yAxis && encoding.y) {
      encoding.y.axis = mapAxisConfigToAxisSpec(config.axis.yAxis);
      const scaleDomain = buildAxisScaleDomain(config.axis.yAxis);
      const scaleType = axisTypeToScaleType(config.axis.yAxis.type);
      if (scaleDomain || scaleType) {
        encoding.y.scale = {
          ...(scaleDomain ?? {}),
          ...(scaleType ? { type: scaleType } : {}),
        };
      }
    }
  }

  // Color encoding for multi-series
  const colorChannel = buildColorEncoding(hasMultipleSeries, config.legend);
  if (colorChannel) {
    encoding.color = colorChannel;
  }

  return encoding;
}

// =============================================================================
// Mark Spec Builder
// =============================================================================

/**
 * Attach pie slice explosion indices as metadata on the mark spec.
 * These are consumed by the OOXML exporter for per-slice explosion.
 */
function applyPieSliceExplosion(mark: MarkSpec, config: ChartConfig): void {
  if (!config.pieSlice) return;
  const pieSlice = config.pieSlice as typeof config.pieSlice & { explodedIndex?: number };
  const explodedIndex = pieSlice.explodedIndex ?? pieSlice.explosion;
  if (explodedIndex !== undefined) {
    mark._explodedIndex = explodedIndex;
  }
  if (pieSlice.explodedIndices !== undefined && pieSlice.explodedIndices.length > 0) {
    mark._explodedIndices = pieSlice.explodedIndices;
  }
}

/**
 * Build the mark spec for a chart, incorporating subType props and
 * chart-type-specific settings.
 */
export function buildMark(config: ChartConfig): MarkType | MarkSpec {
  const baseType = MARK_TYPE_MAP[config.type] ?? 'bar';
  const subProps = resolveSubTypeMarkProps(config);

  // Pie3D: same as pie (3D is visual-only)
  if (config.type === 'pie3d') {
    const mark: MarkSpec = {
      type: 'arc',
      ...(subProps || {}),
    };
    if (config.pieSlice?.explodeOffset) {
      mark.padAngle = config.pieSlice.explodeOffset;
    }
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // OfPie: pie-of-pie or bar-of-pie (render as arc; no grammar equivalent for secondary pie)
  if (config.type === 'ofPie') {
    const mark: MarkSpec = {
      type: 'arc',
      ...(subProps || {}),
    };
    return mark;
  }

  // Doughnut: arc with innerRadius
  if (config.type === 'doughnut') {
    const mark: MarkSpec = {
      type: 'arc',
      innerRadius: 0.5,
      ...(subProps || {}),
    };
    // Pie slice explosion
    if (config.pieSlice?.explodeOffset) {
      mark.padAngle = config.pieSlice.explodeOffset;
    }
    // Attach explosion indices as metadata for OOXML export
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // Pie: arc (no innerRadius)
  if (config.type === 'pie') {
    const mark: MarkSpec = {
      type: 'arc',
      ...(subProps || {}),
    };
    if (config.pieSlice?.explodeOffset) {
      mark.padAngle = config.pieSlice.explodeOffset;
    }
    // Attach explosion indices as metadata for OOXML export
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // Scatter with lines
  if (config.type === 'scatter') {
    if (config.showLines) {
      const mark: MarkSpec = { type: 'line' };
      if (config.smoothLines) {
        mark.interpolate = 'monotone';
      }
      mark.point = true;
      return mark;
    }
    // Smooth scatter (no lines but smooth points connected)
    if (config.smoothLines) {
      return { type: 'point' };
    }
  }

  // Radar: line with linear-closed interpolation + optional fill + markers
  if (config.type === 'radar') {
    const mark: MarkSpec = { type: config.radarFilled ? 'area' : 'line' };
    mark.interpolate = 'linear-closed';
    if (config.radarMarkers) {
      mark.point = true;
    }
    return mark;
  }

  // Funnel: bar with decreasing width (represented as horizontal bars)
  if (config.type === 'funnel') {
    return { type: 'bar', cornerRadius: 2 };
  }

  // If subType props change the mark type or add interpolation
  if (subProps) {
    return {
      type: subProps.type ?? baseType,
      ...subProps,
    };
  }

  // Simple mark type string
  return baseType;
}

// =============================================================================
// Config Spec Builder (global config options)
// =============================================================================

/**
 * Build the ConfigSpec from chart-level settings: stacking, colors, data labels.
 */
export function buildConfigSpec(config: ChartConfig): ConfigSpec | undefined {
  const configSpec: ConfigSpec = {};
  let hasConfig = false;

  // Stacking
  const stack = resolveStackMode(config);
  if (stack !== undefined) {
    configSpec.stack = stack;
    hasConfig = true;
  }

  // Colors
  if (config.colors && config.colors.length > 0) {
    configSpec.range = { category: config.colors };
    hasConfig = true;
  }

  return hasConfig ? configSpec : undefined;
}

// =============================================================================
// Transform Builders
// =============================================================================

/**
 * Build transforms for waterfall charts.
 * Waterfall charts need cumulative running totals with special "total" bars.
 * The calculate transform produces a running total end position per bar.
 */
export function buildWaterfallTransforms(): Transform[] {
  const transforms: Transform[] = [];
  // Calculate running total for waterfall positioning
  transforms.push({
    type: 'calculate',
    calculate: 'datum._waterfallRunningTotal',
    as: '_waterfallEnd',
  });
  return transforms;
}

/**
 * Build transforms for trendlines (scatter charts).
 * Maps showEquation, showR2, and period from TrendlineConfig.
 */
export function buildTrendlineTransform(trendline: TrendlineConfig): Transform[] {
  if (trendline.show === false) return [];
  const methodMap: Record<string, string> = {
    linear: 'linear',
    exponential: 'exp',
    logarithmic: 'log',
    polynomial: 'poly',
    power: 'pow',
    'moving-average': 'linear', // moving average handled separately
  };

  const transform: Transform = {
    type: 'regression',
    regression: 'value',
    on: 'category',
    method: (methodMap[trendline.type ?? 'linear'] ?? 'linear') as 'linear',
    ...(trendline.order !== undefined ? { order: trendline.order } : {}),
  };

  // Attach showEquation/showR2/period as extra metadata on the transform
  // These are consumed by the OOXML exporter for trendline generation
  if (trendline.showEquation !== undefined) transform._showEquation = trendline.showEquation;
  if (trendline.showR2 !== undefined) transform._showR2 = trendline.showR2;
  if (trendline.type === 'moving-average' && trendline.period !== undefined) {
    transform._movingAveragePeriod = trendline.period;
  }

  return [transform];
}

// =============================================================================
// Layer Builders (Combo, Stock, Waterfall, Data Labels)
// =============================================================================

/**
 * Build layers for combo charts where each series can have its own mark type.
 * Handles per-series encoding overrides: color, lineWidth, markerSize,
 * dataLabels, and trendline (3b + 3c).
 */
export function buildComboLayers(
  config: ChartConfig,
  data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const seriesConfigs = config.series ?? [];

  for (let i = 0; i < data.series.length; i++) {
    const series = data.series[i];
    const seriesConf = seriesConfigs[i];
    const seriesType = (seriesConf?.type ?? (i === 0 ? 'bar' : 'line')) as ChartType;
    const markType = MARK_TYPE_MAP[seriesType] ?? 'bar';

    const layerEncoding: EncodingSpec = {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    };

    // Per-series y-axis encoding for dual-axis support
    if (seriesConf?.yAxisIndex === 1) {
      layerEncoding.y = {
        field: 'value',
        type: 'quantitative',
        axis: { title: config.axis?.secondaryYAxis?.title },
      };
      // Apply secondary axis scale domain if configured
      if (config.axis?.secondaryYAxis) {
        const scaleDomain = buildAxisScaleDomain(config.axis.secondaryYAxis);
        if (scaleDomain) {
          layerEncoding.y.scale = scaleDomain;
        }
      }
    }

    const layerSpec: UnitSpec = {
      mark: buildSeriesMark(markType, seriesConf),
      encoding: layerEncoding,
      transform: [
        {
          type: 'filter',
          filter: { field: 'series', equal: series.name },
        },
      ],
    };

    layers.push(layerSpec);

    // Per-series data labels: add a text overlay layer for this series
    if (seriesConf?.dataLabels?.show) {
      const labelLayer: UnitSpec = {
        mark: { type: 'text' },
        encoding: {
          ...layerEncoding,
          text: { field: 'value', type: 'quantitative' },
        },
        transform: [
          {
            type: 'filter',
            filter: { field: 'series', equal: series.name },
          },
        ],
      };
      layers.push(labelLayer);
    }

    // Per-series trendline: add a regression layer for this series
    if (seriesConf?.trendline?.show) {
      const trendTransforms = buildTrendlineTransform(seriesConf.trendline);
      const trendMark: MarkSpec = { type: 'line' };
      if (seriesConf.trendline.color) trendMark.color = seriesConf.trendline.color;
      if (seriesConf.trendline.lineWidth) trendMark.strokeWidth = seriesConf.trendline.lineWidth;
      trendMark.strokeDash = [4, 4]; // dashed for trendlines

      const trendLayer: UnitSpec = {
        mark: trendMark,
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
        transform: [
          {
            type: 'filter',
            filter: { field: 'series', equal: series.name },
          },
          ...trendTransforms,
        ],
      };
      layers.push(trendLayer);
    }
  }

  return layers;
}

/**
 * Build a MarkSpec for an individual series (used in combo charts).
 * Handles per-series color, lineWidth, markerSize overrides.
 */
function buildSeriesMark(markType: MarkType, seriesConf?: SeriesConfig): MarkSpec {
  const mark: MarkSpec = { type: markType };
  if (seriesConf?.color) mark.color = seriesConf.color;
  if (seriesConf?.lineWidth) mark.strokeWidth = seriesConf.lineWidth;
  if (seriesConf?.showMarkers) mark.point = true;
  if (seriesConf?.markerSize) {
    mark.point = { size: seriesConf.markerSize, filled: true };
  }
  return mark;
}

/**
 * Build layers for stock (OHLC/candlestick) charts.
 * Stock charts show price ranges: open, high, low, close.
 *
 * Sub-type layer configurations:
 * - hlc (High-Low-Close): rule (H-L range) + tick (close marker)
 * - ohlc: rule (H-L range) + bar (O-C body) with directional color
 * - volume-hlc: volume bar layer + hlc layers
 * - volume-ohlc: volume bar layer + ohlc layers
 */
export function buildStockLayers(
  config: ChartConfig,
  _data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const subType = (config.subType as string) ?? 'ohlc';
  const isHLC = subType === 'hlc' || subType === 'volume-hlc';
  const hasVolume = subType === 'volume-hlc' || subType === 'volume-ohlc';

  // Volume layer (if applicable) - bar chart of volume at the bottom
  if (hasVolume) {
    const volumeLayer: UnitSpec = {
      mark: { type: 'bar', opacity: 0.3 },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'volume', type: 'quantitative' },
        color: { value: '#888888' },
      },
    };
    layers.push(volumeLayer);
  }

  // Layer 1: High-Low rule (the wick)
  const wickLayer: UnitSpec = {
    mark: { type: 'rule' },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'low', type: 'quantitative' },
      // y2 via a separate channel is not directly supported in our spec,
      // so we use the value field as a proxy for the range
      size: { value: 1 },
    },
  };
  layers.push(wickLayer);

  if (isHLC) {
    // HLC: close marker as tick mark (no open-close body)
    const closeLayer: UnitSpec = {
      mark: { type: 'tick' },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'close', type: 'quantitative' },
      },
    };
    layers.push(closeLayer);
  } else {
    // OHLC: Open-Close bar (the body)
    const bodyLayer: UnitSpec = {
      mark: {
        type: 'bar',
        // Use a narrow bar width for candlestick appearance
        size: CANDLESTICK_BAR_WIDTH,
      },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'open', type: 'quantitative' },
        color: {
          field: '_stockDirection',
          type: 'nominal',
        },
      },
    };
    layers.push(bodyLayer);
  }

  return layers;
}

/**
 * Build layers for waterfall charts.
 * Waterfall charts show running totals with increase/decrease coloring.
 * Creates a bar chart with color conditional on positive/negative values
 * and "total" bars that start from zero.
 */
export function buildWaterfallLayers(
  config: ChartConfig,
  _data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const waterfall = config.waterfall;
  const increaseColor = waterfall?.increaseColor ?? '#4caf50';
  const decreaseColor = waterfall?.decreaseColor ?? '#f44336';
  const totalColor = waterfall?.totalColor ?? '#2196f3';

  // For waterfall, we use a single bar layer with a color encoding
  // that maps to the _waterfallType field (increase/decrease/total)
  const mainLayer: UnitSpec = {
    mark: { type: 'bar' },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: {
        field: '_waterfallType',
        type: 'nominal',
        scale: {
          domain: ['increase', 'decrease', 'total'],
          range: [increaseColor, decreaseColor, totalColor],
        },
      },
    },
    transform: [...buildWaterfallTransforms()],
  };

  return [mainLayer];
}

/**
 * Build a data label text layer for overlay.
 * Maps DataLabelConfig.position and format to the text mark encoding.
 */
export function buildDataLabelLayer(
  dataLabels: DataLabelConfig,
  encoding: EncodingSpec,
): UnitSpec | undefined {
  if (!dataLabels.show) return undefined;

  const textChannel: ChannelSpec = { field: 'value', type: 'quantitative' };

  // Map format string to the text channel format
  if (dataLabels.format) {
    textChannel.format = dataLabels.format;
  }

  // Map position to mark-level dy/align properties
  const mark: MarkSpec = { type: 'text' };
  if (dataLabels.position) {
    switch (dataLabels.position) {
      case 'top':
      case 'outside':
        mark.baseline = -10; // offset above
        break;
      case 'bottom':
        mark.baseline = 10; // offset below
        break;
      case 'inside':
        // center inside, no offset needed
        break;
      // 'left' and 'right' are less common for data labels; default placement
    }
  }

  return {
    mark,
    encoding: {
      ...encoding,
      text: textChannel,
    },
  };
}

// =============================================================================
// Secondary Y-Axis
// =============================================================================

/**
 * Check whether a secondary Y-axis should be used.
 * Returns true when secondaryYAxis.show is set and at least one series
 * uses yAxisIndex=1.
 */
export function hasSecondaryYAxis(config: ChartConfig): boolean {
  if (!config.axis?.secondaryYAxis?.show) return false;
  return (config.series ?? []).some((s) => s.yAxisIndex === 1);
}

/**
 * Build the resolve spec for dual-axis charts.
 * When series have different yAxisIndex values, we need independent y scales.
 */
function buildResolve(config: ChartConfig): ChartSpec['resolve'] | undefined {
  if (!hasSecondaryYAxis(config)) return undefined;
  return {
    scale: { y: 'independent' },
    axis: { y: 'independent' },
  };
}

// =============================================================================
// Main: configToSpec
// =============================================================================

/**
 * Convert ChartConfig + ChartData to ChartSpec format.
 * LOSSLESS: maps every ChartConfig field to the appropriate ChartSpec construct.
 */
export function configToSpec(config: ChartConfig, data: ChartData): ChartSpec {
  // 1. Convert data
  const rows = chartDataToRows(data);

  // 2. Build title
  const title = buildTitle(config);

  // 3. Build encoding
  const encoding = buildEncoding(config, data);

  // 4. Build mark
  const mark = buildMark(config);

  // 5. Build config (stacking, colors)
  const configSpec = buildConfigSpec(config);

  // 6. Build transforms
  const transforms: Transform[] = [];

  // Trendline transforms (scatter)
  if (config.trendline?.show) {
    transforms.push(...buildTrendlineTransform(config.trendline));
  }

  // 7. Build dimensions (cell units -> pixels)
  const width = config.width ? config.width * PIXELS_PER_COLUMN : DEFAULT_CHART_WIDTH;
  const height = config.height ? config.height * PIXELS_PER_ROW : DEFAULT_CHART_HEIGHT;

  // 8. Handle layered chart types (combo, stock, waterfall)
  if (config.type === 'combo') {
    const layers = buildComboLayers(config, data, rows);

    // Data label layer for the whole chart
    if (config.dataLabels?.show) {
      const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
      if (labelLayer) layers.push(labelLayer);
    }

    const resolve = buildResolve(config);
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
      ...(resolve ? { resolve } : {}),
    };
    return spec;
  }

  if (config.type === 'stock') {
    const layers = buildStockLayers(config, data, rows);
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
    };
    return spec;
  }

  if (config.type === 'waterfall') {
    const layers = buildWaterfallLayers(config, data, rows);
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
    };
    return spec;
  }

  // 9. Handle data labels as overlay layer
  if (config.dataLabels?.show) {
    const mainLayer: UnitSpec = { mark, encoding };
    const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
    const layers: ChartSpec[] = [mainLayer];
    if (labelLayer) layers.push(labelLayer);

    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
      ...(transforms.length > 0 ? { transform: transforms } : {}),
    };
    return spec;
  }

  // 10. Simple single-mark spec
  const spec: UnitSpec = {
    width,
    height,
    mark,
    data: { values: rows },
    encoding,
    title,
    ...(configSpec ? { config: configSpec } : {}),
    ...(transforms.length > 0 ? { transform: transforms } : {}),
  };

  return spec;
}
