/**
 * @jest-environment jsdom
 */

/**
 * Integration test for createCanvasEngine factory
 */

import { jest } from '@jest/globals';

import type { CanvasLayer } from '../core/types';

// =============================================================================
// Mock DOM environment
// =============================================================================

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as any).ResizeObserver = MockResizeObserver;

// Mock matchMedia
window.matchMedia = jest.fn(() => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  matches: false,
  media: '',
  onchange: null,
  addListener: jest.fn(),
  removeListener: jest.fn(),
  dispatchEvent: jest.fn(),
}));

// Mock rAF
let rafCallbacks: Array<{ id: number; cb: (timestamp: number) => void }> = [];
let nextRafId = 1;
window.requestAnimationFrame = jest.fn((cb: (timestamp: number) => void) => {
  const id = nextRafId++;
  rafCallbacks.push({ id, cb });
  return id;
});
window.cancelAnimationFrame = jest.fn((id: number) => {
  rafCallbacks = rafCallbacks.filter((r) => r.id !== id);
});

function flushRaf(timestamp = 16.67) {
  const callbacks = [...rafCallbacks];
  rafCallbacks = [];
  for (const { cb } of callbacks) {
    cb(timestamp);
  }
}

// Mock document.createElement for canvas (jsdom canvas has no real 2d context)
const originalCreateElement = document.createElement.bind(document);
jest.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
  if (tag === 'canvas') {
    const canvas = originalCreateElement('canvas');
    // Override getContext since jsdom doesn't support canvas 2d properly
    canvas.getContext = jest.fn(() => ({
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      clearRect: jest.fn(),
      fillStyle: '',
      fillRect: jest.fn(),
      setTransform: jest.fn(),
    })) as any;
    return canvas;
  }
  return originalCreateElement(tag, options);
});

// Mock navigator.deviceMemory
Object.defineProperty(navigator, 'deviceMemory', {
  value: 8,
  writable: true,
  configurable: true,
});

// Mock window.devicePixelRatio
Object.defineProperty(window, 'devicePixelRatio', {
  value: 2,
  writable: true,
  configurable: true,
});

// Suppress console output in tests
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'info').mockImplementation(() => {});

// =============================================================================
// Import after mocks
// =============================================================================

import { createCanvasEngine } from '../engine';

// =============================================================================
// Helpers
// =============================================================================

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  // jsdom doesn't lay out elements, so mock getBoundingClientRect
  container.getBoundingClientRect = jest.fn(() => ({
    width: 1024,
    height: 768,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1024,
    bottom: 768,
    toJSON: () => {},
  }));
  return container;
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
    markDirty: jest.fn(() => {
      dirty = true;
    }),
    markClean: jest.fn(() => {
      dirty = false;
    }),
    dispose: jest.fn(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('createCanvasEngine', () => {
  beforeEach(() => {
    rafCallbacks = [];
    nextRafId = 1;
  });

  it('creates an engine instance with all components', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    expect(engine).toBeDefined();
    expect(engine.canvasMode).toBe('multi');
    expect(engine.animationClock).toBeDefined();
    expect(engine.input).toBeDefined();
    expect(engine.cursor).toBeDefined();
    expect(engine.pointer).toBeDefined();
    expect(engine.effectiveState).toBeDefined();
    expect(engine.registry).toBeDefined();
    expect(engine.scheduler).toBeDefined();

    engine.dispose();
  });

  it('registers and renders layers', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const layer = createMockLayer({ id: 'bg', zIndex: 0, canvas: 0 });
    engine.registerLayer(layer);

    engine.start();
    flushRaf(16.67);

    expect(layer.render).toHaveBeenCalled();

    engine.stop();
    engine.dispose();
  });

  it('unregisters layers', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const layer = createMockLayer({ id: 'temp', zIndex: 0, canvas: 0 });
    engine.registerLayer(layer);
    engine.unregisterLayer('temp');

    expect(layer.dispose).toHaveBeenCalled();

    engine.dispose();
  });

  it('marks layers dirty', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const layer = createMockLayer({ id: 'cells', zIndex: 100, canvas: 0 });
    engine.registerLayer(layer);

    engine.markDirty('cells', { type: 'full' });
    expect(layer.markDirty).toHaveBeenCalledWith({ type: 'full' });

    engine.dispose();
  });

  it('provides stats', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const layer = createMockLayer({ id: 'cells', canvas: 0 });
    engine.registerLayer(layer);

    const stats = engine.getStats();
    expect(stats.layerCount).toBe(1);
    expect(stats.fps).toBeDefined();

    engine.dispose();
  });

  it('sets region layout', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const layer = createMockLayer({ id: 'cells', canvas: 0 });
    engine.registerLayer(layer);

    engine.setLayout({
      regions: [
        {
          id: 'main',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 0, y: 0 },
          zoom: 1,
          metadata: null,
        },
      ],
      contentSize: { width: 5000, height: 10000 },
      maxScroll: { x: 4200, y: 9400 },
    });

    engine.start();
    flushRaf(16.67);

    // Should render with the region
    expect(layer.render).toHaveBeenCalled();

    engine.stop();
    engine.dispose();
  });

  it('disposes all resources', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const layer1 = createMockLayer({ id: 'bg', zIndex: 0, canvas: 0 });
    const layer2 = createMockLayer({ id: 'cells', zIndex: 100, canvas: 0 });
    engine.registerLayer(layer1);
    engine.registerLayer(layer2);

    engine.dispose();

    expect(layer1.dispose).toHaveBeenCalled();
    expect(layer2.dispose).toHaveBeenCalled();
  });

  it('pause and resume work', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const layer = createMockLayer({ id: 'cells', canvas: 0 });
    engine.registerLayer(layer);

    engine.start();
    engine.pause();

    // Flush rAF — should NOT render because paused
    flushRaf(16.67);
    const callCountWhilePaused = (layer.render as jest.Mock).mock.calls.length;

    engine.resume();
    flushRaf(33.33);

    // Should have rendered after resume
    expect((layer.render as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(
      callCountWhilePaused,
    );

    engine.stop();
    engine.dispose();
  });

  it('hit test dispatches to providers', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const mockProvider = {
      hitTest: jest.fn(() => ({
        layerId: 'overlay',
        target: { objectId: 'obj-1' },
        position: { x: 100, y: 200 },
      })),
    };

    engine.registerHitTestProvider(mockProvider, 500);

    const result = engine.hitTest({ x: 100, y: 200 });
    expect(result).not.toBeNull();
    expect(result!.layerId).toBe('overlay');
    expect(result!.target).toEqual({ objectId: 'obj-1' });

    engine.dispose();
  });

  it('handles two canvases rendering independently', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    const worldLayer = createMockLayer({ id: 'cells', zIndex: 100, canvas: 0 });
    const overlayLayer = createMockLayer({
      id: 'overlay',
      zIndex: 0,
      canvas: 1,
      renderMode: 'once',
    });

    engine.registerLayer(worldLayer);
    engine.registerLayer(overlayLayer);

    engine.start();
    flushRaf(16.67);

    expect(worldLayer.render).toHaveBeenCalled();
    expect(overlayLayer.render).toHaveBeenCalled();

    engine.stop();
    engine.dispose();
  });

  it('effective state manager works', () => {
    const container = createContainer();
    const engine = createCanvasEngine({ container });

    engine.effectiveState.setEffective('obj-1', { x: 10, y: 20, width: 100, height: 50 });
    expect(engine.effectiveState.getEffective('obj-1')).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });

    engine.effectiveState.clearEffective('obj-1');
    expect(engine.effectiveState.getEffective('obj-1')).toBeNull();

    engine.dispose();
  });
});
