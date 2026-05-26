/**
 * Range Changes — Undo/Redo Gate Tests
 *
 * Verifies that undo and redo of Range mutations flow through the same
 * `applyAndNotify()` pipeline as forward mutations. The TS undo system
 * delegates to Rust (`computeBridge.undo()`), which returns a full
 * `MutationResult` — so `rangeChanges` reach `handleRangeChanges`
 * automatically. No special TS-side undo handler is needed.
 *
 * Gate criteria:
 *   - Create Range -> undo -> rangesBySheet cleared (cache entry removed)
 *   - The undo MutationResult flows through the same applyAndNotify() path
 */

import { jest } from '@jest/globals';

import type { IEventBus } from '@mog-sdk/contracts/events';
import type { RangeId, SheetId } from '@mog-sdk/contracts/core';

import type { MutationResult } from '../compute/compute-bridge';
import { MutationResultHandler } from '../mutation-result-handler';
import { RangeMetadataCache } from '../wire/range-metadata-cache';
import type { RangeMeta } from '../wire/range-metadata-cache';

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

/** Encode a RangeMeta-shaped object as a Uint8Array JSON payload. */
function encodeRangeMeta(meta: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta));
}

/** Helper to create a RangeMeta object with sensible defaults. */
function makeRangeMeta(overrides: Partial<RangeMeta> = {}): RangeMeta {
  return {
    rangeId: 'range-1' as unknown as RangeId,
    kind: 'Data' as RangeMeta['kind'],
    anchor: {
      Elastic: { startRow: 'r0', endRow: 'r9', startCol: 'c0', endCol: 'c4' },
    } as RangeMeta['anchor'],
    encoding: 'F64Le' as RangeMeta['encoding'],
    rowIds: ['r0', 'r1'],
    colIds: ['c0', 'c1'],
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Range changes — undo/redo through applyAndNotify()', () => {
  // ---------------------------------------------------------------------------
  // 1. Create -> undo (Removed) -> cache cleared, range:removed event emitted
  // ---------------------------------------------------------------------------
  it('Create -> undo (Removed): cache entry removed and range:removed emitted', () => {
    const eventBus = createMockEventBus();
    const cache = new RangeMetadataCache();
    const handler = new MutationResultHandler(eventBus);
    handler.setRangeMetadataCache(cache);

    const sheetId = 'sheet-1' as unknown as SheetId;
    const rangeId = 'range-1' as unknown as RangeId;
    const meta = makeRangeMeta({ rangeId });

    // Step 1: Forward mutation — Create
    const createResult = buildMutationResult({
      rangeChanges: [
        {
          sheetId: sheetId as unknown as string,
          rangeId: rangeId as unknown as string,
          kind: 'Created',
          data: encodeRangeMeta(meta),
        },
      ],
    });
    handler.applyAndNotify(createResult);

    // Verify cache populated
    expect(cache.get(sheetId, rangeId)).toEqual(meta);
    expect(eventBus.emittedEvents.find((e) => e.type === 'range:created')).toBeDefined();

    // Step 2: Undo — Rust returns MutationResult with kind='Removed'
    eventBus.emittedEvents.length = 0;
    const undoResult = buildMutationResult({
      rangeChanges: [
        {
          sheetId: sheetId as unknown as string,
          rangeId: rangeId as unknown as string,
          kind: 'Removed',
          data: new Uint8Array(0),
        },
      ],
    });
    handler.applyAndNotify(undoResult);

    // Cache cleared — the range no longer exists
    expect(cache.get(sheetId, rangeId)).toBeUndefined();
    // The sheet-level map is also cleaned up (no empty maps lingering)
    expect(cache.getAll(sheetId)).toBeUndefined();

    // range:removed event emitted
    const removedEvent = eventBus.emittedEvents.find((e) => e.type === 'range:removed');
    expect(removedEvent).toBeDefined();
    expect(removedEvent!.sheetId).toBe(sheetId);
    expect(removedEvent!.rangeId).toBe(rangeId);
  });

  // ---------------------------------------------------------------------------
  // 2. Create -> undo (Removed) -> redo (Created) -> cache re-populated
  // ---------------------------------------------------------------------------
  it('Create -> undo -> redo: cache re-populated and range:created emitted on redo', () => {
    const eventBus = createMockEventBus();
    const cache = new RangeMetadataCache();
    const handler = new MutationResultHandler(eventBus);
    handler.setRangeMetadataCache(cache);

    const sheetId = 'sheet-1' as unknown as SheetId;
    const rangeId = 'range-1' as unknown as RangeId;
    const meta = makeRangeMeta({ rangeId });

    // Forward: Create
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId as unknown as string,
            kind: 'Created',
            data: encodeRangeMeta(meta),
          },
        ],
      }),
    );
    expect(cache.get(sheetId, rangeId)).toBeDefined();

    // Undo: Removed
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId as unknown as string,
            kind: 'Removed',
            data: new Uint8Array(0),
          },
        ],
      }),
    );
    expect(cache.get(sheetId, rangeId)).toBeUndefined();

    // Redo: Created again
    eventBus.emittedEvents.length = 0;
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId as unknown as string,
            kind: 'Created',
            data: encodeRangeMeta(meta),
          },
        ],
      }),
    );

    // Cache re-populated
    expect(cache.get(sheetId, rangeId)).toEqual(meta);

    // range:created event emitted on redo
    const createdEvent = eventBus.emittedEvents.find((e) => e.type === 'range:created');
    expect(createdEvent).toBeDefined();
    expect(createdEvent!.sheetId).toBe(sheetId);
    expect(createdEvent!.rangeId).toBe(rangeId);
  });

  // ---------------------------------------------------------------------------
  // 3. Replace -> undo returns original Created -> cache has original metadata
  // ---------------------------------------------------------------------------
  it('Replace -> undo (Created with original data): cache restored to original metadata', () => {
    const eventBus = createMockEventBus();
    const cache = new RangeMetadataCache();
    const handler = new MutationResultHandler(eventBus);
    handler.setRangeMetadataCache(cache);

    const sheetId = 'sheet-1' as unknown as SheetId;
    const rangeId = 'range-1' as unknown as RangeId;

    const originalMeta = makeRangeMeta({
      rangeId,
      rowIds: ['r0', 'r1', 'r2'],
      colIds: ['c0', 'c1'],
    });

    const replacedMeta = makeRangeMeta({
      rangeId,
      rowIds: ['r0', 'r1', 'r2', 'r3', 'r4'],
      colIds: ['c0', 'c1', 'c2'],
    });

    // Step 1: Initial Create
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId as unknown as string,
            kind: 'Created',
            data: encodeRangeMeta(originalMeta),
          },
        ],
      }),
    );
    expect(cache.get(sheetId, rangeId)).toEqual(originalMeta);

    // Step 2: Forward mutation — Replace (e.g., range resized)
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId as unknown as string,
            kind: 'Replaced',
            data: encodeRangeMeta(replacedMeta),
          },
        ],
      }),
    );
    expect(cache.get(sheetId, rangeId)).toEqual(replacedMeta);

    // Step 3: Undo — Rust returns the original metadata via Created
    // (undo of a replace restores the previous version)
    eventBus.emittedEvents.length = 0;
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId as unknown as string,
            kind: 'Replaced',
            data: encodeRangeMeta(originalMeta),
          },
        ],
      }),
    );

    // Cache has the original metadata restored
    const cached = cache.get(sheetId, rangeId);
    expect(cached).toEqual(originalMeta);
    expect(cached!.rowIds).toEqual(['r0', 'r1', 'r2']);
    expect(cached!.colIds).toEqual(['c0', 'c1']);

    // range:replaced event emitted for the undo
    const replacedEvent = eventBus.emittedEvents.find((e) => e.type === 'range:replaced');
    expect(replacedEvent).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 4. Multiple ranges: create two -> undo one -> only the undone range removed
  // ---------------------------------------------------------------------------
  it('Two ranges created, undo removes only one: other range remains in cache', () => {
    const eventBus = createMockEventBus();
    const cache = new RangeMetadataCache();
    const handler = new MutationResultHandler(eventBus);
    handler.setRangeMetadataCache(cache);

    const sheetId = 'sheet-1' as unknown as SheetId;
    const rangeId1 = 'range-1' as unknown as RangeId;
    const rangeId2 = 'range-2' as unknown as RangeId;

    const meta1 = makeRangeMeta({
      rangeId: rangeId1,
      rowIds: ['r0'],
      colIds: ['c0'],
    });
    const meta2 = makeRangeMeta({
      rangeId: rangeId2,
      rowIds: ['r10', 'r11'],
      colIds: ['c10', 'c11'],
    });

    // Create both ranges (could be in the same MutationResult or separate)
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId1 as unknown as string,
            kind: 'Created',
            data: encodeRangeMeta(meta1),
          },
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId2 as unknown as string,
            kind: 'Created',
            data: encodeRangeMeta(meta2),
          },
        ],
      }),
    );

    // Both in cache
    expect(cache.get(sheetId, rangeId1)).toEqual(meta1);
    expect(cache.get(sheetId, rangeId2)).toEqual(meta2);

    // Undo removes only range-1
    eventBus.emittedEvents.length = 0;
    handler.applyAndNotify(
      buildMutationResult({
        rangeChanges: [
          {
            sheetId: sheetId as unknown as string,
            rangeId: rangeId1 as unknown as string,
            kind: 'Removed',
            data: new Uint8Array(0),
          },
        ],
      }),
    );

    // range-1 removed
    expect(cache.get(sheetId, rangeId1)).toBeUndefined();

    // range-2 still present
    expect(cache.get(sheetId, rangeId2)).toEqual(meta2);

    // Sheet-level map still exists (because range-2 is there)
    const sheetMap = cache.getAll(sheetId);
    expect(sheetMap).toBeDefined();
    expect(sheetMap!.size).toBe(1);
    expect(sheetMap!.has(rangeId2)).toBe(true);

    // Only range:removed for range-1
    const removedEvents = eventBus.emittedEvents.filter((e) => e.type === 'range:removed');
    expect(removedEvents).toHaveLength(1);
    expect(removedEvents[0].rangeId).toBe(rangeId1);
  });
});
