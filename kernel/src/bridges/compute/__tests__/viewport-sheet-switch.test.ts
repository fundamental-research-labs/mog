/**
 * viewport-sheet-switch.test.ts
 *
 * Tests sheet-switch viewport behavior with sheet-scoped viewport IDs.
 *
 * The fix: viewport IDs are composed as `${role}:${sheetId}` (e.g., "main:sheet-1"),
 * so each (role, sheet) pair gets its own prefetch state and buffer entry.
 * Cross-sheet stale data is structurally impossible.
 */

// Polyfill window for devtools reporting in BinaryViewportBuffer
import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import { sheetId } from '@mog-sdk/contracts/core';

import { buildTestViewportBuffer } from '../../wire/viewport-test-builder';
import { ComputeCore } from '../compute-core';
import type { MutationResult } from '../compute-types.gen';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockTransport(): BridgeTransport & { call: jest.Mock } {
  const sheet1Buffer = buildTestViewportBuffer({
    rows: 100,
    cols: 40,
    startRow: 0,
    startCol: 0,
    cells: [{ display: 'Sheet1 Data' }],
  });

  const sheet2Buffer = buildTestViewportBuffer({
    rows: 100,
    cols: 40,
    startRow: 0,
    startCol: 0,
    cells: [{ display: 'Sheet2 Data' }],
  });

  return {
    call: jest.fn(async (_command: string, args: Record<string, unknown>): Promise<any> => {
      if (args.sheetId === 'sheet-2') {
        return sheet2Buffer;
      }
      return sheet1Buffer;
    }),
  };
}

function makeMockContext(): IKernelContext {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
    mirror: {
      apply: jest.fn(),
      getViewOptions: jest.fn(() => ({ showFormulas: false })),
    },
  } as any;
}

function createStartedCore(transport: BridgeTransport): ComputeCore {
  const ctx = makeMockContext();
  const core = new ComputeCore(ctx, 'test-doc', transport);
  // Bypass lifecycle to reach STARTED phase directly
  (core as any)._phase = 'STARTED';
  return core;
}

function makeRecalcResult(overrides?: Record<string, unknown>) {
  return {
    changedCells: [],
    projectionChanges: [],
    errors: [],
    validationAnnotations: [],
    metrics: {},
    oldValues: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('refreshViewportForRegion — sheet-scoped viewport IDs', () => {
  const bounds = { startRow: 0, startCol: 0, endRow: 50, endCol: 20 };

  it('sheet-scoped IDs naturally fetch from Rust on sheet switch', async () => {
    const transport = makeMockTransport();
    const core = createStartedCore(transport);

    // First call — "main:sheet-1" registers and fetches from Rust
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);
    expect(transport.call).toHaveBeenCalledWith(
      'compute_register_viewport',
      expect.objectContaining({ viewportId: 'main:sheet-1', sheetId: 'sheet-1' }),
    );
    expect(transport.call).toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.objectContaining({ sheetId: 'sheet-1' }),
    );

    transport.call.mockClear();

    // Second call — "main:sheet-2" is a different viewport ID, so it misses
    // in perViewportState and always fetches from Rust. No stale data possible.
    await core.refreshViewportForRegion('main:sheet-2', sheetId('sheet-2'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);
    expect(transport.call).toHaveBeenCalledWith(
      'compute_register_viewport',
      expect.objectContaining({ viewportId: 'main:sheet-2', sheetId: 'sheet-2' }),
    );
    expect(transport.call).toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.objectContaining({ sheetId: 'sheet-2' }),
    );
  });

  it('skips data fetch when same sheet and bounds are within prefetch', async () => {
    const transport = makeMockTransport();
    const core = createStartedCore(transport);

    // Initial fetch for sheet-1 with bounds that create a prefetch region
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), {
      startRow: 0,
      startCol: 0,
      endRow: 50,
      endCol: 20,
    });
    expect(transport.call).toHaveBeenCalledTimes(2);

    transport.call.mockClear();

    // Second call — same sheet-scoped ID, bounds strictly within the prefetch region
    // (prefetch = visible + 50 rows overscan + 20 cols overscan)
    // So {5,5,45,15} is well within {0,0,100,40} prefetch
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), {
      startRow: 5,
      startCol: 5,
      endRow: 45,
      endCol: 15,
    });

    // Should re-register the live viewport ID, but skip data fetch.
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(transport.call).toHaveBeenCalledWith(
      'compute_register_viewport',
      expect.objectContaining({ viewportId: 'main:sheet-1', sheetId: 'sheet-1' }),
    );
    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.anything(),
    );
  });

  it('calls transport again after clearPerViewportState', async () => {
    const transport = makeMockTransport();
    const core = createStartedCore(transport);

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);

    transport.call.mockClear();

    // Clear all viewport state
    core.clearPerViewportState();

    // Same sheet and bounds — should fetch again because state was cleared
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);
  });

  it('calls transport again after invalidateAllViewportPrefetch', async () => {
    const transport = makeMockTransport();
    const core = createStartedCore(transport);

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);

    transport.call.mockClear();

    // Invalidate prefetch bounds (nullifies them without destroying viewport state)
    core.invalidateAllViewportPrefetch();

    // Same sheet and bounds — should fetch again because prefetch was invalidated
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);
  });

  it('switching back to a previously viewed sheet reuses cached buffer without fetching', async () => {
    const transport = makeMockTransport();
    const core = createStartedCore(transport);

    // Visit sheet-1
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);

    // Visit sheet-2
    await core.refreshViewportForRegion('main:sheet-2', sheetId('sheet-2'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(4);

    transport.call.mockClear();

    // Switch BACK to sheet-1 — "main:sheet-1" still has valid prefetch state,
    // so the data fetch should be skipped (cache reuse).
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(transport.call).toHaveBeenCalledWith(
      'compute_register_viewport',
      expect.objectContaining({ viewportId: 'main:sheet-1', sheetId: 'sheet-1' }),
    );
    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.anything(),
    );
  });

  it('switch-back sets visible window to real bounds (not zero)', async () => {
    const transport = makeMockTransport();
    const core = createStartedCore(transport);

    // Visit sheet-1 with real bounds — fetches data and sets prefetch
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(2);

    // Visit sheet-2
    await core.refreshViewportForRegion('main:sheet-2', sheetId('sheet-2'), bounds);
    expect(transport.call).toHaveBeenCalledTimes(4);

    transport.call.mockClear();

    // Switch BACK to sheet-1 with real bounds (ViewportRegionImpl now caches
    // its bounds and passes them to refresh, instead of dummy {0,0,0,0}).
    // The perViewportState for "main:sheet-1" exists from the first visit.
    // The bounds are within the prefetch, so no data fetch is needed — but the
    // visible window must be set to the real bounds so the renderer displays data.
    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);

    // Only registration is refreshed (prefetch containment passes) — cache reuse works.
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(transport.call).toHaveBeenCalledWith(
      'compute_register_viewport',
      expect.objectContaining({ viewportId: 'main:sheet-1', sheetId: 'sheet-1' }),
    );
    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.anything(),
    );

    // Visible window has real bounds — renderer can display data
    const buf = core.getViewportBuffer('main:sheet-1');
    const visibleWindow = buf!.getVisibleWindow();
    expect(visibleWindow).toEqual(
      expect.objectContaining({
        startRow: bounds.startRow,
        startCol: bounds.startCol,
        endRow: bounds.endRow,
        endCol: bounds.endCol,
      }),
    );
  });

  it('fullRecalc refreshes registered viewport buffers when formula values changed', async () => {
    const initialBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'stale' }],
    });
    const refreshedBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'fresh' }],
    });
    const transport = {
      call: jest.fn(async (command: string, args: Record<string, unknown>): Promise<any> => {
        if (command === 'compute_full_recalc') {
          return makeRecalcResult({
            changedCells: [
              {
                sheetId: 'sheet-1',
                cellId: 'cell-1',
                position: { row: 0, col: 0 },
                value: { kind: 'number', value: 2 },
                displayText: '2',
              },
            ],
          });
        }
        if (command === 'compute_get_all_sheet_ids') {
          return [];
        }
        if (command === 'compute_get_viewport_binary') {
          return args.startRow === 0 && args.endRow === 101 ? initialBuffer : refreshedBuffer;
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const core = createStartedCore(transport);

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    transport.call.mockClear();
    (core as any)._phase = 'CONTEXT_SET';

    await core.fullRecalc();

    expect(transport.call).toHaveBeenCalledWith(
      'compute_full_recalc',
      expect.objectContaining({ docId: 'test-doc', options: {} }),
    );
    expect(transport.call).toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.objectContaining({
        docId: 'test-doc',
        sheetId: 'sheet-1',
        startRow: 0,
        startCol: 0,
      }),
    );
    const fullRecalcAccessor = core.getViewportBuffer('main:sheet-1')?.createAccessor();
    expect(fullRecalcAccessor?.moveTo(0, 0)).toBe(true);
    expect(fullRecalcAccessor?.displayText).toBe('fresh');
  });

  it('visibility changes refresh registered viewport geometry', async () => {
    const initialBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'stale geometry' }],
    });
    const refreshedBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'fresh geometry' }],
    });
    let viewportFetchCount = 0;
    const transport = {
      call: jest.fn(async (command: string): Promise<any> => {
        if (command === 'compute_get_viewport_binary') {
          viewportFetchCount += 1;
          return viewportFetchCount === 1 ? initialBuffer : refreshedBuffer;
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const core = createStartedCore(transport);

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    transport.call.mockClear();

    await core.mutateCore(
      Promise.resolve([
        new Uint8Array(),
        {
          visibilityChanges: [{ sheetId: 'sheet-1', axis: 'col', index: 1, hidden: true }],
        } as unknown as MutationResult,
      ]),
    );

    expect(transport.call).toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.objectContaining({
        docId: 'test-doc',
        sheetId: 'sheet-1',
        startRow: 0,
        startCol: 0,
      }),
    );
    const visibilityAccessor = core.getViewportBuffer('main:sheet-1')?.createAccessor();
    expect(visibilityAccessor?.moveTo(0, 0)).toBe(true);
    expect(visibilityAccessor?.displayText).toBe('fresh geometry');
  });

  it('table changes refresh affected sheet viewports before table events', async () => {
    const initialBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'stale table style' }],
    });
    const refreshedBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'fresh plain cell' }],
    });
    let viewportFetchCount = 0;
    const transport = {
      call: jest.fn(async (command: string): Promise<any> => {
        if (command === 'compute_get_viewport_binary') {
          viewportFetchCount += 1;
          return viewportFetchCount === 1 ? initialBuffer : refreshedBuffer;
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const ctx = makeMockContext();
    const core = new ComputeCore(ctx, 'test-doc', transport);
    (core as any)._phase = 'STARTED';
    core.initMutationHandler();

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    transport.call.mockClear();

    await core.mutateCore(
      Promise.resolve([
        new Uint8Array(),
        {
          tableChanges: [
            { sheetId: 'sheet-1', name: 'Table1', tableId: 'table-1', kind: 'Removed' },
          ],
        } as unknown as MutationResult,
      ]),
    );

    expect(transport.call).toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.objectContaining({
        docId: 'test-doc',
        sheetId: 'sheet-1',
        startRow: 0,
        startCol: 0,
      }),
    );
    const tableAccessor = core.getViewportBuffer('main:sheet-1')?.createAccessor();
    expect(tableAccessor?.moveTo(0, 0)).toBe(true);
    expect(tableAccessor?.displayText).toBe('fresh plain cell');
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'table:deleted',
        sheetId: 'sheet-1',
        tableId: 'table-1',
      }),
    );
    const refreshOrder = transport.call.mock.invocationCallOrder.find((_, index) => {
      const [command] = transport.call.mock.calls[index] ?? [];
      return command === 'compute_get_viewport_binary';
    });
    const emitOrder = (ctx.eventBus.emit as jest.Mock).mock.invocationCallOrder[0];
    expect(refreshOrder).toBeLessThan(emitOrder);
  });

  it('pivot deletion refreshes affected sheet viewports before pivot events', async () => {
    const initialBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'Region' }],
    });
    const refreshedBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: '' }],
    });
    let viewportFetchCount = 0;
    const transport = {
      call: jest.fn(async (command: string): Promise<any> => {
        if (command === 'compute_get_viewport_binary') {
          viewportFetchCount += 1;
          return viewportFetchCount === 1 ? initialBuffer : refreshedBuffer;
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const ctx = makeMockContext();
    const core = new ComputeCore(ctx, 'test-doc', transport);
    (core as any)._phase = 'STARTED';
    core.initMutationHandler();

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    transport.call.mockClear();

    await core.mutateCore(
      Promise.resolve([
        new Uint8Array(),
        {
          pivotChanges: [{ sheetId: 'sheet-1', pivotId: 'PivotTable1', kind: 'Removed' }],
        } as unknown as MutationResult,
      ]),
    );

    expect(transport.call).toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.objectContaining({
        docId: 'test-doc',
        sheetId: 'sheet-1',
        startRow: 0,
        startCol: 0,
      }),
    );
    const pivotAccessor = core.getViewportBuffer('main:sheet-1')?.createAccessor();
    expect(pivotAccessor?.moveTo(0, 0)).toBe(true);
    expect(pivotAccessor?.displayText).toBeNull();
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pivot:deleted',
        sheetId: 'sheet-1',
        pivotId: 'PivotTable1',
      }),
    );
    const refreshOrder = transport.call.mock.invocationCallOrder.find((_, index) => {
      const [command] = transport.call.mock.calls[index] ?? [];
      return command === 'compute_get_viewport_binary';
    });
    const emitOrder = (ctx.eventBus.emit as jest.Mock).mock.invocationCallOrder[0];
    expect(refreshOrder).toBeLessThan(emitOrder);
  });

  it('undo skips full viewport refresh for cell-only history replay', async () => {
    const transport = {
      call: jest.fn(async (command: string): Promise<any> => {
        if (command === 'compute_undo') {
          return [
            new Uint8Array(),
            {
              recalc: makeRecalcResult({
                changedCells: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
              }),
            },
          ];
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const core = createStartedCore(transport);

    await core.undo();

    expect(transport.call).toHaveBeenCalledWith('compute_undo', { docId: 'test-doc' });
    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.anything(),
    );
  });

  it('undo skips full viewport refresh for property-only history replay', async () => {
    const initialBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'centered vendor' }],
    });
    const transport = {
      call: jest.fn(async (command: string): Promise<any> => {
        if (command === 'compute_get_viewport_binary') {
          return initialBuffer;
        }
        if (command === 'compute_undo') {
          return [
            new Uint8Array(),
            {
              recalc: makeRecalcResult(),
              propertyChanges: [
                {
                  sheetId: 'sheet-1',
                  cellId: 'cell-1',
                  position: { row: 0, col: 2 },
                  kind: 'Set',
                  format: { horizontalAlign: 'center' },
                },
              ],
            },
          ];
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const core = createStartedCore(transport);

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    transport.call.mockClear();

    await core.undo();

    expect(transport.call).toHaveBeenCalledWith('compute_undo', { docId: 'test-doc' });
    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.anything(),
    );
  });

  it('undo refreshes registered viewports for table history replay', async () => {
    const initialBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'styled table header' }],
    });
    const undoBuffer = buildTestViewportBuffer({
      rows: 100,
      cols: 40,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'plain header' }],
    });
    let viewportFetchCount = 0;
    const transport = {
      call: jest.fn(async (command: string): Promise<any> => {
        if (command === 'compute_get_viewport_binary') {
          viewportFetchCount += 1;
          return viewportFetchCount === 1 ? initialBuffer : undoBuffer;
        }
        if (command === 'compute_undo') {
          return [
            new Uint8Array(),
            {
              recalc: makeRecalcResult(),
              tableChanges: [
                { name: 'Table1', tableId: 'table-1', sheetId: 'sheet-1', kind: 'Removed' },
              ],
            },
          ];
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const core = createStartedCore(transport);

    await core.refreshViewportForRegion('main:sheet-1', sheetId('sheet-1'), bounds);
    transport.call.mockClear();

    await core.undo();

    expect(transport.call).toHaveBeenCalledWith('compute_undo', { docId: 'test-doc' });
    expect(transport.call).toHaveBeenCalledWith(
      'compute_get_viewport_binary',
      expect.objectContaining({
        docId: 'test-doc',
        sheetId: 'sheet-1',
      }),
    );
    const undoAccessor = core.getViewportBuffer('main:sheet-1')?.createAccessor();
    expect(undoAccessor?.moveTo(0, 0)).toBe(true);
    expect(undoAccessor?.displayText).toBe('plain header');
  });

  it('history replay does not notify forward mutation subscribers', async () => {
    const notifyForwardMutation = jest.fn(async () => undefined);
    const ctx = {
      ...makeMockContext(),
      services: {
        undo: {
          notifyForwardMutation,
        },
      },
    } as unknown as IKernelContext;
    const transport = {
      call: jest.fn(async (command: string): Promise<any> => {
        if (command === 'compute_undo' || command === 'compute_redo') {
          return [new Uint8Array(), {}];
        }
        return undefined;
      }) as any,
    } as BridgeTransport & { call: jest.Mock };
    const core = new ComputeCore(ctx, 'test-doc', transport);
    (core as any)._phase = 'STARTED';

    await core.undo();
    await core.redo();

    expect(transport.call).toHaveBeenCalledWith('compute_undo', { docId: 'test-doc' });
    expect(transport.call).toHaveBeenCalledWith('compute_redo', { docId: 'test-doc' });
    expect(notifyForwardMutation).not.toHaveBeenCalled();
  });
});
