/**
 * Area Mark Generator
 *
 * Generates path marks for area charts with support for stacking,
 * percent-stacking, and color/detail grouping.
 */

import { resolveColor } from '../../algebra/color';
import {
  SERIES_FILL_FIELD,
  SERIES_FILL_OPACITY_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_OPACITY_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
} from '../../core/chart-ir/fields';
import type { LineStyleSpec, PaintSpec, PathMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import {
  centeredScalePosition,
  definedStyle,
  groupDataByEncoding,
  isBlankValueDatum,
  shouldSortPathByX,
  splitDataByLineSegment,
} from './helpers';
import { resolveAreaSurfaceCaps } from './area-surface-extent';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveOpacity(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : fallback;
}

function multiplyOpacity(
  base: number | undefined,
  multiplier: number | undefined,
): number | undefined {
  if (base === undefined) return multiplier;
  if (multiplier === undefined) return base;
  return clamp(base * multiplier, 0, 1);
}

function datumString(datum: DataRow, field: string | undefined): string | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function datumNumber(datum: DataRow, field: string | undefined): number | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function shouldUseLegacySingletonFallback(markSpec: MarkSpec): boolean {
  return markSpec.areaSurfaceExtentPolicy === undefined;
}

function solidPaint(color: string, opacity: number | undefined): PaintSpec {
  return {
    type: 'solid',
    color,
    ...(opacity !== undefined ? { opacity } : {}),
  };
}

function paintWithOpacity(
  paint: PaintSpec | undefined,
  opacity: number | undefined,
): PaintSpec | undefined {
  if (!paint || opacity === undefined) return paint;
  switch (paint.type) {
    case 'none':
      return paint;
    case 'solid':
      return { ...paint, opacity: multiplyOpacity(paint.opacity, opacity) };
    case 'pattern':
      return { ...paint, opacity: multiplyOpacity(paint.opacity, opacity) };
    case 'image':
      return { ...paint, opacity: multiplyOpacity(paint.opacity, opacity) };
    case 'groupInherited':
      return { ...paint, fallback: paintWithOpacity(paint.fallback, opacity) };
    case 'linearGradient':
    case 'radialGradient':
    case 'rectangularGradient':
      return {
        ...paint,
        stops: paint.stops.map((stop) => ({
          ...stop,
          opacity: multiplyOpacity(stop.opacity, opacity),
        })),
      };
  }
}

function paintHasOpacity(paint: PaintSpec | undefined): boolean {
  if (!paint) return false;
  switch (paint.type) {
    case 'none':
      return false;
    case 'solid':
    case 'pattern':
    case 'image':
      return paint.opacity !== undefined;
    case 'groupInherited':
      return paintHasOpacity(paint.fallback);
    case 'linearGradient':
    case 'radialGradient':
    case 'rectangularGradient':
      return paint.stops.some((stop) => stop.opacity !== undefined);
  }
}

function lineStyleForStroke(input: {
  baseLine?: LineStyleSpec;
  datumStroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
}): LineStyleSpec | undefined {
  if (
    !input.baseLine &&
    input.datumStroke === undefined &&
    input.strokeWidth === undefined &&
    input.strokeOpacity === undefined
  ) {
    return undefined;
  }
  return {
    ...(input.baseLine ?? {}),
    ...(input.datumStroke ? { paint: solidPaint(input.datumStroke, undefined) } : {}),
    ...(input.strokeWidth !== undefined ? { width: input.strokeWidth } : {}),
    ...(input.strokeOpacity !== undefined ? { opacity: input.strokeOpacity } : {}),
  };
}

export function areaStyleForDatum(
  markSpec: MarkSpec,
  datum: DataRow,
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  index: number,
): PathMark['style'] {
  const colorValue = encodings.color?.accessor(datum) ?? encodings.fill?.accessor(datum);
  const opacityValue = encodings.opacity?.accessor(datum);
  const color = resolveColor({
    colorScale: scales.color ?? scales.fill,
    colorValue,
    markColor: markSpec.color,
    markFill: markSpec.fill,
    index,
  });
  const datumFill = datumString(datum, markSpec.fillField) ?? datumString(datum, SERIES_FILL_FIELD);
  const datumStroke =
    datumString(datum, markSpec.strokeField) ?? datumString(datum, SERIES_STROKE_FIELD);
  const hasDatumFill = datumFill !== undefined;
  const fillOpacity = resolveOpacity(
    datumNumber(datum, SERIES_FILL_OPACITY_FIELD) ?? markSpec.fillOpacity,
    0.7,
  );
  const wholeMarkOpacity =
    opacityValue !== undefined
      ? resolveOpacity(opacityValue, 1)
      : markSpec.opacity !== undefined
        ? resolveOpacity(markSpec.opacity, 1)
        : undefined;
  const fillPaint = hasDatumFill
    ? solidPaint(datumFill, fillOpacity)
    : markSpec.fillPaint
      ? paintHasOpacity(markSpec.fillPaint)
        ? markSpec.fillPaint
        : paintWithOpacity(
            markSpec.fillPaint,
            markSpec.fillOpacity === undefined ? undefined : fillOpacity,
          )
      : solidPaint(color, fillOpacity);
  const strokeWidth =
    datumNumber(datum, markSpec.strokeWidthField) ??
    datumNumber(datum, SERIES_STROKE_WIDTH_FIELD) ??
    markSpec.line?.width ??
    markSpec.strokeWidth ??
    1;
  const strokeOpacity =
    datumNumber(datum, SERIES_STROKE_OPACITY_FIELD) ??
    markSpec.strokeOpacity ??
    markSpec.line?.opacity;
  const stroke =
    datumStroke ??
    markSpec.stroke ??
    datumFill ??
    (markSpec.line?.paint?.type === 'solid' ? markSpec.line.paint.color : undefined) ??
    color;

  return {
    fill: datumFill ?? color,
    fillPaint,
    stroke,
    strokeWidth,
    ...(wholeMarkOpacity !== undefined ? { opacity: wholeMarkOpacity } : {}),
    ...definedStyle({
      strokePaint: datumStroke ? undefined : markSpec.strokePaint,
      line: lineStyleForStroke({
        baseLine: markSpec.line,
        datumStroke,
        strokeWidth,
        strokeOpacity,
      }),
      effects: markSpec.effects,
    }),
  };
}

/**
 * Generate area marks.
 */
export function generateAreaMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  _encoding?: EncodingSpec,
  config?: ConfigSpec,
): PathMark[] {
  if (data.length === 0) return [];

  const xScale = scales.x;
  const yScale = scales.y;

  if (!xScale || !yScale) return [];

  const chartBaseline = layout.plotArea.y + layout.plotArea.height;
  const clampYToPlot = (y: number): number =>
    Math.max(layout.plotArea.y, Math.min(chartBaseline, y));

  // Detail is the stable series identity for grouped/layered stacks. Color is
  // only the visual channel and can intentionally collapse duplicate labels.
  const groups = groupDataByEncoding(data, encodings.detail ?? encodings.color);
  const marks: PathMark[] = [];

  // Stack mode applies even when Excel imports only expose one visible area series.
  const isStacked = config?.stack !== undefined && config.stack !== false;
  const isPercentStacked = config?.stack === 'normalize';

  // For stacked areas, we need an effective y-scale that accounts for cumulative
  // stacked totals (not just individual series values). Without this, the y-scale
  // domain only covers individual values, causing stacked coordinates to overflow.
  let effectiveYScale = yScale;

  if (isStacked && !Array.isArray(_encoding?.y?.scale?.domain)) {
    // Compute cumulative stacked totals per x-category across all series.
    // Separate positive and negative accumulations (same pattern as bar stacking).
    const xField = _encoding?.x?.field;
    const yField = _encoding?.y?.field;

    if (xField && yField) {
      if (isPercentStacked) {
        // For percent-stacked: normalize values to percentages per x-category,
        // then use a [0, 100] -> pixel range scale (same as bars do).
        const valRange = [layout.plotArea.y + layout.plotArea.height, layout.plotArea.y] as [
          number,
          number,
        ];
        let hasPositive = false;
        let hasNegative = false;
        for (const [, groupData] of groups) {
          for (const datum of groupData) {
            const val =
              typeof datum[yField] === 'number' && isFinite(datum[yField] as number)
                ? (datum[yField] as number)
                : 0;
            if (val > 0) hasPositive = true;
            if (val < 0) hasNegative = true;
          }
        }
        const percentMin = hasNegative ? -100 : 0;
        const percentMax = hasPositive ? 100 : 0;
        const percentSpan = percentMax === percentMin ? 100 : percentMax - percentMin;
        effectiveYScale = Object.assign((v: unknown): number => {
          const num = typeof v === 'number' ? v : parseFloat(String(v));
          if (isNaN(num)) return valRange[0];
          const t = (num - percentMin) / percentSpan;
          return valRange[0] + t * (valRange[1] - valRange[0]);
        }, {});
      } else {
        // For stack: 'zero' — compute cumulative stacked totals to find the
        // true domain that the y-scale needs to cover.
        const posTotals = new Map<string, number>();
        const negTotals = new Map<string, number>();
        for (const [, groupData] of groups) {
          for (const datum of groupData) {
            const cat = String(datum[xField] ?? '');
            const val =
              typeof datum[yField] === 'number' && isFinite(datum[yField] as number)
                ? (datum[yField] as number)
                : 0;
            if (val >= 0) {
              posTotals.set(cat, (posTotals.get(cat) || 0) + val);
            } else {
              negTotals.set(cat, (negTotals.get(cat) || 0) + val);
            }
          }
        }

        // Find the min and max cumulative totals
        let stackMax = 0;
        let stackMin = 0;
        for (const total of posTotals.values()) {
          if (total > stackMax) stackMax = total;
        }
        for (const total of negTotals.values()) {
          if (total < stackMin) stackMin = total;
        }

        // Build a linear scale from [stackMin, stackMax] to the plot area pixel range
        // (inverted because canvas y increases downward).
        const rangeTop = layout.plotArea.y;
        const rangeBottom = layout.plotArea.y + layout.plotArea.height;
        const domainSpan = stackMax - stackMin;

        if (domainSpan > 0) {
          effectiveYScale = Object.assign((v: unknown): number => {
            const num = typeof v === 'number' ? v : parseFloat(String(v));
            if (isNaN(num)) return rangeBottom;
            const t = (num - stackMin) / domainSpan;
            return rangeBottom + t * (rangeTop - rangeBottom);
          }, {});
        }
      }
    }
  }

  const baselineValue =
    typeof markSpec.baseline === 'number' && Number.isFinite(markSpec.baseline)
      ? markSpec.baseline
      : isStacked
        ? 0
        : undefined;
  const scaledBaseline =
    baselineValue !== undefined ? centeredScalePosition(effectiveYScale, baselineValue) : NaN;
  const areaBaseline = Number.isFinite(scaledBaseline)
    ? clampYToPlot(scaledBaseline)
    : chartBaseline;

  // For stacking, accumulate cumulative data values per x-category.
  // Separate positive and negative accumulators so negative values stack downward.
  const posStackValues = new Map<string, number>();
  const negStackValues = new Map<string, number>();
  // For percent-stacked: track category totals for normalization by sign.
  const positiveCategoryTotals = new Map<string, number>();
  const negativeCategoryTotals = new Map<string, number>();
  const positiveCategoryCumulative = new Map<string, number>();
  const negativeCategoryCumulative = new Map<string, number>();
  // Pixel-level baseline trackers for stacked area rendering (maps x pixel -> y pixel).
  const positiveStackBaselineTracker = new Map<number, number>();
  const negativeStackBaselineTracker = new Map<number, number>();

  if (isStacked && isPercentStacked) {
    const xField = _encoding?.x?.field;
    const yField = _encoding?.y?.field;
    if (xField && yField) {
      for (const [, groupData] of groups) {
        for (const datum of groupData) {
          const cat = String(datum[xField] ?? '');
          const val =
            typeof datum[yField] === 'number' && isFinite(datum[yField] as number)
              ? (datum[yField] as number)
              : 0;
          if (val >= 0) {
            positiveCategoryTotals.set(cat, (positiveCategoryTotals.get(cat) || 0) + val);
          } else {
            negativeCategoryTotals.set(cat, (negativeCategoryTotals.get(cat) || 0) + Math.abs(val));
          }
        }
      }
    }
  }

  for (const [_groupKey, groupData] of groups) {
    for (const segmentData of splitDataByLineSegment(groupData)) {
      const topPoints: Array<{
        x: number;
        y: number;
        xKey: string;
        stackSign?: 'positive' | 'negative';
      }> = [];
      const plottedData: DataRow[] = [];

      const xField = _encoding?.x?.field;
      const yField = _encoding?.y?.field;

      for (const datum of segmentData) {
        if (isBlankValueDatum(datum)) continue;
        const x = centeredScalePosition(xScale, encodings.x?.accessor(datum));

        if (isNaN(x)) continue;

        if (isStacked && xField && yField) {
          // For stacked areas, compute cumulative values and map through effectiveYScale
          const cat = String(datum[xField] ?? '');
          const rawVal =
            typeof datum[yField] === 'number' && isFinite(datum[yField] as number)
              ? (datum[yField] as number)
              : 0;

          if (isPercentStacked) {
            // Normalize to percentage, keeping positive and negative stacks independent.
            const stackSign = rawVal < 0 ? 'negative' : 'positive';
            const totals =
              stackSign === 'negative' ? negativeCategoryTotals : positiveCategoryTotals;
            const cumulative =
              stackSign === 'negative' ? negativeCategoryCumulative : positiveCategoryCumulative;
            const total = totals.get(cat) || 1;
            const pctVal = total > 0 ? (rawVal / total) * 100 : 0;
            const cumStart = cumulative.get(cat) || 0;
            const cumEnd = cumStart + pctVal;
            cumulative.set(cat, cumEnd);

            const y = effectiveYScale(cumEnd) as number;
            if (isNaN(y)) continue;
            topPoints.push({ x, y: clampYToPlot(y), xKey: cat, stackSign });
            plottedData.push(datum);
          } else {
            // stack: 'zero' — accumulate raw values, separated by sign
            let cumVal: number;
            const stackSign = rawVal < 0 ? 'negative' : 'positive';
            if (rawVal >= 0) {
              const prev = posStackValues.get(cat) || 0;
              cumVal = prev + rawVal;
              posStackValues.set(cat, cumVal);
            } else {
              const prev = negStackValues.get(cat) || 0;
              cumVal = prev + rawVal;
              negStackValues.set(cat, cumVal);
            }
            const y = effectiveYScale(cumVal) as number;
            if (isNaN(y)) continue;
            topPoints.push({ x, y: clampYToPlot(y), xKey: cat, stackSign });
            plottedData.push(datum);
          }
        } else {
          // Non-stacked: use original scale directly
          const y = centeredScalePosition(yScale, encodings.y?.accessor(datum));
          if (isNaN(y)) continue;
          topPoints.push({ x, y: clampYToPlot(y), xKey: '' });
          plottedData.push(datum);
        }
      }

      if (shouldSortPathByX(markSpec)) {
        topPoints.sort((a, b) => a.x - b.x);
      }

      // Allow single-point areas (degenerate but should produce a mark)
      if (topPoints.length === 0) continue;

      // For single-point authored areas without an imported policy, preserve the
      // existing thin-sliver fallback.
      if (topPoints.length === 1 && shouldUseLegacySingletonFallback(markSpec)) {
        const pt = topPoints[0];
        topPoints.push({ x: pt.x + 1, y: pt.y, xKey: pt.xKey, stackSign: pt.stackSign });
      }

      if (isStacked) {
        // Build stacked area path using cumulative value-based positioning.
        // Bottom edge = previous series' cumulative top (from baseline tracker) or chart baseline.
        // Top edge = current cumulative position (already computed above via effectiveYScale).
        const bottomLine: Array<{ x: number; y: number }> = [];

        // Use a baseline tracker keyed by x pixel position (rounded).
        // When a data point is missing for a series (gap), the baseline tracker
        // retains the last series' top at that x, so subsequent series don't
        // reset to zero -- they carry forward the previous baseline.
        for (const pt of topPoints) {
          const xKey = Math.round(pt.x * 100) / 100;
          const tracker =
            pt.stackSign === 'negative'
              ? negativeStackBaselineTracker
              : positiveStackBaselineTracker;
          const prevBaseline = tracker.get(xKey) ?? areaBaseline;
          bottomLine.push({ x: pt.x, y: prevBaseline });

          // Update the baseline tracker for the next series
          tracker.set(xKey, pt.y);
        }

        const path = buildStackedAreaPath(topPoints, bottomLine, markSpec, layout);

        marks.push({
          type: 'path',
          x: 0,
          y: 0,
          path,
          datum: plottedData,
          style: areaStyleForDatum(markSpec, plottedData[0], scales, encodings, marks.length),
        });
      } else {
        const path = buildStandardAreaPath(topPoints, areaBaseline, markSpec, layout);

        marks.push({
          type: 'path',
          x: 0,
          y: 0,
          path,
          datum: plottedData,
          style: areaStyleForDatum(markSpec, plottedData[0], scales, encodings, marks.length),
        });
      }
    }
  }

  return marks;
}

function buildStandardAreaPath(
  topPoints: Array<{ x: number; y: number }>,
  baseline: number,
  markSpec: MarkSpec,
  layout: Layout,
): string {
  const first = topPoints[0];
  const last = topPoints[topPoints.length - 1];
  const caps = resolveAreaSurfaceCaps({
    markSpec,
    layout,
    firstPointX: first.x,
    lastPointX: last.x,
  });

  let path = `M${caps.leftCapX},${baseline}`;
  path += ` L${caps.leftCapX},${first.y}`;
  if (!sameCoordinate(caps.leftCapX, first.x)) {
    path += ` L${first.x},${first.y}`;
  }
  for (let i = 1; i < topPoints.length; i++) {
    path += ` L${topPoints[i].x},${topPoints[i].y}`;
  }
  if (!sameCoordinate(caps.rightCapX, last.x)) {
    path += ` L${caps.rightCapX},${last.y}`;
  }
  path += ` L${caps.rightCapX},${baseline}`;
  return `${path} Z`;
}

function buildStackedAreaPath(
  topPoints: Array<{ x: number; y: number }>,
  bottomLine: Array<{ x: number; y: number }>,
  markSpec: MarkSpec,
  layout: Layout,
): string {
  const firstTop = topPoints[0];
  const lastTop = topPoints[topPoints.length - 1];
  const firstBottom = bottomLine[0] ?? { x: firstTop.x, y: firstTop.y };
  const lastBottom = bottomLine[bottomLine.length - 1] ?? { x: lastTop.x, y: lastTop.y };
  const caps = resolveAreaSurfaceCaps({
    markSpec,
    layout,
    firstPointX: firstTop.x,
    lastPointX: lastTop.x,
  });

  let path = `M${caps.leftCapX},${firstTop.y}`;
  if (!sameCoordinate(caps.leftCapX, firstTop.x)) {
    path += ` L${firstTop.x},${firstTop.y}`;
  }
  for (let i = 1; i < topPoints.length; i++) {
    path += ` L${topPoints[i].x},${topPoints[i].y}`;
  }
  if (!sameCoordinate(caps.rightCapX, lastTop.x)) {
    path += ` L${caps.rightCapX},${lastTop.y}`;
  }
  path += ` L${caps.rightCapX},${lastBottom.y}`;

  let bottomIndex = bottomLine.length - 1;
  if (bottomIndex >= 0 && sameCoordinate(caps.rightCapX, bottomLine[bottomIndex].x)) {
    bottomIndex--;
  }
  for (let i = bottomIndex; i >= 0; i--) {
    path += ` L${bottomLine[i].x},${bottomLine[i].y}`;
  }
  if (!sameCoordinate(caps.leftCapX, firstBottom.x)) {
    path += ` L${caps.leftCapX},${firstBottom.y}`;
  }
  return `${path} Z`;
}

function sameCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}
