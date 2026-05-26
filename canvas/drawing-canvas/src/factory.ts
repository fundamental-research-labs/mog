/**
 * Factory — createDrawingLayer
 *
 * Creates a fully wired DrawingLayer with scene graph, bridge registry,
 * hit map, image cache. The SceneGraph's onDirty callback is wired to
 * the layer's markDirty(), ensuring scene changes trigger re-render.
 *
 * @module @mog/drawing-canvas/factory
 */

import type { DocSpaceRect, TextMeasurer } from '@mog/canvas-engine';
import { BridgeRegistry } from './bridges/bridge-registry';
import type { DrawingBridgeConfig } from './bridges/types';
import { HitMap } from './hit-testing/hit-map';
import { DrawingLayer } from './layer/drawing-layer';
import { ImageCache } from './renderers/image-cache';
import { SceneGraph } from './scene/scene-graph';

// =============================================================================
// Factory Config
// =============================================================================

export interface CreateDrawingLayerConfig {
  /** Bridge configuration (chart, diagram, text-effects, equation, ink) */
  bridges: DrawingBridgeConfig;
  /** Optional text measurer for accurate word wrapping */
  textMeasurer?: TextMeasurer | null;
  /** Optional callback to request a render frame when scene changes occur */
  requestFrame?: () => void;
}

// =============================================================================
// Factory Result
// =============================================================================

export interface DrawingLayerHandle {
  /** The CanvasLayer to register with the engine */
  readonly layer: DrawingLayer;
  /** The scene graph — add/remove/update objects here */
  readonly sceneGraph: SceneGraph;
  /** The bridge registry — update bridges after construction if needed */
  readonly bridges: BridgeRegistry;
  /** The hit map — call setViewportTransform() during render, hitTest() during input */
  readonly hitMap: HitMap;
  /** The image cache — invalidate/clear as needed */
  readonly imageCache: ImageCache;
  /** Dispose all resources */
  dispose(): void;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a fully wired drawing layer with all dependencies.
 *
 * The factory owns the lifecycle of all components. Call dispose()
 * on the returned handle to clean up.
 */
export function createDrawingLayer(config: CreateDrawingLayerConfig): DrawingLayerHandle {
  // Create bridge registry
  const bridges = new BridgeRegistry(config.bridges);

  // Create image cache — wired to mark layer dirty on image load
  let layer: DrawingLayer | null = null;
  const imageCache = new ImageCache(() => {
    layer?.markDirty();
    config.requestFrame?.();
  });

  // Create scene graph — wired to mark layer dirty on mutation.
  // The callback receives affected bounds from add/remove/update.
  // Empty bounds array (from clear()) → full dirty.
  const sceneGraph = new SceneGraph((affectedBounds) => {
    if (affectedBounds.length === 0) {
      // clear() or bulk operation — fall back to full dirty
      layer?.markDirty({ type: 'full' });
    } else {
      layer?.markDirty({ type: 'rects', bounds: affectedBounds as DocSpaceRect[] });
    }
    config.requestFrame?.();
  });

  // Create hit map
  const hitMap = new HitMap(sceneGraph);

  // Create the drawing layer
  layer = new DrawingLayer({
    sceneGraph,
    bridges,
    imageCache,
    hitMap,
    textMeasurer: config.textMeasurer ?? null,
  });

  return {
    layer,
    sceneGraph,
    bridges,
    hitMap,
    imageCache,
    dispose() {
      layer!.dispose();
      sceneGraph.clear();
    },
  };
}
