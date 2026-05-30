/**
 * Legend Generation
 *
 * Generates legend marks (symbols and labels) for color encodings.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { AnyMark, RectMark, TextMark } from '../primitives/types';
import type { AnyScale, ScaleMap } from './encoding-resolver';
import type { ChannelSpec, EncodingSpec, Layout } from './spec';

/**
 * Generate legend marks.
 */
export function generateLegends(
  encoding: EncodingSpec | undefined,
  scales: ScaleMap,
  layout: Layout,
): AnyMark[] {
  if (!layout.legend) return [];

  const marks: AnyMark[] = [];

  // Color legend
  if (encoding?.color && encoding.color.legend !== null && scales.color) {
    const legendMarks = generateColorLegend(encoding.color, scales.color, layout);
    marks.push(...legendMarks);
  }

  return marks;
}

/**
 * Generate color legend.
 */
export function generateColorLegend(
  channel: ChannelSpec,
  scale: AnyScale,
  layout: Layout,
): AnyMark[] {
  if (!layout.legend) return [];

  const marks: AnyMark[] = [];
  const legendSpec = channel.legend ?? {};
  const { x, y } = layout.legend;

  // Title
  const title =
    legendSpec.title !== undefined ? legendSpec.title : (channel.title ?? channel.field);
  if (title) {
    marks.push({
      type: 'text',
      x,
      y,
      text: title,
      fontSize: legendSpec.titleFontSize ?? 12,
      fontFamily: legendSpec.titleFontFamily ?? 'system-ui, sans-serif',
      textAlign: 'left',
      textBaseline: 'top',
      fontWeight: 'bold',
      style: {
        fill: legendSpec.titleColor ?? '#000',
      },
    } as TextMark);
  }

  // Get domain
  const domain: unknown[] = typeof scale.domain === 'function' ? scale.domain() : [];
  const legendValues = legendSpec.reverse ? [...domain].reverse() : domain;

  const symbolSize = legendSpec.symbolSize ?? 10;
  const itemY = y + (title ? 20 : 0);
  const itemSpacing = 18;

  for (let i = 0; i < legendValues.length; i++) {
    const value = legendValues[i];
    const color = scale(value) as string;

    // Symbol
    marks.push({
      type: 'rect',
      x,
      y: itemY + i * itemSpacing,
      width: symbolSize,
      height: symbolSize,
      datum: { entryIndex: i },
      style: {
        fill: color,
        stroke: '#000',
        strokeWidth: 0.5,
      },
    } as RectMark);

    // Label
    marks.push({
      type: 'text',
      x: x + symbolSize + 5,
      y: itemY + i * itemSpacing + symbolSize / 2,
      text: String(value),
      datum: { entryIndex: i },
      fontSize: legendSpec.labelFontSize ?? 11,
      fontFamily: legendSpec.labelFontFamily ?? 'system-ui, sans-serif',
      textAlign: 'left',
      textBaseline: 'middle',
      style: {
        fill: legendSpec.labelColor ?? '#000',
      },
    } as TextMark);
  }

  return marks;
}
