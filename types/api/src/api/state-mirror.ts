/**
 * Public types for the kernel state mirror's read view.
 *
 * The mirror is the single sync read view of bounded direct workbook/sheet
 * state — frozen panes, view options, page breaks, print area / titles /
 * settings, split config, scroll position, sheet metadata, workbook
 * settings. Implementation lives in `kernel/src/document/state-mirror.ts`.
 *
 * Apps and shell consumers see only `MirrorReadView` (sync getters). The
 * writable `StateMirror` is constructor-injected into
 * `MutationResultHandler` and never reachable through the public surface.
 *
 */

import type {
  CellRange,
  PrintSettings,
  SheetId,
  SheetSettings,
  SheetViewOptions,
  WorkbookSettings,
} from '@mog/types-core/core';
import type { PrintRange, PrintTitles } from '@mog/types-events/print-events';

// =============================================================================
// Mirror-local value types (declared here so types-api stays self-contained)
// =============================================================================

/** Frozen panes for a single sheet. */
export interface MirrorFrozenPanes {
  rows: number;
  cols: number;
}

/** Top-left scroll position for a single sheet (in cell coordinates). */
export interface MirrorScrollPosition {
  topRow: number;
  leftCol: number;
}

/** Saved sheet view selection for initial runtime restoration. */
export interface MirrorViewSelection {
  activeCell: { row: number; col: number };
  ranges: CellRange[];
}

/**
 * Single page break entry (row or col axis). Mirrors the post-bridge event
 * shape: required `min`/`pt` (the wire-side serde shape skips zero/false
 * defaults; the bridge boundary normalizes them).
 */
export interface MirrorPageBreakEntry {
  id: number;
  min: number;
  max: number;
  manual: boolean;
  pt: boolean;
}

/** Per-sheet page-break snapshot. */
export interface MirrorPageBreaks {
  rowBreaks: MirrorPageBreakEntry[];
  colBreaks: MirrorPageBreakEntry[];
}

/** Sheet split-view configuration. */
export interface MirrorSplitConfig {
  direction: 'horizontal' | 'vertical' | 'both';
  horizontalPosition: number;
  verticalPosition: number;
}

/**
 * Per-sheet metadata snapshot — name, ordering, visibility, color, frozen
 * panes. Maintained by `SheetChange` events; `null` means "not yet
 * populated by any event for this sheet."
 */
export interface MirrorSheetMeta {
  name: string | null;
  /** Display index (0-based). null until a `field: 'order'` event lands or hydration runs. */
  order: number | null;
  hidden: boolean;
  tabColor: string | null;
  frozen: MirrorFrozenPanes;
}

// =============================================================================
// MirrorReadView
// =============================================================================

/**
 * Read-only view of the kernel state mirror. All getters are synchronous —
 * this is the contract that lets shell code (renderer, hooks at
 * `useState(...)` initializer time, machines in actions) read direct
 * workbook/sheet state without round-tripping Rust.
 *
 * For singleton sheet-scoped fields, the mirror always returns a value
 * (default if the field hasn't been populated yet). The `Removed`
 * semantics in the `MutationResult` channel collapse to "reset to default"
 * for these fields, so the mirror never holds an absent state.
 */
export interface MirrorReadView {
  // ---------- Sheet-scoped getters ----------

  getFrozenPanes(sheetId: SheetId): MirrorFrozenPanes;
  /** Full SheetSettings record (includes view options + protection + dimensions). */
  getSheetSettings(sheetId: SheetId): SheetSettings;
  /** SheetViewOptions facet — derived from getSheetSettings(). */
  getViewOptions(sheetId: SheetId): SheetViewOptions;
  getPageBreaks(sheetId: SheetId): MirrorPageBreaks;
  getPrintArea(sheetId: SheetId): PrintRange | null;
  getPrintTitles(sheetId: SheetId): PrintTitles;
  getPrintSettings(sheetId: SheetId): PrintSettings;
  getSplitConfig(sheetId: SheetId): MirrorSplitConfig | null;
  getScrollPosition(sheetId: SheetId): MirrorScrollPosition;
  getViewSelection(sheetId: SheetId): MirrorViewSelection | null;
  /** Sheet metadata (name, order, hidden, tabColor, frozen). */
  getSheetMeta(sheetId: SheetId): MirrorSheetMeta;

  // ---------- Workbook-scoped getters ----------

  getWorkbookSettings(): WorkbookSettings;
  /** Convenience accessor — `getWorkbookSettings().culture`. */
  getCulture(): string;
  /** Convenience accessor — `getWorkbookSettings().selectedSheetIds ?? []`. */
  getSelectedSheetIds(): readonly SheetId[];
  /**
   * Ordered list of sheet ids the mirror currently knows about. Maintained
   * by SheetChange events: lifecycle (`field: 'sheet'`) and reordering
   * (`field: 'order'`).
   */
  getSheetIds(): readonly SheetId[];

  // ---------- Diagnostics ----------

  /**
   * Last `MutationResult` family the mirror processed (e.g.
   * `'sheetChanges'`, `'pageBreakChanges'`). null until the first apply.
   * Recorded so the doctor invariant's "mirror disagrees with Rust"
   * failures can name the branch most likely responsible.
   */
  readonly lastVariant: string | null;
}
