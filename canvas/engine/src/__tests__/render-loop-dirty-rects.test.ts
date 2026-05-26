/**
 * RenderLoop Dirty Rect Tests
 *
 * Tests for partial cache clear + clip in the render loop.
 * Verifies that when layers report partial dirty rects, only the dirty
 * region is cleared and re-composited, and that scroll/resize promote
 * to full repaint.
 */

import { jest } from '@jest/globals';

import type { CanvasLayer, DirtyHint, Rect, RenderRegion } from '../core/types';

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
      getImageData: jest.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
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
      getImageData: jest.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
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
 * Create a cacheable layer that supports dirty rects.
 *
 * This models a BaseLayer-style layer with:
 * - getOrCreateCache / clearCache / getCacheCanvas (caching support)
 * - getDirtyRects / isFullDirty (partial dirty support)
 */
function createDirtyRectLayer(
  overrides: {
    id?: string;
    zIndex?: number;
    canvas?: number;
    renderMode?: 'once' | 'per-region';
    cacheable?: boolean;
    dirtyRects?: Rect[];
    fullDirty?: boolean;
    render?: jest.Mock;
  } = {},
) {
  let dirty = true;
  let fullDirty = overrides.fullDirty ?? false;
  let dirtyRects: Rect[] = overrides.dirtyRects ?? [];
  const cacheable = overrides.cacheable ?? true;

  const cacheCanvas = new MockOffscreenCanvas(0, 0);
  const cacheCtx = cacheCanvas.getContext('2d');
  let cacheCreated = false;

  const layer = {
    id: overrides.id ?? 'dirty-rect-layer',
    zIndex: overrides.zIndex ?? 0,
    renderMode: overrides.renderMode ?? 'once',
    canvas: overrides.canvas ?? 0,
    render: overrides.render ?? jest.fn(),
    isDirty: jest.fn(() => dirty),
    markDirty: jest.fn((hint?: DirtyHint) => {
      dirty = true;
      if (hint?.type === 'full') {
        fullDirty = true;
      }
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

    // --- Dirty rect support ---
    getDirtyRects: jest.fn(() => dirtyRects),
    isFullDirty: jest.fn(() => fullDirty),

    // --- Test helpers ---
    _cacheCanvas: cacheCanvas,
    _cacheCtx: cacheCtx,
    _setDirtyRects(rects: Rect[]) {
      dirtyRects = rects;
    },
    _setFullDirty(val: boolean) {
      fullDirty = val;
    },
    _setDirty(val: boolean) {
      dirty = val;
    },
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

function setIdentityLayout(loop: RenderLoop): void {
  loop.setLayout(
    {
      regions: [
        {
          id: 'main',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 0, y: 0 },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 800, height: 600 },
      maxScroll: { x: 0, y: 0 },
    },
    { invalidation: 'scroll' },
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('RenderLoop dirty rects', () => {
  it('single dirty rect: only that region cleared and re-composited via partial path', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const dirtyRect: Rect = { x: 100, y: 50, width: 200, height: 150 };
    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [dirtyRect],
      fullDirty: false,
    });
    registry.register(layer as any);
    setIdentityLayout(loop);

    loop.start();
    flushRaf(16.67);

    const mainCtx = host.getContext(0);
    const dpr = 2;

    // The safety margin is ceil(1/dpr) = ceil(0.5) = 1
    const margin = Math.ceil(1 / dpr);
    const unionX = dirtyRect.x - margin;
    const unionY = dirtyRect.y - margin;
    const unionW = dirtyRect.width + 2 * margin;
    const unionH = dirtyRect.height + 2 * margin;

    // Main canvas should be partially cleared (physical pixels)
    const physX = Math.floor(unionX * dpr);
    const physY = Math.floor(unionY * dpr);
    const physW = Math.ceil((unionX + unionW) * dpr) - physX;
    const physH = Math.ceil((unionY + unionH) * dpr) - physY;

    expect(mainCtx.clearRect).toHaveBeenCalledWith(physX, physY, physW, physH);

    // Should NOT have been called with full canvas dimensions
    const fullPhysW = 800 * dpr;
    const fullPhysH = 600 * dpr;
    const clearCalls = mainCtx.clearRect.mock.calls;
    const hasFullClear = clearCalls.some(
      (call: number[]) =>
        call[0] === 0 && call[1] === 0 && call[2] === fullPhysW && call[3] === fullPhysH,
    );
    expect(hasFullClear).toBe(false);

    // drawImage should use 9-arg form (source + dest rects) for partial composite
    const drawCalls = mainCtx.drawImage.mock.calls;
    expect(drawCalls.length).toBeGreaterThanOrEqual(1);
    // 9-arg drawImage: (source, sx, sy, sw, sh, dx, dy, dw, dh)
    const partialDraw = drawCalls.find((call: any[]) => call.length === 9);
    expect(partialDraw).toBeDefined();
    // Source and dest should match (same physical region)
    expect(partialDraw![1]).toBe(physX); // sx
    expect(partialDraw![2]).toBe(physY); // sy
    expect(partialDraw![3]).toBe(physW); // sw
    expect(partialDraw![4]).toBe(physH); // sh
    expect(partialDraw![5]).toBe(physX); // dx
    expect(partialDraw![6]).toBe(physY); // dy
    expect(partialDraw![7]).toBe(physW); // dw
    expect(partialDraw![8]).toBe(physH); // dh

    // Cache should have been partially cleared and clipped
    expect(layer._cacheCtx.clearRect).toHaveBeenCalledWith(unionX, unionY, unionW, unionH);
    expect(layer._cacheCtx.beginPath).toHaveBeenCalled();
    expect(layer._cacheCtx.rect).toHaveBeenCalledWith(unionX, unionY, unionW, unionH);
    expect(layer._cacheCtx.clip).toHaveBeenCalled();

    // Layer render should have been called
    expect(layer.render).toHaveBeenCalled();
    expect(layer.markClean).toHaveBeenCalled();

    loop.stop();
  });

  it('multiple dirty rects: union computed correctly with safety margin', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const rect1: Rect = { x: 10, y: 20, width: 50, height: 30 };
    const rect2: Rect = { x: 200, y: 150, width: 80, height: 60 };
    const rect3: Rect = { x: 50, y: 100, width: 40, height: 20 };

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [rect1, rect2, rect3],
      fullDirty: false,
    });
    registry.register(layer as any);
    setIdentityLayout(loop);

    loop.start();
    flushRaf(16.67);

    const mainCtx = host.getContext(0);
    const dpr = 2;
    const margin = Math.ceil(1 / dpr); // = 1

    // Expected union before margin:
    // minX = min(10, 200, 50) = 10
    // minY = min(20, 150, 100) = 20
    // maxX = max(10+50, 200+80, 50+40) = max(60, 280, 90) = 280
    // maxY = max(20+30, 150+60, 100+20) = max(50, 210, 120) = 210
    const unionX = 10 - margin;
    const unionY = 20 - margin;
    const unionMaxX = 280 + margin;
    const unionMaxY = 210 + margin;
    const unionW = unionMaxX - unionX;
    const unionH = unionMaxY - unionY;

    // Physical pixels for clearDirtyRect
    const physX = Math.floor(unionX * dpr);
    const physY = Math.floor(unionY * dpr);
    const physW = Math.ceil((unionX + unionW) * dpr) - physX;
    const physH = Math.ceil((unionY + unionH) * dpr) - physY;

    // Main canvas should be cleared with the union rect (in physical pixels)
    expect(mainCtx.clearRect).toHaveBeenCalledWith(physX, physY, physW, physH);

    // Cache should have been cleared with the union rect (in CSS pixels)
    expect(layer._cacheCtx.clearRect).toHaveBeenCalledWith(unionX, unionY, unionW, unionH);

    loop.stop();
  });

  it('full dirty layer falls back to full clear and full composite (no regression)', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: true,
    });
    registry.register(layer as any);

    loop.start();
    flushRaf(16.67);

    const mainCtx = host.getContext(0);
    const dpr = 2;

    // Should use full clear (clearRect with full canvas physical dimensions)
    expect(mainCtx.clearRect).toHaveBeenCalledWith(0, 0, 800 * dpr, 600 * dpr);

    // drawImage should use 3-arg form (full composite)
    const drawCalls = mainCtx.drawImage.mock.calls;
    const fullDraw = drawCalls.find((call: any[]) => call.length === 3);
    expect(fullDraw).toBeDefined();
    expect(fullDraw![1]).toBe(0);
    expect(fullDraw![2]).toBe(0);

    // clearCache should have been called (full path)
    expect(layer.clearCache).toHaveBeenCalled();

    loop.stop();
  });

  it('scroll during frame promotes partial dirty to full repaint', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [{ x: 10, y: 10, width: 50, height: 50 }],
      fullDirty: false,
    });
    registry.register(layer as any);

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: { x: 50, y: 30, width: 700, height: 500 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 100, y: 200 },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4300, y: 9500 },
    };

    loop.setLayout(layout);

    // Frame 1: establish scroll offsets
    loop.start();
    flushRaf(16.67);

    // Prepare frame 2: change scroll offset and mark layer dirty with partial rect
    layout.regions[0].scrollOffset = { x: 150, y: 250 };
    layer._setDirty(true);
    layer._setFullDirty(false);
    layer._setDirtyRects([{ x: 10, y: 10, width: 50, height: 50 }]);
    (layer.isDirty as jest.Mock).mockReturnValue(true);
    (layer.isFullDirty as jest.Mock).mockReturnValue(false);

    loop.requestFrame();
    flushRaf(33.33);

    // promoteAllToFull should have called markDirty with { type: 'full' }
    // since the layer was dirty but not full-dirty, and scroll changed
    const markDirtyCalls = (layer.markDirty as jest.Mock).mock.calls;
    const fullPromoteCall = markDirtyCalls.find(
      (call: any[]) => call[0] && call[0].type === 'full',
    );
    expect(fullPromoteCall).toBeDefined();

    loop.stop();
  });

  it('scroll layout update does not mark clean static layers dirty', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const staticLayer = createDirtyRectLayer({
      id: 'dividers',
      zIndex: 200,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: false,
    });
    staticLayer._setDirty(false);
    (staticLayer.isDirty as jest.Mock).mockReturnValue(false);
    registry.register(staticLayer as any);

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 200, y: 0 },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4200, y: 9400 },
    };

    loop.setLayout(layout, { invalidation: 'scroll' });

    expect(staticLayer.markDirty).not.toHaveBeenCalled();
    expect(staticLayer.isDirty()).toBe(false);
  });

  it('structural layout update still marks all layers full dirty', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const staticLayer = createDirtyRectLayer({
      id: 'dividers',
      zIndex: 200,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: false,
    });
    staticLayer._setDirty(false);
    (staticLayer.isDirty as jest.Mock).mockReturnValue(false);
    registry.register(staticLayer as any);

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 0, y: 0 },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4200, y: 9400 },
    };

    loop.setLayout(layout, { invalidation: 'structural' });

    expect(staticLayer.markDirty).toHaveBeenCalledWith({ type: 'full' });
  });

  it('canvas resize promotes partial dirty to full repaint', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [{ x: 10, y: 10, width: 50, height: 50 }],
      fullDirty: false,
    });
    registry.register(layer as any);

    // Frame 1: establish canvas size
    loop.start();
    flushRaf(16.67);

    // Frame 2: change canvas size
    (host.getSize as jest.Mock).mockReturnValue({ width: 1024, height: 768 });
    layer._setDirty(true);
    layer._setFullDirty(false);
    layer._setDirtyRects([{ x: 10, y: 10, width: 50, height: 50 }]);
    (layer.isDirty as jest.Mock).mockReturnValue(true);
    (layer.isFullDirty as jest.Mock).mockReturnValue(false);

    loop.requestFrame();
    flushRaf(33.33);

    // promoteAllToFull should have been triggered by resize
    const markDirtyCalls = (layer.markDirty as jest.Mock).mock.calls;
    const fullPromoteCall = markDirtyCalls.find(
      (call: any[]) => call[0] && call[0].type === 'full',
    );
    expect(fullPromoteCall).toBeDefined();

    loop.stop();
  });

  it('clean layer still contributes cached pixels in dirty rect region during composite', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const dirtyRect: Rect = { x: 100, y: 50, width: 200, height: 150 };

    // Layer A: dirty with a specific rect
    const dirtyLayer = createDirtyRectLayer({
      id: 'background',
      zIndex: 0,
      canvas: 0,
      cacheable: true,
      dirtyRects: [dirtyRect],
      fullDirty: false,
    });

    // Layer B: starts dirty (frame 1), will be clean on frame 2
    let cleanLayerDirty = true;
    const cleanLayer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: false,
    });
    (cleanLayer.isDirty as jest.Mock).mockImplementation(() => cleanLayerDirty);
    (cleanLayer.markClean as jest.Mock).mockImplementation(() => {
      cleanLayerDirty = false;
    });
    // Also make isFullDirty return true on frame 1 so it goes through full path initially
    let cleanLayerFullDirty = true;
    (cleanLayer.isFullDirty as jest.Mock).mockImplementation(() => cleanLayerFullDirty);

    registry.register(dirtyLayer as any);
    registry.register(cleanLayer as any);
    setIdentityLayout(loop);

    // Frame 1: both layers render (full path since cleanLayer is full-dirty)
    loop.start();
    flushRaf(16.67);

    expect(dirtyLayer.render).toHaveBeenCalledTimes(1);
    expect(cleanLayer.render).toHaveBeenCalledTimes(1);

    // Frame 2: only dirtyLayer is dirty with partial rect, cleanLayer is clean
    dirtyLayer._setDirty(true);
    (dirtyLayer.isDirty as jest.Mock).mockReturnValue(true);
    dirtyLayer._setDirtyRects([dirtyRect]);
    (dirtyLayer.isFullDirty as jest.Mock).mockReturnValue(false);

    cleanLayerDirty = false;
    cleanLayerFullDirty = false;
    (cleanLayer.isDirty as jest.Mock).mockReturnValue(false);
    (cleanLayer.isFullDirty as jest.Mock).mockReturnValue(false);

    // Reset mocks for frame 2 assertions
    const mainCtx = host.getContext(0);
    mainCtx.drawImage.mockClear();
    (cleanLayer.render as jest.Mock).mockClear();

    loop.requestFrame();
    flushRaf(33.33);

    // The clean layer should NOT be re-rendered
    expect(cleanLayer.render).not.toHaveBeenCalled();

    // But BOTH layers' caches should be composited (drawImage called for each)
    // dirtyLayer composite + cleanLayer composite = 2 drawImage calls
    const drawCalls = mainCtx.drawImage.mock.calls;
    expect(drawCalls.length).toBe(2);

    // Both should be partial (9-arg) since we're in partial path
    for (const call of drawCalls) {
      expect(call.length).toBe(9);
    }

    loop.stop();
  });

  it('layer without getDirtyRects/isFullDirty falls back to full path', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    // A basic layer without getDirtyRects or isFullDirty (no dirty rect support)
    const basicLayer = createMockLayer({
      id: 'basic',
      zIndex: 0,
      canvas: 0,
      renderMode: 'once',
    });
    registry.register(basicLayer);

    loop.start();
    flushRaf(16.67);

    const mainCtx = host.getContext(0);
    const dpr = 2;

    // Should use full clear since the layer lacks getDirtyRects/isFullDirty
    expect(mainCtx.clearRect).toHaveBeenCalledWith(0, 0, 800 * dpr, 600 * dpr);

    // Layer should still render normally
    expect(basicLayer.render).toHaveBeenCalled();
    expect(basicLayer.markClean).toHaveBeenCalled();

    loop.stop();
  });

  it('mixed layers: one with dirty rects, one without, falls back to full', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    // Layer with dirty rect support
    const dirtyRectLayer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [{ x: 10, y: 10, width: 50, height: 50 }],
      fullDirty: false,
    });

    // Layer without dirty rect support (basic layer)
    const basicLayer = createMockLayer({
      id: 'selection',
      zIndex: 200,
      canvas: 0,
      renderMode: 'once',
    });

    registry.register(dirtyRectLayer as any);
    registry.register(basicLayer);

    loop.start();
    flushRaf(16.67);

    const mainCtx = host.getContext(0);
    const dpr = 2;

    // Should fall back to full clear because basicLayer (dirty) lacks getDirtyRects
    expect(mainCtx.clearRect).toHaveBeenCalledWith(0, 0, 800 * dpr, 600 * dpr);

    loop.stop();
  });

  it('non-cached layers are clipped to dirty rect during partial dirty render (Bug #21)', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const dirtyRect: Rect = { x: 100, y: 50, width: 200, height: 150 };

    // Cached layer with partial dirty rects — triggers the partial dirty path
    const cachedLayer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 0,
      canvas: 0,
      cacheable: true,
      dirtyRects: [dirtyRect],
      fullDirty: false,
    });

    // Non-cached layer (e.g., selection overlay) — this is the layer under test
    const renderSpy = jest.fn();
    const nonCachedLayer = createDirtyRectLayer({
      id: 'selection',
      zIndex: 100,
      canvas: 0,
      cacheable: false,
      dirtyRects: [dirtyRect],
      fullDirty: false,
      render: renderSpy,
    });

    registry.register(cachedLayer as any);
    registry.register(nonCachedLayer as any);
    setIdentityLayout(loop);

    loop.start();
    flushRaf(16.67);

    const mainCtx = host.getContext(0);
    const dpr = 2;

    // Compute the expected dirty union with safety margin
    const margin = Math.ceil(1 / dpr);
    const unionX = dirtyRect.x - margin;
    const unionY = dirtyRect.y - margin;
    const unionW = dirtyRect.width + 2 * margin;
    const unionH = dirtyRect.height + 2 * margin;

    // The non-cached layer should have been rendered
    expect(renderSpy).toHaveBeenCalled();

    // Main canvas ctx should have clip() called with the dirty union rect
    // (save → beginPath → rect → clip → render → restore)
    expect(mainCtx.clip).toHaveBeenCalled();

    // Verify rect was called with the dirty union bounds on the main context
    const rectCalls = mainCtx.rect.mock.calls;
    const clipRectCall = rectCalls.find(
      (call: number[]) =>
        call[0] === unionX && call[1] === unionY && call[2] === unionW && call[3] === unionH,
    );
    expect(clipRectCall).toBeDefined();

    // save/restore should bracket the non-cached layer rendering
    expect(mainCtx.save).toHaveBeenCalled();
    expect(mainCtx.restore).toHaveBeenCalled();

    loop.stop();
  });

  it('per-region cached layer: dirty rect clip is applied in region-local coords after translate', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    // Region at non-zero origin
    const regionBounds = { x: 50, y: 30, width: 700, height: 500 };
    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 0, y: 0 },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4300, y: 9500 },
    };

    // Dirty rect in DOCUMENT-SPACE (as markCellsDirty produces).
    // With scrollOffset=0, canvas-space = region.x + docX = 50 + 150 = 200
    const dirtyRect: Rect = { x: 150, y: 80, width: 60, height: 40 };

    // Track the call order on the cache context to verify clip comes after translate
    const callLog: string[] = [];
    const cacheCanvas = new MockOffscreenCanvas(0, 0);
    const cacheCtx = cacheCanvas.getContext('2d');
    // Wrap each method to log calls
    for (const method of [
      'save',
      'restore',
      'setTransform',
      'clearRect',
      'beginPath',
      'rect',
      'clip',
      'translate',
      'scale',
    ] as const) {
      const original = cacheCtx[method];
      cacheCtx[method] = jest.fn((...args: any[]) => {
        if (method === 'rect') {
          callLog.push(`rect(${args.join(',')})`);
        } else if (method === 'translate') {
          callLog.push(`translate(${args.join(',')})`);
        } else if (method === 'clip') {
          callLog.push('clip');
        } else {
          callLog.push(method);
        }
        return original(...args);
      });
    }

    const renderSpy = jest.fn();
    let dirty = true;
    let fullDirty = true;
    const layer = {
      id: 'cells',
      zIndex: 100,
      renderMode: 'per-region' as const,
      canvas: 0,
      render: renderSpy,
      isDirty: jest.fn(() => dirty),
      markDirty: jest.fn(),
      markClean: jest.fn(() => {
        dirty = false;
      }),
      dispose: jest.fn(),
      getOrCreateCache: jest.fn((w: number, h: number) => {
        cacheCanvas.width = w;
        cacheCanvas.height = h;
        return { canvas: cacheCanvas, ctx: cacheCtx };
      }),
      clearCache: jest.fn(),
      getCacheCanvas: jest.fn(() => cacheCanvas),
      getDirtyRects: jest.fn(() => [dirtyRect]),
      isFullDirty: jest.fn(() => fullDirty),
    };

    registry.register(layer as any);
    loop.setLayout(layout);

    // Frame 1: full repaint (setLayout marks all dirty)
    loop.start();
    flushRaf(16.67);

    // Reset for frame 2
    callLog.length = 0;
    renderSpy.mockClear();
    dirty = true;
    fullDirty = false;
    (layer.isDirty as jest.Mock).mockReturnValue(true);
    (layer.isFullDirty as jest.Mock).mockReturnValue(false);

    loop.requestFrame();
    flushRaf(33.33);

    // The layer should have been rendered
    expect(renderSpy).toHaveBeenCalled();

    // Key assertion: the dirty rect clip must be applied AFTER the region translate,
    // in region-local coordinates.

    // Find the translate call for the region origin
    const translateIdx = callLog.findIndex(
      (c) => c === `translate(${regionBounds.x},${regionBounds.y})`,
    );
    expect(translateIdx).toBeGreaterThan(-1);

    // collectDirtyUnion converts doc-space to canvas-space:
    // canvasX = region.x + (docX - scrollX) = 50 + (150 - 0) = 200
    // canvasY = region.y + (docY - scrollY) = 30 + (80 - 0) = 110
    // With margin (1px): union = (199, 109, 62, 42)
    // renderPerRegion converts canvas-space to region-local:
    // localX = (199 - 50) / 1 = 149, localY = (109 - 30) / 1 = 79
    const dpr = 2;
    const margin = Math.ceil(1 / dpr);
    const canvasX = regionBounds.x + dirtyRect.x; // scrollX=0
    const canvasY = regionBounds.y + dirtyRect.y;
    const unionX = canvasX - margin;
    const unionY = canvasY - margin;
    const unionW = dirtyRect.width + 2 * margin;
    const unionH = dirtyRect.height + 2 * margin;
    const localX = unionX - regionBounds.x; // = docX - margin = 149
    const localY = unionY - regionBounds.y; // = docY - margin = 79
    const localRectStr = `rect(${localX},${localY},${unionW},${unionH})`;
    const localRectIdx = callLog.indexOf(localRectStr, translateIdx);

    // Find clip after the local rect
    const clipAfterLocalRect = localRectIdx >= 0 ? callLog.indexOf('clip', localRectIdx) : -1;

    expect(localRectIdx).toBeGreaterThan(translateIdx);
    expect(clipAfterLocalRect).toBeGreaterThan(localRectIdx);

    loop.stop();
  });
});

// =============================================================================
// Bug 2 diagnosis: dirty rects in document-space vs canvas-space
// =============================================================================

describe('Bug 2: dirty rects must be converted from document-space to canvas-space', () => {
  /**
   * When scrolled, dirty rects from markCellsDirty() are in document-space
   * (e.g., col left = 359px from document origin). The render pipeline must
   * convert these to canvas-space before clearing/clipping/compositing.
   *
   * Canvas-space position = region.bounds.x + (docX - scrollOffset.x) * zoom
   *
   * When scrollOffset is 0 this is invisible because doc-space ≈ canvas-space.
   * These tests use non-zero scroll offsets to expose the mismatch.
   *
   * IMPORTANT: setLayout() calls markAllDirty() which forces full repaint on
   * frame 1. All tests use a two-frame approach: frame 1 establishes scroll
   * state (full repaint), frame 2 tests partial dirty rect behavior.
   */

  /** Helper: run frame 1 (full repaint) to establish scroll state, then set up frame 2 */
  function setupTwoFrameTest(opts: {
    host: ReturnType<typeof createMockCanvasHost>;
    loop: RenderLoop;
    layout: any;
    layer: ReturnType<typeof createDirtyRectLayer>;
    docRect: Rect;
  }) {
    const { host, loop, layout, layer, docRect } = opts;

    loop.setLayout(layout);
    loop.start();
    flushRaf(16.67); // Frame 1: full repaint, establishes scroll state

    // Reset mocks for frame 2 assertions
    const mainCtx = host.getContext(0);
    mainCtx.clearRect.mockClear();
    mainCtx.drawImage.mockClear();
    mainCtx.save.mockClear();
    mainCtx.restore.mockClear();
    mainCtx.beginPath.mockClear();
    mainCtx.rect.mockClear();
    mainCtx.clip.mockClear();
    mainCtx.setTransform.mockClear();

    // Set up frame 2: layer dirty with partial rect
    layer._setDirty(true);
    layer._setFullDirty(false);
    layer._setDirtyRects([docRect]);
    (layer.isDirty as jest.Mock).mockReturnValue(true);
    (layer.isFullDirty as jest.Mock).mockReturnValue(false);
    (layer._cacheCtx as any).clearRect?.mockClear?.();

    loop.requestFrame();
    flushRaf(33.33); // Frame 2: partial dirty rect
  }

  it('clearDirtyRect uses canvas-space coords, not raw document-space coords (scrolled)', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const scrollX = 200;
    const scrollY = 500;
    const regionBounds = { x: 50, y: 30, width: 700, height: 500 };

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: scrollX, y: scrollY },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4300, y: 9500 },
    };

    // Dirty rect in DOCUMENT-SPACE (as markCellsDirty produces)
    const docSpaceDirtyRect: Rect = { x: 359, y: 639, width: 74, height: 22 };

    // Expected canvas-space position:
    // canvasX = region.bounds.x + (docX - scrollX) * zoom = 50 + (359 - 200) = 209
    // canvasY = region.bounds.y + (docY - scrollY) * zoom = 30 + (639 - 500) = 169
    const expectedCanvasX = regionBounds.x + (docSpaceDirtyRect.x - scrollX);
    const expectedCanvasY = regionBounds.y + (docSpaceDirtyRect.y - scrollY);
    const expectedCanvasW = docSpaceDirtyRect.width;
    const expectedCanvasH = docSpaceDirtyRect.height;

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: true, // frame 1 is full
    });
    (layer as any).renderMode = 'per-region';

    registry.register(layer as any);

    setupTwoFrameTest({ host, loop, layout, layer, docRect: docSpaceDirtyRect });

    const mainCtx = host.getContext(0);
    const dpr = 2;
    const margin = Math.ceil(1 / dpr); // = 1

    // The expected canvas-space dirty union (with margin)
    const unionX = expectedCanvasX - margin;
    const unionY = expectedCanvasY - margin;
    const unionW = expectedCanvasW + 2 * margin;
    const unionH = expectedCanvasH + 2 * margin;

    // Convert to physical pixels
    const physX = Math.floor(unionX * dpr);
    const physY = Math.floor(unionY * dpr);
    const physW = Math.ceil((unionX + unionW) * dpr) - physX;
    const physH = Math.ceil((unionY + unionH) * dpr) - physY;

    // clearDirtyRect should clear at CANVAS-SPACE physical pixels, not document-space
    expect(mainCtx.clearRect).toHaveBeenCalledWith(physX, physY, physW, physH);

    // Sanity: document-space coords are different from canvas-space when scrolled
    const wrongPhysX = Math.floor((docSpaceDirtyRect.x - margin) * dpr);
    const wrongPhysY = Math.floor((docSpaceDirtyRect.y - margin) * dpr);
    expect(wrongPhysX).not.toBe(physX);
    expect(wrongPhysY).not.toBe(physY);

    loop.stop();
  });

  it('partial composite drawImage uses canvas-space coords when scrolled', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const scrollX = 100;
    const scrollY = 300;
    const regionBounds = { x: 0, y: 0, width: 800, height: 600 };

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: scrollX, y: scrollY },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4200, y: 9400 },
    };

    // Document-space dirty rect: cell at doc position (400, 700)
    const docRect: Rect = { x: 400, y: 700, width: 80, height: 25 };

    // Expected canvas-space:
    // canvasX = 0 + (400 - 100) = 300
    // canvasY = 0 + (700 - 300) = 400
    const expectedCanvasX = regionBounds.x + (docRect.x - scrollX);
    const expectedCanvasY = regionBounds.y + (docRect.y - scrollY);

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: true,
    });
    (layer as any).renderMode = 'per-region';

    registry.register(layer as any);

    setupTwoFrameTest({ host, loop, layout, layer, docRect });

    const mainCtx = host.getContext(0);
    const dpr = 2;
    const margin = Math.ceil(1 / dpr);

    const unionX = expectedCanvasX - margin;
    const unionY = expectedCanvasY - margin;
    const unionW = docRect.width + 2 * margin;
    const unionH = docRect.height + 2 * margin;

    const physX = Math.floor(unionX * dpr);
    const physY = Math.floor(unionY * dpr);
    const physW = Math.ceil((unionX + unionW) * dpr) - physX;
    const physH = Math.ceil((unionY + unionH) * dpr) - physY;

    // drawImage should use canvas-space physical coords for the 9-arg partial composite
    const drawCalls = mainCtx.drawImage.mock.calls;
    const partialDraw = drawCalls.find((call: any[]) => call.length === 9);
    expect(partialDraw).toBeDefined();
    expect(partialDraw![1]).toBe(physX); // sx — canvas-space, not document-space
    expect(partialDraw![2]).toBe(physY); // sy
    expect(partialDraw![5]).toBe(physX); // dx
    expect(partialDraw![6]).toBe(physY); // dy

    loop.stop();
  });

  it('renderPerRegion clip uses correct layer-local coords when dirty rect is document-space', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const scrollX = 150;
    const scrollY = 400;
    const regionBounds = { x: 50, y: 30, width: 700, height: 500 };

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: scrollX, y: scrollY },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4300, y: 9500 },
    };

    // Document-space dirty rect
    const docRect: Rect = { x: 300, y: 550, width: 60, height: 20 };

    const callLog: string[] = [];
    const cacheCanvas = new MockOffscreenCanvas(0, 0);
    const cacheCtx = cacheCanvas.getContext('2d');
    for (const method of [
      'save',
      'restore',
      'setTransform',
      'clearRect',
      'beginPath',
      'rect',
      'clip',
      'translate',
      'scale',
    ] as const) {
      const original = cacheCtx[method];
      cacheCtx[method] = jest.fn((...args: any[]) => {
        if (method === 'rect') {
          callLog.push(`rect(${args.join(',')})`);
        } else if (method === 'translate') {
          callLog.push(`translate(${args.join(',')})`);
        } else if (method === 'clip') {
          callLog.push('clip');
        } else {
          callLog.push(method);
        }
        return original(...args);
      });
    }

    const renderSpy = jest.fn();
    let dirty = true;
    let fullDirty = true;
    const layer = {
      id: 'cells',
      zIndex: 100,
      renderMode: 'per-region' as const,
      canvas: 0,
      render: renderSpy,
      isDirty: jest.fn(() => dirty),
      markDirty: jest.fn(),
      markClean: jest.fn(() => {
        dirty = false;
      }),
      dispose: jest.fn(),
      getOrCreateCache: jest.fn((w: number, h: number) => {
        cacheCanvas.width = w;
        cacheCanvas.height = h;
        return { canvas: cacheCanvas, ctx: cacheCtx };
      }),
      clearCache: jest.fn(),
      getCacheCanvas: jest.fn(() => cacheCanvas),
      getDirtyRects: jest.fn(() => [docRect]),
      isFullDirty: jest.fn(() => fullDirty),
    };

    registry.register(layer as any);
    loop.setLayout(layout);

    // Frame 1: full repaint
    loop.start();
    flushRaf(16.67);

    // Reset for frame 2
    callLog.length = 0;
    renderSpy.mockClear();
    dirty = true;
    fullDirty = false;
    (layer.isDirty as jest.Mock).mockReturnValue(true);
    (layer.isFullDirty as jest.Mock).mockReturnValue(false);

    loop.requestFrame();
    flushRaf(33.33);

    expect(renderSpy).toHaveBeenCalled();

    const dpr = 2;
    const margin = Math.ceil(1 / dpr);

    // After collectDirtyUnion converts doc→canvas-space, the dirty union in canvas-space is:
    // canvasX = 50 + (300 - 150) = 200, canvasY = 30 + (550 - 400) = 180
    // With margin: (199, 179, 62, 22)
    //
    // renderPerRegion then converts canvas-space → region-local:
    // localX = (199 - 50) / 1 = 149
    // localY = (179 - 30) / 1 = 149
    const expectedCanvasX = regionBounds.x + (docRect.x - scrollX);
    const expectedCanvasY = regionBounds.y + (docRect.y - scrollY);
    const unionX = expectedCanvasX - margin;
    const unionY = expectedCanvasY - margin;
    const unionW = docRect.width + 2 * margin;
    const unionH = docRect.height + 2 * margin;
    const localClipX = unionX - regionBounds.x;
    const localClipY = unionY - regionBounds.y;

    // Find the translate for region origin
    const translateIdx = callLog.findIndex(
      (c) => c === `translate(${regionBounds.x},${regionBounds.y})`,
    );
    expect(translateIdx).toBeGreaterThan(-1);

    // The dirty rect clip must be at layer-local coords after translate
    const expectedRectStr = `rect(${localClipX},${localClipY},${unionW},${unionH})`;
    const rectIdx = callLog.indexOf(expectedRectStr, translateIdx);
    const clipIdx = rectIdx >= 0 ? callLog.indexOf('clip', rectIdx) : -1;

    expect(rectIdx).toBeGreaterThan(translateIdx);
    expect(clipIdx).toBeGreaterThan(rectIdx);

    loop.stop();
  });

  it('cache clearRect uses canvas-space coords, not document-space', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const scrollX = 200;
    const scrollY = 500;
    const regionBounds = { x: 50, y: 30, width: 700, height: 500 };

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: scrollX, y: scrollY },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4300, y: 9500 },
    };

    // Document-space dirty rect
    const docRect: Rect = { x: 359, y: 639, width: 74, height: 22 };

    // Expected canvas-space: (50 + 159, 30 + 139) = (209, 169)
    const expectedCanvasX = regionBounds.x + (docRect.x - scrollX);
    const expectedCanvasY = regionBounds.y + (docRect.y - scrollY);

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: true,
    });
    (layer as any).renderMode = 'per-region';

    registry.register(layer as any);

    setupTwoFrameTest({ host, loop, layout, layer, docRect });

    const dpr = 2;
    const margin = Math.ceil(1 / dpr);

    const unionX = expectedCanvasX - margin;
    const unionY = expectedCanvasY - margin;
    const unionW = docRect.width + 2 * margin;
    const unionH = docRect.height + 2 * margin;

    // Cache clearRect should use canvas-space coords (the dirty union)
    expect(layer._cacheCtx.clearRect).toHaveBeenCalledWith(unionX, unionY, unionW, unionH);

    // NOT the raw document-space coords
    const wrongX = docRect.x - margin;
    const wrongY = docRect.y - margin;
    expect(wrongX).not.toBe(unionX);
    expect(wrongY).not.toBe(unionY);

    loop.stop();
  });

  it('with zoom != 1, dirty rect dimensions are scaled to canvas-space', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const scrollX = 100;
    const scrollY = 200;
    const zoom = 1.5;
    const regionBounds = { x: 0, y: 0, width: 800, height: 600 };

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: scrollX, y: scrollY },
          zoom,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4200, y: 9400 },
    };

    // Document-space dirty rect
    const docRect: Rect = { x: 200, y: 400, width: 80, height: 25 };

    // Expected canvas-space:
    // canvasX = 0 + (200 - 100) * 1.5 = 150
    // canvasY = 0 + (400 - 200) * 1.5 = 300
    // canvasW = 80 * 1.5 = 120
    // canvasH = 25 * 1.5 = 37.5
    const expectedCanvasX = regionBounds.x + (docRect.x - scrollX) * zoom;
    const expectedCanvasY = regionBounds.y + (docRect.y - scrollY) * zoom;
    const expectedCanvasW = docRect.width * zoom;
    const expectedCanvasH = docRect.height * zoom;

    const layer = createDirtyRectLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      cacheable: true,
      dirtyRects: [],
      fullDirty: true,
    });
    (layer as any).renderMode = 'per-region';

    registry.register(layer as any);

    setupTwoFrameTest({ host, loop, layout, layer, docRect });

    const mainCtx = host.getContext(0);
    const dpr = 2;
    const margin = Math.ceil(1 / dpr);

    const unionX = expectedCanvasX - margin;
    const unionY = expectedCanvasY - margin;
    const unionW = expectedCanvasW + 2 * margin;
    const unionH = expectedCanvasH + 2 * margin;

    const physX = Math.floor(unionX * dpr);
    const physY = Math.floor(unionY * dpr);
    const physW = Math.ceil((unionX + unionW) * dpr) - physX;
    const physH = Math.ceil((unionY + unionH) * dpr) - physY;

    // clearDirtyRect should use zoomed canvas-space coords
    expect(mainCtx.clearRect).toHaveBeenCalledWith(physX, physY, physW, physH);

    loop.stop();
  });
});

// =============================================================================
// collectDirtyUnion converts once-mode layers' doc-space rects to canvas-space
// =============================================================================

describe('collectDirtyUnion: once-mode layers with non-zero scroll + zoom', () => {
  /**
   * collectDirtyUnion converts ALL layer types' dirty rects from
   * doc-space to canvas-space, including once-mode layers. Before the fix,
   * once-mode layers' rects were assumed to already be in canvas-space, which
   * was wrong when they used ViewportPositionIndex positions (doc-space).
   *
   * These tests verify that once-mode layers' dirty rects are converted
   * just like per-region layers'.
   */

  /** Helper: run frame 1 (full repaint) to establish state, then set up frame 2 */
  function setupOnceModeTwoFrameTest(opts: {
    host: ReturnType<typeof createMockCanvasHost>;
    loop: RenderLoop;
    layout: any;
    layer: ReturnType<typeof createDirtyRectLayer>;
    docRect: Rect;
  }) {
    const { host, loop, layout, layer, docRect } = opts;

    loop.setLayout(layout);
    loop.start();
    flushRaf(16.67); // Frame 1: full repaint

    // Reset mocks for frame 2
    const mainCtx = host.getContext(0);
    mainCtx.clearRect.mockClear();
    mainCtx.drawImage.mockClear();
    mainCtx.save.mockClear();
    mainCtx.restore.mockClear();
    mainCtx.beginPath.mockClear();
    mainCtx.rect.mockClear();
    mainCtx.clip.mockClear();
    mainCtx.setTransform.mockClear();

    // Set up frame 2: layer dirty with partial rect
    layer._setDirty(true);
    layer._setFullDirty(false);
    layer._setDirtyRects([docRect]);
    (layer.isDirty as jest.Mock).mockReturnValue(true);
    (layer.isFullDirty as jest.Mock).mockReturnValue(false);
    (layer._cacheCtx as any).clearRect?.mockClear?.();

    loop.requestFrame();
    flushRaf(33.33); // Frame 2: partial dirty rect
  }

  it('once-mode layer dirty rects are converted to canvas-space (not passed through as-is)', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const scrollX = 300;
    const scrollY = 150;
    const regionBounds = { x: 40, y: 20, width: 760, height: 580 };

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: scrollX, y: scrollY },
          zoom: 1,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4260, y: 9420 },
    };

    // Doc-space dirty rect (as emitted by e.g. computeHeadersDirtyHint)
    const docRect: Rect = { x: 400, y: 200, width: 100, height: 30 };

    // Expected canvas-space conversion:
    // canvasX = 40 + (400 - 300) * 1 = 140
    // canvasY = 20 + (200 - 150) * 1 = 70
    const expectedCanvasX = regionBounds.x + (docRect.x - scrollX);
    const expectedCanvasY = regionBounds.y + (docRect.y - scrollY);

    const layer = createDirtyRectLayer({
      id: 'headers',
      zIndex: 500,
      canvas: 0,
      cacheable: true,
      renderMode: 'once', // ONCE mode
      dirtyRects: [],
      fullDirty: true,
    });

    registry.register(layer as any);

    setupOnceModeTwoFrameTest({ host, loop, layout, layer, docRect });

    const mainCtx = host.getContext(0);
    const dpr = 2;
    const margin = Math.ceil(1 / dpr);

    const unionX = expectedCanvasX - margin;
    const unionY = expectedCanvasY - margin;
    const unionW = docRect.width + 2 * margin;
    const unionH = docRect.height + 2 * margin;

    // Convert to physical pixels
    const physX = Math.floor(unionX * dpr);
    const physY = Math.floor(unionY * dpr);
    const physW = Math.ceil((unionX + unionW) * dpr) - physX;
    const physH = Math.ceil((unionY + unionH) * dpr) - physY;

    // clearDirtyRect must use CANVAS-SPACE (converted) physical pixels
    expect(mainCtx.clearRect).toHaveBeenCalledWith(physX, physY, physW, physH);

    // Sanity: raw doc-space coords would be different
    const wrongPhysX = Math.floor((docRect.x - margin) * dpr);
    const wrongPhysY = Math.floor((docRect.y - margin) * dpr);
    expect(wrongPhysX).not.toBe(physX);
    expect(wrongPhysY).not.toBe(physY);

    loop.stop();
  });

  it('once-mode layer dirty rects with zoom != 1 are scaled correctly', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const scrollX = 100;
    const scrollY = 200;
    const zoom = 2;
    const regionBounds = { x: 50, y: 30, width: 750, height: 570 };

    const layout = {
      regions: [
        {
          id: 'main',
          bounds: regionBounds,
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: scrollX, y: scrollY },
          zoom,
          metadata: undefined,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4250, y: 9430 },
    };

    // Doc-space dirty rect
    const docRect: Rect = { x: 250, y: 350, width: 60, height: 20 };

    // Expected canvas-space conversion with zoom:
    // canvasX = 50 + (250 - 100) * 2 = 350
    // canvasY = 30 + (350 - 200) * 2 = 330
    // canvasW = 60 * 2 = 120
    // canvasH = 20 * 2 = 40
    const expectedCanvasX = regionBounds.x + (docRect.x - scrollX) * zoom;
    const expectedCanvasY = regionBounds.y + (docRect.y - scrollY) * zoom;
    const expectedCanvasW = docRect.width * zoom;
    const expectedCanvasH = docRect.height * zoom;

    const layer = createDirtyRectLayer({
      id: 'headers-zoom',
      zIndex: 500,
      canvas: 0,
      cacheable: true,
      renderMode: 'once',
      dirtyRects: [],
      fullDirty: true,
    });

    registry.register(layer as any);

    setupOnceModeTwoFrameTest({ host, loop, layout, layer, docRect });

    const mainCtx = host.getContext(0);
    const dpr = 2;
    const margin = Math.ceil(1 / dpr);

    const unionX = expectedCanvasX - margin;
    const unionY = expectedCanvasY - margin;
    const unionW = expectedCanvasW + 2 * margin;
    const unionH = expectedCanvasH + 2 * margin;

    const physX = Math.floor(unionX * dpr);
    const physY = Math.floor(unionY * dpr);
    const physW = Math.ceil((unionX + unionW) * dpr) - physX;
    const physH = Math.ceil((unionY + unionH) * dpr) - physY;

    // clearDirtyRect must use zoomed canvas-space coords
    expect(mainCtx.clearRect).toHaveBeenCalledWith(physX, physY, physW, physH);

    loop.stop();
  });
});
