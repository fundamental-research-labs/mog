import { formatExcelValueResult } from '@mog/spreadsheet-utils/number-formats';
import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { TrendlineResult } from '../../../math/trendlines';
import type { ChartConfig, TrendlineConfig } from '../../../types';
import { resolveChartTextColor } from '../../../utils/chart-colors';
import { resolverContextFromConfig } from '../../style-resolver';
import {
  TRENDLINE_LABEL_COLOR_FIELD,
  TRENDLINE_LABEL_FONT_SIZE_FIELD,
  TRENDLINE_LABEL_LAYOUT_X_FIELD,
  TRENDLINE_LABEL_LAYOUT_Y_FIELD,
  TRENDLINE_LABEL_TEXT_FIELD,
  TRENDLINE_LABEL_X_FIELD,
  TRENDLINE_LABEL_Y_FIELD,
} from '../fields';
import { trendlineXFieldForChartType } from '../transforms';
import { sourceRows, sourceSeriesIndexForRows, trendlineResult } from './trendline-data';

export function buildTrendlineLabelLayer(
  config: ChartConfig,
  rows: DataRow[],
  trendline: TrendlineConfig,
  seriesName?: string,
): UnitSpec | undefined {
  const xField = trendlineXFieldForChartType(config.type);
  const result = trendlineResult(sourceRows(rows, seriesName), xField, trendline);
  const labelText = trendlineLabelText(trendline, result);
  const lastPoint = result?.points.at(-1);
  if (!labelText.text || !lastPoint) return undefined;
  const manualLayout = trendline.label?.layout;
  const manualX = finiteNumber(manualLayout?.x);
  const manualY = finiteNumber(manualLayout?.y);
  const hasManualPosition = manualX !== undefined || manualY !== undefined;

  const labelRow: DataRow = {
    [TRENDLINE_LABEL_X_FIELD]: lastPoint[0],
    [TRENDLINE_LABEL_Y_FIELD]: lastPoint[1],
    [TRENDLINE_LABEL_TEXT_FIELD]: labelText.text,
  };
  if (manualX !== undefined) labelRow[TRENDLINE_LABEL_LAYOUT_X_FIELD] = manualX;
  if (manualY !== undefined) labelRow[TRENDLINE_LABEL_LAYOUT_Y_FIELD] = manualY;
  const sourceSeriesIndex = sourceSeriesIndexForRows(rows, seriesName);
  const ownerKey =
    sourceSeriesIndex === undefined
      ? 'trendlineLabel(0)'
      : `trendlineLabel(seriesIdx=${sourceSeriesIndex},idx=0)`;
  const color =
    resolveChartTextColor(
      trendline.label?.format?.font?.color,
      resolverContextFromConfig(config, ownerKey),
    ) ?? labelText.color;
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
              manualLayout?.layoutTarget === 'inner'
                ? ('plotFraction' as const)
                : ('chartFraction' as const),
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

function trendlineLabelText(
  trendline: TrendlineConfig,
  result: TrendlineResult | null,
): { text?: string; color?: string } {
  const parts: string[] = [];
  let color: string | undefined;
  if (trendline.label?.text) parts.push(trendline.label.text);
  if (result && (trendline.displayEquation ?? trendline.showEquation)) parts.push(result.equation);
  if (result && (trendline.displayRSquared ?? trendline.showR2)) {
    const formatted = trendline.label?.numberFormat
      ? formatExcelValueResult(result.r2, trendline.label.numberFormat)
      : { text: result.r2.toFixed(3) };
    color ??= formatted.color;
    parts.push(`R^2 = ${formatted.text}`);
  }
  const text = parts.length > 0 ? parts.join('\n') : undefined;
  return {
    ...(text !== undefined ? { text } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
