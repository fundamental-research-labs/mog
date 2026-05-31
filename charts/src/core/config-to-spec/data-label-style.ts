import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, DataLabelConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import { resolveChartOwnerFormat, resolverContextFromConfig } from '../style-resolver';
import {
  DATA_LABEL_COLOR_FIELD,
  DATA_LABEL_FONT_SIZE_FIELD,
  DATA_LABEL_LEADER_STROKE_FIELD,
  DATA_LABEL_LEADER_STROKE_WIDTH_FIELD,
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_ROTATION_FIELD,
} from './fields';
import { lineColor } from './data-row-style';
import { linePointsToCanvasPx } from './units';

export function applyDataLabelStyle(
  row: DataRow,
  label: DataLabelConfig,
  context: {
    config?: ChartConfig;
    sourceSeriesIndex: number;
    pointIndex: number;
    fallbackColor?: string;
  },
): void {
  const ownerKey = dataLabelOwnerKey(context.sourceSeriesIndex, context.pointIndex);
  const resolverContext = context.config ? resolverContextFromConfig(context.config, ownerKey) : {};
  const labelFormat = context.config
    ? resolveChartOwnerFormat(context.config, ownerKey, label.visualFormat)
    : label.visualFormat;
  const font = labelFormat?.font;
  const color = resolveChartTextColor(font?.color, resolverContext) ?? context.fallbackColor;
  if (color) row[DATA_LABEL_COLOR_FIELD] = color;
  if (font?.size !== undefined) row[DATA_LABEL_FONT_SIZE_FIELD] = font.size;
  const rotation = label.textOrientation ?? labelFormat?.textRotation;
  if (rotation !== undefined) row[DATA_LABEL_ROTATION_FIELD] = rotation;
  if (label.showLeaderLines === true || label.leaderLinesFormat) {
    row[DATA_LABEL_LEADER_VISIBLE_FIELD] = true;
    const line = label.leaderLinesFormat?.format;
    const stroke = lineColor(line, resolverContext);
    const strokeWidth = linePointsToCanvasPx(line?.width);
    if (stroke) row[DATA_LABEL_LEADER_STROKE_FIELD] = stroke;
    if (strokeWidth !== undefined) row[DATA_LABEL_LEADER_STROKE_WIDTH_FIELD] = strokeWidth;
  }
}

function dataLabelOwnerKey(sourceSeriesIndex: number, pointIndex: number): string {
  return `dataLabel(seriesIdx=${sourceSeriesIndex},pointIdx=${pointIndex})`;
}
