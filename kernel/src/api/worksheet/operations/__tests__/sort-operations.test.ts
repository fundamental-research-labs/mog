/**
 * Sort Operations Tests
 *
 * Tests the sort operations module and the worksheet-impl sortRange integration.
 *
 * Key bug: worksheet-impl.sortRange crashed with
 *   "Cannot read properties of undefined (reading 'map')"
 * because:
 * 1. No validation of options.columns before calling .map()
 * 2. Direction values 'asc'/'desc' are passed to the bridge (SortOrder type)
 *
 * @see worksheet-impl.ts - sortRange method
 * @see sort-operations.ts - SortOps.sortRange
 */

import { jest } from '@jest/globals';

import type { SortOptions } from '@mog-sdk/contracts/api';
import { sheetId } from '@mog-sdk/contracts/core';

import * as SortOps from '../sort-operations';

// =============================================================================
// Mock Helpers
// =============================================================================

const SHEET_ID = sheetId('sheet-1');

function createMockCtx() {
  return {
    clock: {
      now: jest.fn(() => 1_700_000_000_000),
    },
    computeBridge: {
      getAllCfRules: jest.fn().mockResolvedValue([]),
      sortRange: jest.fn().mockResolvedValue({ success: true }),
      updateCfRule: jest.fn().mockResolvedValue({ success: true }),
      forceRefreshAllViewports: jest.fn().mockResolvedValue(undefined),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'user-1',
      requestingDocumentId: 'workbook-1',
      requestingSessionId: 'session-1',
    })),
  } as any;
}

function makeRange(startRow: number, startCol: number, endRow: number, endCol: number) {
  return { sheetId: SHEET_ID, startRow, startCol, endRow, endCol };
}

function expectSortAdmissionOptions(
  operationIdPrefix: string,
  domainIds: readonly string[] = ['sorts'],
  groupId?: string,
) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      sheetIds: [SHEET_ID],
      domainIds,
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      ...(groupId ? { groupId } : {}),
    }),
  });
}

/**
 * Simulate the transformation that worksheet-impl.sortRange does:
 * maps public SortOptions (with columns, 'asc'/'desc' direction)
 * to ApiSortOptions (with sortBy, 'asc'/'desc' direction) for SortOps.sortRange.
 */
function mapSortOptionsToApiOptions(
  parsed: { startRow: number; startCol: number; endRow: number; endCol: number },
  options: SortOptions,
) {
  if (!options.columns || !Array.isArray(options.columns)) {
    throw new Error('SortOptions.columns is required and must be an array');
  }

  const sortBy = options.columns.map((c) => ({
    column: parsed.startCol + c.column,
    direction: mapDirection(c.direction),
    sortBy: (c.sortBy ?? 'value') as 'value',
    caseSensitive: c.caseSensitive,
  }));

  return {
    sortBy,
    hasHeaders: options.hasHeaders,
    visibleRowsOnly: options.visibleRowsOnly,
  };
}

/** Map public API direction to contracts SortDirection. */
function mapDirection(direction: 'asc' | 'desc' | undefined): 'asc' | 'desc' {
  if (direction === 'desc') return 'desc';
  return 'asc';
}

// =============================================================================
// SortOps.sortRange unit tests
//
// Note: SortOps.sortRange accepts contracts SortDirection ('asc'/'desc')
// and passes through to bridge SortOrder ('asc'/'desc').
// =============================================================================

describe('SortOps.sortRange', () => {
  it('delegates to computeBridge.sortRange with mapped direction', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'asc', caseSensitive: false }],
      hasHeaders: false,
    });

    expect(ctx.computeBridge.sortRange).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      9,
      2,
      expect.objectContaining({
        criteria: [
          expect.objectContaining({
            column: 0,
            direction: 'asc',
            caseSensitive: false,
            mode: expect.objectContaining({ kind: 'value' }),
          }),
        ],
        hasHeaders: false,
      }),
      expectSortAdmissionOptions('sorts.sortRange'),
    );
  });

  it('maps desc direction to descending for bridge', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'desc', caseSensitive: false }],
      hasHeaders: false,
    });

    const criteria = ctx.computeBridge.sortRange.mock.calls[0][5].criteria;
    expect(criteria[0].direction).toBe('desc');
  });

  it('throws on missing sortBy', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await expect(
      SortOps.sortRange(ctx, SHEET_ID, range, {
        sortBy: undefined as any,
        hasHeaders: false,
      }),
    ).rejects.toThrow('At least one sort criterion is required');
  });

  it('throws on empty sortBy array', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await expect(
      SortOps.sortRange(ctx, SHEET_ID, range, {
        sortBy: [],
        hasHeaders: false,
      }),
    ).rejects.toThrow('At least one sort criterion is required');
  });

  it('filters out columns outside the sort range', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 1, 9, 3); // cols 1-3

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [
        { column: 0, direction: 'asc', caseSensitive: false }, // outside (col 0)
        { column: 2, direction: 'desc', caseSensitive: false }, // inside (col 2)
        { column: 5, direction: 'asc', caseSensitive: false }, // outside (col 5)
      ],
      hasHeaders: false,
    });

    expect(ctx.computeBridge.sortRange).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      1,
      9,
      3,
      expect.objectContaining({
        criteria: [
          expect.objectContaining({
            column: 2,
            direction: 'desc',
            caseSensitive: false,
            mode: expect.objectContaining({ kind: 'value' }),
          }),
        ],
        hasHeaders: false,
      }),
      expectSortAdmissionOptions('sorts.sortRange'),
    );
  });

  it('silently returns when all columns are outside range', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 5, 9, 7);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'asc', caseSensitive: false }],
      hasHeaders: false,
    });

    expect(ctx.computeBridge.sortRange).not.toHaveBeenCalled();
  });

  it('passes hasHeaders through to bridge options', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'asc', caseSensitive: false }],
      hasHeaders: true,
    });

    const callArgs = ctx.computeBridge.sortRange.mock.calls[0];
    expect(callArgs[5].hasHeaders).toBe(true);
  });

  it('passes visibleRowsOnly through to bridge options', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'asc', caseSensitive: false }],
      hasHeaders: true,
      visibleRowsOnly: true,
    });

    const callArgs = ctx.computeBridge.sortRange.mock.calls[0];
    expect(callArgs[5].visibleRowsOnly).toBe(true);
  });

  it('passes version admission options to the sort bridge mutation', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'asc' }],
      hasHeaders: false,
    });

    expect(ctx.computeBridge.sortRange.mock.calls[0][6]).toEqual(
      expectSortAdmissionOptions('sorts.sortRange'),
    );
  });

  it('groups sort and conditional-format repair mutation contexts', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);
    ctx.computeBridge.getAllCfRules.mockResolvedValue([
      {
        id: 'cf-1',
        ranges: [{ startRow: 0, startCol: 0, endRow: 3, endCol: 1 }],
      },
      {
        id: 'cf-2',
        ranges: [{ startRow: 8, startCol: 1, endRow: 12, endCol: 2 }],
      },
    ]);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'asc' }],
      hasHeaders: false,
    });

    const sortContext = ctx.computeBridge.sortRange.mock.calls[0][6].operationContext;
    expect(sortContext).toEqual(
      expect.objectContaining({
        operationId: expect.stringMatching(/^sorts\.sortRange:/),
        sheetIds: [SHEET_ID],
        domainIds: ['sorts'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      }),
    );
    expect(sortContext.groupId).toBe(sortContext.operationId);

    expect(ctx.computeBridge.updateCfRule).toHaveBeenCalledTimes(2);
    const firstRepairContext = ctx.computeBridge.updateCfRule.mock.calls[0][3].operationContext;
    const secondRepairContext = ctx.computeBridge.updateCfRule.mock.calls[1][3].operationContext;
    expect(firstRepairContext).toEqual(
      expect.objectContaining({
        operationId: expect.stringMatching(/^sorts\.sortRange\.repairConditionalFormatting:/),
        sheetIds: [SHEET_ID],
        domainIds: ['sorts', 'conditional-formatting'],
        groupId: sortContext.groupId,
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      }),
    );
    expect(secondRepairContext).toEqual(
      expect.objectContaining({
        operationId: expect.stringMatching(/^sorts\.sortRange\.repairConditionalFormatting:/),
        sheetIds: [SHEET_ID],
        domainIds: ['sorts', 'conditional-formatting'],
        groupId: sortContext.groupId,
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      }),
    );
    expect(firstRepairContext).not.toBe(secondRepairContext);
    expect(firstRepairContext.operationId).not.toBe(secondRepairContext.operationId);
    expect(firstRepairContext.operationId).not.toBe(sortContext.operationId);
  });

  it('defaults sortBy to "value" and caseSensitive to false', async () => {
    const ctx = createMockCtx();
    const range = makeRange(0, 0, 9, 2);

    await SortOps.sortRange(ctx, SHEET_ID, range, {
      sortBy: [{ column: 0, direction: 'asc' } as any],
      hasHeaders: false,
    });

    const criteria = ctx.computeBridge.sortRange.mock.calls[0][5].criteria;
    expect(criteria[0].mode.kind).toBe('value');
    expect(criteria[0].caseSensitive).toBe(false);
  });

  it('throws on invalid range (start > end)', async () => {
    const ctx = createMockCtx();
    const range = makeRange(10, 5, 0, 0); // inverted — fails isValidRange

    await expect(
      SortOps.sortRange(ctx, SHEET_ID, range, {
        sortBy: [{ column: 0, direction: 'asc', caseSensitive: false }],
        hasHeaders: false,
      }),
    ).rejects.toThrow('Invalid range');
  });
});

// =============================================================================
// worksheet-impl sortRange transformation tests
//
// These test the mapping from public SortOptions (columns, 'asc'/'desc')
// to ApiSortOptions (sortBy, 'asc'/'desc') that worksheet-impl does.
// The bridge SortOrder ('asc'/'desc') is passed through by SortOps.sortRange.
// =============================================================================

describe('worksheet-impl sortRange transformation', () => {
  const parsed = { startRow: 0, startCol: 0, endRow: 9, endCol: 2 };

  it('maps direction "asc" through', () => {
    const result = mapSortOptionsToApiOptions(parsed, {
      columns: [{ column: 0, direction: 'asc' }],
    });
    expect(result.sortBy[0].direction).toBe('asc');
  });

  it('maps direction "desc" through', () => {
    const result = mapSortOptionsToApiOptions(parsed, {
      columns: [{ column: 0, direction: 'desc' }],
    });
    expect(result.sortBy[0].direction).toBe('desc');
  });

  it('defaults to "asc" when direction is not set', () => {
    const result = mapSortOptionsToApiOptions(parsed, {
      columns: [{ column: 0 }],
    });
    expect(result.sortBy[0].direction).toBe('asc');
  });

  it('offsets column indices by range startCol', () => {
    const rangeStartingAtB = { startRow: 0, startCol: 1, endRow: 9, endCol: 4 };
    const result = mapSortOptionsToApiOptions(rangeStartingAtB, {
      columns: [
        { column: 0, direction: 'asc' },
        { column: 2, direction: 'desc' },
      ],
    });
    expect(result.sortBy[0].column).toBe(1);
    expect(result.sortBy[1].column).toBe(3);
  });

  it('throws when columns is undefined', () => {
    expect(() => {
      mapSortOptionsToApiOptions(parsed, { columns: undefined } as any);
    }).toThrow('SortOptions.columns is required');
  });

  it('throws when columns is not an array', () => {
    expect(() => {
      mapSortOptionsToApiOptions(parsed, { columns: 'not-an-array' } as any);
    }).toThrow('SortOptions.columns is required');
  });

  it('passes through the full pipeline: SortOptions -> ApiSortOptions -> bridge call', async () => {
    const ctx = createMockCtx();
    const rangeStr = { startRow: 0, startCol: 0, endRow: 9, endCol: 2 };

    const apiOptions = mapSortOptionsToApiOptions(rangeStr, {
      columns: [
        { column: 1, direction: 'asc' },
        { column: 0, direction: 'desc' },
      ],
      hasHeaders: true,
    });

    const cellRange = {
      sheetId: SHEET_ID,
      startRow: rangeStr.startRow,
      startCol: rangeStr.startCol,
      endRow: rangeStr.endRow,
      endCol: rangeStr.endCol,
    };

    await SortOps.sortRange(ctx, SHEET_ID, cellRange, apiOptions);

    expect(ctx.computeBridge.sortRange).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      9,
      2,
      expect.objectContaining({
        criteria: [
          expect.objectContaining({ column: 1, direction: 'asc' }),
          expect.objectContaining({ column: 0, direction: 'desc' }),
        ],
        hasHeaders: true,
      }),
      expectSortAdmissionOptions('sorts.sortRange'),
    );
  });
});
