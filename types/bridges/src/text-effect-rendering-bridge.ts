/**
 * TextEffect Rendering Bridge Interface
 *
 * Defines the contract for TextEffect rendering via DrawingObject[].
 * The bridge computes DrawingObjects from TextEffect config; the scene graph renders them.
 *
 * Architecture Notes:
 * - DrawingObject[] is a runtime cache, NOT persisted to Yjs
 * - The bridge listens to EventBus for automatic cache invalidation
 * - Provides ctx.textEffects.* access pattern in DocumentContext
 *
 * @see contracts/src/objects/drawing-object.ts - DrawingObject type
 * @see engine/src/bridges/text-effect-rendering-bridge.ts - Implementation
 */

import type { DrawingObject } from '@mog/types-objects/objects/drawing-object';

// =============================================================================
// TextEffect Rendering Bridge Interface
// =============================================================================

/**
 * Bridge interface for TextEffect rendering.
 *
 * This interface provides a single computation method that produces
 * DrawingObject[] from TextEffect config, plus cache management.
 *
 * LIFECYCLE:
 * 1. Bridge is created during engine initialization
 * 2. start() subscribes to TextEffect change events for cache invalidation
 * 3. stop()/destroy() cleans up resources and event subscriptions
 *
 * CACHE MANAGEMENT:
 * - Cache is per-objectId, storing computed DrawingObject[]
 * - computeDrawingObjects() returns cached result if valid, recomputes otherwise
 * - invalidateCache() marks a specific object for recomputation
 * - clearCache() clears the entire cache
 */
export interface ITextEffectRenderingBridge {
  /**
   * Start the TextEffect rendering bridge - subscribe to events for reactive updates.
   *
   * Call this after creating the bridge to begin listening for TextEffect changes.
   * The bridge will automatically invalidate the render cache when changes occur.
   *
   * @returns Cleanup function to stop the bridge
   */
  start(): () => void;

  /**
   * Stop the TextEffect rendering bridge and clean up subscriptions.
   *
   * Call this to pause event listening. Can be restarted with start().
   */
  stop(): void;

  /**
   * Compute DrawingObjects for a TextEffect object.
   *
   * Uses caching to avoid recomputation on every frame. Returns cached result
   * if the config, text, and bounds haven't changed.
   *
   * @param objectId - Floating object ID of the TextEffect
   * @param bounds - Optional bounds override (uses object bounds if not provided)
   * @returns Array of DrawingObjects or null if object not found/not TextEffect
   */
  computeDrawingObjects(
    objectId: string,
    bounds?: { width: number; height: number },
  ): Promise<DrawingObject[] | null>;

  /**
   * Invalidate render cache for an object.
   *
   * Called automatically when TextEffect config, text, or bounds change.
   * After invalidation, the next call to computeDrawingObjects() will recompute.
   *
   * @param objectId - Floating object ID to invalidate
   */
  invalidateCache(objectId: string): void;

  /**
   * Clear entire render cache.
   *
   * Forces recomputation of all TextEffect objects on next render.
   * Use sparingly as it impacts performance.
   */
  clearCache(): void;

  /**
   * Clean up resources and event subscriptions.
   *
   * Call during engine shutdown or when the bridge is no longer needed.
   */
  destroy(): void;
}
