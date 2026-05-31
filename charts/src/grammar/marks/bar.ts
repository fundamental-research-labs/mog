/**
 * Bar Mark Generator
 *
 * Generates rect marks for bar charts (vertical and horizontal),
 * with support for grouping, stacking, and percent-stacking.
 */

import { resolveColor } from '../../algebra/color';
import {
  effectiveBarGeometryFromSpec,
  excelBarSlotGeometry,
  hasExcelBarGeometrySpec,
} from '../../core/config-to-spec/bar-geometry';
import {
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
} from '../../core/config-to-spec/fields';
import type { RectMark } from '../../primitives/types';
import type { AnyScale, ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import { definedStyle, renderableDataRows } from './helpers';

const SERIES_ORDER_FIELD = '__mogSeriesOrder';

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

function scaleStep(scale: AnyScale, fallback: number): number {
  const raw = typeof scale.step === 'function' ? scale.step() : fallback;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function orderedUniqueValues(data: DataRow[], field: string): string[] {
  const values = new Map<string, { firstIndex: number; seriesOrder: number }>();

  for (let index = 0; index < data.length; index += 1) {
    const row = data[index];
    const value = String(row[field]);
    if (values.has(value)) continue;
    values.set(value, {
      firstIndex: index,
      seriesOrder: datumNumber(row, SERIES_ORDER_FIELD) ?? index,
    });
  }

  return [...values.entries()]
    .sort(([, a], [, b]) => a.seriesOrder - b.seriesOrder || a.firstIndex - b.firstIndex)
    .map(([value]) => value);
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
  const colorField = encoding?.color?.field;
  const isStacked =
    config?.stack === 'normalize' || config?.stack === 'zero' || config?.stack === 'center';
  const isPercentStacked = config?.stack === 'normalize';

  // Determine the category and value fields
  const catField = isHorizontal ? encoding?.y?.field : encoding?.x?.field;
  const valField = isHorizontal ? encoding?.x?.field : encoding?.y?.field;

  const isGrouped = !!colorField && !isStacked;

  // For grouped bars, compute group info (unique groups and their order)
  let uniqueGroups: string[] = [];
  if (isGrouped && colorField) {
    uniqueGroups = orderedUniqueValues(renderData, colorField);
  }

  // Detect duplicate categories: when multiple data rows share the same category
  // value, we may need to auto-group them to prevent overlap.
  // This applies when:
  // 1. No stacking AND no grouping: straightforward duplicate categories
  // 2. Grouped by color but colorField === catField: color doesn't differentiate within category
  let maxPerCategory = 1;
  const catIndexTracker = new Map<string, number>(); // tracks how many bars placed per category
  const colorMatchesCat = colorField === catField;
  if (catField && !isStacked) {
    if (!isGrouped || colorMatchesCat) {
      const catCounts = new Map<string, number>();
      for (const d of renderData) {
        const cat = String(d[catField] ?? '');
        catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      }
      maxPerCategory = Math.max(1, ...[...catCounts.values()]);
    }
  }
  const hasDuplicateCategories = maxPerCategory > 1;
  // numGroups determines the bandwidth subdivision:
  // - For properly grouped bars: use color-based group count
  // - For auto-grouped duplicate categories: use max per category
  // - When color matches cat WITH duplicates: override color grouping with auto-group count
  // - When color matches cat WITHOUT duplicates: keep color grouping (e.g. waterfall charts)
  const useAutoGrouping = hasDuplicateCategories && (!isGrouped || colorMatchesCat);
  const numGroups = useAutoGrouping
    ? maxPerCategory
    : isGrouped
      ? Math.max(uniqueGroups.length, 1)
      : 1;
  const useExcelGeometry = hasExcelBarGeometrySpec(config);
  const barGeometry = useExcelGeometry ? effectiveBarGeometryFromSpec(config) : undefined;

  // For percent-stacked mode, normalize values per category group
  let normalizedData = renderData;
  let percentDomainMin = 0;
  let percentDomainMax = 100;
  if (isPercentStacked) {
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
      percentDomainMin = hasNegative ? -100 : 0;
      percentDomainMax = hasPositive ? 100 : 0;
      if (percentDomainMin === percentDomainMax) percentDomainMax = percentDomainMin + 100;
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

  // Compute the zero position for the value axis (for proper baseline)
  const zeroPos = isHorizontal ? (effectiveXScale(0) as number) : (effectiveYScale(0) as number);

  // When auto-grouping duplicate categories, sort data by category so
  // bars for the same category are adjacent and visual order matches mark order.
  // Build an index array for stable category-grouped ordering.
  let processOrder: number[];
  if (hasDuplicateCategories && catField) {
    // Group indices by category, preserving category appearance order
    const catGroups = new Map<string, number[]>();
    const catOrder: string[] = [];
    for (let i = 0; i < normalizedData.length; i++) {
      const cat = String(normalizedData[i][catField] ?? '');
      if (!catGroups.has(cat)) {
        catGroups.set(cat, []);
        catOrder.push(cat);
      }
      catGroups.get(cat)!.push(i);
    }
    processOrder = [];
    for (const cat of catOrder) {
      processOrder.push(...catGroups.get(cat)!);
    }
  } else {
    processOrder = normalizedData.map((_, i) => i);
  }

  for (const i of processOrder) {
    const normalizedDatum = normalizedData[i];
    const datum = renderData[i]; // Keep original datum for mark.datum
    const xValue = encodings.x?.accessor(normalizedDatum);
    const yValue = encodings.y?.accessor(normalizedDatum);
    const x2Value = encodings.x2?.accessor(normalizedDatum);
    const y2Value = encodings.y2?.accessor(normalizedDatum);
    const colorValue = encodings.color?.accessor(datum) ?? encodings.fill?.accessor(datum);
    const opacityValue = encodings.opacity?.accessor(datum);

    // Compute group index for grouped bars
    let groupIndex = 0;
    if (useAutoGrouping && catField) {
      // Auto-grouping: assign sequential index within each category
      // Handles ungrouped duplicates and colorField===catField with duplicates
      const catKey = String(normalizedDatum[catField] ?? '');
      groupIndex = catIndexTracker.get(catKey) || 0;
      catIndexTracker.set(catKey, groupIndex + 1);
    } else if (isGrouped && colorField) {
      // Standard color-based grouping: bars in same category get different sub-positions
      const groupVal = String(datum[colorField] ?? '');
      groupIndex = uniqueGroups.indexOf(groupVal);
      if (groupIndex === -1) groupIndex = 0;
    }

    let x: number, y: number, width: number, height: number;

    if (isHorizontal) {
      // Horizontal bar
      const barY = yScale(yValue) as number; // Category axis always uses original scale
      const fullBandHeight = typeof yScale.bandwidth === 'function' ? yScale.bandwidth() : 20;
      const slot = barGeometry
        ? excelBarSlotGeometry(
            scaleStep(yScale, fullBandHeight),
            numGroups,
            groupIndex,
            barGeometry,
          )
        : { offset: groupIndex * (fullBandHeight / numGroups), size: fullBandHeight / numGroups };
      const barHeight = slot.size;
      const groupOffset = slot.offset;

      const scaledX = effectiveXScale(xValue) as number;
      const rangeStartX = finitePosition(x2Value);
      const scaledX2 =
        rangeStartX !== undefined ? (effectiveXScale(rangeStartX) as number) : undefined;
      const baseline = !isNaN(zeroPos) ? zeroPos : layout.plotArea.x;

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
      const slot = barGeometry
        ? excelBarSlotGeometry(
            scaleStep(xScale, fullBandWidth),
            numGroups,
            groupIndex,
            barGeometry,
          )
        : { offset: groupIndex * (fullBandWidth / numGroups), size: fullBandWidth / numGroups };
      const barWidth = slot.size;
      const groupOffset = slot.offset;

      const yPos = effectiveYScale(yValue) as number;
      const rangeStartY = finitePosition(y2Value);
      const y2Pos =
        rangeStartY !== undefined ? (effectiveYScale(rangeStartY) as number) : undefined;
      const baseline = !isNaN(zeroPos) ? zeroPos : layout.plotArea.y + layout.plotArea.height;

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
        fill: datumString(datum, markSpec.fillField) ?? color,
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
          fillPaint: markSpec.fillPaint,
          strokePaint: markSpec.strokePaint,
          line: markSpec.line,
          effects: markSpec.effects,
        }),
      },
    });
  }

  return marks;
}
