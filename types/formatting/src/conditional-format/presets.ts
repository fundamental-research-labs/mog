/**
 * Conditional Formatting Presets
 *
 * Excel-like preset configurations for one-click application of
 * Data Bars, Color Scales, and Icon Sets.
 */

import type { CFColorScale, CFDataBar, CFIconSet, CFIconSetName, CFRuleType } from './rules';

// =============================================================================
// Types
// =============================================================================

/**
 * Preset category
 */
export type CFPresetCategory = 'dataBar' | 'colorScale' | 'iconSet';

/**
 * Base preset interface
 */
interface CFPresetBase {
  /** Unique preset identifier */
  id: string;
  /** Display name */
  name: string;
  /** Preset category */
  category: CFPresetCategory;
  /** Rule type for creating CF rule */
  ruleType: CFRuleType;
}

/**
 * Data Bar preset
 */
export interface CFDataBarPreset extends CFPresetBase {
  category: 'dataBar';
  ruleType: 'dataBar';
  dataBar: CFDataBar;
}

/**
 * Color Scale preset
 */
export interface CFColorScalePreset extends CFPresetBase {
  category: 'colorScale';
  ruleType: 'colorScale';
  colorScale: CFColorScale;
}

/**
 * Icon Set preset
 */
export interface CFIconSetPreset extends CFPresetBase {
  category: 'iconSet';
  ruleType: 'iconSet';
  iconSet: CFIconSet;
}

/**
 * Union of all preset types
 */
export type CFPreset = CFDataBarPreset | CFColorScalePreset | CFIconSetPreset;
