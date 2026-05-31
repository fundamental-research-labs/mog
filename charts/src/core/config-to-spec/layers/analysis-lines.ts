import type { DataRow, EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartFormat, ChartLineSettings } from '../../../types';
import { resolveFormatFillColor, resolveLineColor } from '../../../utils/chart-colors';
import { resolveChartLineStyle, resolverContextFromConfig } from '../../style-resolver';
import {
  ANALYSIS_DIRECTION_FIELD,
  ANALYSIS_FILL_FIELD,
  ANALYSIS_STROKE_FIELD,
  ANALYSIS_STROKE_WIDTH_FIELD,
  ANALYSIS_X2_FIELD,
  ANALYSIS_X_FIELD,
  ANALYSIS_Y2_FIELD,
  ANALYSIS_Y_FIELD,
  CATEGORY_FIELD,
  SERIES_INDEX_FIELD,
  SERIES_ORDER_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  VALUE_FIELD,
} from '../fields';
import { linePointsToCanvasPx } from '../units';

export function buildAnalysisLineLayers(
  config: ChartConfig,
  encoding: EncodingSpec,
  rows: DataRow[],
): UnitSpec[] {
  if (!encoding.x || !encoding.y) return [];
  const layers: UnitSpec[] = [];

  if (isVisibleLine(config.dropLines)) {
    layers.push(buildDropLineLayer(config, encoding));
  }

  if (isVisibleLine(config.highLowLines)) {
    const data = buildHighLowRows(rows, encoding);
    if (data.length > 0) {
      layers.push(buildRangeRuleLayer(config, encoding, data, config.highLowLines));
    }
  }

  if (isVisibleLine(config.seriesLines)) {
    const data = buildSeriesLineRows(rows, encoding);
    if (data.length > 0) {
      layers.push(buildRangeRuleLayer(config, encoding, data, config.seriesLines));
    }
  }

  if (config.upDownBars) {
    layers.push(...buildUpDownBarLayers(config, encoding, rows));
  }

  return layers;
}

function buildDropLineLayer(config: ChartConfig, encoding: EncodingSpec): UnitSpec {
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const mark = lineMark(config, config.dropLines, '#808080');
  return horizontal
    ? {
        mark,
        encoding: {
          x: encoding.x!,
          y: encoding.y!,
          x2: { ...encoding.x!, value: 0, field: undefined },
          y2: encoding.y!,
        },
      }
    : {
        mark,
        encoding: {
          x: encoding.x!,
          y: encoding.y!,
          x2: encoding.x!,
          y2: { ...encoding.y!, value: 0, field: undefined },
        },
      };
}

function buildRangeRuleLayer(
  config: ChartConfig,
  encoding: EncodingSpec,
  data: DataRow[],
  settings: ChartLineSettings | undefined,
): UnitSpec {
  const horizontal = encoding.x?.field === VALUE_FIELD;
  return {
    mark: lineMark(config, settings, '#808080'),
    data: { values: data },
    encoding: horizontal
      ? {
          x: { ...encoding.x!, field: ANALYSIS_X_FIELD, type: 'quantitative' },
          y: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
          x2: { ...encoding.x!, field: ANALYSIS_X2_FIELD, type: 'quantitative' },
          y2: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
        }
      : {
          x: { ...encoding.x!, field: ANALYSIS_X_FIELD },
          y: { ...encoding.y!, field: ANALYSIS_Y_FIELD, type: 'quantitative' },
          x2: { ...encoding.x!, field: ANALYSIS_X_FIELD },
          y2: { ...encoding.y!, field: ANALYSIS_Y2_FIELD, type: 'quantitative' },
        },
  };
}

function buildUpDownBarLayers(
  config: ChartConfig,
  encoding: EncodingSpec,
  rows: DataRow[],
): UnitSpec[] {
  const data = buildUpDownRows(config, rows, encoding);
  if (data.length === 0) return [];

  const horizontal = encoding.x?.field === VALUE_FIELD;
  const baseEncoding = horizontal
    ? {
        x: { ...encoding.x!, field: ANALYSIS_X_FIELD, type: 'quantitative' as const },
        y: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
        x2: { ...encoding.x!, field: ANALYSIS_X2_FIELD, type: 'quantitative' as const },
        y2: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
      }
    : {
        x: { ...encoding.x!, field: ANALYSIS_X_FIELD },
        y: { ...encoding.y!, field: ANALYSIS_Y_FIELD, type: 'quantitative' as const },
        x2: { ...encoding.x!, field: ANALYSIS_X_FIELD },
        y2: { ...encoding.y!, field: ANALYSIS_Y2_FIELD, type: 'quantitative' as const },
      };

  return [
    {
      mark: upDownMark(config, config.upDownBars?.upFormat, '#ffffff'),
      data: { values: data },
      encoding: baseEncoding,
      transform: [{ type: 'filter', filter: { field: ANALYSIS_DIRECTION_FIELD, equal: 'up' } }],
    },
    {
      mark: upDownMark(config, config.upDownBars?.downFormat, '#808080'),
      data: { values: data },
      encoding: baseEncoding,
      transform: [{ type: 'filter', filter: { field: ANALYSIS_DIRECTION_FIELD, equal: 'down' } }],
    },
  ];
}

function buildHighLowRows(rows: DataRow[], encoding: EncodingSpec): DataRow[] {
  const grouped = groupByCategory(rows);
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const result: DataRow[] = [];

  for (const [category, categoryRows] of grouped) {
    const highs = categoryRows
      .map((row) => numeric(row[STOCK_HIGH_FIELD]) ?? numeric(row[VALUE_FIELD]))
      .filter(isFiniteNumber);
    const lows = categoryRows
      .map((row) => numeric(row[STOCK_LOW_FIELD]) ?? numeric(row[VALUE_FIELD]))
      .filter(isFiniteNumber);
    if (highs.length === 0 || lows.length === 0) continue;
    result.push(analysisRangeRow(category, Math.min(...lows), Math.max(...highs), horizontal));
  }

  return result;
}

function buildSeriesLineRows(rows: DataRow[], encoding: EncodingSpec): DataRow[] {
  const grouped = groupByCategory(rows);
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const result: DataRow[] = [];

  for (const [category, categoryRows] of grouped) {
    const ordered = [...categoryRows].sort((a, b) => seriesOrder(a) - seriesOrder(b));
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = numeric(ordered[i - 1][VALUE_FIELD]);
      const current = numeric(ordered[i][VALUE_FIELD]);
      if (previous === undefined || current === undefined) continue;
      result.push(analysisRangeRow(category, previous, current, horizontal));
    }
  }

  return result;
}

function buildUpDownRows(
  config: ChartConfig,
  rows: DataRow[],
  encoding: EncodingSpec,
): DataRow[] {
  const grouped = groupByCategory(rows);
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const result: DataRow[] = [];

  for (const [category, categoryRows] of grouped) {
    const pair = upDownPair(categoryRows);
    if (!pair) continue;
    const [start, end] = pair;
    const row = analysisRangeRow(category, start, end, horizontal);
    const strokeWidth = upDownStrokeWidth(config);
    if (strokeWidth !== undefined) row[ANALYSIS_STROKE_WIDTH_FIELD] = strokeWidth;
    row[ANALYSIS_DIRECTION_FIELD] = end >= start ? 'up' : 'down';
    result.push(row);
  }

  return result;
}

function upDownPair(rows: DataRow[]): [number, number] | undefined {
  const stockRow = rows.find(
    (row) =>
      numeric(row[STOCK_OPEN_FIELD]) !== undefined && numeric(row[STOCK_CLOSE_FIELD]) !== undefined,
  );
  if (stockRow) {
    return [numeric(stockRow[STOCK_OPEN_FIELD])!, numeric(stockRow[STOCK_CLOSE_FIELD])!];
  }

  const ordered = [...rows].sort((a, b) => seriesOrder(a) - seriesOrder(b));
  if (ordered.length < 2) return undefined;
  const start = numeric(ordered[0][VALUE_FIELD]);
  const end = numeric(ordered[1][VALUE_FIELD]);
  return start !== undefined && end !== undefined ? [start, end] : undefined;
}

function analysisRangeRow(
  category: unknown,
  start: number,
  end: number,
  horizontal: boolean,
): DataRow {
  return horizontal
    ? {
        [ANALYSIS_X_FIELD]: start,
        [ANALYSIS_X2_FIELD]: end,
        [ANALYSIS_Y_FIELD]: category,
      }
    : {
        [ANALYSIS_X_FIELD]: category,
        [ANALYSIS_Y_FIELD]: start,
        [ANALYSIS_Y2_FIELD]: end,
      };
}

function groupByCategory(rows: DataRow[]): Map<unknown, DataRow[]> {
  const grouped = new Map<unknown, DataRow[]>();
  for (const row of rows) {
    const category = row[CATEGORY_FIELD];
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push(row);
  }
  return grouped;
}

function seriesOrder(row: DataRow): number {
  return numeric(row[SERIES_ORDER_FIELD]) ?? numeric(row[SERIES_INDEX_FIELD]) ?? 0;
}

function lineMark(
  config: ChartConfig,
  settings: ChartLineSettings | undefined,
  fallbackStroke: string,
): MarkSpec {
  const line = settings?.format;
  const context = resolverContextFromConfig(config, 'analysisLine');
  const resolvedLine = resolveChartLineStyle(line, context, {
    widthToPx: linePointsToCanvasPx,
  });
  const stroke = resolvedLine?.paint?.type === 'solid' ? resolvedLine.paint.color : undefined;
  const mark: MarkSpec = {
    type: 'rule',
    stroke: stroke ?? resolveLineColor(line, context) ?? fallbackStroke,
    strokeWidth: resolvedLine?.width ?? linePointsToCanvasPx(line?.width) ?? 1,
    strokeField: ANALYSIS_STROKE_FIELD,
    strokeWidthField: ANALYSIS_STROKE_WIDTH_FIELD,
  };
  if (resolvedLine?.dash) mark.strokeDash = resolvedLine.dash;
  if (resolvedLine) mark.line = resolvedLine;
  if (resolvedLine?.opacity !== undefined) mark.opacity = resolvedLine.opacity;
  return mark;
}

function upDownMark(config: ChartConfig, format: ChartFormat | undefined, fallback: string): MarkSpec {
  const context = resolverContextFromConfig(config, 'upDownBars');
  const stroke =
    resolveFormatFillColor(format, context) ?? resolveLineColor(format?.line, context) ?? fallback;
  return {
    type: 'rule',
    stroke,
    strokeWidth: upDownStrokeWidth(config) ?? 8,
    strokeField: ANALYSIS_FILL_FIELD,
    strokeWidthField: ANALYSIS_STROKE_WIDTH_FIELD,
  };
}

function upDownStrokeWidth(config: ChartConfig): number | undefined {
  const gapWidth = config.upDownBars?.gapWidth;
  if (typeof gapWidth !== 'number' || !Number.isFinite(gapWidth)) return undefined;
  return Math.max(2, 12 * (100 / Math.max(1, gapWidth)));
}

function isVisibleLine(settings: ChartLineSettings | undefined): boolean {
  return Boolean(settings && settings.visible !== false && settings.format?.noFill !== true);
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined;
}
