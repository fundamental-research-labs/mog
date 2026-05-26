/**
 * Tick Mark Generator
 *
 * Generates path marks for tick visualizations.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { PathMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';

/**
 * Generate tick marks.
 */
export function generateTickMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
): PathMark[] {
  const marks: PathMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  const tickLength = 6;

  for (const datum of data) {
    const xValue = encodings.x?.accessor(datum);
    const yValue = encodings.y?.accessor(datum);

    let x: number, y: number, path: string;

    if (xScale && !yScale) {
      // Vertical tick on x-axis
      x = xScale(xValue) as number;
      y = layout.plotArea.y + layout.plotArea.height / 2;
      path = `M${x},${y - tickLength} L${x},${y + tickLength}`;
    } else if (yScale && !xScale) {
      // Horizontal tick on y-axis
      x = layout.plotArea.x + layout.plotArea.width / 2;
      y = yScale(yValue) as number;
      path = `M${x - tickLength},${y} L${x + tickLength},${y}`;
    } else if (xScale && yScale) {
      // Tick at specific position
      x = xScale(xValue) as number;
      y = yScale(yValue) as number;
      path = `M${x - tickLength / 2},${y} L${x + tickLength / 2},${y}`;
    } else {
      continue;
    }

    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path,
      datum,
      style: {
        stroke: markSpec.color ?? markSpec.stroke ?? '#000',
        strokeWidth: markSpec.strokeWidth ?? 1,
        opacity: markSpec.opacity ?? 1,
      },
    });
  }

  return marks;
}
