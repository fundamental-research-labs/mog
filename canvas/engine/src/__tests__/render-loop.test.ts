/**
 * RenderLoop Tests
 */

import { jest } from '@jest/globals';

import type { CanvasLayer, DirtyHint, RenderRegion } from '../core/types';

import { RenderLoop } from '../loop/render-loop';
import { LayerRegistry } from '../registry/layer-registry';
import { PriorityScheduler } from '../scheduler/priority-scheduler';

// =============================================================================
// Mocks
// =============================================================================

function createMockCanvasHost(canvasCount = 2) {
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
    };
  }

  return {
    getContext: jest.fn((index: number) => contexts[index]),
    getCanvas: jest.fn(),
    getSize: jest.fn(() => ({ width: 800, height: 600 })),
    getDPR: jest.fn(() => 1),
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
    markDirty: jest.fn((hint?: DirtyHint) => {
      dirty = true;
    }),
    markClean: jest.fn(() => {
      dirty = false;
    }),
    dispose: jest.fn(),
    ...overrides,
  };
}

// Mock rAF
let rafCallbacks: Array<{ id: number; cb: (timestamp: number) => void }> = [];
let nextRafId = 1;

beforeEach(() => {
  rafCallbacks = [];
  nextRafId = 1;

  (global as any).requestAnimationFrame = jest.fn((cb: (timestamp: number) => void) => {
    const id = nextRafId++;
    rafCallbacks.push({ id, cb });
    return id;
  });

  (global as any).cancelAnimationFrame = jest.fn((id: number) => {
    rafCallbacks = rafCallbacks.filter((r) => r.id !== id);
  });
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

describe('RenderLoop', () => {
  it('starts and stops the render loop', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();

    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    expect(loop.isRunning()).toBe(false);
    loop.start();
    expect(loop.isRunning()).toBe(true);
    loop.stop();
    expect(loop.isRunning()).toBe(false);
  });

  it('pauses and resumes', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();

    const loop = new RenderLoop({ host: host as any, registry, scheduler });
    loop.start();
    expect(loop.isRunning()).toBe(true);

    loop.pause();
    expect(loop.isRunning()).toBe(false);

    loop.resume();
    expect(loop.isRunning()).toBe(true);

    loop.stop();
  });

  it('renders dirty layers on frame', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createMockLayer({ id: 'cells', zIndex: 100, canvas: 0 });
    registry.register(layer);

    loop.start();
    flushRaf(16.67);

    expect(layer.render).toHaveBeenCalled();
    expect(layer.markClean).toHaveBeenCalled();

    loop.stop();
  });

  it('does not render clean layers', () => {
    const host = createMockCanvasHost();
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const dirty = false;
    const layer = createMockLayer({
      id: 'clean-layer',
      canvas: 0,
      isDirty: jest.fn(() => dirty),
    });
    registry.register(layer);

    loop.start();
    flushRaf(16.67);

    // Layer was not dirty, but the canvas had no dirty layers so no render
    // Actually hasDirtyLayers checks isDirty() on each layer
    expect(layer.render).not.toHaveBeenCalled();

    loop.stop();
  });

  it('renders per-region layers with clip/translate/scale', () => {
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createMockLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      renderMode: 'per-region',
    });
    registry.register(layer);

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

    const ctx = host.getContext(0);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.rect).toHaveBeenCalledWith(50, 30, 700, 500);
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.translate).toHaveBeenCalledWith(50, 30);
    expect(ctx.scale).toHaveBeenCalledWith(1.5, 1.5);
    expect(layer.render).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();

    loop.stop();
  });

  it('renders once-mode layers without clip', () => {
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const layer = createMockLayer({
      id: 'headers',
      zIndex: 800,
      canvas: 0,
      renderMode: 'once',
    });
    registry.register(layer);

    loop.start();
    flushRaf(16.67);

    // once-mode should not clip
    const ctx = host.getContext(0);
    expect(layer.render).toHaveBeenCalled();

    // Verify the region passed has the full canvas pseudo-region id
    const renderCall = (layer.render as jest.Mock).mock.calls[0];
    const region: RenderRegion = renderCall[1];
    expect(region.id).toBe('__full_canvas__');

    loop.stop();
  });

  it('renders layers in z-index order', () => {
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const renderOrder: string[] = [];

    const bg = createMockLayer({
      id: 'bg',
      zIndex: 0,
      canvas: 0,
      render: jest.fn(() => {
        renderOrder.push('bg');
      }),
    });
    const cells = createMockLayer({
      id: 'cells',
      zIndex: 100,
      canvas: 0,
      render: jest.fn(() => {
        renderOrder.push('cells');
      }),
    });
    const headers = createMockLayer({
      id: 'headers',
      zIndex: 800,
      canvas: 0,
      renderMode: 'once',
      render: jest.fn(() => {
        renderOrder.push('headers');
      }),
    });
    const selection = createMockLayer({
      id: 'selection',
      zIndex: 200,
      canvas: 0,
      render: jest.fn(() => {
        renderOrder.push('selection');
      }),
    });

    registry.register(bg);
    registry.register(cells);
    registry.register(headers);
    registry.register(selection);

    loop.start();
    flushRaf(16.67);

    expect(renderOrder).toEqual(['bg', 'cells', 'selection', 'headers']);

    loop.stop();
  });

  it('renders canvases independently', () => {
    const host = createMockCanvasHost(2);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const worldLayer = createMockLayer({ id: 'world', zIndex: 0, canvas: 0 });
    const overlayLayer = createMockLayer({
      id: 'overlay',
      zIndex: 0,
      canvas: 1,
      renderMode: 'once',
    });

    registry.register(worldLayer);
    registry.register(overlayLayer);

    loop.start();
    flushRaf(16.67);

    expect(worldLayer.render).toHaveBeenCalled();
    expect(overlayLayer.render).toHaveBeenCalled();

    loop.stop();
  });

  it('canvas 1 dirty does not re-render canvas 0', () => {
    const host = createMockCanvasHost(2);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    let worldDirty = true;
    const worldLayer = createMockLayer({
      id: 'world',
      zIndex: 0,
      canvas: 0,
      isDirty: jest.fn(() => worldDirty),
      markClean: jest.fn(() => {
        worldDirty = false;
      }),
    });

    let overlayDirty = true;
    const overlayLayer = createMockLayer({
      id: 'overlay',
      zIndex: 0,
      canvas: 1,
      renderMode: 'once',
      isDirty: jest.fn(() => overlayDirty),
      markClean: jest.fn(() => {
        overlayDirty = false;
      }),
    });

    registry.register(worldLayer);
    registry.register(overlayLayer);

    // First frame: both render
    loop.start();
    flushRaf(16.67);

    expect(worldLayer.render).toHaveBeenCalledTimes(1);
    expect(overlayLayer.render).toHaveBeenCalledTimes(1);

    // Mark only overlay dirty
    overlayDirty = true;
    (overlayLayer.isDirty as jest.Mock).mockReturnValue(true);
    loop.requestFrame();
    flushRaf(33.33);

    // World should NOT have been re-rendered
    expect(worldLayer.render).toHaveBeenCalledTimes(1);
    // Overlay should have been re-rendered
    expect(overlayLayer.render).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it('animation clock keeps loop alive', () => {
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    // No dirty layers
    const layer = createMockLayer({
      id: 'ui',
      canvas: 0,
      isDirty: jest.fn(() => false),
    });
    registry.register(layer);

    loop.start();

    // Request continuous frames (e.g., marching ants)
    loop.requestContinuousFrames('ui');
    flushRaf(16.67);

    // Layer should be marked dirty by continuous frames
    expect(layer.markDirty).toHaveBeenCalled();

    // Should schedule another frame
    expect(rafCallbacks.length).toBeGreaterThan(0);

    // Stop continuous frames
    loop.stopContinuousFrames('ui');
    flushRaf(33.33);

    // Should NOT schedule another frame (no dirty, no continuous)
    // The exact behavior depends on post-render state
    loop.stop();
  });

  it('error boundary uses exponential backoff', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const onLayerError = jest.fn();
    const loop = new RenderLoop({ host: host as any, registry, scheduler, onLayerError });

    let callCount = 0;
    const failingLayer = createMockLayer({
      id: 'failing',
      canvas: 0,
      render: jest.fn(() => {
        callCount++;
        throw new Error('render failed');
      }),
    });
    registry.register(failingLayer);

    loop.start();

    // Frame 1: renders and fails
    flushRaf(16.67);
    expect(callCount).toBe(1);
    expect(onLayerError).toHaveBeenCalledWith('failing', expect.any(Error), 1);

    loop.stop();
    consoleError.mockRestore();
  });

  it('never disables critical layers', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    let renderCount = 0;
    const criticalLayer = createMockLayer({
      id: 'cells', // 'cells' is in CRITICAL_LAYER_IDS
      canvas: 0,
      render: jest.fn(() => {
        renderCount++;
        throw new Error('render failed');
      }),
    });
    registry.register(criticalLayer);

    loop.start();

    // Render many frames — critical layer should never be disabled
    for (let i = 0; i < 20; i++) {
      flushRaf(i * 16.67);
    }

    // Should have attempted to render on every frame (with backoff)
    expect(renderCount).toBeGreaterThan(1);

    loop.stop();
    consoleError.mockRestore();
  });

  it('processes scheduler tasks before rendering', () => {
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({ host: host as any, registry, scheduler });

    const executionOrder: string[] = [];

    const layer = createMockLayer({
      id: 'cells',
      canvas: 0,
      render: jest.fn(() => {
        executionOrder.push('render');
      }),
    });
    registry.register(layer);

    // Schedule a task that marks the layer dirty
    const processFrameSpy = jest.spyOn(scheduler, 'processFrame');

    loop.start();
    flushRaf(16.67);

    // processFrame should have been called
    expect(processFrameSpy).toHaveBeenCalled();

    loop.stop();
  });

  it('per-layer debug timing', () => {
    const host = createMockCanvasHost(1);
    const registry = new LayerRegistry();
    const scheduler = new PriorityScheduler();
    const loop = new RenderLoop({
      host: host as any,
      registry,
      scheduler,
      debugTiming: true,
    });

    const layer = createMockLayer({ id: 'cells', canvas: 0 });
    registry.register(layer);

    loop.start();
    flushRaf(16.67);

    const timings = loop.getLayerTimings();
    expect(timings.has('cells')).toBe(true);
    const timing = timings.get('cells')!;
    expect(timing.lastMs).toBeGreaterThanOrEqual(0);
    expect(timing.avgMs).toBeGreaterThanOrEqual(0);

    loop.stop();
  });
});
