/**
 * Kernel state mirror — single sync read view of bounded direct workbook/sheet state.
 *
 * Owned by `DocumentContext`. Populated via the `MutationResult` channel
 * (initial hydration, local writes, undo/redo, snapshot replay, remote
 * collaboration) — same channel for every change source.
 *
 * Architectural rule (state mirror architecture):
 *
 *   The kernel state mirror is the sync read view for bounded canonical
 *   workbook/sheet state. `BinaryViewportBuffer` (BVB) remains the windowed
 *   sync read view for cell values. Together they cover the production
 *   read paths that must be synchronous on first frame.
 *
 * Direct vs derived:
 *   - In scope (this round): frozen panes, sheet view options, page breaks,
 *     print area / titles / settings, split config, scroll position, sheet
 *     metadata (name / order / hidden / tabColor / frozen), workbook
 *     settings (incl. culture, selectedSheetIds).
 *   - Out of scope: charts, pivots, slicers, filters, grouping aggregates,
 *     formula-autocomplete catalogs. Those need kernel-owned projections
 *     before they can leave the async path cleanly.
 *
 * Apply-vs-emit ordering:
 *   `MutationResultHandler.applyAndNotify` calls `mirror.apply(result)`
 *   FIRST, then proceeds with all per-variant event emissions. Hooks that
 *   re-render in response to those events must therefore see post-mutation
 *   state on their first re-read. Pinned by a kernel unit test.
 *
 * Package-private apply:
 *   The writable `StateMirror` class is constructor-injected into
 *   `MutationResultHandler` and never reachable through `DocumentContext`.
 *   Public consumers see only `MirrorReadView` (sync getters). The
 *   ESLint rule `no-mirror-apply-outside-handler` is the second layer
 *   that catches casts and type-assertion escapes.
 *
 */

import type {
  MirrorFrozenPanes,
  MirrorPageBreaks,
  MirrorReadView,
  MirrorScrollPosition,
  MirrorSheetMeta,
  MirrorSplitConfig,
} from '@mog-sdk/contracts/api';
import {
  sheetId as toSheetId,
  type PrintSettings,
  type SheetId,
  type SheetSettings,
  type SheetViewOptions,
  type WorkbookSettings,
} from '@mog-sdk/contracts/core';
import type { PrintRange, PrintTitles } from '@mog-sdk/contracts/events';
import type {
  MutationResult,
  PageBreakChange,
  PrintAreaChange,
  PrintSettings as WirePrintSettings,
  PrintSettingsChange,
  PrintTitlesChange,
  ScrollPositionChange,
  SheetChange,
  SheetSettingsChange,
  SplitConfigChange,
  WorkbookSettingsChange,
} from '../bridges/compute/compute-types.gen';
import {
  DEFAULT_SHEET_PRINT_SETTINGS,
  DEFAULT_SHEET_SETTINGS,
  DEFAULT_WORKBOOK_SETTINGS,
} from '../domain/workbook/core-defaults';

// Re-export the public types under their kernel-internal aliases so that
// existing kernel consumers (e.g. tests, `kernel/src/document/index.ts`)
// keep their import paths stable while the canonical contract types live
// in `@mog-sdk/contracts/api`.
export type {
  MirrorReadView,
  MirrorFrozenPanes as FrozenPanes,
  MirrorScrollPosition as ScrollPosition,
  MirrorSheetMeta as SheetMetaSnapshot,
};

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_FROZEN_PANES: MirrorFrozenPanes = Object.freeze({ rows: 0, cols: 0 });
const DEFAULT_PAGE_BREAKS: MirrorPageBreaks = Object.freeze({
  rowBreaks: [] as MirrorPageBreaks['rowBreaks'],
  colBreaks: [] as MirrorPageBreaks['colBreaks'],
}) as MirrorPageBreaks;
const DEFAULT_PRINT_TITLES: PrintTitles = Object.freeze({}) as PrintTitles;
const DEFAULT_SCROLL_POSITION: MirrorScrollPosition = Object.freeze({ topRow: 0, leftCol: 0 });

const DEFAULT_SHEET_META: MirrorSheetMeta = Object.freeze({
  name: null,
  order: null,
  hidden: false,
  tabColor: null,
  frozen: DEFAULT_FROZEN_PANES,
});

// =============================================================================
// StateMirror — writable implementation
// =============================================================================

/**
 * Writable kernel state mirror. Holds the full surface (read + apply).
 * Constructor-injected into `MutationResultHandler`; never reachable
 * through `DocumentContext` (which sees only `MirrorReadView`).
 */
export class StateMirror implements MirrorReadView {
  // Per-sheet stores — singleton-style: always one value per sheet, defaulted on read miss.
  private readonly frozenPanesBySheet = new Map<string, MirrorFrozenPanes>();
  private readonly settingsBySheet = new Map<string, SheetSettings>();
  private readonly pageBreaksBySheet = new Map<string, MirrorPageBreaks>();
  private readonly printAreaBySheet = new Map<string, PrintRange | null>();
  private readonly printTitlesBySheet = new Map<string, PrintTitles>();
  private readonly printSettingsBySheet = new Map<string, PrintSettings>();
  private readonly splitConfigBySheet = new Map<string, MirrorSplitConfig | null>();
  private readonly scrollPositionBySheet = new Map<string, MirrorScrollPosition>();
  private readonly sheetMetaBySheet = new Map<string, MirrorSheetMeta>();

  // Sheet ordering — kept in insertion order; `field: 'order'` reorders.
  private sheetOrder: SheetId[] = [];

  // Workbook-scoped singleton.
  private workbookSettings: WorkbookSettings = cloneWorkbookDefaults();

  // Doctor breadcrumb.
  private _lastVariant: string | null = null;

  // ---------------------------------------------------------------------------
  // MirrorReadView — sheet-scoped getters
  // ---------------------------------------------------------------------------

  getFrozenPanes(sheetId: SheetId): MirrorFrozenPanes {
    return this.frozenPanesBySheet.get(sheetId as unknown as string) ?? DEFAULT_FROZEN_PANES;
  }

  getSheetSettings(sheetId: SheetId): SheetSettings {
    return this.settingsBySheet.get(sheetId as unknown as string) ?? DEFAULT_SHEET_SETTINGS;
  }

  getViewOptions(sheetId: SheetId): SheetViewOptions {
    const s = this.getSheetSettings(sheetId);
    // SheetSettings uses `showZeroValues`; SheetViewOptions uses `showZeros`.
    return {
      showGridlines: s.showGridlines,
      showRowHeaders: s.showRowHeaders,
      showColumnHeaders: s.showColumnHeaders,
      rightToLeft: s.rightToLeft,
      showFormulas: s.showFormulas,
      showZeros: s.showZeroValues,
      ...(s.zoomScale !== undefined ? { zoomScale: s.zoomScale } : {}),
    };
  }

  getPageBreaks(sheetId: SheetId): MirrorPageBreaks {
    return this.pageBreaksBySheet.get(sheetId as unknown as string) ?? DEFAULT_PAGE_BREAKS;
  }

  getPrintArea(sheetId: SheetId): PrintRange | null {
    return this.printAreaBySheet.get(sheetId as unknown as string) ?? null;
  }

  getPrintTitles(sheetId: SheetId): PrintTitles {
    return this.printTitlesBySheet.get(sheetId as unknown as string) ?? DEFAULT_PRINT_TITLES;
  }

  getPrintSettings(sheetId: SheetId): PrintSettings {
    return (
      this.printSettingsBySheet.get(sheetId as unknown as string) ?? DEFAULT_SHEET_PRINT_SETTINGS
    );
  }

  getSplitConfig(sheetId: SheetId): MirrorSplitConfig | null {
    return this.splitConfigBySheet.get(sheetId as unknown as string) ?? null;
  }

  getScrollPosition(sheetId: SheetId): MirrorScrollPosition {
    return this.scrollPositionBySheet.get(sheetId as unknown as string) ?? DEFAULT_SCROLL_POSITION;
  }

  getSheetMeta(sheetId: SheetId): MirrorSheetMeta {
    return this.sheetMetaBySheet.get(sheetId as unknown as string) ?? DEFAULT_SHEET_META;
  }

  // ---------------------------------------------------------------------------
  // MirrorReadView — workbook-scoped getters
  //
  // Read contract: getters return cloned/snapshot data. Callers may mutate
  // the returned objects/arrays freely without affecting mirror state. The
  // mirror itself takes a fresh full snapshot on every apply, so a clone
  // on read is the cheap, predictable boundary for consumers (especially
  // under React 18 concurrent rendering, where a returned array could be
  // iterated mid-mutation if shared by reference).
  //
  // WorkbookSettings contains nested policy/options objects and arrays.
  // Deep-clone so callers cannot mutate mirror-owned state through a getter.
  // ---------------------------------------------------------------------------

  getWorkbookSettings(): WorkbookSettings {
    return cloneWorkbookSettings(this.workbookSettings);
  }

  getCulture(): string {
    return this.workbookSettings.culture;
  }

  getSelectedSheetIds(): readonly SheetId[] {
    // WorkbookSettings.selectedSheetIds is typed as `string[] | undefined`
    // upstream; SheetId is a branded string. The two-step cast through
    // `unknown` is intentional — the array carries sheet ids by contract,
    // and the brand exists only in the type system. Clone-on-read so a
    // consumer can't mutate the mirror's internal array in place.
    return [...(this.workbookSettings.selectedSheetIds ?? [])] as unknown as readonly SheetId[];
  }

  getSheetIds(): readonly SheetId[] {
    // Clone-on-read: a returned reference would otherwise be unsafe to
    // iterate across a React 18 concurrent render if a `sheetChanges`
    // apply mutated `sheetOrder` mid-iteration.
    return [...this.sheetOrder];
  }

  get lastVariant(): string | null {
    return this._lastVariant;
  }

  // ---------------------------------------------------------------------------
  // Apply API — package-private (constructor-injected into MutationResultHandler)
  //
  // The single entry point is `apply(result)`; per-variant methods are the
  // dispatch targets. They are public on the concrete class so the handler
  // and tests can call them directly, but they are NOT exposed through
  // `MirrorReadView`. The ESLint rule `no-mirror-apply-outside-handler`
  // is the second layer that catches casts.
  // ---------------------------------------------------------------------------

  /**
   * Single dispatch entry — applies every in-scope `MutationResult` variant
   * to the mirror. Called by `MutationResultHandler.applyAndNotify` BEFORE
   * any event emission. Idempotent for snapshot-replace variants
   * (page breaks, print titles/settings, scroll position).
   */
  apply(result: MutationResult): void {
    if (result.sheetChanges?.length) {
      let hasSnapshotOrderChange = false;
      for (const c of result.sheetChanges) {
        this.applySheetChange(c);
        if (c.field === 'order' && c.oldIndex === undefined && c.index !== undefined) {
          hasSnapshotOrderChange = true;
        }
      }
      if (hasSnapshotOrderChange) {
        this.rebuildSheetOrderFromMeta();
      }
    }
    if (result.settingsChanges?.length) {
      for (const c of result.settingsChanges) this.applySheetSettingsChange(c);
    }
    if (result.pageBreakChanges?.length) {
      for (const c of result.pageBreakChanges) this.applyPageBreakChange(c);
    }
    if (result.printAreaChanges?.length) {
      for (const c of result.printAreaChanges) this.applyPrintAreaChange(c);
    }
    if (result.printTitlesChanges?.length) {
      for (const c of result.printTitlesChanges) this.applyPrintTitlesChange(c);
    }
    if (result.printSettingsChanges?.length) {
      for (const c of result.printSettingsChanges) this.applyPrintSettingsChange(c);
    }
    if (result.splitConfigChanges?.length) {
      for (const c of result.splitConfigChanges) this.applySplitConfigChange(c);
    }
    if (result.scrollPositionChanges?.length) {
      for (const c of result.scrollPositionChanges) this.applyScrollPositionChange(c);
    }
    if (result.workbookSettingsChanges?.length) {
      for (const c of result.workbookSettingsChanges) this.applyWorkbookSettingsChange(c);
    }
  }

  applySheetChange(change: SheetChange): void {
    this._lastVariant = 'sheetChanges';
    const sid = change.sheetId;

    switch (change.field) {
      case 'sheet':
        if (change.kind === 'Set') {
          // Create or copy. Track in order at the requested index, or append.
          const meta = this.getOrCreateSheetMeta(sid);
          if (change.name !== undefined) meta.name = change.name;
          if (change.index !== undefined) meta.order = change.index;
          this.insertIntoSheetOrder(toSheetId(sid), change.index ?? this.sheetOrder.length);
        } else {
          // Removed: drop everything we know about this sheet.
          this.dropSheet(sid);
        }
        return;

      case 'name': {
        const meta = this.getOrCreateSheetMeta(sid);
        meta.name = change.name ?? meta.name;
        return;
      }

      case 'order': {
        const meta = this.getOrCreateSheetMeta(sid);
        if (change.index !== undefined) meta.order = change.index;
        if (change.oldIndex !== undefined && change.index !== undefined) {
          this.moveInSheetOrder(toSheetId(sid), change.oldIndex, change.index);
        }
        return;
      }

      case 'hidden':
      case 'visibility': {
        const meta = this.getOrCreateSheetMeta(sid);
        meta.hidden = change.hidden ?? meta.hidden;
        return;
      }

      case 'tabColor': {
        const meta = this.getOrCreateSheetMeta(sid);
        meta.tabColor = change.color ?? null;
        return;
      }

      case 'frozen': {
        const frozen: MirrorFrozenPanes = {
          rows: change.frozenRows ?? 0,
          cols: change.frozenCols ?? 0,
        };
        this.frozenPanesBySheet.set(sid, frozen);
        const meta = this.getOrCreateSheetMeta(sid);
        meta.frozen = frozen;
        return;
      }

      case 'enableCalculation':
        // Out of scope for the mirror — skip.
        return;
    }
  }

  applySheetSettingsChange(change: SheetSettingsChange): void {
    this._lastVariant = 'settingsChanges';
    // Rust ships the post-mutation full SheetSettings snapshot. For both
    // `Set` (single-key change carries full snapshot) and `Removed`
    // (logically "reset key to default" — full snapshot still arrives),
    // store the snapshot.
    const settings = change.settings as SheetSettings;
    this.settingsBySheet.set(change.sheetId, settings);
  }

  applyPageBreakChange(change: PageBreakChange): void {
    this._lastVariant = 'pageBreakChanges';
    // PageBreakChange carries the full per-sheet snapshot (no kind, no per-id delta).
    // Normalize the wire shape: `min` skipped when zero, `pt` skipped when false.
    const normalize = (b: {
      id: number;
      min?: number;
      max: number;
      manual: boolean;
      pt?: boolean;
    }): { id: number; min: number; max: number; manual: boolean; pt: boolean } => ({
      id: b.id,
      min: b.min ?? 0,
      max: b.max,
      manual: b.manual,
      pt: b.pt ?? false,
    });
    const breaks: MirrorPageBreaks = {
      rowBreaks: (change.breaks.rowBreaks ?? []).map(normalize),
      colBreaks: (change.breaks.colBreaks ?? []).map(normalize),
    };
    this.pageBreaksBySheet.set(change.sheetId, breaks);
  }

  applyPrintAreaChange(change: PrintAreaChange): void {
    this._lastVariant = 'printAreaChanges';
    // `Set` with area → set; `Set` without area or `Removed` → null (clear).
    if (change.kind === 'Set' && change.area) {
      this.printAreaBySheet.set(change.sheetId, change.area);
    } else {
      this.printAreaBySheet.set(change.sheetId, null);
    }
  }

  applyPrintTitlesChange(change: PrintTitlesChange): void {
    this._lastVariant = 'printTitlesChanges';
    // Wire-shape (gen) PrintTitles vs contract PrintTitles: structurally
    // identical (`repeatRows?: [number, number]; repeatCols?: [number, number]`),
    // but TypeScript treats them as nominally distinct. Cast at the bridge boundary.
    this.printTitlesBySheet.set(change.sheetId, change.titles as unknown as PrintTitles);
  }

  applyPrintSettingsChange(change: PrintSettingsChange): void {
    this._lastVariant = 'printSettingsChanges';
    // Wire shape (gen) ≠ contract shape on three axes:
    //   1. Field rename: wire `cellComments` → contract `printComments`.
    //   2. Optional-vs-nullable: wire emits `field?: T` (omitted = absent),
    //      contract requires `field: T | null` (explicit null sentinel).
    //      Affects: pageOrder, usePrinterDefaults, horizontalDpi, verticalDpi,
    //      rId, printErrors, and the renamed printComments.
    // Without normalization, `as unknown as PrintSettings` would leave
    // `printComments` permanently `undefined` and the optional-but-nullable
    // fields permanently `undefined` instead of `null`, breaking any
    // consumer that distinguishes the two. Same bridge-boundary pattern
    // used by `applyPageBreakChange` for its `min`/`pt` skip-defaults.
    this.printSettingsBySheet.set(change.sheetId, normalizePrintSettings(change.settings));
  }

  applySplitConfigChange(change: SplitConfigChange): void {
    this._lastVariant = 'splitConfigChanges';
    if (change.kind === 'Set' && change.config) {
      // Wire-shape SplitViewConfig (gen) vs MirrorSplitConfig: identical fields
      // (direction / horizontalPosition / verticalPosition); cast at boundary.
      this.splitConfigBySheet.set(change.sheetId, change.config as unknown as MirrorSplitConfig);
    } else {
      this.splitConfigBySheet.set(change.sheetId, null);
    }
  }

  applyScrollPositionChange(change: ScrollPositionChange): void {
    this._lastVariant = 'scrollPositionChanges';
    this.scrollPositionBySheet.set(change.sheetId, {
      topRow: change.topRow,
      leftCol: change.leftCol,
    });
  }

  applyWorkbookSettingsChange(change: WorkbookSettingsChange): void {
    this._lastVariant = 'workbookSettingsChanges';
    // WorkbookSettingsChange carries a full Rust-owned settings snapshot.
    // Replace instead of merging so TS-only defaults do not survive hydration
    // and diverge from ctx.computeBridge.getWorkbookSettings().
    this.workbookSettings = cloneWorkbookSettings(change.settings as WorkbookSettings);
  }

  /**
   * Reset all mirror state.
   *
   * Called by tests to recycle a mirror between scenarios. Production
   * lifecycle never calls this — both document close/open and trap-recovery
   * tear down `DocumentContext` (and the mirror with it) and instantiate
   * a fresh one via `createStateMirror()`. Retained as a future-proofing
   * hook in case a path appears that must reuse the same mirror instance.
   *
   * @internal — not part of `MirrorReadView`; only the writable
   * `StateMirror` class exposes it.
   */
  reset(): void {
    this.frozenPanesBySheet.clear();
    this.settingsBySheet.clear();
    this.pageBreaksBySheet.clear();
    this.printAreaBySheet.clear();
    this.printTitlesBySheet.clear();
    this.printSettingsBySheet.clear();
    this.splitConfigBySheet.clear();
    this.scrollPositionBySheet.clear();
    this.sheetMetaBySheet.clear();
    this.sheetOrder = [];
    this.workbookSettings = cloneWorkbookDefaults();
    this._lastVariant = null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getOrCreateSheetMeta(sheetId: string): MirrorSheetMeta {
    let meta = this.sheetMetaBySheet.get(sheetId);
    if (!meta) {
      meta = { ...DEFAULT_SHEET_META };
      this.sheetMetaBySheet.set(sheetId, meta);
    }
    return meta;
  }

  private dropSheet(sheetId: string): void {
    this.frozenPanesBySheet.delete(sheetId);
    this.settingsBySheet.delete(sheetId);
    this.pageBreaksBySheet.delete(sheetId);
    this.printAreaBySheet.delete(sheetId);
    this.printTitlesBySheet.delete(sheetId);
    this.printSettingsBySheet.delete(sheetId);
    this.splitConfigBySheet.delete(sheetId);
    this.scrollPositionBySheet.delete(sheetId);
    this.sheetMetaBySheet.delete(sheetId);
    const idx = this.sheetOrder.indexOf(toSheetId(sheetId));
    if (idx >= 0) this.sheetOrder.splice(idx, 1);
  }

  private insertIntoSheetOrder(sheetId: SheetId, index: number): void {
    // De-dupe: if the sheet is already tracked, leave it where it is rather
    // than double-inserting (hydration may emit a `Set` for sheets the
    // mirror already saw via cached state during a recovery cycle).
    if (this.sheetOrder.includes(sheetId)) return;
    const clamped = Math.min(Math.max(index, 0), this.sheetOrder.length);
    this.sheetOrder.splice(clamped, 0, sheetId);
  }

  private moveInSheetOrder(sheetId: SheetId, _oldIndex: number, newIndex: number): void {
    const cur = this.sheetOrder.indexOf(sheetId);
    if (cur < 0) return;
    this.sheetOrder.splice(cur, 1);
    const clamped = Math.min(Math.max(newIndex, 0), this.sheetOrder.length);
    this.sheetOrder.splice(clamped, 0, sheetId);
  }

  // Snapshot-replace: sort sheetOrder by the meta.order values that were
  // already updated by applySheetChange. Used when Order changes arrive
  // without oldIndex (observer-translated undo/redo/sync).
  private rebuildSheetOrderFromMeta(): void {
    this.sheetOrder.sort((a, b) => {
      const oa = this.sheetMetaBySheet.get(a as string)?.order ?? 0;
      const ob = this.sheetMetaBySheet.get(b as string)?.order ?? 0;
      return oa - ob;
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Construct a fresh kernel state mirror. The mirror starts empty — every
 * read returns the corresponding default until a `MutationResult` populates
 * the field. Hydration's first `MutationResult` (per `mutation-result-coverage-rust.md`,
 * commit `8747f39e3`) covers every in-scope field so first paint is correct.
 */
export function createStateMirror(): StateMirror {
  return new StateMirror();
}

// =============================================================================
// Internal: defensive clone of WorkbookSettings defaults
// =============================================================================

function cloneWorkbookDefaults(): WorkbookSettings {
  return cloneWorkbookSettings(DEFAULT_WORKBOOK_SETTINGS);
}

function cloneWorkbookSettings(settings: WorkbookSettings): WorkbookSettings {
  return clonePlainData(settings);
}

function clonePlainData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainData(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = clonePlainData(child);
    }
    return clone as T;
  }
  return value;
}

// =============================================================================
// Internal: bridge-boundary normalizer for PrintSettings
// =============================================================================

/**
 * Wire shape (`PrintSettings` in `compute-types.gen.ts`) ≠ contract shape
 * (`PrintSettings` in `@mog-sdk/contracts/core`) on:
 *
 *   - Field rename: wire `cellComments` → contract `printComments`.
 *   - Optional-vs-nullable: wire emits `field?: T` (omitted on the wire
 *     when serde skips the field), contract requires `field: T | null`
 *     (an explicit null sentinel). Affects `pageOrder`, `usePrinterDefaults`,
 *     `horizontalDpi`, `verticalDpi`, `rId`, `printErrors`, and the
 *     renamed `printComments`.
 *
 * Reconcile both at the bridge boundary so consumers reading off
 * `MirrorReadView.getPrintSettings(sheetId)` always see the contract
 * shape — same pattern `applyPageBreakChange` uses for its `min`/`pt`
 * skip-defaults.
 */
function normalizePrintSettings(wire: WirePrintSettings): PrintSettings {
  return {
    paperSize: wire.paperSize,
    paperWidth: wire.paperWidth ?? null,
    paperHeight: wire.paperHeight ?? null,
    orientation: wire.orientation,
    scale: wire.scale,
    fitToWidth: wire.fitToWidth,
    fitToHeight: wire.fitToHeight,
    gridlines: wire.gridlines,
    gridLinesSet: wire.gridLinesSet ?? true,
    headings: wire.headings,
    hCentered: wire.hCentered,
    vCentered: wire.vCentered,
    margins: wire.margins as PrintSettings['margins'],
    headerFooter: wire.headerFooter as PrintSettings['headerFooter'],
    blackAndWhite: wire.blackAndWhite,
    draft: wire.draft,
    firstPageNumber: wire.firstPageNumber,
    pageOrder: wire.pageOrder ?? null,
    usePrinterDefaults: wire.usePrinterDefaults ?? null,
    horizontalDpi: wire.horizontalDpi ?? null,
    verticalDpi: wire.verticalDpi ?? null,
    rId: wire.rId ?? null,
    hasPrintOptions: wire.hasPrintOptions,
    hasPageSetup: wire.hasPageSetup,
    copies: wire.copies ?? null,
    pageSetupProperties: wire.pageSetupProperties ?? null,
    useFirstPageNumber: wire.useFirstPageNumber,
    printComments: wire.cellComments ?? null,
    printErrors: wire.printErrors ?? null,
  };
}
