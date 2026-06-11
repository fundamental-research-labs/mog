/**
 * Number Format Action Handlers Tests
 *
 * Verifies that preset number format handlers apply the correct format strings.
 * In particular, confirms FORMAT_DATE uses 'd-mmm-yy' (Excel Ctrl+Shift+# behavior).
 *
 * M2 audit: FORMAT_DATE format was changed from 'MM/DD/YYYY' to 'd-mmm-yy'
 * to match Excel's Ctrl+Shift+# shortcut. This test locks in the intended format.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import * as NumberFormatHandlers from '../formatting/number-formats';

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createMockDeps(): ActionDependencies {
  const activeSheetId = makeSheetId('sheet1');

  const mockSetRanges = jest.fn().mockResolvedValue(undefined);

  const mockWorksheet = {
    formats: {
      setRanges: mockSetRanges,
    },
  };

  const mockWorkbook = {
    activeSheet: mockWorksheet,
    getSheetById: jest.fn().mockReturnValue(mockWorksheet),
  };

  return {
    workbook: mockWorkbook,
    getActiveSheetId: jest.fn().mockReturnValue(activeSheetId),
    accessors: {
      selection: {
        getActiveCell: jest.fn().mockReturnValue({ row: 0, col: 0 }),
        getRanges: jest.fn().mockReturnValue([{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }]),
      },
    },
  } as unknown as ActionDependencies;
}

/**
 * Extract the format string passed to ws.formats.setRanges from mock deps.
 */
function getAppliedFormat(deps: ActionDependencies): string {
  const ws = (deps.workbook as any).getSheetById();
  const call = ws.formats.setRanges.mock.calls[0];
  return call[1].numberFormat;
}

function getAppliedRanges(deps: ActionDependencies) {
  const ws = (deps.workbook as any).getSheetById();
  const call = ws.formats.setRanges.mock.calls[0];
  return call[0];
}

function createMockDepsForApplyNumberFormat(options: {
  now?: number;
  activeCell: { row: number; col: number };
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  cells: Record<string, { value: unknown; formula?: string }>;
  lastCommittedCellForFormatting: {
    sheetId: string;
    row: number;
    col: number;
    direction: 'up' | 'down' | 'left' | 'right' | 'none' | null;
    committedAt: number;
  } | null;
  pendingNumberFormat: string | null;
}) {
  const deps = createMockDeps() as any;
  const now = options.now ?? 1_000_000;
  deps.wallClockNow = jest.fn(() => now);
  const ws = deps.workbook.getSheetById();
  ws.getCell = jest.fn(async (row: number, col: number) => {
    return options.cells[`${row},${col}`] ?? { value: null };
  });
  deps.accessors.selection.getActiveCell = jest.fn().mockReturnValue(options.activeCell);
  deps.accessors.selection.getRanges = jest.fn().mockReturnValue(options.ranges);

  const clearPendingNumberFormat = jest.fn();
  const clearLastCommittedCellForFormatting = jest.fn();
  const addRecentNumberFormat = jest.fn();
  deps.uiStore = {
    getState: jest.fn().mockReturnValue({
      pendingNumberFormat: options.pendingNumberFormat,
      lastCommittedCellForFormatting: options.lastCommittedCellForFormatting,
      clearPendingNumberFormat,
      clearLastCommittedCellForFormatting,
      addRecentNumberFormat,
    }),
  };

  return {
    deps: deps as ActionDependencies,
    clearPendingNumberFormat,
    clearLastCommittedCellForFormatting,
    addRecentNumberFormat,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Number Format Handlers — preset format strings', () => {
  it('FORMAT_DATE applies d-mmm-yy (Excel Ctrl+Shift+# behavior)', async () => {
    const deps = createMockDeps();
    const result = await NumberFormatHandlers.FORMAT_DATE(deps);

    expect(result.handled).toBe(true);
    expect(getAppliedFormat(deps)).toBe('d-mmm-yy');
  });

  it('FORMAT_GENERAL applies General', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_GENERAL(deps);
    expect(getAppliedFormat(deps)).toBe('General');
  });

  it('FORMAT_NUMBER applies #,##0.00', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_NUMBER(deps);
    expect(getAppliedFormat(deps)).toBe('#,##0.00');
  });

  it('FORMAT_TIME applies h:mm AM/PM', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_TIME(deps);
    expect(getAppliedFormat(deps)).toBe('h:mm AM/PM');
  });

  it('FORMAT_CURRENCY applies $#,##0.00', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_CURRENCY(deps);
    expect(getAppliedFormat(deps)).toBe('$#,##0.00');
  });

  it('FORMAT_PERCENTAGE applies 0%', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_PERCENTAGE(deps);
    expect(getAppliedFormat(deps)).toBe('0%');
  });

  it('FORMAT_SCIENTIFIC applies 0.00E+00', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_SCIENTIFIC(deps);
    expect(getAppliedFormat(deps)).toBe('0.00E+00');
  });

  it('FORMAT_COMMA applies #,##0.00', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_COMMA(deps);
    expect(getAppliedFormat(deps)).toBe('#,##0.00');
  });
});

describe('Number Format Handlers — Format Cells dialog apply target', () => {
  it('APPLY_NUMBER_FORMAT targets the just-committed cell when Enter moved selection to a blank adjacent cell', async () => {
    const activeSheetId = makeSheetId('sheet1');
    const now = 1_000_000;
    const { deps, clearLastCommittedCellForFormatting } = createMockDepsForApplyNumberFormat({
      now,
      activeCell: { row: 459, col: 10 },
      ranges: [{ startRow: 459, startCol: 10, endRow: 459, endCol: 10 }],
      cells: {
        '458,10': { value: 1234.56 },
        '459,10': { value: null },
      },
      lastCommittedCellForFormatting: {
        sheetId: activeSheetId,
        row: 458,
        col: 10,
        direction: 'down',
        committedAt: now,
      },
      pendingNumberFormat: '#,##0.0',
    });

    const result = await NumberFormatHandlers.APPLY_NUMBER_FORMAT(deps);

    expect(result.handled).toBe(true);
    expect(getAppliedRanges(deps)).toEqual([
      { startRow: 458, startCol: 10, endRow: 458, endCol: 10 },
    ]);
    expect(getAppliedFormat(deps)).toBe('#,##0.0');
    expect(clearLastCommittedCellForFormatting).toHaveBeenCalledTimes(1);
  });

  it('APPLY_NUMBER_FORMAT keeps the active selection when the post-Enter cell has content', async () => {
    const activeSheetId = makeSheetId('sheet1');
    const now = 1_000_000;
    const { deps } = createMockDepsForApplyNumberFormat({
      now,
      activeCell: { row: 459, col: 10 },
      ranges: [{ startRow: 459, startCol: 10, endRow: 459, endCol: 10 }],
      cells: {
        '458,10': { value: 1234.56 },
        '459,10': { value: 99 },
      },
      lastCommittedCellForFormatting: {
        sheetId: activeSheetId,
        row: 458,
        col: 10,
        direction: 'down',
        committedAt: now,
      },
      pendingNumberFormat: '#,##0.0',
    });

    const result = await NumberFormatHandlers.APPLY_NUMBER_FORMAT(deps);

    expect(result.handled).toBe(true);
    expect(getAppliedRanges(deps)).toEqual([
      { startRow: 459, startCol: 10, endRow: 459, endCol: 10 },
    ]);
    expect(getAppliedFormat(deps)).toBe('#,##0.0');
  });
});

describe('Number Format Handlers — decimal adjustment', () => {
  function createMockDepsWithNumberFormat(
    numberFormat: string | undefined,
    displayText?: string,
  ): ActionDependencies {
    const deps = createMockDeps() as any;
    const ws = deps.workbook.getSheetById();
    ws.viewport = {
      getCellData: jest.fn().mockReturnValue({ format: { numberFormat }, displayText }),
    };
    deps.workbook.activeSheet = ws;
    return deps as ActionDependencies;
  }

  it('DECREASE_DECIMALS steps a General cell down from its displayed decimals', async () => {
    // "1.23456" shows 5 decimals → one step down is 4 decimals, not a jump to 1.
    const deps = createMockDepsWithNumberFormat('General', '1.23456');
    await NumberFormatHandlers.DECREASE_DECIMALS(deps);
    expect(getAppliedFormat(deps)).toBe('0.0000');
  });

  it('INCREASE_DECIMALS steps a General cell up from its displayed decimals', async () => {
    const deps = createMockDepsWithNumberFormat('General', '1.2');
    await NumberFormatHandlers.INCREASE_DECIMALS(deps);
    expect(getAppliedFormat(deps)).toBe('0.00');
  });

  it('DECREASE_DECIMALS clamps a whole-number General cell at zero', async () => {
    const deps = createMockDepsWithNumberFormat('General', '5');
    await NumberFormatHandlers.DECREASE_DECIMALS(deps);
    expect(getAppliedFormat(deps)).toBe('0');
  });

  it('DECREASE_DECIMALS keeps explicit zero-decimal formats clamped at zero', async () => {
    const deps = createMockDepsWithNumberFormat('0');
    await NumberFormatHandlers.DECREASE_DECIMALS(deps);
    expect(getAppliedFormat(deps)).toBe('0');
  });

  it('INCREASE_DECIMALS increments explicit zero-decimal formats', async () => {
    const deps = createMockDepsWithNumberFormat('0');
    await NumberFormatHandlers.INCREASE_DECIMALS(deps);
    expect(getAppliedFormat(deps)).toBe('0.0');
  });
});
