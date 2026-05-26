/**
 * createCanvasEngine — Factory Wiring All Components
 *
 * Convenience factory that creates and wires:
 * - CanvasHost (multi-canvas stacking)
 * - LayerRegistry (layer management & dirty tracking)
 * - PriorityScheduler (task scheduling)
 * - RenderLoop (frame rendering & animation clock)
 * - InputCapture (pointer & wheel events)
 * - EffectiveStateManager (optimistic state for drag/resize)
 *
 * Viewport pan/zoom is handled by the grid renderer's own system.
 *
 * @module @mog/canvas-engine
 */

import type {
  AnimationClock,
  CanvasEngine,
  CanvasHostConfig,
  CanvasInputEvent,
  CanvasLayer,
  DirtyHint,
  EffectiveStateManager,
  EngineStats,
  HitResult,
  HitTestProvider,
  LayoutUpdateOptions,
  Point,
  RegionLayout,
} from './core/types';
import { detectCanvasMemoryLimit } from './gpu/memory-detection';
import { CanvasHost } from './host/canvas-host';
import { CursorManager, InputCapture, PointerTracker } from './input/input-capture';
import { RenderLoop } from './loop/render-loop';
import { LayerRegistry } from './registry/layer-registry';
import { PriorityScheduler } from './scheduler/priority-scheduler';
import { EffectiveStateManagerImpl } from './state/effective-state-manager';

// =============================================================================
// Extended Engine Interface (implementation-specific additions)
// =============================================================================

export interface CanvasEngineInstance extends CanvasEngine {
  /** Animation clock for requesting continuous frames */
  readonly animationClock: AnimationClock;

  /** Input capture for pointer/wheel events */
  readonly input: InputCapture;

  /** Cursor manager */
  readonly cursor: CursorManager;

  /** Pointer state tracker */
  readonly pointer: PointerTracker;

  /** Effective state manager for drag/resize preview */
  readonly effectiveState: EffectiveStateManager<unknown>;

  /** Layer registry for direct access */
  readonly registry: LayerRegistry;

  /** Scheduler for direct access */
  readonly scheduler: PriorityScheduler;

  /** Request a render frame (wakes the loop if idle) */
  requestFrame(): void;

  /** Set input event callback */
  setOnInput(callback: ((event: CanvasInputEvent) => void) | null): void;

  /** Register a hit test provider */
  registerHitTestProvider(provider: HitTestProvider, zIndex: number): void;

  /** Unregister a hit test provider */
  unregisterHitTestProvider(provider: HitTestProvider): void;

  /** Dispatch a hit test */
  hitTest(screenPoint: Point): HitResult | null;

  /** Set the region layout */
  setLayout<TMeta>(layout: RegionLayout<TMeta>, options?: LayoutUpdateOptions): void;
}

// =============================================================================
// Engine Config
// =============================================================================

export interface CanvasEngineConfig extends CanvasHostConfig {
  /** Enable per-layer render timing (debug only) */
  debugTiming?: boolean;
  /** Callback for layer render errors */
  onLayerError?: (layerId: string, error: unknown, consecutiveFailures: number) => void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a fully wired canvas engine instance.
 *
 * Auto-detects GPU memory limit and falls back to single-canvas mode
 * if necessary (Mobile Safari, low-memory devices).
 */
export function createCanvasEngine(config: CanvasEngineConfig): CanvasEngineInstance {
  // Detect memory mode
  const memoryMode = detectCanvasMemoryLimit();
  const effectiveCanvasCount = memoryMode === 'single-canvas' ? 1 : (config.canvasCount ?? 2);

  // Create components
  const host = new CanvasHost({
    ...config,
    canvasCount: effectiveCanvasCount,
  });

  const registry = new LayerRegistry();
  const scheduler = new PriorityScheduler();

  const renderLoop = new RenderLoop({
    host,
    registry,
    scheduler,
    debugTiming: config.debugTiming,
    onLayerError: config.onLayerError,
  });

  const input = new InputCapture({
    container: config.container,
  });

  const effectiveState = new EffectiveStateManagerImpl<unknown>();

  // Wire resize → mark all dirty + request frame
  host.setOnResize(() => {
    registry.markAllDirty();
    renderLoop.requestFrame();
  });

  // Determine canvas mode
  const canvasMode: 'multi' | 'single' = effectiveCanvasCount > 1 ? 'multi' : 'single';

  if (canvasMode === 'single') {
    console.info('[CanvasEngine] Running in single-canvas mode (GPU memory fallback)');
  }

  // Build the engine instance
  const engine: CanvasEngineInstance = {
    // CanvasEngine interface
    start: () => renderLoop.start(),
    stop: () => renderLoop.stop(),
    pause: () => {
      renderLoop.pause();
      scheduler.pause();
    },
    resume: () => {
      scheduler.resume();
      renderLoop.resume();
    },
    dispose: () => {
      renderLoop.stop();
      input.dispose();
      registry.disposeAll();
      scheduler.dispose();
      host.dispose();
    },

    registerLayer: (layer: CanvasLayer) => {
      // In single-canvas mode, force all layers to canvas 0
      if (canvasMode === 'single' && layer.canvas > 0) {
        // Create a proxy layer that renders on canvas 0
        const proxied = Object.create(layer, {
          canvas: { value: 0, writable: false },
        });
        registry.register(proxied);
      } else {
        registry.register(layer);
      }
    },
    unregisterLayer: (id: string) => registry.unregister(id),

    setLayout: <TMeta>(layout: RegionLayout<TMeta>, options?: LayoutUpdateOptions) =>
      renderLoop.setLayout(layout, options),
    markDirty: (layerId: string, hint?: DirtyHint) => {
      registry.markDirty(layerId, hint);
      renderLoop.requestFrame();
    },
    requestFrame: () => renderLoop.requestFrame(),

    getStats: (): EngineStats => {
      const schedulerStats = scheduler.getStats();
      return {
        fps: schedulerStats.fps,
        averageFrameTime: schedulerStats.averageFrameTime,
        maxFrameTime: schedulerStats.maxFrameTime,
        layerCount: registry.size,
        dirtyLayerCount: countDirtyLayers(registry),
      };
    },

    canvasMode,

    // Extended interface
    animationClock: renderLoop,
    input,
    cursor: input.cursor,
    pointer: input.pointer,
    effectiveState,
    registry,
    scheduler,

    setOnInput: (cb) => input.setOnInput(cb),
    registerHitTestProvider: (p, z) => input.registerHitTestProvider(p, z),
    unregisterHitTestProvider: (p) => input.unregisterHitTestProvider(p),
    hitTest: (pt) => input.hitTest(pt),
  };

  return engine;
}

// =============================================================================
// Helpers
// =============================================================================

function countDirtyLayers(registry: LayerRegistry): number {
  let count = 0;
  const layers = registry.getAllSorted();
  for (const layer of layers) {
    if (layer.isDirty()) count++;
  }
  return count;
}
