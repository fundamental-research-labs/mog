/**
 * Ribbon Collapse System - Contracts
 *
 * Type definitions and configurations for ribbon responsive collapse.
 *
 * Usage:
 * ```typescript
 * import type {
 *   CollapseLevel,
 *   GroupRenderMode,
 *   GroupCollapseConfig,
 *   RibbonCollapseState
 * } from '@mog-sdk/contracts/ribbon';
 *
 * import {
 *   CLIPBOARD_COLLAPSE_CONFIG,
 *   FONT_COLLAPSE_CONFIG
 * } from '@mog-sdk/contracts/ribbon';
 * ```
 *
 */

// =============================================================================
// Types
// =============================================================================

export type {
  CollapseLevel,
  GroupCollapseConfig,
  GroupRenderMode,
  RibbonCollapseState,
} from './collapse-types';

export type {
  RibbonVisibilityButtonKey,
  RibbonVisibilityConfig,
  RibbonVisibilityGroupKey,
  RibbonVisibilityPath,
  RibbonVisibilityProfileName,
  RibbonVisibilityRootKey,
  RibbonVisibilityTabKey,
} from './visibility-config';

export {
  APP_EVAL_RIBBON_VISIBILITY_CONFIG,
  PUBLIC_RIBBON_VISIBILITY_CONFIG,
  RIBBON_VISIBILITY_PROFILES,
  RIBBON_VISIBILITY_SCHEMA,
  getRibbonVisibilityProfile,
  isRibbonPathVisible,
  mergeRibbonVisibilityConfig,
  normalizeRibbonVisibilityKey,
} from './visibility-config';

// =============================================================================
// Collapse Configurations (Pure Data)
// =============================================================================

export {
  // New configs - Review Tab
  ACCESSIBILITY_COLLAPSE_CONFIG,
  // Home Tab
  ALIGNMENT_COLLAPSE_CONFIG,
  // Page Layout Tab - Arrange group
  ARRANGE_COLLAPSE_CONFIG,
  // Formulas Tab
  CALCULATION_COLLAPSE_CONFIG,
  CELLS_COLLAPSE_CONFIG,
  // Insert Tab
  CHARTS_COLLAPSE_CONFIG,
  CLIPBOARD_COLLAPSE_CONFIG,
  // Review Tab
  COMMENTS_COLLAPSE_CONFIG,
  COMMENTS_INSERT_COLLAPSE_CONFIG,
  // Data Tab
  DATA_TOOLS_COLLAPSE_CONFIG,
  // Default
  DEFAULT_COLLAPSE_CONFIG,
  DEFINED_NAMES_COLLAPSE_CONFIG,
  DRAW_CONVERT_COLLAPSE_CONFIG,
  DRAW_PENS_COLLAPSE_CONFIG,
  // New configs - Draw Tab
  DRAW_TOOLS_COLLAPSE_CONFIG,
  EDITING_COLLAPSE_CONFIG,
  FILTERS_COLLAPSE_CONFIG,
  FONT_COLLAPSE_CONFIG,
  FORECAST_COLLAPSE_CONFIG,
  FORMAT_OBJECT_ACTIONS_COLLAPSE_CONFIG,
  // New configs - Format Object Tab (Contextual)
  FORMAT_OBJECT_ARRANGE_COLLAPSE_CONFIG,
  FORMULA_AUDITING_COLLAPSE_CONFIG,
  FUNCTION_LIBRARY_COLLAPSE_CONFIG,
  GET_EXTERNAL_DATA_COLLAPSE_CONFIG,
  ILLUSTRATIONS_COLLAPSE_CONFIG,
  LINKS_COLLAPSE_CONFIG,
  // New configs - View Tab
  MACROS_COLLAPSE_CONFIG,
  NUMBER_COLLAPSE_CONFIG,
  OUTLINE_COLLAPSE_CONFIG,
  // Page Layout Tab
  PAGE_SETUP_COLLAPSE_CONFIG,
  PROOFING_COLLAPSE_CONFIG,
  PROTECT_COLLAPSE_CONFIG,
  QUERIES_CONNECTIONS_COLLAPSE_CONFIG,
  SCALE_TO_FIT_COLLAPSE_CONFIG,
  SETTINGS_COLLAPSE_CONFIG,
  SHEET_OPTIONS_COLLAPSE_CONFIG,
  // View Tab
  SHOW_COLLAPSE_CONFIG,
  SORT_FILTER_COLLAPSE_CONFIG,
  SPARKLINES_COLLAPSE_CONFIG,
  STYLES_COLLAPSE_CONFIG,
  TABLES_INSERT_COLLAPSE_CONFIG,
  // New configs - Table Design Tab (Contextual)
  TABLE_PROPERTIES_COLLAPSE_CONFIG,
  TABLE_STYLES_COLLAPSE_CONFIG,
  TABLE_STYLE_OPTIONS_COLLAPSE_CONFIG,
  TABLE_TOOLS_COLLAPSE_CONFIG,
  TEXT_COLLAPSE_CONFIG,
  THEMES_COLLAPSE_CONFIG,
  WINDOW_COLLAPSE_CONFIG,
  WORKBOOK_VIEWS_COLLAPSE_CONFIG,
  ZOOM_COLLAPSE_CONFIG,
} from './collapse-configs';
