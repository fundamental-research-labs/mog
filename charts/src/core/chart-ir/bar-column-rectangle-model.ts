import type {
  BarCategoryPositionPolicy,
  BarGeometryGrouping,
  BarGeometryOrientation,
  BarSeriesSlotOrder,
  BarValueCrossingPolicy,
} from '../../grammar/spec';
import {
  barBaselineValueForDomain,
  effectiveGapWidth,
  effectiveOverlap,
  excelBarSlotGeometry,
  isStackedBarGrouping,
} from './bar-geometry';

export interface BarColumnRectangleModelPlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarColumnRectangleModelSeries {
  seriesIndex: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  values: ReadonlyArray<number | null | undefined>;
  visible?: boolean;
  pointVisibility?: ReadonlyArray<boolean>;
}

export interface BarColumnRectangleModelInput {
  groupKey?: string;
  axisGroup?: 'primary' | 'secondary';
  chartWidth?: number;
  chartHeight?: number;
  plotArea: BarColumnRectangleModelPlotArea;
  orientation: BarGeometryOrientation;
  grouping: BarGeometryGrouping;
  gapWidth?: number;
  overlap?: number;
  categoryPositionPolicy?: BarCategoryPositionPolicy;
  categoryCount: number;
  categories?: ReadonlyArray<string | number | null>;
  valueDomain: readonly [number, number];
  valueCrossing?: BarValueCrossingPolicy;
  valueCrossingValue?: number;
  baselineValue?: number;
  seriesSlotOrder?: BarSeriesSlotOrder;
  series: ReadonlyArray<BarColumnRectangleModelSeries>;
}

export interface BarColumnRectangleModelOffset {
  seriesIndex: number;
  offset: number;
}

export interface BarColumnRectangleModelRectangle {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  category?: string | number | null;
  value?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  plotX: number;
  plotY: number;
  plotWidth: number;
  plotHeight: number;
  clipRegion: BarColumnRectangleModelPlotArea;
  clippingPolicy: 'preClipRectWithPlotAreaClip';
  baselinePixel?: number;
  categorySlotIndex?: number;
  slotOffset?: number;
  stackSign?: 'positive' | 'negative';
  stackCumulativeStart?: number;
  stackCumulativeEnd?: number;
}

export interface BarColumnRectangleModel {
  schemaVersion: 1;
  coordinateSystem: 'chartPixel';
  groupKey?: string;
  axisGroup?: 'primary' | 'secondary';
  chartWidth?: number;
  chartHeight?: number;
  plotArea: BarColumnRectangleModelPlotArea;
  orientation: BarGeometryOrientation;
  grouping: BarGeometryGrouping;
  categoryCount: number;
  categoryAxisLength: number;
  categoryPitch: number;
  barSize: number;
  baselineValue: number;
  baselinePixel: number;
  offsets: BarColumnRectangleModelOffset[];
  rectangleCount: number;
  rectangles: BarColumnRectangleModelRectangle[];
}

export function buildBarColumnRectangleModel(
  input: BarColumnRectangleModelInput,
): BarColumnRectangleModel | undefined {
  const plotArea = finitePlotArea(input.plotArea);
  if (!plotArea) return undefined;
  const categoryCount = Math.max(0, Math.floor(input.categoryCount));
  if (categoryCount <= 0) return undefined;
  const valueDomain = finiteDomain(input.valueDomain);
  if (!valueDomain) return undefined;

  const series = input.series.filter((item) => item.visible !== false);
  if (series.length === 0) return undefined;

  const categoryAxisLength =
    input.orientation === 'horizontal' ? plotArea.height : plotArea.width;
  const categoryPitch = categoryPitchForPolicy(
    categoryAxisLength,
    categoryCount,
    input.categoryPositionPolicy,
  );
  if (!isFinitePositive(categoryPitch)) return undefined;

  const geometry = {
    grouping: input.grouping,
    gapWidth: effectiveGapWidth(input.gapWidth),
    overlap: effectiveOverlap(input.overlap, input.grouping),
    ...(input.categoryPositionPolicy ? { categoryPositionPolicy: input.categoryPositionPolicy } : {}),
  };
  const slotCount = isStackedBarGrouping(input.grouping) ? 1 : Math.max(1, series.length);
  const offsets = series.map((item, slotIndex) => {
    const visualIndex = visualSlotIndex(slotIndex, slotCount, input.seriesSlotOrder);
    const slot = excelBarSlotGeometry(categoryPitch, slotCount, visualIndex, geometry);
    return {
      seriesIndex: item.seriesIndex,
      offset: roundModelNumber(slot.offset),
    };
  });
  const barSize = excelBarSlotGeometry(categoryPitch, slotCount, 0, geometry).size;
  if (!isFinitePositive(barSize)) return undefined;

  const baselineValue =
    finiteNumber(input.baselineValue) ??
    barBaselineValueForDomain(
      {
        valueCrossing: input.valueCrossing,
        valueCrossingValue: input.valueCrossingValue,
      },
      valueDomain,
    ) ??
    0;
  const baselinePixel = clampToRange(
    scaleValue(input.orientation, plotArea, valueDomain, baselineValue),
    valueRange(input.orientation, plotArea),
  );
  if (!Number.isFinite(baselinePixel)) return undefined;

  const rectangles = buildRectangles({
    ...input,
    plotArea,
    categoryCount,
    valueDomain,
    series,
    categoryPitch,
    barSize,
    baselinePixel,
    offsets,
  });

  const chartWidth = finiteNumber(input.chartWidth);
  const chartHeight = finiteNumber(input.chartHeight);

  return {
    schemaVersion: 1,
    coordinateSystem: 'chartPixel',
    ...(input.groupKey ? { groupKey: input.groupKey } : {}),
    ...(input.axisGroup ? { axisGroup: input.axisGroup } : {}),
    ...(chartWidth !== undefined ? { chartWidth: roundModelNumber(chartWidth) } : {}),
    ...(chartHeight !== undefined ? { chartHeight: roundModelNumber(chartHeight) } : {}),
    plotArea: roundPlotArea(plotArea),
    orientation: input.orientation,
    grouping: input.grouping,
    categoryCount,
    categoryAxisLength: roundModelNumber(categoryAxisLength),
    categoryPitch: roundModelNumber(categoryPitch),
    barSize: roundModelNumber(barSize),
    baselineValue: roundModelNumber(baselineValue),
    baselinePixel: roundModelNumber(baselinePixel),
    offsets,
    rectangleCount: rectangles.length,
    rectangles,
  };
}

function buildRectangles(
  input: BarColumnRectangleModelInput & {
    plotArea: BarColumnRectangleModelPlotArea;
    categoryCount: number;
    valueDomain: readonly [number, number];
    series: BarColumnRectangleModelSeries[];
    categoryPitch: number;
    barSize: number;
    baselinePixel: number;
    offsets: BarColumnRectangleModelOffset[];
  },
): BarColumnRectangleModelRectangle[] {
  const rectangles: BarColumnRectangleModelRectangle[] = [];
  const normalized = normalizedPercentValues(input);
  const positiveValues = new Map<number, number>();
  const negativeValues = new Map<number, number>();

  for (let categoryIndex = 0; categoryIndex < input.categoryCount; categoryIndex += 1) {
    for (let seriesSlotIndex = 0; seriesSlotIndex < input.series.length; seriesSlotIndex += 1) {
      const series = input.series[seriesSlotIndex];
      if (series.pointVisibility?.[categoryIndex] === false) continue;
      const rawValue = finiteNumber(series.values[categoryIndex]);
      if (rawValue === undefined) continue;

      const slotOffset = input.offsets[seriesSlotIndex]?.offset ?? 0;
      const categoryBase = categoryBasePixel(input, categoryIndex);
      const category = input.categories?.[categoryIndex] ?? categoryIndex;
      const value =
        input.grouping === 'percentStacked'
          ? normalized.get(series)?.[categoryIndex] ?? 0
          : rawValue;
      const stack = stackRangeForValue({
        grouping: input.grouping,
        categoryIndex,
        value,
        positiveValues,
        negativeValues,
      });
      const rect = rectangleForValue({
        input,
        series,
        pointIndex: categoryIndex,
        category,
        value: rawValue,
        categoryBase,
        slotOffset,
        effectiveValue: value,
        stack,
      });
      rectangles.push(rect);
    }
  }

  return rectangles;
}

function rectangleForValue(input: {
  input: BarColumnRectangleModelInput & {
    plotArea: BarColumnRectangleModelPlotArea;
    valueDomain: readonly [number, number];
    orientation: BarGeometryOrientation;
    grouping: BarGeometryGrouping;
    categoryPitch: number;
    barSize: number;
    baselinePixel: number;
  };
  series: BarColumnRectangleModelSeries;
  pointIndex: number;
  category: string | number | null;
  value: number;
  categoryBase: number;
  slotOffset: number;
  effectiveValue: number;
  stack?: {
    sign: 'positive' | 'negative';
    cumulativeStart: number;
    cumulativeEnd: number;
    pixelStart?: number;
    pixelEnd?: number;
  };
}): BarColumnRectangleModelRectangle {
  const { input: modelInput } = input;
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;

  if (modelInput.orientation === 'horizontal') {
    y = input.categoryBase + input.slotOffset;
    height = modelInput.barSize;
    if (input.stack?.pixelStart !== undefined && input.stack.pixelEnd !== undefined) {
      x = Math.min(input.stack.pixelStart, input.stack.pixelEnd);
      width = Math.abs(input.stack.pixelEnd - input.stack.pixelStart);
    } else if (input.stack) {
      const startPixel = scaleValue(
        modelInput.orientation,
        modelInput.plotArea,
        modelInput.valueDomain,
        input.stack.cumulativeStart,
      );
      const endPixel = scaleValue(
        modelInput.orientation,
        modelInput.plotArea,
        modelInput.valueDomain,
        input.stack.cumulativeEnd,
      );
      x = Math.min(startPixel, endPixel);
      width = Math.abs(endPixel - startPixel);
    } else {
      const valuePixel = scaleValue(
        modelInput.orientation,
        modelInput.plotArea,
        modelInput.valueDomain,
        input.effectiveValue,
      );
      x = Math.min(valuePixel, modelInput.baselinePixel);
      width = Math.abs(valuePixel - modelInput.baselinePixel);
    }
  } else {
    x = input.categoryBase + input.slotOffset;
    width = modelInput.barSize;
    if (input.stack?.pixelStart !== undefined && input.stack.pixelEnd !== undefined) {
      y = Math.min(input.stack.pixelStart, input.stack.pixelEnd);
      height = Math.abs(input.stack.pixelEnd - input.stack.pixelStart);
    } else if (input.stack) {
      const startPixel = scaleValue(
        modelInput.orientation,
        modelInput.plotArea,
        modelInput.valueDomain,
        input.stack.cumulativeStart,
      );
      const endPixel = scaleValue(
        modelInput.orientation,
        modelInput.plotArea,
        modelInput.valueDomain,
        input.stack.cumulativeEnd,
      );
      y = Math.min(startPixel, endPixel);
      height = Math.abs(endPixel - startPixel);
    } else {
      const valuePixel = scaleValue(
        modelInput.orientation,
        modelInput.plotArea,
        modelInput.valueDomain,
        input.effectiveValue,
      );
      y = Math.min(valuePixel, modelInput.baselinePixel);
      height = Math.abs(valuePixel - modelInput.baselinePixel);
    }
  }

  const roundedX = roundModelNumber(x);
  const roundedY = roundModelNumber(y);
  const roundedWidth = roundModelNumber(Math.max(0, width));
  const roundedHeight = roundModelNumber(Math.max(0, height));
  return {
    seriesIndex: input.series.seriesIndex,
    ...(input.series.sourceSeriesIndex !== undefined
      ? { sourceSeriesIndex: input.series.sourceSeriesIndex }
      : {}),
    ...(input.series.sourceSeriesKey ? { sourceSeriesKey: input.series.sourceSeriesKey } : {}),
    pointIndex: input.pointIndex,
    category: input.category,
    value: roundModelNumber(input.value),
    x: roundedX,
    y: roundedY,
    width: roundedWidth,
    height: roundedHeight,
    plotX: roundModelNumber(roundedX - modelInput.plotArea.x),
    plotY: roundModelNumber(roundedY - modelInput.plotArea.y),
    plotWidth: roundedWidth,
    plotHeight: roundedHeight,
    clipRegion: roundPlotArea(modelInput.plotArea),
    clippingPolicy: 'preClipRectWithPlotAreaClip',
    baselinePixel: roundModelNumber(modelInput.baselinePixel),
    categorySlotIndex: input.pointIndex,
    slotOffset: roundModelNumber(input.slotOffset),
    ...(input.stack
      ? {
          stackSign: input.stack.sign,
          stackCumulativeStart: roundModelNumber(input.stack.cumulativeStart),
          stackCumulativeEnd: roundModelNumber(input.stack.cumulativeEnd),
        }
      : {}),
  };
}

function stackRangeForValue(input: {
  grouping: BarGeometryGrouping;
  categoryIndex: number;
  value: number;
  positiveValues: Map<number, number>;
  negativeValues: Map<number, number>;
}): ReturnType<typeof stackRangeFromAccumulators> | undefined {
  if (!isStackedBarGrouping(input.grouping)) return undefined;
  return stackRangeFromAccumulators(input);
}

function stackRangeFromAccumulators(input: {
  categoryIndex: number;
  value: number;
  positiveValues: Map<number, number>;
  negativeValues: Map<number, number>;
}): {
  sign: 'positive' | 'negative';
  cumulativeStart: number;
  cumulativeEnd: number;
  pixelStart?: number;
  pixelEnd?: number;
} {
  const sign = input.value >= 0 ? 'positive' : 'negative';
  const values = sign === 'positive' ? input.positiveValues : input.negativeValues;
  const cumulativeStart = values.get(input.categoryIndex) ?? 0;
  const cumulativeEnd = cumulativeStart + input.value;
  values.set(input.categoryIndex, cumulativeEnd);
  return {
    sign,
    cumulativeStart,
    cumulativeEnd,
  };
}

function normalizedPercentValues(input: {
  grouping: BarGeometryGrouping;
  series: ReadonlyArray<BarColumnRectangleModelSeries>;
  categoryCount: number;
}): Map<BarColumnRectangleModelSeries, number[]> {
  const result = new Map<BarColumnRectangleModelSeries, number[]>();
  if (input.grouping !== 'percentStacked') return result;

  const positiveTotals = new Array(input.categoryCount).fill(0);
  const negativeMagnitudeTotals = new Array(input.categoryCount).fill(0);
  for (const series of input.series) {
    for (let index = 0; index < input.categoryCount; index += 1) {
      if (series.pointVisibility?.[index] === false) continue;
      const value = finiteNumber(series.values[index]) ?? 0;
      if (value >= 0) positiveTotals[index] += value;
      else negativeMagnitudeTotals[index] += Math.abs(value);
    }
  }

  for (const series of input.series) {
    const values: number[] = [];
    for (let index = 0; index < input.categoryCount; index += 1) {
      if (series.pointVisibility?.[index] === false) {
        values.push(0);
        continue;
      }
      const value = finiteNumber(series.values[index]) ?? 0;
      values.push(
        value >= 0
          ? positiveTotals[index] > 0
            ? (value / positiveTotals[index]) * 100
            : 0
          : negativeMagnitudeTotals[index] > 0
            ? (value / negativeMagnitudeTotals[index]) * 100
            : 0,
      );
    }
    result.set(series, values);
  }
  return result;
}

function categoryBasePixel(
  input: {
    orientation: BarGeometryOrientation;
    plotArea: BarColumnRectangleModelPlotArea;
    categoryPitch: number;
  },
  categoryIndex: number,
): number {
  const base = categoryIndex * input.categoryPitch;
  return input.orientation === 'horizontal' ? input.plotArea.y + base : input.plotArea.x + base;
}

function categoryPitchForPolicy(
  axisLength: number,
  categoryCount: number,
  policy: BarCategoryPositionPolicy | undefined,
): number | undefined {
  if (categoryCount <= 0) return undefined;
  if (policy === 'onCategory' && categoryCount > 1) return axisLength / (categoryCount - 1);
  return axisLength / categoryCount;
}

function visualSlotIndex(
  slotIndex: number,
  seriesCount: number,
  order: BarSeriesSlotOrder | undefined,
): number {
  return order === 'reverse' ? seriesCount - 1 - slotIndex : slotIndex;
}

function scaleValue(
  orientation: BarGeometryOrientation,
  plotArea: BarColumnRectangleModelPlotArea,
  domain: readonly [number, number],
  value: number,
): number {
  const [domainMin, domainMax] = domain;
  if (domainMin === domainMax) {
    return orientation === 'horizontal' ? plotArea.x : plotArea.y + plotArea.height;
  }
  const t = (value - domainMin) / (domainMax - domainMin);
  if (orientation === 'horizontal') {
    return plotArea.x + t * plotArea.width;
  }
  return plotArea.y + plotArea.height - t * plotArea.height;
}

function valueRange(
  orientation: BarGeometryOrientation,
  plotArea: BarColumnRectangleModelPlotArea,
): readonly [number, number] {
  return orientation === 'horizontal'
    ? [plotArea.x, plotArea.x + plotArea.width]
    : [plotArea.y, plotArea.y + plotArea.height];
}

function finiteDomain(value: readonly [number, number] | undefined): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const min = finiteNumber(value[0]);
  const max = finiteNumber(value[1]);
  if (min === undefined || max === undefined || min === max) return undefined;
  return [min, max];
}

function finitePlotArea(
  value: BarColumnRectangleModelPlotArea | undefined,
): BarColumnRectangleModelPlotArea | undefined {
  const x = finiteNumber(value?.x);
  const y = finiteNumber(value?.y);
  const width = finiteNumber(value?.width);
  const height = finiteNumber(value?.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampToRange(value: number, range: readonly [number, number]): number {
  return Math.min(Math.max(value, Math.min(...range)), Math.max(...range));
}

function roundPlotArea(
  value: BarColumnRectangleModelPlotArea,
): BarColumnRectangleModelPlotArea {
  return {
    x: roundModelNumber(value.x),
    y: roundModelNumber(value.y),
    width: roundModelNumber(value.width),
    height: roundModelNumber(value.height),
  };
}

function roundModelNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-9) return 0;
  return Number.parseFloat(value.toFixed(6));
}
