/**
 * Text Mark Generator
 *
 * Generates text marks for label annotations and text charts.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { TextMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';

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
    const x = xScale ? (xScale(encodings.x?.accessor(datum)) as number) : layout.plotArea.x;
    const y = yScale ? (yScale(encodings.y?.accessor(datum)) as number) : layout.plotArea.y;

    const textValue = encodings.text?.accessor(datum);
    const text = textValue != null ? String(textValue) : '';

    const colorValue = encodings.color?.accessor(datum);
    const color = colorValue
      ? ((scales.color?.(colorValue) as string | undefined) ?? markSpec.color ?? '#000')
      : (markSpec.color ?? '#000');

    marks.push({
      type: 'text',
      x,
      y,
      text,
      fontSize: markSpec.fontSize ?? markSpec.size ?? 12,
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
      textBaseline: 'middle',
      datum,
      style: {
        fill: color,
        opacity: markSpec.opacity ?? 1,
      },
    });
  }

  return marks;
}
