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
  isHorizontalLegendOrient,
  LEGEND_SYMBOL_LABEL_GAP,
  legendSymbolMetrics,
  legendTitleHeight,
  resolveLegendEntries,
  resolveLegendEntriesForEncoding,
} from './legend-layout';
import type { ChannelSpec, EncodingSpec, Layout, LegendSpec } from './spec';
import type { LegendTrace } from './types';

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

export function buildLegendTrace(
  encoding: EncodingSpec | undefined,
  layout: Layout,
  marks: readonly AnyMark[],
): LegendTrace {
  return {
    renderedPresent: Boolean(layout.legend || marks.length > 0),
    renderedVisible: marks.length > 0,
    generatedMarkCount: marks.length,
    sourceChannels: legendSourceChannels(encoding),
    ...renderedLegendFlow(encoding, layout),
    ...(marks.length > 0 ? renderedLegendEntries(encoding) : {}),
    chartWidth: layout.width,
    chartHeight: layout.height,
    ...(layout.legend
      ? {
          area: {
            x: layout.legend.x,
            y: layout.legend.y,
            width: layout.legend.width,
            height: layout.legend.height,
          },
        }
      : {}),
  };
}

function renderedLegendFlow(
  encoding: EncodingSpec | undefined,
  layout: Layout,
): Pick<LegendTrace, 'flow'> {
  if (!layout.legend) return {};
  const legendSpec = firstLegendSpec(encoding);
  const entries = resolveLegendEntriesForEncoding(encoding, legendSpec);
  if (entries.length === 0) {
    return {
      flow: {
        orient: isHorizontalLegendOrient(legendSpec?.orient) ? 'horizontal' : 'vertical',
        entryCount: 0,
        renderedEntryCount: 0,
        visibleEntryCount: 0,
        clippedEntryCount: 0,
        rowCount: 0,
        columnCount: 0,
        rowGap: 0,
        entryGap: 0,
        contentWidth: 0,
        contentHeight: 0,
        overflowPolicy: 'none',
        entries: [],
      },
    };
  }

  const horizontal = isHorizontalLegendOrient(legendSpec?.orient);
  const flow = buildLegendFlowLayout({
    entries,
    legendSpec,
    availableWidth: horizontal ? layout.legend.width : 1,
    orient: horizontal ? 'horizontal' : 'vertical',
  });
  return {
    flow: {
      orient: flow.orient,
      entryCount: flow.entryCount,
      renderedEntryCount: flow.renderedEntryCount,
      visibleEntryCount: flow.visibleEntryCount,
      clippedEntryCount: flow.clippedEntryCount,
      rowCount: flow.rowCount,
      columnCount: flow.columnCount,
      rowGap: flow.rowGap,
      entryGap: flow.entryGap,
      contentWidth: flow.contentWidth,
      contentHeight: flow.contentHeight,
      overflowPolicy: flow.overflowPolicy,
      entries: horizontal
        ? horizontalLegendFlowEntryBounds(flow, layout.legend, legendSpec)
        : verticalLegendFlowEntryBounds(flow, layout.legend, legendSpec),
    },
  };
}

function horizontalLegendFlowEntryBounds(
  flow: ReturnType<typeof buildLegendFlowLayout>,
  area: NonNullable<Layout['legend']>,
  legendSpec: LegendSpec | undefined,
): NonNullable<LegendTrace['flow']>['entries'] {
  const titleHeight = legendTitleHeight(legendSpec);
  const availableContentHeight = Math.max(0, area.height - titleHeight);
  const contentY =
    area.y + titleHeight + Math.max(0, (availableContentHeight - flow.contentHeight) / 2);
  const rowOffsets = flow.rows.map((row) => Math.max(0, (area.width - row.width) / 2));
  return flow.entryBounds.map((bounds) =>
    translateLegendFlowBounds(bounds, {
      x: area.x + (rowOffsets[bounds.rowIndex] ?? 0),
      y: contentY,
    }),
  );
}

function verticalLegendFlowEntryBounds(
  flow: ReturnType<typeof buildLegendFlowLayout>,
  area: NonNullable<Layout['legend']>,
  legendSpec: LegendSpec | undefined,
): NonNullable<LegendTrace['flow']>['entries'] {
  const orient = legendSpec?.orient;
  const isRight = orient === 'right' || orient === 'top-right' || orient === 'bottom-right';
  const contentX = isRight ? area.x + area.width - flow.contentWidth : area.x;
  const contentY = area.y + legendTitleHeight(legendSpec);
  return flow.entryBounds.map((bounds) =>
    translateLegendFlowBounds(bounds, {
      x: contentX,
      y: contentY,
    }),
  );
}

function translateLegendFlowBounds(
  bounds: ReturnType<typeof buildLegendFlowLayout>['entryBounds'][number],
  offset: { x: number; y: number },
): NonNullable<LegendTrace['flow']>['entries'][number] {
  return {
    entryIndex: bounds.entryIndex,
    rowIndex: bounds.rowIndex,
    columnIndex: bounds.columnIndex,
    text: bounds.text,
    x: bounds.x + offset.x,
    y: bounds.y + offset.y,
    width: bounds.width,
    height: bounds.height,
    symbolBounds: {
      x: bounds.symbolBounds.x + offset.x,
      y: bounds.symbolBounds.y + offset.y,
      width: bounds.symbolBounds.width,
      height: bounds.symbolBounds.height,
    },
    labelBounds: {
      x: bounds.labelBounds.x + offset.x,
      y: bounds.labelBounds.y + offset.y,
      width: bounds.labelBounds.width,
      height: bounds.labelBounds.height,
    },
    drawn: bounds.drawn,
    clipped: bounds.clipped,
  };
}

function renderedLegendEntries(
  encoding: EncodingSpec | undefined,
): Pick<LegendTrace, 'renderedEntries'> {
  const legendSpec = firstLegendSpec(encoding);
  const entries = resolveLegendEntriesForEncoding(encoding, legendSpec);
  if (entries.length === 0) return {};
  return {
    renderedEntries: entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      symbolType: entry.symbolType,
      ...(entry.seriesIndex !== undefined ? { seriesIndex: entry.seriesIndex } : {}),
      ...(entry.sourceSeriesIndex !== undefined
        ? { sourceSeriesIndex: entry.sourceSeriesIndex }
        : {}),
      ...(entry.sourceSeriesKey !== undefined ? { sourceSeriesKey: entry.sourceSeriesKey } : {}),
      ...(entry.pointIndex !== undefined ? { pointIndex: entry.pointIndex } : {}),
      ...(entry.pointKey !== undefined ? { pointKey: entry.pointKey } : {}),
      ...(entry.legendKey !== undefined ? { legendKey: entry.legendKey } : {}),
      ...(entry.colorKey !== undefined ? { colorKey: entry.colorKey } : {}),
      ...(entry.stockRole !== undefined ? { stockRole: entry.stockRole } : {}),
    })),
  };
}

function firstLegendSpec(encoding: EncodingSpec | undefined): LegendSpec | undefined {
  const legends = [
    encoding?.color?.legend,
    encoding?.fill?.legend,
    encoding?.shape?.legend,
    encoding?.size?.legend,
  ];
  return legends.find((legend): legend is LegendSpec => legend !== null && legend !== undefined);
}

function legendSourceChannels(encoding: EncodingSpec | undefined): string[] {
  const channels: string[] = [];
  if (encoding?.color?.field && encoding.color.legend !== null) channels.push('color');
  if (encoding?.fill?.field && encoding.fill.legend !== null) channels.push('fill');
  if (encoding?.shape?.field && encoding.shape.legend !== null) channels.push('shape');
  if (encoding?.size?.field && encoding.size.legend !== null) channels.push('size');
  return channels;
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
