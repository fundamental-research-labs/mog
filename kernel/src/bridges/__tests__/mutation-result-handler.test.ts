/**
 * MutationResultHandler Tests
 *
 * Unified mutation pipeline — all mutations go through applyAndNotify().
 * The old applyStateUpdates() method has been removed; applyAndNotify() is a
 * strict superset that patches state AND emits EventBus events.
 *
 * @see mutation-result-handler.ts - Implementation
 */

import { jest } from '@jest/globals';

import type { IEventBus } from '@mog-sdk/contracts/events';

import type {
  MutationResult,
  DimensionChange,
  RecalcResult,
  FloatingObjectChange,
} from '../compute/compute-bridge';
import { CellMetadataCache } from '../wire/cell-metadata-cache';
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

/** Create a CellMetadataCache with a null workbook (no async fetching needed for tests). */
function createTestCache(): CellMetadataCache {
  return new CellMetadataCache(null);
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
    slicerChanges: undefined,
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

// =============================================================================
// applyStateUpdates has been removed
// =============================================================================

describe('MutationResultHandler — unified pipeline', () => {
  it('applyStateUpdates method no longer exists', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    // The method was removed in verify it does not exist
    expect('applyStateUpdates' in handler).toBe(false);
  });
});

// =============================================================================
// applyAndNotify() — Unified pipeline (state + events)
// =============================================================================

describe('MutationResultHandler.applyAndNotify', () => {
  it('patches projectionChanges on cellMetadataCache (formerly applyStateUpdates behavior)', () => {
    const eventBus = createMockEventBus();

    const cache = createTestCache();

    const handler = new MutationResultHandler(eventBus);
    handler.setCellMetadataCache(cache);

    const patchSpy = jest.spyOn(cache, 'patchProjectionChanges');

    const projectionChanges = [
      {
        sourceCellId: 'cell-1',
        projectionCells: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 1, col: 0 },
          { row: 1, col: 1 },
        ],
      },
    ];

    const result = buildMutationResult({
      recalc: {
        changedCells: [],
        projectionChanges,
      } as unknown as RecalcResult,
    });

    handler.applyAndNotify(result);

    expect(patchSpy).toHaveBeenCalledWith(projectionChanges);
  });

  it('emits pivot update metadata from the active pivot update contract', async () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    await handler.withPivotUpdateOptions(
      { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
      async () => {
        handler.applyAndNotify(
          buildMutationResult({
            pivotChanges: [{ sheetId: 'sheet-1', pivotId: 'pivot-1', kind: 'Set' }],
          }),
        );
      },
    );

    expect(eventBus.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: 'pivot:updated',
        pivotId: 'pivot-1',
        update: { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
      }),
    );
  });

  it('rejects pivot updated events without explicit update metadata', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    expect(() =>
      handler.applyAndNotify(
        buildMutationResult({
          pivotChanges: [{ sheetId: 'sheet-1', pivotId: 'pivot-1', kind: 'Set' }],
        }),
      ),
    ).toThrow(/without PivotUpdateOptions/);
  });

  it('emits EventBus events for dimension changes', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      dimensionChanges: [
        { sheetId: 'sheet-1', axis: 'row', index: 5, kind: 'Set', size: 40 },
        { sheetId: 'sheet-1', axis: 'col', index: 3, kind: 'Set', size: 120 },
      ],
    });

    handler.applyAndNotify(result);

    const rowEvent = eventBus.emittedEvents.find((e) => e.type === 'row:height-changed');
    const colEvent = eventBus.emittedEvents.find((e) => e.type === 'column:width-changed');
    expect(rowEvent).toBeDefined();
    expect(colEvent).toBeDefined();
    expect(rowEvent!.newHeight).toBe(40);
    expect(colEvent!.newWidth).toBe(120);
  });

  it('emits filter shell metadata from filter mutation changes', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    handler.applyAndNotify(
      buildMutationResult({
        filterChanges: [
          {
            sheetId: 'sheet-1',
            filterId: 'filter-1',
            filterKind: 'autoFilter',
            tableId: 'table-1',
            capability: 'unsupported',
            unsupportedReasons: ['iconFilterUnsupported'],
            hasActiveFilter: true,
            clearable: true,
            action: 'applied',
            hiddenRowCount: 0,
            visibleRowCount: 10,
            kind: 'Set',
          },
        ],
      }),
    );

    expect(eventBus.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: 'filter:applied',
        sheetId: 'sheet-1',
        filterId: 'filter-1',
        filterKind: 'autoFilter',
        tableId: 'table-1',
        capability: 'unsupported',
        unsupportedReasons: ['iconFilterUnsupported'],
        hasActiveFilter: true,
        clearable: true,
      }),
    );
  });

  it('performs both state updates and event emission together', () => {
    const eventBus = createMockEventBus();

    const cache = createTestCache();

    const handler = new MutationResultHandler(eventBus);
    handler.setCellMetadataCache(cache);

    const patchSpy = jest.spyOn(cache, 'patchProjectionChanges');

    const projectionChanges = [
      {
        sourceCellId: 'cell-1',
        projectionCells: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
        ],
      },
    ];

    const result = buildMutationResult({
      recalc: {
        changedCells: [
          {
            sheetId: 'sheet-1',
            cellId: 'c1',
            position: { row: 0, col: 0 },
            value: 'hello',
          },
        ],
        projectionChanges,
      } as unknown as RecalcResult,
      dimensionChanges: [{ sheetId: 'sheet-1', axis: 'row', index: 2, kind: 'Set', size: 50 }],
    });

    handler.applyAndNotify(result);

    // State updates happen
    expect(patchSpy).toHaveBeenCalledWith(projectionChanges);

    // Events are also emitted
    expect(eventBus.emittedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('emits cell:changed event for a single cell change', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      recalc: {
        changedCells: [
          {
            sheetId: 'sheet-1',
            cellId: 'c1',
            position: { row: 3, col: 2 },
            value: 'updated',
          },
        ],
        projectionChanges: [],
      } as unknown as RecalcResult,
    });

    handler.applyAndNotify(result);

    const cellEvent = eventBus.emittedEvents.find((e) => e.type === 'cell:changed');
    expect(cellEvent).toBeDefined();
    expect(cellEvent!.sheetId).toBe('sheet-1');
    expect(cellEvent!.row).toBe(3);
    expect(cellEvent!.col).toBe(2);
  });

  it('emits cells:batch-changed event for multiple cell changes on same sheet', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      recalc: {
        changedCells: [
          {
            sheetId: 'sheet-1',
            cellId: 'c1',
            position: { row: 0, col: 0 },
            value: 'a',
          },
          {
            sheetId: 'sheet-1',
            cellId: 'c2',
            position: { row: 1, col: 1 },
            value: 'b',
          },
        ],
        projectionChanges: [],
      } as unknown as RecalcResult,
    });

    handler.applyAndNotify(result);

    const batchEvent = eventBus.emittedEvents.find((e) => e.type === 'cells:batch-changed');
    expect(batchEvent).toBeDefined();
    expect(batchEvent!.sheetId).toBe('sheet-1');
  });

  it('emits cell:changed for a direct edit missing from recalc changedCells', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      recalc: {
        changedCells: [],
        projectionChanges: [],
      } as unknown as RecalcResult,
    });

    handler.applyAndNotify(result, 'user', [{ sheetId: 'sheet-1', row: 0, col: 1 }]);

    const cellEvent = eventBus.emittedEvents.find((e) => e.type === 'cell:changed');
    expect(cellEvent).toBeDefined();
    expect(cellEvent!.sheetId).toBe('sheet-1');
    expect(cellEvent!.row).toBe(0);
    expect(cellEvent!.col).toBe(1);
  });

  it('does not duplicate a direct edit already emitted through recalc changedCells', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      recalc: {
        changedCells: [
          {
            sheetId: 'sheet-1',
            cellId: 'c1',
            position: { row: 0, col: 1 },
            value: 'updated',
          },
        ],
        projectionChanges: [],
      } as unknown as RecalcResult,
    });

    handler.applyAndNotify(result, 'user', [{ sheetId: 'sheet-1', row: 0, col: 1 }]);

    const cellEvents = eventBus.emittedEvents.filter((e) => e.type === 'cell:changed');
    expect(cellEvents).toHaveLength(1);
    expect(cellEvents[0].row).toBe(0);
    expect(cellEvents[0].col).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Resolved-position regression tests
  //
  // Pre-fix behavior: when Rust emitted a CellChange whose position could not
  // be resolved (the old `u32::MAX` sentinel), TS fell back to `{ row: 0,
  // col: 0 }` and emitted a spurious A1 `cell:changed` event. Any UI
  // subscriber acting on cell-change events was mis-painting A1 whenever
  // this happened.
  //
  // Post-fix behavior: `CellChange.position` is `CellPosition | null`, and
  // the handler skips unresolved entries instead of inventing a position.
  // ---------------------------------------------------------------------------

  it('does NOT emit cell:changed for a single unresolved CellChange (D-D7 regression)', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      recalc: {
        changedCells: [
          {
            sheetId: 'sheet-1',
            cellId: 'c-unresolved',
            position: null,
            value: 'ghost',
          },
        ],
        projectionChanges: [],
      } as unknown as RecalcResult,
    });

    handler.applyAndNotify(result);

    // The bug was emitting a spurious A1 event. Assert no cell:changed event
    // was emitted at all — and in particular none with row:0/col:0.
    const cellChangeEvents = eventBus.emittedEvents.filter((e) => e.type === 'cell:changed');
    expect(cellChangeEvents).toHaveLength(0);
    const batchChangeEvents = eventBus.emittedEvents.filter(
      (e) => e.type === 'cells:batch-changed',
    );
    expect(batchChangeEvents).toHaveLength(0);
  });

  it('emits only the resolved change when a batch mixes resolved and unresolved positions', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      recalc: {
        changedCells: [
          {
            sheetId: 'sheet-1',
            cellId: 'c-unresolved',
            position: null,
            value: 'ghost',
          },
          {
            sheetId: 'sheet-1',
            cellId: 'c-resolved',
            position: { row: 5, col: 7 },
            value: 'real',
          },
        ],
        projectionChanges: [],
      } as unknown as RecalcResult,
    });

    handler.applyAndNotify(result);

    // Exactly one resolved change → a single cell:changed event at (5, 7).
    const cellChangeEvents = eventBus.emittedEvents.filter((e) => e.type === 'cell:changed');
    expect(cellChangeEvents).toHaveLength(1);
    expect(cellChangeEvents[0].row).toBe(5);
    expect(cellChangeEvents[0].col).toBe(7);
    // No spurious A1 fallback.
    expect(cellChangeEvents.find((e) => e.row === 0 && e.col === 0)).toBeUndefined();
  });

  it('handlePropertyChanges skips PropertyChange with position: null', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      propertyChanges: [
        {
          sheetId: 'sheet-1',
          cellId: 'c-unresolved',
          position: null,
          kind: 'Set',
          format: { bold: true },
        },
        {
          sheetId: 'sheet-1',
          cellId: 'c-resolved',
          position: { row: 2, col: 3 },
          kind: 'Set',
          format: { italic: true },
        },
      ] as unknown as MutationResult['propertyChanges'],
    });

    handler.applyAndNotify(result);

    const formatEvents = eventBus.emittedEvents.filter((e) => e.type === 'cell:format-changed');
    expect(formatEvents).toHaveLength(1);
    expect(formatEvents[0].row).toBe(2);
    expect(formatEvents[0].col).toBe(3);
  });

  it('emits floatingObject:created event', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      floatingObjectChanges: [
        {
          sheetId: 'sheet-1',
          objectId: 'shape-42',
          objectType: 'shape',
          kind: { type: 'created' },
          data: { id: 'shape-42', type: 'shape' },
          bounds: { x: 10, y: 20, width: 200, height: 100, rotation: 0 },
        },
      ] as unknown as FloatingObjectChange[],
    });

    handler.applyAndNotify(result);

    expect(eventBus.emittedEvents.length).toBeGreaterThanOrEqual(1);
    const createdEvent = eventBus.emittedEvents.find((e) => e.type === 'floatingObject:created');
    expect(createdEvent).toBeDefined();
    expect(createdEvent!.objectId).toBe('shape-42');
    expect(createdEvent!.sheetId).toBe('sheet-1');
  });

  it('emits floatingObject:deleted event for removed objects', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      floatingObjectChanges: [
        {
          sheetId: 'sheet-1',
          objectId: 'shape-99',
          kind: { type: 'removed' },
          data: { id: 'shape-99', type: 'shape' },
        },
      ] as unknown as FloatingObjectChange[],
    });

    handler.applyAndNotify(result);

    const deletedEvent = eventBus.emittedEvents.find((e) => e.type === 'floatingObject:deleted');
    expect(deletedEvent).toBeDefined();
    expect(deletedEvent!.objectId).toBe('shape-99');
  });

  it('emits floatingObject:updated event for updated objects', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      floatingObjectChanges: [
        {
          sheetId: 'sheet-1',
          objectId: 'shape-7',
          kind: { type: 'updated', changedFields: ['fill'] },
          data: { id: 'shape-7', type: 'shape' },
          bounds: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        },
      ] as unknown as FloatingObjectChange[],
    });

    handler.applyAndNotify(result);

    const updatedEvent = eventBus.emittedEvents.find((e) => e.type === 'floatingObject:updated');
    expect(updatedEvent).toBeDefined();
    expect(updatedEvent!.objectId).toBe('shape-7');
  });

  it('handles empty MutationResult without errors', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult();
    handler.applyAndNotify(result);

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('skips projectionChanges patching when cellMetadataCache is not set', () => {
    const eventBus = createMockEventBus();

    const handler = new MutationResultHandler(eventBus);
    // Note: NOT calling handler.setCellMetadataCache()

    const result = buildMutationResult({
      recalc: {
        changedCells: [],
        projectionChanges: [{ sourceCellId: 'cell-1', projectionCells: [{ row: 0, col: 0 }] }],
      } as unknown as RecalcResult,
    });

    // Should not throw
    expect(() => handler.applyAndNotify(result)).not.toThrow();
  });
});

// =============================================================================
// Mutation Event Pipeline Tests
// =============================================================================

describe('MutationResultHandler — slicer events', () => {
  it('emits slicer lifecycle events from slicerChanges', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      slicerChanges: [
        {
          sheetId: 'sheet-1',
          slicerId: 'slicer-1',
          kind: 'created',
          sourceType: 'table',
          sourceId: 'table-1',
        },
        {
          sheetId: 'sheet-1',
          slicerId: 'slicer-1',
          kind: 'updated',
          updatedFields: ['caption', 'zIndex'],
        },
        {
          sheetId: 'sheet-1',
          slicerId: 'slicer-1',
          kind: 'deleted',
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    expect(eventBus.emittedEvents.map((event) => event.type)).toEqual([
      'slicer:created',
      'slicer:updated',
      'slicer:deleted',
    ]);
    expect(eventBus.emittedEvents[0]).toMatchObject({
      sheetId: 'sheet-1',
      slicerId: 'slicer-1',
      sourceType: 'table',
      sourceId: 'table-1',
      source: 'user',
    });
    expect(eventBus.emittedEvents[1]).toMatchObject({
      updatedFields: ['caption', 'zIndex'],
      source: 'user',
    });
  });

  it('emits slicer selection events with final selected values and deterministic change type', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    handler.applyAndNotify(
      buildMutationResult({
        slicerChanges: [
          {
            sheetId: 'sheet-1',
            slicerId: 'slicer-1',
            kind: 'selectionChanged',
            selectedValues: ['West'],
            selectionChangeType: 'toggle',
          },
          {
            sheetId: 'sheet-1',
            slicerId: 'slicer-1',
            kind: 'selectionChanged',
            selectedValues: [],
            selectionChangeType: 'clear',
          },
        ],
      } as Partial<MutationResult>),
    );

    expect(eventBus.emittedEvents).toEqual([
      expect.objectContaining({
        type: 'slicer:selectionChanged',
        selectedValues: ['West'],
        changeType: 'toggle',
      }),
      expect.objectContaining({
        type: 'slicer:selectionChanged',
        selectedValues: [],
        changeType: 'clear',
      }),
    ]);
  });

  it('maps remote slicer lifecycle changes to remote source', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    handler.applyAndNotify(
      buildMutationResult({
        slicerChanges: [
          {
            sheetId: 'sheet-1',
            slicerId: 'slicer-1',
            kind: 'created',
            data: {
              id: 'slicer-1',
              sheetId: 'sheet-1',
              source: { type: 'pivot', pivotId: 'pivot-1', fieldName: 'Region' },
            },
          },
        ],
      } as Partial<MutationResult>),
      'remote',
    );

    expect(eventBus.emittedEvents[0]).toMatchObject({
      type: 'slicer:created',
      sourceType: 'pivot',
      sourceId: 'pivot-1',
      source: 'remote',
    });
  });
});

describe('MutationResultHandler — sheet:colorChanged events', () => {
  it('emits sheet:colorChanged with correct color values when setting a color', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'tabColor',
          color: '#ff0000',
          oldColor: undefined,
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const colorEvent = eventBus.emittedEvents.find((e) => e.type === 'sheet:colorChanged');
    expect(colorEvent).toBeDefined();
    expect(colorEvent!.sheetId).toBe('sheet-1');
    expect(colorEvent!.newColor).toBe('#ff0000');
    expect(colorEvent!.oldColor).toBeNull();
  });

  it('emits sheet:colorChanged with old and new colors when changing color', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'tabColor',
          color: '#00ff00',
          oldColor: '#ff0000',
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const colorEvent = eventBus.emittedEvents.find((e) => e.type === 'sheet:colorChanged');
    expect(colorEvent).toBeDefined();
    expect(colorEvent!.newColor).toBe('#00ff00');
    expect(colorEvent!.oldColor).toBe('#ff0000');
  });

  it('emits sheet:colorChanged with null newColor when clearing color', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'tabColor',
          color: undefined,
          oldColor: '#ff0000',
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const colorEvent = eventBus.emittedEvents.find((e) => e.type === 'sheet:colorChanged');
    expect(colorEvent).toBeDefined();
    expect(colorEvent!.newColor).toBeNull();
    expect(colorEvent!.oldColor).toBe('#ff0000');
  });
});

describe('MutationResultHandler — handles all SheetChangeField variants', () => {
  it('emits sheet:created for field "sheet" with kind "Set"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-new',
          kind: 'Set',
          field: 'sheet',
          name: 'NewSheet',
          index: 1,
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'sheet:created');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-new');
    expect(event!.name).toBe('NewSheet');
  });

  it('emits sheet:deleted for field "sheet" with kind "Removed"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-del',
          kind: 'Removed',
          field: 'sheet',
          name: 'OldSheet',
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'sheet:deleted');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-del');
  });

  it('emits sheet:renamed for field "name"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'name',
          name: 'NewName',
          oldName: 'OldName',
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'sheet:renamed');
    expect(event).toBeDefined();
    expect(event!.newName).toBe('NewName');
    expect(event!.oldName).toBe('OldName');
  });

  it('emits sheet:moved for field "order"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'order',
          index: 2,
          oldIndex: 0,
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'sheet:moved');
    expect(event).toBeDefined();
    expect(event!.toIndex).toBe(2);
    expect(event!.fromIndex).toBe(0);
  });

  it('emits sheet:visibilityChanged for field "hidden"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'hidden',
          hidden: true,
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'sheet:visibilityChanged');
    expect(event).toBeDefined();
    expect(event!.hidden).toBe(true);
  });

  it('emits freeze:changed for field "frozen"', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'frozen',
          frozenRows: 3,
          frozenCols: 2,
          oldFrozenRows: 0,
          oldFrozenCols: 0,
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'freeze:changed');
    expect(event).toBeDefined();
    expect(event!.newFrozenRows).toBe(3);
    expect(event!.newFrozenCols).toBe(2);
  });
});

// =============================================================================
// Direct workbook/sheet state coverage — kernel-state-mirror direct state coverage
// =============================================================================
//
// Regression tests for the seven new MutationResult families that the Rust
// contract (commit 8747f39e3) added: pageBreakChanges, printAreaChanges,
// printTitlesChanges, printSettingsChanges, splitConfigChanges,
// scrollPositionChanges, workbookSettingsChanges. Each test sends a synthetic
// MutationResult containing only one family and asserts the dispatcher
// emits the right normalized direct-state event(s).
//
// Plus: apply-then-emit ordering coverage for the state mirror.
// =============================================================================

describe('MutationResultHandler.applyAndNotify — direct state coverage', () => {
  // ---------------------------------------------------------------------------
  // pageBreakChanges -> 'print:page-breaks-changed'
  // ---------------------------------------------------------------------------
  it('emits print:page-breaks-changed for pageBreakChanges', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      pageBreakChanges: [
        {
          sheetId: 'sheet-1',
          breaks: {
            rowBreaks: [{ id: 5, max: 100, manual: true }],
            colBreaks: [{ id: 3, max: 200, manual: false, pt: true }],
          },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'print:page-breaks-changed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    // Wire-shape normalization: skip-if-zero `min` and skip-if-false `pt`
    // come back as defaults (0 / false) at the bridge boundary.
    expect((event!.rowBreaks as Array<{ id: number; min: number; pt: boolean }>)[0]).toMatchObject({
      id: 5,
      min: 0,
      pt: false,
    });
    expect((event!.colBreaks as Array<{ id: number; min: number; pt: boolean }>)[0]).toMatchObject({
      id: 3,
      min: 0,
      pt: true,
    });
  });

  // ---------------------------------------------------------------------------
  // printAreaChanges -> 'print:area-changed'
  // ---------------------------------------------------------------------------
  it('emits print:area-changed with payload for kind=Set', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      printAreaChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          area: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'print:area-changed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect(event!.printArea).toMatchObject({ startRow: 0, endRow: 9, endCol: 4 });
  });

  it('emits print:area-changed with null payload for kind=Removed', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      printAreaChanges: [{ sheetId: 'sheet-1', kind: 'Removed' }],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'print:area-changed');
    expect(event).toBeDefined();
    expect(event!.printArea).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // printTitlesChanges -> 'print:titles-changed'
  // ---------------------------------------------------------------------------
  it('emits print:titles-changed for printTitlesChanges', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      printTitlesChanges: [
        {
          sheetId: 'sheet-1',
          titles: { repeatRows: [0, 0], repeatCols: [0, 1] },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'print:titles-changed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect(event!.printTitles).toMatchObject({ repeatRows: [0, 0], repeatCols: [0, 1] });
  });

  // ---------------------------------------------------------------------------
  // printSettingsChanges -> 'sheet:print-settings-changed'
  // ---------------------------------------------------------------------------
  it('emits sheet:print-settings-changed for printSettingsChanges', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      printSettingsChanges: [
        {
          sheetId: 'sheet-1',
          settings: {
            paperSize: null,
            orientation: 'landscape',
            scale: 100,
            fitToWidth: null,
            fitToHeight: null,
            gridlines: false,
            headings: true,
            hCentered: false,
            vCentered: false,
            margins: null,
            headerFooter: null,
            blackAndWhite: false,
            draft: false,
            firstPageNumber: null,
            hasPrintOptions: true,
            useFirstPageNumber: false,
            hasPageSetup: true,
          },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'sheet:print-settings-changed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect((event!.settings as { orientation: string }).orientation).toBe('landscape');
    expect((event!.settings as { headings: boolean }).headings).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // splitConfigChanges -> 'split:position-changed' / 'split:removed'
  // ---------------------------------------------------------------------------
  it('emits split:position-changed when splitConfigChanges sets a config', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      splitConfigChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          config: {
            direction: 'both',
            horizontalPosition: 100,
            verticalPosition: 200,
          },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'split:position-changed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    expect((event!.config as { horizontalPosition: number }).horizontalPosition).toBe(100);
  });

  it('emits split:removed when splitConfigChanges removes a config', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      splitConfigChanges: [{ sheetId: 'sheet-1', kind: 'Removed' }],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'split:removed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
  });

  // ---------------------------------------------------------------------------
  // scrollPositionChanges -> 'scroll:changed'
  // ---------------------------------------------------------------------------
  it('emits scroll:changed for scrollPositionChanges', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      scrollPositionChanges: [{ sheetId: 'sheet-1', topRow: 10, leftCol: 5 }],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'scroll:changed');
    expect(event).toBeDefined();
    expect(event!.sheetId).toBe('sheet-1');
    // scroll:changed carries scrollX/scrollY; map left -> X, top -> Y so
    // existing renderer subscriptions don't have to switch axis names.
    expect(event!.scrollX).toBe(5);
    expect(event!.scrollY).toBe(10);
  });

  // ---------------------------------------------------------------------------
  // workbookSettingsChanges -> 'workbook:settings-changed' (one event per key)
  // ---------------------------------------------------------------------------
  it('emits one workbook:settings-changed event per changed key', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      workbookSettingsChanges: [
        {
          kind: 'Set',
          changedKeys: ['date1904', 'culture'],
          settings: { date1904: true, culture: 'en-US' },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const events = eventBus.emittedEvents.filter((e) => e.type === 'workbook:settings-changed');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.changedKey)).toEqual(['date1904', 'culture']);
  });

  // ---------------------------------------------------------------------------
  // Semantic re-emission: settingsChanges with a view-option key emits both
  // 'sheet:settings-changed' AND 'view:options-changed'.
  // ---------------------------------------------------------------------------
  it('re-emits view:options-changed when settingsChanges carries a view-option key', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const settings = {
      showGridlines: false,
      showRowHeaders: true,
      showColumnHeaders: true,
      isProtected: false,
      showZeroValues: true,
      gridlineColor: '#e2e2e2',
      rightToLeft: false,
      defaultRowHeight: 21,
      defaultColWidth: 100,
    };

    const result = buildMutationResult({
      settingsChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          changedKey: 'showGridlines',
          settings,
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const sheetSettingsEvent = eventBus.emittedEvents.find(
      (e) => e.type === 'sheet:settings-changed',
    );
    const viewOptionsEvent = eventBus.emittedEvents.find((e) => e.type === 'view:options-changed');
    expect(sheetSettingsEvent).toBeDefined();
    expect(viewOptionsEvent).toBeDefined();
    expect(viewOptionsEvent!.sheetId).toBe('sheet-1');
    expect(viewOptionsEvent!.showGridlines).toBe(false);
  });

  it('does NOT re-emit view:options-changed for non-view setting keys', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      settingsChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          changedKey: 'isProtected',
          settings: {
            showGridlines: true,
            showRowHeaders: true,
            showColumnHeaders: true,
            isProtected: true,
            showZeroValues: true,
            gridlineColor: '#e2e2e2',
            rightToLeft: false,
            defaultRowHeight: 21,
            defaultColWidth: 100,
          },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const viewOptionsEvent = eventBus.emittedEvents.find((e) => e.type === 'view:options-changed');
    expect(viewOptionsEvent).toBeUndefined();
  });

  it('normalizes protectionDetails setting changes to protectionOptions events', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      settingsChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          changedKey: 'protectionDetails',
          settings: {
            showGridlines: true,
            showRowHeaders: true,
            showColumnHeaders: true,
            isProtected: true,
            showZeroValues: true,
            gridlineColor: '#e2e2e2',
            rightToLeft: false,
            protectionOptions: {
              selectLockedCells: true,
              selectUnlockedCells: true,
            },
            defaultRowHeight: 21,
            defaultColWidth: 100,
          },
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const sheetSettingsEvent = eventBus.emittedEvents.find(
      (e) => e.type === 'sheet:settings-changed',
    );
    expect(sheetSettingsEvent).toBeDefined();
    expect(sheetSettingsEvent!.changedKey).toBe('protectionOptions');
  });

  // ---------------------------------------------------------------------------
  // Apply-then-emit ordering scaffold (step 2 of mirror-and-hook-migration.md
  // pillar 1). Today the dispatcher's per-variant `mirror.apply` slot is a
  // TODO comment because the mirror doesn't exist; the test below pins the
  // contract that handlers reading post-apply state see the post-apply value.
  // When step 2 lands the mirror, this test plugs in the real getter and
  // becomes a load-bearing regression for the "emit before apply" reorder
  // class of bug.
  // ---------------------------------------------------------------------------
  it('observes the post-apply state when subscribing to a normalized event (scaffold)', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    // Today the "apply" step is the TS-side dispatcher itself; the mirror
    // hasn't landed. Subscribe to print:area-changed and verify the event
    // payload carries the post-apply area. Step 2 will replace this assertion
    // with `expect(ctx.mirror.getPrintArea(sheetId)).toEqual(area)`.
    let observedPrintArea: unknown = 'NOT_OBSERVED';
    eventBus.emit = jest.fn((event: { type: string; printArea?: unknown }) => {
      if (event.type === 'print:area-changed') {
        observedPrintArea = event.printArea;
      }
    }) as unknown as typeof eventBus.emit;

    const area = { startRow: 1, startCol: 2, endRow: 3, endCol: 4 };
    const result = buildMutationResult({
      printAreaChanges: [{ sheetId: 'sheet-1', kind: 'Set', area }],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    expect(observedPrintArea).toEqual(area);
  });
});

describe('SheetId branding — compile-time type safety', () => {
  it('sheetId() constructor returns a branded SheetId', async () => {
    // This test verifies the runtime behavior of the SheetId branding.
    // The compile-time safety is enforced by TypeScript: a plain `string`
    // cannot be assigned to `SheetId` without going through `sheetId()`.
    const { sheetId } = await import('@mog-sdk/contracts/core');
    const id = sheetId('550e8400-e29b-41d4-a716-446655440000');

    // At runtime, SheetId is still a string
    expect(typeof id).toBe('string');
    expect(id).toBe('550e8400-e29b-41d4-a716-446655440000');

    // The branded type prevents this at compile time:
    //   const rawString: string = 'foo';
    //   const badId: SheetId = rawString; // TS error: Type 'string' is not assignable to type 'SheetId'
    //
    // Only this works:
    //   const goodId: SheetId = sheetId('foo'); // OK
  });
});
