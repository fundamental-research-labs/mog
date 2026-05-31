/**
 * Rule Mark Generator
 *
 * Generates path marks for rule lines (horizontal or vertical lines
 * spanning the chart area).
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { PathMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';
import { definedStyle } from './helpers';

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
 * Generate rule marks (lines across the chart).
 */
export function generateRuleMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
): PathMark[] {
  const marks: PathMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  for (const datum of data) {
    let x1: number, y1: number, x2: number, y2: number;

    const directX1 = directPosition(datum, markSpec.xField, layout, 'x', markSpec.coordinateSystem);
    const directY1 = directPosition(datum, markSpec.yField, layout, 'y', markSpec.coordinateSystem);
    const directX2 = directPosition(datum, markSpec.x2Field, layout, 'x', markSpec.coordinateSystem);
    const directY2 = directPosition(datum, markSpec.y2Field, layout, 'y', markSpec.coordinateSystem);

    if (
      directX1 !== undefined &&
      directY1 !== undefined &&
      directX2 !== undefined &&
      directY2 !== undefined
    ) {
      x1 = directX1;
      y1 = directY1;
      x2 = directX2;
      y2 = directY2;
    } else if (encodings.x && encodings.y && encodings.x2 && encodings.y2) {
      const x = xScale ? (xScale(encodings.x.accessor(datum)) as number) : 0;
      const y = yScale ? (yScale(encodings.y.accessor(datum)) as number) : 0;
      const xEnd = xScale ? (xScale(encodings.x2.accessor(datum)) as number) : x;
      const yEnd = yScale ? (yScale(encodings.y2.accessor(datum)) as number) : y;
      if (![x, y, xEnd, yEnd].every((value) => Number.isFinite(value))) continue;
      x1 = x;
      y1 = y;
      x2 = xEnd;
      y2 = yEnd;
    } else if (encodings.x && !encodings.y) {
      // Vertical rule
      const x = xScale ? (xScale(encodings.x.accessor(datum)) as number) : 0;
      x1 = x;
      x2 = x;
      y1 = layout.plotArea.y;
      y2 = layout.plotArea.y + layout.plotArea.height;
    } else if (encodings.y && !encodings.x) {
      // Horizontal rule
      const y = yScale ? (yScale(encodings.y.accessor(datum)) as number) : 0;
      x1 = layout.plotArea.x;
      x2 = layout.plotArea.x + layout.plotArea.width;
      y1 = y;
      y2 = y;
    } else {
      continue;
    }

    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${x1},${y1} L${x2},${y2}`,
      datum,
      style: {
        stroke: datumString(datum, markSpec.strokeField) ?? markSpec.color ?? markSpec.stroke ?? '#888',
        strokeWidth: datumNumber(datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth ?? 1,
        opacity: markSpec.opacity ?? 1,
        ...definedStyle({
          strokePaint: markSpec.strokePaint,
          line: markSpec.line,
          effects: markSpec.effects,
        }),
      },
    });
  }

  return marks;
}

function directPosition(
  datum: DataRow,
  field: string | undefined,
  layout: Layout,
  axis: 'x' | 'y',
  coordinateSystem: MarkSpec['coordinateSystem'],
): number | undefined {
  const value = datumNumber(datum, field);
  if (value === undefined) return undefined;
  if (coordinateSystem !== 'plotFraction') return value;
  return axis === 'x'
    ? layout.plotArea.x + value * layout.plotArea.width
    : layout.plotArea.y + value * layout.plotArea.height;
}
