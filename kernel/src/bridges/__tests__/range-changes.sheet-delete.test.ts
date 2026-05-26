/**
 * Deleting a sheet clears its rangesBySheet entry in RangeMetadataCache.
 *
 * Verifies that MutationResultHandler.handleSheetChanges correctly calls
 * rangeMetadataCache.deleteSheet() when processing a sheet removal, cleaning
 * up all range metadata associated with the deleted sheet.
 *
 * @see mutation-result-handler.ts — handleSheetChanges (field: 'sheet', kind: 'Removed')
 * @see wire/range-metadata-cache.ts — deleteSheet()
 */

import { jest } from '@jest/globals';

import type { RangeId, SheetId } from '@mog-sdk/contracts/core';
import type { IEventBus } from '@mog-sdk/contracts/events';

import type { MutationResult } from '../compute/compute-bridge';
import type { RangeChange } from '../compute/compute-types.gen';
import { MutationResultHandler } from '../mutation-result-handler';
import { RangeMetadataCache } from '../wire/range-metadata-cache';
import type { RangeMeta } from '../wire/range-metadata-cache';

// =============================================================================
// TEST UTILITIES
// =============================================================================

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
  } as unknown as IEventBus & { emittedEvents: Array<{ type: string; [k: string]: unknown }> };
}

function buildMutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: null as unknown as undefined,
    propertyChanges: undefined,
    dimensionChanges: undefined,
    mergeChanges: undefined,
    visibilityChanges: undefined,
    commentChanges: undefined,
    filterChanges: undefined,
    tableChanges: undefined,
    sheetChanges: undefined,
    cfChanges: undefined,
    namedRangeChanges: undefined,
    groupingChanges: undefined,
    sparklineChanges: undefined,
    sortingChanges: undefined,
    floatingObjectChanges: undefined,
    floatingObjectGroupChanges: undefined,
    pivotChanges: undefined,
    undoDescription: undefined,
    ...overrides,
  } as MutationResult;
}

function encodeRangeMeta(meta: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta));
}

/** Build a RangeChange with kind: 'Created' and JSON-encoded data payload. */
function makeCreatedRangeChange(
  sheetId: string,
  rangeId: string,
  meta: Partial<RangeMeta> = {},
): RangeChange {
  const fullMeta: RangeMeta = {
    rangeId: rangeId as unknown as RangeId,
    kind: 'Data' as RangeMeta['kind'],
    anchor: {
      Elastic: { startRow: 'r0', endRow: 'r9', startCol: 'c0', endCol: 'c4' },
    } as RangeMeta['anchor'],
    encoding: 'F64Le' as RangeMeta['encoding'],
    rowIds: ['r0', 'r1'],
    colIds: ['c0', 'c1'],
    ...meta,
  };
  return {
    sheetId,
    rangeId,
    kind: 'Created',
    data: encodeRangeMeta(fullMeta),
  } as unknown as RangeChange;
}

// =============================================================================
// TESTS
// =============================================================================

describe('sheet deletion clears rangesBySheet in RangeMetadataCache', () => {
  it('deleting a sheet clears all its ranges from the cache', () => {
    const eventBus = createMockEventBus();
    const cache = new RangeMetadataCache();
    const handler = new MutationResultHandler(eventBus);
    handler.setRangeMetadataCache(cache);

    const sheetId = 'sheet-1' as unknown as SheetId;
    const rangeId1 = 'range-1' as unknown as RangeId;
    const rangeId2 = 'range-2' as unknown as RangeId;

    // Step 1: Pre-populate the cache by processing Created range changes.
    const createResult = buildMutationResult({
      rangeChanges: [
        makeCreatedRangeChange('sheet-1', 'range-1'),
        makeCreatedRangeChange('sheet-1', 'range-2'),
      ],
    });
    handler.applyAndNotify(createResult);

    // Verify ranges are in the cache.
    expect(cache.get(sheetId, rangeId1)).toBeDefined();
    expect(cache.get(sheetId, rangeId2)).toBeDefined();
    expect(cache.getAll(sheetId)?.size).toBe(2);

    // Step 2: Delete the sheet via a sheetChanges entry.
    const deleteResult = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Removed',
          field: 'sheet',
          name: 'Sheet 1',
        },
      ],
    } as Partial<MutationResult>);
    handler.applyAndNotify(deleteResult);

    // Step 3: Verify the cache is empty for the deleted sheet.
    expect(cache.get(sheetId, rangeId1)).toBeUndefined();
    expect(cache.get(sheetId, rangeId2)).toBeUndefined();
    expect(cache.getAll(sheetId)).toBeUndefined();
  });

  it('deleting one sheet does not affect ranges on other sheets', () => {
    const eventBus = createMockEventBus();
    const cache = new RangeMetadataCache();
    const handler = new MutationResultHandler(eventBus);
    handler.setRangeMetadataCache(cache);

    const sheet1 = 'sheet-1' as unknown as SheetId;
    const sheet2 = 'sheet-2' as unknown as SheetId;
    const rangeOnSheet1 = 'range-s1' as unknown as RangeId;
    const rangeOnSheet2 = 'range-s2' as unknown as RangeId;

    // Pre-populate ranges on two different sheets.
    const createResult = buildMutationResult({
      rangeChanges: [
        makeCreatedRangeChange('sheet-1', 'range-s1'),
        makeCreatedRangeChange('sheet-2', 'range-s2'),
      ],
    });
    handler.applyAndNotify(createResult);

    // Verify both sheets have their ranges.
    expect(cache.get(sheet1, rangeOnSheet1)).toBeDefined();
    expect(cache.get(sheet2, rangeOnSheet2)).toBeDefined();

    // Delete only sheet-1.
    const deleteResult = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Removed',
          field: 'sheet',
          name: 'Sheet 1',
        },
      ],
    } as Partial<MutationResult>);
    handler.applyAndNotify(deleteResult);

    // sheet-1 ranges are gone.
    expect(cache.getAll(sheet1)).toBeUndefined();

    // sheet-2 ranges are untouched.
    expect(cache.get(sheet2, rangeOnSheet2)).toBeDefined();
    expect(cache.getAll(sheet2)?.size).toBe(1);
  });

  it('deleting a sheet with no ranges does not crash', () => {
    const eventBus = createMockEventBus();
    const cache = new RangeMetadataCache();
    const handler = new MutationResultHandler(eventBus);
    handler.setRangeMetadataCache(cache);

    // No ranges were ever created for sheet-3.
    const deleteResult = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-3',
          kind: 'Removed',
          field: 'sheet',
          name: 'Empty Sheet',
        },
      ],
    } as Partial<MutationResult>);

    // Should not throw.
    expect(() => handler.applyAndNotify(deleteResult)).not.toThrow();

    // And the sheet:deleted event should still be emitted.
    const deletedEvent = eventBus.emittedEvents.find((e) => e.type === 'sheet:deleted');
    expect(deletedEvent).toBeDefined();
    expect(deletedEvent!.sheetId).toBe('sheet-3');
  });
});
