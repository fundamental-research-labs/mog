/**
 * StateMirror — kernel unit tests.
 *
 * Pin the two invariants the state-mirror mirror plan calls out as load-bearing:
 *
 *   1. Every read getter returns the post-mutation value as soon as
 *      `apply(result)` resolves — no awaits.
 *
 *   2. Apply-then-emit ordering: `MutationResultHandler.applyAndNotify`
 *      runs `mirror.apply(result)` BEFORE any event emission. A subscriber
 *      reading the mirror inside the event handler must see the
 *      post-mutation value.
 *
 */

import { jest } from '@jest/globals';

import type { IEventBus } from '@mog-sdk/contracts/events';
import type {
  MutationResult,
  PageBreakChange,
  PrintAreaChange,
  PrintRange,
  PrintSettingsChange,
  PrintTitlesChange,
  ScrollPositionChange,
  SheetChange,
  SheetSettingsChange,
  SplitConfigChange,
  ViewSelectionChange,
  WorkbookSettingsChange,
} from '../../bridges/compute/compute-types.gen';
import { MutationResultHandler } from '../../bridges/mutation-result-handler';
import { StateMirror, createStateMirror } from '../state-mirror';

// =============================================================================
// Test fixtures
// =============================================================================

const SHEET_A = 'sheet-aaaa-0000-0000-0000-000000000001';
const SHEET_B = 'sheet-bbbb-0000-0000-0000-000000000002';

function createMockEventBus(): IEventBus & {
  emittedEvents: Array<{ type: string; [k: string]: unknown }>;
} {
  const emittedEvents: Array<{ type: string; [k: string]: unknown }> = [];
  return {
    emittedEvents,
    on: jest.fn(() => () => {}),
    off: jest.fn(),
    emit: jest.fn((event: { type: string }) => {
      emittedEvents.push(event as { type: string; [k: string]: unknown });
    }),
    once: jest.fn(() => () => {}),
  } as unknown as IEventBus & {
    emittedEvents: Array<{ type: string; [k: string]: unknown }>;
  };
}

function buildMutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return overrides as MutationResult;
}

// =============================================================================
// Empty mirror — defaults
// =============================================================================

describe('StateMirror — empty mirror returns defaults', () => {
  it('getFrozenPanes returns {0,0} for unknown sheet', () => {
    const mirror = createStateMirror();
    expect(mirror.getFrozenPanes(SHEET_A as never)).toEqual({ rows: 0, cols: 0 });
  });

  it('getPageBreaks returns empty arrays for unknown sheet', () => {
    const mirror = createStateMirror();
    expect(mirror.getPageBreaks(SHEET_A as never)).toEqual({ rowBreaks: [], colBreaks: [] });
  });

  it('getPrintArea returns null for unknown sheet', () => {
    const mirror = createStateMirror();
    expect(mirror.getPrintArea(SHEET_A as never)).toBeNull();
  });

  it('getSplitConfig returns null for unknown sheet', () => {
    const mirror = createStateMirror();
    expect(mirror.getSplitConfig(SHEET_A as never)).toBeNull();
  });

  it('getScrollPosition returns {0,0} for unknown sheet', () => {
    const mirror = createStateMirror();
    expect(mirror.getScrollPosition(SHEET_A as never)).toEqual({ topRow: 0, leftCol: 0 });
  });

  it('getViewSelection returns null for unknown sheet', () => {
    const mirror = createStateMirror();
    expect(mirror.getViewSelection(SHEET_A as never)).toBeNull();
  });

  it('getCulture returns the default workbook culture', () => {
    const mirror = createStateMirror();
    expect(typeof mirror.getCulture()).toBe('string');
    expect(mirror.getCulture().length).toBeGreaterThan(0);
  });

  it('lastVariant is null before any apply', () => {
    const mirror = createStateMirror();
    expect(mirror.lastVariant).toBeNull();
  });

  it('getSheetIds returns an empty list before any apply', () => {
    const mirror = createStateMirror();
    expect(mirror.getSheetIds()).toEqual([]);
  });
});

// =============================================================================
// Per-variant apply — sync read after apply
// =============================================================================

describe('StateMirror — sheet settings (view options + protection)', () => {
  it('applySheetSettingsChange stores the post-mutation snapshot', () => {
    const mirror = new StateMirror();
    const settings = {
      showGridlines: false,
      showRowHeaders: true,
      showColumnHeaders: true,
      isProtected: false,
      showZeroValues: true,
      rightToLeft: false,
      showFormulas: false,
      defaultRowHeight: 21,
      defaultColWidth: 100,
    };
    const change: SheetSettingsChange = {
      sheetId: SHEET_A,
      kind: 'Set',
      changedKey: 'showGridlines',
      settings,
    };
    mirror.applySheetSettingsChange(change);

    expect(mirror.getSheetSettings(SHEET_A as never).showGridlines).toBe(false);
    expect(mirror.lastVariant).toBe('settingsChanges');
  });

  it('getViewOptions derives `showZeros` from `showZeroValues` (key rename)', () => {
    const mirror = new StateMirror();
    mirror.applySheetSettingsChange({
      sheetId: SHEET_A,
      kind: 'Set',
      changedKey: 'showZeroValues',
      settings: {
        showGridlines: true,
        showRowHeaders: true,
        showColumnHeaders: true,
        isProtected: false,
        showZeroValues: false,
        rightToLeft: false,
        showFormulas: false,
        defaultRowHeight: 21,
        defaultColWidth: 100,
      },
    });
    expect(mirror.getViewOptions(SHEET_A as never).showZeros).toBe(false);
  });
});

describe('StateMirror — page breaks (snapshot replace)', () => {
  it('applyPageBreakChange stores the full per-sheet snapshot', () => {
    const mirror = new StateMirror();
    const change: PageBreakChange = {
      sheetId: SHEET_A,
      breaks: {
        rowBreaks: [{ id: 1, max: 100, manual: true, min: 0, pt: false }],
        colBreaks: [{ id: 2, max: 50, manual: false, min: 0, pt: true }],
      },
    };
    mirror.applyPageBreakChange(change);

    const stored = mirror.getPageBreaks(SHEET_A as never);
    expect(stored.rowBreaks).toHaveLength(1);
    expect(stored.colBreaks).toHaveLength(1);
    expect(stored.rowBreaks[0]).toMatchObject({ id: 1, max: 100, manual: true });
  });

  it('normalizes optional wire fields (`min` and `pt`) to required event-shape values', () => {
    const mirror = new StateMirror();
    mirror.applyPageBreakChange({
      sheetId: SHEET_A,
      // Wire shape skips zero `min` and false `pt` via `#[serde(skip_serializing_if)]`.
      breaks: {
        rowBreaks: [{ id: 1, max: 200, manual: false }],
        colBreaks: [],
      },
    } as PageBreakChange);

    const r = mirror.getPageBreaks(SHEET_A as never).rowBreaks[0];
    expect(r.min).toBe(0);
    expect(r.pt).toBe(false);
  });
});

describe('StateMirror — print area (Set / Removed)', () => {
  it('applyPrintAreaChange Set stores the area', () => {
    const mirror = new StateMirror();
    const area: PrintRange = { startRow: 0, startCol: 0, endRow: 9, endCol: 4 };
    mirror.applyPrintAreaChange({ sheetId: SHEET_A, kind: 'Set', area } as PrintAreaChange);
    expect(mirror.getPrintArea(SHEET_A as never)).toEqual(area);
  });

  it('applyPrintAreaChange Removed clears to null (not absent)', () => {
    const mirror = new StateMirror();
    mirror.applyPrintAreaChange({
      sheetId: SHEET_A,
      kind: 'Set',
      area: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
    } as PrintAreaChange);
    mirror.applyPrintAreaChange({ sheetId: SHEET_A, kind: 'Removed' } as PrintAreaChange);
    expect(mirror.getPrintArea(SHEET_A as never)).toBeNull();
  });
});

describe('StateMirror — print titles (snapshot replace)', () => {
  it('applyPrintTitlesChange stores the titles snapshot', () => {
    const mirror = new StateMirror();
    const change: PrintTitlesChange = {
      sheetId: SHEET_A,
      titles: { repeatRows: [0, 1] },
    };
    mirror.applyPrintTitlesChange(change);
    expect(mirror.getPrintTitles(SHEET_A as never).repeatRows).toEqual([0, 1]);
  });
});

describe('StateMirror — print settings (snapshot replace)', () => {
  it('applyPrintSettingsChange stores the settings snapshot', () => {
    const mirror = new StateMirror();
    const change: PrintSettingsChange = {
      sheetId: SHEET_A,
      settings: {
        paperSize: 9,
        orientation: 'portrait',
        scale: null,
        fitToWidth: null,
        fitToHeight: null,
        gridlines: true,
        headings: false,
        hCentered: false,
        vCentered: false,
        margins: null,
        headerFooter: null,
        blackAndWhite: false,
        draft: false,
        firstPageNumber: null,
        hasPrintOptions: true,
        useFirstPageNumber: false,
        hasPageSetup: true,
      },
    };
    mirror.applyPrintSettingsChange(change);
    expect(mirror.getPrintSettings(SHEET_A as never).gridlines).toBe(true);
  });

  it('normalizes wire shape to contract shape: cellComments→printComments + undefined→null', () => {
    const mirror = new StateMirror();
    // Wire shape (gen): `cellComments?: string`, plus several optional
    // fields that the contract requires as `T | null`. Build a wire-shape
    // payload exercising both axes.
    const wireSettings = {
      paperSize: 9,
      orientation: 'landscape',
      scale: null,
      fitToWidth: null,
      fitToHeight: null,
      gridlines: false,
      headings: false,
      hCentered: false,
      vCentered: false,
      margins: null,
      headerFooter: null,
      blackAndWhite: false,
      draft: false,
      firstPageNumber: null,
      // Optional-on-wire field is present.
      cellComments: 'atEnd',
      // Optional-on-wire fields are intentionally absent (undefined).
      // usePrinterDefaults / horizontalDpi / verticalDpi / rId / pageOrder /
      // printErrors are all omitted.
      hasPrintOptions: true,
      useFirstPageNumber: false,
      hasPageSetup: true,
    };
    mirror.applyPrintSettingsChange({
      sheetId: SHEET_A,
      settings: wireSettings,
    } as unknown as PrintSettingsChange);

    const got = mirror.getPrintSettings(SHEET_A as never);
    // Field rename: wire `cellComments` lands as contract `printComments`.
    expect(got.printComments).toBe('atEnd');
    // Optional-vs-nullable: undefined on the wire becomes explicit null.
    expect(got.usePrinterDefaults).toBeNull();
    expect(got.horizontalDpi).toBeNull();
    expect(got.verticalDpi).toBeNull();
    expect(got.rId).toBeNull();
    expect(got.pageOrder).toBeNull();
    expect(got.printErrors).toBeNull();
    // Sanity: scalar passthrough still works.
    expect(got.paperSize).toBe(9);
    expect(got.orientation).toBe('landscape');
  });
});

describe('StateMirror — split config (Set / Removed)', () => {
  it('applySplitConfigChange Set stores the config', () => {
    const mirror = new StateMirror();
    mirror.applySplitConfigChange({
      sheetId: SHEET_A,
      kind: 'Set',
      config: { direction: 'horizontal', horizontalPosition: 100, verticalPosition: 0 },
    } as SplitConfigChange);
    const cfg = mirror.getSplitConfig(SHEET_A as never);
    expect(cfg).not.toBeNull();
    expect(cfg!.direction).toBe('horizontal');
  });

  it('applySplitConfigChange Removed clears to null', () => {
    const mirror = new StateMirror();
    mirror.applySplitConfigChange({
      sheetId: SHEET_A,
      kind: 'Set',
      config: { direction: 'horizontal', horizontalPosition: 100, verticalPosition: 0 },
    } as SplitConfigChange);
    mirror.applySplitConfigChange({ sheetId: SHEET_A, kind: 'Removed' } as SplitConfigChange);
    expect(mirror.getSplitConfig(SHEET_A as never)).toBeNull();
  });
});

describe('StateMirror — scroll position', () => {
  it('applyScrollPositionChange stores the position', () => {
    const mirror = new StateMirror();
    const change: ScrollPositionChange = { sheetId: SHEET_A, topRow: 5, leftCol: 3 };
    mirror.applyScrollPositionChange(change);
    expect(mirror.getScrollPosition(SHEET_A as never)).toEqual({ topRow: 5, leftCol: 3 });
  });
});

describe('StateMirror — saved view selection', () => {
  it('applyViewSelectionChange stores a cloned selection snapshot', () => {
    const mirror = new StateMirror();
    const change: ViewSelectionChange = {
      sheetId: SHEET_A,
      activeCell: { row: 453, col: 35 },
      ranges: [{ startRow: 453, startCol: 35, endRow: 453, endCol: 35 }],
    };
    mirror.applyViewSelectionChange(change);

    const selection = mirror.getViewSelection(SHEET_A as never);
    expect(selection).toEqual({
      activeCell: { row: 453, col: 35 },
      ranges: [{ startRow: 453, startCol: 35, endRow: 453, endCol: 35 }],
    });
    selection!.activeCell.row = 0;
    selection!.ranges[0]!.startRow = 0;
    expect(mirror.getViewSelection(SHEET_A as never)).toEqual({
      activeCell: { row: 453, col: 35 },
      ranges: [{ startRow: 453, startCol: 35, endRow: 453, endCol: 35 }],
    });
  });
});

describe('StateMirror — workbook settings', () => {
  it('applyWorkbookSettingsChange stores settings; getCulture/getSelectedSheetIds derive', () => {
    const mirror = new StateMirror();
    const change: WorkbookSettingsChange = {
      kind: 'Set',
      changedKeys: ['culture', 'selectedSheetIds'],
      settings: {
        ...mirror.getWorkbookSettings(),
        culture: 'fr-FR',
        selectedSheetIds: [SHEET_A, SHEET_B],
      },
    };
    mirror.applyWorkbookSettingsChange(change);
    expect(mirror.getCulture()).toBe('fr-FR');
    expect(mirror.getSelectedSheetIds()).toEqual([SHEET_A, SHEET_B]);
  });

  it('getWorkbookSettings deep-clones nested settings and arrays', () => {
    const mirror = new StateMirror();
    const defaults = mirror.getWorkbookSettings();
    mirror.applyWorkbookSettingsChange({
      kind: 'Set',
      changedKeys: ['automaticConversionPolicy', 'selectedSheetIds'],
      settings: {
        ...defaults,
        selectedSheetIds: [SHEET_A],
        automaticConversionPolicy: {
          ...defaults.automaticConversionPolicy,
          convertDateLikeText: false,
        },
      },
    } as WorkbookSettingsChange);

    const firstRead = mirror.getWorkbookSettings();
    firstRead.selectedSheetIds!.push(SHEET_B as never);
    firstRead.automaticConversionPolicy.convertDateLikeText = true;

    const secondRead = mirror.getWorkbookSettings();
    expect(secondRead.selectedSheetIds).toEqual([SHEET_A]);
    expect(secondRead.automaticConversionPolicy.convertDateLikeText).toBe(false);
  });
});

describe('StateMirror — sheet metadata via SheetChange', () => {
  it('field=sheet,Set adds the sheet to getSheetIds', () => {
    const mirror = new StateMirror();
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'sheet',
      name: 'My Sheet',
      index: 0,
    } as SheetChange);
    expect(mirror.getSheetIds()).toEqual([SHEET_A]);
    expect(mirror.getSheetMeta(SHEET_A as never).name).toBe('My Sheet');
  });

  it('field=sheet,Removed drops the sheet from getSheetIds and clears its state', () => {
    const mirror = new StateMirror();
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'sheet',
      name: 'A',
      index: 0,
    } as SheetChange);
    mirror.applyScrollPositionChange({ sheetId: SHEET_A, topRow: 9, leftCol: 0 });

    mirror.applySheetChange({ sheetId: SHEET_A, kind: 'Removed', field: 'sheet' } as SheetChange);
    expect(mirror.getSheetIds()).toEqual([]);
    expect(mirror.getScrollPosition(SHEET_A as never)).toEqual({ topRow: 0, leftCol: 0 });
  });

  it('field=frozen updates both frozenPanes getter and sheetMeta.frozen', () => {
    const mirror = new StateMirror();
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'frozen',
      frozenRows: 2,
      frozenCols: 1,
    } as SheetChange);
    expect(mirror.getFrozenPanes(SHEET_A as never)).toEqual({ rows: 2, cols: 1 });
    expect(mirror.getSheetMeta(SHEET_A as never).frozen).toEqual({ rows: 2, cols: 1 });
  });

  it('field=name updates sheet meta name', () => {
    const mirror = new StateMirror();
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'sheet',
      name: 'Initial',
      index: 0,
    } as SheetChange);
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'name',
      name: 'Renamed',
      oldName: 'Initial',
    } as SheetChange);
    expect(mirror.getSheetMeta(SHEET_A as never).name).toBe('Renamed');
  });

  it('field=order moves the sheet in getSheetIds', () => {
    const mirror = new StateMirror();
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'sheet',
      name: 'A',
      index: 0,
    } as SheetChange);
    mirror.applySheetChange({
      sheetId: SHEET_B,
      kind: 'Set',
      field: 'sheet',
      name: 'B',
      index: 1,
    } as SheetChange);
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'order',
      oldIndex: 0,
      index: 1,
    } as SheetChange);
    expect(mirror.getSheetIds()).toEqual([SHEET_B, SHEET_A]);
  });
});

// =============================================================================
// apply(MutationResult) — single-call dispatch
// =============================================================================

describe('StateMirror.apply(MutationResult) — single-call dispatch', () => {
  it('dispatches sheet, settings, page-break, print-area, print-titles, print-settings, split, scroll, and workbook-settings', () => {
    const mirror = new StateMirror();
    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: SHEET_A,
          kind: 'Set',
          field: 'sheet',
          name: 'A',
          index: 0,
        } as SheetChange,
      ],
      settingsChanges: [
        {
          sheetId: SHEET_A,
          kind: 'Set',
          changedKey: 'showGridlines',
          settings: {
            showGridlines: false,
            showRowHeaders: true,
            showColumnHeaders: true,
            isProtected: false,
            showZeroValues: true,
            rightToLeft: false,
            showFormulas: false,
            defaultRowHeight: 21,
            defaultColWidth: 100,
          },
        },
      ],
      pageBreakChanges: [
        {
          sheetId: SHEET_A,
          breaks: {
            rowBreaks: [{ id: 1, max: 50, manual: true }],
            colBreaks: [],
          },
        } as PageBreakChange,
      ],
      printAreaChanges: [
        {
          sheetId: SHEET_A,
          kind: 'Set',
          area: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
        } as PrintAreaChange,
      ],
      scrollPositionChanges: [{ sheetId: SHEET_A, topRow: 7, leftCol: 2 }],
      viewSelectionChanges: [
        {
          sheetId: SHEET_A,
          activeCell: { row: 453, col: 35 },
          ranges: [{ startRow: 453, startCol: 35, endRow: 453, endCol: 35 }],
        },
      ],
    });

    mirror.apply(result);

    expect(mirror.getSheetIds()).toEqual([SHEET_A]);
    expect(mirror.getViewOptions(SHEET_A as never).showGridlines).toBe(false);
    expect(mirror.getPageBreaks(SHEET_A as never).rowBreaks).toHaveLength(1);
    expect(mirror.getPrintArea(SHEET_A as never)).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 4,
    });
    expect(mirror.getScrollPosition(SHEET_A as never)).toEqual({ topRow: 7, leftCol: 2 });
    expect(mirror.getViewSelection(SHEET_A as never)?.activeCell).toEqual({ row: 453, col: 35 });
  });

  it('apply on an empty result is a no-op', () => {
    const mirror = new StateMirror();
    expect(() => mirror.apply(buildMutationResult())).not.toThrow();
    expect(mirror.lastVariant).toBeNull();
  });

  // Hydration-shape regression — caught silently for one round before
  // xlsx-import-refresh exposed it. The Rust `build_mutation_result_for_hydration`
  // emits per-field SheetChanges (Name, Order, ...); only `field:'sheet',kind:'Set'`
  // populates `sheetOrder` via `insertIntoSheetOrder`. Without the canonical
  // creation event, `mirror.getSheetIds()` returns [] even though every other
  // family has data, and the chrome tab strip silently renders zero tabs.
  it('hydration-shape result populates getSheetIds via field:sheet creation event', () => {
    const mirror = new StateMirror();
    const result = buildMutationResult({
      sheetChanges: [
        // Canonical creation event — must come from the Rust hydration builder.
        { sheetId: SHEET_A, kind: 'Set', field: 'sheet', name: 'Sheet1', index: 0 } as SheetChange,
        { sheetId: SHEET_B, kind: 'Set', field: 'sheet', name: 'Sheet2', index: 1 } as SheetChange,
        // Per-field deltas — must NOT be sufficient on their own.
        { sheetId: SHEET_A, kind: 'Set', field: 'name', name: 'Sheet1' } as SheetChange,
        { sheetId: SHEET_A, kind: 'Set', field: 'order', index: 0 } as SheetChange,
      ],
    });
    mirror.apply(result);
    expect(mirror.getSheetIds()).toEqual([SHEET_A, SHEET_B]);
    expect(mirror.getSheetMeta(SHEET_A as never).name).toBe('Sheet1');
    expect(mirror.getSheetMeta(SHEET_B as never).name).toBe('Sheet2');
  });

  it('per-field name/order changes alone do NOT populate sheetOrder (proves field:sheet is required)', () => {
    const mirror = new StateMirror();
    mirror.apply(
      buildMutationResult({
        sheetChanges: [
          { sheetId: SHEET_A, kind: 'Set', field: 'name', name: 'Sheet1' } as SheetChange,
          { sheetId: SHEET_A, kind: 'Set', field: 'order', index: 0 } as SheetChange,
        ],
      }),
    );
    expect(mirror.getSheetIds()).toEqual([]);
  });
});

describe('StateMirror.reset', () => {
  it('clears all state', () => {
    const mirror = new StateMirror();
    mirror.applyScrollPositionChange({ sheetId: SHEET_A, topRow: 9, leftCol: 0 });
    mirror.applySheetChange({
      sheetId: SHEET_A,
      kind: 'Set',
      field: 'sheet',
      name: 'A',
      index: 0,
    } as SheetChange);

    mirror.reset();

    expect(mirror.getScrollPosition(SHEET_A as never)).toEqual({ topRow: 0, leftCol: 0 });
    expect(mirror.getSheetIds()).toEqual([]);
    expect(mirror.lastVariant).toBeNull();
  });
});

// =============================================================================
// Apply-then-emit ordering — Pillar 1 invariant
// =============================================================================

describe('MutationResultHandler — apply-then-emit ordering (Pillar 1)', () => {
  it('mirror is updated BEFORE any event is emitted (subscribers see post-mutation state)', () => {
    const mirror = new StateMirror();
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    handler.setStateMirror(mirror);

    // Pre-state: no frozen panes for sheet A.
    expect(mirror.getFrozenPanes(SHEET_A as never)).toEqual({ rows: 0, cols: 0 });

    // The event handler captures whatever the mirror reports at the moment
    // the event lands. If `mirror.apply` ran AFTER the emit, this would
    // observe the pre-mutation value (0,0). If apply ran BEFORE emit (the
    // intended Pillar 1 ordering), it observes the post-mutation value.
    let observedAtEmitTime: { rows: number; cols: number } | null = null;
    (eventBus.emit as jest.Mock).mockImplementation((event: { type: string }) => {
      if (event.type === 'freeze:changed') {
        observedAtEmitTime = mirror.getFrozenPanes(SHEET_A as never);
      }
      eventBus.emittedEvents.push(event as { type: string; [k: string]: unknown });
    });

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: SHEET_A,
          kind: 'Set',
          field: 'frozen',
          frozenRows: 3,
          frozenCols: 1,
          oldFrozenRows: 0,
          oldFrozenCols: 0,
        } as SheetChange,
      ],
    });

    handler.applyAndNotify(result);

    expect(observedAtEmitTime).not.toBeNull();
    expect(observedAtEmitTime).toEqual({ rows: 3, cols: 1 });
  });

  it('does not throw when no mirror is wired (test-only setup)', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    // Intentionally do NOT call setStateMirror — apply should be a no-op.

    expect(() => {
      handler.applyAndNotify(
        buildMutationResult({
          scrollPositionChanges: [{ sheetId: SHEET_A, topRow: 5, leftCol: 3 }],
        }),
      );
    }).not.toThrow();
  });

  it('global call-order: every mirror.apply precedes every eventBus.emit (multi-variant)', () => {
    // Pin the GLOBAL ordering invariant — not just two specific event
    // branches. A future refactor that moves `mirror.apply` below the
    // recalc/structure/dimension branches would make stale state visible
    // to any of those event handlers; this test catches that.
    const mirror = new StateMirror();
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    handler.setStateMirror(mirror);

    const callLog: string[] = [];

    // Spy on mirror.apply: log the call, then forward to the real impl
    // so getters update (otherwise downstream event handlers may throw
    // on missing state).
    const realApply = StateMirror.prototype.apply;
    jest.spyOn(mirror, 'apply').mockImplementation(((r) => {
      callLog.push('apply');
      realApply.call(mirror, r);
    }) as typeof mirror.apply);

    // Spy on emit: log the event type.
    (eventBus.emit as jest.Mock).mockImplementation((event: { type: string }) => {
      callLog.push(`emit:${event.type}`);
      eventBus.emittedEvents.push(event as { type: string; [k: string]: unknown });
    });

    handler.applyAndNotify(
      buildMutationResult({
        // Triggers freeze:changed.
        sheetChanges: [
          {
            sheetId: SHEET_A,
            kind: 'Set',
            field: 'frozen',
            frozenRows: 2,
            frozenCols: 1,
            oldFrozenRows: 0,
            oldFrozenCols: 0,
          } as SheetChange,
        ],
        // Triggers print:page-breaks-changed.
        pageBreakChanges: [
          {
            sheetId: SHEET_A,
            breaks: {
              rowBreaks: [{ id: 1, max: 100, manual: true }],
              colBreaks: [],
            },
          } as PageBreakChange,
        ],
        // Triggers workbook:settings-changed (or similar workbook event).
        workbookSettingsChanges: [
          {
            kind: 'Set',
            changedKeys: ['culture'],
            settings: { ...mirror.getWorkbookSettings(), culture: 'fr-FR' },
          } as WorkbookSettingsChange,
        ],
      }),
    );

    // Sanity: all three actors fired.
    const applyCount = callLog.filter((c) => c === 'apply').length;
    const emitCount = callLog.filter((c) => c.startsWith('emit:')).length;
    expect(applyCount).toBeGreaterThan(0);
    expect(emitCount).toBeGreaterThan(0);

    // Global invariant: every apply is at a smaller index than every emit.
    const lastApplyIdx = callLog.lastIndexOf('apply');
    const firstEmitIdx = callLog.findIndex((c) => c.startsWith('emit:'));
    expect(lastApplyIdx).toBeLessThan(firstEmitIdx);
    // And — for clarity — the very first entry is an apply.
    expect(callLog[0]).toBe('apply');
  });

  it('runs sheet runtime adapters after mirror apply and before sheet events', () => {
    const mirror = new StateMirror();
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    handler.setStateMirror(mirror);

    const callLog: string[] = [];
    const realApply = StateMirror.prototype.apply;
    jest.spyOn(mirror, 'apply').mockImplementation(((r) => {
      callLog.push('apply');
      realApply.call(mirror, r);
    }) as typeof mirror.apply);

    handler.registerSheetRuntimeAdapter('test', {
      captureContext: () => ({ beforeActive: SHEET_A as never, beforeActiveVisibleIndex: 0 }),
      apply: () => {
        callLog.push(`adapter:${mirror.getSheetIds().join(',')}`);
      },
    });

    (eventBus.emit as jest.Mock).mockImplementation((event: { type: string }) => {
      callLog.push(`emit:${event.type}`);
      eventBus.emittedEvents.push(event as { type: string; [k: string]: unknown });
    });

    handler.applyAndNotify(
      buildMutationResult({
        sheetChanges: [
          {
            sheetId: SHEET_A,
            kind: 'Set',
            field: 'sheet',
            name: 'Sheet A',
            index: 0,
          } as SheetChange,
        ],
      }),
    );

    expect(callLog).toEqual(['apply', `adapter:${SHEET_A}`, 'emit:sheet:created']);
  });

  it('apply runs before all per-variant handlers (page-break event sees post-mutation pageBreaks)', () => {
    const mirror = new StateMirror();
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    handler.setStateMirror(mirror);

    let observed: { rowBreaksCount: number; colBreaksCount: number } | null = null;
    (eventBus.emit as jest.Mock).mockImplementation((event: { type: string }) => {
      if (event.type === 'print:page-breaks-changed') {
        const pb = mirror.getPageBreaks(SHEET_A as never);
        observed = {
          rowBreaksCount: pb.rowBreaks.length,
          colBreaksCount: pb.colBreaks.length,
        };
      }
      eventBus.emittedEvents.push(event as { type: string; [k: string]: unknown });
    });

    handler.applyAndNotify(
      buildMutationResult({
        pageBreakChanges: [
          {
            sheetId: SHEET_A,
            breaks: {
              rowBreaks: [
                { id: 1, max: 100, manual: true },
                { id: 2, max: 200, manual: false },
              ],
              colBreaks: [{ id: 3, max: 50, manual: true }],
            },
          } as PageBreakChange,
        ],
      }),
    );

    expect(observed).toEqual({ rowBreaksCount: 2, colBreaksCount: 1 });
  });
});

// =============================================================================
// Blank-workbook bootstrap hydration parity
// =============================================================================

describe('StateMirror — blank-workbook hydration parity', () => {
  it('hydration-shape WorkbookSettingsChange replaces TS defaults (snapshot replace)', () => {
    const mirror = createStateMirror();

    // Before apply, mirror returns TS-side defaults.
    const before = mirror.getWorkbookSettings();
    expect(before).toBeDefined();

    // Apply a hydration-shape WorkbookSettingsChange from Rust.
    // Rust does NOT emit chartDataPointTrack (it has no such field).
    const rustWorkbookSettings = {
      showHorizontalScrollbar: true,
      showVerticalScrollbar: true,
      showTabStrip: true,
      culture: 'en-US',
    };
    mirror.apply(
      buildMutationResult({
        workbookSettingsChanges: [
          {
            kind: 'Set',
            changedKeys: Object.keys(rustWorkbookSettings),
            settings: rustWorkbookSettings,
          } as unknown as WorkbookSettingsChange,
        ],
      }),
    );

    const after = mirror.getWorkbookSettings();
    // chartDataPointTrack should be absent — snapshot-replace overwrites
    // the TS default entirely with Rust's shape.
    expect((after as Record<string, unknown>).chartDataPointTrack).toBeUndefined();
    expect(after.culture).toBe('en-US');
  });

  it('hydration-shape SheetSettingsChange replaces TS defaults', () => {
    const mirror = createStateMirror();

    // Apply a hydration-shape SheetSettingsChange.
    const rustSheetSettings = {
      showGridlines: true,
      showRowHeaders: true,
      showColumnHeaders: true,
      showFormulas: false,
      showZeroValues: true,
      rightToLeft: false,
      defaultRowHeight: 20,
      defaultColWidth: 64,
      isProtected: false,
    };
    mirror.apply(
      buildMutationResult({
        settingsChanges: [
          {
            sheetId: SHEET_A,
            kind: 'Set',
            changedKey: '*hydration*',
            settings: rustSheetSettings,
          } as unknown as SheetSettingsChange,
        ],
      }),
    );

    const settings = mirror.getSheetSettings(SHEET_A as never);
    // After hydration, mirror should have Rust's defaultColWidth (64),
    // not the TS platform default (72 on macOS).
    expect(settings.defaultColWidth).toBe(64);
    // showFormulas should be present from Rust's emit.
    expect((settings as Record<string, unknown>).showFormulas).toBe(false);
  });
});
