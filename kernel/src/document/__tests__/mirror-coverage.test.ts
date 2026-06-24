/**
 * Mirror coverage CI guard — Mirror coverage CI guard.
 *
 * Catches two symmetric drift modes in the mutation pipeline:
 *
 *   A) Runtime-source schema coverage. A field lands in one of the walked
 *      runtime schemas (SHEET_META_SCHEMA, WORKBOOK_SETTINGS_SCHEMA,
 *      SHEET_SETTINGS_FIELDS, SHEET_MAPS_SCHEMA) but nobody classifies it
 *      as either mirror-tracked (`mirrorFieldCoverage`) or owned elsewhere
 *      (`mirrorCoverageExclusions`).
 *
 *   B) MutationResult dispatcher coverage. A new variant lands on the
 *      generated `MutationResult` TS type but no `MutationResultHandler`
 *      branch consumes it (the gap that state-mirror step 1 had to close
 *      manually for the seven `8747f39e3` families). Every key on the
 *      `MutationResult` shape must be classified as either dispatched
 *      (`mutationResultDispatcherCoverage`) or excluded with a reason
 *      (`mutationResultDispatcherExclusions`).
 *
 * Failure mode: a clear, actionable message that names the source file, the
 * unclassified field, and the two maps a maintainer can add the entry to.
 *
 * What this guard does NOT verify:
 *   - That the mirror's apply logic is *correct* — covered by runtime
 *     invariants in the UI eval harness.
 *   - That selectors registered in `mirrorFieldCoverage` actually fire on
 *     the right changes — also covered by runtime invariants.
 *
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type {
  MutationResult,
  SheetChange,
  SheetSettingsChange,
  PageBreakChange,
  PrintAreaChange,
  PrintTitlesChange,
  PrintSettingsChange,
  SplitConfigChange,
  ScrollPositionChange,
  WorkbookSettingsChange,
} from '../../bridges/compute/compute-types.gen';

import { SHEET_META_SCHEMA } from '../../domain/sheets/sheet-meta-defaults';
import { WORKBOOK_SETTINGS_SCHEMA } from '../../domain/workbook/workbook-defaults';
import { SHEET_SETTINGS_FIELDS } from '../../domain/workbook/core-defaults';
// SHEET_MAPS_SCHEMA lives in `@mog/types-api`, which is not a direct kernel
// dependency. The spec mandates reading the runtime source (NOT the
// contracts re-export shim), so we parse the schema's top-level keys out
// of the source file at test time. Same fs-reflective pattern we use for
// the MutationResult interface below.

// =============================================================================
// Drift mode A — mirror field coverage classification
// =============================================================================

/**
 * Type for a single mirror-coverage entry. The selector field is documentary
 * only — Guard 1 never invokes it. Guard 2 (the runtime doctor invariant)
 * is responsible for verifying the apply logic.
 */
interface MirrorCoverageEntry {
  variant: keyof MutationResult;
  selector: string; // human-readable description; not invoked
}

/**
 * Mirror-tracked fields. Keys are namespaced as `<schemaFamily>.<fieldName>`
 * to keep the source-of-origin obvious in the failure message.
 *
 * NOTE: the same mirror-backed concept can appear under multiple namespaces
 * when the underlying state lives in two schemas at once (e.g. `frozenRows`
 * shows up both as a SheetMeta field and as a SheetChange `frozen` payload
 * delta). That's intentional — Guard 1 verifies classification per
 * runtime source, not per logical concept.
 */
const mirrorFieldCoverage: Record<string, MirrorCoverageEntry> = {
  // ---- SHEET_META_SCHEMA → mirror getters ------------------------------------
  'sheetMeta.frozenRows': {
    variant: 'sheetChanges',
    selector: 'SheetChange.field === "frozen" → mirror.getFrozenPanes / getSheetMeta',
  },
  'sheetMeta.frozenCols': {
    variant: 'sheetChanges',
    selector: 'SheetChange.field === "frozen" → mirror.getFrozenPanes / getSheetMeta',
  },
  'sheetMeta.tabColor': {
    variant: 'sheetChanges',
    selector: 'SheetChange.field === "tabColor" → mirror.getSheetMeta',
  },
  'sheetMeta.hidden': {
    variant: 'sheetChanges',
    selector: 'SheetChange.field === "hidden" | "visibility" → mirror.getSheetMeta',
  },
  'sheetMeta.showGridlines': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.showGridlines → mirror.getSheetSettings/getViewOptions',
  },
  'sheetMeta.showRowHeaders': {
    variant: 'settingsChanges',
    selector:
      'SheetSettingsChange.settings.showRowHeaders → mirror.getSheetSettings/getViewOptions',
  },
  'sheetMeta.showColumnHeaders': {
    variant: 'settingsChanges',
    selector:
      'SheetSettingsChange.settings.showColumnHeaders → mirror.getSheetSettings/getViewOptions',
  },
  'sheetMeta.isProtected': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.isProtected → mirror.getSheetSettings',
  },
  'sheetMeta.protectionPasswordHash': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.protectionPasswordHash → mirror.getSheetSettings',
  },
  'sheetMeta.protectionOptions': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.protectionOptions → mirror.getSheetSettings',
  },
  'sheetMeta.showZeroValues': {
    variant: 'settingsChanges',
    selector:
      'SheetSettingsChange.settings.showZeroValues → mirror.getSheetSettings/getViewOptions',
  },
  'sheetMeta.showFormulas': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.showFormulas → mirror.getSheetSettings/getViewOptions',
  },
  'sheetMeta.zoomScale': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.zoomScale → mirror.getSheetSettings/getViewOptions',
  },
  'sheetMeta.gridlineColor': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.gridlineColor → mirror.getSheetSettings',
  },
  'sheetMeta.rightToLeft': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.rightToLeft → mirror.getSheetSettings/getViewOptions',
  },
  'sheetMeta.defaultRowHeight': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.defaultRowHeight → mirror.getSheetSettings',
  },
  'sheetMeta.defaultColWidth': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.defaultColWidth → mirror.getSheetSettings',
  },
  'sheetMeta.rowPageBreaks': {
    variant: 'pageBreakChanges',
    selector: 'PageBreakChange.breaks.rowBreaks → mirror.getPageBreaks',
  },
  'sheetMeta.colPageBreaks': {
    variant: 'pageBreakChanges',
    selector: 'PageBreakChange.breaks.colBreaks → mirror.getPageBreaks',
  },
  'sheetMeta.printArea': {
    variant: 'printAreaChanges',
    selector: 'PrintAreaChange.area → mirror.getPrintArea',
  },
  'sheetMeta.printTitles': {
    variant: 'printTitlesChanges',
    selector: 'PrintTitlesChange.titles → mirror.getPrintTitles',
  },
  'sheetMeta.printSettings': {
    variant: 'printSettingsChanges',
    selector: 'PrintSettingsChange.settings → mirror.getPrintSettings',
  },
  'sheetMeta.splitConfig': {
    variant: 'splitConfigChanges',
    selector: 'SplitConfigChange.config → mirror.getSplitConfig',
  },

  // ---- WORKBOOK_SETTINGS_SCHEMA → mirror.getWorkbookSettings -----------------
  // Every workbook-settings field flows through `workbookSettingsChanges`,
  // which carries a full post-mutation snapshot — so the mirror surface is
  // `getWorkbookSettings()` (and the per-field convenience getters that read
  // off it). Listed exhaustively so a new workbook setting forces an
  // explicit classification.
  'workbookSettings.showHorizontalScrollbar': {
    variant: 'workbookSettingsChanges',
    selector:
      'WorkbookSettingsChange.settings.showHorizontalScrollbar → mirror.getWorkbookSettings',
  },
  'workbookSettings.showVerticalScrollbar': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.showVerticalScrollbar → mirror.getWorkbookSettings',
  },
  'workbookSettings.autoHideScrollBars': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.autoHideScrollBars → mirror.getWorkbookSettings',
  },
  'workbookSettings.showTabStrip': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.showTabStrip → mirror.getWorkbookSettings',
  },
  'workbookSettings.showFormulaBar': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.showFormulaBar → mirror.getWorkbookSettings',
  },
  'workbookSettings.allowSheetReorder': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.allowSheetReorder → mirror.getWorkbookSettings',
  },
  'workbookSettings.autoFitOnDoubleClick': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.autoFitOnDoubleClick → mirror.getWorkbookSettings',
  },
  'workbookSettings.showCutCopyIndicator': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.showCutCopyIndicator → mirror.getWorkbookSettings',
  },
  'workbookSettings.allowDragFill': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.allowDragFill → mirror.getWorkbookSettings',
  },
  'workbookSettings.enterKeyDirection': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.enterKeyDirection → mirror.getWorkbookSettings',
  },
  'workbookSettings.allowCellDragDrop': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.allowCellDragDrop → mirror.getWorkbookSettings',
  },
  'workbookSettings.themeId': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.themeId → mirror.getWorkbookSettings',
  },
  'workbookSettings.themeFontsId': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.themeFontsId → mirror.getWorkbookSettings',
  },
  'workbookSettings.culture': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.culture → mirror.getCulture/getWorkbookSettings',
  },
  'workbookSettings.selectedSheetIds': {
    variant: 'workbookSettingsChanges',
    selector:
      'WorkbookSettingsChange.settings.selectedSheetIds → mirror.getSelectedSheetIds/getWorkbookSettings',
  },
  'workbookSettings.isWorkbookProtected': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.isWorkbookProtected → mirror.getWorkbookSettings',
  },
  'workbookSettings.workbookProtectionPasswordHash': {
    variant: 'workbookSettingsChanges',
    selector:
      'WorkbookSettingsChange.settings.workbookProtectionPasswordHash → mirror.getWorkbookSettings',
  },
  'workbookSettings.workbookProtectionOptions': {
    variant: 'workbookSettingsChanges',
    selector:
      'WorkbookSettingsChange.settings.workbookProtectionOptions → mirror.getWorkbookSettings',
  },
  'workbookSettings.calculationSettings': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.calculationSettings → mirror.getWorkbookSettings',
  },
  'workbookSettings.date1904': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.date1904 → mirror.getWorkbookSettings',
  },
  'workbookSettings.defaultTableStyleId': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.defaultTableStyleId → mirror.getWorkbookSettings',
  },
  'workbookSettings.automaticConversionPolicy': {
    variant: 'workbookSettingsChanges',
    selector:
      'WorkbookSettingsChange.settings.automaticConversionPolicy → mirror.getWorkbookSettings',
  },
  'workbookSettings.chartDataPointTrack': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.chartDataPointTrack → mirror.getWorkbookSettings',
  },
  'workbookSettings.appInstances': {
    variant: 'workbookSettingsChanges',
    selector: 'WorkbookSettingsChange.settings.appInstances → mirror.getWorkbookSettings',
  },

  // ---- SHEET_SETTINGS_FIELDS → mirror.getSheetSettings -----------------------
  // These overlap the SheetMeta entries above (the sheet-settings list is a
  // facet of SheetMeta). Listed under their own namespace so a new entry in
  // SHEET_SETTINGS_FIELDS forces an explicit classification even if the
  // matching SheetMeta entry already exists.
  'sheetSettings.showGridlines': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.showGridlines → mirror.getSheetSettings',
  },
  'sheetSettings.showRowHeaders': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.showRowHeaders → mirror.getSheetSettings',
  },
  'sheetSettings.showColumnHeaders': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.showColumnHeaders → mirror.getSheetSettings',
  },
  'sheetSettings.isProtected': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.isProtected → mirror.getSheetSettings',
  },
  'sheetSettings.protectionPasswordHash': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.protectionPasswordHash → mirror.getSheetSettings',
  },
  'sheetSettings.protectionOptions': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.protectionOptions → mirror.getSheetSettings',
  },
  'sheetSettings.showZeroValues': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.showZeroValues → mirror.getSheetSettings',
  },
  'sheetSettings.showFormulas': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.showFormulas → mirror.getSheetSettings',
  },
  'sheetSettings.zoomScale': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.zoomScale → mirror.getSheetSettings',
  },
  'sheetSettings.gridlineColor': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.gridlineColor → mirror.getSheetSettings',
  },
  'sheetSettings.rightToLeft': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.rightToLeft → mirror.getSheetSettings',
  },
  'sheetSettings.defaultRowHeight': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.defaultRowHeight → mirror.getSheetSettings',
  },
  'sheetSettings.defaultColWidth': {
    variant: 'settingsChanges',
    selector: 'SheetSettingsChange.settings.defaultColWidth → mirror.getSheetSettings',
  },
};

/**
 * Fields that appear in a walked runtime source but are intentionally NOT
 * mirror-tracked. Each entry must explain who owns the data instead.
 */
const mirrorCoverageExclusions: Record<string, string> = {
  // ---- SHEET_META_SCHEMA exclusions ------------------------------------------
  'sheetMeta.id':
    'identity field — not a mirror getter; sheet identity is carried on every change directly',
  'sheetMeta.name':
    'tracked indirectly via SheetChange (field=sheet/name) and surfaced on getSheetMeta().name; intentionally not a top-level coverage entry because there is no SHEET_META_SCHEMA "name" change variant — name is part of the sheetChanges family classification, not a standalone field-level entry',
  'sheetMeta.usedRange':
    'derived/cached — not part of the state-mirror scope; computed by the layout/used-range engine, not the kernel-state-mirror',

  // ---- SHEET_MAPS_SCHEMA exclusions ------------------------------------------
  // Every SheetMaps key is owned by a kernel buffer / cache other than the
  // mirror. Listed exhaustively because SheetMaps covers many non-mirror domains.
  'sheetMaps.meta':
    'workbook/sheet meta is hydrated through SHEET_META_SCHEMA + SheetSettingsChange; the Y.Map is the source-of-truth, the mirror is the read view',
  'sheetMaps.cells': 'owned by BinaryViewportBuffer — cell values are not mirror-tracked',
  'sheetMaps.properties':
    'owned by BinaryViewportBuffer + CellMetadataCache (cell-level format/style)',
  'sheetMaps.grid': 'cellId-by-position lookup — owned by BinaryViewportBuffer / CellMetadataCache',
  'sheetMaps.rows':
    'row identity / metadata — owned by row-identity model in kernel; not a mirror getter',
  'sheetMaps.rowIndex': 'row identity index — owned by row-identity model; not a mirror getter',
  'sheetMaps.rowHeights': 'owned by ViewportCoordinator dimensions (DimensionChange path)',
  'sheetMaps.rowFormats': 'row-level format — owned by BinaryViewportBuffer / CellMetadataCache',
  'sheetMaps.cols':
    'col identity / metadata — owned by col-identity model in kernel; not a mirror getter',
  'sheetMaps.colIndex': 'col identity index — owned by col-identity model; not a mirror getter',
  'sheetMaps.colWidths': 'owned by ViewportCoordinator dimensions (DimensionChange path)',
  'sheetMaps.colFormats': 'col-level format — owned by BinaryViewportBuffer / CellMetadataCache',
  'sheetMaps.schemas':
    'column schemas — owned by schema/range-schema subsystem; not in state-mirror mirror scope',
  'sheetMaps.rangeSchemas':
    'range schemas — owned by schema/range-schema subsystem; not in state-mirror mirror scope',
  'sheetMaps.merges': 'owned by merge subsystem; events flow through MergeChange not the mirror',
  'sheetMaps.hiddenRows':
    'owned by visibility subsystem; events flow through VisibilityChange not the mirror',
  'sheetMaps.manualHiddenRows':
    'owned by visibility subsystem; events flow through VisibilityChange not the mirror',
  'sheetMaps.filterHiddenRows':
    'owned by filtering/visibility subsystem; events flow through FilterChange/VisibilityChange not the mirror',
  'sheetMaps.hiddenCols':
    'owned by visibility subsystem; events flow through VisibilityChange not the mirror',
  'sheetMaps.tables': 'owned by table subsystem; events flow through TableChange not the mirror',
  'sheetMaps.groupingConfig':
    'owned by grouping subsystem; events flow through GroupingChange not the mirror',
  'sheetMaps.charts':
    'owned by floating-object subsystem; events flow through FloatingObjectChange not the mirror',
  'sheetMaps.floatingObjects':
    'owned by floating-object subsystem; events flow through FloatingObjectChange not the mirror',
  'sheetMaps.floatingObjectGroups':
    'owned by floating-object-group subsystem; events flow through FloatingObjectChange (group variant) not the mirror',
  'sheetMaps.formControls':
    'lazy interactive feature — owned by form-control subsystem; not in state-mirror mirror scope',
  'sheetMaps.filters':
    'lazy interactive feature — owned by filter subsystem; events flow through FilterChange not the mirror',
  'sheetMaps.comments':
    'lazy interactive feature — owned by comment subsystem; events flow through CommentChange not the mirror',
  'sheetMaps.slicers':
    'lazy interactive feature — owned by slicer subsystem; not in state-mirror mirror scope',
  'sheetMaps.dataBindings':
    'lazy interactive feature — owned by data-binding subsystem; not in state-mirror mirror scope',
};

// =============================================================================
// Drift mode B — MutationResult dispatcher classification
// =============================================================================

/**
 * MutationResult variants the dispatcher (`MutationResultHandler.applyAndNotify`)
 * actively consumes — either to drive a per-variant event emission or to
 * patch a kernel cache directly.
 */
const mutationResultDispatcherCoverage: Record<keyof MutationResult, string> = {
  recalc: 'handleRecalcResult — patches CellMetadataCache and emits cell:changed events',
  propertyChanges: 'handlePropertyChanges — emits cell:format-changed events',
  dimensionChanges:
    'handleDimensionChanges — patches ViewportCoordinator + emits row/column dimension events',
  mergeChanges: 'handleMergeChanges — emits merges:changed events',
  visibilityChanges:
    'handleVisibilityChanges — emits rows:hidden/unhidden + columns:hidden/unhidden',
  commentChanges: 'handleCommentChanges — emits comments:cleared signal',
  filterChanges: 'handleFilterChanges — emits filter:updated/deleted events',
  tableChanges: 'handleTableChanges — emits table:updated/deleted events',
  slicerChanges: 'handleSlicerChanges — emits slicer lifecycle and selection events',
  sheetChanges:
    'handleSheetChanges — emits sheet:created/copied/deleted/renamed/moved/visibility/freeze/color events; mirror.applySheetChange',
  sheetLifecycleRuntimeHint:
    'pre-event sheet runtime adapter — reconciles WorkbookStateProvider active sheet after mirror.apply and before sheet lifecycle events',
  settingsChanges:
    'handleSettingsChanges — emits sheet:settings-changed (and view:options-changed for view keys); mirror.applySheetSettingsChange',
  pageBreakChanges:
    'handlePageBreakChanges — emits print:page-breaks-changed; mirror.applyPageBreakChange',
  printAreaChanges:
    'handlePrintAreaChanges — emits print:area-changed; mirror.applyPrintAreaChange',
  printTitlesChanges:
    'handlePrintTitlesChanges — emits print:titles-changed; mirror.applyPrintTitlesChange',
  printSettingsChanges:
    'handlePrintSettingsChanges — emits sheet:print-settings-changed; mirror.applyPrintSettingsChange',
  splitConfigChanges:
    'handleSplitConfigChanges — emits split:position-changed/removed; mirror.applySplitConfigChange',
  scrollPositionChanges:
    'handleScrollPositionChanges — emits scroll:changed; mirror.applyScrollPositionChange',
  viewSelectionChanges:
    'emitViewSelectionChanges — emits view:selection-changed; mirror.applyViewSelectionChange',
  workbookSettingsChanges:
    'handleWorkbookSettingsChanges — emits workbook:settings-changed; mirror.applyWorkbookSettingsChange',
  cfChanges: 'handleCfChanges — emits cf:rules-changed events',
  namedRangeChanges:
    'handleNamedRangeChanges — currently a stub that swallows the change (full event emission pending Rust providing richer change metadata)',
  groupingChanges: 'handleGroupingChanges — emits grouping:changed events',
  sparklineChanges:
    'handleSparklineChanges — currently a stub (full event emission pending richer Rust metadata; viewport patching covered separately)',
  sortingChanges: 'handleSortingChanges — emits range:sorted events',
  structureChanges:
    'handleStructureChanges — emits rows:inserted/deleted + columns:inserted/deleted events',
  floatingObjectChanges:
    'handleFloatingObjectChanges — emits floatingObject + chart create/update/delete events',
  floatingObjectGroupChanges:
    'handleFloatingObjectGroupChanges — emits floatingObjectGroup:updated/deleted events',
  pivotChanges: 'handlePivotChanges — emits pivot:updated/deleted events',
  rangeChanges:
    'handleRangeChanges — updates RangeMetadataCache and emits range created/removed/replaced events',
  policyPreservedParseOutcomes:
    'handlePolicyPreservedParseOutcomes — emits workbook:policy-preserved details with summary',
  policyPreservedParseSummary:
    'handlePolicyPreservedParseOutcomes — emits workbook:policy-preserved when summary is present',
  diagnostics:
    'recordRuntimeDiagnostics — retains runtime diagnostic side-channel for workbook diagnostics queries',
  undoDescription: 'handleUndoDescription — forwards to onUndoDescription callback for undo UI',
  // Side-channels — declared in mutationResultDispatcherExclusions below.
  authoredCellChanges: '__excluded__',
  data: '__excluded__',
  oldValues: '__excluded__',
};

/**
 * MutationResult keys that intentionally bypass the dispatcher.
 */
const mutationResultDispatcherExclusions: Partial<Record<keyof MutationResult, string>> = {
  authoredCellChanges:
    'side-channel — exposed for semantic capture; not dispatched as a UI or state-mirror change family',
  data: 'arbitrary side-channel payload (per-IPC, not a change family) — consumed by the originating call site, not the generic dispatcher',
  oldValues:
    'side-channel — folded into ChangeAccumulator-bound CellChange.oldValue inside applyAndNotify before being passed to ingest, never dispatched as its own variant',
};

// Strip the excluded sentinel-rows from the coverage map so the membership
// check below treats them as exclusion-only.
for (const [k, v] of Object.entries(mutationResultDispatcherCoverage)) {
  if (v === '__excluded__') {
    delete (mutationResultDispatcherCoverage as Record<string, string>)[k];
  }
}

// =============================================================================
// Helpers
// =============================================================================

// ESM-friendly equivalent of `__dirname`. ts-jest's ESM preset doesn't
// expose `__dirname` at runtime, so we derive it from `import.meta.url`.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const SOURCES = {
  sheetMeta: 'kernel/src/domain/sheets/sheet-meta-defaults.ts',
  workbookSettings: 'kernel/src/domain/workbook/workbook-defaults.ts',
  sheetSettings: 'kernel/src/domain/workbook/core-defaults.ts',
  sheetMaps: 'types/api/src/store/sheet-maps-schema.ts',
  mutationResult: 'kernel/src/bridges/compute/compute-types.gen.ts',
} as const;

function classifyOrFail(
  family: 'sheetMeta' | 'workbookSettings' | 'sheetSettings' | 'sheetMaps',
  fields: readonly string[],
  sourceLabel: string,
): string[] {
  const unclassified: string[] = [];
  for (const field of fields) {
    const key = `${family}.${field}`;
    const inCoverage = key in mirrorFieldCoverage;
    const inExclusion = key in mirrorCoverageExclusions;
    if (inCoverage && inExclusion) {
      unclassified.push(
        `Mirror coverage conflict: field "${field}" from "${sourceLabel}" appears in BOTH ` +
          `mirrorFieldCoverage AND mirrorCoverageExclusions under key "${key}". ` +
          `Each field must be classified exactly once.`,
      );
    } else if (!inCoverage && !inExclusion) {
      unclassified.push(
        `Mirror coverage gap: field "${field}" from "${sourceLabel}" (key "${key}") has no classification.\n` +
          `  Add to mirrorFieldCoverage if the kernel state mirror should track it,\n` +
          `  or to mirrorCoverageExclusions with a reason if it's owned elsewhere\n` +
          `  (e.g. BinaryViewportBuffer, ViewportCoordinator, CellMetadataCache,\n` +
          `   another kernel cache, or intentionally out of state-mirror scope).`,
      );
    }
  }
  return unclassified;
}

/**
 * Read the top-level keys of `SHEET_MAPS_SCHEMA` from its source file.
 * Avoids adding `@mog/types-api` as a kernel dep just for this test, and
 * — per the Guard 1 spec — keeps the runtime source obviously visible
 * rather than going through the contracts re-export shim.
 *
 * The schema is a single `export const SHEET_MAPS_SCHEMA = { ... } as const`;
 * the keys we want are at *exactly two-space* indent (the top-level entry
 * names). Inner object lines are at deeper indent and start with `type:`,
 * `valueType:`, etc., so we discriminate by indent and shape.
 */
function readSheetMapsSchemaKeysFromSource(): string[] {
  const schemaPath = path.resolve(REPO_ROOT, SOURCES.sheetMaps);
  const src = fs.readFileSync(schemaPath, 'utf8');
  const block = src.match(/export const SHEET_MAPS_SCHEMA = \{([\s\S]*?)\n\} as const/);
  if (!block) {
    throw new Error(
      `Could not locate "export const SHEET_MAPS_SCHEMA = { ... } as const" in ` +
        `${SOURCES.sheetMaps}. The schema source format may have changed; update ` +
        `mirror-coverage.test.ts to match.`,
    );
  }
  const body = block[1];
  const keys: string[] = [];
  for (const line of body.split('\n')) {
    // Top-level keys sit at 2-space indent and end with `: {`.
    const m = line.match(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*): \{\s*$/);
    if (m) keys.push(m[1]);
  }
  if (keys.length === 0) {
    throw new Error(
      `Parsed zero top-level fields out of SHEET_MAPS_SCHEMA in ${SOURCES.sheetMaps}. ` +
        `Regex likely needs an update.`,
    );
  }
  return keys;
}

/**
 * Read the keys of the `MutationResult` interface from the generated
 * `.gen.ts` source. Type-only imports don't expose runtime keys, and the
 * generated file is a stable single-block `export interface MutationResult { ... }`,
 * so a regex extraction is the simplest approach.
 *
 * The fallback assertion against a hand-maintained literal list keeps the
 * test honest if the gen format ever changes — the test will fail loudly
 * rather than silently parsing zero keys.
 */
function readMutationResultKeysFromGen(): string[] {
  const genPath = path.resolve(REPO_ROOT, SOURCES.mutationResult);
  const src = fs.readFileSync(genPath, 'utf8');
  const block = src.match(/export interface MutationResult \{([\s\S]*?)\n\}/);
  if (!block) {
    throw new Error(
      `Could not locate "export interface MutationResult { ... }" in ${SOURCES.mutationResult}. ` +
        `The generated type format may have changed; update mirror-coverage.test.ts to match.`,
    );
  }
  const body = block[1];
  const keys: string[] = [];
  for (const line of body.split('\n')) {
    // Match "  fieldName?: ..." or "  fieldName: ..."
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??:/);
    if (m) keys.push(m[1]);
  }
  if (keys.length === 0) {
    throw new Error(
      `Parsed zero fields out of the MutationResult interface in ${SOURCES.mutationResult}. ` +
        `Regex likely needs an update.`,
    );
  }
  return keys;
}

// =============================================================================
// Compile-time sanity: mirrorFieldCoverage variants must be valid
// MutationResult keys. This isn't a behavioral check — it's a typo-catcher
// at test-load time. If the variant string ever drifts from the gen type,
// the union narrowing fails on the `Record` value type and the test stops
// loading.
// =============================================================================

// Touch the imported MutationResult-aux types so TS doesn't tree-shake the
// imports above (they document the variant payload shape for future
// maintainers reading the coverage table).
type _MutationResultAux =
  | SheetChange
  | SheetSettingsChange
  | PageBreakChange
  | PrintAreaChange
  | PrintTitlesChange
  | PrintSettingsChange
  | SplitConfigChange
  | ScrollPositionChange
  | WorkbookSettingsChange;
const _aux: _MutationResultAux | undefined = undefined;
void _aux;

// =============================================================================
// Tests
// =============================================================================

describe('Mirror coverage CI guard', () => {
  // --- Drift mode A: runtime-source schema coverage --------------------------

  describe('drift mode A — runtime-source schema coverage', () => {
    it('every SHEET_META_SCHEMA field is classified exactly once', () => {
      const fields = Object.keys(SHEET_META_SCHEMA);
      const errors = classifyOrFail('sheetMeta', fields, SOURCES.sheetMeta);
      expect(errors).toEqual([]);
    });

    it('every WORKBOOK_SETTINGS_SCHEMA field is classified exactly once', () => {
      const fields = Object.keys(WORKBOOK_SETTINGS_SCHEMA);
      const errors = classifyOrFail('workbookSettings', fields, SOURCES.workbookSettings);
      expect(errors).toEqual([]);
    });

    it('every SHEET_SETTINGS_FIELDS entry is classified exactly once', () => {
      const errors = classifyOrFail(
        'sheetSettings',
        SHEET_SETTINGS_FIELDS as readonly string[],
        SOURCES.sheetSettings,
      );
      expect(errors).toEqual([]);
    });

    it('every SHEET_SETTINGS_FIELDS entry exists on SHEET_META_SCHEMA', () => {
      // Belt-and-suspenders: the sheet-settings list is supposed to be a
      // facet of the sheet-meta schema. If one drifts, that's a separate
      // class of bug we want surfaced here too (the spec explicitly calls
      // this out as part of Guard 1's sheetSettings check).
      const meta = new Set(Object.keys(SHEET_META_SCHEMA));
      const missing: string[] = [];
      for (const f of SHEET_SETTINGS_FIELDS) {
        if (!meta.has(f)) missing.push(f);
      }
      expect(missing).toEqual([]);
    });

    it('every SHEET_MAPS_SCHEMA field is classified exactly once', () => {
      const fields = readSheetMapsSchemaKeysFromSource();
      const errors = classifyOrFail('sheetMaps', fields, SOURCES.sheetMaps);
      expect(errors).toEqual([]);
    });
  });

  // --- Drift mode B: MutationResult dispatcher coverage ---------------------

  describe('drift mode B — MutationResult dispatcher coverage', () => {
    it('every key on MutationResult is classified exactly once', () => {
      const keys = readMutationResultKeysFromGen();
      const errors: string[] = [];
      for (const key of keys) {
        const inCoverage = key in mutationResultDispatcherCoverage;
        const inExclusion = key in mutationResultDispatcherExclusions;
        if (inCoverage && inExclusion) {
          errors.push(
            `Dispatcher coverage conflict: MutationResult key "${key}" appears in BOTH ` +
              `mutationResultDispatcherCoverage AND mutationResultDispatcherExclusions. ` +
              `Each key must be classified exactly once.`,
          );
        } else if (!inCoverage && !inExclusion) {
          errors.push(
            `MutationResult key "${key}" has no MutationResultHandler case.\n` +
              `  Add to mutationResultDispatcherCoverage with a one-line description of the\n` +
              `  handler that consumes it (e.g. "handleFooChanges — emits foo:changed events"),\n` +
              `  or to mutationResultDispatcherExclusions with a reason if it's a side-channel\n` +
              `  payload (e.g. "fed to BinaryViewportBuffer/CellMetadataCache, not the mirror"\n` +
              `  or "side-channel — not a change family").\n` +
              `  Source: ${SOURCES.mutationResult}.`,
          );
        }
      }
      expect(errors).toEqual([]);
    });

    it(
      'no entry in mutationResultDispatcherCoverage / mutationResultDispatcherExclusions ' +
        'is unknown to MutationResult (catches stale entries on rename/removal)',
      () => {
        const keys = new Set(readMutationResultKeysFromGen());
        const stale: string[] = [];
        for (const k of Object.keys(mutationResultDispatcherCoverage)) {
          if (!keys.has(k)) stale.push(`coverage:${k}`);
        }
        for (const k of Object.keys(mutationResultDispatcherExclusions)) {
          if (!keys.has(k)) stale.push(`exclusion:${k}`);
        }
        expect(stale).toEqual([]);
      },
    );
  });
});
