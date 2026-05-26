/**
 * MutationResultHandler — Range Changes
 *
 * Gate tests for the five RangeChangeKind variants:
 *   Created   → cache populated with extent data, event emitted
 *   Removed   → cache cleared (no data decode), event emitted
 *   Replaced  → metadata upserted, event emitted
 *   Reformatted → event only (no cache change, no data decode)
 *   Bound     → event only (no cache change, no data decode)
 *
 * @see mutation-result-handler.ts - handleRangeChanges (lines 806-860)
 * @see wire/range-metadata-cache.ts - RangeMetadataCache + RangeMeta
 */

import { jest } from '@jest/globals';

import type { IEventBus } from '@mog-sdk/contracts/events';
import {
  RangeKind,
  type RangeAnchor,
  type RangeId,
  type SheetId,
  type PayloadEncoding,
} from '@mog-sdk/contracts/core';

import type { MutationResult } from '../compute/compute-bridge';
import type { RangeChange, RangeChangeKind } from '../compute/compute-types.gen';
import { RangeMetadataCache, type RangeMeta } from '../wire/range-metadata-cache';
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

/** Encode a RangeMeta object into the Uint8Array wire format (JSON via TextEncoder). */
function encodeRangeMeta(meta: RangeMeta): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta));
}

/** Build a sample RangeMeta for testing. */
function sampleMeta(overrides: Partial<RangeMeta> = {}): RangeMeta {
  return {
    rangeId: 'range-1' as unknown as RangeId,
    kind: RangeKind.Data,
    anchor: { Strict: { rowIds: ['r1', 'r2'], colIds: ['c1', 'c2'] } } as RangeAnchor,
    encoding: 'F64Le' as PayloadEncoding,
    rowIds: ['r1', 'r2'],
    colIds: ['c1', 'c2'],
    ...overrides,
  };
}

/** Build a RangeChange entry for the given kind. */
function buildRangeChange(
  kind: RangeChangeKind,
  overrides: Partial<Omit<RangeChange, 'kind'>> = {},
): RangeChange {
  const meta = sampleMeta({ rangeId: (overrides.rangeId ?? 'range-1') as unknown as RangeId });
  return {
    sheetId: 'sheet-1',
    rangeId: 'range-1',
    kind,
    // For Created/Replaced the handler decodes this; for others it is ignored.
    data: encodeRangeMeta(meta),
    ...overrides,
  } as RangeChange;
}

// Convenience branded-type casts for cache lookups
const SHEET_1 = 'sheet-1' as unknown as SheetId;
const RANGE_1 = 'range-1' as unknown as RangeId;
const RANGE_2 = 'range-2' as unknown as RangeId;

// =============================================================================
// TESTS
// =============================================================================

describe('MutationResultHandler — Range Changes', () => {
  // ---------------------------------------------------------------------------
  // 1. Created: single range -> cache populated, correct event emitted
  // ---------------------------------------------------------------------------
  it('Created: populates cache with decoded metadata and emits range:created', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta = sampleMeta();
    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Created', { data: encodeRangeMeta(meta) })],
    });

    handler.applyAndNotify(result);

    // Cache is populated
    const cached = cache.get(SHEET_1, RANGE_1);
    expect(cached).toBeDefined();

    // Event emitted
    const event = eventBus.emittedEvents.find((e) => e.type === 'range:created');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect(event!.rangeId).toBe('range-1');
  });

  it('Created: accepts NAPI JSON byte-array payloads for range metadata', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta = sampleMeta({
      rangeId: 'range-napi-array' as unknown as RangeId,
      rowIds: ['r10'],
      colIds: ['c10'],
    });
    const result = buildMutationResult({
      rangeChanges: [
        buildRangeChange('Created', {
          rangeId: 'range-napi-array',
          data: Array.from(encodeRangeMeta(meta)) as unknown as RangeChange['data'],
        }),
      ],
    });

    handler.applyAndNotify(result);

    const cached = cache.get(SHEET_1, 'range-napi-array' as unknown as RangeId);
    expect(cached).toBeDefined();
    expect(cached!.rowIds).toEqual(['r10']);
    expect(cached!.colIds).toEqual(['c10']);
  });

  // ---------------------------------------------------------------------------
  // 2. Created: verify meta has correct fields
  // ---------------------------------------------------------------------------
  it('Created: cached meta has correct rangeId, kind, anchor, encoding, rowIds, colIds', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta: RangeMeta = {
      rangeId: 'range-abc' as unknown as RangeId,
      kind: RangeKind.Table,
      anchor: { Elastic: { startRow: 'sr1', endRow: 'er1', startCol: 'sc1', endCol: 'ec1' } },
      encoding: 'MixedCbor' as PayloadEncoding,
      rowAxis: { StoreRun: { runId: 7, startOffset: 10, len: 3 } },
      colAxis: { Explicit: ['c10'] },
      rowIds: ['r10', 'r20', 'r30'],
      colIds: ['c10'],
    };

    const result = buildMutationResult({
      rangeChanges: [
        buildRangeChange('Created', {
          sheetId: 'sheet-1',
          rangeId: 'range-abc',
          data: encodeRangeMeta(meta),
        }),
      ],
    });

    handler.applyAndNotify(result);

    const cached = cache.get(SHEET_1, 'range-abc' as unknown as RangeId);
    expect(cached).toBeDefined();
    expect(cached!.rangeId).toBe('range-abc');
    expect(cached!.kind).toBe(RangeKind.Table);
    expect(cached!.anchor).toEqual({
      Elastic: { startRow: 'sr1', endRow: 'er1', startCol: 'sc1', endCol: 'ec1' },
    });
    expect(cached!.encoding).toBe('MixedCbor');
    expect(cached!.rowAxis).toEqual({ StoreRun: { runId: 7, startOffset: 10, len: 3 } });
    expect(cached!.colAxis).toEqual({ Explicit: ['c10'] });
    expect(cached!.rowIds).toEqual(['r10', 'r20', 'r30']);
    expect(cached!.colIds).toEqual(['c10']);
  });

  it('Created: throws on unknown compact axis variants instead of caching opaque metadata', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const malformedMeta = {
      ...sampleMeta(),
      rowAxis: { CompactOnly: { runId: 7, startOffset: 0, len: 2 } },
    };
    const result = buildMutationResult({
      rangeChanges: [
        buildRangeChange('Created', {
          data: new TextEncoder().encode(JSON.stringify(malformedMeta)),
        }),
      ],
    });

    expect(() => handler.applyAndNotify(result)).toThrow(/AxisIdentityRef variant/);
    expect(cache.get(SHEET_1, RANGE_1)).toBeUndefined();
  });

  it('Created: throws on malformed compact run refs', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const malformedMeta = {
      ...sampleMeta(),
      rowAxis: { StoreRun: { runId: 7, startOffset: 0 } },
    };
    const result = buildMutationResult({
      rangeChanges: [
        buildRangeChange('Created', {
          data: new TextEncoder().encode(JSON.stringify(malformedMeta)),
        }),
      ],
    });

    expect(() => handler.applyAndNotify(result)).toThrow(/rowAxis\.StoreRun\.len/);
    expect(cache.get(SHEET_1, RANGE_1)).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 3. Replaced: updates existing cache entry, emits range:replaced
  // ---------------------------------------------------------------------------
  it('Replaced: upserts cache entry and emits range:replaced', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    // Seed the cache with an initial entry
    const initialMeta = sampleMeta({ encoding: 'F64Le' as PayloadEncoding });
    cache.set(SHEET_1, RANGE_1, initialMeta);

    // Replace with updated meta
    const updatedMeta = sampleMeta({
      encoding: 'I64Le' as PayloadEncoding,
      rowIds: ['r1', 'r2', 'r3'],
    });
    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Replaced', { data: encodeRangeMeta(updatedMeta) })],
    });

    handler.applyAndNotify(result);

    // Cache is updated
    const cached = cache.get(SHEET_1, RANGE_1);
    expect(cached).toBeDefined();
    expect(cached!.encoding).toBe('I64Le');
    expect(cached!.rowIds).toEqual(['r1', 'r2', 'r3']);

    // Correct event emitted
    const event = eventBus.emittedEvents.find((e) => e.type === 'range:replaced');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect(event!.rangeId).toBe('range-1');

    // No range:created event
    expect(eventBus.emittedEvents.find((e) => e.type === 'range:created')).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 4. Removed: deletes from cache (no JSON.parse on data), emits range:removed
  // ---------------------------------------------------------------------------
  it('Removed: deletes from cache and emits range:removed', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    // Seed the cache
    cache.set(SHEET_1, RANGE_1, sampleMeta());

    // Removed change — data field is present but should NOT be decoded
    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Removed')],
    });

    handler.applyAndNotify(result);

    // Cache entry is deleted
    expect(cache.get(SHEET_1, RANGE_1)).toBeUndefined();

    // Event emitted
    const event = eventBus.emittedEvents.find((e) => e.type === 'range:removed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect(event!.rangeId).toBe('range-1');
  });

  // ---------------------------------------------------------------------------
  // 5. Reformatted: no cache change, emits range:reformatted
  // ---------------------------------------------------------------------------
  it('Reformatted: emits range:reformatted without modifying cache', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    // Seed a cache entry that should remain unchanged
    const existingMeta = sampleMeta();
    cache.set(SHEET_1, RANGE_1, existingMeta);

    const setSpy = jest.spyOn(cache, 'set');
    const deleteSpy = jest.spyOn(cache, 'delete');

    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Reformatted')],
    });

    handler.applyAndNotify(result);

    // Cache is unchanged
    expect(setSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(cache.get(SHEET_1, RANGE_1)).toBe(existingMeta);

    // Event emitted
    const event = eventBus.emittedEvents.find((e) => e.type === 'range:reformatted');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect(event!.rangeId).toBe('range-1');
  });

  // ---------------------------------------------------------------------------
  // 6. Bound: no cache change, emits range:bound
  // ---------------------------------------------------------------------------
  it('Bound: emits range:bound without modifying cache', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    // Seed a cache entry that should remain unchanged
    const existingMeta = sampleMeta();
    cache.set(SHEET_1, RANGE_1, existingMeta);

    const setSpy = jest.spyOn(cache, 'set');
    const deleteSpy = jest.spyOn(cache, 'delete');

    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Bound')],
    });

    handler.applyAndNotify(result);

    // Cache is unchanged
    expect(setSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(cache.get(SHEET_1, RANGE_1)).toBe(existingMeta);

    // Event emitted
    const event = eventBus.emittedEvents.find((e) => e.type === 'range:bound');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect(event!.rangeId).toBe('range-1');
  });

  // ---------------------------------------------------------------------------
  // 7. Multiple changes in one batch
  // ---------------------------------------------------------------------------
  it('handles multiple range changes in a single batch', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    const cache = new RangeMetadataCache();
    handler.setRangeMetadataCache(cache);

    const meta1 = sampleMeta({ rangeId: 'range-1' as unknown as RangeId });
    const meta2 = sampleMeta({ rangeId: 'range-2' as unknown as RangeId });

    const result = buildMutationResult({
      rangeChanges: [
        buildRangeChange('Created', { rangeId: 'range-1', data: encodeRangeMeta(meta1) }),
        buildRangeChange('Created', { rangeId: 'range-2', data: encodeRangeMeta(meta2) }),
        buildRangeChange('Reformatted', { rangeId: 'range-1' }),
      ],
    });

    handler.applyAndNotify(result);

    // Both ranges are cached
    expect(cache.get(SHEET_1, RANGE_1)).toBeDefined();
    expect(cache.get(SHEET_1, RANGE_2)).toBeDefined();

    // Three events emitted: two range:created, one range:reformatted
    const createdEvents = eventBus.emittedEvents.filter((e) => e.type === 'range:created');
    const reformattedEvents = eventBus.emittedEvents.filter((e) => e.type === 'range:reformatted');
    expect(createdEvents).toHaveLength(2);
    expect(reformattedEvents).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 8. Source mapping: 'user' -> 'user', non-'user' -> 'remote'
  // ---------------------------------------------------------------------------
  it('maps source "user" to eventSource "user"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Bound')],
    });

    handler.applyAndNotify(result, 'user');

    const event = eventBus.emittedEvents.find((e) => e.type === 'range:bound');
    expect(event).toBeDefined();
    expect(event!.source).toBe('user');
  });

  it('maps source "remote" to eventSource "remote"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Created')],
    });

    handler.applyAndNotify(result, 'remote');

    const event = eventBus.emittedEvents.find((e) => e.type === 'range:created');
    expect(event).toBeDefined();
    expect(event!.source).toBe('remote');
  });

  // ---------------------------------------------------------------------------
  // 9. Handler works without cache set (no crash)
  // ---------------------------------------------------------------------------
  it('does not crash when rangeMetadataCache is not set', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);
    // Note: NOT calling handler.setRangeMetadataCache()

    const result = buildMutationResult({
      rangeChanges: [
        buildRangeChange('Created'),
        buildRangeChange('Removed'),
        buildRangeChange('Replaced'),
        buildRangeChange('Reformatted'),
        buildRangeChange('Bound'),
      ],
    });

    // Should not throw
    expect(() => handler.applyAndNotify(result)).not.toThrow();

    // Events are still emitted even without a cache
    expect(eventBus.emittedEvents.find((e) => e.type === 'range:created')).toBeDefined();
    expect(eventBus.emittedEvents.find((e) => e.type === 'range:removed')).toBeDefined();
    expect(eventBus.emittedEvents.find((e) => e.type === 'range:replaced')).toBeDefined();
    expect(eventBus.emittedEvents.find((e) => e.type === 'range:reformatted')).toBeDefined();
    expect(eventBus.emittedEvents.find((e) => e.type === 'range:bound')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Event payload completeness — all five kinds carry correct type strings
  // ---------------------------------------------------------------------------
  it('emits events with correct type strings for all five RangeChangeKind variants', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const kinds: RangeChangeKind[] = ['Created', 'Removed', 'Replaced', 'Reformatted', 'Bound'];
    const expectedTypes = [
      'range:created',
      'range:removed',
      'range:replaced',
      'range:reformatted',
      'range:bound',
    ];

    const result = buildMutationResult({
      rangeChanges: kinds.map((kind, i) => buildRangeChange(kind, { rangeId: `range-${i}` })),
    });

    handler.applyAndNotify(result);

    const emittedTypes = eventBus.emittedEvents.map((e) => e.type);
    for (const expectedType of expectedTypes) {
      expect(emittedTypes).toContain(expectedType);
    }
  });

  // ---------------------------------------------------------------------------
  // Event payload fields — timestamp, sheetId, rangeId, source are present
  // ---------------------------------------------------------------------------
  it('event payloads include timestamp, sheetId, rangeId, and source', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      rangeChanges: [buildRangeChange('Created', { sheetId: 'sheet-42', rangeId: 'range-99' })],
    });

    handler.applyAndNotify(result, 'user');

    const event = eventBus.emittedEvents.find((e) => e.type === 'range:created');
    expect(event).toBeDefined();
    expect(event!.timestamp).toEqual(expect.any(Number));
    expect(event!.sheetId).toBe('sheet-42');
    expect(event!.rangeId).toBe('range-99');
    expect(event!.source).toBe('user');
  });
});
