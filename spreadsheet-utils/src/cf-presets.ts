/**
 * Conditional Formatting Presets
 *
 * Excel-like preset configurations for one-click application of
 * Data Bars, Color Scales, and Icon Sets.
 *
 * Types remain in @mog-sdk/contracts/conditional-format.
 */

import type {
  CFColorScalePreset,
  CFDataBarPreset,
  CFIconSetPreset,
  CFPreset,
  CFPresetCategory,
} from '@mog-sdk/contracts/conditional-format';
import type { CFIconSetName } from '@mog-sdk/contracts/conditional-format';

// =============================================================================
// Data Bar Presets
// =============================================================================

export const DATA_BAR_PRESETS: CFDataBarPreset[] = [
  // Blue variants
  {
    id: 'databar-blue-gradient',
    name: 'Blue Gradient',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#638EC6' },
      maxPoint: { type: 'max', color: '#638EC6' },
      positiveColor: '#638EC6',
      negativeColor: '#FF555A',
      gradient: true,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
  {
    id: 'databar-blue-solid',
    name: 'Blue Solid',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#638EC6' },
      maxPoint: { type: 'max', color: '#638EC6' },
      positiveColor: '#638EC6',
      negativeColor: '#FF555A',
      gradient: false,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
  // Green variants
  {
    id: 'databar-green-gradient',
    name: 'Green Gradient',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#63BE7B' },
      maxPoint: { type: 'max', color: '#63BE7B' },
      positiveColor: '#63BE7B',
      negativeColor: '#FF555A',
      gradient: true,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
  {
    id: 'databar-green-solid',
    name: 'Green Solid',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#63BE7B' },
      maxPoint: { type: 'max', color: '#63BE7B' },
      positiveColor: '#63BE7B',
      negativeColor: '#FF555A',
      gradient: false,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
  // Red variants
  {
    id: 'databar-red-gradient',
    name: 'Red Gradient',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#F8696B' },
      maxPoint: { type: 'max', color: '#F8696B' },
      positiveColor: '#F8696B',
      negativeColor: '#638EC6',
      gradient: true,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
  {
    id: 'databar-red-solid',
    name: 'Red Solid',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#F8696B' },
      maxPoint: { type: 'max', color: '#F8696B' },
      positiveColor: '#F8696B',
      negativeColor: '#638EC6',
      gradient: false,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
  // Orange variants
  {
    id: 'databar-orange-gradient',
    name: 'Orange Gradient',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#FFAB46' },
      maxPoint: { type: 'max', color: '#FFAB46' },
      positiveColor: '#FFAB46',
      negativeColor: '#FF555A',
      gradient: true,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
  {
    id: 'databar-orange-solid',
    name: 'Orange Solid',
    category: 'dataBar',
    ruleType: 'dataBar',
    dataBar: {
      minPoint: { type: 'min', color: '#FFAB46' },
      maxPoint: { type: 'max', color: '#FFAB46' },
      positiveColor: '#FFAB46',
      negativeColor: '#FF555A',
      gradient: false,
      showValue: true,
      axisPosition: 'automatic',
    },
  },
];

// =============================================================================
// Color Scale Presets
// =============================================================================

export const COLOR_SCALE_PRESETS: CFColorScalePreset[] = [
  // 3-color scales
  {
    id: 'colorscale-red-yellow-green',
    name: 'Red - Yellow - Green',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#F8696B' },
      midPoint: { type: 'percentile', value: 50, color: '#FFEB84' },
      maxPoint: { type: 'max', color: '#63BE7B' },
    },
  },
  {
    id: 'colorscale-green-yellow-red',
    name: 'Green - Yellow - Red',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#63BE7B' },
      midPoint: { type: 'percentile', value: 50, color: '#FFEB84' },
      maxPoint: { type: 'max', color: '#F8696B' },
    },
  },
  {
    id: 'colorscale-green-white-red',
    name: 'Green - White - Red',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#63BE7B' },
      midPoint: { type: 'percentile', value: 50, color: '#FFFFFF' },
      maxPoint: { type: 'max', color: '#F8696B' },
    },
  },
  {
    id: 'colorscale-red-white-green',
    name: 'Red - White - Green',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#F8696B' },
      midPoint: { type: 'percentile', value: 50, color: '#FFFFFF' },
      maxPoint: { type: 'max', color: '#63BE7B' },
    },
  },
  {
    id: 'colorscale-blue-white-red',
    name: 'Blue - White - Red',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#5A8AC6' },
      midPoint: { type: 'percentile', value: 50, color: '#FFFFFF' },
      maxPoint: { type: 'max', color: '#F8696B' },
    },
  },
  {
    id: 'colorscale-red-white-blue',
    name: 'Red - White - Blue',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#F8696B' },
      midPoint: { type: 'percentile', value: 50, color: '#FFFFFF' },
      maxPoint: { type: 'max', color: '#5A8AC6' },
    },
  },
  // 2-color scales
  {
    id: 'colorscale-white-blue',
    name: 'White - Blue',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#FFFFFF' },
      maxPoint: { type: 'max', color: '#5A8AC6' },
    },
  },
  {
    id: 'colorscale-white-red',
    name: 'White - Red',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#FFFFFF' },
      maxPoint: { type: 'max', color: '#F8696B' },
    },
  },
  {
    id: 'colorscale-white-green',
    name: 'White - Green',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#FFFFFF' },
      maxPoint: { type: 'max', color: '#63BE7B' },
    },
  },
  {
    id: 'colorscale-yellow-green',
    name: 'Yellow - Green',
    category: 'colorScale',
    ruleType: 'colorScale',
    colorScale: {
      minPoint: { type: 'min', color: '#FFEB84' },
      maxPoint: { type: 'max', color: '#63BE7B' },
    },
  },
];

// =============================================================================
// Icon Set Presets
// =============================================================================

/**
 * Create a standard icon set preset with default thresholds
 */
function createIconSetPreset(iconSetName: CFIconSetName, displayName: string): CFIconSetPreset {
  return {
    id: `iconset-${iconSetName.toLowerCase()}`,
    name: displayName,
    category: 'iconSet',
    ruleType: 'iconSet',
    iconSet: {
      iconSetName,
      reverseOrder: false,
      showIconOnly: false,
    },
  };
}

export const ICON_SET_PRESETS: CFIconSetPreset[] = [
  // 3-icon sets
  createIconSetPreset('3Arrows', '3 Arrows (Colored)'),
  createIconSetPreset('3ArrowsGray', '3 Arrows (Gray)'),
  createIconSetPreset('3TrafficLights1', '3 Traffic Lights'),
  createIconSetPreset('3TrafficLights2', '3 Traffic Lights (Rimmed)'),
  createIconSetPreset('3Signs', '3 Signs'),
  createIconSetPreset('3Symbols', '3 Symbols (Circled)'),
  createIconSetPreset('3Symbols2', '3 Symbols (Uncircled)'),
  createIconSetPreset('3Flags', '3 Flags'),
  createIconSetPreset('3Stars', '3 Stars'),
  createIconSetPreset('3Triangles', '3 Triangles'),
  // 4-icon sets
  createIconSetPreset('4Arrows', '4 Arrows (Colored)'),
  createIconSetPreset('4ArrowsGray', '4 Arrows (Gray)'),
  createIconSetPreset('4Rating', '4 Rating'),
  createIconSetPreset('4RedToBlack', '4 Red to Black'),
  createIconSetPreset('4TrafficLights', '4 Traffic Lights'),
  // 5-icon sets
  createIconSetPreset('5Arrows', '5 Arrows (Colored)'),
  createIconSetPreset('5ArrowsGray', '5 Arrows (Gray)'),
  createIconSetPreset('5Rating', '5 Rating'),
  createIconSetPreset('5Quarters', '5 Quarters'),
  createIconSetPreset('5Boxes', '5 Boxes'),
];

// =============================================================================
// All Presets Combined
// =============================================================================

export const ALL_CF_PRESETS: CFPreset[] = [
  ...DATA_BAR_PRESETS,
  ...COLOR_SCALE_PRESETS,
  ...ICON_SET_PRESETS,
];

// =============================================================================
// Preset Lookup
// =============================================================================

/**
 * Get a preset by ID
 */
export function getPresetById(id: string): CFPreset | undefined {
  return ALL_CF_PRESETS.find((p) => p.id === id);
}

/**
 * Get presets by category
 */
export function getPresetsByCategory(category: CFPresetCategory): CFPreset[] {
  return ALL_CF_PRESETS.filter((p) => p.category === category);
}
