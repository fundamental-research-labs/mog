/**
 * Conditional Formatting Types
 *
 * Excel-compatible conditional formatting rules for dynamic cell styling.
 * These are the PUBLIC API types — used by all consumers (app, headless, agents).
 *
 * The kernel uses these types internally and adds implementation-specific fields
 * (CellIdRange for CRDT safety) that are NOT part of the public API.
 */

import type { CFIconSetName, CFStyle } from '../conditional-format/render-types';
import type { CellRange } from '@mog/types-core/core';

// Re-export render types so consumers get everything from one import
export type {
  CFBorderStyle,
  CFIconSetName,
  CFResult,
  CFStyle,
} from '../conditional-format/render-types';

// =============================================================================
// Rule Type Enums
// =============================================================================

/** Conditional formatting rule types (Excel-compatible). */
export type CFRuleType =
  | 'cellValue'
  | 'formula'
  | 'colorScale'
  | 'dataBar'
  | 'iconSet'
  | 'top10'
  | 'aboveAverage'
  | 'duplicateValues'
  | 'containsText'
  | 'containsBlanks'
  | 'containsErrors'
  | 'timePeriod';

/** Comparison operators for cellValue rules. */
export type CFOperator =
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'equal'
  | 'notEqual'
  | 'between'
  | 'notBetween';

/** Text operators for containsText rules. */
export type CFTextOperator = 'contains' | 'notContains' | 'beginsWith' | 'endsWith';

/** Date periods for timePeriod rules. */
export type DatePeriod =
  | 'yesterday'
  | 'today'
  | 'tomorrow'
  | 'last7Days'
  | 'lastWeek'
  | 'thisWeek'
  | 'nextWeek'
  | 'lastMonth'
  | 'thisMonth'
  | 'nextMonth'
  | 'lastQuarter'
  | 'thisQuarter'
  | 'nextQuarter'
  | 'lastYear'
  | 'thisYear'
  | 'nextYear';

// =============================================================================
// Value Types (for color scale / data bar / icon set thresholds)
// =============================================================================

/** How to determine the value for a threshold point. */
export type CFValueType = 'min' | 'max' | 'percent' | 'percentile' | 'number' | 'formula';

/** A single point in a color scale or data bar. */
export interface CFColorPoint {
  type: CFValueType;
  value?: number | string;
  color: string;
  /** Theme color index (OOXML theme reference). */
  colorTheme?: number;
  /** Tint applied to the theme color (-1.0 to 1.0). */
  colorTint?: number;
  /** Indexed color reference (legacy palette). */
  colorIndexed?: number;
  /** Automatic color flag. */
  colorAuto?: boolean;
  /** OOXML threshold extension payload. */
  extLstXml?: string;
}

/** Color scale configuration. */
export interface CFColorScale {
  /** Ordered OOXML color-scale stops; authoritative when present. */
  points?: CFColorPoint[];
  minPoint: CFColorPoint;
  midPoint?: CFColorPoint;
  maxPoint: CFColorPoint;
}

/** Axis position for data bars with negative values. */
export type CFDataBarAxisPosition = 'automatic' | 'midpoint' | 'none';

/** Data bar configuration. */
export interface CFDataBar {
  minPoint: CFColorPoint;
  maxPoint: CFColorPoint;
  positiveColor: string;
  negativeColor?: string;
  borderColor?: string;
  negativeBorderColor?: string;
  showBorder?: boolean;
  gradient?: boolean;
  direction?: 'leftToRight' | 'rightToLeft' | 'context';
  axisPosition?: CFDataBarAxisPosition;
  axisColor?: string;
  showValue?: boolean;
  /** When true, negative bars use the positive fill color. */
  matchPositiveFillColor?: boolean;
  /** When true, negative bars use the positive border color. */
  matchPositiveBorderColor?: boolean;
  /** Extension identifier for OOXML ext data bars. */
  extId?: string;
}

/** Threshold for icon selection. */
export interface CFIconThreshold {
  type: CFValueType;
  value?: number | string;
  /** When true the threshold comparison is >=, when false it is >. */
  gte: boolean;
  /** OOXML threshold extension payload. */
  extLstXml?: string;
  /** Custom icon override — use an icon from a different set for this threshold. */
  customIcon?: { iconSet: CFIconSetName; iconIndex: number };
}

/** Custom icon override for a single threshold in an icon set. */
export interface CFCustomIcon {
  iconSet: CFIconSetName;
  iconId: number;
}

/** Icon set configuration. */
export interface CFIconSet {
  iconSetName: CFIconSetName;
  thresholds?: CFIconThreshold[];
  reverseOrder?: boolean;
  showIconOnly?: boolean;
  /** Explicit OOXML iconSet percent attribute. */
  percent?: boolean;
  /** Per-threshold custom icon overrides (null entries use default icons). */
  customIcons?: (CFCustomIcon | null)[];
}

// =============================================================================
// Rule Definitions
// =============================================================================

/** Base properties shared by all CF rules. */
export interface CFRuleBase {
  id: string;
  type: CFRuleType;
  priority: number;
  stopIfTrue?: boolean;
}

/** Cell value comparison rule. */
export interface CFCellValueRule extends CFRuleBase {
  type: 'cellValue';
  operator: CFOperator;
  value1: number | string;
  value2?: number | string;
  style: CFStyle;
}

/** Formula-based rule. */
export interface CFFormulaRule extends CFRuleBase {
  type: 'formula';
  formula: string;
  style: CFStyle;
}

/** Color scale rule. */
export interface CFColorScaleRule extends CFRuleBase {
  type: 'colorScale';
  colorScale: CFColorScale;
}

/** Data bar rule. */
export interface CFDataBarRule extends CFRuleBase {
  type: 'dataBar';
  dataBar: CFDataBar;
}

/** Icon set rule. */
export interface CFIconSetRule extends CFRuleBase {
  type: 'iconSet';
  iconSet: CFIconSet;
}

/** Top/bottom N rule. */
export interface CFTop10Rule extends CFRuleBase {
  type: 'top10';
  rank: number;
  percent?: boolean;
  bottom?: boolean;
  style: CFStyle;
}

/** Above/below average rule. */
export interface CFAboveAverageRule extends CFRuleBase {
  type: 'aboveAverage';
  aboveAverage: boolean;
  equalAverage?: boolean;
  stdDev?: number;
  style: CFStyle;
}

/** Duplicate/unique values rule. */
export interface CFDuplicateValuesRule extends CFRuleBase {
  type: 'duplicateValues';
  unique?: boolean;
  style: CFStyle;
}

/** Contains text rule. */
export interface CFContainsTextRule extends CFRuleBase {
  type: 'containsText';
  operator: CFTextOperator;
  text: string;
  style: CFStyle;
}

/** Contains blanks rule. */
export interface CFContainsBlanksRule extends CFRuleBase {
  type: 'containsBlanks';
  blanks: boolean;
  style: CFStyle;
}

/** Contains errors rule. */
export interface CFContainsErrorsRule extends CFRuleBase {
  type: 'containsErrors';
  errors: boolean;
  style: CFStyle;
}

/** Time period (date occurring) rule. */
export interface CFTimePeriodRule extends CFRuleBase {
  type: 'timePeriod';
  timePeriod: DatePeriod;
  style: CFStyle;
}

/** Union of all rule types. */
export type CFRule =
  | CFCellValueRule
  | CFFormulaRule
  | CFColorScaleRule
  | CFDataBarRule
  | CFIconSetRule
  | CFTop10Rule
  | CFAboveAverageRule
  | CFDuplicateValuesRule
  | CFContainsTextRule
  | CFContainsBlanksRule
  | CFContainsErrorsRule
  | CFTimePeriodRule;

/**
 * Rule input for creating new rules (id and priority assigned by the API).
 * Callers provide the rule configuration; the API generates id and sets priority.
 */
export type CFRuleInput = Omit<CFRule, 'id' | 'priority'>;

// =============================================================================
// Conditional Format (Container)
// =============================================================================

/**
 * A conditional format definition — associates rules with cell ranges.
 *
 * This is the public API type. The kernel stores additional internal fields
 * (CellIdRange for CRDT-safe structure change handling) that are resolved
 * to position-based ranges before being returned through the API.
 */
export interface ConditionalFormat {
  /** Unique format identifier. */
  id: string;
  /** Sheet this format belongs to. */
  sheetId?: string;
  /** Whether this CF was created from a pivot table. */
  pivot?: boolean;
  /** Cell ranges this format applies to. */
  ranges: CellRange[];
  /** CellId-based range identities for CRDT-safe tracking. */
  rangeIdentities?: { topLeftCellId: string; bottomRightCellId: string }[];
  /** Rules to evaluate (sorted by priority). */
  rules: CFRule[];
}

// =============================================================================
// Icon Set Metadata
// =============================================================================

/** Metadata for an icon set. */
export interface IconSetMetadata {
  name: CFIconSetName;
  iconCount: 3 | 4 | 5;
  /** Default thresholds as percentages */
  defaultThresholds: number[];
}

/** Registry of all available icon sets with default thresholds. */
export const ICON_SET_REGISTRY: Record<CFIconSetName, IconSetMetadata> = {
  // 3-icon sets (default thresholds: 0%, 33%, 67%)
  '3Arrows': { name: '3Arrows', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3ArrowsGray': { name: '3ArrowsGray', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3Flags': { name: '3Flags', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3TrafficLights1': { name: '3TrafficLights1', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3TrafficLights2': { name: '3TrafficLights2', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3Signs': { name: '3Signs', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3Symbols': { name: '3Symbols', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3Symbols2': { name: '3Symbols2', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3Stars': { name: '3Stars', iconCount: 3, defaultThresholds: [0, 33, 67] },
  '3Triangles': { name: '3Triangles', iconCount: 3, defaultThresholds: [0, 33, 67] },
  // 4-icon sets (default thresholds: 0%, 25%, 50%, 75%)
  '4Arrows': { name: '4Arrows', iconCount: 4, defaultThresholds: [0, 25, 50, 75] },
  '4ArrowsGray': { name: '4ArrowsGray', iconCount: 4, defaultThresholds: [0, 25, 50, 75] },
  '4Rating': { name: '4Rating', iconCount: 4, defaultThresholds: [0, 25, 50, 75] },
  '4RedToBlack': { name: '4RedToBlack', iconCount: 4, defaultThresholds: [0, 25, 50, 75] },
  '4TrafficLights': { name: '4TrafficLights', iconCount: 4, defaultThresholds: [0, 25, 50, 75] },
  // 5-icon sets (default thresholds: 0%, 20%, 40%, 60%, 80%)
  '5Arrows': { name: '5Arrows', iconCount: 5, defaultThresholds: [0, 20, 40, 60, 80] },
  '5ArrowsGray': { name: '5ArrowsGray', iconCount: 5, defaultThresholds: [0, 20, 40, 60, 80] },
  '5Rating': { name: '5Rating', iconCount: 5, defaultThresholds: [0, 20, 40, 60, 80] },
  '5Quarters': { name: '5Quarters', iconCount: 5, defaultThresholds: [0, 20, 40, 60, 80] },
  '5Boxes': { name: '5Boxes', iconCount: 5, defaultThresholds: [0, 20, 40, 60, 80] },
};
