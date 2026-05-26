/**
 * Bar Mark Generator
 *
 * Generates rect marks for bar charts (vertical and horizontal),
 * with support for grouping, stacking, and percent-stacking.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { resolveColor } from '../../algebra/color';
import { uniqueValues } from '../../algebra/group-by';
import type { RectMark } from '../../primitives/types';
import type { AnyScale, ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';

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
    uniqueGroups = uniqueValues(data, colorField);
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
      for (const d of data) {
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

  // For percent-stacked mode, normalize values per category group
  let normalizedData = data;
  if (isPercentStacked) {
    if (catField && valField) {
      const totals = new Map<string, number>();
      for (const d of data) {
        const cat = String(d[catField]);
        const val = typeof d[valField] === 'number' ? Math.abs(d[valField] as number) : 0;
        totals.set(cat, (totals.get(cat) || 0) + val);
      }
      normalizedData = data.map((d) => {
        const cat = String(d[catField]);
        const total = totals.get(cat) || 1;
        const val = typeof d[valField] === 'number' ? (d[valField] as number) : 0;
        return { ...d, [valField]: (val / total) * 100 };
      });
    }
  }

  // For percent-stacked mode, override the value axis scale to use [0, 100] domain
  // so normalized values map correctly to the full plot area.
  let effectiveXScale = xScale;
  let effectiveYScale = yScale;
  if (isPercentStacked) {
    const valRange = isHorizontal
      ? ([layout.plotArea.x, layout.plotArea.x + layout.plotArea.width] as [number, number])
      : ([layout.plotArea.y + layout.plotArea.height, layout.plotArea.y] as [number, number]);
    const percentScale: AnyScale = Object.assign((v: unknown): number => {
      const num = typeof v === 'number' ? v : parseFloat(String(v));
      if (isNaN(num)) return valRange[0];
      // Linear mapping from [0, 100] to valRange
      const t = num / 100;
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
  // Cumulative value tracker for percent-stacked mode
  const cumulativeValues = new Map<string, number>();

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
    const datum = data[i]; // Keep original datum for mark.datum
    const xValue = encodings.x?.accessor(normalizedDatum);
    const yValue = encodings.y?.accessor(normalizedDatum);
    const colorValue = encodings.color?.accessor(datum) ?? encodings.fill?.accessor(datum);

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
      const barHeight = fullBandHeight / numGroups;
      const groupOffset = groupIndex * barHeight;

      const scaledX = effectiveXScale(xValue) as number;
      const baseline = !isNaN(zeroPos) ? zeroPos : layout.plotArea.x;

      if (isNaN(barY) || isNaN(scaledX) || !isFinite(scaledX) || !isFinite(barY)) {
        x = layout.plotArea.x;
        y = isNaN(barY) || !isFinite(barY) ? layout.plotArea.y : barY + groupOffset;
        width = 0;
        height = isNaN(barY) || !isFinite(barY) ? 0 : barHeight;
      } else if (isStacked) {
        // Stacked bars: accumulate positions so segments tile correctly
        const catKey = catField ? String(normalizedDatum[catField]) : String(i);

        if (isPercentStacked && valField) {
          // For percent-stacked: use cumulative percentages for precise positioning
          const cumStart = cumulativeValues.get(catKey) || 0;
          const barVal =
            typeof normalizedDatum[valField] === 'number'
              ? Math.abs(normalizedDatum[valField] as number)
              : 0;
          const cumEnd = cumStart + barVal;
          cumulativeValues.set(catKey, cumEnd);

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
      const barWidth = fullBandWidth / numGroups;
      const groupOffset = groupIndex * barWidth;

      const yPos = effectiveYScale(yValue) as number;
      const baseline = !isNaN(zeroPos) ? zeroPos : layout.plotArea.y + layout.plotArea.height;

      if (isNaN(barX) || isNaN(yPos) || !isFinite(yPos) || !isFinite(barX)) {
        x = isNaN(barX) || !isFinite(barX) ? layout.plotArea.x : barX + groupOffset;
        y = baseline;
        width = isNaN(barX) || !isFinite(barX) ? 0 : barWidth;
        height = 0;
      } else if (isStacked) {
        // Stacked bars: accumulate positions so segments tile correctly
        const catKey = catField ? String(normalizedDatum[catField]) : String(i);

        if (isPercentStacked && valField) {
          // For percent-stacked: use cumulative percentages for precise positioning
          const cumStart = cumulativeValues.get(catKey) || 0;
          const barVal =
            typeof normalizedDatum[valField] === 'number'
              ? Math.abs(normalizedDatum[valField] as number)
              : 0;
          const cumEnd = cumStart + barVal;
          cumulativeValues.set(catKey, cumEnd);

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
        fill: color,
        stroke: markSpec.stroke,
        strokeWidth: markSpec.strokeWidth,
        opacity: markSpec.opacity ?? 1,
        cornerRadius: markSpec.cornerRadius,
      },
    });
  }

  return marks;
}
