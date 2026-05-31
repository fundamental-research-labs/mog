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
import { centeredScalePosition } from './helpers';

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
      x = centeredScalePosition(xScale, xValue);
      y = layout.plotArea.y + layout.plotArea.height / 2;
      path = `M${x},${y - tickLength} L${x},${y + tickLength}`;
    } else if (yScale && !xScale) {
      // Horizontal tick on y-axis
      x = layout.plotArea.x + layout.plotArea.width / 2;
      y = centeredScalePosition(yScale, yValue);
      path = `M${x - tickLength},${y} L${x + tickLength},${y}`;
    } else if (xScale && yScale) {
      // Tick at specific position
      x = centeredScalePosition(xScale, xValue);
      y = centeredScalePosition(yScale, yValue);
      path =
        markSpec.orient === 'vertical'
          ? `M${x},${y - tickLength / 2} L${x},${y + tickLength / 2}`
          : `M${x - tickLength / 2},${y} L${x + tickLength / 2},${y}`;
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
        stroke:
          datumString(datum, markSpec.strokeField) ?? markSpec.color ?? markSpec.stroke ?? '#000',
        strokeWidth: datumNumber(datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth ?? 1,
        opacity: markSpec.opacity ?? 1,
      },
    });
  }

  return marks;
}
