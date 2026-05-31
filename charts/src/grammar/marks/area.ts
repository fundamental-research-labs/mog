/**
 * Area Mark Generator
 *
 * Generates path marks for area charts with support for stacking,
 * percent-stacking, and color/detail grouping.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { resolveColor } from '../../algebra/color';
import type { PathMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import { definedStyle, groupDataByEncoding } from './helpers';

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

  // Group by color/detail
  const groups = groupDataByEncoding(data, encodings.color ?? encodings.detail);
  const marks: PathMark[] = [];

  // Determine if stacking is enabled
  const isStacked = config?.stack !== undefined && config.stack !== false && groups.size > 1;
  const isPercentStacked = config?.stack === 'normalize';

  // For stacked areas, we need an effective y-scale that accounts for cumulative
  // stacked totals (not just individual series values). Without this, the y-scale
  // domain only covers individual values, causing stacked coordinates to overflow.
  let effectiveYScale = yScale;

  if (isStacked) {
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
        effectiveYScale = Object.assign((v: unknown): number => {
          const num = typeof v === 'number' ? v : parseFloat(String(v));
          if (isNaN(num)) return valRange[0];
          const t = num / 100;
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

  // For stacking, accumulate cumulative data values per x-category.
  // Separate positive and negative accumulators so negative values stack downward.
  const posStackValues = new Map<string, number>();
  const negStackValues = new Map<string, number>();
  // For percent-stacked: track category totals for normalization
  const categoryTotals = new Map<string, number>();
  const categoryCumulative = new Map<string, number>();
  // Pixel-level baseline tracker for stacked area rendering (maps x pixel -> y pixel)
  const stackBaselineTracker = new Map<number, number>();

  if (isStacked && isPercentStacked) {
    const xField = _encoding?.x?.field;
    const yField = _encoding?.y?.field;
    if (xField && yField) {
      for (const [, groupData] of groups) {
        for (const datum of groupData) {
          const cat = String(datum[xField] ?? '');
          const val =
            typeof datum[yField] === 'number' && isFinite(datum[yField] as number)
              ? Math.abs(datum[yField] as number)
              : 0;
          categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + val);
        }
      }
    }
  }

  for (const [_groupKey, groupData] of groups) {
    const topPoints: Array<{ x: number; y: number; xKey: string }> = [];

    const xField = _encoding?.x?.field;
    const yField = _encoding?.y?.field;

    for (const datum of groupData) {
      const x = xScale(encodings.x?.accessor(datum)) as number;

      if (isNaN(x)) continue;

      if (isStacked && xField && yField) {
        // For stacked areas, compute cumulative values and map through effectiveYScale
        const cat = String(datum[xField] ?? '');
        const rawVal =
          typeof datum[yField] === 'number' && isFinite(datum[yField] as number)
            ? (datum[yField] as number)
            : 0;

        if (isPercentStacked) {
          // Normalize to percentage
          const total = categoryTotals.get(cat) || 1;
          const pctVal = (Math.abs(rawVal) / total) * 100;
          const cumStart = categoryCumulative.get(cat) || 0;
          const cumEnd = cumStart + pctVal;
          categoryCumulative.set(cat, cumEnd);

          const y = effectiveYScale(cumEnd) as number;
          if (isNaN(y)) continue;
          topPoints.push({ x, y: clampYToPlot(y), xKey: cat });
        } else {
          // stack: 'zero' — accumulate raw values, separated by sign
          let cumVal: number;
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
          topPoints.push({ x, y: clampYToPlot(y), xKey: cat });
        }
      } else {
        // Non-stacked: use original scale directly
        const y = yScale(encodings.y?.accessor(datum)) as number;
        if (isNaN(y)) continue;
        topPoints.push({ x, y: clampYToPlot(y), xKey: '' });
      }
    }

    // Sort by x to ensure monotonic order
    topPoints.sort((a, b) => a.x - b.x);

    // Allow single-point areas (degenerate but should produce a mark)
    if (topPoints.length === 0) continue;

    // For single-point areas, duplicate the point to form a thin sliver
    if (topPoints.length === 1) {
      const pt = topPoints[0];
      topPoints.push({ x: pt.x + 1, y: pt.y, xKey: pt.xKey });
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
        const prevBaseline = stackBaselineTracker.get(xKey) ?? chartBaseline;
        bottomLine.push({ x: pt.x, y: prevBaseline });

        // Update the baseline tracker for the next series
        stackBaselineTracker.set(xKey, pt.y);
      }

      // Build area path: top line left-to-right, then bottom line right-to-left.
      // This correctly encloses the stacked band between the previous series
      // and the current one.
      let path = `M${topPoints[0].x},${topPoints[0].y}`;

      for (let i = 1; i < topPoints.length; i++) {
        path += ` L${topPoints[i].x},${topPoints[i].y}`;
      }

      // Return along bottom edge right-to-left
      for (let i = bottomLine.length - 1; i >= 0; i--) {
        path += ` L${bottomLine[i].x},${bottomLine[i].y}`;
      }
      path += ' Z';

      const colorValue = encodings.color?.accessor(groupData[0]);
      const color = resolveColor({
        colorScale: scales.color,
        colorValue,
        markColor: markSpec.color,
        markFill: markSpec.fill,
        index: marks.length,
      });

      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        path,
        datum: groupData,
        style: {
          fill: color,
          stroke: markSpec.stroke ?? color,
          strokeWidth: markSpec.strokeWidth ?? 1,
          opacity: markSpec.fillOpacity ?? markSpec.opacity ?? 0.7,
          ...definedStyle({
            fillPaint: markSpec.fillPaint,
            strokePaint: markSpec.strokePaint,
            line: markSpec.line,
            effects: markSpec.effects,
          }),
        },
      });
    } else {
      // Non-stacked area: baseline is the chart bottom
      let path = `M${topPoints[0].x},${chartBaseline}`;
      path += ` L${topPoints[0].x},${topPoints[0].y}`;

      for (let i = 1; i < topPoints.length; i++) {
        path += ` L${topPoints[i].x},${topPoints[i].y}`;
      }

      path += ` L${topPoints[topPoints.length - 1].x},${chartBaseline}`;
      path += ' Z';

      const colorValue = encodings.color?.accessor(groupData[0]);
      const color = resolveColor({
        colorScale: scales.color,
        colorValue,
        markColor: markSpec.color,
        markFill: markSpec.fill,
        index: marks.length,
      });

      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        path,
        datum: groupData,
        style: {
          fill: color,
          stroke: markSpec.stroke ?? color,
          strokeWidth: markSpec.strokeWidth ?? 1,
          opacity: markSpec.fillOpacity ?? markSpec.opacity ?? 0.7,
          ...definedStyle({
            fillPaint: markSpec.fillPaint,
            strokePaint: markSpec.strokePaint,
            line: markSpec.line,
            effects: markSpec.effects,
          }),
        },
      });
    }
  }

  return marks;
}
