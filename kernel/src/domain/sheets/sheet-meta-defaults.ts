/**
 * SheetMeta Schema Defaults & Utilities
 *
 * Runtime schema objects, default values, and utility functions for SheetMeta.
 * Moved from contracts - contracts retains only type definitions.
 *
 * @see contracts/src/store/sheet-meta-schema.ts for type exports
 */

import type { FieldDef, Schema, SheetMetaField } from '@mog-sdk/contracts/store';
import { DEFAULT_COL_WIDTH as _PLATFORM_COL_WIDTH } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Constants (Single Source of Truth)
// =============================================================================

/**
 * Default row height in pixels.
 * Same as DEFAULT_ROW_HEIGHT in rendering/constants.ts.
 */
export const SHEET_META_DEFAULT_ROW_HEIGHT = 20;

/**
 * Default column width in pixels (platform-dependent).
 *
 * macOS: 72 px — Core Text renders Calibri 11pt with max-digit-width ≈ 8 px.
 * Windows/Linux: 64 px — GDI renders Calibri 11pt with max-digit-width ≈ 7 px.
 *
 * Matches the Rust `compute_layout_index::platform_default_col_width()`.
 */
export const SHEET_META_DEFAULT_COL_WIDTH = _PLATFORM_COL_WIDTH;

/**
 * Default gridline color.
 */
export const SHEET_META_DEFAULT_GRIDLINE_COLOR = '#e2e2e2';

// =============================================================================
// SheetMeta Schema
// =============================================================================

/**
 * SINGLE SOURCE OF TRUTH for SheetMeta structure.
 *
 * This consolidates all sheet metadata fields and their defaults.
 * DEFAULT_SHEET_SETTINGS should be DERIVED from this schema.
 *
 * Field Categories:
 * - Core Identity: id, name (required, skip on copy)
 * - Dimensions: defaultRowHeight, defaultColWidth
 * - Freeze Panes: frozenRows, frozenCols
 * - Tab Appearance: tabColor, hidden
 * - View Options: showGridlines, showRowHeaders, showColumnHeaders
 * - Protection: isProtected, protectionPasswordHash, protectionOptions
 * - Display: showZeroValues, gridlineColor, rightToLeft
 * - Print & Page Setup: rowPageBreaks, colPageBreaks, printArea, printTitles, printSettings
 */
export const SHEET_META_SCHEMA = {
  // ===========================================================================
  // Core Identity (no defaults - must be provided)
  // ===========================================================================

  id: {
    type: 'primitive',
    required: true,
    copy: 'skip', // New ID generated on copy
    lazyInit: false,
  } as const satisfies FieldDef,

  name: {
    type: 'primitive',
    required: true,
    copy: 'skip', // New name generated on copy
    lazyInit: false,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Dimensions
  // ===========================================================================

  defaultRowHeight: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: SHEET_META_DEFAULT_ROW_HEIGHT,
  } as const satisfies FieldDef,

  defaultColWidth: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: SHEET_META_DEFAULT_COL_WIDTH,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Freeze Panes
  // ===========================================================================

  frozenRows: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: 0,
  } as const satisfies FieldDef,

  frozenCols: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: 0,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Tab Appearance
  // ===========================================================================

  tabColor: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: null,
  } as const satisfies FieldDef,

  hidden: {
    type: 'primitive',
    required: true,
    copy: 'skip', // Copied sheets always visible
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  // ===========================================================================
  // View Options (Stream F: Freeze Panes & View Options)
  // ===========================================================================

  showGridlines: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  showRowHeaders: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  showColumnHeaders: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Protection (Stream L: Settings & Toggles)
  // ===========================================================================

  isProtected: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  protectionPasswordHash: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  /**
   * Protection options (what operations are allowed when protected).
   * Stored as plain object (JSON-serializable).
   * Uses DEFAULT_PROTECTION_OPTIONS when undefined.
   */
  protectionOptions: {
    type: 'primitive', // Object stored as primitive (JSON-serializable)
    required: false,
    copy: 'deep', // Deep copy to avoid shared mutation
    lazyInit: false,
    default: undefined, // Uses DEFAULT_PROTECTION_OPTIONS from protection.ts when needed
  } as const satisfies FieldDef,

  // ===========================================================================
  // Display
  // ===========================================================================

  showZeroValues: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  gridlineColor: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: SHEET_META_DEFAULT_GRIDLINE_COLOR,
  } as const satisfies FieldDef,

  rightToLeft: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Formula Display & Zoom
  // ===========================================================================

  showFormulas: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,

  zoomScale: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
    default: undefined,
  } as const satisfies FieldDef,

  // ===========================================================================
  // Print & Page Setup
  // ===========================================================================

  rowPageBreaks: {
    type: 'primitive', // Array stored as primitive
    required: true,
    copy: 'deep', // Deep copy arrays
    lazyInit: false,
    default: [] as Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>,
  } as const satisfies FieldDef,

  colPageBreaks: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: [] as Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>,
  } as const satisfies FieldDef,

  printArea: {
    type: 'primitive', // Object stored as primitive
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: null,
  } as const satisfies FieldDef,

  printTitles: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: null,
  } as const satisfies FieldDef,

  /**
   * Sheet print settings (persistent defaults for print dialog).
   * Uses DEFAULT_SHEET_PRINT_SETTINGS when undefined.
   */
  printSettings: {
    type: 'primitive', // Object stored as primitive
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: undefined, // Uses DEFAULT_SHEET_PRINT_SETTINGS when needed
  } as const satisfies FieldDef,

  // ===========================================================================
  // Split View (Split View Feature)
  // ===========================================================================

  /**
   * Split view configuration for the sheet.
   * When enabled, creates 2-4 independently scrolling viewports.
   * Stored as SplitViewportConfig | null.
   *
   * Split and freeze are mutually exclusive - enabling one removes the other.
   */
  splitConfig: {
    type: 'primitive', // Object stored as primitive (JSON-serializable)
    required: false,
    copy: 'shallow', // Collaborative setting - shallow copy is sufficient
    lazyInit: false,
    default: null, // No split by default
  } as const satisfies FieldDef,

  // ===========================================================================
  // Used Range (Performance Optimization)
  // ===========================================================================

  /**
   * Cached used range for O(1) Ctrl+End navigation.
   */
  usedRange: {
    type: 'primitive', // Object stored as primitive (JSON-serializable)
    required: false,
    copy: 'shallow', // Copy preserves the used range
    lazyInit: false,
    default: null, // No used range initially (empty sheet)
  } as const satisfies FieldDef,
} as const satisfies Schema;

// =============================================================================
// Schema Utilities
// =============================================================================

/**
 * Get the default value for a SheetMeta field.
 *
 * @param field - The field name
 * @returns The default value, or undefined if no default
 */
export function getSheetMetaDefault(field: SheetMetaField): unknown {
  const def = SHEET_META_SCHEMA[field];
  // Use type assertion since not all schema entries have 'default'
  return (def as { default?: unknown }).default;
}

/**
 * Get all default values for SheetMeta fields that have defaults.
 * This can be used to derive DEFAULT_SHEET_SETTINGS.
 *
 * @returns Record of field names to default values
 */
export function getSheetMetaDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SHEET_META_SCHEMA)) {
    const fieldDef = def as { default?: unknown };
    if ('default' in fieldDef && fieldDef.default !== undefined) {
      defaults[key] = fieldDef.default;
    }
  }
  return defaults;
}

/**
 * Get the copy strategy for a SheetMeta field.
 *
 * @param field - The field name
 * @returns The copy strategy ('deep', 'shallow', or 'skip')
 */
export function getSheetMetaCopyStrategy(field: SheetMetaField): FieldDef['copy'] {
  return SHEET_META_SCHEMA[field].copy;
}

/**
 * Check if a SheetMeta field is required on creation.
 *
 * @param field - The field name
 * @returns true if the field is required
 */
export function isSheetMetaFieldRequired(field: SheetMetaField): boolean {
  return SHEET_META_SCHEMA[field].required;
}
