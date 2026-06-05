import type { AnyScale, ResolvedEncodings, ScaleMap } from './encoding-resolver';
import { centeredScalePosition, renderableDataRows } from './marks/helpers';
import type { DataRow, EncodingSpec, FieldType, Layout, MarkSpec, StockGlyphSubType } from './spec';
import {
  NATIVE_STOCK_GLYPH_PROFILE,
  nativeStockGlyphWidth,
  nativeStockTickLength,
} from './stock-glyph-profile';
import type {
  StockGlyphBodyRectTrace,
  StockGlyphDirection,
  StockGlyphLayerTrace,
  StockGlyphPointTrace,
  StockGlyphScaleTrace,
  StockGlyphSegmentRole,
  StockGlyphSegmentTrace,
  StockGlyphSurfaceTrace,
  StockGlyphTrace,
  StockGlyphVolumeRectTrace,
  StockGlyphXMode,
} from './types';

const CATEGORY_FIELD = 'category';
const POINT_INDEX_FIELD = '__mogPointIndex';
const STOCK_OPEN_FIELD = 'open';
const STOCK_HIGH_FIELD = 'high';
const STOCK_LOW_FIELD = 'low';
const STOCK_CLOSE_FIELD = 'close';
const STOCK_VOLUME_FIELD = 'volume';
const LEGACY_STOCK_SLOT_OCCUPANCY = 100 / 250;
const DEFAULT_VOLUME_SURFACE_HEIGHT_FRACTION = 0.24;

export interface StockGlyphGeometryInput {
  layerIndex: number;
  markSpec: MarkSpec;
  data: DataRow[];
  scales: ScaleMap;
  encodings: ResolvedEncodings;
  layout: Layout;
  encoding?: EncodingSpec;
}

export interface StockGlyphComputedPoint extends StockGlyphPointTrace {
  datum: DataRow;
}

export interface StockGlyphGeometryResult {
  layerIndex: number;
  subType: StockGlyphSubType;
  xMode: StockGlyphXMode;
  xField?: string;
  openField?: string;
  highField: string;
  lowField: string;
  closeField: string;
  volumeField?: string;
  renderedPointCount: number;
  categoryPitch: number;
  glyphWidth: number;
  gapWidth?: number;
  slotOccupancy?: number;
  tickLength: number;
  volumeBarWidth?: number;
  priceScale?: StockGlyphScaleTrace;
  volumeScale?: StockGlyphScaleTrace;
  volumeAxisPolicy?: MarkSpec['stockVolumeAxisPolicy'];
  highLowEndpointPolicy?: MarkSpec['stockHighLowEndpointPolicy'];
  volumeSurface?: StockGlyphSurfaceTrace;
  visual?: MarkSpec['stockVisual'];
  points: StockGlyphComputedPoint[];
}

export function calculateStockGlyphGeometry(
  input: StockGlyphGeometryInput,
): StockGlyphGeometryResult | undefined {
  const xScale = input.scales.x;
  const priceScale = input.scales.y;
  if (!xScale || !priceScale) return undefined;

  const fields = stockGlyphFields(input.markSpec);
  const subType = input.markSpec.stockSubType ?? inferStockSubType(input.data, fields);
  const visual = input.markSpec.stockVisual;
  const volumeAxisPolicy =
    input.markSpec.stockVolumeAxisPolicy ?? visual?.volumeAxisPolicy ?? 'separateVolumeAxis';
  const highLowEndpointPolicy =
    input.markSpec.stockHighLowEndpointPolicy ?? visual?.highLowEndpointPolicy;
  const renderData = renderableDataRows(input.data);
  const candidates = renderData
    .map((datum, dataIndex) => stockPointCandidate(datum, dataIndex, input, fields, subType))
    .filter((point): point is StockPointCandidate => point !== undefined)
    .sort((left, right) => left.xPixel - right.xPixel);
  if (candidates.length === 0) return undefined;

  const categoryPitch = categoryPitchForCandidates(candidates, xScale, input.layout);
  const priceGlyphMode =
    visual?.priceGlyphMode ??
    (subType === 'ohlc' || subType === 'volume-ohlc' ? 'ohlcTick' : 'hlcTick');
  const nativeTickProfile = usesNativeStockTickGeometryProfile(subType, priceGlyphMode);
  const slotOccupancy =
    visual?.slotOccupancy ??
    (nativeTickProfile ? NATIVE_STOCK_GLYPH_PROFILE.slotOccupancy : LEGACY_STOCK_SLOT_OCCUPANCY);
  const glyphWidth = nativeTickProfile
    ? nativeStockGlyphWidth(categoryPitch, slotOccupancy)
    : clamp(categoryPitch * slotOccupancy, 2, 18);
  const tickLength = nativeTickProfile
    ? nativeStockTickLength(categoryPitch, glyphWidth)
    : clamp(glyphWidth / 2, 2, 9);
  const stemStrokeWidth = positiveStrokeWidth(
    visual?.highLowLine.strokeWidth,
    nativeTickProfile ? NATIVE_STOCK_GLYPH_PROFILE.stemStrokeWidth : 1,
  );
  const openTickStrokeWidth = positiveStrokeWidth(
    visual?.openTick.strokeWidth,
    nativeTickProfile ? NATIVE_STOCK_GLYPH_PROFILE.tickStrokeWidth : stemStrokeWidth,
  );
  const closeTickStrokeWidth = positiveStrokeWidth(
    visual?.closeTick.strokeWidth,
    nativeTickProfile ? NATIVE_STOCK_GLYPH_PROFILE.tickStrokeWidth : stemStrokeWidth,
  );
  const renderVolumeGlyph =
    isVolumeStockSubType(subType) &&
    volumeAxisPolicy === 'separateVolumeAxis' &&
    (visual === undefined || visual.volume !== undefined);
  const volumeBarWidth = renderVolumeGlyph
    ? clamp(categoryPitch * (visual?.volume?.slotOccupancy ?? LEGACY_STOCK_SLOT_OCCUPANCY), 1, 24)
    : undefined;
  const volumeContext =
    volumeBarWidth !== undefined
      ? volumeGeometryContext({
          data: renderData,
          volumeField: fields.volumeField,
          layout: input.layout,
          width: volumeBarWidth,
          surfaceFraction:
            visual?.volume?.surfacePolicy.type === 'plotFraction'
              ? visual.volume.surfacePolicy.fraction
              : DEFAULT_VOLUME_SURFACE_HEIGHT_FRACTION,
        })
      : undefined;

  const points = candidates.map((candidate) =>
    stockGlyphPointFromCandidate({
      candidate,
      glyphWidth,
      tickLength,
      stemStrokeWidth,
      openTickStrokeWidth,
      closeTickStrokeWidth,
      volumeContext,
      layout: input.layout,
      priceGlyphMode,
    }),
  );

  return {
    layerIndex: input.layerIndex,
    subType,
    xMode: stockXMode(input.encoding),
    xField: input.encoding?.x?.field,
    openField: fields.openField,
    highField: fields.highField,
    lowField: fields.lowField,
    closeField: fields.closeField,
    volumeField: volumeContext ? fields.volumeField : undefined,
    renderedPointCount: points.length,
    categoryPitch: roundCoordinate(categoryPitch),
    glyphWidth: roundCoordinate(glyphWidth),
    ...(visual?.gapWidth !== undefined ? { gapWidth: visual.gapWidth } : {}),
    slotOccupancy: roundCoordinate(slotOccupancy),
    tickLength: roundCoordinate(tickLength),
    ...(volumeBarWidth !== undefined ? { volumeBarWidth: roundCoordinate(volumeBarWidth) } : {}),
    priceScale: scaleTrace(priceScale, input.encoding?.y, input.encoding?.y?.field),
    volumeAxisPolicy,
    ...(highLowEndpointPolicy !== undefined ? { highLowEndpointPolicy } : {}),
    ...(volumeContext
      ? {
          volumeScale: volumeContext.scale,
          volumeSurface: volumeContext.surface,
        }
      : {}),
    ...(visual ? { visual } : {}),
    points,
  };
}

export function collectStockGlyphLayerTrace(
  input: StockGlyphGeometryInput,
): StockGlyphLayerTrace | undefined {
  if (input.markSpec.type !== 'stockGlyph') return undefined;
  const geometry = calculateStockGlyphGeometry(input);
  if (!geometry) return undefined;

  return {
    layerIndex: geometry.layerIndex,
    markType: 'stockGlyph',
    subType: geometry.subType,
    xMode: geometry.xMode,
    ...(geometry.xField !== undefined ? { xField: geometry.xField } : {}),
    ...(geometry.openField !== undefined ? { openField: geometry.openField } : {}),
    highField: geometry.highField,
    lowField: geometry.lowField,
    closeField: geometry.closeField,
    ...(geometry.volumeField !== undefined ? { volumeField: geometry.volumeField } : {}),
    renderedPointCount: geometry.renderedPointCount,
    categoryPitch: geometry.categoryPitch,
    glyphWidth: geometry.glyphWidth,
    ...(geometry.gapWidth !== undefined ? { gapWidth: geometry.gapWidth } : {}),
    ...(geometry.slotOccupancy !== undefined ? { slotOccupancy: geometry.slotOccupancy } : {}),
    tickLength: geometry.tickLength,
    ...(geometry.volumeBarWidth !== undefined ? { volumeBarWidth: geometry.volumeBarWidth } : {}),
    ...(geometry.priceScale !== undefined ? { priceScale: geometry.priceScale } : {}),
    ...(geometry.volumeScale !== undefined ? { volumeScale: geometry.volumeScale } : {}),
    ...(geometry.volumeAxisPolicy !== undefined
      ? { volumeAxisPolicy: geometry.volumeAxisPolicy }
      : {}),
    ...(geometry.highLowEndpointPolicy !== undefined
      ? { highLowEndpointPolicy: geometry.highLowEndpointPolicy }
      : {}),
    ...(geometry.volumeSurface !== undefined ? { volumeSurface: geometry.volumeSurface } : {}),
    ...(geometry.visual !== undefined ? { visual: geometry.visual } : {}),
    points: geometry.points.map(stripDatum),
  };
}

export function buildStockGlyphTrace(
  layout: Layout,
  layers: Array<StockGlyphLayerTrace | undefined>,
): StockGlyphTrace | undefined {
  const resolvedLayers = layers.filter(
    (layer): layer is StockGlyphLayerTrace => layer !== undefined,
  );
  if (resolvedLayers.length === 0) return undefined;

  const first = resolvedLayers[0];
  const points = resolvedLayers.flatMap((layer) => layer.points);
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
    subType: first.subType,
    xMode: first.xMode,
    renderedPointCount: points.length,
    categoryPitch: first.categoryPitch,
    glyphWidth: first.glyphWidth,
    ...(first.gapWidth !== undefined ? { gapWidth: first.gapWidth } : {}),
    ...(first.slotOccupancy !== undefined ? { slotOccupancy: first.slotOccupancy } : {}),
    tickLength: first.tickLength,
    ...(first.volumeBarWidth !== undefined ? { volumeBarWidth: first.volumeBarWidth } : {}),
    ...(first.priceScale !== undefined ? { priceScale: first.priceScale } : {}),
    ...(first.volumeScale !== undefined ? { volumeScale: first.volumeScale } : {}),
    ...(first.volumeAxisPolicy !== undefined ? { volumeAxisPolicy: first.volumeAxisPolicy } : {}),
    ...(first.highLowEndpointPolicy !== undefined
      ? { highLowEndpointPolicy: first.highLowEndpointPolicy }
      : {}),
    ...(first.volumeSurface !== undefined ? { volumeSurface: first.volumeSurface } : {}),
    ...(first.visual !== undefined ? { visual: first.visual } : {}),
    layers: resolvedLayers,
    points,
  };
}

interface StockGlyphFields {
  openField: string;
  highField: string;
  lowField: string;
  closeField: string;
  volumeField: string;
}

interface StockPointCandidate {
  datum: DataRow;
  pointIndex: number;
  category: string | number | null;
  xPixel: number;
  highPixel: number;
  lowPixel: number;
  openPixel?: number;
  closePixel: number;
  openValue?: number;
  closeValue: number;
  volumeValue?: number;
}

interface VolumeGeometryContext {
  width: number;
  maxValue: number;
  surface: StockGlyphSurfaceTrace;
  scale: StockGlyphScaleTrace;
}

interface VolumeGeometryInput {
  data: DataRow[];
  volumeField: string;
  layout: Layout;
  width: number;
  surfaceFraction: number;
}

function stockGlyphFields(markSpec: MarkSpec): StockGlyphFields {
  return {
    openField: markSpec.stockOpenField ?? STOCK_OPEN_FIELD,
    highField: markSpec.stockHighField ?? STOCK_HIGH_FIELD,
    lowField: markSpec.stockLowField ?? STOCK_LOW_FIELD,
    closeField: markSpec.stockCloseField ?? STOCK_CLOSE_FIELD,
    volumeField: markSpec.stockVolumeField ?? STOCK_VOLUME_FIELD,
  };
}

function inferStockSubType(data: DataRow[], fields: StockGlyphFields): StockGlyphSubType {
  const hasOpen = data.some((datum) => finiteNumber(datum[fields.openField]) !== undefined);
  const hasVolume = data.some((datum) => finiteNumber(datum[fields.volumeField]) !== undefined);
  if (hasVolume) return hasOpen ? 'volume-ohlc' : 'volume-hlc';
  return hasOpen ? 'ohlc' : 'hlc';
}

function isVolumeStockSubType(subType: StockGlyphSubType): boolean {
  return subType === 'volume-hlc' || subType === 'volume-ohlc';
}

function usesNativeStockTickGeometryProfile(
  subType: StockGlyphSubType,
  priceGlyphMode: NonNullable<MarkSpec['stockVisual']>['priceGlyphMode'],
): boolean {
  return priceGlyphMode !== 'upDownBody' && (subType === 'hlc' || subType === 'ohlc');
}

function stockPointCandidate(
  datum: DataRow,
  dataIndex: number,
  input: StockGlyphGeometryInput,
  fields: StockGlyphFields,
  subType: StockGlyphSubType,
): StockPointCandidate | undefined {
  const xValue =
    input.encodings.x?.accessor(datum) ?? datum[input.encoding?.x?.field ?? CATEGORY_FIELD];
  const xPixel = centeredScalePosition(input.scales.x, xValue);
  if (!Number.isFinite(xPixel)) return undefined;

  const highValue = finiteNumber(datum[fields.highField]);
  const lowValue = finiteNumber(datum[fields.lowField]);
  const closeValue = finiteNumber(datum[fields.closeField]);
  const openValue = finiteNumber(datum[fields.openField]);
  if (highValue === undefined || lowValue === undefined || closeValue === undefined) {
    return undefined;
  }
  if ((subType === 'ohlc' || subType === 'volume-ohlc') && openValue === undefined) {
    return undefined;
  }

  const highPixel = centeredScalePosition(input.scales.y, highValue);
  const lowPixel = centeredScalePosition(input.scales.y, lowValue);
  const closePixel = centeredScalePosition(input.scales.y, closeValue);
  const openPixel =
    openValue !== undefined ? centeredScalePosition(input.scales.y, openValue) : undefined;
  if (![highPixel, lowPixel, closePixel].every(Number.isFinite)) return undefined;
  if (openValue !== undefined && !Number.isFinite(openPixel)) return undefined;

  return {
    datum,
    pointIndex: integerValue(datum[POINT_INDEX_FIELD]) ?? dataIndex,
    category: scalarValue(datum[input.encoding?.x?.field ?? CATEGORY_FIELD]) ?? null,
    xPixel,
    highPixel,
    lowPixel,
    closePixel,
    openPixel,
    openValue,
    closeValue,
    volumeValue: finiteNumber(datum[fields.volumeField]),
  };
}

function stockGlyphPointFromCandidate(input: {
  candidate: StockPointCandidate;
  glyphWidth: number;
  tickLength: number;
  stemStrokeWidth: number;
  openTickStrokeWidth: number;
  closeTickStrokeWidth: number;
  volumeContext: VolumeGeometryContext | undefined;
  layout: Layout;
  priceGlyphMode: NonNullable<MarkSpec['stockVisual']>['priceGlyphMode'];
}): StockGlyphComputedPoint {
  const {
    candidate,
    glyphWidth,
    tickLength,
    stemStrokeWidth,
    openTickStrokeWidth,
    closeTickStrokeWidth,
    volumeContext,
    layout,
    priceGlyphMode,
  } = input;
  const stem = segmentTrace(
    candidate.xPixel,
    candidate.highPixel,
    candidate.xPixel,
    candidate.lowPixel,
    layout,
    'highLowStem',
    stemStrokeWidth,
  );
  const drawTicks = priceGlyphMode !== 'upDownBody';
  const openTick =
    drawTicks && candidate.openPixel !== undefined
      ? segmentTrace(
          candidate.xPixel - tickLength,
          candidate.openPixel,
          candidate.xPixel,
          candidate.openPixel,
          layout,
          'openTick',
          openTickStrokeWidth,
        )
      : undefined;
  const closeTick = drawTicks
    ? segmentTrace(
        candidate.xPixel,
        candidate.closePixel,
        candidate.xPixel + tickLength,
        candidate.closePixel,
        layout,
        'closeTick',
        closeTickStrokeWidth,
      )
    : undefined;
  const direction = stockDirection(candidate.openValue, candidate.closeValue);
  const bodyRect =
    priceGlyphMode === 'upDownBody' && candidate.openPixel !== undefined
      ? bodyRectTrace(candidate, glyphWidth, direction, layout)
      : undefined;

  return {
    datum: candidate.datum,
    pointIndex: candidate.pointIndex,
    category: candidate.category,
    xPixel: roundCoordinate(candidate.xPixel),
    plotX: normalizePlotX(candidate.xPixel, layout),
    highPixel: roundCoordinate(candidate.highPixel),
    lowPixel: roundCoordinate(candidate.lowPixel),
    ...(candidate.openPixel !== undefined
      ? { openPixel: roundCoordinate(candidate.openPixel) }
      : {}),
    closePixel: roundCoordinate(candidate.closePixel),
    direction,
    stem,
    ...(openTick ? { openTick } : {}),
    ...(closeTick ? { closeTick } : {}),
    ...(bodyRect ? { bodyRect } : {}),
    ...(volumeContext && candidate.volumeValue !== undefined
      ? {
          volumeRect: volumeRectTrace(
            candidate.xPixel,
            candidate.volumeValue,
            volumeContext,
            layout,
          ),
        }
      : {}),
  };
}

function volumeGeometryContext(input: VolumeGeometryInput): VolumeGeometryContext | undefined {
  const values = input.data
    .map((datum) => finiteNumber(datum[input.volumeField]))
    .filter((value): value is number => value !== undefined && value >= 0);
  if (values.length === 0) return undefined;
  const maxValue = Math.max(...values, 1);
  const surfaceHeight = clamp(
    input.layout.plotArea.height * clamp(input.surfaceFraction, 0.12, 0.5),
    Math.min(24, input.layout.plotArea.height),
    input.layout.plotArea.height,
  );
  const surfaceY = input.layout.plotArea.y + input.layout.plotArea.height - surfaceHeight;
  const baselinePixel = surfaceY + surfaceHeight;
  const surface = surfaceTrace(
    input.layout.plotArea.x,
    surfaceY,
    input.layout.plotArea.width,
    surfaceHeight,
    input.layout,
    baselinePixel,
  );

  return {
    width: input.width,
    maxValue,
    surface,
    scale: {
      field: input.volumeField,
      type: 'quantitative',
      domain: [0, roundCoordinate(maxValue)],
      range: [roundCoordinate(baselinePixel), roundCoordinate(surfaceY)],
    },
  };
}

function bodyRectTrace(
  candidate: StockPointCandidate,
  width: number,
  direction: StockGlyphDirection,
  layout: Layout,
): StockGlyphBodyRectTrace {
  const openPixel = candidate.openPixel ?? candidate.closePixel;
  const top = Math.min(openPixel, candidate.closePixel);
  const rawHeight = Math.abs(candidate.closePixel - openPixel);
  const height = Math.max(rawHeight, 1);
  const y = rawHeight === 0 ? top - height / 2 : top;
  return {
    ...surfaceTrace(candidate.xPixel - width / 2, y, width, height, layout),
    openValue: roundCoordinate(candidate.openValue ?? candidate.closeValue),
    closeValue: roundCoordinate(candidate.closeValue),
    role: 'body',
    direction,
  };
}

function volumeRectTrace(
  xPixel: number,
  value: number,
  context: VolumeGeometryContext,
  layout: Layout,
): StockGlyphVolumeRectTrace {
  const surface = context.surface;
  const ratio = context.maxValue > 0 ? clamp(value / context.maxValue, 0, 1) : 0;
  const height = surface.height * ratio;
  const x = xPixel - context.width / 2;
  const y = surface.y + surface.height - height;
  return {
    ...surfaceTrace(x, y, context.width, height, layout, surface.baselinePixel),
    value: roundCoordinate(value),
    role: 'volumeBar',
  };
}

function segmentTrace(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layout: Layout,
  role: StockGlyphSegmentRole,
  strokeWidth: number,
): StockGlyphSegmentTrace {
  const snappedX1 = snapStockSegmentCoordinate(x1, strokeWidth);
  const snappedY1 = snapStockSegmentCoordinate(y1, strokeWidth);
  const snappedX2 = snapStockSegmentCoordinate(x2, strokeWidth);
  const snappedY2 = snapStockSegmentCoordinate(y2, strokeWidth);
  return {
    x1: roundCoordinate(snappedX1),
    y1: roundCoordinate(snappedY1),
    x2: roundCoordinate(snappedX2),
    y2: roundCoordinate(snappedY2),
    plotX1: normalizePlotX(snappedX1, layout),
    plotY1: normalizePlotY(snappedY1, layout),
    plotX2: normalizePlotX(snappedX2, layout),
    plotY2: normalizePlotY(snappedY2, layout),
    role,
  };
}

function surfaceTrace(
  x: number,
  y: number,
  width: number,
  height: number,
  layout: Layout,
  baselinePixel?: number,
): StockGlyphSurfaceTrace {
  return {
    x: roundCoordinate(x),
    y: roundCoordinate(y),
    width: roundCoordinate(width),
    height: roundCoordinate(height),
    plotX: normalizePlotX(x, layout),
    plotY: normalizePlotY(y, layout),
    plotWidth: normalizeExtent(width, layout.plotArea.width),
    plotHeight: normalizeExtent(height, layout.plotArea.height),
    ...(baselinePixel !== undefined ? { baselinePixel: roundCoordinate(baselinePixel) } : {}),
  };
}

function categoryPitchForCandidates(
  candidates: readonly StockPointCandidate[],
  xScale: AnyScale,
  layout: Layout,
): number {
  const bandwidth = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : undefined;
  if (typeof bandwidth === 'number' && Number.isFinite(bandwidth) && bandwidth > 0) {
    return bandwidth;
  }
  const step = typeof xScale.step === 'function' ? xScale.step() : undefined;
  if (typeof step === 'number' && Number.isFinite(step) && step > 0) {
    return step;
  }

  const xValues = candidates
    .map((point) => point.xPixel)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const deltas: number[] = [];
  for (let index = 1; index < xValues.length; index += 1) {
    const delta = xValues[index] - xValues[index - 1];
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length > 0) {
    deltas.sort((left, right) => left - right);
    return deltas[Math.floor(deltas.length / 2)];
  }

  return xValues.length > 1 ? layout.plotArea.width / (xValues.length - 1) : layout.plotArea.width;
}

function stockXMode(encoding: EncodingSpec | undefined): StockGlyphXMode {
  const x = encoding?.x;
  if (x?.field === CATEGORY_FIELD && x.type === 'quantitative') return 'dateSerial';
  if (x?.type === 'quantitative') return 'quantitative';
  return 'categoryPoint';
}

function stockDirection(
  openValue: number | undefined,
  closeValue: number | undefined,
): StockGlyphDirection {
  if (openValue === undefined || closeValue === undefined) return 'unknown';
  if (closeValue > openValue) return 'up';
  if (closeValue < openValue) return 'down';
  return 'flat';
}

function scaleTrace(
  scale: AnyScale | undefined,
  channel: EncodingSpec[keyof EncodingSpec] | undefined,
  fallbackField: string | undefined,
): StockGlyphScaleTrace | undefined {
  if (!scale || Array.isArray(channel)) return undefined;
  const trace: StockGlyphScaleTrace = {
    field: channel?.field ?? fallbackField,
    type: channel?.type as FieldType | undefined,
    domain: scale.domain?.().map(scalarValue).filter(isDefinedScalar),
    range: numericPair(scale.range?.()),
    tickValues: scale.ticks?.(channel?.axis?.tickCount).map(scalarValue).filter(isDefinedScalar),
    tickStep: positiveNumber(channel?.axis?.tickStep),
    scaleAuthorityStatus: channel?.scale?.scaleAuthorityStatus,
    scaleAuthority: channel?.scale?.scaleAuthority,
    scaleAuthorityReason: channel?.scale?.scaleAuthorityReason,
    zeroBaselinePolicy: channel?.scale?.zeroBaselinePolicy,
    zeroBaselineReason: channel?.scale?.zeroBaselineReason,
  };
  return removeUndefinedScaleFields(trace);
}

function stripDatum(point: StockGlyphComputedPoint): StockGlyphPointTrace {
  const { datum: _datum, ...tracePoint } = point;
  return tracePoint;
}

function removeUndefinedScaleFields(trace: StockGlyphScaleTrace): StockGlyphScaleTrace {
  return Object.fromEntries(
    Object.entries(trace).filter(([, value]) => value !== undefined),
  ) as StockGlyphScaleTrace;
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

function numericPair(values: unknown[] | undefined): [number, number] | undefined {
  if (!Array.isArray(values) || values.length < 2) return undefined;
  const first = finiteNumber(values[0]);
  const second = finiteNumber(values[1]);
  return first !== undefined && second !== undefined
    ? [roundCoordinate(first), roundCoordinate(second)]
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveStrokeWidth(value: unknown, fallback: number): number {
  const finite = finiteNumber(value);
  return finite !== undefined && finite > 0 ? finite : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? roundCoordinate(value)
    : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function normalizePlotX(x: number, layout: Layout): number {
  return normalizeExtent(x - layout.plotArea.x, layout.plotArea.width);
}

function normalizePlotY(y: number, layout: Layout): number {
  return normalizeExtent(y - layout.plotArea.y, layout.plotArea.height);
}

function normalizeExtent(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent === 0) return NaN;
  return roundCoordinate(value / extent);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapStockSegmentCoordinate(value: number, strokeWidth: number): number {
  if (!Number.isFinite(value)) return value;
  const roundedStrokeWidth = Math.max(1, Math.round(strokeWidth));
  const offset = roundedStrokeWidth % 2 === 1 ? 0.5 : 0;
  return Math.round(value - offset) + offset;
}

function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-9) return 0;
  return Number.parseFloat(value.toFixed(6));
}
