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
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import { centeredScalePosition, definedStyle } from './helpers';
import { directPosition } from './direct-position';
import { barSlotCenterOffset, createBarSlotContext } from './bar-slot';

/**
 * Generate text marks.
 */
export function generateTextMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
  config?: ConfigSpec,
): TextMark[] {
  const marks: TextMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;
  const barSlotContext = markSpec.alignToBarSlot
    ? createBarSlotContext(data, encoding, config, scales, { preferScaleDomain: true })
    : undefined;

  for (let dataIndex = 0; dataIndex < data.length; dataIndex += 1) {
    const datum = data[dataIndex];
    const dx = numberField(datum, markSpec.dxField) ?? markSpec.dx ?? 0;
    const dy = numberField(datum, markSpec.dyField) ?? markSpec.dy ?? 0;
    const directX = directPosition(datum, markSpec.xField, layout, 'x', markSpec.coordinateSystem);
    const directY = directPosition(datum, markSpec.yField, layout, 'y', markSpec.coordinateSystem);
    if (
      markSpec.coordinateSystem === 'dataTableFraction' &&
      (directX === undefined || directY === undefined)
    ) {
      continue;
    }
    const slotOffset = barSlotCenterOffset(
      barSlotContext,
      barSlotContext?.isHorizontal ? yScale : xScale,
      datum,
      dataIndex,
    );
    const x =
      (directX ??
        (xScale
          ? centeredScalePosition(xScale, encodings.x?.accessor(datum))
          : layout.plotArea.x)) +
      (barSlotContext && !barSlotContext.isHorizontal ? slotOffset : 0) +
      dx;
    const y =
      (directY ??
        (yScale
          ? centeredScalePosition(yScale, encodings.y?.accessor(datum))
          : layout.plotArea.y)) +
      (barSlotContext?.isHorizontal ? slotOffset : 0) +
      dy;

    const textValue = encodings.text?.accessor(datum);
    const text = textValue != null ? String(textValue) : '';

    const colorValue = encodings.color?.accessor(datum);
    const encodedColor = colorValue
      ? ((scales.color?.(colorValue) as string | undefined) ?? markSpec.color ?? '#000')
      : (markSpec.color ?? '#000');
    const color = stringField(datum, markSpec.colorField) ?? encodedColor;
    const fontSize =
      numberField(datum, markSpec.fontSizeField) ?? markSpec.fontSize ?? markSpec.size ?? 12;
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
