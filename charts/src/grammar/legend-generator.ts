/**
 * Legend Generation
 *
 * Generates legend marks (symbols and labels) for color encodings.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { AnyMark, PathMark, RectMark, SymbolMark, TextMark } from '../primitives/types';
import type { AnyScale, ScaleMap } from './encoding-resolver';
import type { ChannelSpec, EncodingSpec, Layout, LegendSpec, LegendSymbolType } from './spec';

interface LegendSymbolMetrics {
  type: LegendSymbolType;
  width: number;
  height: number;
}

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
  const legendSpec: LegendSpec = channel.legend ?? {};
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

  const defaultSymbolType = legendSpec.symbolType ?? 'square';
  const itemY = y + (title ? 20 : 0);
  const symbolMetrics = legendValues.map((value) =>
    legendSymbolMetrics(
      legendSymbolTypeForValue(legendSpec, value, defaultSymbolType),
      legendSpec.symbolSize,
    ),
  );
  const maxSymbolHeight = symbolMetrics.reduce(
    (max, metrics) => Math.max(max, metrics.height),
    0,
  );
  const labelFontSize = legendSpec.labelFontSize ?? 11;
  const itemSpacing = Math.max(18, maxSymbolHeight + 8, Math.ceil(labelFontSize + 7));
  const isHorizontalLegend = legendSpec.orient === 'bottom' || legendSpec.orient === 'top';
  const isRightLegend =
    legendSpec.orient === 'right' ||
    legendSpec.orient === 'top-right' ||
    legendSpec.orient === 'bottom-right';
  const labelWidths = legendValues.map((value) =>
    estimateLegendLabelWidth(String(value), labelFontSize),
  );
  const entryGap = isHorizontalLegend ? 18 : 0;
  const entryWidths = labelWidths.map(
    (labelWidth, index) => (symbolMetrics[index]?.width ?? 10) + 5 + labelWidth + entryGap,
  );
  const contentWidth = isHorizontalLegend
    ? entryWidths.reduce((total, width) => total + width, 0)
    : entryWidths.reduce((max, width) => Math.max(max, width), 0);
  const contentX = isRightLegend ? x + layout.legend.width - contentWidth : x;
  let horizontalX = isHorizontalLegend
    ? x + Math.max(0, (layout.legend.width - contentWidth) / 2)
    : contentX;

  for (let i = 0; i < legendValues.length; i++) {
    const value = legendValues[i];
    const color = scale(value) as string;
    const metrics =
      symbolMetrics[i] ?? legendSymbolMetrics(defaultSymbolType, legendSpec.symbolSize);
    const entryX = isHorizontalLegend ? horizontalX : contentX;
    const entryY = isHorizontalLegend
      ? y + (layout.legend.height - metrics.height) / 2
      : itemY + i * itemSpacing;

    marks.push(createLegendSymbol(metrics, entryX, entryY, color, i));

    // Label
    marks.push({
      type: 'text',
      x: entryX + metrics.width + 5,
      y: entryY + metrics.height / 2,
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

function legendSymbolTypeForValue(
  legendSpec: LegendSpec,
  value: unknown,
  fallback: LegendSymbolType,
): LegendSymbolType {
  return legendSpec.symbolTypeByValue?.[String(value)] ?? fallback;
}

function legendSymbolMetrics(
  symbolType: LegendSymbolType,
  explicitSize: number | undefined,
): LegendSymbolMetrics {
  const size = explicitSize ?? (symbolType === 'line' || symbolType === 'area' ? 28 : 10);
  if (symbolType === 'line' || symbolType === 'area') {
    return {
      type: symbolType,
      width: size,
      height: Math.max(8, Math.min(12, Math.round(size * 0.4))),
    };
  }
  return {
    type: symbolType,
    width: size,
    height: size,
  };
}

function createLegendSymbol(
  metrics: LegendSymbolMetrics,
  x: number,
  y: number,
  color: string,
  entryIndex: number,
): PathMark | RectMark | SymbolMark {
  if (metrics.type === 'line') {
    const yMid = y + metrics.height / 2;
    return {
      type: 'path',
      x: 0,
      y: 0,
      path: `M${x},${yMid} L${x + metrics.width},${yMid}`,
      datum: { entryIndex },
      style: {
        stroke: color,
        strokeWidth: 2.25,
        fill: undefined,
      },
    } as PathMark;
  }

  if (metrics.type === 'square' || metrics.type === 'area') {
    return {
      type: 'rect',
      x,
      y,
      width: metrics.width,
      height: metrics.height,
      datum: { entryIndex },
      style: {
        fill: color,
        stroke: '#000',
        strokeWidth: 0.5,
      },
    } as RectMark;
  }

  return {
    type: 'symbol',
    x: x + metrics.width / 2,
    y: y + metrics.height / 2,
    shape: metrics.type,
    size: metrics.width * metrics.height,
    datum: { entryIndex },
    style: {
      fill: color,
      stroke: '#000',
      strokeWidth: 0.5,
    },
  } as SymbolMark;
}
