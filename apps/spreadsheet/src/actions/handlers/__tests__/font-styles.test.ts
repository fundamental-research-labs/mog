import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import { SET_FONT_SIZE, TOGGLE_BOLD, TOGGLE_WRAP_TEXT } from '../formatting/font-styles';

const activeSheetId = 'sheet1' as SheetId;

function createMockDeps(
  ranges: CellRange[],
  opts: {
    activeFormat?: Record<string, unknown>;
    displayedFormats?: Array<Array<Record<string, unknown>>>;
    displayText?: string | null;
    viewportBounds?: {
      sheetId: string;
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    } | null;
  } = {},
) {
  const calls: string[] = [];

  const worksheet = {
    viewport: {
      getCellData: jest.fn(() => ({
        displayText: opts.displayText === undefined ? 'wrapped text' : opts.displayText,
        format: opts.activeFormat ?? { wrapText: false },
      })),
      getBounds: jest.fn(() =>
        opts.viewportBounds === undefined
          ? { sheetId: activeSheetId, startRow: 0, startCol: 0, endRow: 100, endCol: 100 }
          : opts.viewportBounds,
      ),
    },
    formats: {
      getDisplayedRangeProperties: jest.fn(async () => opts.displayedFormats ?? [[{}]]),
      setRanges: jest.fn(async () => {
        calls.push('setRanges');
      }),
    },
    layout: {
      autoFitRows: jest.fn(async () => {
        calls.push('autoFitRows');
      }),
    },
  };

  const workbook = {
    activeSheet: worksheet,
    getSheetById: jest.fn().mockReturnValue(worksheet),
    undoGroup: jest.fn(async (fn: () => Promise<unknown>) => {
      calls.push('undoGroup:start');
      await fn();
      calls.push('undoGroup:end');
    }),
  };

  const deps = {
    workbook,
    accessors: {
      selection: {
        getActiveCell: jest
          .fn()
          .mockReturnValue({ row: ranges[0]?.startRow ?? 0, col: ranges[0]?.startCol ?? 0 }),
        getRanges: jest.fn().mockReturnValue(ranges),
      },
      editor: {
        isRichTextEditing: jest.fn().mockReturnValue(false),
        isEditing: jest.fn().mockReturnValue(false),
        hasSelection: jest.fn().mockReturnValue(false),
      },
    },
    getActiveSheetId: () => activeSheetId,
  } as unknown as ActionDependencies;

  return { deps, workbook, worksheet, calls };
}

describe('font style formatting actions', () => {
  it('applies SET_FONT_SIZE and row auto-fit in one undo group', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const { deps, workbook, worksheet, calls } = createMockDeps([range]);

    const result = await SET_FONT_SIZE(deps, { size: 24 });

    expect(result.handled).toBe(true);
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], { fontSize: 24 });
    expect(worksheet.layout.autoFitRows).toHaveBeenCalledWith([0]);
    expect(calls).toEqual(['undoGroup:start', 'setRanges', 'autoFitRows', 'undoGroup:end']);
  });

  it('skips row auto-fit for SET_FONT_SIZE when changed visible cells are empty', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const { deps, workbook, worksheet, calls } = createMockDeps([range], {
      displayText: null,
    });

    const result = await SET_FONT_SIZE(deps, { size: 24 });

    expect(result.handled).toBe(true);
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], { fontSize: 24 });
    expect(worksheet.layout.autoFitRows).not.toHaveBeenCalled();
    expect(calls).toEqual(['undoGroup:start', 'setRanges', 'undoGroup:end']);
  });

  it('keeps row auto-fit for SET_FONT_SIZE when changed cells are outside the viewport', async () => {
    const range: CellRange = { startRow: 500, startCol: 0, endRow: 500, endCol: 0 };
    const { deps, worksheet, calls } = createMockDeps([range], {
      displayText: null,
      viewportBounds: {
        sheetId: activeSheetId,
        startRow: 0,
        startCol: 0,
        endRow: 100,
        endCol: 100,
      },
    });

    const result = await SET_FONT_SIZE(deps, { size: 24 });

    expect(result.handled).toBe(true);
    expect(worksheet.layout.autoFitRows).toHaveBeenCalledWith([500]);
    expect(calls).toEqual(['undoGroup:start', 'setRanges', 'autoFitRows', 'undoGroup:end']);
  });

  it('applies TOGGLE_WRAP_TEXT and row auto-fit in one undo group', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const { deps, workbook, worksheet, calls } = createMockDeps([range]);

    const result = await TOGGLE_WRAP_TEXT(deps);

    expect(result.handled).toBe(true);
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], { wrapText: true });
    expect(worksheet.layout.autoFitRows).toHaveBeenCalledWith([0]);
    expect(calls).toEqual(['undoGroup:start', 'setRanges', 'autoFitRows', 'undoGroup:end']);
  });

  it('turns bold off for a mixed selected range when the active cell is already bold', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 1 };
    const { deps, worksheet } = createMockDeps([range], {
      activeFormat: { bold: true },
      displayedFormats: [[{ bold: true }, { bold: false }]],
    });

    const result = await TOGGLE_BOLD(deps);

    expect(result.handled).toBe(true);
    expect(worksheet.formats.getDisplayedRangeProperties).not.toHaveBeenCalled();
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], { bold: false });
  });

  it('turns bold on for a mixed selected range when the active cell is not bold', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 1 };
    const { deps, worksheet } = createMockDeps([range], {
      activeFormat: { bold: false },
      displayedFormats: [[{ bold: false }, { bold: true }]],
    });

    const result = await TOGGLE_BOLD(deps);

    expect(result.handled).toBe(true);
    expect(worksheet.formats.getDisplayedRangeProperties).not.toHaveBeenCalled();
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], { bold: true });
  });
});
