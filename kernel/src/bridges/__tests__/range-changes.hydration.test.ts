/**
 * Range Changes Hydration Gate Test — first-class range lifecycle
 *
 * Verifies that cold-loading a workbook with existing Ranges populates
 * the RangeMetadataCache via `Created` changes from the hydration
 * MutationResult. During hydration, Rust builds a MutationResult
 * containing one RangeChange::Created per existing Range and sends it
 * through the normal applyAndNotify() path.
 *
 * Gate criteria validated:
 * 1. rangesBySheet populated via Created changes from hydration MutationResult
 * 2. Hydration source is 'user' (matches existing applyAndNotify default)
 * 3. Cache is populated correctly regardless of source
 *
 * @see mutation-result-handler.ts - handleRangeChanges()
 * @see wire/range-metadata-cache.ts - RangeMetadataCache
 */

import { jest } from '@jest/globals';

import type { IEventBus } from '@mog-sdk/contracts/events';
import type { RangeId, SheetId } from '@mog-sdk/contracts/core';

import type { MutationResult } from '../compute/compute-bridge';
import type { RangeChange } from '../compute/compute-types.gen';
import { RangeMetadataCache } from '../wire/range-metadata-cache';
import type { RangeMeta } from '../wire/range-metadata-cache';
import { MutationResultHandler } from '../mutation-result-handler';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/** Create a minimal mock EventBus that records all emitted events. */
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

/** Build a minimal MutationResult with only the specified fields. */
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

/** Encode a RangeMeta object into the Uint8Array payload that Rust would send. */
function encodeRangeMeta(meta: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta));
}

/** Build a RangeChange with kind=Created and encoded metadata. */
function buildCreatedRangeChange(sheetId: string, rangeId: string, meta: RangeMeta): RangeChange {
  return {
    sheetId,
    rangeId,
    kind: 'Created',
    data: encodeRangeMeta(meta),
  };
}

/** Build a sample RangeMeta for testing. */
function sampleMeta(overrides: Partial<RangeMeta> = {}): RangeMeta {
  return {
    rangeId: 'range-1' as unknown as RangeId,
    kind: 'Data' as RangeMeta['kind'],
    anchor: {
      Elastic: { startRow: 'r0', endRow: 'r9', startCol: 'c0', endCol: 'c4' },
    } as RangeMeta['anchor'],
    encoding: 'F64Le' as RangeMeta['encoding'],
    rowIds: ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'],
    colIds: ['c0', 'c1', 'c2', 'c3', 'c4'],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Range hydration — cold-load populates RangeMetadataCache', () => {
  // ---------------------------------------------------------------------------
  // 1. Single range on single sheet -> cache populated after hydration
  // ---------------------------------------------------------------------------
  it('populates cache for a single range on a single sheet', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta = sampleMeta({
      rangeId: 'range-abc' as unknown as RangeId,
    });

    const result = buildMutationResult({
      rangeChanges: [buildCreatedRangeChange('sheet-1', 'range-abc', meta)],
    });

    handler.applyAndNotify(result);

    const cached = cache.get('sheet-1' as unknown as SheetId, 'range-abc' as unknown as RangeId);
    expect(cached).toBeDefined();
    expect(cached!.rangeId).toBe('range-abc');
    expect(cached!.kind).toBe('Data');
    expect(cached!.encoding).toBe('F64Le');
  });

  // ---------------------------------------------------------------------------
  // 2. Multiple ranges across multiple sheets -> all cached correctly
  // ---------------------------------------------------------------------------
  it('populates cache for multiple ranges across multiple sheets', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta1 = sampleMeta({
      rangeId: 'range-1' as unknown as RangeId,
      kind: 'Data' as RangeMeta['kind'],
      encoding: 'F64Le' as RangeMeta['encoding'],
      rowIds: ['r0', 'r1'],
      colIds: ['c0'],
    });
    const meta2 = sampleMeta({
      rangeId: 'range-2' as unknown as RangeId,
      kind: 'Format' as RangeMeta['kind'],
      encoding: 'MixedCbor' as RangeMeta['encoding'],
      rowIds: ['r0', 'r1', 'r2'],
      colIds: ['c0', 'c1'],
    });
    const meta3 = sampleMeta({
      rangeId: 'range-3' as unknown as RangeId,
      kind: 'Data' as RangeMeta['kind'],
      encoding: 'I64Le' as RangeMeta['encoding'],
      rowIds: ['r0'],
      colIds: ['c0', 'c1', 'c2'],
    });

    const result = buildMutationResult({
      rangeChanges: [
        buildCreatedRangeChange('sheet-1', 'range-1', meta1),
        buildCreatedRangeChange('sheet-1', 'range-2', meta2),
        buildCreatedRangeChange('sheet-2', 'range-3', meta3),
      ],
    });

    handler.applyAndNotify(result);

    // Sheet 1 has two ranges
    const sheet1Ranges = cache.getAll('sheet-1' as unknown as SheetId);
    expect(sheet1Ranges).toBeDefined();
    expect(sheet1Ranges!.size).toBe(2);

    const cached1 = cache.get('sheet-1' as unknown as SheetId, 'range-1' as unknown as RangeId);
    expect(cached1).toBeDefined();
    expect(cached1!.kind).toBe('Data');
    expect(cached1!.encoding).toBe('F64Le');
    expect(cached1!.rowIds).toEqual(['r0', 'r1']);

    const cached2 = cache.get('sheet-1' as unknown as SheetId, 'range-2' as unknown as RangeId);
    expect(cached2).toBeDefined();
    expect(cached2!.kind).toBe('Format');
    expect(cached2!.encoding).toBe('MixedCbor');
    expect(cached2!.colIds).toEqual(['c0', 'c1']);

    // Sheet 2 has one range
    const sheet2Ranges = cache.getAll('sheet-2' as unknown as SheetId);
    expect(sheet2Ranges).toBeDefined();
    expect(sheet2Ranges!.size).toBe(1);

    const cached3 = cache.get('sheet-2' as unknown as SheetId, 'range-3' as unknown as RangeId);
    expect(cached3).toBeDefined();
    expect(cached3!.kind).toBe('Data');
    expect(cached3!.encoding).toBe('I64Le');
    expect(cached3!.colIds).toEqual(['c0', 'c1', 'c2']);
  });

  // ---------------------------------------------------------------------------
  // 3. Events emitted as range:created for each, with source='user'
  // ---------------------------------------------------------------------------
  it('emits range:created event for each Created change with source user', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta1 = sampleMeta({ rangeId: 'range-A' as unknown as RangeId });
    const meta2 = sampleMeta({ rangeId: 'range-B' as unknown as RangeId });

    const result = buildMutationResult({
      rangeChanges: [
        buildCreatedRangeChange('sheet-1', 'range-A', meta1),
        buildCreatedRangeChange('sheet-2', 'range-B', meta2),
      ],
    });

    // Default source is 'user' — matches hydration behavior
    handler.applyAndNotify(result);

    const rangeCreatedEvents = eventBus.emittedEvents.filter((e) => e.type === 'range:created');
    expect(rangeCreatedEvents).toHaveLength(2);

    expect(rangeCreatedEvents[0].sheetId).toBe('sheet-1');
    expect(rangeCreatedEvents[0].rangeId).toBe('range-A');
    expect(rangeCreatedEvents[0].source).toBe('user');

    expect(rangeCreatedEvents[1].sheetId).toBe('sheet-2');
    expect(rangeCreatedEvents[1].rangeId).toBe('range-B');
    expect(rangeCreatedEvents[1].source).toBe('user');
  });

  // ---------------------------------------------------------------------------
  // 4. Cache survives multiple applyAndNotify calls (incremental hydration)
  // ---------------------------------------------------------------------------
  it('cache accumulates ranges across multiple applyAndNotify calls', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    // First hydration batch
    const meta1 = sampleMeta({
      rangeId: 'range-first' as unknown as RangeId,
      rowIds: ['r0'],
      colIds: ['c0'],
    });
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [buildCreatedRangeChange('sheet-1', 'range-first', meta1)],
      }),
    );

    // Second hydration batch (incremental)
    const meta2 = sampleMeta({
      rangeId: 'range-second' as unknown as RangeId,
      rowIds: ['r1'],
      colIds: ['c1'],
    });
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [buildCreatedRangeChange('sheet-1', 'range-second', meta2)],
      }),
    );

    // Both ranges should be in the cache
    const sheetRanges = cache.getAll('sheet-1' as unknown as SheetId);
    expect(sheetRanges).toBeDefined();
    expect(sheetRanges!.size).toBe(2);

    expect(
      cache.get('sheet-1' as unknown as SheetId, 'range-first' as unknown as RangeId),
    ).toBeDefined();
    expect(
      cache.get('sheet-1' as unknown as SheetId, 'range-second' as unknown as RangeId),
    ).toBeDefined();

    // Events from both calls
    const rangeCreatedEvents = eventBus.emittedEvents.filter((e) => e.type === 'range:created');
    expect(rangeCreatedEvents).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // 5. Verify all RangeMeta fields are stored correctly
  // ---------------------------------------------------------------------------
  it('stores all RangeMeta fields correctly in cache', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta: RangeMeta = {
      rangeId: 'range-full' as unknown as RangeId,
      kind: 'Format' as RangeMeta['kind'],
      anchor: {
        Elastic: { startRow: 'r5', endRow: 'r15', startCol: 'c2', endCol: 'c8' },
      } as RangeMeta['anchor'],
      encoding: 'MixedCbor' as RangeMeta['encoding'],
      rowIds: [
        'row-a',
        'row-b',
        'row-c',
        'row-d',
        'row-e',
        'row-f',
        'row-g',
        'row-h',
        'row-i',
        'row-j',
        'row-k',
      ],
      colIds: ['col-x', 'col-y', 'col-z', 'col-w', 'col-v', 'col-u', 'col-t'],
    };

    const result = buildMutationResult({
      rangeChanges: [buildCreatedRangeChange('sheet-42', 'range-full', meta)],
    });

    handler.applyAndNotify(result);

    const cached = cache.get('sheet-42' as unknown as SheetId, 'range-full' as unknown as RangeId);
    expect(cached).toBeDefined();

    // Verify every field
    expect(cached!.rangeId).toBe('range-full');
    expect(cached!.kind).toBe('Format');
    expect(cached!.anchor).toEqual({
      Elastic: { startRow: 'r5', endRow: 'r15', startCol: 'c2', endCol: 'c8' },
    });
    expect(cached!.encoding).toBe('MixedCbor');
    expect(cached!.rowIds).toEqual([
      'row-a',
      'row-b',
      'row-c',
      'row-d',
      'row-e',
      'row-f',
      'row-g',
      'row-h',
      'row-i',
      'row-j',
      'row-k',
    ]);
    expect(cached!.colIds).toEqual(['col-x', 'col-y', 'col-z', 'col-w', 'col-v', 'col-u', 'col-t']);
  });

  // ---------------------------------------------------------------------------
  // Edge case: no rangeMetadataCache wired — should not throw
  // ---------------------------------------------------------------------------
  it('does not throw when rangeMetadataCache is not set', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    // Note: NOT calling handler.setRangeMetadataCache()

    const meta = sampleMeta();
    const result = buildMutationResult({
      rangeChanges: [buildCreatedRangeChange('sheet-1', 'range-1', meta)],
    });

    // Should not throw — the handler guards with optional chaining
    expect(() => handler.applyAndNotify(result)).not.toThrow();

    // Event should still be emitted even without cache
    const rangeCreatedEvents = eventBus.emittedEvents.filter((e) => e.type === 'range:created');
    expect(rangeCreatedEvents).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Source propagation: remote source maps to 'remote' in event
  // ---------------------------------------------------------------------------
  it('maps remote source correctly in range:created events', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta = sampleMeta({ rangeId: 'range-remote' as unknown as RangeId });
    const result = buildMutationResult({
      rangeChanges: [buildCreatedRangeChange('sheet-1', 'range-remote', meta)],
    });

    handler.applyAndNotify(result, 'remote');

    const rangeCreatedEvents = eventBus.emittedEvents.filter((e) => e.type === 'range:created');
    expect(rangeCreatedEvents).toHaveLength(1);
    expect(rangeCreatedEvents[0].source).toBe('remote');

    // Cache should still be populated regardless of source
    const cached = cache.get('sheet-1' as unknown as SheetId, 'range-remote' as unknown as RangeId);
    expect(cached).toBeDefined();
    expect(cached!.rangeId).toBe('range-remote');
  });
});
