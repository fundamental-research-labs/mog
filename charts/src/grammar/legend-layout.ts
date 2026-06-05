import type {
  ChannelSpec,
  EncodingSpec,
  LegendEntrySpec,
  LegendSpec,
  LegendSymbolType,
} from './spec';

export interface LegendSymbolMetrics {
  type: LegendSymbolType;
  width: number;
  height: number;
}

export interface ResolvedLegendEntry {
  value: unknown;
  label: string;
  symbolType: LegendSymbolType;
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  pointKey?: string;
  legendKey?: string;
  colorKey?: string;
  stockRole?: LegendEntrySpec['stockRole'];
}

export interface LegendLayoutItem {
  entry: ResolvedLegendEntry;
  metrics: LegendSymbolMetrics;
  labelWidth: number;
  width: number;
  height: number;
}

export interface LegendLayoutRow {
  items: LegendLayoutItem[];
  width: number;
  height: number;
}

export type LegendFlowOrient = 'horizontal' | 'vertical';
export type LegendOverflowPolicy = 'none' | 'overflowVisible';

export interface LegendLayoutEntryBounds {
  entryIndex: number;
  rowIndex: number;
  columnIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  symbolBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  labelBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  drawn: boolean;
  clipped: boolean;
}

export interface LegendFlowLayout {
  orient: LegendFlowOrient;
  rows: LegendLayoutRow[];
  entryCount: number;
  renderedEntryCount: number;
  visibleEntryCount: number;
  clippedEntryCount: number;
  rowCount: number;
  columnCount: number;
  labelFontSize: number;
  rowHeight: number;
  rowGap: number;
  entryGap: number;
  contentWidth: number;
  contentHeight: number;
  overflowPolicy: LegendOverflowPolicy;
  entryBounds: LegendLayoutEntryBounds[];
}

export const DEFAULT_LEGEND_SYMBOL_SIZE = 10;
export const LINE_LEGEND_SYMBOL_SIZE = 28;
export const AREA_LEGEND_SYMBOL_SIZE = 28;
export const LEGEND_ENTRY_GAP = 18;
export const LEGEND_SYMBOL_LABEL_GAP = 5;
export const LEGEND_MIN_ITEM_SPACING = 18;

export function isHorizontalLegendOrient(orient: LegendSpec['orient'] | undefined): boolean {
  return orient === 'top' || orient === 'bottom';
}

export function legendTitleHeight(legendSpec: LegendSpec | undefined): number {
  return legendSpec?.title ? 20 : 0;
}

export function resolveLegendEntries(
  legendSpec: LegendSpec | undefined,
  domain: readonly unknown[],
  defaultSymbolType: LegendSymbolType = legendSpec?.symbolType ?? 'square',
): ResolvedLegendEntry[] {
  if (legendSpec?.entries) {
    return orderLegendEntries(legendSpec.entries, legendSpec.reverse).map((entry) => ({
      value: entry.value,
      label: String(entry.label ?? entry.value),
      symbolType: entry.symbolType ?? defaultSymbolType,
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
    }));
  }

  return orderLegendValues(legendSpec?.values ?? domain, legendSpec?.reverse).map((value) => ({
    value,
    label: String(value),
    symbolType: defaultSymbolType,
  }));
}

export function resolveLegendEntriesForEncoding(
  encoding: EncodingSpec | undefined,
  legendSpec: LegendSpec | undefined,
): ResolvedLegendEntry[] {
  return resolveLegendEntries(
    legendSpec,
    legendDomainLabels(encoding?.color ?? encoding?.fill ?? encoding?.shape ?? encoding?.size),
    legendSpec?.symbolType ?? 'square',
  );
}

export function buildLegendFlowLayout(input: {
  entries: readonly ResolvedLegendEntry[];
  legendSpec: LegendSpec | undefined;
  availableWidth: number;
  orient?: LegendFlowOrient;
}): LegendFlowLayout {
  const labelFontSize = input.legendSpec?.labelFontSize ?? 11;
  const orient =
    input.orient ??
    (isHorizontalLegendOrient(input.legendSpec?.orient) ? 'horizontal' : 'vertical');
  const items = input.entries.map((entry) => {
    const metrics = legendSymbolMetrics(entry.symbolType, input.legendSpec?.symbolSize);
    const labelWidth = estimateLegendLabelWidth(entry.label, labelFontSize);
    return {
      entry,
      metrics,
      labelWidth,
      width: metrics.width + LEGEND_SYMBOL_LABEL_GAP + labelWidth,
      height: Math.max(metrics.height, labelFontSize),
    };
  });
  const rowHeight = items.reduce((max, item) => Math.max(max, item.height), labelFontSize);
  const maxSymbolHeight = items.reduce((max, item) => Math.max(max, item.metrics.height), 0);
  const rowGap = Math.max(
    LEGEND_MIN_ITEM_SPACING,
    maxSymbolHeight + 8,
    Math.ceil(labelFontSize + 7),
  );
  const rows = wrapLegendRows(items, Math.max(1, input.availableWidth));
  const contentWidth = rows.reduce((max, row) => Math.max(max, row.width), 0);
  const contentHeight = rows.length > 0 ? rowHeight + (rows.length - 1) * rowGap : 0;
  const entryBounds = legendEntryBounds({
    rows,
    rowHeight,
    rowGap,
    labelFontSize,
  });

  return {
    orient,
    rows,
    entryCount: items.length,
    renderedEntryCount: items.length,
    visibleEntryCount: items.length,
    clippedEntryCount: 0,
    rowCount: rows.length,
    columnCount: rows.reduce((max, row) => Math.max(max, row.items.length), 0),
    labelFontSize,
    rowHeight,
    rowGap,
    entryGap: LEGEND_ENTRY_GAP,
    contentWidth,
    contentHeight,
    overflowPolicy: 'overflowVisible',
    entryBounds,
  };
}

export function estimateVerticalLegendHeight(
  entries: readonly ResolvedLegendEntry[],
  legendSpec: LegendSpec | undefined,
): number {
  if (entries.length === 0) return 180;
  const flow = buildLegendFlowLayout({
    entries,
    legendSpec,
    availableWidth: Number.POSITIVE_INFINITY,
  });
  return (
    legendTitleHeight(legendSpec) + flow.rowHeight + Math.max(0, entries.length - 1) * flow.rowGap
  );
}

export function estimateLegendEntryWidth(
  entry: ResolvedLegendEntry,
  legendSpec: LegendSpec | undefined,
): number {
  const labelFontSize = legendSpec?.labelFontSize ?? 11;
  const metrics = legendSymbolMetrics(entry.symbolType, legendSpec?.symbolSize);
  return metrics.width + 6 + estimateLegendLabelWidth(entry.label, labelFontSize);
}

export function legendSymbolMetrics(
  symbolType: LegendSymbolType,
  explicitSize: number | undefined,
): LegendSymbolMetrics {
  const size = explicitSize ?? defaultLegendSymbolWidth(symbolType);
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

export function estimateLegendLabelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.7;
}

function wrapLegendRows(
  items: readonly LegendLayoutItem[],
  availableWidth: number,
): LegendLayoutRow[] {
  const rows: LegendLayoutRow[] = [];
  let row: LegendLayoutRow = { items: [], width: 0, height: 0 };

  for (const item of items) {
    const gap = row.items.length > 0 ? LEGEND_ENTRY_GAP : 0;
    if (row.items.length > 0 && row.width + gap + item.width > availableWidth) {
      rows.push(row);
      row = { items: [], width: 0, height: 0 };
    }
    row.items.push(item);
    row.width += (row.items.length > 1 ? LEGEND_ENTRY_GAP : 0) + item.width;
    row.height = Math.max(row.height, item.height);
  }

  if (row.items.length > 0) rows.push(row);
  return rows;
}

function legendEntryBounds(input: {
  rows: readonly LegendLayoutRow[];
  rowHeight: number;
  rowGap: number;
  labelFontSize: number;
}): LegendLayoutEntryBounds[] {
  const bounds: LegendLayoutEntryBounds[] = [];
  let entryIndex = 0;
  for (let rowIndex = 0; rowIndex < input.rows.length; rowIndex += 1) {
    const row = input.rows[rowIndex];
    if (!row) continue;
    let x = 0;
    const y = rowIndex * input.rowGap;
    for (let columnIndex = 0; columnIndex < row.items.length; columnIndex += 1) {
      const item = row.items[columnIndex];
      if (!item) continue;
      if (columnIndex > 0) x += LEGEND_ENTRY_GAP;
      const symbolY = y + (input.rowHeight - item.metrics.height) / 2;
      const labelX = x + item.metrics.width + LEGEND_SYMBOL_LABEL_GAP;
      const labelY = y + (input.rowHeight - input.labelFontSize) / 2;
      bounds.push({
        entryIndex,
        rowIndex,
        columnIndex,
        text: item.entry.label,
        x,
        y,
        width: item.width,
        height: input.rowHeight,
        symbolBounds: {
          x,
          y: symbolY,
          width: item.metrics.width,
          height: item.metrics.height,
        },
        labelBounds: {
          x: labelX,
          y: labelY,
          width: item.labelWidth,
          height: input.labelFontSize,
        },
        drawn: true,
        clipped: false,
      });
      x += item.width;
      entryIndex += 1;
    }
  }
  return bounds;
}

function orderLegendEntries(
  entries: readonly LegendEntrySpec[],
  reverse: boolean | undefined,
): LegendEntrySpec[] {
  return reverse ? [...entries].reverse() : [...entries];
}

function orderLegendValues(values: readonly unknown[], reverse: boolean | undefined): unknown[] {
  return reverse ? [...values].reverse() : [...values];
}

function defaultLegendSymbolWidth(symbolType: LegendSymbolType): number {
  if (symbolType === 'line') return LINE_LEGEND_SYMBOL_SIZE;
  if (symbolType === 'area') return AREA_LEGEND_SYMBOL_SIZE;
  return DEFAULT_LEGEND_SYMBOL_SIZE;
}

function legendDomainLabels(channel: ChannelSpec | undefined): string[] {
  const domain = channel?.scale && Array.isArray(channel.scale.domain) ? channel.scale.domain : [];
  return domain.map((value) => String(value));
}
