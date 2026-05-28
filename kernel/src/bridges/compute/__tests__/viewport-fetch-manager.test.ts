/**
 * viewport-fetch-manager.test.ts
 *
 * Tests for ViewportFetchManager — the viewport movement pipeline.
 *
 * Verifies:
 * (a) refresh() calls compute_get_viewport_binary and applies the result
 * (b) stale responses are retried (not silently discarded)
 * (c) invalidateAllPrefetch() clears bounds and forces next refresh to fetch
 * (d) mutations never trigger viewport fetches (enforced by architecture)
 */

// Polyfill window for devtools reporting in BinaryViewportBuffer
import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';

import { ViewportCoordinatorRegistry } from '../../wire/viewport-coordinator-registry';
import { buildTestViewportBuffer } from '../../wire/viewport-test-builder';
import { ViewportFetchManager } from '../viewport-fetch-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(startRow = 0, startCol = 0, rows = 100, cols = 40): Uint8Array {
  return buildTestViewportBuffer({
    rows,
    cols,
    startRow,
    startCol,
    cells: [{ display: 'test' }],
  });
}

/** Create a mock transport that returns a test viewport buffer. */
function makeMockTransport(): BridgeTransport & { call: jest.Mock } {
  return {
    call: jest.fn(async () => makeBuffer()) as any,
  } as any;
}

/** Create a ViewportFetchManager for testing. */
function createManager(
  transport: BridgeTransport,
  getShowFormulasForSheet: (sheetId: string) => boolean = () => false,
) {
  const coordinatorRegistry = new ViewportCoordinatorRegistry();
  const manager = new ViewportFetchManager(
    transport,
    'test-doc',
    coordinatorRegistry,
    getShowFormulasForSheet,
  );
  return {
    manager,
    coordinatorRegistry,
  };
}

const bounds = { startRow: 0, startCol: 0, endRow: 50, endCol: 20 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ViewportFetchManager', () => {
  describe('refresh()', () => {
    it('calls compute_get_viewport_binary and applies the result', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main', 'sheet-1', bounds);

      // 1 registration + 1 fetch = 2 calls
      expect(transport.call).toHaveBeenCalledTimes(2);
      expect(transport.call).toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.objectContaining({
          docId: 'test-doc',
          sheetId: 'sheet-1',
        }),
      );
      expect(transport.call).toHaveBeenCalledWith(
        'compute_register_viewport',
        expect.objectContaining({
          docId: 'test-doc',
          viewportId: 'main',
          sheetId: 'sheet-1',
        }),
      );

      // Buffer should be populated
      const buffer = manager.getBuffer('main');
      expect(buffer).not.toBeNull();
      expect(buffer!.hasBuffer()).toBe(true);
    });

    it('skips data fetch when bounds are within prefetch', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      // Initial fetch (1 registration + 1 fetch)
      await manager.refresh('main', 'sheet-1', bounds);
      expect(transport.call).toHaveBeenCalledTimes(2);

      transport.call.mockClear();

      // Smaller bounds within prefetch region (prefetch = visible + 50 rows + 20 cols)
      await manager.refresh('main', 'sheet-1', {
        startRow: 5,
        startCol: 5,
        endRow: 45,
        endCol: 15,
      });

      expect(transport.call).toHaveBeenCalledTimes(1);
      expect(transport.call).toHaveBeenCalledWith(
        'compute_register_viewport',
        expect.objectContaining({ viewportId: 'main', sheetId: 'sheet-1' }),
      );
      expect(transport.call).not.toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.anything(),
      );
    });

    it('returns accessor for populated viewport', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main', 'sheet-1', bounds);

      const accessor = manager.getAccessor('main');
      expect(accessor).toBeDefined();
    });

    it('returns undefined accessor for unknown viewport', () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      expect(manager.getAccessor('nonexistent')).toBeUndefined();
    });

    it('passes showFormulas from the sheet-scoped resolver', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport, (sheetId) => sheetId === 'sheet-2');

      await manager.refresh('main:sheet-1', 'sheet-1', bounds);
      await manager.refresh('main:sheet-2', 'sheet-2', bounds);

      expect(transport.call).toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.objectContaining({ sheetId: 'sheet-1', showFormulas: false }),
      );
      expect(transport.call).toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.objectContaining({ sheetId: 'sheet-2', showFormulas: true }),
      );
    });

    it('uses axis-aware dense prefetch for horizontal-only movement in the free viewport', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main', 'sheet-1', bounds);
      transport.call.mockClear();

      await manager.refresh('main', 'sheet-1', {
        startRow: 0,
        endRow: 50,
        startCol: 54,
        endCol: 80,
      });

      const registerCall = transport.call.mock.calls.find(
        ([cmd]: [string]) => cmd === 'compute_register_viewport',
      );
      expect(registerCall).toBeDefined();
      const [, args] = registerCall!;
      expect(args.startRow).toBe(0);
      expect(args.endRow).toBe(82);
      expect(args.startCol).toBe(0);
      expect(args.endCol).toBe(144);
    });
  });

  describe('prefetch bounds sync to Rust', () => {
    it('calls compute_register_viewport with prefetch bounds before fetch', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main', 'sheet-1', bounds);

      // First call: compute_register_viewport (sync prefetch bounds BEFORE fetch)
      // Second call: compute_get_viewport_binary (the data fetch)
      expect(transport.call.mock.calls[0][0]).toBe('compute_register_viewport');
      expect(transport.call.mock.calls[1][0]).toBe('compute_get_viewport_binary');

      const registerCall = transport.call.mock.calls.find(
        ([cmd]: [string]) => cmd === 'compute_register_viewport',
      );
      expect(registerCall).toBeDefined();
      const [, args] = registerCall!;
      expect(args.docId).toBe('test-doc');
      expect(args.viewportId).toBe('main');
      expect(args.sheetId).toBe('sheet-1');
      // Prefetch bounds should be wider than visible bounds
      expect(args.startRow).toBeLessThanOrEqual(bounds.startRow);
      expect(args.endRow).toBeGreaterThanOrEqual(bounds.endRow);
      expect(args.startCol).toBeLessThanOrEqual(bounds.startCol);
      expect(args.endCol).toBeGreaterThanOrEqual(bounds.endCol);
    });

    it('re-registers compute viewport on prefetch hit without fetching', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      // Initial fetch — will register the viewport and fetch
      await manager.refresh('main', 'sheet-1', bounds);
      transport.call.mockClear();

      // Smaller bounds within prefetch — should skip fetch entirely
      await manager.refresh('main', 'sheet-1', {
        startRow: 5,
        startCol: 5,
        endRow: 45,
        endCol: 15,
      });

      expect(transport.call).toHaveBeenCalledTimes(1);
      expect(transport.call).toHaveBeenCalledWith(
        'compute_register_viewport',
        expect.objectContaining({ viewportId: 'main', sheetId: 'sheet-1' }),
      );
      expect(transport.call).not.toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.anything(),
      );
    });
  });

  describe('stale detection and retry', () => {
    it('commits fetch even when mutation arrives during flight (coordinator overlay handles consistency)', async () => {
      const transport = makeMockTransport();
      const { manager, coordinatorRegistry } = createManager(transport);

      // First: populate a viewport with visible window (1 registration + 1 fetch)
      await manager.refresh('main', 'sheet-1', bounds);
      expect(transport.call).toHaveBeenCalledTimes(2);

      // Now set up a transport where we control when the fetch resolves.
      // The viewport registration resolves immediately; the fetch is deferred.
      let resolveFetch: ((value: Uint8Array) => void) | null = null;
      (transport.call as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd === 'compute_register_viewport') {
          return Promise.resolve(); // registration resolves immediately
        }
        // Fetch call — defer resolution
        return new Promise<Uint8Array>((resolve) => {
          resolveFetch = resolve;
        });
      });

      // Start a refresh that will race with a mutation
      manager.invalidateAllPrefetch();
      const racePromise = manager.refresh('main', 'sheet-1', bounds);

      // Allow microtasks to settle (registration resolves, fetch is pending)
      await Promise.resolve();
      await Promise.resolve();

      // 2 from initial + 1 registration + 1 fetch = 4
      expect(transport.call).toHaveBeenCalledTimes(4);

      // Resolve the fetch — coordinator handles consistency via overlay
      resolveFetch!(makeBuffer());
      await racePromise;

      // Buffer is committed (not discarded) — coordinator's epoch-based overlay filtering
      // ensures mutations during the fetch are retained and re-applied.
      const coordinator = coordinatorRegistry.get('main');
      expect(coordinator).toBeDefined();
      expect(coordinator!.base.hasBuffer()).toBe(true);
    });

    it('commits fetch successfully without retry', async () => {
      const transport = makeMockTransport();
      const { manager, coordinatorRegistry } = createManager(transport);

      // Successful fetch — coordinator receives the data
      await manager.refresh('main', 'sheet-1', bounds);

      const coordinator = coordinatorRegistry.get('main');
      expect(coordinator).toBeDefined();
      expect(coordinator!.base.hasBuffer()).toBe(true);
    });

    it('uses latest-wins semantics for overlapping viewport movement fetches', async () => {
      let resolveOldFetch: ((value: Uint8Array) => void) | null = null;
      const transport = {
        call: jest.fn((cmd: string, args: any) => {
          if (cmd === 'compute_register_viewport') return Promise.resolve();
          if (args.startRow === 0) {
            return new Promise<Uint8Array>((resolve) => {
              resolveOldFetch = resolve;
            });
          }
          return Promise.resolve(makeBuffer(args.startRow, args.startCol, 100, 40));
        }) as any,
      } as BridgeTransport & { call: jest.Mock };
      const { manager } = createManager(transport);

      const oldRefresh = manager.refresh('main', 'sheet-1', bounds);
      await Promise.resolve();
      await Promise.resolve();

      await manager.refresh('main', 'sheet-1', {
        startRow: 5000,
        startCol: 0,
        endRow: 5050,
        endCol: 20,
      });

      expect(manager.getBuffer('main')!.getBounds()!.startRow).toBe(4000);

      resolveOldFetch!(makeBuffer(0, 0, 100, 40));
      await oldRefresh;

      expect(manager.getBuffer('main')!.getBounds()!.startRow).toBe(4000);
    });
  });

  describe('invalidateAllPrefetch()', () => {
    it('forces next refresh to fetch from Rust', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      // Initial fetch (1 registration + 1 fetch)
      await manager.refresh('main', 'sheet-1', bounds);
      expect(transport.call).toHaveBeenCalledTimes(2);

      transport.call.mockClear();

      // Invalidate
      manager.invalidateAllPrefetch();

      // Same bounds — should fetch again because prefetch was invalidated (1 registration + 1 fetch)
      await manager.refresh('main', 'sheet-1', bounds);
      expect(transport.call).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear()', () => {
    it('removes all viewport state', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main', 'sheet-1', bounds);
      expect(manager.getPerViewportStates().size).toBe(1);

      manager.clear();

      expect(manager.getPerViewportStates().size).toBe(0);
      expect(manager.getBuffer('main')).toBeNull();
      expect(manager.getAccessor('main')).toBeUndefined();
    });
  });

  describe('removeViewport()', () => {
    it('removes a specific viewport without affecting others', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main:sheet-1', 'sheet-1', bounds);
      await manager.refresh('main:sheet-2', 'sheet-2', bounds);
      expect(manager.getPerViewportStates().size).toBe(2);

      manager.removeViewport('main:sheet-1');

      expect(manager.getPerViewportStates().size).toBe(1);
      expect(manager.getBuffer('main:sheet-1')).toBeNull();
      expect(manager.getBuffer('main:sheet-2')).not.toBeNull();
    });
  });

  describe('forceRefreshAllViewports()', () => {
    it('fetches fresh data for all registered viewports and emits fetch-committed', async () => {
      const transport = makeMockTransport();
      const { manager, coordinatorRegistry } = createManager(transport);

      // Populate two viewports (each: 1 registration + 1 fetch = 4 total)
      await manager.refresh('main', 'sheet-1', bounds);
      await manager.refresh('frozen-rows', 'sheet-1', {
        startRow: 0,
        startCol: 0,
        endRow: 5,
        endCol: 20,
      });
      expect(transport.call).toHaveBeenCalledTimes(4);

      // Track fetch-committed events
      const events: string[] = [];
      const mainCoordinator = coordinatorRegistry.get('main')!;
      const frozenCoordinator = coordinatorRegistry.get('frozen-rows')!;
      mainCoordinator.subscribe((e) => events.push(`main:${e.type}`));
      frozenCoordinator.subscribe((e) => events.push(`frozen:${e.type}`));

      transport.call.mockClear();

      // Force refresh re-registers current buffer bounds, then fetches each viewport.
      await manager.forceRefreshAllViewports();

      // Should have registered and fetched both viewports.
      expect(transport.call).toHaveBeenCalledTimes(4);
      expect(transport.call).toHaveBeenCalledWith(
        'compute_register_viewport',
        expect.objectContaining({ viewportId: 'main', sheetId: 'sheet-1' }),
      );
      expect(transport.call).toHaveBeenCalledWith(
        'compute_register_viewport',
        expect.objectContaining({ viewportId: 'frozen-rows', sheetId: 'sheet-1' }),
      );
      expect(transport.call).toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.objectContaining({ sheetId: 'sheet-1' }),
      );

      // Both coordinators should have emitted fetch-committed
      expect(events).toContain('main:fetch-committed');
      expect(events).toContain('frozen:fetch-committed');
    });

    it('restores per-viewport metadata after invalidation', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main', 'sheet-1', bounds);
      const expectedVisibleBounds = { ...bounds };

      manager.invalidateAllPrefetch();
      let state = manager.getPerViewportStates().get('main')!;
      expect(state.prefetchBounds).toBeNull();
      expect(state.lastVisibleBounds).toBeNull();

      await manager.forceRefreshAllViewports();

      state = manager.getPerViewportStates().get('main')!;
      expect(state.prefetchBounds).not.toBeNull();
      expect(state.prefetchBounds).toEqual({
        startRow: manager.getBuffer('main')!.getBounds()!.startRow,
        startCol: manager.getBuffer('main')!.getBounds()!.startCol,
        endRow: manager.getBuffer('main')!.getBounds()!.endRow,
        endCol: manager.getBuffer('main')!.getBounds()!.endCol,
      });
      expect(state.lastVisibleBounds).toEqual(expectedVisibleBounds);
      expect(state.prefetchDirtyState.dirtyRegion).toBeNull();
      expect(state.prefetchDirtyState.staleCells.size).toBe(0);
    });

    it('is a no-op when no viewports are registered', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      // No viewports — should not call transport
      await manager.forceRefreshAllViewports();
      expect(transport.call).not.toHaveBeenCalled();
    });
  });

  describe('forceRefreshSheetViewports()', () => {
    it('fetches fresh data only for registered viewports on the target sheet', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport, (sheetId) => sheetId === 'sheet-2');

      await manager.refresh('main:sheet-1', 'sheet-1', bounds);
      await manager.refresh('main:sheet-2', 'sheet-2', bounds);
      transport.call.mockClear();

      await manager.forceRefreshSheetViewports('sheet-2');

      expect(transport.call).toHaveBeenCalledTimes(2);
      expect(transport.call).toHaveBeenCalledWith(
        'compute_register_viewport',
        expect.objectContaining({ viewportId: 'main:sheet-2', sheetId: 'sheet-2' }),
      );
      expect(transport.call).toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.objectContaining({ sheetId: 'sheet-2', showFormulas: true }),
      );
      expect(transport.call).not.toHaveBeenCalledWith(
        'compute_get_viewport_binary',
        expect.objectContaining({ sheetId: 'sheet-1' }),
      );
    });

    it('restores metadata only for invalidated viewports on the target sheet', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      await manager.refresh('main:sheet-1', 'sheet-1', bounds);
      await manager.refresh('main:sheet-2', 'sheet-2', bounds);
      const expectedVisibleBounds = { ...bounds };

      manager.invalidateAllPrefetch();
      let sheet1State = manager.getPerViewportStates().get('main:sheet-1')!;
      let sheet2State = manager.getPerViewportStates().get('main:sheet-2')!;
      expect(sheet1State.prefetchBounds).toBeNull();
      expect(sheet1State.lastVisibleBounds).toBeNull();
      expect(sheet2State.prefetchBounds).toBeNull();
      expect(sheet2State.lastVisibleBounds).toBeNull();

      await manager.forceRefreshSheetViewports('sheet-2');

      sheet1State = manager.getPerViewportStates().get('main:sheet-1')!;
      sheet2State = manager.getPerViewportStates().get('main:sheet-2')!;
      expect(sheet1State.prefetchBounds).toBeNull();
      expect(sheet1State.lastVisibleBounds).toBeNull();
      expect(sheet2State.prefetchBounds).not.toBeNull();
      expect(sheet2State.prefetchBounds).toEqual({
        startRow: manager.getBuffer('main:sheet-2')!.getBounds()!.startRow,
        startCol: manager.getBuffer('main:sheet-2')!.getBounds()!.startCol,
        endRow: manager.getBuffer('main:sheet-2')!.getBounds()!.endRow,
        endCol: manager.getBuffer('main:sheet-2')!.getBounds()!.endCol,
      });
      expect(sheet2State.lastVisibleBounds).toEqual(expectedVisibleBounds);
      expect(sheet2State.prefetchDirtyState.dirtyRegion).toBeNull();
      expect(sheet2State.prefetchDirtyState.staleCells.size).toBe(0);
    });
  });

  describe('dispose()', () => {
    it('can be called without errors', async () => {
      const transport = makeMockTransport();
      const { manager } = createManager(transport);

      // Populate a viewport
      await manager.refresh('main', 'sheet-1', bounds);

      // Dispose should not throw
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});
