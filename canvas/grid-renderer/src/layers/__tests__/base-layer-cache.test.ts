/**
 * BaseLayer Cache Tests
 *
 * Tests for per-layer off-screen caching in BaseLayer.
 */

import { jest } from '@jest/globals';

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import { BaseLayer } from '../base-layer';

// =============================================================================
// Test Layer Implementation
// =============================================================================

class TestLayer extends BaseLayer {
  renderCallCount = 0;

  render(_ctx: CanvasRenderingContext2D, _region: RenderRegion, _frame: FrameContext): void {
    this.renderCallCount++;
  }
}

// =============================================================================
// OffscreenCanvas mock
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
      drawImage: jest.fn(),
    };
  }

  getContext(_type: string): Record<string, jest.Mock> {
    return this._ctx;
  }
}

beforeEach(() => {
  // Ensure OffscreenCanvas is available in the test environment
  (global as any).OffscreenCanvas = MockOffscreenCanvas;
});

afterEach(() => {
  delete (global as any).OffscreenCanvas;
});

// =============================================================================
// Tests
// =============================================================================

describe('BaseLayer cache', () => {
  it('cacheable layer creates off-screen cache', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
      cacheable: true,
    });

    const result = layer.getOrCreateCache(1600, 1200);

    expect(result).not.toBeNull();
    expect(result!.canvas).toBeInstanceOf(MockOffscreenCanvas);
    expect(result!.ctx).toBeDefined();
  });

  it('cacheable defaults to true when not specified', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    expect(layer.cacheable).toBe(true);
    const result = layer.getOrCreateCache(800, 600);
    expect(result).not.toBeNull();
  });

  it('non-cacheable layer returns null from getOrCreateCache', () => {
    const layer = new TestLayer({
      id: 'selection',
      zIndex: 200,
      renderMode: 'per-region',
      canvas: 0,
      cacheable: false,
    });

    const result = layer.getOrCreateCache(1600, 1200);

    expect(result).toBeNull();
  });

  it('non-cacheable layer getCacheCanvas returns null', () => {
    const layer = new TestLayer({
      id: 'selection',
      zIndex: 200,
      renderMode: 'per-region',
      canvas: 0,
      cacheable: false,
    });

    expect(layer.getCacheCanvas()).toBeNull();
  });

  it('returns same cache on repeated calls with same dimensions', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    const first = layer.getOrCreateCache(1600, 1200);
    const second = layer.getOrCreateCache(1600, 1200);

    expect(first!.canvas).toBe(second!.canvas);
    expect(first!.ctx).toBe(second!.ctx);
  });

  it('cache is resized when dimensions change', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    const first = layer.getOrCreateCache(1600, 1200);
    const firstCanvas = first!.canvas;

    const second = layer.getOrCreateCache(2400, 1800);
    const secondCanvas = second!.canvas;

    // Should be a different canvas instance
    expect(secondCanvas).not.toBe(firstCanvas);
    expect((secondCanvas as any).width).toBe(2400);
    expect((secondCanvas as any).height).toBe(1800);
  });

  it('cache resize marks the layer dirty', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    layer.getOrCreateCache(1600, 1200);
    layer.markClean();
    expect(layer.isDirty()).toBe(false);

    // Resize the cache
    layer.getOrCreateCache(2400, 1800);
    expect(layer.isDirty()).toBe(true);
  });

  it('clearCache clears the cache canvas', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    const result = layer.getOrCreateCache(1600, 1200);
    layer.clearCache();

    expect(result!.ctx.clearRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
  });

  it('invalidateCache clears the cache and marks dirty', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    layer.getOrCreateCache(1600, 1200);
    layer.markClean();
    expect(layer.isDirty()).toBe(false);

    layer.invalidateCache();

    expect(layer.isDirty()).toBe(true);
    expect(layer.getCacheCanvas()).toBeNull();
  });

  it('dispose clears the cache', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    layer.getOrCreateCache(1600, 1200);
    expect(layer.getCacheCanvas()).not.toBeNull();

    layer.dispose();

    // After dispose, getCacheCanvas returns null because cacheable is still true
    // but internal canvas is null
    expect(layer.getCacheCanvas()).toBeNull();
  });

  it('getCacheCanvas returns the cache canvas for cacheable layers', () => {
    const layer = new TestLayer({
      id: 'test',
      zIndex: 0,
      renderMode: 'once',
      canvas: 0,
    });

    expect(layer.getCacheCanvas()).toBeNull(); // No cache yet

    layer.getOrCreateCache(800, 600);

    expect(layer.getCacheCanvas()).not.toBeNull();
    expect(layer.getCacheCanvas()).toBeInstanceOf(MockOffscreenCanvas);
  });

  it('falls back to HTMLCanvasElement when OffscreenCanvas is unavailable', () => {
    // Remove OffscreenCanvas from global
    delete (global as any).OffscreenCanvas;

    // Mock document.createElement since jsdom may not be available
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => ({
        clearRect: jest.fn(),
      })),
    };
    const mockDocument = {
      createElement: jest.fn((tag: string) => {
        if (tag === 'canvas') return mockCanvas;
        return {};
      }),
    };
    (global as any).document = mockDocument;

    try {
      const layer = new TestLayer({
        id: 'test',
        zIndex: 0,
        renderMode: 'once',
        canvas: 0,
      });

      const result = layer.getOrCreateCache(800, 600);

      expect(result).not.toBeNull();
      expect(result!.canvas).toBe(mockCanvas);
      expect(mockCanvas.width).toBe(800);
      expect(mockCanvas.height).toBe(600);
    } finally {
      delete (global as any).document;
    }
  });
});
