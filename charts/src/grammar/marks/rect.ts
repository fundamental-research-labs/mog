/**
 * Rect Mark Generator
 *
 * Generates rect marks for heatmaps and similar visualizations.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { RectMark } from '../../primitives/types';
import { DEFAULT_CATEGORY_COLORS, resolveEncodings, type ScaleMap } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';
import { invokeScale } from './helpers';

/**
 * Generate rect marks (heatmap, etc.).
 */
export function generateRectMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  _layout: Layout,
): RectMark[] {
  const marks: RectMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  if (!xScale || !yScale) return marks;

  for (const datum of data) {
    const xValue = encodings.x?.accessor(datum);
    const yValue = encodings.y?.accessor(datum);

    const x = xScale(xValue) as number;
    const y = yScale(yValue) as number;

    // Get dimensions from bandwidth or encoding
    const width = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 20;
    const height = typeof yScale.bandwidth === 'function' ? yScale.bandwidth() : 20;

    const colorValue = encodings.color?.accessor(datum) ?? encodings.fill?.accessor(datum);
    const color = colorValue
      ? invokeScale<string>(scales.color || scales.fill, colorValue)
      : (markSpec.color ?? markSpec.fill ?? DEFAULT_CATEGORY_COLORS[0]);

    marks.push({
      type: 'rect',
      x,
      y,
      width,
      height,
      datum,
      style: {
        fill: color,
        stroke: markSpec.stroke,
        strokeWidth: markSpec.strokeWidth,
        opacity: markSpec.opacity ?? 1,
      },
    });
  }

  return marks;
}
