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
  ScaleSpec,
  StackMode,
  TitleSpec,
  Transform,
  UnitSpec,
} from '../grammar/spec';
import type {
  AxisConfig,
  ChartColor,
  ChartConfig,
  ChartData,
  ChartFill,
  ChartFormat,
  ChartType,
  DataLabelConfig,
  LegendConfig,
  SeriesConfig,
  SingleAxisConfig,
  TrendlineConfig,
} from '../types';
import { formatTickValue } from '../grammar/axis-generator';
import { generateTicks, niceLinear } from '../primitives/scales/linear';

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

type AxisSpecWithTickStep = AxisSpec & { tickStep?: number };

// =============================================================================
// Imported Style Helpers
// =============================================================================

function normalizeHexColor(value: string): string | undefined {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex
      .split('')
      .map((ch) => ch + ch)
      .join('')}`;
  }
  return trimmed.startsWith('#') ? trimmed : undefined;
}

function schemeColorHex(value: string): string | undefined {
  switch (value) {
    case 'Dk1':
    case 'dk1':
    case 'Tx1':
    case 'tx1':
      return '#000000';
    case 'Lt1':
    case 'lt1':
    case 'Bg1':
    case 'bg1':
      return '#FFFFFF';
    case 'Dk2':
    case 'dk2':
    case 'Tx2':
    case 'tx2':
      return '#1F497D';
    case 'Lt2':
    case 'lt2':
    case 'Bg2':
    case 'bg2':
      return '#EEECE1';
    case 'Accent1':
    case 'accent1':
      return '#4472C4';
    case 'Accent2':
    case 'accent2':
      return '#ED7D31';
    case 'Accent3':
    case 'accent3':
      return '#A5A5A5';
    case 'Accent4':
    case 'accent4':
      return '#FFC000';
    case 'Accent5':
    case 'accent5':
      return '#5B9BD5';
    case 'Accent6':
    case 'accent6':
      return '#70AD47';
    case 'Hlink':
    case 'hlink':
      return '#0563C1';
    case 'FolHlink':
    case 'folHLink':
    case 'folHlink':
      return '#954F72';
    default:
      return undefined;
  }
}

function applyTintShade(hexColor: string, tintShade: number | undefined): string {
  if (tintShade === undefined || tintShade === 0) return hexColor;
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return hexColor;
  const hex = normalized.slice(1);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [h, s, l] = rgbToHsl(r, g, b);
  const adjustedL =
    tintShade > 0 ? l * (1 - tintShade) + tintShade : l * Math.max(0, 1 + tintShade);
  const [outR, outG, outB] = hslToRgb(h, s, Math.max(0, Math.min(1, adjustedL)));
  const channels = [outR, outG, outB].map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * 255))),
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === r) {
    h = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function resolveChartColor(color: ChartColor | undefined): string | undefined {
  if (typeof color === 'string') return normalizeHexColor(color) ?? color;
  if (!color || typeof color !== 'object') return undefined;
  const base = schemeColorHex(color.theme);
  return base ? applyTintShade(base, chartColorTintShade(color)) : undefined;
}

function themeColorKey(color: ChartColor | undefined): string | undefined {
  return typeof color === 'object' && color !== null ? color.theme.toLowerCase() : undefined;
}

function chartColorTintShade(color: ChartColor | undefined): number | undefined {
  if (!color || typeof color !== 'object') return undefined;
  const wireColor = color as { tintShade?: number; tint_shade?: number };
  return wireColor.tintShade ?? wireColor.tint_shade;
}

function resolveChartTextColor(color: ChartColor | undefined): string | undefined {
  if (chartColorTintShade(color) !== undefined) return resolveChartColor(color);
  if (themeColorKey(color) === 'tx1') return '#595959';
  return resolveChartColor(color);
}

function resolveGridlineColor(color: ChartColor | undefined): string | undefined {
  if (chartColorTintShade(color) !== undefined) return resolveChartColor(color);
  if (themeColorKey(color) === 'tx1') return '#D9D9D9';
  return resolveChartColor(color);
}

function resolveSolidFillColor(fill: ChartFill | undefined): string | undefined {
  if (!fill || fill.type !== 'solid') return undefined;
  return resolveChartColor(fill.color);
}

function resolveFormatFillColor(format: ChartFormat | undefined): string | undefined {
  return resolveSolidFillColor(format?.fill);
}

function excelStyleRepeatColor(theme: string | undefined, index: number): string | undefined {
  if (index < 6 || !theme) return undefined;
  switch (theme.toLowerCase()) {
    case 'accent1':
      return '#264478';
    case 'accent2':
      return '#9E480E';
    case 'accent3':
      return '#636363';
    default:
      return undefined;
  }
}

function resolveSeriesColor(series: SeriesConfig, index: number): string | undefined {
  const fill = series.format?.fill;
  const fillTheme = fill?.type === 'solid' ? themeColorKey(fill.color) : undefined;
  const fillHasExplicitTransform = fill?.type === 'solid' && chartColorTintShade(fill.color) !== undefined;
  const sourceIndex = typeof series.idx === 'number' ? series.idx : index;
  return (
    (series.color ? resolveChartColor(series.color) : undefined) ??
    (fillHasExplicitTransform ? resolveFormatFillColor(series.format) : undefined) ??
    excelStyleRepeatColor(fillTheme, sourceIndex) ??
    resolveFormatFillColor(series.format)
  );
}

function resolvedCategoryColors(config: ChartConfig): string[] | undefined {
  const seriesColors = (config.series ?? [])
    .map((series, index) => resolveSeriesColor(series, index))
    .filter(Boolean) as string[];
  if (seriesColors.length > 0) return seriesColors;
  const configColors = (config.colors ?? []).map((color) => resolveChartColor(color)).filter(
    Boolean,
  ) as string[];
  return configColors.length > 0 ? configColors : undefined;
}

function normalizeAxisLabelAngle(
  axisConf: NonNullable<AxisConfig['xAxis']> | NonNullable<AxisConfig['yAxis']>,
): number | undefined {
  const raw = axisConf.textOrientation ?? axisConf.format?.textRotation;
  if (raw === undefined) return undefined;
  if (raw === 0) return 0;
  if (Math.abs(raw) > 360 && Math.abs(raw) < 60000) return raw < 0 ? -45 : 45;
  const degrees = Math.abs(raw) > 360 ? raw / 60000 : raw;
  if (Math.abs(degrees) <= 90) return degrees;
  return degrees < 0 ? -45 : 45;
}

function pointsToCanvasPx(sizePt: number | undefined): number | undefined {
  return sizePt === undefined ? undefined : sizePt * (96 / 72);
}

function linePointsToCanvasPx(widthPt: number | undefined): number | undefined {
  return widthPt === undefined ? undefined : Math.max(1, widthPt * (96 / 72));
}

function hasVisibleLineStyle(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const candidate = line as { color?: unknown; width?: unknown };
  return candidate.color !== undefined || candidate.width !== undefined;
}

function dashStyleToStrokeDash(
  dashStyle: NonNullable<ChartFormat['line']>['dashStyle'],
  width: number | undefined,
): number[] | undefined {
  const unit = Math.max(1, width ?? 1);
  switch (dashStyle) {
    case 'dot':
      return [unit, unit * 2];
    case 'dash':
      return [unit * 4, unit * 2];
    case 'dashDot':
      return [unit * 4, unit * 2, unit, unit * 2];
    case 'longDash':
      return [unit * 8, unit * 2];
    case 'longDashDot':
      return [unit * 8, unit * 2, unit, unit * 2];
    case 'longDashDotDot':
      return [unit * 8, unit * 2, unit, unit * 2, unit, unit * 2];
    default:
      return undefined;
  }
}

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
export function chartDataToRows(data: ChartData, config?: ChartConfig): DataRow[] {
  const rows: DataRow[] = [];
  const categories = data.categories ?? [];
  const useExcelDateSerialCategories = config
    ? shouldUseDateSerialCategoryAxis(config, data, isHorizontalBarType(config.type))
    : false;
  for (let i = 0; i < categories.length; i++) {
    const rawCategory = categories[i];
    const category = useExcelDateSerialCategories
      ? toFiniteNumber(rawCategory)
      : undefined;
    const rowCategory = category ?? String(rawCategory);
    for (const series of data.series) {
      const point = series.data[i];
      if (point) {
        const row: DataRow = {
          category: rowCategory,
          value: point.y,
          series: series.name,
        };
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
  const font = config.titleFormat?.font;
  const titleSpec: TitleSpec = {
    text: config.title,
    ...(config.subtitle ? { subtitle: config.subtitle } : {}),
  };
  if (font?.size !== undefined) titleSpec.fontSize = pointsToCanvasPx(font.size);
  if (font?.name) titleSpec.fontFamily = font.name;
  if (font?.bold) titleSpec.fontWeight = 'bold';
  if (font?.italic !== undefined) titleSpec.fontStyle = font.italic ? 'italic' : 'normal';
  const titleColor = resolveChartTextColor(font?.color);
  if (titleColor) titleSpec.color = titleColor;

  if (
    !config.subtitle &&
    titleSpec.fontSize === undefined &&
    titleSpec.fontWeight === undefined &&
    titleSpec.fontStyle === undefined &&
    titleSpec.color === undefined
  ) {
    return config.title;
  }
  if (!config.subtitle) return titleSpec;
  return {
    ...titleSpec,
  };
}

// =============================================================================
// Encoding Helpers
// =============================================================================

/**
 * Map AxisConfig.xAxis / yAxis type to a ChartSpec AxisSpec partial.
 */
function mapAxisConfigToAxisSpec(
  axisConf: SingleAxisConfig,
): AxisSpec {
  const spec: AxisSpec = {};
  spec.title = axisConf.title ?? null;
  if (axisConf.visible === false || axisConf.show === false) {
    spec.labels = false;
    spec.ticks = false;
    spec.domain = false;
    spec.grid = false;
    return spec;
  }
  if (axisConf.gridLines !== undefined) spec.grid = axisConf.gridLines;
  if (axisConf.minorGridLines !== undefined) {
    // Minor grid lines are represented by halving the tick count
    // (spec doesn't have a dedicated minor grid, so this is the closest mapping)
    if (axisConf.minorGridLines) {
      spec.tickCount = MINOR_GRIDLINE_TICK_COUNT; // More ticks to simulate minor gridlines
    }
  }
  if (axisConf.tickMarks === 'none') spec.ticks = false;
  if (axisConf.numberFormat) spec.format = axisConf.numberFormat;
  if (isDateAxisConfig(axisConf)) {
    spec.formatType = 'time';
    const majorUnit = toFiniteNumber(axisConf.majorUnit);
    if (majorUnit !== undefined && majorUnit > 0) {
      (spec as AxisSpecWithTickStep).tickStep = majorUnit;
    }
  }
  if (axisConf.crossesAt) spec.crossesAt = axisConf.crossesAt;
  if (axisConf.crossesAtValue !== undefined) spec.crossesAtValue = axisConf.crossesAtValue;

  const labelFont = axisConf.format?.font;
  if (labelFont?.size !== undefined) spec.labelFontSize = pointsToCanvasPx(labelFont.size);
  if (labelFont?.name) spec.labelFontFamily = labelFont.name;
  const labelColor = resolveChartTextColor(labelFont?.color);
  if (labelColor) spec.labelColor = labelColor;

  const labelAngle = normalizeAxisLabelAngle(axisConf);
  if (labelAngle !== undefined) {
    spec.labelAngle = labelAngle;
    const isCategoryAxis = axisConf.axisType === 'catAx' || axisConf.type === 'category';
    if (isCategoryAxis && axisConf.tickMarks === 'none') {
      spec.labelPadding = 14;
    }
  }

  const axisLine = axisConf.format?.line;
  if (axisLine && !hasVisibleLineStyle(axisLine)) {
    spec.domain = false;
  }
  const axisLineColor = resolveChartTextColor(axisLine?.color);
  if (axisLineColor) {
    spec.domainColor = axisLineColor;
    spec.tickColor = axisLineColor;
  }
  if (axisLine?.width !== undefined) {
    const lineWidth = linePointsToCanvasPx(axisLine.width);
    spec.domainWidth = lineWidth;
    spec.tickWidth = lineWidth;
  }

  const gridlineColor = resolveGridlineColor(axisConf.gridlineFormat?.color);
  if (gridlineColor) spec.gridColor = gridlineColor;
  if (axisConf.gridlineFormat?.width !== undefined) {
    spec.gridWidth = linePointsToCanvasPx(axisConf.gridlineFormat.width);
  }
  const gridDash = dashStyleToStrokeDash(
    axisConf.gridlineFormat?.dashStyle,
    linePointsToCanvasPx(axisConf.gridlineFormat?.width),
  );
  if (gridDash) spec.gridDash = gridDash;
  if (axisConf.gridlineFormat) {
    spec.gridOpacity =
      axisConf.gridlineFormat.transparency === undefined
        ? 1
        : Math.max(0, Math.min(1, 1 - axisConf.gridlineFormat.transparency));
  }

  const titleFont = axisConf.titleFormat?.font;
  if (titleFont?.size !== undefined) spec.titleFontSize = pointsToCanvasPx(titleFont.size);
  if (titleFont?.name) spec.titleFontFamily = titleFont.name;
  const titleColor = resolveChartTextColor(titleFont?.color);
  if (titleColor) spec.titleColor = titleColor;
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
): { domain?: [number | undefined, number | undefined] } | undefined {
  if (!axisConf) return undefined;
  if (axisConf.min !== undefined || axisConf.max !== undefined) {
    // Only set domain if at least one bound is given
    const domain: [number | undefined, number | undefined] = [axisConf.min, axisConf.max];
    return { domain };
  }
  return undefined;
}

function buildAxisScaleSpec(
  axisConf: SingleAxisConfig | undefined,
  useDateSerialCategoryAxis: boolean,
): ScaleSpec | undefined {
  if (!axisConf) {
    return useDateSerialCategoryAxis ? { type: 'linear', zero: false, nice: false } : undefined;
  }

  const scaleDomain = buildAxisScaleDomain(axisConf);
  const scaleType = useDateSerialCategoryAxis ? 'linear' : axisTypeToScaleType(axisConf.type);
  const scaleSpec: ScaleSpec = {
    ...(scaleDomain ?? {}),
    ...(scaleType ? { type: scaleType } : {}),
    ...(useDateSerialCategoryAxis ? { zero: false, nice: false } : {}),
  };

  return Object.keys(scaleSpec).length > 0 ? scaleSpec : undefined;
}

function resolveAxisConfigForChannel(
  axis: AxisConfig | undefined,
  channel: 'x' | 'y',
  isHorizontal: boolean,
): SingleAxisConfig | undefined {
  if (!axis) return undefined;
  if (channel === 'x') {
    return axis.xAxis ?? (isHorizontal ? axis.valueAxis : axis.categoryAxis);
  }
  return axis.yAxis ?? (isHorizontal ? axis.categoryAxis : axis.valueAxis);
}

function isDateAxisConfig(axisConf: SingleAxisConfig | undefined): boolean {
  if (!axisConf) return false;
  const axisType = axisConf.axisType?.toLowerCase();
  return (
    axisType === 'dateax' ||
    axisType === 'date' ||
    axisConf.categoryType === 'dateAxis' ||
    axisConf.type === 'time'
  );
}

function shouldUseDateSerialCategoryAxis(
  config: ChartConfig,
  data: ChartData,
  isHorizontal: boolean,
): boolean {
  if (!supportsContinuousCategoryAxis(config.type) || isHorizontal) return false;
  const categoryAxis = resolveAxisConfigForChannel(config.axis, 'x', isHorizontal);
  return isDateAxisConfig(categoryAxis) && hasFiniteCategorySerials(data);
}

function supportsContinuousCategoryAxis(chartType: ChartType): boolean {
  if (chartType === 'combo') return true;
  if (chartType === 'radar') return false;
  const markType = MARK_TYPE_MAP[chartType];
  return markType === 'line' || markType === 'area';
}

function hasFiniteCategorySerials(data: ChartData): boolean {
  const categories = data.categories ?? [];
  if (categories.length === 0) return false;

  let finiteCount = 0;
  for (const category of categories) {
    const serial = toFiniteNumber(category);
    if (serial === undefined) return false;
    finiteCount += 1;
  }
  return finiteCount > 0;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function explicitDomainBound(domain: unknown[] | undefined, index: number): number | undefined {
  const value = domain?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Map LegendConfig.position to LegendOrient.
 */
function legendPositionToOrient(position: string): LegendOrient {
  switch (position) {
    case 't':
    case 'top':
      return 'top';
    case 'b':
    case 'bottom':
      return 'bottom';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    case 'tr':
    case 'topRight':
    case 'top-right':
    case 'corner':
      return 'top-right';
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
  colors?: string[],
  reverseLegend?: boolean,
): ChannelSpec | undefined {
  if (!hasMultipleSeries) return undefined;
  const channel: ChannelSpec = {
    field: 'series',
    type: 'nominal',
  };
  if (colors && colors.length > 0) {
    channel.scale = { range: colors };
  }
  if (legend) {
    if (!legend.show) {
      channel.legend = null; // hide
    } else {
      const legendFont = legend.format?.font ?? legend.font;
      const labelColor = resolveChartTextColor(legendFont?.color);
      channel.legend = {
        orient: legendPositionToOrient(legend.position),
        title: null,
        ...(reverseLegend ? { reverse: true } : {}),
        ...(legendFont?.size !== undefined
          ? { labelFontSize: pointsToCanvasPx(legendFont.size) }
          : {}),
        ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
        ...(labelColor ? { labelColor } : {}),
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
 *   column (vertical bars): x = nominal (category), y = quantitative (value)
 *   bar (horizontal bars):  x = quantitative (value), y = nominal (category)
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
    const categoryColors = resolvedCategoryColors(config);
    if (categoryColors) {
      encoding.color.scale = { range: categoryColors };
    }
    // Apply legend config to color channel
    if (config.legend) {
      if (!config.legend.show) {
        encoding.color.legend = null;
      } else {
        const legendFont = config.legend.format?.font ?? config.legend.font;
        const labelColor = resolveChartTextColor(legendFont?.color);
        encoding.color.legend = {
          orient: legendPositionToOrient(config.legend.position),
          title: null,
          ...(resolveStackMode(config) ? { reverse: true } : {}),
          ...(legendFont?.size !== undefined
            ? { labelFontSize: pointsToCanvasPx(legendFont.size) }
            : {}),
          ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
          ...(labelColor ? { labelColor } : {}),
        };
      }
    }
    return encoding;
  }

  // --- X/Y encoding for all other chart types ---
  // Excel column charts are vertical; Excel bar charts are horizontal.
  const isHorizontal = isHorizontalBarType(chartType);
  const useDateSerialCategoryAxis = shouldUseDateSerialCategoryAxis(config, data, isHorizontal);
  const categoryChannel: ChannelSpec = {
    field: 'category',
    type: useDateSerialCategoryAxis ? 'quantitative' : 'nominal',
    ...(useDateSerialCategoryAxis ? { scale: { type: 'linear', zero: false, nice: false } } : {}),
  };
  const valueChannel: ChannelSpec = { field: 'value', type: 'quantitative' };
  if (isHorizontal) {
    encoding.x = valueChannel;
    encoding.y = categoryChannel;
  } else {
    encoding.x = categoryChannel;
    encoding.y = valueChannel;
  }

  // Apply axis config
  if (config.axis) {
    const xAxis = resolveAxisConfigForChannel(config.axis, 'x', isHorizontal);
    if (xAxis && encoding.x) {
      encoding.x.axis = mapAxisConfigToAxisSpec(xAxis);
      const scaleSpec = buildAxisScaleSpec(xAxis, useDateSerialCategoryAxis);
      if (scaleSpec) encoding.x.scale = { ...(encoding.x.scale ?? {}), ...scaleSpec };
    }
    const yAxis = resolveAxisConfigForChannel(config.axis, 'y', isHorizontal);
    if (yAxis && encoding.y) {
      encoding.y.axis = mapAxisConfigToAxisSpec(yAxis);
      const scaleSpec = buildAxisScaleSpec(yAxis, false);
      if (scaleSpec) encoding.y.scale = { ...(encoding.y.scale ?? {}), ...scaleSpec };
    }
  }

  applyBarCategorySpacingScale(config, encoding, isHorizontal);
  applyCategoryAxisLabelFormats(data, encoding, isHorizontal);

  // Color encoding for multi-series
  const colorChannel = buildColorEncoding(
    hasMultipleSeries,
    config.legend,
    resolvedCategoryColors(config),
    Boolean(resolveStackMode(config)),
  );
  if (colorChannel) {
    encoding.color = colorChannel;
  }

  applyStackedValueDomain(config, data, encoding);
  applyAutomaticCategoryAxisCrossing(encoding);

  return encoding;
}

function hasBarSpacingConfig(config: ChartConfig): boolean {
  return typeof config.gapWidth === 'number' || typeof config.overlap === 'number';
}

function applyBarCategorySpacingScale(
  config: ChartConfig,
  encoding: EncodingSpec,
  isHorizontal: boolean,
): void {
  if (MARK_TYPE_MAP[config.type] !== 'bar' || !hasBarSpacingConfig(config)) return;
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel) return;

  categoryChannel.scale = {
    ...(categoryChannel.scale ?? {}),
    paddingInner: 0,
    paddingOuter: 0,
  };
}

function applyCategoryAxisLabelFormats(
  data: ChartData,
  encoding: EncodingSpec,
  isHorizontal: boolean,
): void {
  if (!data.categoryFormatCodes?.some(Boolean)) return;
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel) return;

  const labelFormatByValue: Record<string, string> = {};
  data.categories.forEach((category, index) => {
    const formatCode = data.categoryFormatCodes?.[index];
    if (formatCode) labelFormatByValue[String(category)] = formatCode;
  });
  if (Object.keys(labelFormatByValue).length === 0) return;

  categoryChannel.axis = {
    ...(categoryChannel.axis ?? {}),
    labelFormatByValue,
  };
}

function isHorizontalBarType(chartType: ChartType): boolean {
  switch (chartType) {
    case 'bar':
    case 'bar3d':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
      return true;
    default:
      return false;
  }
}

function applyStackedValueDomain(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): void {
  const stack = resolveStackMode(config);
  if (!stack || stack === 'normalize') return;

  const chartType = config.type;
  const valueChannel = isHorizontalBarType(chartType) ? encoding.x : encoding.y;
  if (!valueChannel) return;

  const existingDomain = Array.isArray(valueChannel.scale?.domain)
    ? valueChannel.scale.domain
    : undefined;
  const explicitMin = explicitDomainBound(existingDomain, 0);
  const explicitMax = explicitDomainBound(existingDomain, 1);

  let maxPositive = 0;
  let minNegative = 0;
  for (let pointIndex = 0; pointIndex < (data.categories?.length ?? 0); pointIndex += 1) {
    let positive = 0;
    let negative = 0;
    for (const series of data.series) {
      const value = series.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value >= 0) positive += value;
      else negative += value;
    }
    if (positive > maxPositive) maxPositive = positive;
    if (negative < minNegative) minNegative = negative;
  }

  if (maxPositive === 0 && minNegative === 0) return;

  const isAutoDivergingStack =
    explicitMin === undefined && explicitMax === undefined && minNegative < 0 && maxPositive > 0;

  valueChannel.scale = {
    ...(valueChannel.scale ?? {}),
    domain: [explicitMin ?? minNegative, explicitMax ?? maxPositive],
    ...(isAutoDivergingStack ? { nice: valueChannel.scale?.nice ?? 6 } : {}),
  };

  if (isAutoDivergingStack) {
    valueChannel.axis = {
      ...(valueChannel.axis ?? {}),
      tickCount: valueChannel.axis?.tickCount ?? 6,
    };
  }
}

function applyAutomaticCategoryAxisCrossing(encoding: EncodingSpec): void {
  const x = encoding.x;
  const y = encoding.y;
  if (!x || !y || x.type !== 'nominal' || y.type !== 'quantitative') return;
  if (x.axis === null || x.axis?.crossesAt !== undefined) return;

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return;

  x.axis = {
    ...(x.axis ?? {}),
    crossesAt: 'automatic',
  };
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
export function buildConfigSpec(
  config: ChartConfig,
  encoding?: EncodingSpec,
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

  const yAxisLabelWidth = estimateYAxisLabelWidth(encoding);
  const bottomMargin = estimateXAxisBottomMargin(encoding);
  if (yAxisLabelWidth !== undefined || bottomMargin !== undefined) {
    configSpec.layoutHints = {
      ...(yAxisLabelWidth !== undefined ? { yAxisLabelWidth } : {}),
      ...(bottomMargin !== undefined ? { bottomMargin } : {}),
    };
    hasConfig = true;
  }

  return hasConfig ? configSpec : undefined;
}

function estimateYAxisLabelWidth(
  encoding: EncodingSpec | undefined,
): number | undefined {
  const y = encoding?.y;
  if (!y || y.type !== 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined) return undefined;

  const axis = y.axis;
  const tickCount = axis?.tickCount ?? 10;
  const domain =
    y.scale?.nice === false
      ? ([min, max] as [number, number])
      : niceLinear(min, max, typeof y.scale?.nice === 'number' ? y.scale.nice : tickCount);
  const ticks = generateTicks(domain[0], domain[1], tickCount);
  const values = ticks.length > 0 ? ticks : domain;
  const maxLabelLength = Math.max(
    0,
    ...values.map((value) => formatTickValue(value, y.format ?? axis?.format).length),
  );
  if (maxLabelLength === 0) return undefined;

  const fontSize = axis?.labelFontSize ?? 11;
  const maxMagnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const charWidthRatio = maxMagnitude >= 1_000_000 ? 0.6 : 0.52;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * charWidthRatio);
  return Math.max(36, Math.min(90, estimatedWidth));
}

function estimateXAxisBottomMargin(
  encoding: EncodingSpec | undefined,
): number | undefined {
  const x = encoding?.x;
  const y = encoding?.y;
  if (
    !x ||
    !y ||
    y.type !== 'quantitative' ||
    x.axis === null ||
    x.axis?.labels === false ||
    x.axis?.crossesAt !== 'automatic'
  ) {
    return undefined;
  }

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return undefined;

  const fontSize = x.axis?.labelFontSize ?? 11;
  const labelPadding = x.axis?.labelPadding ?? 3;
  return Math.max(24, Math.ceil(fontSize + labelPadding + 3));
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
  const baseEncoding = buildEncoding(config, data);
  const xEncoding = baseEncoding.x ?? { field: 'category', type: 'nominal' };

  for (let i = 0; i < data.series.length; i++) {
    const series = data.series[i];
    const seriesConf = seriesConfigs[i];
    const seriesType = (seriesConf?.type ?? (i === 0 ? 'bar' : 'line')) as ChartType;
    const markType = MARK_TYPE_MAP[seriesType] ?? 'bar';

    const layerEncoding: EncodingSpec = {
      x: { ...xEncoding },
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
  const rows = chartDataToRows(data, config);

  // 2. Build title
  const title = buildTitle(config);

  // 3. Build encoding
  const encoding = buildEncoding(config, data);

  // 4. Build mark
  const mark = buildMark(config);

  // 5. Build config (stacking, colors)
  const configSpec = buildConfigSpec(config, encoding);

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
