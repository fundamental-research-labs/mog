/**
 * RenderLoop Caching Tests
 *
 * Tests for per-layer off-screen caching in the render loop.
 * Verifies that cacheable layers render to cache and composite,
 * clean layers skip re-render, and non-cacheable layers render directly.
 */

import { jest } from '@jest/globals';

import type { CanvasLayer, DirtyHint, RenderRegion } from '../core/types';

import { RenderLoop } from '../loop/render-loop';
import { LayerRegistry } from '../registry/layer-registry';
import { PriorityScheduler } from '../scheduler/priority-scheduler';

// =============================================================================
// Mock OffscreenCanvas
// =============================================================================

class MockOffscreenCanvas {
  width: number;
  height: number;
  private _ctx: Record<string, jest.Mock>;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this._ctx = {
      clearRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      setTransform: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      drawImage: jest.fn(),
    };
  }

  getContext(_type: string): Record<string, jest.Mock> {
    return this._ctx;
  }
}

// =============================================================================
// Mocks
// =============================================================================

function createMockCanvasHost(canvasCount = 1) {
  const contexts: Record<number, any> = {};

  for (let i = 0; i < canvasCount; i++) {
    contexts[i] = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      clearRect: jest.fn(),
      setTransform: jest.fn(),
      drawImage: jest.fn(),
    };
  }

  return {
    getContext: jest.fn((index: number) => contexts[index]),
    getCanvas: jest.fn(),
    getSize: jest.fn(() => ({ width: 800, height: 600 })),
    getDPR: jest.fn(() => 2),
    getCanvasCount: jest.fn(() => canvasCount),
    setOnResize: jest.fn(),
    resize: jest.fn(),
    dispose: jest.fn(),
    flushResize: jest.fn(() => false),
  };
}

function createMockLayer(overrides: Partial<CanvasLayer> = {}): CanvasLayer {
  let dirty = true;
  return {
    id: overrides.id ?? 'test-layer',
    zIndex: overrides.zIndex ?? 0,
    renderMode: overrides.renderMode ?? 'once',
    canvas: overrides.canvas ?? 0,
    render: jest.fn(),
    isDirty: jest.fn(() => dirty),
    markDirty: jest.fn((_hint?: DirtyHint) => {
      dirty = true;
    }),
    markClean: jest.fn(() => {
      dirty = false;
    }),
    dispose: jest.fn(),
    ...overrides,
  };
}

/**
 * Create a mock layer that supports caching (duck-types like BaseLayer).
 */
function createCacheableLayer(overrides: Partial<CanvasLayer> & { cacheable?: boolean } = {}) {
  let dirty = true;
  const cacheable = overrides.cacheable ?? true;

  const cacheCanvas = new MockOffscreenCanvas(0, 0);
  const cacheCtx = cacheCanvas.getContext('2d');
  let cacheCreated = false;

  const layer = {
    id: overrides.id ?? 'cacheable-layer',
    zIndex: overrides.zIndex ?? 0,
    renderMode: overrides.renderMode ?? 'once',
    canvas: overrides.canvas ?? 0,
    render: overrides.render ?? jest.fn(),
    isDirty: jest.fn(() => dirty),
    markDirty: jest.fn((_hint?: DirtyHint) => {
      dirty = true;
    }),
    markClean: jest.fn(() => {
      dirty = false;
    }),
    dispose: jest.fn(),
    cacheable,
    getOrCreateCache: jest.fn((w: number, h: number) => {
      if (!cacheable) return null;
      cacheCanvas.width = w;
      cacheCanvas.height = h;
      cacheCreated = true;
      return { canvas: cacheCanvas, ctx: cacheCtx };
    }),
    clearCache: jest.fn(),
    getCacheCanvas: jest.fn(() => (cacheCreated && cacheable ? cacheCanvas : null)),
    // Expose for test assertions
    _cacheCanvas: cacheCanvas,
    _cacheCtx: cacheCtx,
  };

  return layer;
}

// =============================================================================
// Mock rAF
// =============================================================================

let rafCallbacks: Array<{ id: number; cb: (timestamp: number) => void }> = [];
let nextRafId = 1;

beforeEach(() => {
  rafCallbacks = [];
  nextRafId = 1;
  (global as any).OffscreenCanvas = MockOffscreenCanvas;

  (global as any).requestAnimationFrame = jest.fn((cb: (timestamp: number) => void) => {
    const id = nextRafId++;
    rafCallbacks.push({ id, cb });
    return id;
  });

  (global as any).cancelAnimationFrame = jest.fn((id: number) => {
    rafCallbacks = rafCallbacks.filter((r) => r.id !== id);
  });
});

afterEach(() => {
  delete (global as any).OffscreenCanvas;
});

function flushRaf(timestamp = 16.67) {
  const callbacks = [...rafCallbacks];
  rafCallbacks = [];
  for (const { cb } of callbacks) {
    cb(timestamp);
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('RenderLoop caching', () => {
  it('dirty cacheable layer renders to cache then composites to main canvas', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createCacheableLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
    });
    registry.register(layer as any);

    loop.start();
    flushRaf(16.67);

    // Should have created cache with physical dimensions (800*2=1600, 600*2=1200)
    expect(layer.getOrCreateCache).toHaveBeenCalledWith(1600, 1200);

    // Should have cleared cache before rendering
    expect(layer.clearCache).toHaveBeenCalled();

    // Layer render() should have been called (rendering to cache)
    expect(layer.render).toHaveBeenCalled();

    // Should have marked clean
    expect(layer.markClean).toHaveBeenCalled();

    // Should have composited cache to main canvas via drawImage
    const mainCtx = host.getContext(0);
    expect(mainCtx.drawImage).toHaveBeenCalledWith(layer._cacheCanvas, 0, 0);

    loop.stop();
  });

  it('clean cacheable layer composites from cache without re-rendering', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    // Create a cacheable layer that starts dirty, then becomes clean
    let dirty = true;
    const renderFn = jest.fn();
    const layer = createCacheableLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      render: renderFn,
    });
    // Override isDirty to track state changes
    (layer.isDirty as jest.Mock).mockImplementation(() => dirty);
    (layer.markClean as jest.Mock).mockImplementation(() => {
      dirty = false;
    });

    registry.register(layer as any);

    // Also register a non-cacheable layer so we have something dirty on frame 2
    let selDirty = true;
    const selLayer = createMockLayer({
      id: 'selection',
      zIndex: 200,
      canvas: 0,
      isDirty: jest.fn(() => selDirty),
      markClean: jest.fn(() => {
        selDirty = false;
      }),
    });
    registry.register(selLayer);

    // Frame 1: layer is dirty -> renders to cache
    loop.start();
    flushRaf(16.67);

    expect(renderFn).toHaveBeenCalledTimes(1);
    expect(dirty).toBe(false);

    // Mark only selection dirty for frame 2
    selDirty = true;
    (selLayer.isDirty as jest.Mock).mockReturnValue(true);
    loop.requestFrame();
    flushRaf(33.33);

    // Cells layer should NOT have been rendered again (still clean)
    expect(renderFn).toHaveBeenCalledTimes(1);

    // But drawImage should have been called again (compositing from cache)
    const mainCtx = host.getContext(0);
    expect(mainCtx.drawImage).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it('non-cacheable layer renders directly to main canvas', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createCacheableLayer({
      id: 'selection',
      zIndex: 200,
      canvas: 0,
      cacheable: false,
    });
    registry.register(layer as any);

    loop.start();
    flushRaf(16.67);

    // getOrCreateCache should have been called and returned null
    expect(layer.getOrCreateCache).toHaveBeenCalled();
    const result = layer.getOrCreateCache.mock.results[0].value;
    expect(result).toBeNull();

    // Layer should have rendered directly (render was called)
    expect(layer.render).toHaveBeenCalled();

    // No drawImage on main canvas (no compositing needed for non-cached layers)
    const mainCtx = host.getContext(0);
    expect(mainCtx.drawImage).not.toHaveBeenCalled();

    loop.stop();
  });

  it('layers without cache support render directly (backward compatibility)', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    // Plain layer without getOrCreateCache method
    const layer = createMockLayer({
      id: 'plain-layer',
      zIndex: 0,
      canvas: 0,
      renderMode: 'once',
    });
    registry.register(layer);

    loop.start();
    flushRaf(16.67);

    // Should render directly
    expect(layer.render).toHaveBeenCalled();
    expect(layer.markClean).toHaveBeenCalled();

    loop.stop();
  });

  it('DPR transform is applied to cache context', () => {
    const host = createMockCanvasHost();
    // DPR is 2
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createCacheableLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
    });
    registry.register(layer as any);

    loop.start();
    flushRaf(16.67);

    // The cache ctx should have DPR transform applied
    expect(layer._cacheCtx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

    // Compositing should use identity transform
    const mainCtx = host.getContext(0);
    // The main ctx setTransform should be called with identity for compositing
    const setTransformCalls = mainCtx.setTransform.mock.calls;
    const hasIdentityCall = setTransformCalls.some(
      (call: number[]) => call[0] === 1 && call[1] === 0 && call[2] === 0 && call[3] === 1,
    );
    expect(hasIdentityCall).toBe(true);

    loop.stop();
  });

  it('cacheable per-region layer renders with clip/translate/zoom to cache', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createCacheableLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      renderMode: 'per-region',
    });
    registry.register(layer as any);

    loop.setLayout({
      regions: [
        {
          id: 'main',
          bounds: { x: 50, y: 30, width: 700, height: 500 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 100, y: 200 },
          zoom: 1.5,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4300, y: 9500 },
    });

    loop.start();
    flushRaf(16.67);

    // The cache ctx should have region clip/translate/zoom
    expect(layer._cacheCtx.beginPath).toHaveBeenCalled();
    expect(layer._cacheCtx.rect).toHaveBeenCalledWith(50, 30, 700, 500);
    expect(layer._cacheCtx.clip).toHaveBeenCalled();
    expect(layer._cacheCtx.translate).toHaveBeenCalledWith(50, 30);
    expect(layer._cacheCtx.scale).toHaveBeenCalledWith(1.5, 1.5);

    // Layer render should have been called
    expect(layer.render).toHaveBeenCalled();

    loop.stop();
  });

  it('error handling still works with cached layers', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const onLayerError = jest.fn();
    const loop = new RenderLoop({ host: host as any, registry, scheduler, onLayerError });

    const layer = createCacheableLayer({
      id: 'failing',
      zIndex: 0,
      canvas: 0,
      cacheable: true,
      render: jest.fn(() => {
        throw new Error('render failed');
      }),
    });
    registry.register(layer as any);

    loop.start();
    flushRaf(16.67);

    expect(onLayerError).toHaveBeenCalledWith('failing', expect.any(Error), 1);

    loop.stop();
    consoleError.mockRestore();
  });
});
