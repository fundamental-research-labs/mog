import type { AxisSpec } from '../../grammar/spec';
import type { ChartFormat, SingleAxisConfig } from '../../types';
import {
  resolveChartTextColor,
  resolveGridlineColor,
  type ResolveChartColorOptions,
} from '../../utils/chart-colors';
import { dashStyleToStrokeDash, hasVisibleLineStyle } from './style';
import { linePointsToCanvasPx, pointsToCanvasPx } from './units';

export function applyAxisLabelStyle(
  spec: AxisSpec,
  axisFormat: ChartFormat | undefined,
  context: ResolveChartColorOptions,
): void {
  const labelFont = axisFormat?.font;
  if (labelFont?.size !== undefined) spec.labelFontSize = pointsToCanvasPx(labelFont.size);
  if (labelFont?.name) spec.labelFontFamily = labelFont.name;
  const labelColor = resolveChartTextColor(labelFont?.color, context);
  if (labelColor) spec.labelColor = labelColor;
}

export function applyAxisLineStyle(
  spec: AxisSpec,
  axisFormat: ChartFormat | undefined,
  context: ResolveChartColorOptions,
): void {
  const axisLine = axisFormat?.line;
  if (axisLine && !hasVisibleLineStyle(axisLine)) {
    spec.domain = false;
    spec.ticks = false;
  }
  const axisLineColor = resolveChartTextColor(axisLine?.color, context);
  if (axisLineColor) {
    spec.domainColor = axisLineColor;
    spec.tickColor = axisLineColor;
  }
  if (axisLine?.width !== undefined) {
    const lineWidth = linePointsToCanvasPx(axisLine.width);
    spec.domainWidth = lineWidth;
    spec.tickWidth = lineWidth;
  }
  const axisLineDash = dashStyleToStrokeDash(
    axisLine?.dashStyle,
    linePointsToCanvasPx(axisLine?.width),
  );
  if (axisLineDash) {
    spec.domainDash = axisLineDash;
    spec.tickDash = axisLineDash;
  }
  if (axisLine) {
    const opacity =
      axisLine.transparency === undefined ? 1 : Math.max(0, Math.min(1, 1 - axisLine.transparency));
    spec.domainOpacity = opacity;
    spec.tickOpacity = opacity;
  }
}

export function applyAxisGridlineStyle(
  spec: AxisSpec,
  axisConf: SingleAxisConfig,
  context: ResolveChartColorOptions,
): void {
  if (axisConf.gridlineFormat?.noFill === true) spec.grid = false;
  const gridlineColor = resolveGridlineColor(axisConf.gridlineFormat?.color, context);
  if (gridlineColor) spec.gridColor = gridlineColor;
  if (axisConf.gridlineFormat?.width !== undefined) {
    spec.gridWidth = linePointsToCanvasPx(axisConf.gridlineFormat.width);
  }
  const gridDash = dashStyleToStrokeDash(
    axisConf.gridlineFormat?.dashStyle,
    linePointsToCanvasPx(axisConf.gridlineFormat?.width),
  );
  if (gridDash) spec.gridDash = gridDash;
  if (axisConf.gridlineFormat) {
    spec.gridOpacity =
      axisConf.gridlineFormat.transparency === undefined
        ? 1
        : Math.max(0, Math.min(1, 1 - axisConf.gridlineFormat.transparency));
  }
  if (axisConf.minorGridlineFormat?.noFill === true) spec.minorGrid = false;
  const minorGridlineColor = resolveGridlineColor(axisConf.minorGridlineFormat?.color, context);
  if (minorGridlineColor) spec.minorGridColor = minorGridlineColor;
  if (axisConf.minorGridlineFormat?.width !== undefined) {
    spec.minorGridWidth = linePointsToCanvasPx(axisConf.minorGridlineFormat.width);
  }
  const minorGridDash = dashStyleToStrokeDash(
    axisConf.minorGridlineFormat?.dashStyle,
    linePointsToCanvasPx(axisConf.minorGridlineFormat?.width),
  );
  if (minorGridDash) spec.minorGridDash = minorGridDash;
  if (axisConf.minorGridlineFormat) {
    spec.minorGridOpacity =
      axisConf.minorGridlineFormat.transparency === undefined
        ? 1
        : Math.max(0, Math.min(1, 1 - axisConf.minorGridlineFormat.transparency));
  }
}

export function applyAxisTitleStyle(
  spec: AxisSpec,
  axisConf: SingleAxisConfig,
  context: ResolveChartColorOptions,
): void {
  const titleFont = axisConf.titleFormat?.font;
  if (titleFont?.size !== undefined) spec.titleFontSize = pointsToCanvasPx(titleFont.size);
  if (titleFont?.name) spec.titleFontFamily = titleFont.name;
  const titleColor = resolveChartTextColor(titleFont?.color, context);
  if (titleColor) spec.titleColor = titleColor;
}
