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

export interface LegendFlowLayout {
  rows: LegendLayoutRow[];
  labelFontSize: number;
  rowHeight: number;
  rowGap: number;
  entryGap: number;
  contentWidth: number;
  contentHeight: number;
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
}): LegendFlowLayout {
  const labelFontSize = input.legendSpec?.labelFontSize ?? 11;
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

  return {
    rows,
    labelFontSize,
    rowHeight,
    rowGap,
    entryGap: LEGEND_ENTRY_GAP,
    contentWidth,
    contentHeight,
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
    legendTitleHeight(legendSpec) +
    flow.rowHeight +
    Math.max(0, entries.length - 1) * flow.rowGap
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
