/**
 * Text Mark Generator
 *
 * Generates text marks for label annotations and text charts.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { TextAlign, TextBaseline, TextMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';
import { definedStyle } from './helpers';

/**
 * Generate text marks.
 */
export function generateTextMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
): TextMark[] {
  const marks: TextMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  for (const datum of data) {
    const dx = numberField(datum, markSpec.dxField) ?? markSpec.dx ?? 0;
    const dy = numberField(datum, markSpec.dyField) ?? markSpec.dy ?? 0;
    const directX = directPosition(datum, markSpec.xField, layout, 'x', markSpec.coordinateSystem);
    const directY = directPosition(datum, markSpec.yField, layout, 'y', markSpec.coordinateSystem);
    const x =
      (directX ?? (xScale ? (xScale(encodings.x?.accessor(datum)) as number) : layout.plotArea.x)) + dx;
    const y =
      (directY ?? (yScale ? (yScale(encodings.y?.accessor(datum)) as number) : layout.plotArea.y)) + dy;

    const textValue = encodings.text?.accessor(datum);
    const text = textValue != null ? String(textValue) : '';

    const colorValue = encodings.color?.accessor(datum);
    const encodedColor = colorValue
      ? ((scales.color?.(colorValue) as string | undefined) ?? markSpec.color ?? '#000')
      : (markSpec.color ?? '#000');
    const color = stringField(datum, markSpec.colorField) ?? encodedColor;
    const fontSize = numberField(datum, markSpec.fontSizeField) ?? markSpec.fontSize ?? markSpec.size ?? 12;
    const textAlign = stringField(datum, markSpec.alignField) ?? markSpec.align ?? 'center';
    const textBaseline =
      stringField(datum, markSpec.baselineField) ?? markSpec.textBaseline ?? 'middle';

    marks.push({
      type: 'text',
      x,
      y,
      text,
      fontSize,
      fontFamily: markSpec.fontFamily ?? 'system-ui, sans-serif',
      textAlign: normalizeTextAlign(textAlign),
      textBaseline: normalizeTextBaseline(textBaseline),
      rotation: degreesToRadians(numberField(datum, markSpec.angleField) ?? markSpec.angle),
      datum,
      style: {
        fill: color,
        stroke: markSpec.stroke,
        opacity: markSpec.opacity ?? 1,
        ...definedStyle({
          fillPaint: markSpec.fillPaint,
          strokePaint: markSpec.strokePaint,
          effects: markSpec.effects,
        }),
      },
    });
  }

  return marks;
}

function degreesToRadians(value: number | undefined): number | undefined {
  return value === undefined ? undefined : (value * Math.PI) / 180;
}

function numberField(datum: DataRow, field: string | undefined): number | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function directPosition(
  datum: DataRow,
  field: string | undefined,
  layout: Layout,
  axis: 'x' | 'y',
  coordinateSystem: MarkSpec['coordinateSystem'],
): number | undefined {
  const value = numberField(datum, field);
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

function stringField(datum: DataRow, field: string | undefined): string | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'string' ? value : undefined;
}

function normalizeTextAlign(value: string): TextAlign {
  if (value === 'left' || value === 'center' || value === 'right') return value;
  if (value === 'start') return 'left';
  if (value === 'end') return 'right';
  return 'center';
}

function normalizeTextBaseline(value: string): TextBaseline {
  if (value === 'top' || value === 'middle' || value === 'bottom') return value;
  if (value === 'hanging') return 'top';
  if (value === 'alphabetic' || value === 'ideographic') return 'bottom';
  return 'middle';
}
