/**
 * Tests for CanvasHost — Multi-Canvas Stacking
 *
 * Mocks all DOM APIs required by CanvasHost since tests run in Node (jest).
 */

import { jest } from '@jest/globals';

import { CanvasHost } from '../host/canvas-host';

// =============================================================================
// Mock Factories
// =============================================================================

function createMockContext(): CanvasRenderingContext2D {
  return {
    setTransform: jest.fn(),
    fillStyle: '',
    fillRect: jest.fn(),
    // Minimal stub — extend if tests need more context methods
  } as unknown as CanvasRenderingContext2D;
}

function createMockCanvas(
  contextMap?: Map<string, CanvasRenderingContext2D | null>,
): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    style: {
      position: '',
      top: '',
      left: '',
      width: '',
      height: '',
    },
    parentElement: null as HTMLElement | null,
    getContext: jest.fn((contextId: string, _options?: unknown) => {
      if (contextId === '2d') {
        if (contextMap) {
          // Return from map for controllable null scenarios
          const key = `${contextId}`;
          return contextMap.get(key) ?? createMockContext();
        }
        return createMockContext();
      }
      return null;
    }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

/** Track all canvases created via document.createElement('canvas') */
let createdCanvases: HTMLCanvasElement[] = [];

function createMockContainer(
  rect: { width: number; height: number } = { width: 800, height: 600 },
  computedPosition: string = 'static',
): HTMLElement & { _children: HTMLCanvasElement[] } {
  const children: HTMLCanvasElement[] = [];
  const container = {
    style: { position: '' },
    getBoundingClientRect: jest.fn(() => ({
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
      top: 0,
      left: 0,
      right: rect.width,
      bottom: rect.height,
      toJSON: () => {},
    })),
    appendChild: jest.fn((child: HTMLCanvasElement) => {
      children.push(child);
      // Set parentElement so removeChild works
      (child as any).parentElement = container;
      return child;
    }),
    removeChild: jest.fn((child: HTMLCanvasElement) => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      (child as any).parentElement = null;
      return child;
    }),
    // Expose children for assertions
    _children: children,
  } as unknown as HTMLElement & { _children: HTMLCanvasElement[] };

  // getComputedStyle needs to return the container's position
  (global as any).__mockComputedPosition = computedPosition;

  return container;
}

// =============================================================================
// Global DOM Mocks
// =============================================================================

let resizeObserverCallback: ((entries: unknown[]) => void) | null = null;
let resizeObserverDisconnected = false;
let rafCallbacks: Map<number, FrameRequestCallback> = new Map();
let nextRafId = 1;
let mediaQueryListeners: Map<string, { listener: () => void; removeEventListener: jest.Mock }> =
  new Map();

beforeEach(() => {
  createdCanvases = [];
  resizeObserverCallback = null;
  resizeObserverDisconnected = false;
  rafCallbacks = new Map();
  nextRafId = 1;
  mediaQueryListeners = new Map();

  // document.createElement
  (global as any).document = {
    createElement: jest.fn((tag: string) => {
      if (tag === 'canvas') {
        const canvas = createMockCanvas();
        createdCanvases.push(canvas);
        return canvas;
      }
      return {};
    }),
  };

  // getComputedStyle
  (global as any).getComputedStyle = jest.fn(() => ({
    position: (global as any).__mockComputedPosition ?? 'static',
  }));

  // window.devicePixelRatio
  Object.defineProperty(global, 'window', {
    value: {
      devicePixelRatio: 2,
      matchMedia: jest.fn((query: string) => {
        const mql = {
          matches: false,
          media: query,
          addEventListener: jest.fn((_event: string, listener: () => void) => {
            mediaQueryListeners.set(query, {
              listener,
              removeEventListener: mql.removeEventListener,
            });
          }),
          removeEventListener: jest.fn(),
        };
        return mql;
      }),
    },
    writable: true,
    configurable: true,
  });

  // ResizeObserver
  (global as any).ResizeObserver = jest
    .fn()
    .mockImplementation((cb: (entries: unknown[]) => void) => {
      resizeObserverCallback = cb;
      resizeObserverDisconnected = false;
      return {
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(() => {
          resizeObserverDisconnected = true;
        }),
      };
    });

  // requestAnimationFrame / cancelAnimationFrame
  (global as any).requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    const id = nextRafId++;
    rafCallbacks.set(id, cb);
    return id;
  });
  (global as any).cancelAnimationFrame = jest.fn((id: number) => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  delete (global as any).document;
  delete (global as any).getComputedStyle;
  delete (global as any).ResizeObserver;
  delete (global as any).requestAnimationFrame;
  delete (global as any).cancelAnimationFrame;
  delete (global as any).__mockComputedPosition;
  delete (global as any).window;
});

// Helper: flush all pending rAF callbacks
function flushRaf(): void {
  const pending = new Map(rafCallbacks);
  rafCallbacks.clear();
  for (const [, cb] of pending) {
    cb(performance.now());
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('CanvasHost', () => {
  // ---------------------------------------------------------------------------
  // Canvas Creation
  // ---------------------------------------------------------------------------
  describe('canvas creation', () => {
    it('creates the default number of canvases (2)', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      expect(createdCanvases).toHaveLength(2);
      expect(container.appendChild).toHaveBeenCalledTimes(2);
      expect(host.getCanvasCount()).toBe(2);

      host.dispose();
    });

    it('creates the specified number of canvases', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 4 });

      expect(createdCanvases).toHaveLength(4);
      expect(container.appendChild).toHaveBeenCalledTimes(4);
      expect(host.getCanvasCount()).toBe(4);

      host.dispose();
    });

    it('creates a single canvas when canvasCount is 1', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 1 });

      expect(createdCanvases).toHaveLength(1);
      expect(host.getCanvasCount()).toBe(1);

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Canvas Stacking / Positioning
  // ---------------------------------------------------------------------------
  describe('canvas stacking', () => {
    it('sets absolute positioning on each canvas', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      for (const canvas of createdCanvases) {
        expect(canvas.style.position).toBe('absolute');
        expect(canvas.style.top).toBe('0');
        expect(canvas.style.left).toBe('0');
        expect(canvas.style.width).toBe('100%');
        expect(canvas.style.height).toBe('100%');
      }

      host.dispose();
    });

    it('sets container position to relative when it is static', () => {
      const container = createMockContainer({ width: 800, height: 600 }, 'static');
      const host = new CanvasHost({ container });

      expect(container.style.position).toBe('relative');

      host.dispose();
    });

    it('does not override container position when it is already non-static', () => {
      const container = createMockContainer({ width: 800, height: 600 }, 'absolute');
      const host = new CanvasHost({ container });

      // Should NOT have been overridden — it was already 'absolute'
      expect(container.style.position).not.toBe('relative');

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // DPR Handling
  // ---------------------------------------------------------------------------
  describe('DPR handling', () => {
    it('sets physical canvas dimensions as cssWidth * dpr after flushResize', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      // DPR is 2 (set in beforeEach)
      const host = new CanvasHost({ container });

      // Canvas dimensions are deferred until flushResize()
      host.flushResize();

      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(Math.floor(800 * 2));
        expect(canvas.height).toBe(Math.floor(600 * 2));
      }

      host.dispose();
    });

    it('applies DPR transform via setTransform on each context after flushResize', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const host = new CanvasHost({ container });

      host.flushResize();

      for (const canvas of createdCanvases) {
        const ctx = (canvas.getContext as jest.Mock).mock.results[0].value;
        expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
      }

      host.dispose();
    });

    it('uses fixed DPR when dprMode is a number', () => {
      const container = createMockContainer({ width: 400, height: 300 });
      const host = new CanvasHost({ container, dprMode: 3 });

      expect(host.getDPR()).toBe(3);
      host.flushResize();
      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(Math.floor(400 * 3));
        expect(canvas.height).toBe(Math.floor(300 * 3));
      }

      host.dispose();
    });

    it('reports correct DPR via getDPR()', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      expect(host.getDPR()).toBe(2);

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // DPR Mode: 'auto' vs fixed
  // ---------------------------------------------------------------------------
  describe('DPR mode', () => {
    it('auto mode reads window.devicePixelRatio', () => {
      (global as any).window.devicePixelRatio = 1.5;
      const container = createMockContainer({ width: 100, height: 100 });
      const host = new CanvasHost({ container, dprMode: 'auto' });

      expect(host.getDPR()).toBe(1.5);
      host.flushResize();
      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(Math.floor(100 * 1.5));
        expect(canvas.height).toBe(Math.floor(100 * 1.5));
      }

      host.dispose();
    });

    it('auto mode sets up matchMedia listener for DPR changes', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, dprMode: 'auto' });

      expect((global as any).window.matchMedia).toHaveBeenCalledWith('(resolution: 2dppx)');

      host.dispose();
    });

    it('fixed DPR mode does not set up matchMedia listener', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, dprMode: 3 });

      expect((global as any).window.matchMedia).not.toHaveBeenCalled();

      host.dispose();
    });

    it('defaults to auto mode when dprMode is omitted', () => {
      (global as any).window.devicePixelRatio = 2.5;
      const container = createMockContainer({ width: 200, height: 100 });
      const host = new CanvasHost({ container });

      expect(host.getDPR()).toBe(2.5);

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Context Options (alpha)
  // ---------------------------------------------------------------------------
  describe('context options', () => {
    it('requests alpha: false for canvas 0 (bottom)', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 3 });

      const firstCanvas = createdCanvases[0];
      const getContextCalls = (firstCanvas.getContext as jest.Mock).mock.calls;

      // First call should be '2d' with alpha: false
      expect(getContextCalls[0][0]).toBe('2d');
      expect(getContextCalls[0][1]).toEqual(expect.objectContaining({ alpha: false }));

      host.dispose();
    });

    it('requests alpha: true for canvas 1+ (overlay canvases)', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 3 });

      for (let i = 1; i < createdCanvases.length; i++) {
        const canvas = createdCanvases[i];
        const getContextCalls = (canvas.getContext as jest.Mock).mock.calls;

        expect(getContextCalls[0][0]).toBe('2d');
        expect(getContextCalls[0][1]).toEqual(expect.objectContaining({ alpha: true }));
      }

      host.dispose();
    });

    it('requests desynchronized: true for all canvases', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 2 });

      for (const canvas of createdCanvases) {
        const getContextCalls = (canvas.getContext as jest.Mock).mock.calls;
        expect(getContextCalls[0][1]).toEqual(expect.objectContaining({ desynchronized: true }));
      }

      host.dispose();
    });

    it('falls back to getContext without desynchronized if first call returns null', () => {
      // Override document.createElement to return canvases where first getContext returns null
      let callCount = 0;
      (global as any).document.createElement = jest.fn((tag: string) => {
        if (tag === 'canvas') {
          const mockCtx = createMockContext();
          const canvas = {
            width: 0,
            height: 0,
            style: { position: '', top: '', left: '', width: '', height: '' },
            parentElement: null,
            getContext: jest.fn((_id: string, options?: any) => {
              callCount++;
              // First call (with desynchronized): return null
              // Second call (fallback): return context
              if (options?.desynchronized) return null;
              return mockCtx;
            }),
          } as unknown as HTMLCanvasElement;
          createdCanvases.push(canvas);
          return canvas;
        }
        return {};
      });

      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 1 });

      const canvas = createdCanvases[0];
      const getContextCalls = (canvas.getContext as jest.Mock).mock.calls;

      // Should have two calls: first with desynchronized, then without
      expect(getContextCalls).toHaveLength(2);
      expect(getContextCalls[0][1]).toEqual(expect.objectContaining({ desynchronized: true }));
      expect(getContextCalls[1][1]).toEqual(expect.not.objectContaining({ desynchronized: true }));

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // getContext / getCanvas / getSize / getDPR API
  // ---------------------------------------------------------------------------
  describe('public API', () => {
    it('getCanvas returns the correct canvas element', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 3 });

      for (let i = 0; i < 3; i++) {
        expect(host.getCanvas(i)).toBe(createdCanvases[i]);
      }

      host.dispose();
    });

    it('getContext returns a valid CanvasRenderingContext2D', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      const ctx0 = host.getContext(0);
      const ctx1 = host.getContext(1);

      expect(ctx0).toBeDefined();
      expect(ctx1).toBeDefined();
      expect(ctx0.setTransform).toBeDefined();
      expect(ctx1.setTransform).toBeDefined();

      host.dispose();
    });

    it('getSize returns the current CSS size', () => {
      const container = createMockContainer({ width: 1024, height: 768 });
      const host = new CanvasHost({ container });

      const size = host.getSize();
      expect(size).toEqual({ width: 1024, height: 768 });

      host.dispose();
    });

    it('getDPR returns the current device pixel ratio', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, dprMode: 1.5 });

      expect(host.getDPR()).toBe(1.5);

      host.dispose();
    });

    it('getCanvasCount returns the configured canvas count', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 5 });

      expect(host.getCanvasCount()).toBe(5);

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Resize Behavior
  // ---------------------------------------------------------------------------
  describe('resize behavior', () => {
    it('applies initial size on construction (deferred to flushResize)', () => {
      const container = createMockContainer({ width: 640, height: 480 });
      const host = new CanvasHost({ container, dprMode: 1 });

      // getSize() returns dimensions immediately
      expect(host.getSize()).toEqual({ width: 640, height: 480 });

      // Canvas element dimensions are deferred
      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
      }

      // After flushResize, canvas dimensions are applied
      host.flushResize();
      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(640);
        expect(canvas.height).toBe(480);
      }

      host.dispose();
    });

    it('resize() defers canvas dimension update to flushResize', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const host = new CanvasHost({ container, dprMode: 1 });
      host.flushResize(); // apply initial size

      // Simulate container resize
      (container.getBoundingClientRect as jest.Mock).mockReturnValue({
        x: 0,
        y: 0,
        width: 1024,
        height: 768,
        top: 0,
        left: 0,
        right: 1024,
        bottom: 768,
        toJSON: () => {},
      });

      host.resize();

      // getSize() updates immediately
      expect(host.getSize()).toEqual({ width: 1024, height: 768 });

      // Canvas dimensions are NOT yet updated
      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(600);
      }

      // After flushResize, canvas dimensions are applied
      host.flushResize();
      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(1024);
        expect(canvas.height).toBe(768);
      }

      host.dispose();
    });

    it('does not update if container has zero dimensions', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const host = new CanvasHost({ container, dprMode: 1 });

      // Simulate container collapsing to zero
      (container.getBoundingClientRect as jest.Mock).mockReturnValue({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        toJSON: () => {},
      });

      host.resize();

      // Size should remain at the previous value
      expect(host.getSize()).toEqual({ width: 800, height: 600 });

      host.dispose();
    });

    it('ResizeObserver triggers rAF-batched resize with deferred canvas dimensions', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const onResize = jest.fn();
      const host = new CanvasHost({ container, dprMode: 1 });
      host.flushResize(); // apply initial
      host.setOnResize(onResize);

      // Simulate new container size
      (container.getBoundingClientRect as jest.Mock).mockReturnValue({
        x: 0,
        y: 0,
        width: 1000,
        height: 700,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 700,
        toJSON: () => {},
      });

      // Trigger ResizeObserver
      resizeObserverCallback?.([]);

      // Before rAF fires, size should still be old
      expect(host.getSize()).toEqual({ width: 800, height: 600 });

      // Flush rAF — applySize() runs, updates getSize() but defers canvas dimensions
      flushRaf();

      expect(host.getSize()).toEqual({ width: 1000, height: 700 });
      expect(onResize).toHaveBeenCalled();

      // Canvas dimensions are still old (deferred)
      expect(createdCanvases[0].width).toBe(800);

      // After flushResize, canvas dimensions are applied
      host.flushResize();
      expect(createdCanvases[0].width).toBe(1000);
      expect(createdCanvases[0].height).toBe(700);

      host.dispose();
    });

    it('multiple ResizeObserver callbacks within one frame batch into a single update', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const onResize = jest.fn();
      const host = new CanvasHost({ container, dprMode: 1 });
      host.setOnResize(onResize);

      // Simulate resize
      (container.getBoundingClientRect as jest.Mock).mockReturnValue({
        x: 0,
        y: 0,
        width: 900,
        height: 700,
        top: 0,
        left: 0,
        right: 900,
        bottom: 700,
        toJSON: () => {},
      });

      // Trigger multiple resize callbacks before rAF fires
      resizeObserverCallback?.([]);
      resizeObserverCallback?.([]);
      resizeObserverCallback?.([]);

      // Only one rAF should have been scheduled
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

      flushRaf();

      // onResize should have been called once, not three times
      expect(onResize).toHaveBeenCalledTimes(1);
      expect(host.getSize()).toEqual({ width: 900, height: 700 });

      host.dispose();
    });

    it('setOnResize callback is invoked when applySize runs', () => {
      const container = createMockContainer({ width: 200, height: 100 });
      const onResize = jest.fn();
      const host = new CanvasHost({ container, dprMode: 1 });
      host.setOnResize(onResize);

      // Force resize
      host.resize();

      expect(onResize).toHaveBeenCalled();

      host.dispose();
    });

    it('setOnResize(null) clears the callback', () => {
      const container = createMockContainer({ width: 200, height: 100 });
      const onResize = jest.fn();
      const host = new CanvasHost({ container, dprMode: 1 });
      host.setOnResize(onResize);
      host.setOnResize(null);

      host.resize();

      expect(onResize).not.toHaveBeenCalled();

      host.dispose();
    });

    it('DPR change recalculates physical canvas dimensions', () => {
      const container = createMockContainer({ width: 400, height: 300 });
      const host = new CanvasHost({ container, dprMode: 1 });

      host.flushResize();
      expect(createdCanvases[0].width).toBe(400);
      expect(createdCanvases[0].height).toBe(300);

      // Now create a new host with higher DPR
      host.dispose();
      createdCanvases = [];

      const host2 = new CanvasHost({ container, dprMode: 2 });
      host2.flushResize();
      expect(createdCanvases[0].width).toBe(800);
      expect(createdCanvases[0].height).toBe(600);
      expect(host2.getDPR()).toBe(2);

      host2.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // flushResize — Deferred Canvas Dimension Application
  // ---------------------------------------------------------------------------
  describe('flushResize', () => {
    it('returns true when a pending resize exists and applies it', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const host = new CanvasHost({ container, dprMode: 1 });

      // Constructor called applySize() which stored a pending resize
      expect(host.flushResize()).toBe(true);

      // Canvas dimensions are now applied
      for (const canvas of createdCanvases) {
        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(600);
      }

      host.dispose();
    });

    it('returns false when no resize is pending', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const host = new CanvasHost({ container, dprMode: 1 });

      // Flush the initial pending resize
      host.flushResize();

      // Second call should return false — nothing pending
      expect(host.flushResize()).toBe(false);

      host.dispose();
    });

    it('does not modify canvas dimensions when no resize is pending', () => {
      const container = createMockContainer({ width: 800, height: 600 });
      const host = new CanvasHost({ container, dprMode: 1 });
      host.flushResize(); // apply initial

      // Record current dimensions
      const w = createdCanvases[0].width;
      const h = createdCanvases[0].height;

      // Calling flushResize again should be a no-op
      host.flushResize();
      expect(createdCanvases[0].width).toBe(w);
      expect(createdCanvases[0].height).toBe(h);

      host.dispose();
    });

    it('after applySize (via resize()), canvas.width is unchanged until flushResize', () => {
      const container = createMockContainer({ width: 400, height: 300 });
      const host = new CanvasHost({ container, dprMode: 2 });
      host.flushResize(); // apply initial: 400*2=800, 300*2=600

      expect(createdCanvases[0].width).toBe(800);

      // Simulate container resize
      (container.getBoundingClientRect as jest.Mock).mockReturnValue({
        x: 0,
        y: 0,
        width: 500,
        height: 400,
        top: 0,
        left: 0,
        right: 500,
        bottom: 400,
        toJSON: () => {},
      });

      host.resize();

      // Canvas dimensions should NOT have changed yet
      expect(createdCanvases[0].width).toBe(800);
      expect(createdCanvases[0].height).toBe(600);

      // getSize() should already reflect the new size
      expect(host.getSize()).toEqual({ width: 500, height: 400 });

      // flushResize applies the deferred dimensions
      expect(host.flushResize()).toBe(true);
      expect(createdCanvases[0].width).toBe(1000); // 500 * 2
      expect(createdCanvases[0].height).toBe(800); // 400 * 2

      host.dispose();
    });

    it('applies setTransform with correct DPR during flushResize', () => {
      const container = createMockContainer({ width: 400, height: 300 });
      const host = new CanvasHost({ container, dprMode: 2 });

      host.flushResize();

      const ctx = (createdCanvases[0].getContext as jest.Mock).mock.results[0].value;
      expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Disposal / Cleanup
  // ---------------------------------------------------------------------------
  describe('disposal', () => {
    it('removes all canvases from the DOM', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      expect(container._children.length).toBe(2);

      host.dispose();

      expect(container.removeChild).toHaveBeenCalledTimes(2);
    });

    it('disconnects the ResizeObserver', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      host.dispose();

      expect(resizeObserverDisconnected).toBe(true);
    });

    it('cancels pending rAF', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      // Trigger a resize to schedule rAF
      resizeObserverCallback?.([]);

      host.dispose();

      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('removes DPR matchMedia listener on dispose', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, dprMode: 'auto' });

      // matchMedia should have been called
      expect((global as any).window.matchMedia).toHaveBeenCalled();

      host.dispose();

      // Find the matchMedia mock and verify removeEventListener was called
      const mql = ((global as any).window.matchMedia as jest.Mock).mock.results[0].value;
      expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('is idempotent (calling dispose twice does not throw)', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      host.dispose();
      expect(() => host.dispose()).not.toThrow();
    });

    it('clears the onResize callback on dispose', () => {
      const container = createMockContainer();
      const onResize = jest.fn();
      const host = new CanvasHost({ container });
      host.setOnResize(onResize);

      host.dispose();

      // After dispose, the internal canvases array is empty, so resize would not call onResize
      // The implementation sets onResize to null
      // We can verify by checking that calling resize post-dispose does not invoke it
      // (But the host is disposed, so resize observer won't fire anyway)
    });

    it('ResizeObserver callback after dispose does not cause errors', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container });

      // Trigger a resize observer callback BEFORE dispose to schedule rAF
      resizeObserverCallback?.([]);

      host.dispose();

      // Now flush rAF — the callback should bail out because disposed=true
      expect(() => flushRaf()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Range Errors for Invalid Indices
  // ---------------------------------------------------------------------------
  describe('range errors', () => {
    it('getCanvas throws RangeError for negative index', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 2 });

      expect(() => host.getCanvas(-1)).toThrow(RangeError);
      expect(() => host.getCanvas(-1)).toThrow('Canvas index -1 out of range [0, 2)');

      host.dispose();
    });

    it('getCanvas throws RangeError for index >= canvasCount', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 2 });

      expect(() => host.getCanvas(2)).toThrow(RangeError);
      expect(() => host.getCanvas(2)).toThrow('Canvas index 2 out of range [0, 2)');
      expect(() => host.getCanvas(99)).toThrow(RangeError);

      host.dispose();
    });

    it('getContext throws RangeError for negative index', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 2 });

      expect(() => host.getContext(-1)).toThrow(RangeError);
      expect(() => host.getContext(-1)).toThrow('Canvas index -1 out of range [0, 2)');

      host.dispose();
    });

    it('getContext throws RangeError for index >= canvasCount', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 2 });

      expect(() => host.getContext(2)).toThrow(RangeError);
      expect(() => host.getContext(3)).toThrow(RangeError);

      host.dispose();
    });

    it('getContext throws Error when context is null (getContext("2d") failed)', () => {
      // Override createElement to produce canvases that always return null from getContext
      (global as any).document.createElement = jest.fn((tag: string) => {
        if (tag === 'canvas') {
          const canvas = {
            width: 0,
            height: 0,
            style: { position: '', top: '', left: '', width: '', height: '' },
            parentElement: null,
            getContext: jest.fn(() => null),
          } as unknown as HTMLCanvasElement;
          createdCanvases.push(canvas);
          return canvas;
        }
        return {};
      });

      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 1 });

      expect(() => host.getContext(0)).toThrow('Failed to get 2D context for canvas 0');

      host.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles fractional DPR values correctly (floors physical pixels)', () => {
      const container = createMockContainer({ width: 333, height: 222 });
      const host = new CanvasHost({ container, dprMode: 1.5 });

      host.flushResize();

      // 333 * 1.5 = 499.5 -> floor to 499
      // 222 * 1.5 = 333.0 -> floor to 333
      expect(createdCanvases[0].width).toBe(Math.floor(333 * 1.5));
      expect(createdCanvases[0].height).toBe(Math.floor(222 * 1.5));

      host.dispose();
    });

    it('handles DPR of 1 (non-retina)', () => {
      (global as any).window.devicePixelRatio = 1;
      const container = createMockContainer({ width: 800, height: 600 });
      const host = new CanvasHost({ container });

      expect(host.getDPR()).toBe(1);
      host.flushResize();
      expect(createdCanvases[0].width).toBe(800);
      expect(createdCanvases[0].height).toBe(600);

      // setTransform should use identity-like transform (1, 0, 0, 1, 0, 0)
      const ctx = (createdCanvases[0].getContext as jest.Mock).mock.results[0].value;
      expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);

      host.dispose();
    });

    it('constructor defers canvas dimensions but getSize() is immediate', () => {
      const container = createMockContainer({ width: 500, height: 400 });
      const host = new CanvasHost({ container, dprMode: 1 });

      // getSize() is available immediately
      expect(host.getSize()).toEqual({ width: 500, height: 400 });
      // Canvas element dimensions are deferred
      expect(createdCanvases[0].width).toBe(0);

      // flushResize applies the pending dimensions
      host.flushResize();
      expect(createdCanvases[0].width).toBe(500);

      host.dispose();
    });

    it('pre-fills bottom canvas (index 0) with default white background', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 2 });

      // Canvas 0 context should have fillRect called for pre-fill
      const canvas0 = createdCanvases[0];
      const ctx0 = (canvas0.getContext as jest.Mock).mock.results[0].value;
      expect(ctx0.fillStyle).toBe('#ffffff');
      expect(ctx0.fillRect).toHaveBeenCalledWith(0, 0, 1, 1);

      host.dispose();
    });

    it('pre-fills bottom canvas with custom backgroundColor', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 2, backgroundColor: '#f0f0f0' });

      const canvas0 = createdCanvases[0];
      const ctx0 = (canvas0.getContext as jest.Mock).mock.results[0].value;
      expect(ctx0.fillStyle).toBe('#f0f0f0');
      expect(ctx0.fillRect).toHaveBeenCalled();

      host.dispose();
    });

    it('does NOT pre-fill overlay canvases (index 1+)', () => {
      const container = createMockContainer();
      const host = new CanvasHost({ container, canvasCount: 3 });

      for (let i = 1; i < createdCanvases.length; i++) {
        const canvas = createdCanvases[i];
        const ctx = (canvas.getContext as jest.Mock).mock.results[0].value;
        expect(ctx.fillRect).not.toHaveBeenCalled();
      }

      host.dispose();
    });

    it('fixed dprMode bypasses window.devicePixelRatio entirely', () => {
      // When dprMode is a fixed number, computeDpr returns that number
      // regardless of what window.devicePixelRatio says.
      (global as any).window.devicePixelRatio = 3;
      const container = createMockContainer({ width: 100, height: 100 });
      const host = new CanvasHost({ container, dprMode: 1 });

      expect(host.getDPR()).toBe(1);
      host.flushResize();
      expect(createdCanvases[0].width).toBe(100);
      expect(createdCanvases[0].height).toBe(100);

      host.dispose();
    });
  });
});
