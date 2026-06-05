import type { AnyScale, ResolvedEncodings, ScaleMap } from './encoding-resolver';
import { resolveAxisCrossingPosition, type AxisCrossingPeerScaleKind } from './axis-generator';
import {
  centeredScalePosition,
  groupDataByEncoding,
  invokeScale,
  isBlankValueDatum,
  shouldSortPathByX,
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
  CartesianAreaSurfaceExtentTrace,
  CartesianAreaSurfaceStyleTrace,
  CartesianAxisCrossingTrace,
  CartesianGeometryLayerTrace,
  CartesianGeometryPointTrace,
  CartesianGeometryScaleTrace,
  CartesianGeometryTrace,
  CartesianPathAxisLayoutTrace,
} from './types';
import { areaStyleForDatum } from './marks/area';
import { resolveAreaSurfaceCaps } from './marks/area-surface-extent';

const CATEGORY_FIELD = 'category';
const SCATTER_X_FIELD = 'x';
const VALUE_FIELD = 'value';
const BUBBLE_SIZE_FIELD = 'size';
const RAW_BUBBLE_SIZE_FIELD = '__mogRawBubbleSize';
const SOURCE_BLANK_FIELD = '__mogSourceBlank';
const MARKER_SIZE_FIELD = '__mogMarkerSize';
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

  const areaGeometry = input.markType === 'area' ? collectAreaGeometry(input) : undefined;
  const points =
    areaGeometry?.points ??
    (input.markType === 'line' ? collectLinePoints(input) : collectPointGeometry(input).points);
  if (points.length === 0) return undefined;

  const sizeScale = sizeScaleTrace(input);
  const resolvedSizeAuthority = sizeAuthority(input);
  return {
    layerIndex: input.layerIndex,
    markType: input.markType,
    layerRole: layerRole(input, resolvedSizeAuthority),
    ...(resolvedSizeAuthority ? { sizeAuthority: resolvedSizeAuthority } : {}),
    ...(isPathMarkType(input.markType)
      ? { pathOrder: input.markSpec.pathOrder ?? 'xAscending' }
      : {}),
    xField: input.encoding?.x?.field,
    yField: input.encoding?.y?.field,
    sizeField: input.encoding?.size?.field,
    xScale: scaleTrace(input.scales.x, input.encoding?.x, 'bottom', axisCrossingTrace(input, 'x')),
    yScale: scaleTrace(input.scales.y, input.encoding?.y, 'left', axisCrossingTrace(input, 'y')),
    ...(sizeScale ? { sizeScale } : {}),
    points,
    ...(areaGeometry !== undefined
      ? {
          ...(areaGeometry.surfaceStyles.length > 0
            ? { areaSurfaceStyles: areaGeometry.surfaceStyles }
            : {}),
          ...(areaGeometry.surfaceExtents.length > 0
            ? { areaSurfaceExtents: areaGeometry.surfaceExtents }
            : {}),
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
      const sortByX = shouldSortPathByX(input.markSpec);
      for (const datum of segmentData) {
        if (isBlankValueDatum(datum)) continue;
        const x = centeredScalePosition(xScale, input.encodings.x?.accessor(datum));
        const y = centeredScalePosition(yScale, input.encodings.y?.accessor(datum));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        segmentPoints.push(pointTraceFromDatum(datum, x, y, input, { segmentIndex }));
      }
      if (sortByX) {
        segmentPoints.sort((a, b) => a.xPixel - b.xPixel);
      }
      points.push(
        ...segmentPoints.map((point, pathIndex) => ({
          ...point,
          pathIndex,
        })),
      );
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
  surfaceStyles: CartesianAreaSurfaceStyleTrace[];
  surfaceExtents: CartesianAreaSurfaceExtentTrace[];
  baselinePixel?: number;
} {
  const xScale = input.scales.x;
  const yScale = input.scales.y;
  if (!xScale || !yScale) return { points: [], surfaceStyles: [], surfaceExtents: [] };

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
  const surfaceStyles: CartesianAreaSurfaceStyleTrace[] = [];
  const surfaceExtents: CartesianAreaSurfaceExtentTrace[] = [];
  const surfaceStyleKeys = new Set<string>();
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
              stackSign === 'negative' ? negativeCategoryCumulative : positiveCategoryCumulative;
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

      if (shouldSortPathByX(input.markSpec)) {
        topPoints.sort((a, b) => a.x - b.x);
      }
      if (topPoints.length === 1 && input.markSpec.areaSurfaceExtentPolicy === undefined) {
        const point = topPoints[0];
        topPoints.push({ ...point, x: point.x + 1 });
      }
      const styleDatum = topPoints[0]?.datum;
      if (styleDatum) {
        const styleTrace = areaSurfaceStyleTrace(input, styleDatum, surfaceStyles.length);
        const styleKey = [
          styleTrace.seriesIndex ?? '',
          styleTrace.sourceSeriesKey ?? '',
          styleTrace.fill ?? '',
          styleTrace.fillOpacity ?? '',
          styleTrace.stroke ?? '',
          styleTrace.strokeWidth ?? '',
          styleTrace.strokeOpacity ?? '',
        ].join(':');
        if (!surfaceStyleKeys.has(styleKey)) {
          surfaceStyleKeys.add(styleKey);
          surfaceStyles.push(styleTrace);
        }
      }
      const extentTrace = areaSurfaceExtentTrace(input, topPoints, segmentIndex);
      if (extentTrace) surfaceExtents.push(extentTrace);
      for (let pathIndex = 0; pathIndex < topPoints.length; pathIndex += 1) {
        const topPoint = topPoints[pathIndex];
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
            pathIndex,
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

  return { points, surfaceStyles, surfaceExtents, baselinePixel: roundCoordinate(areaBaseline) };
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
    sourceBlank: booleanValue(datum[SOURCE_BLANK_FIELD]),
    ...(clipToPlotArea !== undefined ? { clipToPlotArea } : {}),
  };
}

function areaSurfaceStyleTrace(
  input: CartesianGeometryLayerTraceInput,
  datum: DataRow,
  styleIndex: number,
): CartesianAreaSurfaceStyleTrace {
  const style = areaStyleForDatum(input.markSpec, datum, input.scales, input.encodings, styleIndex);
  const fillPaint = style.fillPaint;
  const strokePaint = style.line?.paint ?? style.strokePaint;
  const fillOpacity = paintOpacity(fillPaint);
  const strokeWidth = style.line?.width ?? style.strokeWidth;
  const strokeDash = style.line?.dash ?? style.strokeDash;
  const strokeOpacity = effectiveOpacity(paintOpacity(strokePaint), style.line?.opacity);
  const fillPresent =
    fillPaint?.type === 'none' || style.fill !== undefined || fillPaint !== undefined;
  const strokePresent =
    strokePaint?.type === 'none' ||
    style.stroke !== undefined ||
    strokePaint !== undefined ||
    strokeWidth !== undefined;
  const status: CartesianAreaSurfaceStyleTrace['styleStatus'] =
    fillPresent || strokePresent ? 'exact' : 'missing';
  const identity = pointIdentity(datum);
  return {
    ...(identity.seriesIndex !== undefined ? { seriesIndex: identity.seriesIndex } : {}),
    ...(identity.sourceSeriesIndex !== undefined
      ? { sourceSeriesIndex: identity.sourceSeriesIndex }
      : {}),
    ...(identity.sourceSeriesKey !== undefined
      ? { sourceSeriesKey: identity.sourceSeriesKey }
      : {}),
    ...(typeof style.fill === 'string' ? { fill: style.fill } : {}),
    ...(fillPaint ? { fillPaintType: fillPaint.type } : {}),
    ...(fillOpacity !== undefined ? { fillOpacity } : {}),
    ...(typeof style.stroke === 'string' ? { stroke: style.stroke } : {}),
    ...(strokePaint ? { strokePaintType: strokePaint.type } : {}),
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    ...(strokeDash ? { strokeDash } : {}),
    ...(strokeOpacity !== undefined ? { strokeOpacity } : {}),
    styleStatus: status,
    ...(status === 'missing'
      ? { styleStatusReason: 'area surface has no renderable fill or stroke style' }
      : {}),
  };
}

function areaSurfaceExtentTrace(
  input: CartesianGeometryLayerTraceInput,
  topPoints: AreaTopPoint[],
  segmentIndex: number,
): CartesianAreaSurfaceExtentTrace | undefined {
  if (topPoints.length === 0) return undefined;
  const first = topPoints[0];
  const last = topPoints[topPoints.length - 1];
  const caps = resolveAreaSurfaceCaps({
    markSpec: input.markSpec,
    layout: input.layout,
    firstPointX: first.x,
    lastPointX: last.x,
  });
  const identity = pointIdentity(first.datum);
  return {
    ...(identity.seriesIndex !== undefined ? { seriesIndex: identity.seriesIndex } : {}),
    ...(identity.sourceSeriesIndex !== undefined
      ? { sourceSeriesIndex: identity.sourceSeriesIndex }
      : {}),
    ...(identity.sourceSeriesKey !== undefined
      ? { sourceSeriesKey: identity.sourceSeriesKey }
      : {}),
    segmentIndex,
    pointCount: topPoints.length,
    policy: caps.policy,
    firstPointX: roundCoordinate(caps.firstPointX),
    lastPointX: roundCoordinate(caps.lastPointX),
    leftCapX: roundCoordinate(caps.leftCapX),
    rightCapX: roundCoordinate(caps.rightCapX),
    firstPointPlotX: normalizePlotX(caps.firstPointX, input.layout),
    lastPointPlotX: normalizePlotX(caps.lastPointX, input.layout),
    leftCapPlotX: normalizePlotX(caps.leftCapX, input.layout),
    rightCapPlotX: normalizePlotX(caps.rightCapX, input.layout),
    clippingPolicy: caps.clippingPolicy,
    extentStatus: caps.status,
    ...(caps.statusReason ? { extentStatusReason: caps.statusReason } : {}),
  };
}

function paintOpacity(
  paint: { type: string; opacity?: number; stops?: Array<{ opacity?: number }> } | undefined,
): number | undefined {
  if (!paint || paint.type === 'none') return undefined;
  if (typeof paint.opacity === 'number' && Number.isFinite(paint.opacity)) return paint.opacity;
  if (!paint.stops || paint.stops.length === 0) return undefined;
  const first = paint.stops[0]?.opacity;
  if (typeof first !== 'number' || !Number.isFinite(first)) return undefined;
  return paint.stops.every((stop) => stop.opacity === first) ? first : undefined;
}

function effectiveOpacity(
  paintLevelOpacity: number | undefined,
  lineOpacity: number | undefined,
): number | undefined {
  if (paintLevelOpacity === undefined) return lineOpacity;
  if (lineOpacity === undefined) return paintLevelOpacity;
  return roundCoordinate(Math.max(0, Math.min(1, paintLevelOpacity * lineOpacity)));
}

function definedExtraGeometry(
  layout: Layout,
  extra: Partial<CartesianGeometryPointTrace>,
): Partial<CartesianGeometryPointTrace> {
  return {
    ...(extra.segmentIndex !== undefined ? { segmentIndex: extra.segmentIndex } : {}),
    ...(extra.pathIndex !== undefined ? { pathIndex: extra.pathIndex } : {}),
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

function isPathMarkType(markType: MarkType): boolean {
  return markType === 'line' || markType === 'area';
}

function layerRole(
  input: CartesianGeometryLayerTraceInput,
  resolvedSizeAuthority = sizeAuthority(input),
): CartesianGeometryLayerTrace['layerRole'] {
  if (input.markType === 'line') return 'linePath';
  if (input.markType === 'area') return 'areaFill';
  if (isPointMarkType(input.markType)) {
    return resolvedSizeAuthority === 'bubbleSize' ? 'bubble' : 'marker';
  }
  return undefined;
}

function sizeAuthority(
  input: CartesianGeometryLayerTraceInput,
): CartesianGeometryLayerTrace['sizeAuthority'] {
  if (!isPointMarkType(input.markType)) return undefined;
  const sizeField = input.encoding?.size?.field;
  if (sizeField === BUBBLE_SIZE_FIELD) return 'bubbleSize';
  if (sizeField === MARKER_SIZE_FIELD) return 'markerStyle';
  if (positiveNumber(input.markSpec.size) !== undefined) return 'fixedMarkSize';
  return undefined;
}

function isPointMarkType(markType: MarkType): boolean {
  return markType === 'point' || markType === 'circle' || markType === 'square';
}

function scaleTrace(
  scale: AnyScale | undefined,
  channel: EncodingSpec[keyof EncodingSpec] | undefined,
  defaultOrient: 'bottom' | 'left',
  crossing?: CartesianAxisCrossingTrace,
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
    crossing,
    pathAxisLayout: pathAxisLayoutTrace(axis),
  };
  return removeUndefinedScaleFields(trace);
}

function axisCrossingTrace(
  input: CartesianGeometryLayerTraceInput,
  axisRole: 'x' | 'y',
): CartesianAxisCrossingTrace | undefined {
  const channel = axisRole === 'x' ? input.encoding?.x : input.encoding?.y;
  if (!channel || Array.isArray(channel) || channel.axis === null) return undefined;
  const peerChannel = axisRole === 'x' ? input.encoding?.y : input.encoding?.x;
  const peerScale = axisRole === 'x' ? input.scales.y : input.scales.x;
  const axisSpec = (channel.axis && channel.axis !== null ? channel.axis : {}) as AxisSpec;
  const resolved = resolveAxisCrossingPosition({
    axisRole,
    axisSpec,
    peerScale,
    layout: input.layout,
    peerScaleKind: crossingPeerScaleKind(peerChannel, peerScale),
  });
  const renderedPixel = roundCoordinate(resolved.pixel);
  return {
    axisRole,
    axisOrient: resolved.axisOrient,
    peerScaleKind: resolved.peerScaleKind,
    effectiveMode: resolved.effectiveMode,
    renderedPixel,
    renderedPlotPosition:
      axisRole === 'x'
        ? normalizePlotY(renderedPixel, input.layout)
        : normalizePlotX(renderedPixel, input.layout),
    ...(resolved.sourceCrossing ? { sourceCrossing: resolved.sourceCrossing } : {}),
    ...(resolved.sourceCrossingValue !== undefined
      ? { sourceCrossingValue: resolved.sourceCrossingValue }
      : {}),
    ...(resolved.sourceCategoryCrossing
      ? { sourceCategoryCrossing: resolved.sourceCategoryCrossing }
      : {}),
    ...(resolved.categoryCrossingApplication
      ? { categoryCrossingApplication: resolved.categoryCrossingApplication }
      : {}),
  };
}

function crossingPeerScaleKind(
  channel: EncodingSpec[keyof EncodingSpec] | undefined,
  scale: AnyScale | undefined,
): AxisCrossingPeerScaleKind {
  if (channel && !Array.isArray(channel) && channel.type === 'temporal') return 'dateSerial';
  return typeof scale?.bandwidth === 'function' ? 'categoryPoint' : 'quantitative';
}

function pathAxisLayoutTrace(axis: AxisSpec | undefined): CartesianPathAxisLayoutTrace | undefined {
  if (!axis) return undefined;
  const trace: CartesianPathAxisLayoutTrace = {
    categoryTickLabelSkip: positiveInteger(axis.tickLabelSkip),
    categoryTickMarkSkip: positiveInteger(axis.tickMarkSkip),
    categoryTickSkipSource: axis.tickLabelSkipSource ?? axis.tickMarkSkipSource,
    axisLength: positiveNumber(axis.pathAxisLength),
    categoryPitch: positiveNumber(axis.pathCategoryPitch),
    labelBudget: positiveNumber(axis.pathLabelBudget),
    projectedLabelWidth: positiveNumber(axis.pathProjectedLabelWidth),
    visibleLabelCount: positiveInteger(axis.pathVisibleLabelCount),
    axisLayoutStatus: axis.axisLayoutStatus,
    axisLayoutStatusReason: axis.axisLayoutStatusReason,
    categoryAxisLayoutStatus: axis.pathCategoryAxisLayoutStatus,
    categoryAxisLayoutStatusReason: axis.pathCategoryAxisLayoutStatusReason,
    valueAxisLayoutStatus: axis.pathValueAxisLayoutStatus,
    valueAxisLayoutStatusReason: axis.pathValueAxisLayoutStatusReason,
    reservationStatus: axis.pathAxisReservationStatus,
    reservationStatusReason: axis.pathAxisReservationStatusReason,
  };
  const clean = Object.fromEntries(
    Object.entries(trace).filter(([, value]) => value !== undefined),
  ) as CartesianPathAxisLayoutTrace;
  return Object.keys(clean).length > 0 ? clean : undefined;
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

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
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
