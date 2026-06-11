/**
 * Tests for WorksheetPrintImpl — print title methods.
 *
 * Verifies setPrintTitleRows, setPrintTitleColumns, getPrintTitleRows,
 * getPrintTitleColumns, and clearPrintTitles behave correctly, including
 * merge behavior (setting rows preserves existing cols and vice versa).
 */

import { jest } from '@jest/globals';

import { sheetId, type PrintSettings, type SheetId } from '@mog-sdk/contracts/core';
import { WorksheetPrintImpl } from '../../../src/api/worksheet/print';
import type { DocumentContext } from '../../../src/context/types';
import { DEFAULT_SHEET_PRINT_SETTINGS } from '../../../src/domain/workbook/core-defaults';

// =============================================================================
// Mock helpers
// =============================================================================

type PrintTitles = {
  repeatRows?: [number, number];
  repeatCols?: [number, number];
};

/** In-memory stores keyed by sheetId. */
const printTitlesStore = new Map<string, PrintTitles>();
const printSettingsStore = new Map<string, Record<string, any>>();

function makePrintSettings(overrides?: Record<string, any>): PrintSettings {
  return { ...DEFAULT_SHEET_PRINT_SETTINGS, ...(overrides ?? {}) } as PrintSettings;
}

function applyPrintTitlesPatch(sheetId: SheetId, patch: PrintTitles): void {
  const next = { ...(printTitlesStore.get(sheetId) ?? {}) };

  if ('repeatRows' in patch) {
    if (patch.repeatRows === undefined) {
      delete next.repeatRows;
    } else {
      next.repeatRows = patch.repeatRows;
    }
  }
  if ('repeatCols' in patch) {
    if (patch.repeatCols === undefined) {
      delete next.repeatCols;
    } else {
      next.repeatCols = patch.repeatCols;
    }
  }

  if (next.repeatRows === undefined && next.repeatCols === undefined) {
    printTitlesStore.delete(sheetId);
  } else {
    printTitlesStore.set(sheetId, next);
  }
}

function createMockContext(): DocumentContext {
  return {
    computeBridge: {
      getPrintTitles: jest.fn(async (sheetId: SheetId) => {
        return printTitlesStore.get(sheetId) ?? {};
      }),
      setPrintTitles: jest.fn(async (sheetId: SheetId, titles: PrintTitles) => {
        applyPrintTitlesPatch(sheetId, titles);
      }),
      getPrintArea: jest.fn().mockResolvedValue(null),
      getPrintSettings: jest.fn(async (sheetId: SheetId) =>
        makePrintSettings(printSettingsStore.get(sheetId)),
      ),
      setPrintSettings: jest.fn(async (sheetId: SheetId, settings: Record<string, any>) => {
        printSettingsStore.set(sheetId, settings);
      }),
      setPrintArea: jest.fn().mockResolvedValue(undefined),
      getPageBreaks: jest.fn().mockResolvedValue({ rowBreaks: [], colBreaks: [] }),
      addHorizontalPageBreak: jest.fn().mockResolvedValue(undefined),
      addVerticalPageBreak: jest.fn().mockResolvedValue(undefined),
      removeHorizontalPageBreak: jest.fn().mockResolvedValue(undefined),
      removeVerticalPageBreak: jest.fn().mockResolvedValue(undefined),
      clearAllPageBreaks: jest.fn().mockResolvedValue(undefined),
    },
    mirror: {
      getPrintTitles: jest.fn((sheetId: SheetId) => printTitlesStore.get(sheetId) ?? null),
      getPrintSettings: jest.fn((sheetId: SheetId) =>
        makePrintSettings(printSettingsStore.get(sheetId)),
      ),
    },
  } as unknown as DocumentContext;
}

const SHEET_ID = sheetId('sheet-1');

// =============================================================================
// Tests
// =============================================================================

describe('WorksheetPrintImpl — print title methods', () => {
  let ctx: DocumentContext;
  let print: WorksheetPrintImpl;

  beforeEach(() => {
    printTitlesStore.clear();
    printSettingsStore.clear();
    ctx = createMockContext();
    print = new WorksheetPrintImpl(ctx, SHEET_ID);
  });

  // ---------------------------------------------------------------------------
  // Getters when nothing is set
  // ---------------------------------------------------------------------------

  it('getPrintTitleRows returns null when no print titles are set', async () => {
    expect(await print.getPrintTitleRows()).toBeNull();
  });

  it('getPrintTitleColumns returns null when no print titles are set', async () => {
    expect(await print.getPrintTitleColumns()).toBeNull();
  });

  it('getSettings exposes Excel default margins when stored margins are unset', async () => {
    const settings = await print.getSettings();

    expect(settings.margins).toEqual({
      top: 0.75,
      bottom: 0.75,
      left: 0.7,
      right: 0.7,
      header: 0.3,
      footer: 0.3,
    });
  });

  it('getSettings preserves explicit margins from the mirror', async () => {
    const margins = {
      top: 1,
      bottom: 1.25,
      left: 0.5,
      right: 0.6,
      header: 0.4,
      footer: 0.45,
    };
    printSettingsStore.set(SHEET_ID, { margins });

    expect((await print.getSettings()).margins).toEqual(margins);
  });

  // ---------------------------------------------------------------------------
  // Set rows only
  // ---------------------------------------------------------------------------

  it('setPrintTitleRows sets repeat rows and getPrintTitleRows returns them', async () => {
    await print.setPrintTitleRows(0, 2);
    expect(await print.getPrintTitleRows()).toEqual([0, 2]);
  });

  it('setPrintTitleRows does not set repeat cols', async () => {
    await print.setPrintTitleRows(0, 2);
    expect(await print.getPrintTitleColumns()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Set cols only
  // ---------------------------------------------------------------------------

  it('setPrintTitleColumns sets repeat cols and getPrintTitleColumns returns them', async () => {
    await print.setPrintTitleColumns(0, 1);
    expect(await print.getPrintTitleColumns()).toEqual([0, 1]);
  });

  it('setPrintTitleColumns does not set repeat rows', async () => {
    await print.setPrintTitleColumns(0, 1);
    expect(await print.getPrintTitleRows()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Merge behavior (critical)
  // ---------------------------------------------------------------------------

  it('setting rows then cols preserves both', async () => {
    await print.setPrintTitleRows(0, 2);
    await print.setPrintTitleColumns(0, 1);

    expect(await print.getPrintTitleRows()).toEqual([0, 2]);
    expect(await print.getPrintTitleColumns()).toEqual([0, 1]);
  });

  it('setting cols then rows preserves both', async () => {
    await print.setPrintTitleColumns(3, 5);
    await print.setPrintTitleRows(1, 4);

    expect(await print.getPrintTitleColumns()).toEqual([3, 5]);
    expect(await print.getPrintTitleRows()).toEqual([1, 4]);
  });

  // ---------------------------------------------------------------------------
  // Clear
  // ---------------------------------------------------------------------------

  it('clearPrintTitles removes both rows and cols', async () => {
    await print.setPrintTitleRows(0, 2);
    await print.setPrintTitleColumns(0, 1);

    await print.clearPrintTitles();

    expect(await print.getPrintTitleRows()).toBeNull();
    expect(await print.getPrintTitleColumns()).toBeNull();
  });

  it('clearPrintTitles preserves other print settings', async () => {
    printSettingsStore.set(SHEET_ID, {
      orientation: 'landscape',
      scale: 75,
    });
    printTitlesStore.set(SHEET_ID, {
      repeatRows: [0, 0],
      repeatCols: [0, 2],
    });

    await print.clearPrintTitles();

    expect(printTitlesStore.get(SHEET_ID)).toBeUndefined();
    const stored = printSettingsStore.get(SHEET_ID)!;
    expect(stored.orientation).toBe('landscape');
    expect(stored.scale).toBe(75);
  });
});
