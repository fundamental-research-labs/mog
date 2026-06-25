/**
 * Range Query Operations Unit Tests
 *
 * Tests for clear modes and range query helpers.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { KernelError } from '../../../../errors';
import * as RangeQueryOps from '../range-query-operations';

const SHEET_ID = sheetId('sheet-1');
const RANGE = {
  sheetId: SHEET_ID,
  startRow: 0,
  startCol: 0,
  endRow: 1,
  endCol: 1,
};

function createMockCtx(): any {
  return {
    computeBridge: {
      clearRangeByPosition: jest.fn().mockResolvedValue(undefined),
      clearRange: jest.fn().mockResolvedValue(undefined),
      clearFormatForRanges: jest.fn().mockResolvedValue(undefined),
      clearHyperlinksInRange: jest.fn().mockResolvedValue(undefined),
      replaceAllInRange: jest.fn().mockResolvedValue({ data: 2 }),
    },
  };
}

function captureInvalidClearMode(input: unknown): KernelError {
  try {
    RangeQueryOps.validateClearApplyTo(input);
  } catch (error) {
    expect(error).toBeInstanceOf(KernelError);
    return error as KernelError;
  }
  throw new Error(`Expected ${String(input)} to be rejected`);
}

describe('validateClearApplyTo', () => {
  it.each(['all', 'contents', 'formats', 'hyperlinks'] as const)(
    'returns canonical mode %s unchanged',
    (mode) => {
      expect(RangeQueryOps.validateClearApplyTo(mode)).toBe(mode);
    },
  );

  it.each(['value', 'values', 'content'] as const)(
    'rejects %s with a contents suggestion',
    (mode) => {
      const error = captureInvalidClearMode(mode);

      expect(error).toMatchObject({
        code: 'API_INVALID_ARGUMENT',
        path: ['applyTo'],
        suggestion: expect.stringContaining('"contents"'),
        context: {
          issueCode: 'UNKNOWN_CLEAR_MODE',
          received: mode,
          validValues: ['all', 'contents', 'formats', 'hyperlinks'],
          suggestion: expect.stringContaining('"contents"'),
        },
      });
    },
  );

  it('rejects valuesAndFormats with an ambiguity diagnostic', () => {
    const error = captureInvalidClearMode('valuesAndFormats');

    expect(error).toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      path: ['applyTo'],
      context: {
        issueCode: 'UNKNOWN_CLEAR_MODE',
        received: 'valuesAndFormats',
        validValues: ['all', 'contents', 'formats', 'hyperlinks'],
      },
    });
    expect(error.suggestion).toContain('ambiguous');
    expect(error.suggestion).toContain('not the same as "all"');
    expect(error.suggestion).toContain('hyperlinks');
  });

  it.each([[''], [null], [42], [{ mode: 'contents' }]] as const)(
    'rejects non-canonical applyTo value %#',
    (input) => {
      const error = captureInvalidClearMode(input);

      expect(error).toMatchObject({
        code: 'API_INVALID_ARGUMENT',
        path: ['applyTo'],
        context: {
          issueCode: 'UNKNOWN_CLEAR_MODE',
          received: input,
          validValues: ['all', 'contents', 'formats', 'hyperlinks'],
          suggestion: expect.any(String),
        },
      });
    },
  );
});

describe('clearWithMode', () => {
  it.each([
    ['all', { full: 1, contents: 0, formats: 1, hyperlinks: 1 }],
    ['contents', { full: 0, contents: 1, formats: 0, hyperlinks: 0 }],
    ['formats', { full: 0, contents: 0, formats: 1, hyperlinks: 0 }],
    ['hyperlinks', { full: 0, contents: 0, formats: 0, hyperlinks: 1 }],
  ] as const)('executes canonical mode %s', async (mode, calls) => {
    const ctx = createMockCtx();

    const result = await RangeQueryOps.clearWithMode(ctx, SHEET_ID, RANGE, mode);

    expect(result).toEqual({ cellCount: 4 });
    expect(ctx.computeBridge.clearRangeByPosition).toHaveBeenCalledTimes(calls.full);
    expect(ctx.computeBridge.clearRange).toHaveBeenCalledTimes(calls.contents);
    expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledTimes(calls.formats);
    expect(ctx.computeBridge.clearHyperlinksInRange).toHaveBeenCalledTimes(calls.hyperlinks);
  });

  it('rejects unknown modes before bridge calls', async () => {
    const ctx = createMockCtx();

    await expect(RangeQueryOps.clearWithMode(ctx, SHEET_ID, RANGE, 'values')).rejects.toMatchObject(
      {
        code: 'API_INVALID_ARGUMENT',
        path: ['applyTo'],
        context: {
          issueCode: 'UNKNOWN_CLEAR_MODE',
          received: 'values',
          validValues: ['all', 'contents', 'formats', 'hyperlinks'],
          suggestion: expect.stringContaining('"contents"'),
        },
      },
    );

    expect(ctx.computeBridge.clearRangeByPosition).not.toHaveBeenCalled();
    expect(ctx.computeBridge.clearRange).not.toHaveBeenCalled();
    expect(ctx.computeBridge.clearFormatForRanges).not.toHaveBeenCalled();
    expect(ctx.computeBridge.clearHyperlinksInRange).not.toHaveBeenCalled();
  });

  it('passes direct edit range metadata only to value-clearing bridge calls', async () => {
    const ctx = createMockCtx();
    const options = {
      operationContext: {
        operationId: 'worksheet.clear:1',
        kind: 'mutation',
        author: { authorId: 'user-1', actorKind: 'user' },
        createdAt: '2026-06-20T00:00:00.000Z',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      },
    };

    await RangeQueryOps.clearWithMode(ctx, SHEET_ID, RANGE, 'all', options as any);

    const captureOptions = {
      ...options,
      directEditRanges: [{ sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
    };
    expect(ctx.computeBridge.clearRangeByPosition).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      1,
      1,
      captureOptions,
    );
    expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 0, 1, 1]],
      options,
    );
    expect(ctx.computeBridge.clearHyperlinksInRange).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      1,
      1,
      options,
    );
  });

  it('passes direct edit range metadata to contents clear calls', async () => {
    const ctx = createMockCtx();
    const options = {
      operationContext: {
        operationId: 'worksheet.clear:contents',
        kind: 'mutation',
        author: { authorId: 'user-1', actorKind: 'user' },
        createdAt: '2026-06-20T00:00:00.000Z',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      },
    };

    await RangeQueryOps.clearWithMode(ctx, SHEET_ID, RANGE, 'contents', options as any);

    expect(ctx.computeBridge.clearRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1, {
      ...options,
      directEditRanges: [{ sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
    });
  });
});

describe('replaceAll', () => {
  it('passes mutation admission options to replaceAllInRange', async () => {
    const ctx = createMockCtx();
    const options = {
      operationContext: {
        operationId: 'worksheet.replaceAll:1',
        kind: 'mutation',
        author: { authorId: 'user-1', actorKind: 'user' },
        createdAt: '2026-06-20T00:00:00.000Z',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      },
    };

    const result = await RangeQueryOps.replaceAll(
      ctx,
      SHEET_ID,
      RANGE,
      'old',
      'new',
      { caseSensitive: true },
      options as any,
    );

    expect(result).toBe(2);
    const captureOptions = {
      ...options,
      directEditRanges: [{ sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
    };
    expect(ctx.computeBridge.replaceAllInRange).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      1,
      1,
      'old',
      'new',
      {
        text: 'old',
        caseSensitive: true,
        wholeCell: null,
        includeFormulas: null,
      },
      captureOptions,
    );
  });
});
