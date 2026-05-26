/**
 * WorkbookSettings Schema Defaults & Utilities
 *
 * Runtime schema objects, default values, and utility functions for WorkbookSettings.
 * Moved from contracts - contracts retains only type definitions.
 *
 * @see contracts/src/store/workbook-schema.ts for type exports
 */

import type { FieldDef, Schema, WorkbookSettingsField } from '@mog-sdk/contracts/store';

// =============================================================================
// Constants (Single Source of Truth)
// =============================================================================

/**
 * Default theme ID (Office theme).
 */
export const WORKBOOK_DEFAULT_THEME_ID = 'office';

/**
 * Default culture/locale for number formatting.
 */
export const WORKBOOK_DEFAULT_CULTURE = 'en-US';

// =============================================================================
// WorkbookSettings Schema
// =============================================================================

/**
 * SINGLE SOURCE OF TRUTH for WorkbookSettings structure.
 *
 * This consolidates all workbook settings fields and their defaults.
 */
export const WORKBOOK_SETTINGS_SCHEMA = {
  // ===========================================================================
  // UI Visibility - Scrollbars
  // ===========================================================================

  showHorizontalScrollbar: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  showVerticalScrollbar: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  autoHideScrollBars: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  // ===========================================================================
  // UI Visibility - Tab Strip & Formula Bar
  // ===========================================================================

  showTabStrip: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  showFormulaBar: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Editing Behavior
  // ===========================================================================

  allowSheetReorder: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  autoFitOnDoubleClick: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  showCutCopyIndicator: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  allowDragFill: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  enterKeyDirection: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: 'down',
  } as const satisfies FieldDef,

  allowCellDragDrop: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Theme
  // ===========================================================================

  themeId: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: WORKBOOK_DEFAULT_THEME_ID,
  } as const satisfies FieldDef,

  themeFontsId: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Localization
  // ===========================================================================

  culture: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: WORKBOOK_DEFAULT_CULTURE,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Multi-Sheet Selection (Stream H)
  // ===========================================================================

  selectedSheetIds: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Workbook Protection
  // ===========================================================================

  isWorkbookProtected: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  workbookProtectionPasswordHash: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  workbookProtectionOptions: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Calculation Settings (G.3)
  // ===========================================================================

  calculationSettings: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Date System
  // ===========================================================================

  date1904: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Tables
  // ===========================================================================

  defaultTableStyleId: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  automaticConversionPolicy: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: {
      convertDateLikeText: true,
      convertTimeLikeText: true,
      convertFractionLikeText: true,
      convertScientificNotation: true,
      convertLeadingZeroNumbers: true,
      convertLongDigitNumbers: true,
      convertPercentSuffix: true,
      convertCurrencySymbol: true,
      convertFormattedNumbers: true,
    },
  } as const satisfies FieldDef,

  // ===========================================================================
  // Chart Settings (OfficeJS Workbook #44)
  // ===========================================================================

  chartDataPointTrack: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  // ===========================================================================
  // App Instances (App Data Binding)
  // ===========================================================================

  appInstances: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,
} as const satisfies Schema;

// =============================================================================
// Schema Utilities
// =============================================================================

/**
 * Get the default value for a WorkbookSettings field.
 */
export function getWorkbookSettingsDefault(field: WorkbookSettingsField): unknown {
  const def = WORKBOOK_SETTINGS_SCHEMA[field];
  return (def as { default?: unknown }).default;
}

/**
 * Get all default values for WorkbookSettings fields that have defaults.
 */
export function getWorkbookSettingsDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(WORKBOOK_SETTINGS_SCHEMA)) {
    const fieldDef = def as { default?: unknown };
    if ('default' in fieldDef && fieldDef.default !== undefined) {
      defaults[key] = fieldDef.default;
    }
  }
  return defaults;
}

/**
 * Get required WorkbookSettings fields that should be initialized.
 */
export function getRequiredWorkbookSettingsFields(): Array<{
  field: WorkbookSettingsField;
  default: unknown;
}> {
  const required: Array<{ field: WorkbookSettingsField; default: unknown }> = [];
  for (const [key, def] of Object.entries(WORKBOOK_SETTINGS_SCHEMA)) {
    const fieldDef = def as { required: boolean; default?: unknown };
    if (fieldDef.required && 'default' in fieldDef && fieldDef.default !== undefined) {
      required.push({ field: key as WorkbookSettingsField, default: fieldDef.default });
    }
  }
  return required;
}

/**
 * Get the copy strategy for a WorkbookSettings field.
 */
export function getWorkbookSettingsCopyStrategy(field: WorkbookSettingsField): FieldDef['copy'] {
  return WORKBOOK_SETTINGS_SCHEMA[field].copy;
}

/**
 * Check if a WorkbookSettings field is required on creation.
 */
export function isWorkbookSettingsFieldRequired(field: WorkbookSettingsField): boolean {
  return WORKBOOK_SETTINGS_SCHEMA[field].required;
}
