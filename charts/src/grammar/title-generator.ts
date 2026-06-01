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
  const titleFontSize = titleSpec.fontSize ?? 16;
  const subtitleFontSize = titleSpec.subtitleFontSize ?? 12;
  const contentHeight = titleFontSize + (titleSpec.subtitle ? subtitleFontSize + 5 : 0);
  const y =
    titleSpec.verticalAlign === 'bottom'
      ? layout.title.y + Math.max(0, layout.title.height - contentHeight)
      : titleSpec.verticalAlign === 'middle'
        ? layout.title.y + Math.max(0, (layout.title.height - contentHeight) / 2)
        : layout.title.y;

  // Main title
  marks.push({
    type: 'text',
    x,
    y,
    text: titleSpec.text,
    fontSize: titleFontSize,
    fontFamily: titleSpec.fontFamily ?? 'system-ui, sans-serif',
    textAlign:
      titleSpec.anchor === 'start' ? 'left' : titleSpec.anchor === 'end' ? 'right' : 'center',
    textBaseline: 'top',
    fontWeight: titleSpec.fontWeight ?? 'bold',
    fontStyle: titleSpec.fontStyle,
    richText: titleSpec.richText,
    underline: titleSpec.underline,
    strikethrough: titleSpec.strikethrough,
    style: {
      fill: titleSpec.color ?? '#000',
      fillPaint: titleSpec.fill,
      shadow: titleSpec.shadow,
    },
  } as TextMark);

  // Subtitle
  if (titleSpec.subtitle) {
    marks.push({
      type: 'text',
      x,
      y: y + titleFontSize + 5,
      text: titleSpec.subtitle,
      fontSize: subtitleFontSize,
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
