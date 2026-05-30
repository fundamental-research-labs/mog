/**
 * Title Generation
 *
 * Generates title and subtitle marks for charts.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { AnyMark, TextMark } from '../primitives/types';
import type { ChartSpec, Layout } from './spec';

/**
 * Generate title marks.
 */
export function generateTitle(title: ChartSpec['title'], layout: Layout): AnyMark[] | undefined {
  if (!title || !layout.title) return undefined;

  const marks: AnyMark[] = [];
  const titleSpec = typeof title === 'string' ? { text: title } : title;

  const x = layout.title.x + layout.title.width / 2;
  const y = layout.title.y;

  // Main title
  marks.push({
    type: 'text',
    x,
    y,
    text: titleSpec.text,
    fontSize: titleSpec.fontSize ?? 16,
    fontFamily: titleSpec.fontFamily ?? 'system-ui, sans-serif',
    textAlign:
      titleSpec.anchor === 'start' ? 'left' : titleSpec.anchor === 'end' ? 'right' : 'center',
    textBaseline: 'top',
    fontWeight: titleSpec.fontWeight ?? 'bold',
    style: {
      fill: titleSpec.color ?? '#000',
    },
  } as TextMark);

  // Subtitle
  if (titleSpec.subtitle) {
    marks.push({
      type: 'text',
      x,
      y: y + (titleSpec.fontSize ?? 16) + 5,
      text: titleSpec.subtitle,
      fontSize: titleSpec.subtitleFontSize ?? 12,
      fontFamily: titleSpec.fontFamily ?? 'system-ui, sans-serif',
      textAlign:
        titleSpec.anchor === 'start' ? 'left' : titleSpec.anchor === 'end' ? 'right' : 'center',
      textBaseline: 'top',
      style: {
        fill: titleSpec.subtitleColor ?? '#666',
      },
    } as TextMark);
  }

  return marks;
}
