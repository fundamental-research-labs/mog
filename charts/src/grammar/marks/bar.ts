/**
 * Bar Mark Generator
 *
 * Generates rect marks for bar charts (vertical and horizontal),
 * with support for grouping, stacking, and percent-stacking.
 */

import { resolveColor } from '../../algebra/color';
import {
  SERIES_FILL_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
} from '../../core/chart-ir/fields';
import { barBaselineValueForDomain } from '../../core/chart-ir/bar-geometry';
import type { RectMark } from '../../primitives/types';
import type { AnyScale, ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { BarGeometrySpec, ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import { barSlotForDatum, createBarSlotContext } from './bar-slot';
import { definedStyle, renderableDataRows } from './helpers';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveOpacity(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : fallback;
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

function finitePosition(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Generate bar marks.
 */
export function generateBarMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
  config?: ConfigSpec,
): RectMark[] {
  const marks: RectMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  if (!xScale || !yScale) return marks;

  const renderData = renderableDataRows(data);
  if (renderData.length === 0) return marks;

  // Determine orientation
  const isHorizontal = encoding?.x?.type === 'quantitative' && encoding?.y?.type !== 'quantitative';

  // Determine if this is grouped/clustered (color encoding without stacking)
  const isStacked =
    config?.stack === 'normalize' || config?.stack === 'zero' || config?.stack === 'center';
  const isPercentStacked = config?.stack === 'normalize';

  // Determine the category and value fields
  const catField = isHorizontal ? encoding?.y?.field : encoding?.x?.field;
  const valField = isHorizontal ? encoding?.x?.field : encoding?.y?.field;

  // For percent-stacked mode, normalize values per category group
  let normalizedData = renderData;
  let percentDomainMin = 0;
  let percentDomainMax = 100;
  if (isPercentStacked) {
    const geometryPercentDomain = config?.barGeometry?.percentDomain;
    if (geometryPercentDomain) {
      percentDomainMin = geometryPercentDomain[0];
      percentDomainMax = geometryPercentDomain[1];
    }
    if (catField && valField) {
      const totals = new Map<string, { positive: number; negativeMagnitude: number }>();
      for (const d of renderData) {
        const cat = String(d[catField]);
        const val = typeof d[valField] === 'number' ? (d[valField] as number) : 0;
        const total = totals.get(cat) ?? { positive: 0, negativeMagnitude: 0 };
        if (val >= 0) total.positive += val;
        else total.negativeMagnitude += Math.abs(val);
        totals.set(cat, total);
      }
      let hasPositive = false;
      let hasNegative = false;
      normalizedData = renderData.map((d) => {
        const cat = String(d[catField]);
        const total = totals.get(cat) ?? { positive: 0, negativeMagnitude: 0 };
        const val = typeof d[valField] === 'number' ? (d[valField] as number) : 0;
        if (val > 0) {
          hasPositive = true;
          return { ...d, [valField]: total.positive > 0 ? (val / total.positive) * 100 : 0 };
        }
        if (val < 0) {
          hasNegative = true;
          return {
            ...d,
            [valField]: total.negativeMagnitude > 0 ? (val / total.negativeMagnitude) * 100 : 0,
          };
        }
        return { ...d, [valField]: 0 };
      });
      if (!geometryPercentDomain) {
        percentDomainMin = hasNegative ? -100 : 0;
        percentDomainMax = hasPositive ? 100 : 0;
        if (percentDomainMin === percentDomainMax) percentDomainMax = percentDomainMin + 100;
      }
    }
  }

  // For percent-stacked mode, override the value axis scale so separately normalized
  // positive and negative stacks map to the final plot area.
  let effectiveXScale = xScale;
  let effectiveYScale = yScale;
  if (isPercentStacked) {
    const valRange = isHorizontal
      ? ([layout.plotArea.x, layout.plotArea.x + layout.plotArea.width] as [number, number])
      : ([layout.plotArea.y + layout.plotArea.height, layout.plotArea.y] as [number, number]);
    const percentScale: AnyScale = Object.assign((v: unknown): number => {
      const num = typeof v === 'number' ? v : parseFloat(String(v));
      if (isNaN(num)) return valRange[0];
      const t = (num - percentDomainMin) / (percentDomainMax - percentDomainMin);
      return valRange[0] + t * (valRange[1] - valRange[0]);
    }, {});
    if (isHorizontal) {
      effectiveXScale = percentScale;
    } else {
      effectiveYScale = percentScale;
    }
  }

  // Stack accumulators for stacked (non-grouped) bars only.
  // Separate positive and negative accumulators so negative bars stack
  // in the opposite direction from positive bars.
  const posStackAccumulators = new Map<string, number>();
  const negStackAccumulators = new Map<string, number>();
  const posPercentAccumulators = new Map<string, number>();
  const negPercentAccumulators = new Map<string, number>();

  const baselinePos = valueBaselinePosition({
    geometry: config?.barGeometry,
    scale: isHorizontal ? effectiveXScale : effectiveYScale,
    fallbackValue: 0,
    pixelMin: isHorizontal ? layout.plotArea.x : layout.plotArea.y,
    pixelMax: isHorizontal
      ? layout.plotArea.x + layout.plotArea.width
      : layout.plotArea.y + layout.plotArea.height,
    fallbackPixel: isHorizontal ? layout.plotArea.x : layout.plotArea.y + layout.plotArea.height,
  });

  const slotContext = createBarSlotContext(normalizedData, encoding, config, scales);
  const processOrder = slotContext?.processOrder ?? normalizedData.map((_, i) => i);

  for (const i of processOrder) {
    const normalizedDatum = normalizedData[i];
    const datum = renderData[i]; // Keep original datum for mark.datum
    const xValue = encodings.x?.accessor(normalizedDatum);
    const yValue = encodings.y?.accessor(normalizedDatum);
    const x2Value = encodings.x2?.accessor(normalizedDatum);
    const y2Value = encodings.y2?.accessor(normalizedDatum);
    const colorValue = encodings.color?.accessor(datum) ?? encodings.fill?.accessor(datum);
    const opacityValue = encodings.opacity?.accessor(datum);

    let x: number, y: number, width: number, height: number;

    if (isHorizontal) {
      // Horizontal bar
      const barY = yScale(yValue) as number; // Category axis always uses original scale
      const fullBandHeight = typeof yScale.bandwidth === 'function' ? yScale.bandwidth() : 20;
      const slot = slotContext
        ? barSlotForDatum(slotContext, yScale, fullBandHeight, normalizedDatum, i)
        : { offset: 0, size: fullBandHeight };
      const barHeight = slot.size;
      const groupOffset = slot.offset;

      const scaledX = effectiveXScale(xValue) as number;
      const rangeStartX = finitePosition(x2Value);
      const scaledX2 =
        rangeStartX !== undefined ? (effectiveXScale(rangeStartX) as number) : undefined;
      const baseline = Number.isFinite(baselinePos) ? baselinePos : layout.plotArea.x;

      if (isNaN(barY) || isNaN(scaledX) || !isFinite(scaledX) || !isFinite(barY)) {
        x = layout.plotArea.x;
        y = isNaN(barY) || !isFinite(barY) ? layout.plotArea.y : barY + groupOffset;
        width = 0;
        height = isNaN(barY) || !isFinite(barY) ? 0 : barHeight;
      } else if (scaledX2 !== undefined && Number.isFinite(scaledX2)) {
        x = Math.min(scaledX, scaledX2);
        y = barY + groupOffset;
        width = Math.abs(scaledX - scaledX2);
        height = barHeight;
      } else if (isStacked) {
        // Stacked bars: accumulate positions so segments tile correctly
        const catKey = catField ? String(normalizedDatum[catField]) : String(i);

        if (isPercentStacked && valField) {
          // For percent-stacked: use cumulative percentages for precise positioning
          const barVal =
            typeof normalizedDatum[valField] === 'number'
              ? (normalizedDatum[valField] as number)
              : 0;
          const accumulator = barVal >= 0 ? posPercentAccumulators : negPercentAccumulators;
          const cumStart = accumulator.get(catKey) || 0;
          const cumEnd = cumStart + barVal;
          accumulator.set(catKey, cumEnd);

          const startX = effectiveXScale(cumStart) as number;
          const endX = effectiveXScale(cumEnd) as number;

          x = Math.min(startX, endX);
          y = barY + groupOffset;
          width = Math.abs(endX - startX);
          height = barHeight;
        } else {
          // Regular stacked: accumulate pixel offsets, separated by sign
          const barWidth2 = Math.abs(scaledX - baseline);
          if (scaledX >= baseline) {
            const accumulated = posStackAccumulators.get(catKey) || 0;
            x = baseline + accumulated;
            posStackAccumulators.set(catKey, accumulated + barWidth2);
          } else {
            const accumulated = negStackAccumulators.get(catKey) || 0;
            x = baseline - accumulated - barWidth2;
            negStackAccumulators.set(catKey, accumulated + barWidth2);
          }
          y = barY + groupOffset;
          width = barWidth2;
          height = barHeight;
        }
      } else {
        // Non-stacked (simple or grouped): each bar independently from baseline
        const barWidth2 = Math.abs(scaledX - baseline);
        x = Math.min(scaledX, baseline);
        y = barY + groupOffset;
        width = barWidth2;
        height = barHeight;
      }
    } else {
      // Vertical bar
      const barX = xScale(xValue) as number; // Category axis always uses original scale
      const fullBandWidth = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 20;
      const slot = slotContext
        ? barSlotForDatum(slotContext, xScale, fullBandWidth, normalizedDatum, i)
        : { offset: 0, size: fullBandWidth };
      const barWidth = slot.size;
      const groupOffset = slot.offset;

      const yPos = effectiveYScale(yValue) as number;
      const rangeStartY = finitePosition(y2Value);
      const y2Pos =
        rangeStartY !== undefined ? (effectiveYScale(rangeStartY) as number) : undefined;
      const baseline = Number.isFinite(baselinePos)
        ? baselinePos
        : layout.plotArea.y + layout.plotArea.height;

      if (isNaN(barX) || isNaN(yPos) || !isFinite(yPos) || !isFinite(barX)) {
        x = isNaN(barX) || !isFinite(barX) ? layout.plotArea.x : barX + groupOffset;
        y = baseline;
        width = isNaN(barX) || !isFinite(barX) ? 0 : barWidth;
        height = 0;
      } else if (y2Pos !== undefined && Number.isFinite(y2Pos)) {
        x = barX + groupOffset;
        y = Math.min(yPos, y2Pos);
        width = barWidth;
        height = Math.abs(y2Pos - yPos);
      } else if (isStacked) {
        // Stacked bars: accumulate positions so segments tile correctly
        const catKey = catField ? String(normalizedDatum[catField]) : String(i);

        if (isPercentStacked && valField) {
          // For percent-stacked: use cumulative percentages for precise positioning
          const barVal =
            typeof normalizedDatum[valField] === 'number'
              ? (normalizedDatum[valField] as number)
              : 0;
          const accumulator = barVal >= 0 ? posPercentAccumulators : negPercentAccumulators;
          const cumStart = accumulator.get(catKey) || 0;
          const cumEnd = cumStart + barVal;
          accumulator.set(catKey, cumEnd);

          const startY = effectiveYScale(cumStart) as number;
          const endY = effectiveYScale(cumEnd) as number;

          x = barX + groupOffset;
          y = Math.min(startY, endY);
          width = barWidth;
          height = Math.abs(endY - startY);
        } else {
          // Regular stacked: accumulate pixel offsets, separated by sign
          const barHeight = Math.abs(baseline - yPos);
          x = barX + groupOffset;
          if (yPos <= baseline) {
            const accumulated = posStackAccumulators.get(catKey) || 0;
            y = yPos - accumulated;
            posStackAccumulators.set(catKey, accumulated + barHeight);
          } else {
            const accumulated = negStackAccumulators.get(catKey) || 0;
            y = baseline + accumulated;
            negStackAccumulators.set(catKey, accumulated + barHeight);
          }
          width = barWidth;
          height = barHeight;
        }
      } else {
        // Non-stacked (simple or grouped): each bar independently from baseline
        const barHeight = Math.abs(baseline - yPos);
        x = barX + groupOffset;
        y = Math.min(yPos, baseline);
        width = barWidth;
        height = barHeight;
      }
    }

    // Guard against Infinity/NaN in final mark values
    if (!isFinite(x)) x = layout.plotArea.x;
    if (!isFinite(y)) y = layout.plotArea.y;
    if (!isFinite(width)) width = 0;
    if (!isFinite(height)) height = 0;

    const datumFill =
      datumString(datum, markSpec.fillField) ?? datumString(datum, SERIES_FILL_FIELD);
    const hasDatumFill = datumFill !== undefined;

    // Get color
    const color = resolveColor({
      colorScale: scales.color ?? scales.fill,
      colorValue,
      markColor: markSpec.color,
      markFill: markSpec.fill,
      index: i,
    });

    marks.push({
      type: 'rect',
      x,
      y,
      width: Math.max(0, width),
      height: Math.max(0, height),
      datum,
      style: {
        fill: datumFill ?? color,
        stroke:
          datumString(datum, markSpec.strokeField) ??
          datumString(datum, SERIES_STROKE_FIELD) ??
          markSpec.stroke,
        strokeWidth:
          datumNumber(datum, markSpec.strokeWidthField) ??
          datumNumber(datum, SERIES_STROKE_WIDTH_FIELD) ??
          markSpec.strokeWidth,
        opacity: resolveOpacity(opacityValue, markSpec.opacity ?? 1),
        cornerRadius: markSpec.cornerRadius,
        ...definedStyle({
          fillPaint: hasDatumFill ? undefined : markSpec.fillPaint,
          strokePaint: markSpec.strokePaint,
          line: markSpec.line,
          effects: markSpec.effects,
        }),
      },
    });
  }

  return marks;
}

function valueBaselinePosition(input: {
  geometry: BarGeometrySpec | undefined;
  scale: AnyScale;
  fallbackValue: number;
  pixelMin: number;
  pixelMax: number;
  fallbackPixel: number;
}): number {
  const scaleDomain =
    typeof input.scale.domain === 'function' ? input.scale.domain() : undefined;
  const domain =
    Array.isArray(scaleDomain) && scaleDomain.length >= 2
      ? scaleDomain
      : (input.geometry?.percentDomain ?? input.geometry?.valueAxisDomain);
  const baselineValue = domain
    ? (barBaselineValueForDomain(input.geometry, domain) ?? input.geometry?.baselineValue)
    : input.geometry?.baselineValue;
  const scaled = input.scale(baselineValue ?? input.fallbackValue);
  if (typeof scaled !== 'number' || !Number.isFinite(scaled)) {
    return input.fallbackPixel;
  }
  return clamp(
    scaled,
    Math.min(input.pixelMin, input.pixelMax),
    Math.max(input.pixelMin, input.pixelMax),
  );
}
