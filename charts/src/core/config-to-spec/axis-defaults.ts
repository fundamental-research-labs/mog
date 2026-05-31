import type { AxisSpec } from '../../grammar/spec';
import { pointsToCanvasPx } from './units';

export const EXCEL_AXIS_LABEL_FONT_SIZE_PT = 9;
export const EXCEL_AXIS_TITLE_FONT_SIZE_PT = 10;

export const EXCEL_AXIS_LABEL_FONT_SIZE_PX = pointsToCanvasPx(EXCEL_AXIS_LABEL_FONT_SIZE_PT) ?? 18;
export const EXCEL_AXIS_TITLE_FONT_SIZE_PX = pointsToCanvasPx(EXCEL_AXIS_TITLE_FONT_SIZE_PT) ?? 20;

export function applyAxisTextDefaults(spec: AxisSpec): void {
  if (spec.labels !== false && spec.labelPosition !== 'none' && spec.labelFontSize === undefined) {
    spec.labelFontSize = EXCEL_AXIS_LABEL_FONT_SIZE_PX;
  }
  if (spec.title !== null && spec.titleFontSize === undefined) {
    spec.titleFontSize = EXCEL_AXIS_TITLE_FONT_SIZE_PX;
  }
}
