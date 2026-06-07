import {
  POINT_INDEX_FIELD,
  SERIES_INDEX_FIELD,
  SOURCE_SERIES_INDEX_FIELD,
  SOURCE_SERIES_KEY_FIELD,
  VALUE_FIELD,
} from '../core/chart-ir/fields';
import { SERIES_OPACITY_FIELD } from '../core/config-to-spec/constants';
import type { AnyMark, RectMark } from '../primitives/types';
import type { AnyScale, ResolvedEncodings, ScaleMap } from './encoding-resolver';
import { barSlotForDatum, createBarSlotContext } from './marks/bar-slot';
import { renderableDataRows } from './marks/helpers';
import type {
  BarGeometryGrouping,
  BarGeometryOrientation,
  BarGeometrySpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  Layout,
  MarkType,
} from './spec';
import type {
  BarGeometryGroupTrace,
  BarGeometryLayerTrace,
  BarGeometryTrace,
  BarGeometryTraceStatus,
  BarRectangleTrace,
} from './types';

const TRACE_TOLERANCE_PX = 0.5;

export interface BarGeometryLayerTraceInput {
  layerIndex: number;
  markType: MarkType;
  data: DataRow[];
  marks: AnyMark[];
  scales: ScaleMap;
  encodings: ResolvedEncodings;
  layout: Layout;
  encoding?: EncodingSpec;
  config?: ConfigSpec;
}

interface StackRange {
  sign: 'positive' | 'negative';
  start: number;
  end: number;
}

interface TraceValidation {
  status: BarGeometryTraceStatus;
  reason?: string;
}

export function buildBarGeometryTrace(
  layout: Layout,
  layers: Array<BarGeometryLayerTrace | undefined>,
): BarGeometryTrace | undefined {
  const resolvedLayers = layers.filter(
    (layer): layer is BarGeometryLayerTrace => layer !== undefined,
  );
  if (resolvedLayers.length === 0) return undefined;

  return {
    schemaVersion: 1,
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

export function collectBarGeometryLayerTrace(
  input: BarGeometryLayerTraceInput,
): BarGeometryLayerTrace | undefined {
  if (input.markType !== 'bar') return undefined;
  if (!input.scales.x || !input.scales.y) return undefined;

  const geometry = input.config?.barGeometry;
  const orientation = barOrientation(input.encoding, geometry);
  const categoryScale = orientation === 'horizontal' ? input.scales.y : input.scales.x;
  const valueScale = orientation === 'horizontal' ? input.scales.x : input.scales.y;
  if (!categoryScale || !valueScale) return undefined;

  const categoryField =
    geometry?.categoryAxisRole === 'y'
      ? input.encoding?.y?.field
      : geometry?.categoryAxisRole === 'x'
        ? input.encoding?.x?.field
        : orientation === 'horizontal'
          ? input.encoding?.y?.field
          : input.encoding?.x?.field;
  const valueField =
    geometry?.valueAxisRole === 'x'
      ? input.encoding?.x?.field
      : geometry?.valueAxisRole === 'y'
        ? input.encoding?.y?.field
        : orientation === 'horizontal'
          ? input.encoding?.x?.field
          : input.encoding?.y?.field;
  if (!categoryField || !valueField) return undefined;

  const renderData = renderableDataRows(input.data);
  const visibleRenderData = renderData.filter(
    (datum) => numericValue(datum[SERIES_OPACITY_FIELD]) !== 0,
  );
  const ownedSeries = seriesIndicesForGeometry(geometry, visibleRenderData);
  const ownedData = visibleRenderData.filter((datum) => {
    const seriesIndex = integerValue(datum[SERIES_INDEX_FIELD]);
    return !ownedSeries || (seriesIndex !== undefined && ownedSeries.includes(seriesIndex));
  });
  const categoryDomain = categoryDomainForScale(categoryScale, ownedData, categoryField);
  const categoryIndexByKey = categoryIndexLookup(categoryDomain);
  const categoryAxisLength =
    orientation === 'horizontal' ? input.layout.plotArea.height : input.layout.plotArea.width;
  const categoryPitch = scaleStep(
    categoryScale,
    categoryDomain.length > 0 ? categoryAxisLength / categoryDomain.length : categoryAxisLength,
  );
  const fullBandSize = scaleBandwidth(categoryScale, categoryPitch);
  const slotContext = createBarSlotContext(renderData, input.encoding, input.config, input.scales, {
    preferScaleDomain: true,
  });
  const rectanglesByDatum = rectMarksByDatum(input.marks);
  const baselinePixel = baselinePixelForValueScale(valueScale, geometry, input.layout, orientation);
  const stackRanges = stackRangesByDatum(renderData, categoryField, valueField, input.config);
  const rectangles: BarRectangleTrace[] = [];
  const slotSizes: number[] = [];
  const offsetsBySeries = new Map<number, number>();
  const ownedDataSet = new Set(ownedData);
  const processOrder = slotContext?.processOrder ?? renderData.map((_, index) => index);

  for (const dataIndex of processOrder) {
    const datum = renderData[dataIndex];
    if (!datum || !ownedDataSet.has(datum)) continue;
    const marks = rectanglesByDatum.get(datum) ?? [];
    const mark = marks[0];
    const seriesIndex = integerValue(datum[SERIES_INDEX_FIELD]);
    const slot = slotContext
      ? barSlotForDatum(slotContext, categoryScale, fullBandSize, datum, dataIndex)
      : { offset: 0, size: fullBandSize };

    if (seriesIndex !== undefined) {
      offsetsBySeries.set(seriesIndex, roundCoordinate(slot.offset));
    }
    slotSizes.push(slot.size);
    if (!mark) continue;

    rectangles.push(
      rectangleTraceFromMark({
        mark,
        datum,
        layout: input.layout,
        categoryDomain,
        categoryIndexByKey,
        categoryField,
        valueField,
        baselinePixel,
        slotOffset: slot.offset,
        stackRange: stackRanges.get(datum),
      }),
    );
  }

  const validation = validateBarTrace({
    ownedData,
    rectanglesByDatum,
    rectangles,
    categoryPitch,
    slotSizes,
    ownedSeries,
  });
  const grouping = geometry?.grouping ?? groupingForStack(input.config?.stack);
  const seriesIndices = ownedSeries ?? distinctSeriesIndices(ownedData);
  const group: BarGeometryGroupTrace = {
    groupKey: barGeometryGroupKey(geometry, orientation, grouping),
    seriesIndices,
    axisGroup: 'primary',
    memberCount: Math.max(1, seriesIndices.length),
    categoryCount: categoryDomain.length,
    categoryAxisLength: roundCoordinate(categoryAxisLength),
    categoryPitch: roundCoordinate(categoryPitch),
    barSize: roundCoordinate(stableNumber(slotSizes) ?? 0),
    offsets: seriesIndices.map((seriesIndex) => ({
      seriesIndex,
      offset: roundCoordinate(offsetsBySeries.get(seriesIndex) ?? 0),
    })),
    ...(baselinePixel !== undefined ? { baselinePixel: roundCoordinate(baselinePixel) } : {}),
    traceStatus: validation.status,
    ...(validation.reason ? { traceStatusReason: validation.reason } : {}),
    rectangleCount: rectangles.length,
    rectangles,
  };

  return {
    layerIndex: input.layerIndex,
    markType: 'bar',
    orientation,
    grouping,
    categoryAxisRole: geometry?.categoryAxisRole ?? (orientation === 'horizontal' ? 'y' : 'x'),
    valueAxisRole: geometry?.valueAxisRole ?? (orientation === 'horizontal' ? 'x' : 'y'),
    categoryField,
    valueField,
    categoryDomain,
    categoryScale: {
      ...(scaleRange(categoryScale) ? { range: scaleRange(categoryScale) } : {}),
      step: roundCoordinate(categoryPitch),
      bandwidth: roundCoordinate(fullBandSize),
    },
    valueScale: {
      ...(scaleRange(valueScale) ? { range: scaleRange(valueScale) } : {}),
    },
    ...(input.config?.stack ? { stackMode: input.config.stack } : {}),
    groups: [group],
  };
}

function rectangleTraceFromMark(input: {
  mark: RectMark;
  datum: DataRow;
  layout: Layout;
  categoryDomain: Array<string | number | null>;
  categoryIndexByKey: Map<string, number>;
  categoryField: string;
  valueField: string;
  baselinePixel?: number;
  slotOffset: number;
  stackRange?: StackRange;
}): BarRectangleTrace {
  const category = scalarValue(input.datum[input.categoryField]);
  const sourceSeriesKey = stringValue(input.datum[SOURCE_SERIES_KEY_FIELD]);
  const clip = input.mark.clip ?? input.layout.plotArea;
  const seriesIndex = integerValue(input.datum[SERIES_INDEX_FIELD]);
  const sourceSeriesIndex = integerValue(input.datum[SOURCE_SERIES_INDEX_FIELD]);
  const pointIndex = integerValue(input.datum[POINT_INDEX_FIELD]);
  const value = numericValue(input.datum[input.valueField] ?? input.datum[VALUE_FIELD]);
  const categorySlotIndex = categoryIndex(input.categoryIndexByKey, category);
  return {
    ...(seriesIndex !== undefined ? { seriesIndex } : {}),
    ...(sourceSeriesIndex !== undefined ? { sourceSeriesIndex } : {}),
    ...(sourceSeriesKey !== undefined ? { sourceSeriesKey } : {}),
    ...(pointIndex !== undefined ? { pointIndex } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(value !== undefined ? { value } : {}),
    x: roundCoordinate(input.mark.x),
    y: roundCoordinate(input.mark.y),
    width: roundCoordinate(input.mark.width),
    height: roundCoordinate(input.mark.height),
    plotX: roundCoordinate(input.mark.x - input.layout.plotArea.x),
    plotY: roundCoordinate(input.mark.y - input.layout.plotArea.y),
    plotWidth: roundCoordinate(input.mark.width),
    plotHeight: roundCoordinate(input.mark.height),
    clipRegion: {
      x: roundCoordinate(clip.x),
      y: roundCoordinate(clip.y),
      width: roundCoordinate(clip.width),
      height: roundCoordinate(clip.height),
    },
    clippingPolicy: 'preClipRectWithPlotAreaClip',
    ...(input.baselinePixel !== undefined
      ? { baselinePixel: roundCoordinate(input.baselinePixel) }
      : {}),
    ...(categorySlotIndex !== undefined ? { categorySlotIndex } : {}),
    slotOffset: roundCoordinate(input.slotOffset),
    ...(input.stackRange
      ? {
          stackSign: input.stackRange.sign,
          stackCumulativeStart: roundCoordinate(input.stackRange.start),
          stackCumulativeEnd: roundCoordinate(input.stackRange.end),
        }
      : {}),
  };
}

function validateBarTrace(input: {
  ownedData: DataRow[];
  rectanglesByDatum: Map<DataRow, RectMark[]>;
  rectangles: BarRectangleTrace[];
  categoryPitch: number;
  slotSizes: number[];
  ownedSeries: number[] | undefined;
}): TraceValidation {
  if (input.ownedData.length === 0) {
    return { status: 'unavailable', reason: 'barTraceNoRenderableData' };
  }
  for (const datum of input.ownedData) {
    const marks = input.rectanglesByDatum.get(datum) ?? [];
    if (marks.length !== 1) {
      return {
        status: 'mismatch',
        reason: marks.length === 0 ? 'barTraceRectMissing' : 'barTraceDuplicateRects',
      };
    }
    if (!isFiniteRect(marks[0])) {
      return { status: 'mismatch', reason: 'barTraceNonFiniteRect' };
    }
  }
  if (input.rectangles.length !== input.ownedData.length) {
    return { status: 'mismatch', reason: 'barTraceRectangleCountMismatch' };
  }
  if (!Number.isFinite(input.categoryPitch) || input.categoryPitch <= 0) {
    return { status: 'unavailable', reason: 'barTraceCategoryPitchUnavailable' };
  }
  if (stableNumber(input.slotSizes) === undefined) {
    return { status: 'mismatch', reason: 'barTraceBarSizeUnstable' };
  }
  if (!input.ownedSeries || input.ownedSeries.length === 0) {
    return { status: 'mismatch', reason: 'barTraceSeriesIdentityMismatch' };
  }
  return { status: 'available' };
}

function rectMarksByDatum(marks: AnyMark[]): Map<DataRow, RectMark[]> {
  const byDatum = new Map<DataRow, RectMark[]>();
  for (const mark of marks) {
    if (mark.type !== 'rect') continue;
    const datum = mark.datum;
    if (!isDataRow(datum)) continue;
    const existing = byDatum.get(datum);
    if (existing) existing.push(mark);
    else byDatum.set(datum, [mark]);
  }
  return byDatum;
}

function stackRangesByDatum(
  data: DataRow[],
  categoryField: string,
  valueField: string,
  config: ConfigSpec | undefined,
): Map<DataRow, StackRange> {
  const result = new Map<DataRow, StackRange>();
  if (config?.stack !== 'zero' && config?.stack !== 'center' && config?.stack !== 'normalize') {
    return result;
  }

  const normalizedValues =
    config.stack === 'normalize'
      ? percentStackedValues(data, categoryField, valueField)
      : new Map(data.map((datum) => [datum, numericValue(datum[valueField]) ?? 0]));
  const positive = new Map<string, number>();
  const negative = new Map<string, number>();

  for (const datum of data) {
    const category = String(datum[categoryField] ?? '');
    const value = normalizedValues.get(datum) ?? 0;
    const tracker = value >= 0 ? positive : negative;
    const start = tracker.get(category) ?? 0;
    const end = start + value;
    tracker.set(category, end);
    result.set(datum, {
      sign: value >= 0 ? 'positive' : 'negative',
      start,
      end,
    });
  }
  return result;
}

function percentStackedValues(
  data: DataRow[],
  categoryField: string,
  valueField: string,
): Map<DataRow, number> {
  const totals = new Map<string, { positive: number; negativeMagnitude: number }>();
  for (const datum of data) {
    const category = String(datum[categoryField] ?? '');
    const value = numericValue(datum[valueField]) ?? 0;
    const total = totals.get(category) ?? { positive: 0, negativeMagnitude: 0 };
    if (value >= 0) total.positive += value;
    else total.negativeMagnitude += Math.abs(value);
    totals.set(category, total);
  }

  const values = new Map<DataRow, number>();
  for (const datum of data) {
    const category = String(datum[categoryField] ?? '');
    const value = numericValue(datum[valueField]) ?? 0;
    const total = totals.get(category) ?? { positive: 0, negativeMagnitude: 0 };
    values.set(
      datum,
      value >= 0
        ? total.positive > 0
          ? (value / total.positive) * 100
          : 0
        : total.negativeMagnitude > 0
          ? (value / total.negativeMagnitude) * 100
          : 0,
    );
  }
  return values;
}

function barOrientation(
  encoding: EncodingSpec | undefined,
  geometry: BarGeometrySpec | undefined,
): BarGeometryOrientation {
  if (geometry?.orientation) return geometry.orientation;
  return encoding?.x?.type === 'quantitative' && encoding?.y?.type !== 'quantitative'
    ? 'horizontal'
    : 'vertical';
}

function groupingForStack(stack: ConfigSpec['stack'] | undefined): BarGeometryGrouping {
  if (stack === 'normalize') return 'percentStacked';
  if (stack === 'zero' || stack === 'center') return 'stacked';
  return 'clustered';
}

function barGeometryGroupKey(
  geometry: BarGeometrySpec | undefined,
  orientation: BarGeometryOrientation,
  grouping: BarGeometryGrouping,
): string {
  return `bar:0:${geometry?.orientation ?? orientation}:${geometry?.grouping ?? grouping}`;
}

function seriesIndicesForGeometry(
  geometry: BarGeometrySpec | undefined,
  data: DataRow[],
): number[] | undefined {
  const visibleSeries = distinctSeriesIndices(data);
  if (geometry?.seriesIndices && geometry.seriesIndices.length > 0) {
    return geometry.seriesIndices.filter((seriesIndex) => visibleSeries.includes(seriesIndex));
  }
  return visibleSeries.length > 0 ? visibleSeries : undefined;
}

function distinctSeriesIndices(data: DataRow[]): number[] {
  return [
    ...new Set(
      data
        .map((datum) => integerValue(datum[SERIES_INDEX_FIELD]))
        .filter((value): value is number => value !== undefined),
    ),
  ].sort((a, b) => a - b);
}

function categoryDomainForScale(
  scale: AnyScale,
  data: DataRow[],
  categoryField: string,
): Array<string | number | null> {
  const domain = typeof scale.domain === 'function' ? scale.domain() : undefined;
  if (Array.isArray(domain) && domain.length > 0) return domain.map(scalarValue).filter(isScalar);
  const values: Array<string | number | null> = [];
  const seen = new Set<string>();
  for (const datum of data) {
    const value = scalarValue(datum[categoryField]);
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value ?? null);
  }
  return values;
}

function categoryIndexLookup(domain: Array<string | number | null>): Map<string, number> {
  const result = new Map<string, number>();
  domain.forEach((value, index) => {
    const key = String(value);
    if (!result.has(key)) result.set(key, index);
  });
  return result;
}

function categoryIndex(
  lookup: Map<string, number>,
  value: string | number | null | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  return lookup.get(String(value));
}

function baselinePixelForValueScale(
  scale: AnyScale,
  geometry: BarGeometrySpec | undefined,
  layout: Layout,
  orientation: BarGeometryOrientation,
): number | undefined {
  const baselineValue = geometry?.baselineValue ?? 0;
  const scaled = scale(baselineValue);
  if (typeof scaled !== 'number' || !Number.isFinite(scaled)) return undefined;
  const min = orientation === 'horizontal' ? layout.plotArea.x : layout.plotArea.y;
  const max =
    orientation === 'horizontal'
      ? layout.plotArea.x + layout.plotArea.width
      : layout.plotArea.y + layout.plotArea.height;
  return clamp(scaled, Math.min(min, max), Math.max(min, max));
}

function scaleStep(scale: AnyScale, fallback: number): number {
  const value = typeof scale.step === 'function' ? scale.step() : fallback;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function scaleBandwidth(scale: AnyScale, fallback: number): number {
  const value = typeof scale.bandwidth === 'function' ? scale.bandwidth() : fallback;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function scaleRange(scale: AnyScale): [number, number] | undefined {
  const range = typeof scale.range === 'function' ? scale.range() : undefined;
  if (!Array.isArray(range) || range.length < 2) return undefined;
  const start = numericValue(range[0]);
  const end = numericValue(range[1]);
  return start !== undefined && end !== undefined
    ? [roundCoordinate(start), roundCoordinate(end)]
    : undefined;
}

function stableNumber(values: number[]): number | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return undefined;
  const first = finite[0];
  return finite.every((value) => Math.abs(value - first) <= TRACE_TOLERANCE_PX) ? first : undefined;
}

function isFiniteRect(mark: RectMark): boolean {
  return (
    Number.isFinite(mark.x) &&
    Number.isFinite(mark.y) &&
    Number.isFinite(mark.width) &&
    Number.isFinite(mark.height)
  );
}

function isDataRow(value: unknown): value is DataRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function scalarValue(value: unknown): string | number | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function isScalar(value: string | number | null | undefined): value is string | number | null {
  return value !== undefined;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
