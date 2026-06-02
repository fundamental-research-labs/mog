import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartDataPointValueState, PointFormat, SeriesConfig } from '../../types';
import type { PieLabelGeometry } from './data-label-geometry';
import {
  DATA_LABEL_ALIGN_FIELD,
  DATA_LABEL_ANCHOR_X_FIELD,
  DATA_LABEL_ANCHOR_Y_FIELD,
  DATA_LABEL_BASELINE_FIELD,
  DATA_LABEL_DX_FIELD,
  DATA_LABEL_DY_FIELD,
  DATA_LABEL_LAYOUT_TARGET_FIELD,
  DATA_LABEL_LAYOUT_X_FIELD,
  DATA_LABEL_LAYOUT_Y_FIELD,
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_LINE_HEIGHT_FIELD,
  DATA_LABEL_MAX_WIDTH_FIELD,
  DATA_LABEL_NEAR_ZERO_VALUE_FIELD,
  DATA_LABEL_POSITION_FIELD,
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_VALUE_ANCHOR_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  DATA_LABEL_ZERO_VALUE_FIELD,
  DATA_LABEL_X_FIELD,
  DATA_LABEL_Y_FIELD,
} from './fields';
import { composeLabelText, mergeLabels } from './data-label-format';
import { pieLabelCoordinates } from './data-label-geometry';
import { labelPlacement, manualLabelLayout } from './data-label-position';
import { applyDataLabelStyle } from './data-label-style';
import { isPieLikeChartType } from './pie-like';

export interface ApplyDataLabelContext {
  config?: ChartConfig;
  seriesConfig?: SeriesConfig;
  seriesName: string;
  sourceSeriesIndex: number;
  pointIndex: number;
  category: string | number;
  value: number;
  valueState?: ChartDataPointValueState;
  bubbleSize?: number;
  percentage?: number;
  pieLabelGeometry?: PieLabelGeometry;
}

export function applyDataLabelToRow(
  row: DataRow,
  context: ApplyDataLabelContext,
  pointFormat: PointFormat | undefined,
): void {
  const label = mergeLabels(
    context.config?.dataLabels,
    context.seriesConfig?.dataLabels,
    pointFormat?.dataLabel,
  );
  if (!label || label.delete === true || label.show === false) return;
  if (context.valueState !== undefined && context.valueState !== 'value') return;

  const labelText = composeLabelText(label, context);
  if (!labelText.text) return;
  row[DATA_LABEL_VISIBLE_FIELD] = true;
  row[DATA_LABEL_TEXT_FIELD] = labelText.text;
  row[DATA_LABEL_POSITION_FIELD] = label.position ?? 'default';
  applyPieDoughnutLabelValueClassification(row, context);
  const placement = labelPlacement(label.position, context.config?.type, context.value);
  const layout = manualLabelLayout(label);
  row[DATA_LABEL_DX_FIELD] = layout.hasManualPosition ? 0 : placement.dx;
  row[DATA_LABEL_DY_FIELD] = layout.hasManualPosition ? 0 : placement.dy;
  row[DATA_LABEL_ALIGN_FIELD] = layout.hasManualPosition ? 'left' : placement.align;
  row[DATA_LABEL_BASELINE_FIELD] = layout.hasManualPosition ? 'top' : placement.baseline;
  row[DATA_LABEL_VALUE_ANCHOR_FIELD] = context.value + placement.valueDelta(context.value);
  if (layout.hasManualPosition) {
    row[DATA_LABEL_LAYOUT_TARGET_FIELD] = layout.layoutTarget;
    if (layout.manualX !== undefined) row[DATA_LABEL_LAYOUT_X_FIELD] = layout.manualX;
    if (layout.manualY !== undefined) row[DATA_LABEL_LAYOUT_Y_FIELD] = layout.manualY;
  }
  if (context.pieLabelGeometry) {
    const coordinates = pieLabelCoordinates(context.pieLabelGeometry, label.position);
    row[DATA_LABEL_ANCHOR_X_FIELD] = coordinates.anchorX;
    row[DATA_LABEL_ANCHOR_Y_FIELD] = coordinates.anchorY;
    row[DATA_LABEL_X_FIELD] = coordinates.labelX;
    row[DATA_LABEL_Y_FIELD] = coordinates.labelY;
    row[DATA_LABEL_MAX_WIDTH_FIELD] = coordinates.maxWidth;
    row[DATA_LABEL_LINE_HEIGHT_FIELD] = coordinates.lineHeight;
    if (coordinates.leaderVisible) row[DATA_LABEL_LEADER_VISIBLE_FIELD] = true;
  }
  applyDataLabelStyle(row, label, {
    config: context.config,
    sourceSeriesIndex: context.sourceSeriesIndex,
    pointIndex: context.pointIndex,
    fallbackColor: labelText.color,
  });
}

function applyPieDoughnutLabelValueClassification(
  row: DataRow,
  context: ApplyDataLabelContext,
): void {
  if (!isPieLikeChartType(context.config?.type)) return;
  const magnitude = Math.abs(context.value);
  if (magnitude === 0) {
    row[DATA_LABEL_ZERO_VALUE_FIELD] = true;
    return;
  }
  if (
    context.percentage !== undefined &&
    Number.isFinite(context.percentage) &&
    context.percentage < 0.015
  ) {
    row[DATA_LABEL_NEAR_ZERO_VALUE_FIELD] = true;
  }
}
