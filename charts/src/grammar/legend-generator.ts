/**
 * Legend Generation
 *
 * Generates legend marks (symbols and labels) for color encodings.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { AnyMark, PathMark, RectMark, SymbolMark, TextMark } from '../primitives/types';
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
  const legendEntries: unknown[] = legendSpec.values ?? domain;
  const legendValues = legendSpec.reverse ? [...legendEntries].reverse() : legendEntries;

  const symbolType = legendSpec.symbolType ?? 'square';
  const symbolSize = legendSpec.symbolSize ?? (symbolType === 'line' ? 28 : 10);
  const itemY = y + (title ? 20 : 0);
  const itemSpacing = 18;
  const labelFontSize = legendSpec.labelFontSize ?? 11;
  const isHorizontalLegend = legendSpec.orient === 'bottom' || legendSpec.orient === 'top';
  const isRightLegend =
    legendSpec.orient === 'right' ||
    legendSpec.orient === 'top-right' ||
    legendSpec.orient === 'bottom-right';
  const labelWidths = legendValues.map((value) =>
    estimateLegendLabelWidth(String(value), labelFontSize),
  );
  const maxLabelWidth = labelWidths.reduce<number>((max, width) => Math.max(max, width), 0);
  const entryGap = isHorizontalLegend ? 18 : 0;
  const entryWidths = labelWidths.map((labelWidth) => symbolSize + 5 + labelWidth + entryGap);
  const contentWidth = isHorizontalLegend
    ? entryWidths.reduce((total, width) => total + width, 0)
    : symbolSize + 5 + maxLabelWidth;
  const contentX = isRightLegend ? x + layout.legend.width - contentWidth : x;
  let horizontalX = isHorizontalLegend
    ? x + Math.max(0, (layout.legend.width - contentWidth) / 2)
    : contentX;

  for (let i = 0; i < legendValues.length; i++) {
    const value = legendValues[i];
    const color = scale(value) as string;
    const entryX = isHorizontalLegend ? horizontalX : contentX;
    const entryY = isHorizontalLegend
      ? y + (layout.legend.height - symbolSize) / 2
      : itemY + i * itemSpacing;

    if (symbolType === 'line') {
      const yMid = entryY + symbolSize / 2;
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        path: `M${entryX},${yMid} L${entryX + symbolSize},${yMid}`,
        datum: { entryIndex: i },
        style: {
          stroke: color,
          strokeWidth: 2.25,
          fill: undefined,
        },
      } as PathMark);
    } else if (symbolType === 'square') {
      marks.push({
        type: 'rect',
        x: entryX,
        y: entryY,
        width: symbolSize,
        height: symbolSize,
        datum: { entryIndex: i },
        style: {
          fill: color,
          stroke: '#000',
          strokeWidth: 0.5,
        },
      } as RectMark);
    } else {
      marks.push({
        type: 'symbol',
        x: entryX + symbolSize / 2,
        y: entryY + symbolSize / 2,
        shape: symbolType,
        size: symbolSize * symbolSize,
        datum: { entryIndex: i },
        style: {
          fill: color,
          stroke: '#000',
          strokeWidth: 0.5,
        },
      } as SymbolMark);
    }

    // Label
    marks.push({
      type: 'text',
      x: entryX + symbolSize + 5,
      y: entryY + symbolSize / 2,
      text: String(value),
      datum: { entryIndex: i },
      fontSize: labelFontSize,
      fontFamily: legendSpec.labelFontFamily ?? 'system-ui, sans-serif',
      textAlign: 'left',
      textBaseline: 'middle',
      style: {
        fill: legendSpec.labelColor ?? '#000',
      },
    } as TextMark);

    if (isHorizontalLegend) {
      horizontalX += entryWidths[i] ?? 0;
    }
  }

  return marks;
}

function estimateLegendLabelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.7;
}
