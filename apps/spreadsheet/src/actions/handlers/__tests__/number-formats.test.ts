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

  it('FORMAT_TIME applies h:mm:ss AM/PM', async () => {
    const deps = createMockDeps();
    await NumberFormatHandlers.FORMAT_TIME(deps);
    expect(getAppliedFormat(deps)).toBe('h:mm:ss AM/PM');
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
