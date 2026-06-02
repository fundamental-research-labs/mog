import type { AnyScale, ResolvedEncodings, ScaleMap } from './encoding-resolver';
import {
  centeredScalePosition,
  groupDataByEncoding,
  invokeScale,
  isBlankValueDatum,
  splitDataByLineSegment,
} from './marks/helpers';
import type {
  AxisSpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  Layout,
  MarkSpec,
  MarkType,
} from './spec';
import type {
  CartesianGeometryLayerTrace,
  CartesianGeometryPointTrace,
  CartesianGeometryScaleTrace,
  CartesianGeometryTrace,
} from './types';

const CATEGORY_FIELD = 'category';
const SCATTER_X_FIELD = 'x';
const VALUE_FIELD = 'value';
const BUBBLE_SIZE_FIELD = 'size';
const RAW_BUBBLE_SIZE_FIELD = '__mogRawBubbleSize';
const CLIP_TO_PLOT_AREA_FIELD = '__mogClipToPlotArea';
const SERIES_INDEX_FIELD = '__mogSeriesIndex';
const SOURCE_SERIES_INDEX_FIELD = '__mogSourceSeriesIndex';
const SOURCE_SERIES_KEY_FIELD = '__mogSourceSeriesKey';
const POINT_INDEX_FIELD = '__mogPointIndex';

export interface CartesianGeometryLayerTraceInput {
  layerIndex: number;
  markType: MarkType;
  markSpec: MarkSpec;
  data: DataRow[];
  scales: ScaleMap;
  encodings: ResolvedEncodings;
  layout: Layout;
  encoding?: EncodingSpec;
  config?: ConfigSpec;
}

export function buildCartesianGeometryTrace(
  layout: Layout,
  layers: Array<CartesianGeometryLayerTrace | undefined>,
): CartesianGeometryTrace | undefined {
  const resolvedLayers = layers.filter(
    (layer): layer is CartesianGeometryLayerTrace => layer !== undefined,
  );
  if (resolvedLayers.length === 0) return undefined;

  return {
    coordinateSystem: 'chartPixel',
    chartWidth: roundCoordinate(layout.width),
    chartHeight: roundCoordinate(layout.height),
    plotArea: {
      x: roundCoordinate(layout.plotArea.x),
      y: roundCoordinate(layout.plotArea.y),
      width: roundCoordinate(layout.plotArea.width),
      height: roundCoordinate(layout.plotArea.height),
    },
    layers: resolvedLayers,
  };
}

export function collectCartesianGeometryLayerTrace(
  input: CartesianGeometryLayerTraceInput,
): CartesianGeometryLayerTrace | undefined {
  if (!isTraceableMarkType(input.markType)) return undefined;
  if (!input.scales.x || !input.scales.y) return undefined;

  const areaGeometry =
    input.markType === 'area'
      ? collectAreaGeometry(input)
      : {
          points:
            input.markType === 'line'
              ? collectLinePoints(input)
              : collectPointGeometry(input).points,
        };
  if (areaGeometry.points.length === 0) return undefined;

  const sizeScale = sizeScaleTrace(input);
  return {
    layerIndex: input.layerIndex,
    markType: input.markType,
    xField: input.encoding?.x?.field,
    yField: input.encoding?.y?.field,
    sizeField: input.encoding?.size?.field,
    xScale: scaleTrace(input.scales.x, input.encoding?.x, 'bottom'),
    yScale: scaleTrace(input.scales.y, input.encoding?.y, 'left'),
    ...(sizeScale ? { sizeScale } : {}),
    points: areaGeometry.points,
    ...(input.markType === 'area'
      ? {
          area: {
            baselinePixel: areaGeometry.baselinePixel,
            baselinePlotY:
              areaGeometry.baselinePixel !== undefined
                ? normalizePlotY(areaGeometry.baselinePixel, input.layout)
                : undefined,
          },
        }
      : {}),
  };
}

function collectLinePoints(input: CartesianGeometryLayerTraceInput): CartesianGeometryPointTrace[] {
  const xScale = input.scales.x;
  const yScale = input.scales.y;
  if (!xScale || !yScale) return [];

  const groups = groupDataByEncoding(input.data, input.encodings.color ?? input.encodings.detail);
  const points: CartesianGeometryPointTrace[] = [];
  let segmentIndex = 0;

  for (const [, groupData] of groups) {
    for (const segmentData of splitDataByLineSegment(groupData)) {
      const segmentPoints: CartesianGeometryPointTrace[] = [];
      for (const datum of segmentData) {
        if (isBlankValueDatum(datum)) continue;
        const x = centeredScalePosition(xScale, input.encodings.x?.accessor(datum));
        const y = centeredScalePosition(yScale, input.encodings.y?.accessor(datum));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        segmentPoints.push(pointTraceFromDatum(datum, x, y, input, { segmentIndex }));
      }
      segmentPoints.sort((a, b) => a.xPixel - b.xPixel);
      points.push(...segmentPoints);
      segmentIndex += 1;
    }
  }

  return points;
}

function collectPointGeometry(input: CartesianGeometryLayerTraceInput): {
  points: CartesianGeometryPointTrace[];
} {
  const xScale = input.scales.x;
  const yScale = input.scales.y;
  if (!xScale || !yScale) return { points: [] };

  const xFallback = rangeMidpoint(xScale);
  const yFallback = rangeMidpoint(yScale);
  const points: CartesianGeometryPointTrace[] = [];

  for (const datum of input.data) {
    if (isBlankValueDatum(datum)) continue;
    let x = centeredScalePosition(xScale, input.encodings.x?.accessor(datum));
    let y = centeredScalePosition(yScale, input.encodings.y?.accessor(datum));
    const invalidX = !Number.isFinite(x);
    const invalidY = !Number.isFinite(y);

    if (input.markSpec.skipInvalidPositions && (invalidX || invalidY)) continue;
    if (invalidX && invalidY) {
      x = xFallback;
      y = yFallback;
    } else if (invalidX) {
      x = xFallback;
    } else if (invalidY) {
      y = yFallback;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const sizeValue = numericValue(input.encodings.size?.accessor(datum));
    const renderedArea =
      sizeValue !== undefined
        ? positiveNumber(invokeScale<number>(input.scales.size, sizeValue))
        : positiveNumber(input.markSpec.size);
    points.push(
      pointTraceFromDatum(datum, x, y, input, {
        normalizedSize: sizeValue,
        renderedArea,
      }),
    );
  }

  return { points };
}

function collectAreaGeometry(input: CartesianGeometryLayerTraceInput): {
  points: CartesianGeometryPointTrace[];
  baselinePixel?: number;
} {
  const xScale = input.scales.x;
  const yScale = input.scales.y;
  if (!xScale || !yScale) return { points: [] };

  const groups = groupDataByEncoding(input.data, input.encodings.detail ?? input.encodings.color);
  const isStacked = input.config?.stack !== undefined && input.config.stack !== false;
  const isPercentStacked = input.config?.stack === 'normalize';
  const effectiveYScale = effectiveAreaYScale({
    isStacked,
    isPercentStacked,
    groups,
    encoding: input.encoding,
    layout: input.layout,
    fallbackScale: yScale,
  });
  const chartBaseline = input.layout.plotArea.y + input.layout.plotArea.height;
  const baselineValue =
    typeof input.markSpec.baseline === 'number' && Number.isFinite(input.markSpec.baseline)
      ? input.markSpec.baseline
      : isStacked
        ? 0
        : undefined;
  const scaledBaseline =
    baselineValue !== undefined ? centeredScalePosition(effectiveYScale, baselineValue) : NaN;
  const areaBaseline = Number.isFinite(scaledBaseline)
    ? clampYToPlot(scaledBaseline, input.layout)
    : chartBaseline;

  const positiveStackValues = new Map<string, number>();
  const negativeStackValues = new Map<string, number>();
  const positiveCategoryTotals = new Map<string, number>();
  const negativeCategoryTotals = new Map<string, number>();
  const positiveCategoryCumulative = new Map<string, number>();
  const negativeCategoryCumulative = new Map<string, number>();
  const positiveStackBaselineTracker = new Map<number, number>();
  const negativeStackBaselineTracker = new Map<number, number>();

  if (isStacked && isPercentStacked) {
    accumulatePercentTotals(groups, input.encoding, positiveCategoryTotals, negativeCategoryTotals);
  }

  const points: CartesianGeometryPointTrace[] = [];
  let segmentIndex = 0;
  for (const [, groupData] of groups) {
    for (const segmentData of splitDataByLineSegment(groupData)) {
      const topPoints: AreaTopPoint[] = [];
      const xField = input.encoding?.x?.field;
      const yField = input.encoding?.y?.field;

      for (const datum of segmentData) {
        if (isBlankValueDatum(datum)) continue;
        const x = centeredScalePosition(xScale, input.encodings.x?.accessor(datum));
        if (!Number.isFinite(x)) continue;

        if (isStacked && xField && yField) {
          const cat = String(datum[xField] ?? '');
          const rawValue = numericValue(datum[yField]) ?? 0;
          const stackSign = rawValue < 0 ? 'negative' : 'positive';

          if (isPercentStacked) {
            const totals =
              stackSign === 'negative' ? negativeCategoryTotals : positiveCategoryTotals;
            const cumulative =
              stackSign === 'negative'
                ? negativeCategoryCumulative
                : positiveCategoryCumulative;
            const total = totals.get(cat) || 1;
            const percentValue = total > 0 ? (rawValue / total) * 100 : 0;
            const cumStart = cumulative.get(cat) || 0;
            const stackValue = cumStart + percentValue;
            cumulative.set(cat, stackValue);
            const y = effectiveYScale(stackValue) as number;
            if (!Number.isFinite(y)) continue;
            topPoints.push({
              datum,
              x,
              y: clampYToPlot(y, input.layout),
              xKey: cat,
              stackSign,
              stackValue,
              percentValue,
            });
          } else {
            const stackValues =
              stackSign === 'negative' ? negativeStackValues : positiveStackValues;
            const previous = stackValues.get(cat) || 0;
            const stackValue = previous + rawValue;
            stackValues.set(cat, stackValue);
            const y = effectiveYScale(stackValue) as number;
            if (!Number.isFinite(y)) continue;
            topPoints.push({
              datum,
              x,
              y: clampYToPlot(y, input.layout),
              xKey: cat,
              stackSign,
              stackValue,
            });
          }
        } else {
          const y = centeredScalePosition(yScale, input.encodings.y?.accessor(datum));
          if (!Number.isFinite(y)) continue;
          topPoints.push({
            datum,
            x,
            y: clampYToPlot(y, input.layout),
            xKey: '',
          });
        }
      }

      topPoints.sort((a, b) => a.x - b.x);
      for (const topPoint of topPoints) {
        const bottomPixel = isStacked
          ? stackedBottomPixel(
              topPoint,
              areaBaseline,
              positiveStackBaselineTracker,
              negativeStackBaselineTracker,
            )
          : areaBaseline;
        points.push(
          pointTraceFromDatum(topPoint.datum, topPoint.x, topPoint.y, input, {
            segmentIndex,
            stackSign: topPoint.stackSign,
            stackValue: topPoint.stackValue,
            percentValue: topPoint.percentValue,
            baselinePixel: areaBaseline,
            topPixel: topPoint.y,
            bottomPixel,
          }),
        );
      }
      segmentIndex += 1;
    }
  }

  return { points, baselinePixel: roundCoordinate(areaBaseline) };
}

interface AreaTopPoint {
  datum: DataRow;
  x: number;
  y: number;
  xKey: string;
  stackSign?: 'positive' | 'negative';
  stackValue?: number;
  percentValue?: number;
}

function effectiveAreaYScale(input: {
  isStacked: boolean;
  isPercentStacked: boolean;
  groups: Map<string, DataRow[]>;
  encoding?: EncodingSpec;
  layout: Layout;
  fallbackScale: AnyScale;
}): AnyScale {
  if (!input.isStacked || Array.isArray(input.encoding?.y?.scale?.domain)) {
    return input.fallbackScale;
  }

  const xField = input.encoding?.x?.field;
  const yField = input.encoding?.y?.field;
  if (!xField || !yField) return input.fallbackScale;

  const rangeTop = input.layout.plotArea.y;
  const rangeBottom = input.layout.plotArea.y + input.layout.plotArea.height;
  if (input.isPercentStacked) {
    let hasPositive = false;
    let hasNegative = false;
    for (const [, groupData] of input.groups) {
      for (const datum of groupData) {
        const value = numericValue(datum[yField]) ?? 0;
        if (value > 0) hasPositive = true;
        if (value < 0) hasNegative = true;
      }
    }
    const percentMin = hasNegative ? -100 : 0;
    const percentMax = hasPositive ? 100 : 0;
    const span = percentMax === percentMin ? 100 : percentMax - percentMin;
    return Object.assign((value: unknown): number => {
      const numberValue = numericValue(value);
      if (numberValue === undefined) return rangeBottom;
      const t = (numberValue - percentMin) / span;
      return rangeBottom + t * (rangeTop - rangeBottom);
    }, {});
  }

  const positiveTotals = new Map<string, number>();
  const negativeTotals = new Map<string, number>();
  for (const [, groupData] of input.groups) {
    for (const datum of groupData) {
      const category = String(datum[xField] ?? '');
      const value = numericValue(datum[yField]) ?? 0;
      if (value >= 0) {
        positiveTotals.set(category, (positiveTotals.get(category) || 0) + value);
      } else {
        negativeTotals.set(category, (negativeTotals.get(category) || 0) + value);
      }
    }
  }

  let stackMax = 0;
  let stackMin = 0;
  for (const total of positiveTotals.values()) stackMax = Math.max(stackMax, total);
  for (const total of negativeTotals.values()) stackMin = Math.min(stackMin, total);
  const span = stackMax - stackMin;
  if (span <= 0) return input.fallbackScale;

  return Object.assign((value: unknown): number => {
    const numberValue = numericValue(value);
    if (numberValue === undefined) return rangeBottom;
    const t = (numberValue - stackMin) / span;
    return rangeBottom + t * (rangeTop - rangeBottom);
  }, {});
}

function accumulatePercentTotals(
  groups: Map<string, DataRow[]>,
  encoding: EncodingSpec | undefined,
  positiveTotals: Map<string, number>,
  negativeTotals: Map<string, number>,
): void {
  const xField = encoding?.x?.field;
  const yField = encoding?.y?.field;
  if (!xField || !yField) return;

  for (const [, groupData] of groups) {
    for (const datum of groupData) {
      const category = String(datum[xField] ?? '');
      const value = numericValue(datum[yField]) ?? 0;
      if (value >= 0) {
        positiveTotals.set(category, (positiveTotals.get(category) || 0) + value);
      } else {
        negativeTotals.set(category, (negativeTotals.get(category) || 0) + Math.abs(value));
      }
    }
  }
}

function stackedBottomPixel(
  point: AreaTopPoint,
  baselinePixel: number,
  positiveTracker: Map<number, number>,
  negativeTracker: Map<number, number>,
): number {
  const tracker = point.stackSign === 'negative' ? negativeTracker : positiveTracker;
  const xKey = Math.round(point.x * 100) / 100;
  const bottomPixel = tracker.get(xKey) ?? baselinePixel;
  tracker.set(xKey, point.y);
  return bottomPixel;
}

function pointTraceFromDatum(
  datum: DataRow,
  x: number,
  y: number,
  input: CartesianGeometryLayerTraceInput,
  extra: Partial<CartesianGeometryPointTrace> = {},
): CartesianGeometryPointTrace {
  const renderedArea = positiveNumber(extra.renderedArea);
  const result: CartesianGeometryPointTrace = {
    ...pointIdentity(datum),
    xPixel: roundCoordinate(x),
    yPixel: roundCoordinate(y),
    plotX: normalizePlotX(x, input.layout),
    plotY: normalizePlotY(y, input.layout),
    chartX: normalizeChartX(x, input.layout),
    chartY: normalizeChartY(y, input.layout),
    ...(renderedArea !== undefined
      ? {
          renderedArea: roundCoordinate(renderedArea),
          renderedRadius: roundCoordinate(Math.sqrt(renderedArea / Math.PI)),
        }
      : {}),
    ...definedExtraGeometry(input.layout, extra),
  };
  return result;
}

function pointIdentity(datum: DataRow): Partial<CartesianGeometryPointTrace> {
  const sourceSeriesKey = stringValue(datum[SOURCE_SERIES_KEY_FIELD]);
  const category = scalarValue(datum[CATEGORY_FIELD]);
  const clipToPlotArea = booleanValue(datum[CLIP_TO_PLOT_AREA_FIELD]);
  return {
    seriesIndex: integerValue(datum[SERIES_INDEX_FIELD]),
    sourceSeriesIndex: integerValue(datum[SOURCE_SERIES_INDEX_FIELD]),
    ...(sourceSeriesKey !== undefined ? { sourceSeriesKey } : {}),
    pointIndex: integerValue(datum[POINT_INDEX_FIELD]),
    ...(category !== undefined ? { category } : {}),
    xValue: numericValue(datum[SCATTER_X_FIELD]),
    yValue: numericValue(datum[VALUE_FIELD]),
    normalizedSize: numericValue(datum[BUBBLE_SIZE_FIELD]),
    rawBubbleSize: numericValue(datum[RAW_BUBBLE_SIZE_FIELD]),
    ...(clipToPlotArea !== undefined ? { clipToPlotArea } : {}),
  };
}

function definedExtraGeometry(
  layout: Layout,
  extra: Partial<CartesianGeometryPointTrace>,
): Partial<CartesianGeometryPointTrace> {
  return {
    ...(extra.segmentIndex !== undefined ? { segmentIndex: extra.segmentIndex } : {}),
    ...(extra.stackSign ? { stackSign: extra.stackSign } : {}),
    ...(extra.stackValue !== undefined ? { stackValue: roundCoordinate(extra.stackValue) } : {}),
    ...(extra.percentValue !== undefined
      ? { percentValue: roundCoordinate(extra.percentValue) }
      : {}),
    ...(extra.normalizedSize !== undefined
      ? { normalizedSize: roundCoordinate(extra.normalizedSize) }
      : {}),
    ...(extra.baselinePixel !== undefined
      ? {
          baselinePixel: roundCoordinate(extra.baselinePixel),
          baselinePlotY: normalizePlotY(extra.baselinePixel, layout),
        }
      : {}),
    ...(extra.topPixel !== undefined
      ? {
          topPixel: roundCoordinate(extra.topPixel),
          topPlotY: normalizePlotY(extra.topPixel, layout),
        }
      : {}),
    ...(extra.bottomPixel !== undefined
      ? {
          bottomPixel: roundCoordinate(extra.bottomPixel),
          bottomPlotY: normalizePlotY(extra.bottomPixel, layout),
        }
      : {}),
  };
}

function scaleTrace(
  scale: AnyScale | undefined,
  channel: EncodingSpec[keyof EncodingSpec] | undefined,
  defaultOrient: 'bottom' | 'left',
): CartesianGeometryScaleTrace | undefined {
  if (!scale || !channel || Array.isArray(channel)) return undefined;
  const axis = channel.axis && channel.axis !== null ? (channel.axis as AxisSpec) : undefined;
  const trace: CartesianGeometryScaleTrace = {
    field: channel.field,
    type: channel.type,
    axisOrient: axis?.orient ?? defaultOrient,
    domain: scale.domain?.().map(scalarValue).filter(isDefinedScalar),
    range: numericPair(scale.range?.()),
    tickValues: tickValues(scale, axis),
    tickStep: positiveNumber(axis?.tickStep),
  };
  return removeUndefinedScaleFields(trace);
}

function sizeScaleTrace(
  input: CartesianGeometryLayerTraceInput,
): CartesianGeometryScaleTrace | undefined {
  const channel = input.encoding?.size;
  if (!channel || Array.isArray(channel)) return undefined;

  const range =
    channel.scale === null ? undefined : numericPair(channel.scale?.range as unknown[] | undefined);
  const domain =
    numericPair(channel.scale?.domain as unknown[] | undefined) ??
    numericDataExtent(input.data, channel.field);
  return removeUndefinedScaleFields({
    field: channel.field,
    type: channel.type,
    domain,
    range,
  });
}

function tickValues(
  scale: AnyScale,
  axis: AxisSpec | undefined,
): Array<string | number | null> | undefined {
  const step = positiveNumber(axis?.tickStep);
  const domain = numericPair(scale.domain?.());
  if (step !== undefined && domain) {
    const [min, max] = domain;
    const values: number[] = [];
    const start = Math.ceil(min / step) * step;
    for (let value = start; value <= max + step * 1e-9; value += step) {
      values.push(roundCoordinate(value));
      if (values.length > 1000) break;
    }
    return values;
  }

  if (!scale.ticks) return undefined;
  const count = integerValue(axis?.tickCount);
  const values = scale.ticks(count);
  return values.map(scalarValue).filter(isDefinedScalar);
}

function removeUndefinedScaleFields(
  trace: CartesianGeometryScaleTrace,
): CartesianGeometryScaleTrace {
  return Object.fromEntries(
    Object.entries(trace).filter(([, value]) => value !== undefined),
  ) as CartesianGeometryScaleTrace;
}

function rangeMidpoint(scale: AnyScale): number {
  const range = numericPair(scale.range?.());
  return range ? (range[0] + range[1]) / 2 : NaN;
}

function clampYToPlot(y: number, layout: Layout): number {
  const top = layout.plotArea.y;
  const bottom = layout.plotArea.y + layout.plotArea.height;
  return Math.max(top, Math.min(bottom, y));
}

function normalizePlotX(x: number, layout: Layout): number {
  return normalizeCoordinate(x - layout.plotArea.x, layout.plotArea.width);
}

function normalizePlotY(y: number, layout: Layout): number {
  return normalizeCoordinate(y - layout.plotArea.y, layout.plotArea.height);
}

function normalizeChartX(x: number, layout: Layout): number {
  return normalizeCoordinate(x, layout.width);
}

function normalizeChartY(y: number, layout: Layout): number {
  return normalizeCoordinate(y, layout.height);
}

function normalizeCoordinate(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent === 0) return NaN;
  return roundCoordinate(value / extent);
}

function numericPair(values: unknown[] | undefined): [number, number] | undefined {
  if (!Array.isArray(values) || values.length < 2) return undefined;
  const first = numericValue(values[0]);
  const second = numericValue(values[1]);
  return first !== undefined && second !== undefined ? [first, second] : undefined;
}

function numericDataExtent(
  data: DataRow[],
  field: string | undefined,
): [number, number] | undefined {
  if (!field) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const datum of data) {
    const value = numericValue(datum[field]);
    if (value === undefined) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : undefined;
}

function isTraceableMarkType(markType: MarkType): boolean {
  return (
    markType === 'line' ||
    markType === 'area' ||
    markType === 'point' ||
    markType === 'circle' ||
    markType === 'square'
  );
}

function scalarValue(value: unknown): string | number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function isDefinedScalar(
  value: string | number | null | undefined,
): value is string | number | null {
  return value !== undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-9) return 0;
  return Number.parseFloat(value.toFixed(6));
}
