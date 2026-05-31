/**
 * Rule Mark Generator
 *
 * Generates path marks for rule lines (horizontal or vertical lines
 * spanning the chart area).
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { PathMark } from '../../primitives/types';
import { resolveStrokeColor } from '../../algebra/color';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';
import { centeredScalePosition, definedStyle } from './helpers';

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
      const encodedX1 = xScale ? centeredScalePosition(xScale, encodings.x.accessor(datum)) : 0;
      const encodedY1 = yScale ? centeredScalePosition(yScale, encodings.y.accessor(datum)) : 0;
      const encodedX2 = xScale
        ? centeredScalePosition(xScale, encodings.x2.accessor(datum))
        : encodedX1;
      const encodedY2 = yScale
        ? centeredScalePosition(yScale, encodings.y2.accessor(datum))
        : encodedY1;
      x1 = directX1 ?? encodedX1;
      y1 = directY1 ?? encodedY1;
      x2 = directX2 ?? encodedX2;
      y2 = directY2 ?? encodedY2;
      if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) continue;
    } else if (encodings.x && !encodings.y) {
      // Vertical rule
      const x = xScale ? centeredScalePosition(xScale, encodings.x.accessor(datum)) : 0;
      x1 = x;
      x2 = x;
      y1 = layout.plotArea.y;
      y2 = layout.plotArea.y + layout.plotArea.height;
    } else if (encodings.y && !encodings.x) {
      // Horizontal rule
      const y = yScale ? centeredScalePosition(yScale, encodings.y.accessor(datum)) : 0;
      x1 = layout.plotArea.x;
      x2 = layout.plotArea.x + layout.plotArea.width;
      y1 = y;
      y2 = y;
    } else {
      continue;
    }

    const endpointDx = datumNumber(datum, markSpec.dxField) ?? markSpec.dx ?? 0;
    const endpointDy = datumNumber(datum, markSpec.dyField) ?? markSpec.dy ?? 0;
    x2 += endpointDx;
    y2 += endpointDy;

    const colorValue = encodings.color?.accessor(datum);
    const stroke =
      datumString(datum, markSpec.strokeField) ??
      (encodings.color
        ? resolveStrokeColor(scales.color, colorValue, markSpec.color, markSpec.stroke, marks.length)
        : (markSpec.color ?? markSpec.stroke ?? '#888'));

    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${x1},${y1} L${x2},${y2}`,
      datum,
      style: {
        stroke,
        strokeWidth: datumNumber(datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth ?? 1,
        opacity: markSpec.opacity ?? 1,
        ...definedStyle({
          strokePaint: markSpec.strokePaint,
          strokeDash: markSpec.strokeDash,
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
  if (coordinateSystem === 'chartFraction') {
    return axis === 'x' ? value * layout.width : value * layout.height;
  }
  if (coordinateSystem === 'dataTableFraction') {
    const table = layout.dataTable;
    if (!table) return undefined;
    return axis === 'x' ? table.x + value * table.width : table.y + value * table.height;
  }
  if (coordinateSystem !== 'plotFraction') return value;
  return axis === 'x'
    ? layout.plotArea.x + value * layout.plotArea.width
    : layout.plotArea.y + value * layout.plotArea.height;
}
