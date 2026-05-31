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
 * Generate rect marks (heatmap, etc.).
 */
export function generateRectMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
): RectMark[] {
  const marks: RectMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  for (const datum of data) {
    const directX = directPosition(datum, markSpec.xField, layout, 'x', markSpec.coordinateSystem);
    const directY = directPosition(datum, markSpec.yField, layout, 'y', markSpec.coordinateSystem);
    const directX2 = directPosition(
      datum,
      markSpec.x2Field,
      layout,
      'x',
      markSpec.coordinateSystem,
    );
    const directY2 = directPosition(
      datum,
      markSpec.y2Field,
      layout,
      'y',
      markSpec.coordinateSystem,
    );
    if (
      directX !== undefined &&
      directY !== undefined &&
      directX2 !== undefined &&
      directY2 !== undefined
    ) {
      marks.push({
        type: 'rect',
        x: Math.min(directX, directX2),
        y: Math.min(directY, directY2),
        width: Math.abs(directX2 - directX),
        height: Math.abs(directY2 - directY),
        datum,
        style: {
          fill:
            datumString(datum, markSpec.fillField) ??
            markSpec.fill ??
            markSpec.color ??
            DEFAULT_CATEGORY_COLORS[0],
          stroke: datumString(datum, markSpec.strokeField) ?? markSpec.stroke,
          strokeWidth: datumNumber(datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth,
          opacity: markSpec.opacity ?? 1,
        },
      });
      continue;
    }

    if (!xScale || !yScale) continue;

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
        strokeWidth: datumNumber(datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth,
        opacity: markSpec.opacity ?? 1,
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
