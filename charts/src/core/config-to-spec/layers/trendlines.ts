import { formatExcelValue } from '@mog/spreadsheet-utils/number-formats';
import type { DataRow, EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import { generateTrendlinePoints, type TrendlineResult } from '../../../math/trendlines';
import type { ChartConfig, ChartData, TrendlineConfig } from '../../../types';
import {
  POINT_INDEX_FIELD,
  SERIES_FIELD,
  TRENDLINE_LABEL_COLOR_FIELD,
  TRENDLINE_LABEL_FONT_SIZE_FIELD,
  TRENDLINE_LABEL_LAYOUT_X_FIELD,
  TRENDLINE_LABEL_LAYOUT_Y_FIELD,
  TRENDLINE_LABEL_TEXT_FIELD,
  TRENDLINE_LABEL_X_FIELD,
  TRENDLINE_LABEL_Y_FIELD,
  VALUE_FIELD,
} from '../fields';
import { buildTrendlineTransform, trendlineXFieldForChartType } from '../transforms';

export function buildTrendlineLayers(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
  rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const chartTrendlines = normalizeTrendlines(config.trendlines, config.trendline);
  for (const trendline of chartTrendlines) {
    layers.push(...buildTrendlineAndLabelLayers(config, encoding, rows, trendline));
  }

  for (let i = 0; i < data.series.length; i++) {
    const seriesName = data.series[i].name;
    const seriesConfig = config.series?.[i];
    for (const trendline of normalizeTrendlines(seriesConfig?.trendlines, seriesConfig?.trendline)) {
      layers.push(...buildTrendlineAndLabelLayers(config, encoding, rows, trendline, seriesName));
    }
  }
  return layers;
}

function buildTrendlineAndLabelLayers(
  config: ChartConfig,
  encoding: EncodingSpec,
  rows: DataRow[],
  trendline: TrendlineConfig,
  seriesName?: string,
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const trendlineLayer = buildTrendlineLayer(config, encoding, rows, trendline, seriesName);
  if (trendlineLayer) layers.push(trendlineLayer);
  const labelLayer = buildTrendlineLabelLayer(config, rows, trendline, seriesName);
  if (labelLayer) layers.push(labelLayer);
  return layers;
}

function buildTrendlineLayer(
  config: ChartConfig,
  encoding: EncodingSpec,
  rows: DataRow[],
  trendline: TrendlineConfig,
  seriesName?: string,
): UnitSpec {
  const xField = trendlineXFieldForChartType(config.type);
  const mark: MarkSpec = {
    type: 'line',
    stroke: trendline.color,
    strokeWidth: trendline.lineWidth ?? trendline.lineFormat?.width ?? 2,
    strokeDash: trendline.lineFormat?.dashStyle && trendline.lineFormat.dashStyle !== 'solid' ? [4, 4] : undefined,
  };
  if (usesComputedTrendlineRows(trendline)) {
    const result = trendlineResult(sourceRows(rows, seriesName), xField, trendline);
    return {
      mark,
      data: { values: trendlineRows(result, xField) },
      encoding: trendlineEncoding(encoding, xField),
    };
  }

  const transform = [
    ...(seriesName ? [{ type: 'filter' as const, filter: { field: SERIES_FIELD, equal: seriesName } }] : []),
    ...buildTrendlineTransform(trendline, xField, VALUE_FIELD),
  ];
  return {
    mark,
    encoding: trendlineEncoding(encoding, xField),
    transform,
  };
}

function buildTrendlineLabelLayer(
  config: ChartConfig,
  rows: DataRow[],
  trendline: TrendlineConfig,
  seriesName?: string,
): UnitSpec | undefined {
  const xField = trendlineXFieldForChartType(config.type);
  const result = trendlineResult(sourceRows(rows, seriesName), xField, trendline);
  const text = trendlineLabelText(trendline, result);
  const lastPoint = result?.points.at(-1);
  if (!text || !lastPoint) return undefined;
  const manualLayout = trendline.label?.layout;
  const manualX = finiteNumber(manualLayout?.x);
  const manualY = finiteNumber(manualLayout?.y);
  const hasManualPosition = manualX !== undefined || manualY !== undefined;

  const labelRow: DataRow = {
    [TRENDLINE_LABEL_X_FIELD]: lastPoint[0],
    [TRENDLINE_LABEL_Y_FIELD]: lastPoint[1],
    [TRENDLINE_LABEL_TEXT_FIELD]: text,
  };
  if (manualX !== undefined) labelRow[TRENDLINE_LABEL_LAYOUT_X_FIELD] = manualX;
  if (manualY !== undefined) labelRow[TRENDLINE_LABEL_LAYOUT_Y_FIELD] = manualY;
  const color = colorToCss(trendline.label?.format?.font?.color);
  if (color) labelRow[TRENDLINE_LABEL_COLOR_FIELD] = color;
  if (trendline.label?.format?.font?.size !== undefined) {
    labelRow[TRENDLINE_LABEL_FONT_SIZE_FIELD] = trendline.label.format.font.size;
  }

  return {
    mark: {
      type: 'text',
      dx: hasManualPosition ? 0 : 6,
      dy: hasManualPosition ? 0 : -6,
      align: 'left',
      textBaseline: hasManualPosition ? 'top' : 'bottom',
      ...(hasManualPosition
        ? {
            xField: TRENDLINE_LABEL_LAYOUT_X_FIELD,
            yField: TRENDLINE_LABEL_LAYOUT_Y_FIELD,
            coordinateSystem:
              manualLayout?.layoutTarget === 'inner' ? ('plotFraction' as const) : ('chartFraction' as const),
          }
        : {}),
      colorField: TRENDLINE_LABEL_COLOR_FIELD,
      fontSizeField: TRENDLINE_LABEL_FONT_SIZE_FIELD,
    },
    data: { values: [labelRow] },
    encoding: {
      x: { field: TRENDLINE_LABEL_X_FIELD, type: 'quantitative' },
      y: { field: TRENDLINE_LABEL_Y_FIELD, type: 'quantitative' },
      text: { field: TRENDLINE_LABEL_TEXT_FIELD, type: 'nominal' },
    },
  };
}

function trendlineEncoding(encoding: EncodingSpec, xField: string): EncodingSpec {
  return {
    x:
      xField === POINT_INDEX_FIELD
        ? { field: POINT_INDEX_FIELD, type: 'quantitative' }
        : { ...encoding.x, field: xField, type: 'quantitative' },
    y: { ...encoding.y, field: VALUE_FIELD, type: 'quantitative' },
  };
}

function trendlineRows(result: TrendlineResult | null, xField: string): DataRow[] {
  return (result?.points ?? []).map(([x, y]) => ({ [xField]: x, [VALUE_FIELD]: y }));
}

function trendlineResult(
  rows: DataRow[],
  xField: string,
  trendline: TrendlineConfig,
): TrendlineResult | null {
  const points = rows
    .map((row): [number, number] | undefined => {
      const x = numeric(row[xField]);
      const y = numeric(row[VALUE_FIELD]);
      return x !== undefined && y !== undefined ? [x, y] : undefined;
    })
    .filter((point): point is [number, number] => point !== undefined);
  return generateTrendlinePoints(points, {
    ...trendline,
    type: normalizedTrendlineType(trendline.type),
  });
}

function sourceRows(rows: DataRow[], seriesName?: string): DataRow[] {
  return seriesName ? rows.filter((row) => row[SERIES_FIELD] === seriesName) : rows;
}

function trendlineLabelText(
  trendline: TrendlineConfig,
  result: TrendlineResult | null,
): string | undefined {
  const parts: string[] = [];
  if (trendline.label?.text) parts.push(trendline.label.text);
  if (result && (trendline.displayEquation ?? trendline.showEquation)) parts.push(result.equation);
  if (result && (trendline.displayRSquared ?? trendline.showR2)) {
    const formatted = trendline.label?.numberFormat
      ? formatExcelValue(result.r2, trendline.label.numberFormat)
      : result.r2.toFixed(3);
    parts.push(`R^2 = ${formatted}`);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function normalizedTrendlineType(type: string | undefined): TrendlineConfig['type'] {
  switch (type) {
    case 'exp':
      return 'exponential';
    case 'log':
      return 'logarithmic';
    case 'poly':
      return 'polynomial';
    case 'pow':
      return 'power';
    case 'movingAvg':
      return 'moving-average';
    default:
      return type;
  }
}

function isMovingAverageTrendline(trendline: TrendlineConfig): boolean {
  return trendline.type === 'moving-average' || trendline.type === 'movingAvg';
}

function usesComputedTrendlineRows(trendline: TrendlineConfig): boolean {
  return (
    isMovingAverageTrendline(trendline) ||
    trendline.forward !== undefined ||
    trendline.backward !== undefined ||
    trendline.forwardPeriod !== undefined ||
    trendline.backwardPeriod !== undefined ||
    trendline.intercept !== undefined
  );
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function colorToCss(color: unknown): string | undefined {
  if (typeof color === 'string') return color.startsWith('#') ? color : `#${color}`;
  return undefined;
}

function normalizeTrendlines(
  trendlines: TrendlineConfig[] | undefined,
  singular: TrendlineConfig | undefined,
): TrendlineConfig[] {
  return [...(trendlines ?? []), ...(singular ? [singular] : [])].filter(
    (trendline) => trendline.show !== false,
  );
}
