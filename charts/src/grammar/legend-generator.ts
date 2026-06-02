/**
 * Legend Generation
 *
 * Generates legend marks (symbols and labels) for color encodings.
 *
 * Extracted from compiler.ts.
 */

import type { AnyMark, PathMark, RectMark, SymbolMark, TextMark } from '../primitives/types';
import type { AnyScale, ScaleMap } from './encoding-resolver';
import {
  buildLegendFlowLayout,
  LEGEND_SYMBOL_LABEL_GAP,
  legendSymbolMetrics,
  legendTitleHeight,
  resolveLegendEntries,
} from './legend-layout';
import type {
  ChannelSpec,
  EncodingSpec,
  Layout,
  LegendSpec,
} from './spec';

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
  const defaultSymbolType = legendSpec.symbolType ?? 'square';
  const legendEntries = resolveLegendEntries(legendSpec, domain, defaultSymbolType);
  const labelFontSize = legendSpec.labelFontSize ?? 11;
  const isHorizontalLegend = legendSpec.orient === 'bottom' || legendSpec.orient === 'top';
  const isRightLegend =
    legendSpec.orient === 'right' ||
    legendSpec.orient === 'top-right' ||
    legendSpec.orient === 'bottom-right';

  if (isHorizontalLegend) {
    appendHorizontalLegendMarks({
      marks,
      legendEntries,
      legendSpec,
      scale,
      layout,
      x,
      y,
      labelFontSize,
    });
    return marks;
  }

  const flow = buildLegendFlowLayout({
    entries: legendEntries,
    legendSpec,
    availableWidth: 1,
  });
  const contentWidth = flow.contentWidth;
  const contentX = isRightLegend ? x + layout.legend.width - contentWidth : x;
  const itemY = y + legendTitleHeight(legendSpec);

  for (let i = 0; i < legendEntries.length; i++) {
    const entry = legendEntries[i];
    const color = scale(entry.value) as string;
    const metrics = legendSymbolMetrics(entry.symbolType, legendSpec.symbolSize);
    const entryX = contentX;
    const entryY = itemY + i * flow.rowGap;
    const symbolY = entryY + (flow.rowHeight - metrics.height) / 2;

    marks.push(createLegendSymbol(metrics, entryX, symbolY, color, i));

    // Label
    marks.push({
      type: 'text',
      x: entryX + metrics.width + LEGEND_SYMBOL_LABEL_GAP,
      y: entryY + flow.rowHeight / 2,
      text: entry.label,
      datum: { entryIndex: i },
      fontSize: labelFontSize,
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

function createLegendSymbol(
  metrics: ReturnType<typeof legendSymbolMetrics>,
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

function appendHorizontalLegendMarks(input: {
  marks: AnyMark[];
  legendEntries: ReturnType<typeof resolveLegendEntries>;
  legendSpec: LegendSpec;
  scale: AnyScale;
  layout: Layout;
  x: number;
  y: number;
  labelFontSize: number;
}): void {
  const flow = buildLegendFlowLayout({
    entries: input.legendEntries,
    legendSpec: input.legendSpec,
    availableWidth: input.layout.legend?.width ?? 1,
  });
  const titleHeight = legendTitleHeight(input.legendSpec);
  const availableContentHeight = Math.max(0, (input.layout.legend?.height ?? 0) - titleHeight);
  const contentY =
    input.y + titleHeight + Math.max(0, (availableContentHeight - flow.contentHeight) / 2);

  let entryIndex = 0;
  for (let rowIndex = 0; rowIndex < flow.rows.length; rowIndex += 1) {
    const row = flow.rows[rowIndex];
    if (!row) continue;
    let entryX = input.x + Math.max(0, ((input.layout.legend?.width ?? 0) - row.width) / 2);
    const rowY = contentY + rowIndex * flow.rowGap;
    for (const item of row.items) {
      const color = input.scale(item.entry.value) as string;
      const symbolY = rowY + (flow.rowHeight - item.metrics.height) / 2;
      input.marks.push(createLegendSymbol(item.metrics, entryX, symbolY, color, entryIndex));
      input.marks.push({
        type: 'text',
        x: entryX + item.metrics.width + LEGEND_SYMBOL_LABEL_GAP,
        y: rowY + flow.rowHeight / 2,
        text: item.entry.label,
        datum: { entryIndex },
        fontSize: input.labelFontSize,
        fontFamily: input.legendSpec.labelFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'left',
        textBaseline: 'middle',
        style: {
          fill: input.legendSpec.labelColor ?? '#000',
        },
      } as TextMark);
      entryX += item.width + flow.entryGap;
      entryIndex += 1;
    }
  }
}
