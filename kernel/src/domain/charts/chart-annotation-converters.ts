import type {
  DataLabelData,
  ErrorBarData,
  PointFormatData,
  TrendlineData,
} from '../../bridges/compute/compute-types.gen';

import type {
  DataLabelConfig,
  ErrorBarConfig,
  MarkerStyle,
  PointFormat,
  TrendlineConfig,
} from '@mog-sdk/contracts/data/charts';

import {
  chartColorToWire,
  chartFormatStringToWire,
  chartFormatToWire,
  chartLineFormatToWire,
  leaderLinesFormatToWire,
  wireToChartColor,
  wireToChartFormat,
  wireToChartFormatString,
  wireToChartLineFormat,
  wireToLeaderLinesFormat,
} from './chart-format-converters';

import {
  manualLayoutToWire,
  TEXT_H_ALIGNMENTS,
  TEXT_V_ALIGNMENTS,
  type TextHAlignment,
  type TextVAlignment,
  wireToManualLayout,
} from './chart-axis-converters';

const DATA_LABEL_POSITIONS = [
  'center',
  'insideEnd',
  'insideBase',
  'outsideEnd',
  'left',
  'right',
  'top',
  'bottom',
  'bestFit',
  'callout',
  'outside',
  'inside',
] as const;
type DataLabelPosition = (typeof DATA_LABEL_POSITIONS)[number];

const MARKER_STYLES = [
  'circle',
  'dash',
  'diamond',
  'dot',
  'none',
  'picture',
  'plus',
  'square',
  'star',
  'triangle',
  'x',
  'auto',
] as const;

function narrowEnum<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  if (value == null) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[chart-type-converters] dropping unknown ${fieldName}="${value}" - not in allowed set`,
    );
  }
  return undefined;
}

/** Convert a wire DataLabelData to the contract DataLabelConfig. */
export function wireToDataLabelConfig(w: DataLabelData): DataLabelConfig {
  return {
    show: w.show,
    delete: w.delete,
    position: narrowEnum<DataLabelPosition>(w.position, DATA_LABEL_POSITIONS, 'DataLabel.position'),
    format: w.format,
    showValue: w.showValue,
    showCategoryName: w.showCategoryName,
    showSeriesName: w.showSeriesName,
    showPercentage: w.showPercentage,
    showBubbleSize: w.showBubbleSize,
    showLegendKey: w.showLegendKey,
    separator: w.separator,
    showLeaderLines: w.showLeaderLines,
    text: w.text,
    visualFormat: wireToChartFormat(w.visualFormat),
    numberFormat: w.numberFormat,
    textOrientation: w.textOrientation,
    richText: w.richText?.map(wireToChartFormatString),
    autoText: w.autoText,
    horizontalAlignment: narrowEnum<TextHAlignment>(
      w.horizontalAlignment,
      TEXT_H_ALIGNMENTS,
      'DataLabel.horizontalAlignment',
    ),
    verticalAlignment: narrowEnum<TextVAlignment>(
      w.verticalAlignment,
      TEXT_V_ALIGNMENTS,
      'DataLabel.verticalAlignment',
    ),
    linkNumberFormat: w.linkNumberFormat,
    geometricShapeType: w.geometricShapeType,
    formula: w.formula,
    height: w.height,
    width: w.width,
    leaderLinesFormat: w.leaderLinesFormat
      ? wireToLeaderLinesFormat(w.leaderLinesFormat)
      : undefined,
    layout: wireToManualLayout(w.layout),
  };
}

/** Convert contract DataLabelConfig to wire DataLabelData. */
export function dataLabelConfigToWire(c: DataLabelConfig): DataLabelData {
  return {
    show: c.show ?? false,
    delete: c.delete,
    position: c.position,
    format: c.format,
    showValue: c.showValue,
    showCategoryName: c.showCategoryName,
    showSeriesName: c.showSeriesName,
    showPercentage: c.showPercentage,
    showBubbleSize: c.showBubbleSize,
    showLegendKey: c.showLegendKey,
    separator: c.separator,
    showLeaderLines: c.showLeaderLines,
    text: c.text,
    visualFormat: chartFormatToWire(c.visualFormat),
    numberFormat: c.numberFormat,
    textOrientation: c.textOrientation,
    richText: c.richText?.map(chartFormatStringToWire),
    autoText: c.autoText,
    horizontalAlignment: c.horizontalAlignment,
    verticalAlignment: c.verticalAlignment,
    linkNumberFormat: c.linkNumberFormat,
    geometricShapeType: c.geometricShapeType,
    formula: c.formula,
    height: c.height,
    width: c.width,
    leaderLinesFormat: c.leaderLinesFormat
      ? leaderLinesFormatToWire(c.leaderLinesFormat)
      : undefined,
    layout: c.layout ? manualLayoutToWire(c.layout) : undefined,
  };
}

/** Convert a wire TrendlineData to the contract TrendlineConfig. */
export function wireToTrendlineConfig(w: TrendlineData): TrendlineConfig {
  return {
    show: w.show,
    type: w.type,
    color: w.color,
    lineWidth: w.lineWidth,
    order: w.order,
    period: w.period,
    forward: w.forward,
    backward: w.backward,
    intercept: w.intercept,
    displayEquation: w.displayEquation,
    displayRSquared: w.displayRSquared,
    name: w.name,
    lineFormat: w.lineFormat ? wireToChartLineFormat(w.lineFormat) : undefined,
    label: w.label
      ? {
          text: w.label.text,
          format: wireToChartFormat(w.label.format),
          numberFormat: w.label.numberFormat,
          layout: wireToManualLayout(w.label.layout),
        }
      : undefined,
  };
}

export function wireToTrendlineConfigArray(
  trendlines: TrendlineData[] | undefined,
): TrendlineConfig[] | undefined {
  return trendlines?.map(wireToTrendlineConfig);
}

export function trendlineConfigToWire(c: TrendlineConfig): TrendlineData {
  return {
    show: c.show,
    type: c.type,
    color: c.color,
    lineWidth: c.lineWidth,
    order: c.order,
    period: c.period,
    forward: c.forward,
    backward: c.backward,
    intercept: c.intercept,
    displayEquation: c.displayEquation,
    displayRSquared: c.displayRSquared,
    name: c.name,
    lineFormat: c.lineFormat ? chartLineFormatToWire(c.lineFormat) : undefined,
    label: c.label
      ? {
          text: c.label.text,
          format: chartFormatToWire(c.label.format),
          numberFormat: c.label.numberFormat,
          layout: c.label.layout ? manualLayoutToWire(c.label.layout) : undefined,
        }
      : undefined,
  };
}

export function trendlineConfigArrayToWire(
  trendlines: TrendlineConfig[] | undefined,
): TrendlineData[] | undefined {
  return trendlines?.map(trendlineConfigToWire);
}

/** Convert a wire PointFormatData to the contract PointFormat. */
export function wireToPointFormat(w: PointFormatData): PointFormat {
  return {
    idx: w.idx,
    invertIfNegative: w.invertIfNegative,
    explosion: w.explosion,
    bubble3d: w.bubble3d,
    bubble3D: w.bubble3d,
    fill: w.fill,
    border: w.border,
    lineFormat: w.lineFormat ? wireToChartLineFormat(w.lineFormat) : undefined,
    dataLabel: w.dataLabel ? wireToDataLabelConfig(w.dataLabel) : undefined,
    visualFormat: wireToChartFormat(w.visualFormat),
    markerBackgroundColor: wireToChartColor(w.markerBackgroundColor),
    markerForegroundColor: wireToChartColor(w.markerForegroundColor),
    markerSize: w.markerSize,
    markerStyle: narrowEnum<MarkerStyle>(w.markerStyle, MARKER_STYLES, 'Point.markerStyle'),
  };
}

/** Convert contract PointFormat to wire PointFormatData. */
export function pointFormatToWire(c: PointFormat): PointFormatData {
  return {
    idx: c.idx,
    invertIfNegative: c.invertIfNegative,
    explosion: c.explosion,
    bubble3d: c.bubble3d ?? c.bubble3D,
    fill: c.fill,
    border: c.border,
    lineFormat: c.lineFormat ? chartLineFormatToWire(c.lineFormat) : undefined,
    dataLabel: c.dataLabel ? dataLabelConfigToWire(c.dataLabel) : undefined,
    visualFormat: chartFormatToWire(c.visualFormat),
    markerBackgroundColor: chartColorToWire(c.markerBackgroundColor),
    markerForegroundColor: chartColorToWire(c.markerForegroundColor),
    markerSize: c.markerSize,
    markerStyle: c.markerStyle,
  };
}

export function wireToErrorBarConfig(w: ErrorBarData): ErrorBarConfig {
  return {
    visible: w.visible,
    direction: w.direction,
    barType: w.barType,
    valueType: w.valueType,
    value: w.value,
    noEndCap: w.noEndCap,
    lineFormat: w.lineFormat ? wireToChartLineFormat(w.lineFormat) : undefined,
    plusSource: w.plusSource,
    minusSource: w.minusSource,
  };
}

export function errorBarConfigToWire(c: ErrorBarConfig): ErrorBarConfig {
  return {
    visible: c.visible,
    direction: c.direction,
    barType: c.barType,
    valueType: c.valueType,
    value: c.value,
    noEndCap: c.noEndCap,
    lineFormat: c.lineFormat ? chartLineFormatToWire(c.lineFormat) : undefined,
    plusSource: c.plusSource,
    minusSource: c.minusSource,
  };
}
