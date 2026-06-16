import { jest } from '@jest/globals';

import { ViewportRegionImpl } from '../viewport';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createBridge(overrides?: Partial<Record<string, jest.Mock>>) {
  return {
    registerViewportRegion: jest.fn().mockResolvedValue(undefined),
    unregisterViewportRegion: jest.fn().mockResolvedValue(undefined),
    refreshViewportForRegion: jest.fn(
      async (viewportId: string, sheetId: string, bounds: any, scrollBehavior: string) => ({
        viewportId,
        sheetId,
        visibleBounds: bounds,
        prefetchBounds: bounds,
        scrollBehavior,
        fetched: true,
        cacheHit: false,
        delta: false,
        projectionChanged: true,
        superseded: false,
        reason: 'fullFetch',
      }),
    ),
    updateViewportVisibleWindow: jest.fn(),
    resetSheetViewportRegions: jest.fn().mockResolvedValue(undefined),
    setRenderScheduler: jest.fn(),
    subscribeToViewportEvents: jest.fn(() => jest.fn()),
    setShowFormulas: jest.fn(),
    ...overrides,
  } as any;
}

describe('ViewportRegionImpl async cleanup ordering', () => {
  const bounds = { startRow: 0, startCol: 0, endRow: 10, endCol: 5 };

  it('unregisters exactly once after successful registration', async () => {
    const bridge = createBridge();
    const region = new ViewportRegionImpl('sheet-1' as any, bounds, bridge, 'vp-1');

    region.dispose();
    await flushMicrotasks();

    expect(bridge.registerViewportRegion).toHaveBeenCalledWith('vp-1', 'sheet-1', bounds);
    expect(bridge.unregisterViewportRegion).toHaveBeenCalledTimes(1);
    expect(bridge.unregisterViewportRegion).toHaveBeenCalledWith('vp-1');
  });

  it('does not unregister when registration failed', async () => {
    const bridge = createBridge({
      registerViewportRegion: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('disposed'), { code: 'BRIDGE_DISPOSED' })),
    });
    const region = new ViewportRegionImpl('sheet-1' as any, bounds, bridge, 'vp-1');

    region.dispose();
    await flushMicrotasks();

    expect(bridge.unregisterViewportRegion).not.toHaveBeenCalled();
  });

  it('orders unregister after a late registration success', async () => {
    let resolveRegistration!: () => void;
    const registration = new Promise<void>((resolve) => {
      resolveRegistration = resolve;
    });
    const bridge = createBridge({
      registerViewportRegion: jest.fn(() => registration),
    });
    const region = new ViewportRegionImpl('sheet-1' as any, bounds, bridge, 'vp-1');

    region.dispose();
    await flushMicrotasks();
    expect(bridge.unregisterViewportRegion).not.toHaveBeenCalled();

    resolveRegistration();
    await flushMicrotasks();
    expect(bridge.unregisterViewportRegion).toHaveBeenCalledTimes(1);
  });

  it('mirrors visible bounds synchronously when bounds update', () => {
    const bridge = createBridge();
    const region = new ViewportRegionImpl('sheet-1' as any, bounds, bridge, 'vp-1');
    const nextBounds = { startRow: 0, startCol: 25, endRow: 10, endCol: 50 };

    region.updateBounds(nextBounds);

    expect(bridge.updateViewportVisibleWindow).toHaveBeenCalledWith('vp-1', 'sheet-1', nextBounds);
  });

  it('collapses degenerate frozen-corner bounds before registering or refreshing', async () => {
    const bridge = createBridge();
    const region = new ViewportRegionImpl(
      'sheet-1' as any,
      { startRow: 0, startCol: 0, endRow: 1, endCol: -1 },
      bridge,
      'frozen-corner:sheet-1',
    );

    const receipt = await region.refresh('none');

    const normalizedBounds = { startRow: 0, startCol: 0, endRow: 1, endCol: 0 };
    expect(receipt).toMatchObject({
      kind: 'viewport.refresh',
      status: 'applied',
      regionId: 'frozen-corner:sheet-1',
      details: {
        fetched: true,
        projectionChanged: true,
      },
    });
    expect(bridge.registerViewportRegion).toHaveBeenCalledWith(
      'frozen-corner:sheet-1',
      'sheet-1',
      normalizedBounds,
    );
    expect(bridge.refreshViewportForRegion).toHaveBeenCalledWith(
      'frozen-corner:sheet-1',
      'sheet-1',
      normalizedBounds,
      'none',
    );
  });

  it('returns a failed receipt when refresh fails', async () => {
    const bridge = createBridge({
      refreshViewportForRegion: jest.fn().mockRejectedValue(new Error('fetch failed')),
    });
    const region = new ViewportRegionImpl('sheet-1' as any, bounds, bridge, 'vp-1');

    await expect(region.refresh('free')).resolves.toMatchObject({
      kind: 'viewport.refresh',
      status: 'failed',
      regionId: 'vp-1',
      diagnostics: [
        expect.objectContaining({
          code: 'VIEWPORT_REFRESH_FAILED',
          message: 'fetch failed',
        }),
      ],
    });
  });

  it('returns a no-op receipt when refresh uses the viewport cache', async () => {
    const bridge = createBridge({
      refreshViewportForRegion: jest.fn(
        async (viewportId: string, sheetId: string, currentBounds: any) => ({
          viewportId,
          sheetId,
          visibleBounds: currentBounds,
          prefetchBounds: currentBounds,
          scrollBehavior: 'free',
          fetched: false,
          cacheHit: true,
          delta: false,
          projectionChanged: false,
          superseded: false,
          reason: 'prefetchHit',
        }),
      ),
    });
    const region = new ViewportRegionImpl('sheet-1' as any, bounds, bridge, 'vp-1');

    await expect(region.refresh('free')).resolves.toMatchObject({
      kind: 'viewport.refresh',
      status: 'noOp',
      effects: [
        expect.objectContaining({
          type: 'readViewportCache',
        }),
      ],
      details: {
        fetched: false,
        cacheHit: true,
        reason: 'prefetchHit',
      },
    });
  });
});
