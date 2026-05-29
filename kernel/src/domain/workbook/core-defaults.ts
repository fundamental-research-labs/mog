/**
 * Core Default Constants
 *
 * DEFAULT_CALCULATION_SETTINGS, DEFAULT_WORKBOOK_SETTINGS, DEFAULT_SHEET_SETTINGS,
 * and DEFAULT_SHEET_PRINT_SETTINGS moved from contracts/core/core.ts.
 *
 * These constants depend on schema utility functions (runtime code),
 * which properly belong in kernel, not contracts.
 */

import type {
  CalculationSettings,
  PrintSettings,
  SheetSettings,
  WorkbookSettings,
} from '@mog-sdk/contracts/core';
import type { SheetMetaField } from '@mog-sdk/contracts/store';

import { getSheetMetaDefault } from '../sheets/sheet-meta-defaults';
import { getWorkbookSettingsDefaults } from './workbook-defaults';

// =============================================================================
// DEFAULT_CALCULATION_SETTINGS
// =============================================================================

/**
 * Default calculation settings (matching Excel defaults).
 */
export const DEFAULT_CALCULATION_SETTINGS: CalculationSettings = {
  enableIterativeCalculation: false,
  maxIterations: 100,
  maxChange: 0.001,
  calcMode: 'auto',
  fullPrecision: true,
  r1c1Mode: false,
  fullCalcOnLoad: false,
  calcCompleted: true,
  calcOnSave: true,
  concurrentCalc: true,
  concurrentManualCount: null,
  forceFullCalc: false,
  hasExplicitIterateCount: false,
  hasExplicitIterateDelta: false,
};

// =============================================================================
// DEFAULT_WORKBOOK_SETTINGS
// =============================================================================

/**
 * Default workbook settings.
 * Stream L: Settings & Toggles
 *
 * SCHEMA-DRIVEN: Defaults are derived from WORKBOOK_SETTINGS_SCHEMA.
 * @see workbook-defaults.ts for the single source of truth.
 */
export const DEFAULT_WORKBOOK_SETTINGS: WorkbookSettings =
  getWorkbookSettingsDefaults() as unknown as WorkbookSettings;

// =============================================================================
// DEFAULT_SHEET_SETTINGS
// =============================================================================

/**
 * Fields from SheetMeta that comprise SheetSettings.
 * Used to build DEFAULT_SHEET_SETTINGS from SHEET_META_SCHEMA.
 */
export const SHEET_SETTINGS_FIELDS: SheetMetaField[] = [
  // From SheetViewOptions
  'showGridlines',
  'showRowHeaders',
  'showColumnHeaders',
  'showFormulas',
  'showZeroValues',
  'zoomScale',
  // Extended settings
  'isProtected',
  'protectionPasswordHash',
  'protectionOptions',
  'gridlineColor',
  'rightToLeft',
  'defaultRowHeight',
  'defaultColWidth',
];

/**
 * The subset of sheet-settings keys that drive the canonical
 * `view:options-changed` event surface (gridlines / headers / RTL /
 * formula-display / zero-display / zoom).
 *
 * Source of truth: the union of view-shape keys carried on the Rust
 * `SheetSettings` payload (`SheetSettings` in `compute-types.gen.ts`,
 * which mirrors `domain_types::domain::sheet::SheetSettings`). Listed
 * explicitly (not derived structurally) because `SheetSettings` also
 * carries non-view fields (protection, default dimensions, gridline
 * color) that must NOT trigger a view re-emission.
 *
 * Note: `showFormulas` and `zoomScale` live on the Rust `SheetSettings`
 * but are not yet in `SheetMetaField` on the TS side — the type is a
 * narrower facet for the persisted Yrs-meta schema. The dispatcher
 * matches `SheetSettingsChange.changedKey` (a string from the wire),
 * so the broader runtime key set is correct here.
 *
 * Per ARCHITECTURE-CHECKLIST §6: schema-driven over inline enumeration —
 * the kernel-state-mirror dispatcher imports this rather than redefining
 * the key list at the use site.
 */
export const VIEW_OPTION_KEYS: ReadonlySet<string> = new Set([
  'showGridlines',
  'showRowHeaders',
  'showColumnHeaders',
  'rightToLeft',
  'showFormulas',
  'showZeroValues',
  'zoomScale',
]);

/**
 * Build SheetSettings defaults from SHEET_META_SCHEMA.
 * This ensures defaults are derived from the single source of truth.
 */
function buildSheetSettingsDefaults(): SheetSettings {
  const defaults: Record<string, unknown> = {};
  for (const field of SHEET_SETTINGS_FIELDS) {
    const value = getSheetMetaDefault(field);
    if (value !== undefined) {
      defaults[field] = value;
    }
  }
  return defaults as unknown as SheetSettings;
}

/**
 * Default sheet settings.
 * Stream L: Settings & Toggles
 *
 * SCHEMA-DRIVEN: Defaults are derived from SHEET_META_SCHEMA.
 * @see sheets/sheet-meta-defaults.ts for the single source of truth.
 *
 * Frozen at declaration: `state-mirror.ts` returns this object by reference
 * as the default-on-miss for `getSheetSettings`. Without `Object.freeze`,
 * a consumer mutating the returned object would corrupt every subsequent
 * read. (TypeScript types it as the mutable contract shape; freeze still
 * works at runtime.)
 */
export const DEFAULT_SHEET_SETTINGS: SheetSettings = Object.freeze(
  buildSheetSettingsDefaults(),
) as SheetSettings;

// =============================================================================
// DEFAULT_SHEET_PRINT_SETTINGS
// =============================================================================

/**
 * Default sheet print settings.
 * Full PrintSettings matching the Rust domain-types canonical type.
 *
 * Frozen at declaration: `state-mirror.ts` returns this object by reference
 * as the default-on-miss for `getPrintSettings`. Without `Object.freeze`,
 * a consumer mutating the returned object would corrupt every subsequent
 * read. (TypeScript types it as the mutable contract shape; freeze still
 * works at runtime.)
 */
export const DEFAULT_SHEET_PRINT_SETTINGS: PrintSettings = Object.freeze({
  paperSize: null,
  paperWidth: null,
  paperHeight: null,
  orientation: null,
  scale: null,
  fitToWidth: null,
  fitToHeight: null,
  gridlines: false,
  gridLinesSet: true,
  headings: false,
  hCentered: false,
  vCentered: false,
  margins: null,
  headerFooter: null,
  blackAndWhite: false,
  draft: false,
  firstPageNumber: null,
  pageOrder: null,
  usePrinterDefaults: null,
  horizontalDpi: null,
  verticalDpi: null,
  rId: null,
  hasPrintOptions: false,
  hasPageSetup: false,
  copies: null,
  pageSetupProperties: null,
  useFirstPageNumber: false,
  printComments: null,
  printErrors: null,
}) as PrintSettings;
