import type { AxisData, SingleAxisData } from '../../bridges/compute/compute-types.gen';

import type { AxisConfig, ManualLayout, SingleAxisConfig } from '@mog-sdk/contracts/data/charts';

import {
  chartFormatStringToWire,
  chartFormatToWire,
  chartLineFormatToWire,
  wireToChartFormat,
  wireToChartFormatString,
  wireToChartLineFormat,
} from './chart-format-converters';

export const TEXT_H_ALIGNMENTS = ['left', 'center', 'right', 'justify', 'distributed'] as const;
export type TextHAlignment = (typeof TEXT_H_ALIGNMENTS)[number];

export const TEXT_V_ALIGNMENTS = ['top', 'middle', 'bottom', 'justify', 'distributed'] as const;
export type TextVAlignment = (typeof TEXT_V_ALIGNMENTS)[number];

const SCALE_TYPES = ['linear', 'logarithmic'] as const;
type ScaleType = (typeof SCALE_TYPES)[number];

const CATEGORY_TYPES = ['automatic', 'textAxis', 'dateAxis'] as const;
type CategoryType = (typeof CATEGORY_TYPES)[number];

const CROSSES_AT = ['automatic', 'max', 'min', 'custom'] as const;
type CrossesAt = (typeof CROSSES_AT)[number];

const MANUAL_LAYOUT_TARGETS = ['inner', 'outer'] as const;
type ManualLayoutTarget = (typeof MANUAL_LAYOUT_TARGETS)[number];

const MANUAL_LAYOUT_MODES = ['edge', 'factor'] as const;
type ManualLayoutMode = (typeof MANUAL_LAYOUT_MODES)[number];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Convert a loose wire manual-layout value to the public chart contract. */
export function wireToManualLayout(layout: unknown): ManualLayout | undefined {
  if (!isRecord(layout)) return undefined;

  return {
    layoutTarget: narrowEnum<ManualLayoutTarget>(
      typeof layout.layoutTarget === 'string' ? layout.layoutTarget : undefined,
      MANUAL_LAYOUT_TARGETS,
      'ManualLayout.layoutTarget',
    ),
    xMode: narrowEnum<ManualLayoutMode>(
      typeof layout.xMode === 'string' ? layout.xMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.xMode',
    ),
    yMode: narrowEnum<ManualLayoutMode>(
      typeof layout.yMode === 'string' ? layout.yMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.yMode',
    ),
    wMode: narrowEnum<ManualLayoutMode>(
      typeof layout.wMode === 'string' ? layout.wMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.wMode',
    ),
    hMode: narrowEnum<ManualLayoutMode>(
      typeof layout.hMode === 'string' ? layout.hMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.hMode',
    ),
    x: optionalNumber(layout.x),
    y: optionalNumber(layout.y),
    w: optionalNumber(layout.w),
    h: optionalNumber(layout.h),
    extLst: typeof layout.extLst === 'string' ? layout.extLst : undefined,
  };
}

export function manualLayoutToWire(layout: ManualLayout): ManualLayout {
  return {
    layoutTarget: layout.layoutTarget,
    xMode: layout.xMode,
    yMode: layout.yMode,
    wMode: layout.wMode,
    hMode: layout.hMode,
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
    extLst: layout.extLst,
  };
}

/** Convert a wire SingleAxisData to the contract SingleAxisConfig. */
export function wireToSingleAxisConfig(w: SingleAxisData): SingleAxisConfig {
  return {
    // structural fields (no narrowing needed)
    title: w.title,
    visible: w.visible,
    visibleExplicit: w.visibleExplicit,
    min: w.min,
    max: w.max,
    axisType: w.axisType,
    gridLines: w.gridLines,
    minorGridLines: w.minorGridLines,
    majorUnit: w.majorUnit,
    minorUnit: w.minorUnit,
    tickMarks: w.tickMarks,
    minorTickMarks: w.minorTickMarks,
    numberFormat: w.numberFormat,
    reverse: w.reverse,
    position: w.position,
    logBase: w.logBase,
    displayUnit: w.displayUnit,
    format: wireToChartFormat(w.format),
    titleFormat: wireToChartFormat(w.titleFormat),
    titleRichText: w.titleRichText?.map(wireToChartFormatString),
    gridlineFormat: w.gridlineFormat ? wireToChartLineFormat(w.gridlineFormat) : undefined,
    minorGridlineFormat: w.minorGridlineFormat
      ? wireToChartLineFormat(w.minorGridlineFormat)
      : undefined,
    crossBetween: w.crossBetween,
    tickLabelPosition: w.tickLabelPosition,
    baseTimeUnit: w.baseTimeUnit,
    majorTimeUnit: w.majorTimeUnit,
    minorTimeUnit: w.minorTimeUnit,
    customDisplayUnit: w.customDisplayUnit,
    displayUnitLabel: w.displayUnitLabel,
    displayUnitLabelLayout: wireToManualLayout(w.displayUnitLabelLayout),
    displayUnitLabelFormat: wireToChartFormat(w.displayUnitLabelFormat),
    labelAlignment: w.labelAlignment,
    labelOffset: w.labelOffset,
    noMultiLevelLabels: w.noMultiLevelLabels,
    titleVisible: w.titleVisible,
    tickLabelSpacing: w.tickLabelSpacing,
    tickMarkSpacing: w.tickMarkSpacing,
    linkNumberFormat: w.linkNumberFormat,
    isBetweenCategories: w.isBetweenCategories,
    textOrientation: w.textOrientation,
    alignment: w.alignment,
    // narrowed enums - return undefined for unknown wire values
    scaleType: narrowEnum<ScaleType>(w.scaleType, SCALE_TYPES, 'SingleAxis.scaleType'),
    categoryType: narrowEnum<CategoryType>(
      w.categoryType,
      CATEGORY_TYPES,
      'SingleAxis.categoryType',
    ),
    crossesAt: narrowEnum<CrossesAt>(w.crossesAt, CROSSES_AT, 'SingleAxis.crossesAt'),
    crossesAtValue: w.crossesAtValue,
  };
}

/** Convert a wire AxisData to the contract AxisConfig. */
export function wireToAxisConfig(w: AxisData): AxisConfig {
  return {
    categoryAxis: w.categoryAxis ? wireToSingleAxisConfig(w.categoryAxis) : undefined,
    valueAxis: w.valueAxis ? wireToSingleAxisConfig(w.valueAxis) : undefined,
    secondaryCategoryAxis: w.secondaryCategoryAxis
      ? wireToSingleAxisConfig(w.secondaryCategoryAxis)
      : undefined,
    secondaryValueAxis: w.secondaryValueAxis
      ? wireToSingleAxisConfig(w.secondaryValueAxis)
      : undefined,
    seriesAxis: w.seriesAxis ? wireToSingleAxisConfig(w.seriesAxis) : undefined,
  };
}

/** Convert contract SingleAxisConfig to wire SingleAxisData. */
export function singleAxisConfigToWire(c: SingleAxisConfig): SingleAxisData {
  return {
    title: c.title,
    visible: c.visible,
    visibleExplicit: c.visibleExplicit,
    min: c.min,
    max: c.max,
    axisType: c.axisType,
    gridLines: c.gridLines,
    minorGridLines: c.minorGridLines,
    majorUnit: c.majorUnit,
    minorUnit: c.minorUnit,
    tickMarks: c.tickMarks,
    minorTickMarks: c.minorTickMarks,
    numberFormat: c.numberFormat,
    reverse: c.reverse,
    position: c.position,
    logBase: c.logBase,
    displayUnit: c.displayUnit,
    format: chartFormatToWire(c.format),
    titleFormat: chartFormatToWire(c.titleFormat),
    titleRichText: c.titleRichText?.map(chartFormatStringToWire),
    gridlineFormat: c.gridlineFormat ? chartLineFormatToWire(c.gridlineFormat) : undefined,
    minorGridlineFormat: c.minorGridlineFormat
      ? chartLineFormatToWire(c.minorGridlineFormat)
      : undefined,
    crossBetween: c.crossBetween,
    tickLabelPosition: c.tickLabelPosition,
    baseTimeUnit: c.baseTimeUnit,
    majorTimeUnit: c.majorTimeUnit,
    minorTimeUnit: c.minorTimeUnit,
    customDisplayUnit: c.customDisplayUnit,
    displayUnitLabel: c.displayUnitLabel,
    displayUnitLabelLayout: c.displayUnitLabelLayout
      ? manualLayoutToWire(c.displayUnitLabelLayout)
      : undefined,
    displayUnitLabelFormat: chartFormatToWire(c.displayUnitLabelFormat),
    labelAlignment: c.labelAlignment,
    labelOffset: c.labelOffset,
    noMultiLevelLabels: c.noMultiLevelLabels,
    titleVisible: c.titleVisible,
    tickLabelSpacing: c.tickLabelSpacing,
    tickMarkSpacing: c.tickMarkSpacing,
    linkNumberFormat: c.linkNumberFormat,
    // literal -> string: widen
    scaleType: c.scaleType,
    categoryType: c.categoryType,
    crossesAt: c.crossesAt,
    crossesAtValue: c.crossesAtValue,
    isBetweenCategories: c.isBetweenCategories,
    textOrientation: c.textOrientation,
    alignment: c.alignment,
  };
}

/** Convert contract AxisConfig to wire AxisData. */
export function axisConfigToWire(c: AxisConfig): AxisData {
  return {
    categoryAxis: c.categoryAxis ? singleAxisConfigToWire(c.categoryAxis) : undefined,
    valueAxis: c.valueAxis ? singleAxisConfigToWire(c.valueAxis) : undefined,
    secondaryCategoryAxis: c.secondaryCategoryAxis
      ? singleAxisConfigToWire(c.secondaryCategoryAxis)
      : undefined,
    secondaryValueAxis: c.secondaryValueAxis
      ? singleAxisConfigToWire(c.secondaryValueAxis)
      : undefined,
    seriesAxis: c.seriesAxis ? singleAxisConfigToWire(c.seriesAxis) : undefined,
  };
}
