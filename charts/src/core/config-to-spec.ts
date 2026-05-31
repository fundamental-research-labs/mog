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
  MarkSpec,
  MarkType,
  ScaleSpec,
  Transform,
  UnitSpec,
} from '../grammar/spec';
import type { ChartConfig, ChartData, ChartDataPoint, ChartType, SeriesConfig } from '../types';
import { formatExcelSerialDateTick, formatTickValue } from '../grammar/axis-generator';
import { generateTicks, niceLinear } from '../primitives/scales/linear';
import {
  resolveFormatFillColor,
  resolveFormatFillOpacity,
  resolveLineColor,
  resolveSolidFillColor,
} from '../utils/chart-colors';
import {
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_WIDTH,
  MARK_TYPE_MAP,
  PIXELS_PER_COLUMN,
  PIXELS_PER_ROW,
  SERIES_OPACITY_FIELD,
} from './config-to-spec/constants';
import {
  buildAxisScaleSpec,
  categoryKeyForIndex,
  explicitDomainBound,
  isHorizontalBarType,
  mapAxisConfigToAxisSpec,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
  toFiniteNumber,
} from './config-to-spec/axis';
import { buildEncoding, isLegendShown } from './config-to-spec/encoding';
import { buildDataLabelLayer } from './config-to-spec/layers/data-labels';
import { buildStockLayers } from './config-to-spec/layers/stock';
import { buildWaterfallLayers } from './config-to-spec/layers/waterfall';
import { hasSecondaryYAxis } from './config-to-spec/secondary-axis';
import {
  applySeriesLineFormat,
  hasVisibleLineStyle,
  isNoFillNoLineSeries,
  resolveSeriesColor,
  resolvedCategoryColors,
} from './config-to-spec/series-style';
import { resolveStackMode, resolveSubTypeMarkProps } from './config-to-spec/subtypes';
import { buildTitle } from './config-to-spec/title';
import { buildTrendlineTransform, buildWaterfallTransforms } from './config-to-spec/transforms';
import { linePointsToCanvasPx } from './config-to-spec/units';

export {
  buildEncoding,
  buildDataLabelLayer,
  buildStockLayers,
  buildTitle,
  buildTrendlineTransform,
  buildWaterfallLayers,
  buildWaterfallTransforms,
  hasSecondaryYAxis,
  resolveStackMode,
  resolveSubTypeMarkProps,
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
export function chartDataToRows(data: ChartData, config?: ChartConfig): DataRow[] {
  const rows: DataRow[] = [];
  const categories = data.categories ?? [];
  const useExcelDateSerialCategories = config
    ? shouldUseDateSerialCategoryAxis(config, data, isHorizontalBarType(config.type))
    : false;
  const useStableCategoryKeys = shouldUseStableCategoryKeys(
    config,
    data,
    useExcelDateSerialCategories,
  );
  const seriesConfigs = config?.series ?? [];
  for (let i = 0; i < categories.length; i++) {
    const rawCategory = categories[i];
    const category = useExcelDateSerialCategories ? toFiniteNumber(rawCategory) : undefined;
    const rowCategory = useStableCategoryKeys
      ? categoryKeyForIndex(i)
      : (category ?? String(rawCategory));
    for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
      const series = data.series[seriesIndex];
      const point = series.data[i];
      if (point && shouldIncludePointInRows(point, config)) {
        const row: DataRow = {
          category: rowCategory,
          value: point.y,
          series: series.name,
        };
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfigs[seriesIndex]) ? 0 : 1;
        }
        const categoryFormatCode = data.categoryFormatCodes?.[i];
        if (categoryFormatCode) row.categoryFormatCode = categoryFormatCode;
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

function shouldIncludePointInRows(point: ChartDataPoint, config?: ChartConfig): boolean {
  if (!point.valueState || point.valueState === 'value') return true;
  if (point.valueState === 'blank') {
    return config?.displayBlanksAs === 'zero';
  }
  return false;
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

function applyImportedBarOutline(mark: MarkSpec, config: ChartConfig): void {
  if (MARK_TYPE_MAP[config.type] !== 'bar') return;
  const line = config.series?.find(
    (series) => !isNoFillNoLineSeries(series) && hasVisibleLineStyle(series.format?.line),
  )?.format?.line;
  if (!line) return;

  mark.stroke = resolveLineColor(line) ?? mark.stroke ?? '#000000';
  const strokeWidth = linePointsToCanvasPx(line.width);
  if (strokeWidth !== undefined) mark.strokeWidth = strokeWidth;
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
    const mark: MarkSpec = {
      type: subProps.type ?? baseType,
      ...subProps,
    };
    applyImportedBarOutline(mark, config);
    return mark;
  }

  if (baseType === 'bar') {
    const mark: MarkSpec = { type: baseType };
    applyImportedBarOutline(mark, config);
    return mark.stroke || mark.strokeWidth !== undefined ? mark : baseType;
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
export function buildConfigSpec(
  config: ChartConfig,
  encoding?: EncodingSpec,
  data?: ChartData,
): ConfigSpec | undefined {
  const configSpec: ConfigSpec = {};
  let hasConfig = false;

  // Stacking
  const stack = resolveStackMode(config);
  if (stack !== undefined) {
    configSpec.stack = stack;
    hasConfig = true;
  }

  if (typeof config.gapWidth === 'number') {
    configSpec.gapWidth = config.gapWidth;
    hasConfig = true;
  }
  if (typeof config.overlap === 'number') {
    configSpec.overlap = config.overlap;
    hasConfig = true;
  }

  // Colors
  const categoryColors = resolvedCategoryColors(config);
  if (categoryColors && categoryColors.length > 0) {
    configSpec.range = { category: categoryColors };
    hasConfig = true;
  }

  const background =
    resolveFormatFillColor(config.chartFormat) ??
    resolveSolidFillColor(config.chartArea?.fill) ??
    resolveFormatFillColor(config.chartArea?.format);
  if (background) {
    configSpec.background = background;
    hasConfig = true;
  }

  const leftYAxisLabelWidth =
    estimateNominalYAxisLabelWidth(encoding, data) ?? estimateYAxisLabelWidth(encoding);
  const rightYAxisLabelWidth = estimateSecondaryYAxisLabelWidth(config, data);
  const bottomMargin = estimateXAxisBottomMargin(encoding);
  if (
    leftYAxisLabelWidth !== undefined ||
    rightYAxisLabelWidth !== undefined ||
    bottomMargin !== undefined
  ) {
    configSpec.layoutHints = {
      ...(leftYAxisLabelWidth !== undefined
        ? { leftYAxisLabelWidth, yAxisLabelWidth: leftYAxisLabelWidth }
        : {}),
      ...(rightYAxisLabelWidth !== undefined ? { rightYAxisLabelWidth } : {}),
      ...(bottomMargin !== undefined ? { bottomMargin } : {}),
    };
    hasConfig = true;
  }

  return hasConfig ? configSpec : undefined;
}

function estimateNominalYAxisLabelWidth(
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): number | undefined {
  const y = encoding?.y;
  if (!y || y.type === 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  const labels = data?.categories ?? [];
  if (labels.length === 0) return undefined;

  const maxLabelLength = Math.max(0, ...labels.map((label) => String(label ?? '').length));
  if (maxLabelLength === 0) return undefined;

  const fontSize = y.axis?.labelFontSize ?? 11;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * 0.52);
  return Math.max(60, Math.min(660, estimatedWidth));
}

function estimateYAxisLabelWidth(encoding: EncodingSpec | undefined): number | undefined {
  const y = encoding?.y;
  if (!y || y.type !== 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  return estimateQuantitativeAxisLabelWidth(y.axis, y.scale, y.format);
}

function estimateSecondaryYAxisLabelWidth(
  config: ChartConfig,
  data: ChartData | undefined,
): number | undefined {
  if (!hasSecondaryYAxis(config, data)) return undefined;
  const secondaryAxis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;
  if (!secondaryAxis) return undefined;

  const axis = mapAxisConfigToAxisSpec(secondaryAxis);
  const scale = buildAxisScaleSpec(secondaryAxis, false);
  return estimateQuantitativeAxisLabelWidth(axis, scale, axis.format);
}

function estimateQuantitativeAxisLabelWidth(
  axis: AxisSpec | undefined,
  scale: ScaleSpec | null | undefined,
  format: string | undefined,
): number | undefined {
  if (axis?.labels === false) return undefined;

  const scaleDomain = Array.isArray(scale?.domain) ? scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined) return undefined;

  const tickCount = axis?.tickCount ?? 10;
  const domain =
    scale?.nice === false
      ? ([min, max] as [number, number])
      : niceLinear(min, max, typeof scale?.nice === 'number' ? scale.nice : tickCount);
  const ticks = generateTicks(domain[0], domain[1], tickCount);
  const values = ticks.length > 0 ? ticks : domain;
  const maxLabelLength = Math.max(
    0,
    ...values.map((value) => formatTickValue(value, format ?? axis?.format).length),
  );
  if (maxLabelLength === 0) return undefined;

  const fontSize = axis?.labelFontSize ?? 11;
  const maxMagnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const charWidthRatio = maxMagnitude >= 1_000_000 ? 0.6 : 0.52;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * charWidthRatio);
  return Math.max(36, Math.min(320, estimatedWidth));
}

function estimateXAxisBottomMargin(encoding: EncodingSpec | undefined): number | undefined {
  const x = encoding?.x;
  const y = encoding?.y;
  if (!x || x.axis === null || x.axis?.labels === false) return undefined;

  const labelAngle = x.axis?.labelAngle ?? 0;
  const fontSize = x.axis?.labelFontSize ?? 11;
  const labelPadding = x.axis?.labelPadding ?? (labelAngle ? 2 : 3);
  const tickExtent = x.axis?.ticks === false ? 0 : (x.axis?.tickSize ?? 6);

  if (Math.abs(labelAngle) > 1) {
    const labelWidth = estimateXAxisMaxLabelWidth(x, fontSize);
    const radians = (Math.abs(labelAngle) * Math.PI) / 180;
    const rotatedHeight = Math.sin(radians) * labelWidth + Math.cos(radians) * fontSize;
    return Math.max(40, Math.ceil(tickExtent + labelPadding + rotatedHeight + 8));
  }

  if (!y || y.type !== 'quantitative' || x.axis?.crossesAt !== 'automatic') {
    return undefined;
  }

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return undefined;

  return Math.max(24, Math.ceil(fontSize + labelPadding + 3));
}

function estimateXAxisMaxLabelWidth(x: ChannelSpec, fontSize: number): number {
  const axis = x.axis;
  const format = x.format ?? axis?.format;
  const scaleDomain = Array.isArray(x.scale?.domain) ? x.scale.domain : undefined;
  const candidates = scaleDomain?.filter((value) => value !== undefined) ?? [];
  if (candidates.length === 0) return fontSize * 8;

  const maxLabelLength = Math.max(
    1,
    ...candidates.map((value) => {
      const text =
        axis?.formatType === 'time'
          ? formatExcelSerialDateTick(value, format)
          : formatTickValue(value, format);
      return text.length;
    }),
  );
  return Math.ceil(maxLabelLength * fontSize * 0.52);
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
  const baseEncoding = buildEncoding(config, data);
  const xEncoding = baseEncoding.x ?? { field: 'category', type: 'nominal' };
  const yEncoding = baseEncoding.y ?? { field: 'value', type: 'quantitative' };
  const secondaryYAxis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;

  for (let i = 0; i < data.series.length; i++) {
    const series = data.series[i];
    const seriesConf = seriesConfigs[i];
    const fallbackComboType =
      config.type === 'combo' ? (i === 0 ? 'column' : 'line') : (config.type ?? 'line');
    const seriesType = (seriesConf?.type ?? series.type ?? fallbackComboType) as ChartType;
    const markType = MARK_TYPE_MAP[seriesType] ?? 'bar';
    const yAxisIndex = seriesConf?.yAxisIndex ?? series.yAxisIndex;

    const layerEncoding: EncodingSpec = {
      x: { ...xEncoding },
      y: { ...yEncoding, field: 'value', type: 'quantitative' },
    };

    // Per-series y-axis encoding for dual-axis support
    if (yAxisIndex === 1) {
      const secondaryAxis = secondaryYAxis;
      const secondaryAxisSpec = secondaryAxis ? mapAxisConfigToAxisSpec(secondaryAxis) : {};
      layerEncoding.y = {
        field: 'value',
        type: 'quantitative',
        axis: {
          ...secondaryAxisSpec,
          orient: 'right',
          grid: secondaryAxisSpec.grid ?? false,
          title: secondaryAxisSpec.title ?? secondaryAxis?.title ?? null,
        },
      };
      // Apply secondary axis scale domain if configured
      if (secondaryAxis) {
        const scaleSpec = buildAxisScaleSpec(secondaryAxis, false);
        if (scaleSpec) layerEncoding.y.scale = scaleSpec;
      }
    }

    const layerSpec: UnitSpec = {
      mark: buildSeriesMark(markType, seriesConf, i, config.type),
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
          x: { ...xEncoding },
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
function buildSeriesMark(
  markType: MarkType,
  seriesConf: SeriesConfig | undefined,
  seriesIndex: number,
  fallbackType?: ChartType,
): MarkSpec {
  const mark: MarkSpec = { type: markType };
  const color = seriesConf ? resolveSeriesColor(seriesConf, seriesIndex, fallbackType) : undefined;
  if (color) mark.color = color;
  applySeriesLineFormat(mark, seriesConf);
  const fillOpacity = resolveFormatFillOpacity(seriesConf?.format);
  if (fillOpacity !== undefined) {
    if (markType === 'area') {
      mark.fillOpacity = fillOpacity;
    } else if (markType === 'bar' || markType === 'point' || markType === 'arc') {
      mark.opacity = fillOpacity;
    }
  }
  if (seriesConf?.showMarkers) mark.point = true;
  if (seriesConf?.markerSize) {
    mark.point = { size: seriesConf.markerSize, filled: true };
  }
  return mark;
}

/**
 * Build the resolve spec for dual-axis charts.
 * When series have different yAxisIndex values, we need independent y scales.
 */
function buildResolve(config: ChartConfig, data?: ChartData): ChartSpec['resolve'] | undefined {
  if (!hasSecondaryYAxis(config, data)) return undefined;
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
  const rows = chartDataToRows(data, config);

  // 2. Build title
  const title = buildTitle(config);

  // 3. Build encoding
  const encoding = buildEncoding(config, data);

  // 4. Build mark
  const mark = buildMark(config);

  // 5. Build config (stacking, colors)
  const configSpec = buildConfigSpec(config, encoding, data);

  // 6. Build transforms
  const transforms: Transform[] = [];

  // Trendline transforms (scatter)
  if (config.trendline?.show) {
    transforms.push(...buildTrendlineTransform(config.trendline));
  }

  // 7. Build dimensions (cell units -> pixels)
  const width = config.width ? config.width * PIXELS_PER_COLUMN : DEFAULT_CHART_WIDTH;
  const height = config.height ? config.height * PIXELS_PER_ROW : DEFAULT_CHART_HEIGHT;

  // 8. Handle layered chart types (combo, stock, waterfall, dual-axis)
  if (config.type === 'combo' || hasSecondaryYAxis(config, data)) {
    const layers = buildComboLayers(config, data, rows);

    // Data label layer for the whole chart
    if (config.dataLabels?.show) {
      const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
      if (labelLayer) layers.push(labelLayer);
    }

    const resolve = buildResolve(config, data);
    const sharedEncoding: EncodingSpec | undefined =
      encoding.color && isLegendShown(config.legend) ? { color: { ...encoding.color } } : undefined;
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      ...(sharedEncoding ? { encoding: sharedEncoding } : {}),
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
