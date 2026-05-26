/**
 * Tests for getDisplayedCellProperties and getDisplayedRangeProperties
 * operations from format-operations.ts.
 *
 * These test the operations layer directly, mocking the computeBridge.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../../../context/types';
import { getDisplayedCellProperties, getDisplayedRangeProperties } from '../format-operations';

// =============================================================================
// Mock helpers
// =============================================================================

function createMockContext(overrides?: Record<string, jest.Mock>): DocumentContext {
  return {
    computeBridge: {
      getDisplayedCellProperties: jest.fn().mockResolvedValue({ bold: true, fontColor: '#FF0000' }),
      getDisplayedRangeProperties: jest.fn().mockResolvedValue([
        [{ bold: true }, { italic: true }],
        [{ bold: false }, { italic: false }],
      ]),
      ...overrides,
    },
  } as unknown as DocumentContext;
}

const SHEET_ID = sheetId('test-sheet');

// =============================================================================
// Tests — getDisplayedCellProperties
// =============================================================================

describe('getDisplayedCellProperties', () => {
  it('returns the displayed format for a valid cell', async () => {
    const ctx = createMockContext();
    const result = await getDisplayedCellProperties(ctx, SHEET_ID, 2, 1);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ bold: true, fontColor: '#FF0000' });
    }
    expect(ctx.computeBridge.getDisplayedCellProperties).toHaveBeenCalledWith(SHEET_ID, 2, 1);
  });

  it('returns an error for a negative row index', async () => {
    const ctx = createMockContext();
    const result = await getDisplayedCellProperties(ctx, SHEET_ID, -1, 0);

    expect(result.success).toBe(false);
  });

  it('returns an error for a negative col index', async () => {
    const ctx = createMockContext();
    const result = await getDisplayedCellProperties(ctx, SHEET_ID, 0, -1);

    expect(result.success).toBe(false);
  });

  it('wraps bridge errors into a failure result', async () => {
    const ctx = createMockContext({
      getDisplayedCellProperties: jest.fn().mockRejectedValue(new Error('bridge failure')),
    });
    const result = await getDisplayedCellProperties(ctx, SHEET_ID, 0, 0);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('bridge failure');
    }
  });
});

// =============================================================================
// Tests — getDisplayedRangeProperties
// =============================================================================

describe('getDisplayedRangeProperties', () => {
  it('returns the displayed formats for a valid range', async () => {
    const ctx = createMockContext();
    const range = { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 };
    const result = await getDisplayedRangeProperties(ctx, SHEET_ID, range);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([
        [{ bold: true }, { italic: true }],
        [{ bold: false }, { italic: false }],
      ]);
    }
    expect(ctx.computeBridge.getDisplayedRangeProperties).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      1,
      1,
    );
  });

  it('returns an error for a reversed range (endRow < startRow)', async () => {
    const ctx = createMockContext();
    const range = { sheetId: SHEET_ID, startRow: 3, startCol: 2, endRow: 1, endCol: 0 };
    const result = await getDisplayedRangeProperties(ctx, SHEET_ID, range);

    expect(result.success).toBe(false);
    expect(ctx.computeBridge.getDisplayedRangeProperties).not.toHaveBeenCalled();
  });

  it('returns an error for an invalid range (negative coordinates)', async () => {
    const ctx = createMockContext();
    const range = { sheetId: SHEET_ID, startRow: -1, startCol: 0, endRow: 1, endCol: 1 };
    const result = await getDisplayedRangeProperties(ctx, SHEET_ID, range);

    expect(result.success).toBe(false);
  });

  it('wraps bridge errors into a failure result', async () => {
    const ctx = createMockContext({
      getDisplayedRangeProperties: jest.fn().mockRejectedValue(new Error('range bridge failure')),
    });
    const range = { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 };
    const result = await getDisplayedRangeProperties(ctx, SHEET_ID, range);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('range bridge failure');
    }
  });
});
